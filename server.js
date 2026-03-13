const http = require("http");
const https = require("https");
const { WebSocketServer } = require("ws");
const fs = require("fs");
const path = require("path");

const PORT = process.env.JANNAL_PORT || 4455;
const ANTHROPIC_HOST = "api.anthropic.com";

// ─── WebSocket clients ───────────────────────────────────────────────────────

const wsClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(msg);
  }
}

// ─── Token estimation ────────────────────────────────────────────────────────

function estimateTokens(input) {
  if (!input) return 0;
  const str = typeof input === "string" ? input : JSON.stringify(input);
  return Math.ceil(str.length / 3.8);
}

// ─── Model budget lookup ─────────────────────────────────────────────────────

const MODEL_BUDGETS = {
  "claude-sonnet": 200000, "claude-opus": 200000, "claude-haiku": 200000,
  "claude-3": 200000, "claude-4": 200000,
  "gpt-4o": 128000, "gpt-4-turbo": 128000, "gpt-3.5": 16385,
  "gemini": 1000000,
};

function getBudget(model) {
  if (!model) return 200000;
  for (const [key, budget] of Object.entries(MODEL_BUDGETS)) {
    if (model.includes(key)) return budget;
  }
  return 200000;
}

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

function calculateCost(inputTokens, outputTokens, model) {
  const pricing = getModelPricing(model);
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

// ─── Turn storage (full content kept server-side) ────────────────────────────

const turnStore = new Map(); // turnId -> { fullContents, model }
const MAX_STORED_TURNS = 200;

// ─── Profile management ─────────────────────────────────────────────────────

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

// ─── Request analysis ────────────────────────────────────────────────────────

let turnCounter = 0;

function analyzeRequest(body) {
  const segments = [];
  const fullContents = []; // stored separately, NOT sent over WebSocket

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

    segments.push({
      type: "tools",
      name: `Tools (${body.tools.length})`,
      tokens: estimateTokens(toolsJson),
      count: body.tools.length,
      toolNames: body.tools.map((t) => t.name),
      preview: toolsSummary.slice(0, 200),
    });
    fullContents.push(JSON.stringify(body.tools, null, 2));
  }

  // Messages
  if (body.messages) {
    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

      const isToolResult =
        Array.isArray(msg.content) && msg.content.some((c) => c.type === "tool_result");
      const isToolUse =
        Array.isArray(msg.content) && msg.content.some((c) => c.type === "tool_use");

      let type = "message";
      let name = `${msg.role} message`;
      if (isToolResult) { type = "tool_result"; name = "Tool Result"; }
      else if (isToolUse) { type = "tool_use"; name = "Tool Use (assistant)"; }

      // Pretty-print JSON content for readability
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

  const turnId = turnCounter++;
  const model = body.model || "unknown";

  // Store full content + model server-side
  turnStore.set(turnId, { fullContents, model });

  // Evict old turns if over limit
  if (turnStore.size > MAX_STORED_TURNS) {
    const oldest = turnStore.keys().next().value;
    turnStore.delete(oldest);
  }

  // Calculate estimated cost
  const totalEstimatedTokens = segments.reduce((s, seg) => s + seg.tokens, 0);
  const estimatedCost = calculateCost(totalEstimatedTokens, 0, model);

  return {
    turn: turnId,
    model,
    budget: getBudget(model),
    maxTokens: body.max_tokens,
    stream: !!body.stream,
    segments,    // NO fullContent — kept lightweight for WebSocket
    totalEstimatedTokens,
    estimatedCost,
    timestamp: Date.now(),
    messageCount: (body.messages || []).length,
  };
}

// ─── Streaming response parser ───────────────────────────────────────────────

function parseStreamedResponse(data) {
  const lines = data.split("\n");
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason = null;

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    try {
      const event = JSON.parse(line.slice(6));
      if (event.type === "message_start" && event.message?.usage) {
        inputTokens = event.message.usage.input_tokens || 0;
      }
      if (event.type === "message_delta") {
        if (event.usage) outputTokens = event.usage.output_tokens || 0;
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
      }
    } catch (e) { /* skip */ }
  }

  return { inputTokens, outputTokens, stopReason };
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

// ─── HTTP Server ─────────────────────────────────────────────────────────────

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

  // ── Serve Inspector UI (static files from public/) ──
  if (req.method === "GET") {
    // Serve static assets (Vite build output)
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
    const urlPath = req.url.split("?")[0]; // strip query params
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
      res.end(JSON.stringify({ status: "ok", turns: turnCounter, clients: wsClients.size }));
      return;
    }

    // ── API: Fetch full content for a segment ──
    const contentMatch = req.url.match(/^\/api\/content\/(\d+)\/(\d+)$/);
    if (contentMatch) {
      const turnId = parseInt(contentMatch[1]);
      const segIndex = parseInt(contentMatch[2]);
      const stored = turnStore.get(turnId);

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
  req.on("end", () => {
    const bodyBuffer = Buffer.concat(bodyChunks);
    const bodyStr = bodyBuffer.toString("utf-8");

    let forwardBuffer = bodyBuffer; // default: forward original
    let filteringInfo = null;

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

        broadcast({ type: "request", ...analysis });
        console.log(
          `[T${analysis.turn}] ${analysis.model} | ${analysis.segments.length} segs | ~${analysis.totalEstimatedTokens} tokens | $${analysis.estimatedCost.totalCost.toFixed(4)}${filteringInfo ? ` | FILTERED: ${filteringInfo.originalToolCount}→${filteringInfo.filteredToolCount} tools (-${filteringInfo.removedTools.length})` : ""}`
        );

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
      if (key === "host" || key === "connection") continue;
      fwdHeaders[key] = value;
    }
    fwdHeaders["host"] = ANTHROPIC_HOST;
    fwdHeaders["content-length"] = forwardBuffer.length; // use filtered buffer length

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
            const { inputTokens, outputTokens, stopReason } = parseStreamedResponse(responseData);

            let actualInput = inputTokens;
            let actualOutput = outputTokens;
            if (!actualInput) {
              try {
                const jsonRes = JSON.parse(responseData);
                actualInput = jsonRes.usage?.input_tokens || 0;
                actualOutput = jsonRes.usage?.output_tokens || 0;
              } catch (e) { /* streaming response, already parsed above */ }
            }

            if (actualInput || actualOutput) {
              // Find model for this turn from turnStore
              const latestTurnId = turnCounter - 1;
              const stored = turnStore.get(latestTurnId);
              const model = stored?.model || "unknown";
              const cost = calculateCost(actualInput, actualOutput, model);

              broadcast({
                type: "response_complete",
                usage: { input_tokens: actualInput, output_tokens: actualOutput },
                cost,
                stopReason,
                timestamp: Date.now(),
              });
              console.log(
                `  → Response: ${actualInput} in / ${actualOutput} out [${stopReason}] | $${cost.totalCost.toFixed(4)}`
              );
            }
          }
        });
      }
    );

    proxyReq.on("error", (err) => {
      console.error("Proxy error:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Proxy error", message: err.message }));
    });

    proxyReq.write(forwardBuffer); // use filtered buffer
    proxyReq.end();
  });
});

// ─── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  wsClients.add(ws);
  console.log(`Inspector connected (${wsClients.size} clients)`);
  ws.send(JSON.stringify({
    type: "connected",
    turns: turnCounter,
    profiles,
    activeProfile,
  }));

  // Handle incoming messages from client
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

// ─── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
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
  console.log("  Waiting for requests...");
  console.log("");
});
