# Jannal

**See what's eating your context window. Then fix it.**

Jannal sits between your AI tools and the Anthropic API. It intercepts every request, visualizes how your context window is being used, and lets you filter out tools you don't need — saving tokens and money.

Works with Claude Code and any tool that speaks the Anthropic Messages API. [Cursor support is pending](#cursor-support).

![License](https://img.shields.io/badge/license-MIT-blue)

![Jannal Screenshot](src/public/jannal-1.png)

## What it does

**Inspect** — Watch every API request in real time. See exactly how many tokens go to the system prompt, tool definitions, conversation history, and tool results. The context bar shows you at a glance where your tokens are going.

**Cost tracking** — See the cost of every turn, with per-model pricing (Opus, Sonnet, Haiku). Session cost accumulates in the header so you always know what you're spending. Uses the official `count_tokens` API for accurate counts before the response even finishes.

**Filter tools** — If you're running Claude Code with 40+ MCP tools defined, half of them are probably irrelevant to what you're doing right now. Jannal strips them from the request before it hits the API. Create named profiles ("Coding Only", "Browser Automation") and switch between them from the UI.

**Router intelligence** *(Pro)* — Automatic tool filtering powered by intent detection. The router analyzes each request's user message using keyword rules and a local embedding model, predicts which MCP server groups are needed, and strips the rest. Shadow mode observes and logs predictions without filtering. Auto mode (coming soon) will filter in real time. Saves 10-17k tokens per request on typical 170-tool setups.

## Quick start

```bash
git clone https://github.com/Buzzie-AI/jannal.git
cd jannal
npm install
npm run build
npm start
```

Then start your AI tool pointing at the proxy:

```bash
# Claude Code
ANTHROPIC_BASE_URL=http://localhost:4455 claude

# Or any tool that supports ANTHROPIC_BASE_URL
ANTHROPIC_BASE_URL=http://localhost:4455 your-tool
```

Open `http://localhost:4455` in your browser to see the Inspector.

## How it works

```
Your AI Tool  →  Jannal (localhost:4455)  →  api.anthropic.com
                      ↓
              Inspector UI (browser)
```

The proxy is transparent. It forwards requests to Anthropic and pipes responses back. The only modification it makes is tool filtering when you have an active profile.

Your API key passes through the proxy in the request headers — it's never stored or logged. The proxy runs entirely on your machine.

## Features

### Context bar
A visual breakdown of every segment in the context window. System prompt, tools, messages, tool results — each gets a colored block proportional to its token count. Pressure indicators glow when you're approaching the context limit.

### Turn timeline
Every API request appears as a turn in the left panel. Click one to see its full segment breakdown. Tokens, costs, and model info at a glance.

### Full content modal
Click any segment to see its complete content — system prompts, tool definitions with full JSON schemas, message text. Search, copy, and switch between formatted and raw views.

### Tool filtering profiles
Open the Tools segment, uncheck the tools you don't need, save as a named profile. Profiles persist across restarts (stored in `profiles.json`). Switch profiles from the header dropdown. An orange "FILTERING" badge reminds you when filtering is active.

**Tool grouping by MCP server** — Tools are grouped by inferred MCP server (e.g. `github`, `filesystem`). Enable or disable an entire server at once with per-group All/None buttons.

### Accurate token counting
Three phases: instant char-based estimates, then exact counts via the `count_tokens` API (free, fires in parallel), then ground truth from the response. Per-segment breakdowns are proportionally scaled when exact totals arrive.

### Cost per turn
Pricing for all Claude models, updated to current rates. See input cost, output cost, and total per turn. Session cost accumulates in the header.

### Session export & persistence
Export your session as **JSON** or **CSV** for analysis. Session data (turns, costs, segments) persists across page refreshes via `localStorage` — pick up where you left off.

### Token growth chart
A sparkline below the context bar shows input tokens per turn over time. Spot conversation bloat at a glance and know when to start a new session.

## Request grouping

When you use Claude Code, a single user message can generate dozens of API requests — the main session, subagents, tool calls, and follow-ups. Jannal groups these into logical turns so you see conversations, not a flat stream of requests.

**How grouping works:**
- Requests are grouped by conversation identity (first human message) and session hash (model + system prompt text)
- A new group starts when: the user types a new message in the main session, or a 45-second inactivity gap elapses
- Subagent requests (shorter message count, different model) stay in the current group rather than creating singletons
- Infrastructure tags (`<system-reminder>`, `<command-message>`, etc.) are stripped before text comparison so Claude Code boilerplate doesn't create bogus boundaries

Toggle between **Grouped** and **Flat** views using the button in the request panel header.

## Free and Pro tiers

Jannal has a free tier and a Pro tier. The core proxy/inspector experience is free. The intelligent routing layer is Pro.

| Feature | Free | Pro |
|---|---|---|
| Proxy passthrough | Yes | Yes |
| Request/segment inspection | Yes | Yes |
| Token/cost tracking | Yes | Yes |
| Tool filtering profiles | Yes | Yes |
| Session export (JSON/CSV) | Yes | Yes |
| Request grouping | Yes | Yes |
| Router intelligence (shadow/auto) | - | Yes |
| Savings intelligence | - | Yes |
| Router decision UI | - | Yes |

### Enabling Pro

Set `data/app-config.json`:

```json
{ "premium": true }
```

Then restart the server. If the file doesn't exist, it auto-creates with `premium: false` on first run.

When Pro is off, router UI elements are visible but locked — you can see what's available without it being active. The proxy, inspector, profiles, and all free features work normally.

## Intent-aware tool router (Pro)

If you run Claude Code with many MCP servers (Linear, Firebase, Playwright, Supabase, Context7, etc.), every request carries 100-170 tool definitions — roughly 40-50k tokens of tool overhead. Most requests only need a few of those servers. The router predicts which server groups are relevant and identifies which ones could be safely removed.

### How it works

The router runs two signal matchers in parallel on every eligible request:

1. **Keyword rules** — Fast regex patterns for obvious intent: mentions of "linear", "firebase", "screenshot", URLs with browser-review phrases, etc. Confidence: 0.85.
2. **Embedding similarity** — A local sentence embedding model (`BAAI/bge-small-en-v1.5`, 33MB) computes cosine similarity between the user's message and each server group's description. Groups scoring above 0.55 are matched.

Signals are merged (intersection when both agree, rules-only when they disagree) and the result determines which groups to keep vs. strip.

### Modes

| Mode | Behavior |
|---|---|
| **Off** | Router disabled. All tools forwarded as-is. |
| **Shadow** | Router predicts which groups to keep/strip but **forwards all tools unchanged**. Predictions are logged for evaluation. This is the current default. |
| **Auto** | *(Not yet enabled)* Router actually strips tools from the forwarded request. Gated on miss rate < 2% in shadow data. |

Switch modes from the router badge in the header bar.

### Group taxonomy

Tools are classified into groups:

- **Core** — Always retained. Built-in Claude Code tools: Agent, Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, LSP, etc.
- **Catalog groups** — Known MCP servers with descriptions and examples. Currently: Linear, Firebase, Playwright, Context7, Supabase. Each is marked `stripEligible` — safe to exclude when there's no positive signal.
- **Unknown MCP groups** — MCP servers without catalog entries. Always retained (no basis to exclude them).
- **Other** — Uncategorized non-core tools. Always retained.

When neither rules nor embeddings detect a specialized group's relevance, the router defaults to **`default_core_only`**: strip all strip-eligible catalog groups, keep everything else. This is the inverted-polarity default — the router saves tokens by default rather than only when it's confident.

### What you see in the UI

Each request's detail panel shows the router decision:
- **Would keep** / **Would strip** — which groups the router predicts are needed vs. removable (shadow mode language)
- **Potential savings** — estimated token reduction if stripping were active
- **Matched by** — `rules`, `embeddings`, `hybrid`, or `default_core_only`
- **Confidence** — signal strength (0% = no signal, 85% = keyword match)

The header shows **Saved ~Nk ($X.XX)** — cumulative estimated token savings across the session.

### Monitoring and evaluation

Shadow mode logs every routing decision to `data/router-evals.ndjson`. Each event records:
- What the router predicted (selected/stripped groups)
- What the model actually used (tool names from the response)
- Whether stripping would have caused a miss (`would_have_missed`)

Aggregate metrics are recomputed every 20 events into `data/router-metrics.json`. Key metrics: eligible rate, miss rate, median token savings, per-group precision/recall.

**Guardrails before auto mode:**
- `would_have_missed` rate must stay ≤ 2%
- No misses on core workflows
- Median token reduction ≥ 50% on eligible requests

### Embedding model setup

The router uses a local embedding model for semantic matching. It downloads and caches automatically on first start.

- **Model:** `BAAI/bge-small-en-v1.5` (33MB, MIT license, 384-dim)
- **Cache location:** `data/models-cache/`
- **First startup:** The model downloads from HuggingFace (~30 seconds on a typical connection). You'll see `[embeddings] Loading model...` in the server logs. The proxy is fully functional while the model loads — it falls back to rules-only routing until embeddings are ready.
- **Subsequent startups:** Model loads from local cache (~2-3 seconds).
- **No GPU required.** Inference runs on CPU using `@huggingface/transformers` with fp32 precision. Each ranking call takes <200ms.

If the model fails to load (network issues, disk space), the router continues with keyword rules only. No action required — it degrades gracefully.

### Known limitations

- **Unpredictable tool choices are not catchable.** When the user says "improve your strategy" and the model autonomously decides to query Supabase, no amount of keyword or embedding tuning can predict that from the message alone. This miss class needs session-aware retention (keeping recently-used tools warm), which is planned for a future iteration.
- **Shadow mode has zero performance impact on requests.** All tools are always forwarded. The router only records what it *would have done*.

See `docs/router/learnings.md` for detailed field notes from the development process.

## Cursor support

**Current status:** Cursor IDE does not yet support overriding the Anthropic base URL. Unlike OpenAI models (which have a base URL override in Settings → Models), Anthropic models always send requests directly to `api.anthropic.com`, so Jannal cannot intercept them today.

**When Cursor adds Anthropic base URL override**, Jannal will work with zero code changes. You would:

1. Start Jannal: `npm start`
2. In Cursor Settings → Models, enable "Override Anthropic Base URL" (when available)
3. Set the base URL to `http://localhost:4455`
4. Open `http://localhost:4455` in your browser to use the Inspector

**If Cursor's requests originate from cloud infrastructure** (and cannot reach localhost), you would need to expose Jannal via a tunnel (e.g. [ngrok](https://ngrok.com), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/), or [Tailscale Funnel](https://tailscale.com/kb/1243/funnel/)) and use that public URL as the override.

Track Cursor's progress on this feature: [Override Anthropic Base URL](https://forum.cursor.com/t/override-anthropic-base-url/5355).

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `JANNAL_PORT` | `4455` | Port for the proxy and Inspector UI |

## Development

```bash
# Terminal 1: start the proxy server
npm run dev:server

# Terminal 2: start Vite dev server with hot reload
npm run dev:ui
```

Open `http://localhost:5173` for the dev UI (auto-proxies API calls to the server on :4455).

## Project structure

```
jannal/
├── server.js              # Proxy server, token analysis, grouping, premium gating
├── lib/
│   ├── app-config.js      # Premium feature flag (reads data/app-config.json)
│   └── tokens.js          # Token estimation + budget helpers
├── vite.config.js         # Vite build + dev proxy config
├── router/                # Intent-aware tool router (Pro feature, shadow mode)
│   ├── index.js           # routeRequest() orchestrator, signal merging, intent selection
│   ├── catalog.js         # Server group catalog (descriptions, prefixes, stripEligible)
│   ├── grouping.js        # Canonical tool-to-group classification
│   ├── rules.js           # Keyword/regex pattern matcher
│   ├── embeddings.js      # Local embedding model (bge-small-en-v1.5) + cosine ranking
│   └── log.js             # Telemetry writer, state management, metrics rollup
├── src/                   # Frontend source (ES modules)
│   ├── index.html         # HTML shell
│   ├── main.js            # Entry point
│   ├── styles.css         # All styles
│   ├── state.js           # App state + constants
│   ├── ws.js              # WebSocket connection
│   ├── api.js             # HTTP API helpers
│   ├── render.js          # UI rendering (bar, turns, detail, token chart)
│   ├── modal.js           # Modal lifecycle + tools view (grouped by MCP server)
│   ├── profiles.js        # Profile management
│   ├── session.js         # Session export & persistence
│   └── utils.js           # Formatting + segment helpers + tool grouping
├── test/                  # Regression tests (node:test)
│   └── router-recall.test.js  # Router recall tests from real shadow-mode failures
├── data/                  # Auto-created at runtime
│   ├── app-config.json        # Premium feature flag { "premium": true/false }
│   ├── router-evals.ndjson    # Shadow-mode eval events (append-only, Pro only)
│   ├── router-metrics.json    # Aggregate metrics (recomputed every 20 events)
│   ├── router-state.json      # Router config and runtime state
│   └── models-cache/          # Cached embedding model (~128MB after download)
├── docs/router/           # Router design docs and field notes
├── public/                # Vite build output (served by server.js)
├── package.json
├── profiles.json          # Auto-created, stores your filtering profiles
└── README.md
```

The backend is `server.js` plus the `router/` module. The frontend is split into focused modules — no framework, just vanilla JS with ES module imports. Vite handles the build.

## Limitations

- Only supports the Anthropic Messages API (not OpenAI, Google, etc. — yet)
- Cursor IDE is not yet supported — Cursor lacks an Anthropic base URL override setting (see [Cursor support](#cursor-support))
- Per-segment token counts are proportionally scaled estimates, not exact per-field counts
- Tool filtering modifies the request body, which means Claude won't know those tools exist — this is the point, but be aware
- Profiles are stored in a local JSON file, not synced across machines

## Contributing

Issues and PRs welcome. The codebase is intentionally simple — one backend file, small frontend modules, and two dependencies (`ws` + `vite`). Keep it that way.

## License

MIT
