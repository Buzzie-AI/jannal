const http = require("http");
const https = require("https");
const { WebSocketServer } = require("ws");
const fs = require("fs");
const path = require("path");

const { PluginHost } = require("./lib/plugins");

const ANTHROPIC_HOST = "api.anthropic.com";

const {
  estimateTokens,
  getBudget,
  inferBudget,
  analyzeSegments,
} = require("./lib/tokens");

// ─── Model pricing ($ per 1M tokens) ────────────────────────────────────────

// Source: https://docs.anthropic.com/en/docs/about-claude/pricing
// Prices are $ per 1M tokens. Ordered most-specific first for substring matching.
const MODEL_PRICING = {
  "claude-opus-4-6":  { input: 5,    output: 25 },
  "claude-opus-4.6":  { input: 5,    output: 25 },
  "claude-opus-4-5":  { input: 5,    output: 25 },
  "claude-opus-4.5":  { input: 5,    output: 25 },
  "claude-opus-4-1":  { input: 15,   output: 75 },
  "claude-opus-4.1":  { input: 15,   output: 75 },
  "claude-opus-4":    { input: 15,   output: 75 },
  "claude-3-opus":    { input: 15,   output: 75 },
  "claude-opus":      { input: 5,    output: 25 },  // default opus = latest (4.5+)
  "claude-sonnet-4":  { input: 3,    output: 15 },
  "claude-sonnet-3":  { input: 3,    output: 15 },
  "claude-3-5-sonnet":{ input: 3,    output: 15 },
  "claude-sonnet":    { input: 3,    output: 15 },
  "claude-haiku-4":   { input: 1,    output: 5 },
  "claude-3-5-haiku": { input: 0.80, output: 4 },
  "claude-haiku-3":   { input: 0.25, output: 1.25 },
  "claude-3-haiku":   { input: 0.25, output: 1.25 },
  "claude-haiku":     { input: 1,    output: 5 },   // default haiku = latest (4.5)
  "claude-4":         { input: 3,    output: 15 },
  "claude-3":         { input: 3,    output: 15 },
};

function getModelPricing(model) {
  if (!model) return { input: 3, output: 15 };
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (model.includes(key)) return pricing;
  }
  return { input: 3, output: 15 }; // default to sonnet pricing
}

function calculateCost(inputTokens, outputTokens, model, cacheCreationTokens = 0, cacheReadTokens = 0) {
  const pricing = getModelPricing(model);
  // Non-cached input tokens = total - cache_creation - cache_read
  const baseInputTokens = Math.max(0, inputTokens - cacheCreationTokens - cacheReadTokens);
  const baseCost = (baseInputTokens / 1_000_000) * pricing.input;
  // Cache writes cost 25% more than base input
  const cacheWriteCost = (cacheCreationTokens / 1_000_000) * pricing.input * 1.25;
  // Cache reads cost 10% of base input
  const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.input * 0.10;
  const inputCost = baseCost + cacheWriteCost + cacheReadCost;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

// ─── Streaming response parser ───────────────────────────────────────────────

function parseStreamedResponse(data) {
  const lines = data.split("\n");
  let inputTokens = 0;
  let cacheCreationTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let stopReason = null;
  const toolsUsed = [];

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    try {
      const event = JSON.parse(line.slice(6));
      if (event.type === "message_start" && event.message?.usage) {
        const u = event.message.usage;
        inputTokens = u.input_tokens || 0;
        cacheCreationTokens = u.cache_creation_input_tokens || 0;
        cacheReadTokens = u.cache_read_input_tokens || 0;
      }
      if (event.type === "message_delta") {
        if (event.usage) outputTokens = event.usage.output_tokens || 0;
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
      }
      if (event.type === "content_block_start" &&
          event.content_block?.type === "tool_use" &&
          event.content_block?.name) {
        toolsUsed.push(event.content_block.name);
      }
    } catch (e) { /* skip */ }
  }

  // Total input = non-cached + cache-created + cache-read
  const totalInputTokens = inputTokens + cacheCreationTokens + cacheReadTokens;

  return {
    inputTokens: totalInputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    outputTokens,
    stopReason,
    toolsUsed,
  };
}

// ─── Accurate token counting via Anthropic API ──────────────────────────────

function countTokensViaAPI(body, apiKey) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      model: body.model,
      system: body.system,
      tools: body.tools,
      messages: body.messages,
    });
    const payloadBuffer = Buffer.from(payload, "utf-8");

    const req = https.request(
      {
        hostname: ANTHROPIC_HOST,
        port: 443,
        path: "/v1/messages/count_tokens",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-length": payloadBuffer.length,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(data);
            resolve(result.input_tokens || null);
          } catch (e) {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.write(payloadBuffer);
    req.end();
  });
}

// ─── Helper: read POST body ─────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

// ─── Helper: JSON response ──────────────────────────────────────────────────

function jsonResponse(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

// ─── Hash helpers ────────────────────────────────────────────────────────────

function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

/**
 * Strip Claude Code infrastructure tags from user message text.
 * Used by grouping helpers and router intent extraction for consistent text cleaning.
 */
function stripInfrastructureTags(text) {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .trim();
}

// ─── createServer factory ────────────────────────────────────────────────────

function createServer(opts = {}) {
  const PORT = process.env.JANNAL_PORT || 4455;
  const pluginHost = new PluginHost();

  // Register plugins
  if (opts.plugins) {
    for (const p of opts.plugins) pluginHost.register(p);
  }

  // ─── WebSocket clients ─────────────────────────────────────────────────────

  const wsClients = new Set();

  function broadcast(data) {
    const msg = JSON.stringify(data);
    for (const client of wsClients) {
      if (client.readyState === 1) client.send(msg);
    }
  }

  // ─── Request storage (full content kept server-side) ───────────────────────

  const reqStore = new Map(); // reqId -> { fullContents, model }
  const MAX_STORED_REQS = 200;

  // ─── Profile management ────────────────────────────────────────────────────

  const PROFILES_FILE = path.join(__dirname, "profiles.json");

  let profiles = {};
  let activeProfile = "All Tools";

  function loadProfiles() {
    try {
      if (fs.existsSync(PROFILES_FILE)) {
        const data = JSON.parse(fs.readFileSync(PROFILES_FILE, "utf-8"));
        profiles = data.profiles || {};
        activeProfile = data.activeProfile || "All Tools";
      }
    } catch (err) {
      console.error("Failed to load profiles:", err.message);
    }
    // Ensure default profile always exists
    if (!profiles["All Tools"]) {
      profiles["All Tools"] = { name: "All Tools", mode: "allowlist", tools: [] };
    }
  }

  function saveProfiles() {
    try {
      fs.writeFileSync(PROFILES_FILE, JSON.stringify({ profiles, activeProfile }, null, 2));
    } catch (err) {
      console.error("Failed to save profiles:", err.message);
    }
  }

  function applyToolFilter(tools, profileName) {
    if (!tools || !profileName || profileName === "All Tools") {
      return { filtered: tools || [], removed: [] };
    }
    const profile = profiles[profileName];
    if (!profile || !profile.tools || profile.tools.length === 0) {
      return { filtered: tools, removed: [] };
    }

    const removed = [];
    let filtered;

    if (profile.mode === "blocklist") {
      // Remove tools that are in the blocklist
      filtered = tools.filter((t) => {
        if (profile.tools.includes(t.name)) {
          removed.push(t.name);
          return false;
        }
        return true;
      });
    } else {
      // allowlist: keep only tools in the list
      filtered = tools.filter((t) => {
        if (profile.tools.includes(t.name)) return true;
        removed.push(t.name);
        return false;
      });
    }

    return { filtered, removed };
  }

  loadProfiles();

  // ─── Group tracking ────────────────────────────────────────────────────────

  let groupCounter = 0;
  let lastRequestTime = 0;
  let lastMainSessionKey = null;
  const GAP_THRESHOLD = 45000;
  const NEW_MAIN_MSG_THRESHOLD = 20;
  const MAX_TRACKED_CONVERSATIONS = 10;
  const conversationGroups = new Map();

  /**
   * Compute a stable session hash from model + system prompt text content.
   */
  function getSessionHash(body) {
    if (!body.system) return "no-system";
    let text;
    if (typeof body.system === "string") {
      text = body.system.trim();
    } else if (Array.isArray(body.system)) {
      text = body.system
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text.trim())
        .join("\n")
        .trim();
    } else {
      return "no-system";
    }
    if (!text) return "no-system";
    text = text.replace(/^x-anthropic-billing-header:[^\n]*\n?/, "");
    const model = body.model || "unknown";
    return simpleHash(model + "|" + text.slice(0, 5000));
  }

  /**
   * Extract Claude Code session identity from the request body.
   * - sessionId: the per-session hash from the billing header (cch=...)
   * - sessionLabel: last path component of the working directory
   * - sessionPath: full working directory path
   */
  function extractSessionInfo(body) {
    if (!body.system) return { sessionId: null, sessionLabel: null, sessionPath: null }
    let text
    if (typeof body.system === 'string') {
      text = body.system
    } else if (Array.isArray(body.system)) {
      text = body.system
        .filter(b => b.type === 'text' && b.text)
        .map(b => b.text)
        .join('\n')
    } else {
      return { sessionId: null, sessionLabel: null, sessionPath: null }
    }

    const cchMatch = text.match(/cch=([a-zA-Z0-9]+)/)
    const sessionId = cchMatch ? cchMatch[1] : null

    const dirMatch = text.match(/Primary working directory:\s*(.+)/)
    let sessionLabel = null
    let sessionPath = null
    if (dirMatch) {
      sessionPath = dirMatch[1].trim()
      const parts = sessionPath.split('/')
      sessionLabel = parts[parts.length - 1] || parts[parts.length - 2] || sessionPath
    }

    return { sessionId, sessionLabel, sessionPath }
  }

  /**
   * Walk body.messages backwards to find the most recent human-authored text.
   */
  function extractLastHumanText(body) {
    if (!body.messages) return null;
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const msg = body.messages[i];
      if (msg.role !== "user") continue;
      if (typeof msg.content === "string") {
        const cleaned = stripInfrastructureTags(msg.content);
        if (cleaned.length > 0) return cleaned.slice(0, 200);
        continue;
      }
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text);
        if (textParts.length === 0) continue;
        const combined = stripInfrastructureTags(textParts.join("\n"));
        if (combined.length > 0) return combined.slice(0, 200);
      }
    }
    return null;
  }

  /**
   * Walk body.messages forwards to find the FIRST human-authored text.
   */
  function extractFirstHumanText(body) {
    if (!body.messages) return null;
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      if (msg.role !== "user") continue;
      if (typeof msg.content === "string") {
        const cleaned = stripInfrastructureTags(msg.content);
        if (cleaned.length > 0) return cleaned.slice(0, 200);
        continue;
      }
      if (Array.isArray(msg.content)) {
        const textParts = msg.content
          .filter((b) => b.type === "text" && b.text)
          .map((b) => b.text);
        if (textParts.length === 0) continue;
        const combined = stripInfrastructureTags(textParts.join("\n"));
        if (combined.length > 0) return combined.slice(0, 200);
      }
    }
    return null;
  }

  /**
   * Assign a group (turn) ID to a request.
   */
  function assignGroup(body) {
    const now = Date.now();
    const msgCount = (body.messages || []).length;
    const model = body.model || "unknown";
    const gap = now - lastRequestTime;
    const sessionHash = getSessionHash(body);
    const currentLastText = extractLastHumanText(body);

    lastRequestTime = now;

    // Time gap: clear all tracked conversations, start fresh
    if (gap > GAP_THRESHOLD || conversationGroups.size === 0) {
      conversationGroups.clear();
      const groupId = groupCounter++;
      conversationGroups.set(sessionHash, {
        groupId,
        lastHumanText: currentLastText,
        lastSeen: now,
        lastStopReason: null,
      });
      if (msgCount > NEW_MAIN_MSG_THRESHOLD) {
        lastMainSessionKey = sessionHash;
      }
      console.log(`  [group] NEW group=${groupId} reason=gap(${gap}ms) model=${model} msgs=${msgCount}`);
      return groupId;
    }

    // Known session: look up by sessionHash
    if (conversationGroups.has(sessionHash)) {
      const conv = conversationGroups.get(sessionHash);
      conv.lastSeen = now;

      const lastTextChanged = currentLastText !== null
        && conv.lastHumanText !== null
        && currentLastText !== conv.lastHumanText;

      if (lastTextChanged) {
        conv.lastHumanText = currentLastText;

        if (conv.lastStopReason === "end_turn") {
          const groupId = groupCounter++;
          conv.groupId = groupId;
          if (msgCount > NEW_MAIN_MSG_THRESHOLD) {
            lastMainSessionKey = sessionHash;
          }
          console.log(`  [group] NEW group=${groupId} reason=new_user_msg model=${model} msgs=${msgCount} prevStop=end_turn`);
          return groupId;
        }

        if (conv.lastStopReason === "tool_use") {
          if (msgCount > NEW_MAIN_MSG_THRESHOLD) {
            lastMainSessionKey = sessionHash;
          }
          console.log(`  [group] SAME group=${conv.groupId} reason=continuation_after_tool_use model=${model} msgs=${msgCount}`);
          return conv.groupId;
        }

        const groupId = groupCounter++;
        conv.groupId = groupId;
        if (msgCount > NEW_MAIN_MSG_THRESHOLD) {
          lastMainSessionKey = sessionHash;
        }
        console.log(`  [group] NEW group=${groupId} reason=new_user_msg model=${model} msgs=${msgCount} prevStop=${conv.lastStopReason || "none"}`);
        return groupId;
      }

      if (currentLastText !== null) conv.lastHumanText = currentLastText;
      if (msgCount > NEW_MAIN_MSG_THRESHOLD) {
        lastMainSessionKey = sessionHash;
      }
      console.log(`  [group] SAME group=${conv.groupId} reason=same_conv model=${model} msgs=${msgCount}`);
      return conv.groupId;
    }

    // New sessionHash, high msg count → new main conversation
    if (msgCount > NEW_MAIN_MSG_THRESHOLD) {
      const groupId = groupCounter++;
      conversationGroups.set(sessionHash, {
        groupId,
        lastHumanText: currentLastText,
        lastSeen: now,
        lastStopReason: null,
      });
      lastMainSessionKey = sessionHash;

      // Evict oldest if map too large
      if (conversationGroups.size > MAX_TRACKED_CONVERSATIONS) {
        let oldestKey = null, oldestTime = Infinity;
        for (const [key, val] of conversationGroups) {
          if (val.lastSeen < oldestTime) { oldestTime = val.lastSeen; oldestKey = key; }
        }
        if (oldestKey) conversationGroups.delete(oldestKey);
      }

      console.log(`  [group] NEW group=${groupId} reason=new_conv model=${model} msgs=${msgCount}`);
      return groupId;
    }

    // Subagent: attach to the most recently active MAIN session's group
    if (lastMainSessionKey && conversationGroups.has(lastMainSessionKey)) {
      const parentGroup = conversationGroups.get(lastMainSessionKey).groupId;
      console.log(`  [group] SAME group=${parentGroup} reason=subagent(msgs=${msgCount}) model=${model}`);
      return parentGroup;
    }

    // Fallback: no tracked main session yet
    const latest = [...conversationGroups.values()].sort((a, b) => b.lastSeen - a.lastSeen)[0];
    const fallbackGroup = latest ? latest.groupId : groupCounter++;
    console.log(`  [group] SAME group=${fallbackGroup} reason=subagent_fallback(msgs=${msgCount}) model=${model}`);
    return fallbackGroup;
  }

  // ─── Request analysis ──────────────────────────────────────────────────────

  let reqCounter = 0;

  function analyzeRequest(body) {
    const segments = [];
    const fullContents = [];

    // System prompt
    if (body.system) {
      const text = typeof body.system === "string" ? body.system : JSON.stringify(body.system, null, 2);
      segments.push({
        type: "system",
        name: "System Prompt",
        tokens: estimateTokens(text),
        charLength: text.length,
        preview: text.slice(0, 200),
      });
      fullContents.push(text);
    }

    // Tools — one aggregate segment
    if (body.tools && body.tools.length > 0) {
      const toolsJson = JSON.stringify(body.tools);
      const toolsSummary = body.tools.map((t) => t.name).join(", ");

      const toolsFormatted = JSON.stringify(body.tools, null, 2);
      segments.push({
        type: "tools",
        name: `Tools (${body.tools.length})`,
        tokens: estimateTokens(toolsJson),
        charLength: toolsFormatted.length,
        count: body.tools.length,
        toolNames: body.tools.map((t) => t.name),
        preview: toolsSummary.slice(0, 200),
      });
      fullContents.push(toolsFormatted);
    }

    // Messages + extract tools used
    const toolsUsed = new Set();
    if (body.messages) {
      for (let i = 0; i < body.messages.length; i++) {
        const msg = body.messages[i];
        const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block && block.type === "tool_use" && block.name) {
              toolsUsed.add(block.name);
            }
          }
        }

        const isToolResult =
          Array.isArray(msg.content) && msg.content.some((c) => c.type === "tool_result");
        const isToolUse =
          Array.isArray(msg.content) && msg.content.some((c) => c.type === "tool_use");

        let type = "message";
        let name = `${msg.role} message`;
        if (isToolResult) { type = "tool_result"; name = "Tool Result"; }
        else if (isToolUse) { type = "tool_use"; name = "Tool Use (assistant)"; }

        let fullContent = content;
        try {
          const parsed = JSON.parse(content);
          fullContent = JSON.stringify(parsed, null, 2);
        } catch (e) { /* not JSON, keep as-is */ }

        segments.push({
          type,
          role: msg.role,
          name,
          tokens: estimateTokens(content),
          charLength: content.length,
          preview: content.slice(0, 200),
          index: i,
        });
        fullContents.push(fullContent);
      }
    }

    const reqId = reqCounter++;
    const model = body.model || "unknown";
    const sessionHash = getSessionHash(body);
    const groupId = assignGroup(body);
    const { sessionId, sessionLabel, sessionPath } = extractSessionInfo(body);

    const toolsSeg = segments.find((s) => s.type === "tools");
    const userMessages = (body.messages || [])
      .filter((m) => m.role === "user")
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          const textParts = m.content
            .filter((block) => block.type === "text" && block.text)
            .map((block) => block.text);
          return textParts.join("\n");
        }
        return "";
      })
      .filter((text) => text.length > 0)
      .map((text) => stripInfrastructureTags(text))
      .filter((text) => text.length > 0)
      .map((text) => text.slice(0, 500))
      .slice(-3);

    // Store full content + model + telemetry fields server-side
    reqStore.set(reqId, {
      fullContents,
      model,
      sessionHash,
      groupId,
      stream: !!body.stream,
      toolNames: toolsSeg?.toolNames || [],
      toolCount: toolsSeg?.count || 0,
      estimatedToolTokens: toolsSeg?.tokens || 0,
      userMessages,
      sessionId,
      sessionLabel,
      sessionPath,
    });

    // Evict old requests if over limit
    if (reqStore.size > MAX_STORED_REQS) {
      const oldest = reqStore.keys().next().value;
      reqStore.delete(oldest);
    }

    // Calculate estimated cost
    const totalEstimatedTokens = segments.reduce((s, seg) => s + seg.tokens, 0);
    const estimatedCost = calculateCost(totalEstimatedTokens, 0, model);

    return {
      turn: reqId,
      model,
      budget: inferBudget(model, totalEstimatedTokens),
      maxTokens: body.max_tokens,
      stream: !!body.stream,
      segments,
      totalEstimatedTokens,
      estimatedCost,
      timestamp: Date.now(),
      messageCount: (body.messages || []).length,
      toolsUsed: [...toolsUsed],
      groupId,
      sessionHash,
      sessionId,
      sessionLabel,
      sessionPath,
    };
  }

  // ─── HTTP Server ───────────────────────────────────────────────────────────

  const server = http.createServer((req, res) => {
    // ── CORS preflight ──
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // ── Let plugins handle custom routes first ──
    const pluginHelpers = { jsonResponse, readBody, broadcast };
    if (pluginHost.onRoute(req, res, pluginHelpers)) return;

    // ── Serve Inspector UI (static files from public/) ──
    if (req.method === "GET") {
      const MIME_TYPES = {
        ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
        ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
        ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
      };

      if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        fs.createReadStream(path.join(__dirname, "public", "index.html")).pipe(res);
        return;
      }

      // Serve other static files from public/ (JS, CSS, assets)
      const urlPath = req.url.split("?")[0];
      if (urlPath.startsWith("/assets/") || urlPath.endsWith(".js") || urlPath.endsWith(".css") || urlPath.endsWith(".svg") || urlPath.endsWith(".ico") || urlPath.endsWith(".png")) {
        const filePath = path.join(__dirname, "public", urlPath);
        const safePath = path.resolve(filePath);
        if (!safePath.startsWith(path.join(__dirname, "public"))) {
          res.writeHead(403); res.end("Forbidden"); return;
        }
        if (fs.existsSync(safePath)) {
          const ext = path.extname(safePath);
          res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
          fs.createReadStream(safePath).pipe(res);
          return;
        }
      }

      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", requests: reqCounter, clients: wsClients.size }));
        return;
      }

      // ── API: Fetch full content for a segment ──
      const contentMatch = req.url.match(/^\/api\/content\/(\d+)\/(\d+)$/);
      if (contentMatch) {
        const reqId = parseInt(contentMatch[1]);
        const segIndex = parseInt(contentMatch[2]);
        const stored = reqStore.get(reqId);

        if (!stored || segIndex >= stored.fullContents.length) {
          jsonResponse(res, 200, { error: "Not found", content: null });
        } else {
          jsonResponse(res, 200, {
            content: stored.fullContents[segIndex],
            charLength: stored.fullContents[segIndex].length,
          });
        }
        return;
      }

      // ── API: Search across all requests ──
      const searchMatch = req.url.match(/^\/api\/search\?q=(.+)$/);
      if (searchMatch) {
        const query = decodeURIComponent(searchMatch[1]).toLowerCase();
        const results = [];
        for (const [reqId, stored] of reqStore) {
          for (let i = 0; i < stored.fullContents.length; i++) {
            const content = stored.fullContents[i].toLowerCase();
            const idx = content.indexOf(query);
            if (idx !== -1) {
              const start = Math.max(0, idx - 60);
              const end = Math.min(content.length, idx + query.length + 60);
              results.push({
                turnId: reqId,
                segIndex: i,
                snippet: stored.fullContents[i].slice(start, end),
              });
            }
          }
        }
        jsonResponse(res, 200, { results });
        return;
      }

      // ── API: List profiles ──
      if (req.url === "/api/profiles") {
        jsonResponse(res, 200, { profiles, active: activeProfile });
        return;
      }

      // ── API: Get active profile ──
      if (req.url === "/api/active-profile") {
        jsonResponse(res, 200, { active: activeProfile, profile: profiles[activeProfile] || null });
        return;
      }

      // ── API: Router config (default — no plugin) ──
      if (req.url === "/api/router/config") {
        jsonResponse(res, 200, {
          schema_version: 1,
          mode: "off",
          premium: false,
          available: false,
          effective_mode: "off",
          locked_reason: "requires_pro",
        });
        return;
      }

      // ── API: Router status (default — no plugin) ──
      if (req.url === "/api/router/status") {
        jsonResponse(res, 200, {
          schema_version: 1,
          premium: false,
          available: false,
          effective_mode: "off",
          locked_reason: "requires_pro",
          mode: "off",
          runtime: null,
          capabilities: null,
          model: null,
          metrics: null,
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
      return;
    }

    // ── API: Profile management (POST / DELETE) ──
    if (req.method === "POST" && req.url === "/api/profiles") {
      readBody(req).then((buf) => {
        try {
          const data = JSON.parse(buf.toString());
          const { name, mode, tools } = data;
          if (!name || name === "All Tools") {
            jsonResponse(res, 400, { error: "Invalid profile name" });
            return;
          }
          profiles[name] = { name, mode: mode || "blocklist", tools: tools || [] };
          saveProfiles();
          broadcast({ type: "profiles_updated", profiles, active: activeProfile });
          jsonResponse(res, 200, { success: true, profile: profiles[name] });
        } catch (err) {
          jsonResponse(res, 400, { error: err.message });
        }
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/active-profile") {
      readBody(req).then((buf) => {
        try {
          const data = JSON.parse(buf.toString());
          if (profiles[data.name]) {
            activeProfile = data.name;
            saveProfiles();
            broadcast({ type: "active_profile_changed", active: activeProfile, profile: profiles[activeProfile] });
            jsonResponse(res, 200, { success: true, active: activeProfile });
          } else {
            jsonResponse(res, 404, { error: "Profile not found" });
          }
        } catch (err) {
          jsonResponse(res, 400, { error: err.message });
        }
      });
      return;
    }

    if (req.method === "DELETE") {
      const deleteMatch = req.url.match(/^\/api\/profiles\/(.+)$/);
      if (deleteMatch) {
        const name = decodeURIComponent(deleteMatch[1]);
        if (name === "All Tools") {
          jsonResponse(res, 400, { error: "Cannot delete default profile" });
          return;
        }
        delete profiles[name];
        if (activeProfile === name) activeProfile = "All Tools";
        saveProfiles();
        broadcast({ type: "profiles_updated", profiles, active: activeProfile });
        jsonResponse(res, 200, { success: true });
        return;
      }
    }

    // ── Proxy API requests to Anthropic ──
    let bodyChunks = [];
    req.on("data", (chunk) => bodyChunks.push(chunk));
    req.on("end", async () => {
      const bodyBuffer = Buffer.concat(bodyChunks);
      const bodyStr = bodyBuffer.toString("utf-8");

      let forwardBuffer = bodyBuffer;
      let filteringInfo = null;
      let requestTurn = null;

      // Analyze + filter if it's a messages endpoint
      if (req.url.includes("/messages")) {
        try {
          const parsed = JSON.parse(bodyStr);

          // Apply tool filtering
          const originalToolCount = (parsed.tools || []).length;
          const { filtered, removed } = applyToolFilter(parsed.tools, activeProfile);

          if (removed.length > 0) {
            parsed.tools = filtered;
            const modifiedStr = JSON.stringify(parsed);
            forwardBuffer = Buffer.from(modifiedStr, "utf-8");
            filteringInfo = {
              originalToolCount,
              filteredToolCount: filtered.length,
              removedTools: removed,
              tokensSaved: estimateTokens(JSON.stringify(removed.map(name =>
                (JSON.parse(bodyStr).tools || []).find(t => t.name === name)
              ).filter(Boolean))),
            };
          }

          // Analyze the FILTERED request (what actually gets sent)
          const analysis = analyzeRequest(parsed);

          // Attach filtering info
          if (filteringInfo) {
            analysis.filteringActive = true;
            analysis.originalToolCount = filteringInfo.originalToolCount;
            analysis.filteredToolCount = filteringInfo.filteredToolCount;
            analysis.removedTools = filteringInfo.removedTools;
            analysis.tokensSaved = filteringInfo.tokensSaved;
          }

          requestTurn = analysis.turn;

          broadcast({ type: "request", ...analysis });
          console.log(
            `[R${analysis.turn}] ${analysis.model} | ${analysis.segments.length} segs | ~${analysis.totalEstimatedTokens} tokens | $${analysis.estimatedCost.totalCost.toFixed(4)}${filteringInfo ? ` | FILTERED: ${filteringInfo.originalToolCount}→${filteringInfo.filteredToolCount} tools (-${filteringInfo.removedTools.length})` : ""}`
          );

          // Let plugins analyze the request (router prediction, etc.)
          await pluginHost.onRequestAnalyzed(analysis, {
            reqStore,
            activeProfile,
            profiles,
            parsedBody: parsed,
            broadcast,
          });

          // Fire count_tokens in parallel for accurate count (non-blocking)
          const apiKey = req.headers["x-api-key"];
          if (apiKey) {
            countTokensViaAPI(parsed, apiKey).then((exactTokens) => {
              if (exactTokens && exactTokens > 0) {
                const scaleFactor = exactTokens / analysis.totalEstimatedTokens;
                const scaledSegments = analysis.segments.map(seg => ({
                  ...seg,
                  tokens: Math.round(seg.tokens * scaleFactor),
                }));
                const exactCost = calculateCost(exactTokens, 0, analysis.model);
                broadcast({
                  type: "token_count_update",
                  turn: analysis.turn,
                  exactInputTokens: exactTokens,
                  scaleFactor: scaleFactor.toFixed(3),
                  segments: scaledSegments,
                  estimatedCost: exactCost,
                });
                console.log(
                  `  → count_tokens: ${exactTokens.toLocaleString()} exact (was ~${analysis.totalEstimatedTokens.toLocaleString()}, scale ${scaleFactor.toFixed(2)}x)`
                );
              }
            });
          }
        } catch (e) {
          console.error("Failed to parse request body:", e.message);
        }
      }

      // Forward to Anthropic
      const fwdHeaders = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (key === "host" || key === "connection" || key === "accept-encoding") continue;
        fwdHeaders[key] = value;
      }
      fwdHeaders["host"] = ANTHROPIC_HOST;
      fwdHeaders["content-length"] = forwardBuffer.length;

      const proxyReq = https.request(
        {
          hostname: ANTHROPIC_HOST,
          port: 443,
          path: req.url,
          method: req.method,
          headers: fwdHeaders,
        },
        (proxyRes) => {
          const resHeaders = {};
          for (const [key, value] of Object.entries(proxyRes.headers)) {
            resHeaders[key] = value;
          }
          res.writeHead(proxyRes.statusCode, resHeaders);

          let responseData = "";
          proxyRes.on("data", (chunk) => {
            res.write(chunk);
            responseData += chunk.toString();
          });
          proxyRes.on("end", () => {
            res.end();

            if (req.url.includes("/messages")) {
              const parsed = parseStreamedResponse(responseData);
              let { inputTokens: actualInput, outputTokens: actualOutput, cacheCreationTokens, cacheReadTokens, stopReason, toolsUsed } = parsed;

              if (!actualInput) {
                try {
                  const jsonRes = JSON.parse(responseData);
                  const u = jsonRes.usage || {};
                  const nonCached = u.input_tokens || 0;
                  cacheCreationTokens = u.cache_creation_input_tokens || 0;
                  cacheReadTokens = u.cache_read_input_tokens || 0;
                  actualInput = nonCached + cacheCreationTokens + cacheReadTokens;
                  actualOutput = u.output_tokens || 0;
                  if (Array.isArray(jsonRes.content)) {
                    for (const block of jsonRes.content) {
                      if (block.type === "tool_use" && block.name) {
                        toolsUsed.push(block.name);
                      }
                    }
                  }
                } catch (e) { /* streaming response, already parsed above */ }
              }

              // Correlate response to originating request
              const reqId = requestTurn ?? reqCounter - 1;
              const stored = reqStore.get(reqId);
              if (stored) stored.toolsUsed = toolsUsed;
              const model = stored?.model || "unknown";
              const cost = (actualInput || actualOutput)
                ? calculateCost(actualInput, actualOutput, model, cacheCreationTokens, cacheReadTokens)
                : null;

              if (actualInput || actualOutput) {
                broadcast({
                  type: "response_complete",
                  turn: reqId,
                  usage: {
                    input_tokens: actualInput,
                    output_tokens: actualOutput,
                    cache_creation_input_tokens: cacheCreationTokens || 0,
                    cache_read_input_tokens: cacheReadTokens || 0,
                  },
                  cost,
                  stopReason,
                  toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
                  timestamp: Date.now(),
                });
                const cacheInfo = (cacheCreationTokens || cacheReadTokens)
                  ? ` (cache: ${cacheReadTokens} read, ${cacheCreationTokens} created)`
                  : "";
                const toolsInfo = toolsUsed.length > 0 ? ` | tools: ${toolsUsed.join(", ")}` : "";
                console.log(
                  `  → [R${reqId}] Response: ${actualInput} in / ${actualOutput} out [${stopReason}] | $${cost.totalCost.toFixed(4)}${cacheInfo}${toolsInfo}`
                );
              }

              // Update per-session stop reason for turn-boundary detection
              if (stored?.sessionHash && conversationGroups.has(stored.sessionHash)) {
                conversationGroups.get(stored.sessionHash).lastStopReason = stopReason;
              }

              // Let plugins handle response completion (eval logging, etc.)
              pluginHost.onResponseComplete(reqId, {
                stored,
                activeProfile,
                profiles,
                stopReason,
                actualInput,
                actualOutput,
                cost,
                toolsUsed,
              });
            }
          });
        }
      );

      proxyReq.on("error", (err) => {
        console.error("Proxy error:", err.message);
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Proxy error", message: err.message }));
      });

      proxyReq.write(forwardBuffer);
      proxyReq.end();
    });
  });

  // ─── WebSocket Server ──────────────────────────────────────────────────────

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log(`Inspector connected (${wsClients.size} clients)`);
    ws.send(JSON.stringify({
      type: "connected",
      requests: reqCounter,
      profiles,
      activeProfile,
      premium: false,
      routerMode: "off",
      ...pluginHost.getConnectPayload(),
    }));

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "set_active_profile") {
          if (profiles[msg.profile]) {
            activeProfile = msg.profile;
            saveProfiles();
            broadcast({ type: "active_profile_changed", active: activeProfile, profile: profiles[activeProfile] });
            console.log(`  Profile changed → ${activeProfile}`);
          }
        }
      } catch (err) {
        console.error("Failed to parse WS message:", err.message);
      }
    });

    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(`Inspector disconnected (${wsClients.size} clients)`);
    });
  });

  // ─── Return server control object ──────────────────────────────────────────

  return {
    server,
    wss,
    broadcast,
    pluginHost,

    async start() {
      // Run plugin init (load config, init data dirs, etc.)
      await pluginHost.onInit({ broadcast });

      return new Promise((resolve) => {
        server.listen(PORT, async () => {
          console.log("");
          console.log("  ┌─────────────────────────────────────────────┐");
          console.log("  │            Jannal — Inspector Proxy           │");
          console.log("  └─────────────────────────────────────────────┘");
          console.log("");
          console.log(`  Inspector UI:  http://localhost:${PORT}`);
          console.log(`  Proxy target:  https://${ANTHROPIC_HOST}`);
          console.log(`  Active profile: ${activeProfile}`);
          console.log(`  Profiles loaded: ${Object.keys(profiles).length}`);
          console.log("");
          console.log("  To use with Claude Code:");
          console.log(`  ANTHROPIC_BASE_URL=http://localhost:${PORT} claude`);
          console.log("");

          // Run plugin server-start hooks (warm up models, etc.)
          await pluginHost.onServerStart({ broadcast });

          console.log("");
          console.log("  Waiting for requests...");
          console.log("");

          resolve({ server, port: PORT });
        });
      });
    },
  };
}

// ─── Direct execution: core-only mode ────────────────────────────────────────

if (require.main === module) {
  createServer().start();
}

module.exports = { createServer };
