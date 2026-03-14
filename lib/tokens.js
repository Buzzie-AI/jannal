/**
 * Token estimation and context window logic.
 * Isolated for testing without UI or server.
 *
 * @module lib/tokens
 */

// ─── Token estimation ────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 3.8;

/**
 * Estimate token count from string or JSON-serializable input.
 * Uses ~3.8 chars/token heuristic (Anthropic averages ~3.9–4 for English).
 *
 * @param {string|object} input - Text or object to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(input) {
  if (!input) return 0;
  const str = typeof input === "string" ? input : JSON.stringify(input);
  return Math.ceil(str.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a single tool definition.
 *
 * @param {object} tool - Tool object (name, description, input_schema, etc.)
 * @returns {number} Estimated token count
 */
function estimateToolTokens(tool) {
  return estimateTokens(tool);
}

// ─── Model budget (context window size) ──────────────────────────────────────

const MODEL_BUDGETS = {
  "gpt-4o": 128000,
  "gpt-4-turbo": 128000,
  "gpt-3.5": 16385,
  "gemini": 1000000,
};

/** Known context tiers (128k, 200k, 1M). */
const CONTEXT_TIERS = [128000, 200000, 1000000];

/**
 * Get the default context window size for a model.
 *
 * @param {string} model - Model identifier (e.g. "claude-sonnet-4", "claude-opus-4-5")
 * @returns {number} Context window size in tokens
 */
function getBudget(model) {
  if (!model) return 200000;
  const m = model.toLowerCase();

  if (m.includes("1m")) return 1000000;
  if (
    m.includes("opus-4-5") ||
    m.includes("opus-4-6") ||
    m.includes("opus-4.5") ||
    m.includes("opus-4.6")
  )
    return 1000000;
  if (m.includes("claude")) return 200000;

  for (const [key, budget] of Object.entries(MODEL_BUDGETS)) {
    if (m.includes(key)) return budget;
  }
  return 200000;
}

/**
 * Infer the effective context budget for a model given current token usage.
 * Snaps to the next tier if usage exceeds the model's default.
 *
 * @param {string} model - Model identifier
 * @param {number} tokenCount - Current estimated/actual token count
 * @returns {number} Effective context window size
 */
function inferBudget(model, tokenCount) {
  const base = getBudget(model);
  if (tokenCount <= base) return base;
  for (const tier of CONTEXT_TIERS) {
    if (tokenCount <= tier) return tier;
  }
  return Math.max(base, tokenCount);
}

// ─── Pure segment analysis (for testing) ──────────────────────────────────────

/**
 * Analyze a request body and return segments with token estimates.
 * Pure function, no side effects.
 *
 * @param {object} body - Anthropic API request body (system, tools, messages)
 * @returns {{ segments: object[], totalEstimatedTokens: number, budget: number }}
 */
function analyzeSegments(body) {
  const segments = [];
  const model = body.model || "unknown";

  if (body.system) {
    const text =
      typeof body.system === "string"
        ? body.system
        : JSON.stringify(body.system, null, 2);
    segments.push({
      type: "system",
      name: "System Prompt",
      tokens: estimateTokens(text),
      charLength: text.length,
    });
  }

  if (body.tools && body.tools.length > 0) {
    const toolsJson = JSON.stringify(body.tools);
    segments.push({
      type: "tools",
      name: `Tools (${body.tools.length})`,
      tokens: estimateTokens(toolsJson),
      count: body.tools.length,
    });
  }

  if (body.messages) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const content =
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content);
      const isToolResult =
        Array.isArray(msg.content) &&
        msg.content.some((c) => c.type === "tool_result");
      const isToolUse =
        Array.isArray(msg.content) &&
        msg.content.some((c) => c.type === "tool_use");
      let type = "message";
      let name = `${msg.role} message`;
      if (isToolResult) {
        type = "tool_result";
        name = "Tool Result";
      } else if (isToolUse) {
        type = "tool_use";
        name = "Tool Use (assistant)";
      }
      segments.push({
        type,
        role: msg.role,
        name,
        tokens: estimateTokens(content),
        charLength: content.length,
        index: i,
      });
    }
  }

  const totalEstimatedTokens = segments.reduce((s, seg) => s + seg.tokens, 0);
  const budget = inferBudget(model, totalEstimatedTokens);

  return { segments, totalEstimatedTokens, budget };
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  CHARS_PER_TOKEN,
  estimateTokens,
  estimateToolTokens,
  getBudget,
  inferBudget,
  MODEL_BUDGETS,
  CONTEXT_TIERS,
  analyzeSegments,
};
