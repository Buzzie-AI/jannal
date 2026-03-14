const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getAvailableGroups, getToolGroup, setCoreTools } = require("./grouping");

// ─── Paths ───────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(__dirname, "..", "data");
const EVALS_FILE = path.join(DATA_DIR, "router-evals.ndjson");
const ERRORS_FILE = path.join(DATA_DIR, "router-errors.ndjson");
const STATE_FILE = path.join(DATA_DIR, "router-state.json");
const METRICS_FILE = path.join(DATA_DIR, "router-metrics.json");

const MAX_EVALS_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_ROTATED_FILES = 10;
const METRICS_INTERVAL = 20; // recompute every N eval events

// ─── In-memory state ─────────────────────────────────────────────────────────

let evalsSinceMetrics = 0;
let routerState = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateEventId() {
  return "evt_" + crypto.randomBytes(12).toString("hex");
}

function generateErrorId() {
  return "err_" + crypto.randomBytes(12).toString("hex");
}

function simpleHash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
  }
  return hash.toString(36);
}

function computeToolsetHash(toolNames) {
  if (!toolNames || toolNames.length === 0) return "toolset_empty";
  return "toolset_" + simpleHash([...toolNames].sort().join(","));
}

function atomicWriteJson(filePath, obj) {
  const tmp = filePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, filePath);
}

function appendNdjson(filePath, obj) {
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n");
}

// ─── Init ────────────────────────────────────────────────────────────────────

function initDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  loadState();
  console.log(`  Router telemetry: ${DATA_DIR}`);
}

// ─── State management ────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  schema_version: 1,
  updated_at: null,
  config: {
    mode: "off",
    min_tool_count: 20,
    min_tool_tokens: 5000,
    auto_confidence_threshold: 0.9,
    sticky_confidence_threshold: 0.92,
    sticky_ttl_ms: 1800000,
    core_tools: ["Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep"],
    max_last_user_message_chars: 500,
    max_recent_user_messages: 3,
  },
  runtime: {
    events_written: 0,
    errors_written: 0,
    last_event_id: null,
    last_rotation_at: null,
  },
  // Note: sticky routes are in-memory only (router/index.js).
  // Durable persistence deferred to Step 4.
};

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      routerState = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
      // Clean up legacy sticky_routes from durable state (now in-memory only)
      if (routerState.sticky_routes) {
        delete routerState.sticky_routes;
        atomicWriteJson(STATE_FILE, routerState);
      }
    } else {
      routerState = { ...DEFAULT_STATE, updated_at: new Date().toISOString() };
      atomicWriteJson(STATE_FILE, routerState);
    }
  } catch (err) {
    console.error("  [router] Failed to load state:", err.message);
    routerState = { ...DEFAULT_STATE, updated_at: new Date().toISOString() };
  }
  // Sync core tools to grouping module so all classification uses one source
  setCoreTools(routerState.config.core_tools || DEFAULT_STATE.config.core_tools);
}

function saveState() {
  try {
    routerState.updated_at = new Date().toISOString();
    atomicWriteJson(STATE_FILE, routerState);
  } catch (err) {
    console.error("  [router] Failed to save state:", err.message);
  }
}

function getConfig() {
  return routerState?.config || DEFAULT_STATE.config;
}

// ─── Log rotation ────────────────────────────────────────────────────────────

function rotateIfNeeded(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (stat.size < MAX_EVALS_SIZE) return;

    const date = new Date().toISOString().slice(0, 10);
    const ext = path.extname(filePath);
    const base = filePath.slice(0, -ext.length);
    const rotated = `${base}.${date}${ext}`;

    // If same-day rotation already exists, add a counter
    let target = rotated;
    let counter = 1;
    while (fs.existsSync(target)) {
      target = `${base}.${date}-${counter}${ext}`;
      counter++;
    }

    fs.renameSync(filePath, target);

    if (routerState) {
      routerState.runtime.last_rotation_at = new Date().toISOString();
      saveState();
    }

    // Clean up old rotations
    const dir = path.dirname(filePath);
    const baseName = path.basename(base);
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith(baseName + ".") && f !== path.basename(filePath))
      .sort()
      .reverse();

    for (let i = MAX_ROTATED_FILES; i < files.length; i++) {
      fs.unlinkSync(path.join(dir, files[i]));
    }
  } catch (err) {
    console.error("  [router] Rotation error:", err.message);
    emitErrorEvent({
      stage: "metrics_write",
      message: "Log rotation failed: " + err.message,
    });
  }
}

// ─── Event emission ──────────────────────────────────────────────────────────

function emitEvalEvent(event) {
  try {
    rotateIfNeeded(EVALS_FILE);
    appendNdjson(EVALS_FILE, event);

    if (routerState) {
      routerState.runtime.events_written++;
      routerState.runtime.last_event_id = event.event_id;
    }

    evalsSinceMetrics++;
    if (evalsSinceMetrics >= METRICS_INTERVAL) {
      evalsSinceMetrics = 0;
      recomputeMetrics();
      saveState();
    }
  } catch (err) {
    console.error("  [router] Failed to write eval event:", err.message);
    emitErrorEvent({
      turn: event?.request?.turn,
      groupId: event?.request?.group_id,
      sessionHash: event?.request?.session_hash,
      stage: "metrics_write",
      message: "Failed to write eval event: " + err.message,
      details: { event_id: event?.event_id },
    });
  }
}

function emitErrorEvent({ turn, groupId, sessionHash, stage, message, details }) {
  try {
    const event = {
      schema_version: 1,
      event_type: "router_error_v1",
      event_id: generateErrorId(),
      timestamp: new Date().toISOString(),
      request: {
        turn: turn ?? null,
        group_id: groupId ?? null,
        session_hash: sessionHash ?? null,
      },
      stage,
      severity: "error",
      message,
      details: details || {},
    };
    appendNdjson(ERRORS_FILE, event);

    if (routerState) {
      routerState.runtime.errors_written++;
    }
  } catch (err) {
    console.error("  [router] Failed to write error event:", err.message);
  }
}

// ─── Event builder ───────────────────────────────────────────────────────────

let appVersion = null;

function getAppVersion() {
  if (appVersion) return appVersion;
  try {
    appVersion = require("../package.json").version;
  } catch {
    appVersion = "unknown";
  }
  return appVersion;
}

function buildEvalEvent(reqMeta, routerResult, responseResult) {
  const stored = reqMeta.stored;
  const toolNames = stored?.toolNames || [];
  const config = getConfig();
  const coreTools = config.core_tools;
  const coreCount = toolNames.filter((n) => coreTools.includes(n)).length;
  const userMessages = stored?.userMessages || [];
  const lastMsg = userMessages[userMessages.length - 1] || "";

  return {
    schema_version: 1,
    event_type: "router_eval_v1",
    event_id: generateEventId(),
    timestamp: new Date().toISOString(),
    app: { name: "jannal", version: getAppVersion() },
    request: {
      turn: reqMeta.reqId,
      group_id: stored?.groupId ?? null,
      session_hash: stored?.sessionHash ?? "unknown",
      model: stored?.model ?? "unknown",
      stream: stored?.stream ?? true,
      anthropic_path: "/v1/messages",
    },
    user_context: {
      last_user_message: lastMsg.slice(0, config.max_last_user_message_chars),
      last_user_message_truncated: lastMsg.length > config.max_last_user_message_chars,
      last_user_message_chars: Math.min(lastMsg.length, config.max_last_user_message_chars),
      recent_user_messages: userMessages
        .slice(-(config.max_recent_user_messages))
        .map((m) => m.slice(0, 300)),
    },
    tool_inventory: {
      tool_count_total: stored?.toolCount ?? 0,
      tool_count_core: coreCount,
      tool_count_noncore: (stored?.toolCount ?? 0) - coreCount,
      estimated_tool_tokens_total: stored?.estimatedToolTokens ?? 0,
      available_groups: getAvailableGroups(toolNames),
      toolset_hash: computeToolsetHash(toolNames),
      available_tools_sample: toolNames.slice(0, 10),
    },
    manual_filter: {
      active_profile: reqMeta.activeProfile || "All Tools",
      profile_mode: reqMeta.profiles?.[reqMeta.activeProfile]?.mode ?? null,
      profile_tools: reqMeta.profiles?.[reqMeta.activeProfile]?.tools ?? [],
      filtered_tool_count: stored?.toolCount ?? 0,
    },
    router: {
      mode: routerResult.mode || "off",
      eligible: routerResult.eligible || false,
      skip_reason: routerResult.skip_reason ?? null,
      matched_by: routerResult.matched_by || null,
      confidence: routerResult.confidence ?? null,
      selected_groups: routerResult.selected_groups || null,
      selected_tools: routerResult.selected_tools || null,
      stripped_groups: routerResult.stripped_groups || [],
      stripped_tools: routerResult.stripped_tools || null,
      selected_tool_count: routerResult.selected_tool_count ?? null,
      stripped_tool_count: routerResult.stripped_tool_count ?? 0,
      estimated_tokens_saved: routerResult.estimated_tokens_saved ?? 0,
      reason: routerResult.reason || null,
      sticky_reused: routerResult.sticky_reused || false,
    },
    response: {
      stop_reason: responseResult.stopReason,
      input_tokens: responseResult.actualInput || 0,
      output_tokens: responseResult.actualOutput || 0,
      cost_usd_total: responseResult.cost?.totalCost ?? 0,
      tool_use_names: responseResult.toolsUsed || [],
      tool_use_groups: [...new Set((responseResult.toolsUsed || []).map(getToolGroup))],
      tool_use_count: (responseResult.toolsUsed || []).length,
    },
    evaluation: computeEvaluation(routerResult, responseResult.toolsUsed),
  };
}

/**
 * Compute the evaluation section of an eval event.
 * Determines would_have_missed by checking if any tools used belong to stripped groups.
 */
function computeEvaluation(routerResult, toolsUsed) {
  const eligible = routerResult.eligible || false;
  const strippedGroups = routerResult.stripped_groups || [];
  const selectedGroups = routerResult.selected_groups || [];

  // Default: no evaluation data when router didn't make a prediction
  if (!eligible || !routerResult.matched_by || routerResult.matched_by === "fallback_all") {
    return {
      would_have_missed: false,
      missed_tools: [],
      missed_groups: [],
      precision_groups: null,
      recall_groups: null,
      selected_group_count: selectedGroups.filter((g) => g !== "core").length,
      used_group_count: 0,
    };
  }

  // Find tools that were used AND belong to stripped groups
  const missedTools = (toolsUsed || []).filter((name) => {
    const group = getToolGroup(name);
    return group !== "core" && strippedGroups.includes(group);
  });
  const missedGroups = [...new Set(missedTools.map(getToolGroup))];

  // Compute precision/recall for groups
  const usedGroups = [...new Set(
    (toolsUsed || []).map(getToolGroup).filter((g) => g !== "core")
  )];
  const selectedNonCore = selectedGroups.filter((g) => g !== "core");

  // Precision: of the groups we selected, how many were actually used?
  const truePositives = selectedNonCore.filter((g) => usedGroups.includes(g)).length;
  const precision = selectedNonCore.length > 0
    ? parseFloat((truePositives / selectedNonCore.length).toFixed(3))
    : null;

  // Recall: of the groups actually used, how many did we select?
  const recall = usedGroups.length > 0
    ? parseFloat((truePositives / usedGroups.length).toFixed(3))
    : null;

  return {
    would_have_missed: missedTools.length > 0,
    missed_tools: missedTools,
    missed_groups: missedGroups,
    precision_groups: precision,
    recall_groups: recall,
    selected_group_count: selectedNonCore.length,
    used_group_count: usedGroups.length,
  };
}

// ─── Metrics rollup ──────────────────────────────────────────────────────────

function recomputeMetrics() {
  try {
    if (!fs.existsSync(EVALS_FILE)) return;

    const content = fs.readFileSync(EVALS_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Use last 500 lines for summary
    const recent = lines.slice(-500);
    const events = [];
    for (const line of recent) {
      try {
        events.push(JSON.parse(line));
      } catch { /* skip malformed */ }
    }

    if (events.length === 0) return;

    const eligible = events.filter((e) => e.router?.eligible);
    const missed = events.filter((e) => e.evaluation?.would_have_missed);
    const tokenSavings = events
      .map((e) => e.router?.estimated_tokens_saved ?? 0)
      .filter((v) => v > 0);
    const confidences = events
      .map((e) => e.router?.confidence)
      .filter((v) => v != null);

    // Group stats
    const groupStats = {};
    for (const e of events) {
      const predicted = (e.router?.selected_groups || []).filter((g) => g !== "core");
      const used = (e.response?.tool_use_groups || []).filter((g) => g !== "core");
      const missedGroups = e.evaluation?.missed_groups || [];

      for (const g of predicted) {
        if (!groupStats[g]) groupStats[g] = { predicted: 0, used: 0, missed: 0 };
        groupStats[g].predicted++;
      }
      for (const g of used) {
        if (!groupStats[g]) groupStats[g] = { predicted: 0, used: 0, missed: 0 };
        groupStats[g].used++;
      }
      for (const g of missedGroups) {
        if (!groupStats[g]) groupStats[g] = { predicted: 0, used: 0, missed: 0 };
        groupStats[g].missed++;
      }
    }

    // Top missed
    const missedToolCounts = {};
    const missedGroupCounts = {};
    for (const e of events) {
      for (const t of e.evaluation?.missed_tools || []) {
        missedToolCounts[t] = (missedToolCounts[t] || 0) + 1;
      }
      for (const g of e.evaluation?.missed_groups || []) {
        missedGroupCounts[g] = (missedGroupCounts[g] || 0) + 1;
      }
    }

    const topMissedTools = Object.entries(missedToolCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tool, count]) => ({ tool, count }));

    const topMissedGroups = Object.entries(missedGroupCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([group, count]) => ({ group, count }));

    const sorted = tokenSavings.sort((a, b) => a - b);
    const median = sorted.length > 0
      ? sorted[Math.floor(sorted.length / 2)]
      : 0;

    const metrics = {
      schema_version: 1,
      computed_at: new Date().toISOString(),
      window: {
        event_count: events.length,
        from: events[0]?.timestamp || null,
        to: events[events.length - 1]?.timestamp || null,
      },
      summary: {
        mode: routerState?.config?.mode || "off",
        eligible_rate: events.length > 0 ? eligible.length / events.length : 0,
        would_have_missed_rate: events.length > 0 ? missed.length / events.length : 0,
        median_estimated_tokens_saved: median,
        avg_estimated_tokens_saved:
          tokenSavings.length > 0
            ? Math.round(tokenSavings.reduce((a, b) => a + b, 0) / tokenSavings.length)
            : 0,
        avg_confidence:
          confidences.length > 0
            ? parseFloat((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
            : null,
      },
      group_stats: groupStats,
      top_missed_tools: topMissedTools,
      top_missed_groups: topMissedGroups,
    };

    atomicWriteJson(METRICS_FILE, metrics);
  } catch (err) {
    console.error("  [router] Failed to recompute metrics:", err.message);
    emitErrorEvent({
      stage: "metrics_write",
      message: "Failed to recompute metrics: " + err.message,
    });
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

function getState() {
  return routerState;
}

function getMetrics() {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      return JSON.parse(fs.readFileSync(METRICS_FILE, "utf-8"));
    }
  } catch (err) {
    console.error("  [router] Failed to read metrics:", err.message);
  }
  return null;
}

module.exports = {
  initDataDir,
  emitEvalEvent,
  emitErrorEvent,
  buildEvalEvent,
  computeToolsetHash,
  generateEventId,
  getConfig,
  getState,
  saveState,
  getMetrics,
};
