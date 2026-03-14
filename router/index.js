// ─── Router Entry Point ───────────────────────────────────────────────────────
//
// Main routeRequest() orchestrator. Merges keyword rules + embeddings signals,
// manages sticky routes, enforces latency budget. Runs in shadow mode: predicts
// which groups are needed but does NOT filter the forwarded tool set.

const { getConfig, getState } = require("./log");
const { getAvailableGroups, getToolGroup, groupTools } = require("./grouping");
const { getCatalogEntry, CATALOG } = require("./catalog");
const { matchRules } = require("./rules");
const {
  initEmbeddings,
  isEmbeddingsReady,
  getEmbeddingsStatus,
  rankGroups,
  MODEL_NAME,
  CACHE_DIR,
} = require("./embeddings");

// ─── Sticky route cache ───────────────────────────────────────────────────────

const stickyRoutes = new Map();

function getStickyRoute(sessionHash, ttlMs) {
  const entry = stickyRoutes.get(sessionHash);
  if (!entry) return null;
  if (Date.now() - entry.updated_at > ttlMs) {
    stickyRoutes.delete(sessionHash);
    return null;
  }
  return entry;
}

function setStickyRoute(sessionHash, data) {
  stickyRoutes.set(sessionHash, {
    ...data,
    updated_at: Date.now(),
  });
}

// ─── Intent message selection ─────────────────────────────────────────────────
//
// Picks the best message from userMessages for routing intent detection.
// Skips compact/session continuation boilerplate that carries no tool intent.

const BOILERPLATE_PREFIXES = [
  "This session is being continued from a previous conversation",
  "Summary:",
  "The following is a summary of the conversation",
];

/**
 * Select the most useful user message for intent routing.
 * Scans backwards (most recent first), skipping boilerplate messages.
 *
 * @param {string[]} userMessages - Recent user messages (already tag-stripped)
 * @returns {string} Best message for routing, or "" if none found
 */
function selectIntentMessage(userMessages) {
  if (!userMessages || userMessages.length === 0) return "";

  for (let i = userMessages.length - 1; i >= 0; i--) {
    const msg = userMessages[i];
    if (!msg || msg.trim().length < 5) continue;

    // Skip compact/session continuation boilerplate
    const isBoilerplate = BOILERPLATE_PREFIXES.some((p) => msg.startsWith(p));
    if (isBoilerplate) continue;

    return msg;
  }

  // All messages were boilerplate — no intent signal
  return "";
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function initRouter() {
  console.log("  [router] Initializing...");
  const config = getConfig();
  console.log(`  [router] Mode: ${config.mode}`);

  // Fire-and-forget embedding model load
  initEmbeddings().catch((err) => {
    console.error("  [router] Embeddings init failed:", err.message);
  });
}

// ─── Route request ────────────────────────────────────────────────────────────

/**
 * Main routing algorithm. Predicts which server groups are needed.
 *
 * @param {Object} metadata
 * @param {Object|null} metadata.stored - reqStore entry for this request
 * @param {string} metadata.activeProfile - current profile name
 * @param {string[]} metadata.allToolNames - all tool names from the request
 * @returns {Object} Router result
 */
async function routeRequest(metadata) {
  const config = getConfig();
  const { stored, allToolNames } = metadata;

  // 1. Check mode
  if (config.mode === "off") {
    return buildSkipResult(config.mode, "router_off");
  }

  // 2. Check stored data
  if (!stored) {
    return buildSkipResult(config.mode, "no_request_data");
  }

  // 3. Get candidate groups
  const toolNames = allToolNames || stored.toolNames || [];
  const groupMap = groupTools(toolNames);
  const availableGroups = getAvailableGroups(toolNames);

  // Separate catalog-backed groups from unknown MCP groups
  const catalogGroups = [];
  const unknownGroups = [];
  for (const group of availableGroups) {
    if (group === "core") continue;
    if (getCatalogEntry(group)) {
      catalogGroups.push(group);
    } else if (group !== "other") {
      unknownGroups.push(group);
    } else {
      // "other" group — treat as unknown (always retain)
      unknownGroups.push(group);
    }
  }

  // 4. Check thresholds
  const toolCount = stored.toolCount || toolNames.length;
  const estimatedToolTokens = stored.estimatedToolTokens || 0;

  if (toolCount < config.min_tool_count) {
    return buildSkipResult(config.mode, "below_threshold", {
      detail: `tool_count ${toolCount} < ${config.min_tool_count}`,
    });
  }
  if (estimatedToolTokens < config.min_tool_tokens) {
    return buildSkipResult(config.mode, "below_threshold", {
      detail: `tool_tokens ${estimatedToolTokens} < ${config.min_tool_tokens}`,
    });
  }

  // 5. Check sticky route
  const sessionHash = stored.sessionHash || "unknown";
  const sticky = getStickyRoute(sessionHash, config.sticky_ttl_ms);
  if (sticky && sticky.confidence >= config.sticky_confidence_threshold) {
    return {
      mode: config.mode,
      eligible: true,
      skip_reason: null,
      matched_by: sticky.matched_by,
      confidence: sticky.confidence,
      selected_groups: sticky.selected_groups,
      selected_tools: null,
      stripped_groups: sticky.stripped_groups,
      stripped_tools: null,
      selected_tool_count: sticky.selected_tool_count,
      stripped_tool_count: sticky.stripped_tool_count,
      estimated_tokens_saved: sticky.estimated_tokens_saved,
      reason: sticky.reason + " (sticky)",
      sticky_reused: true,
    };
  }

  // 6. Run matchers — use intent-selected message, not blind last message
  const userMessages = stored.userMessages || [];
  const intentMsg = selectIntentMessage(userMessages);

  const rulesResult = matchRules(intentMsg, catalogGroups);
  const embeddingsResult = isEmbeddingsReady()
    ? await rankGroups(intentMsg, catalogGroups)
    : null;

  // 7. Merge signals
  let matchedBy;
  let mergedGroups;
  let confidence;
  let reason;

  if (rulesResult && embeddingsResult) {
    // Both signals present — use intersection (agreement), not union.
    // Union lets a false positive from either signal survive; intersection
    // requires both to agree, improving precision.
    const intersection = rulesResult.groups.filter((g) => embeddingsResult.groups.includes(g));
    if (intersection.length > 0) {
      matchedBy = "hybrid";
      mergedGroups = intersection;
      confidence = Math.max(rulesResult.confidence, embeddingsResult.confidence);
      reason = `${rulesResult.reason} + embeddings (agreed)`;
    } else {
      // No agreement — fall back to rules only (higher precision than embeddings)
      matchedBy = "rules";
      mergedGroups = rulesResult.groups;
      confidence = rulesResult.confidence;
      reason = `${rulesResult.reason} (embeddings disagreed)`;
    }
  } else if (rulesResult) {
    matchedBy = "rules";
    mergedGroups = rulesResult.groups;
    confidence = rulesResult.confidence;
    reason = rulesResult.reason;
  } else if (embeddingsResult) {
    matchedBy = "embeddings";
    mergedGroups = embeddingsResult.groups;
    confidence = embeddingsResult.confidence;
    reason = "Embedding similarity";
  } else {
    // Neither matched — exclude strip-eligible specialized groups by default.
    // Core, unknown MCP, and non-strip-eligible catalog groups are always retained.
    matchedBy = "default_core_only";
    mergedGroups = []; // no specialized groups opted-in
    confidence = 0;
    reason = "No specialized signal — strip-eligible groups excluded";
  }

  // 8. Build selected_groups
  const selectedGroups = new Set(mergedGroups);

  // Always add all unknown MCP groups (no basis to exclude them)
  for (const g of unknownGroups) {
    selectedGroups.add(g);
  }

  // Always add core
  selectedGroups.add("core");

  const selectedGroupsArr = [...selectedGroups];

  // 9. Compute stripped groups — only strip-eligible catalog groups not selected
  const strippedGroups = catalogGroups.filter((g) => {
    if (selectedGroups.has(g)) return false;
    // Only strip groups explicitly marked as strip-eligible in the catalog
    const entry = getCatalogEntry(g);
    return entry && entry.stripEligible === true;
  });

  // 10. Compute tool counts and token savings
  let strippedToolCount = 0;
  let estimatedTokensSaved = 0;
  let selectedToolCount = 0;

  for (const [group, tools] of groupMap) {
    if (strippedGroups.includes(group)) {
      strippedToolCount += tools.length;
      // Rough token estimate per tool (~100 tokens average for tool definition)
      estimatedTokensSaved += tools.length * 100;
    } else {
      selectedToolCount += tools.length;
    }
  }

  // 11. Cache sticky route if confidence meets threshold
  if (confidence >= config.sticky_confidence_threshold) {
    setStickyRoute(sessionHash, {
      selected_groups: selectedGroupsArr,
      stripped_groups: strippedGroups,
      matched_by: matchedBy,
      confidence,
      reason,
      selected_tool_count: selectedToolCount,
      stripped_tool_count: strippedToolCount,
      estimated_tokens_saved: estimatedTokensSaved,
    });
  }

  // 12. Return result
  return {
    mode: config.mode,
    eligible: true,
    skip_reason: null,
    matched_by: matchedBy,
    confidence,
    selected_groups: selectedGroupsArr,
    selected_tools: null,
    stripped_groups: strippedGroups,
    stripped_tools: null,
    selected_tool_count: selectedToolCount,
    stripped_tool_count: strippedToolCount,
    estimated_tokens_saved: estimatedTokensSaved,
    reason,
    sticky_reused: false,
    intent_message: intentMsg.slice(0, 200), // what the router matched against
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildSkipResult(mode, skipReason, extra = {}) {
  return {
    mode,
    eligible: false,
    skip_reason: skipReason,
    matched_by: null,
    confidence: null,
    selected_groups: null,
    selected_tools: null,
    stripped_groups: [],
    stripped_tools: null,
    selected_tool_count: null,
    stripped_tool_count: 0,
    estimated_tokens_saved: 0,
    reason: extra.detail || skipReason,
    sticky_reused: false,
  };
}

// ─── Status ───────────────────────────────────────────────────────────────────

function getRouterStatus() {
  const config = getConfig();
  const embStatus = getEmbeddingsStatus();

  return {
    mode: config.mode,
    runtime: {
      embeddings_ready: embStatus.ready,
      embeddings_failed: embStatus.failed,
      rules_ready: true,
      sticky_route_count: stickyRoutes.size,
      last_error: embStatus.error,
      last_error_at: null,
      last_metrics_refresh_at: getState()?.runtime?.last_metrics_refresh_at ?? null,
    },
    capabilities: {
      can_route: config.mode !== "off",
      can_auto_filter: false, // Step 4: will be config.mode === "auto" once filtering is implemented
      shadow_active: config.mode === "shadow" || config.mode === "auto", // auto behaves as shadow until Step 4
    },
    model: {
      name: MODEL_NAME,
      cache_dir: CACHE_DIR,
    },
  };
}

function getRouterConfig() {
  const config = getConfig();
  return {
    schema_version: 1,
    mode: config.mode,
    min_tool_count: config.min_tool_count,
    min_tool_tokens: config.min_tool_tokens,
    auto_confidence_threshold: config.auto_confidence_threshold,
    sticky_confidence_threshold: config.sticky_confidence_threshold,
    sticky_ttl_ms: config.sticky_ttl_ms,
    core_tools: config.core_tools,
    embedding: {
      model: MODEL_NAME,
      cache_dir: CACHE_DIR,
    },
  };
}

module.exports = { initRouter, routeRequest, getRouterStatus, getRouterConfig, selectIntentMessage };
