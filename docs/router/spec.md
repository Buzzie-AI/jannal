# Intent-Aware Router Spec

## Goal

Add an intent-aware tool router to Jannal that reduces irrelevant tool definitions in Anthropic `/v1/messages` requests by selecting relevant server groups while preserving reliability through explicit modes:

- `off`
- `shadow`
- `auto`

Primary objective:
- Improve effective context quality and reduce tool-token overhead on large-tool requests.

Non-goals for v1:
- Per-tool routing
- Fine-tuned models
- Cloud-hosted telemetry
- Cross-machine sync

## Why Now

Jannal already mutates requests in-flight via manual profiles. The missing capability is a decision layer that predicts which server groups are needed for a request and evaluates that prediction safely before enabling automated filtering.

The product value is:
- Less irrelevant tool overhead
- More useful context budget for the model
- Fewer manual profile switches for users with many MCP servers

## Current Insertion Point

The router belongs in the existing request mutation path in [server.js](/Users/athahar/work/claude-apps/playground/jannal/server.js), inside the `/messages` proxy flow, alongside the current manual profile filtering.

Relevant current modules:
- Backend proxy and filtering: [server.js](/Users/athahar/work/claude-apps/playground/jannal/server.js)
- Frontend state: [src/state.js](/Users/athahar/work/claude-apps/playground/jannal/src/state.js)
- Frontend tool grouping heuristic: [src/utils.js](/Users/athahar/work/claude-apps/playground/jannal/src/utils.js)
- Tools/profile UI: [src/modal.js](/Users/athahar/work/claude-apps/playground/jannal/src/modal.js)
- WebSocket updates: [src/ws.js](/Users/athahar/work/claude-apps/playground/jannal/src/ws.js)

## User-Facing Behavior

### Modes

- `off`: current behavior only; manual profile filtering remains unchanged.
- `shadow`: router predicts server groups and logs what it would have filtered, but forwards the full tool set after manual-profile filtering.
- `auto`: router filters tools by predicted server groups, subject to confidence, thresholds, and core-tool rules.

### Safety Rules

- Core tools are always retained.
- Auto-routing runs only when request size thresholds are met.
- Auto-routing runs only when router confidence meets threshold.
- User can fall back to `All Tools` for the current session/group.
- Router decisions are visible in the UI.

## Routing Abstraction

V1 routes to server groups, not individual tool names.

Group types:
- `core`
- Explicit MCP groups such as `linear`, `supabase`, `firebase`, `playwright`, `context7`
- `other` for uncategorized non-core tools

Initial default core tools:
- `Agent`
- `Bash`
- `Read`
- `Write`
- `Edit`
- `Glob`
- `Grep`

The frontend grouping heuristic in [src/utils.js](/Users/athahar/work/claude-apps/playground/jannal/src/utils.js) is acceptable for display, but routing must use an explicit backend-owned catalog.

## Architecture

### New Backend Modules

Add these server-side modules under `router/`:

- `router/catalog.js`
  - Explicit group metadata
  - Group descriptions and examples
- `router/grouping.js`
  - Canonical tool-to-group mapping
  - Backend source of truth for grouping
- `router/rules.js`
  - Keyword/rule matcher for obvious intents
- `router/embeddings.js`
  - Embeddings model loader and similarity scoring
- `router/index.js`
  - Main `routeRequest()` entry point
- `router/log.js`
  - Append-only local telemetry writer

### Catalog Shape

```js
{
  linear: {
    label: "Linear",
    description: "Project management, issues, tickets, sprint planning, roadmaps",
    examples: ["create issue", "plan sprint", "update ticket"],
    toolPrefixes: ["mcp__linear__"]
  }
}
```

## Router Inputs

For each Anthropic `/messages` request, the router receives:

- Last user message text
- Up to 2 prior user messages
- Candidate server groups present in the request
- Manual profile state after manual filtering
- Current sticky route state for the request session/group
- Tool count and estimated tool-token cost

V1 must not pass full tool schemas into the routing model.

## Router Output

```json
{
  "mode": "shadow",
  "eligible": true,
  "skipReason": null,
  "selectedGroups": ["core", "linear"],
  "confidence": 0.91,
  "matchedBy": "hybrid",
  "reason": "User asked to create and update project tickets",
  "stickyReused": false
}
```

## Routing Algorithm

1. Apply manual profile filtering first.
2. Build candidate groups from the remaining tools.
3. Estimate total tool tokens for the post-profile tool set.
4. If request size is below threshold, skip routing and keep all tools.
5. Reuse sticky route if a recent high-confidence route exists for the same `sessionHash`.
6. Run keyword/rule matching.
7. Run embedding ranking across candidate groups.
8. Merge signals into final selected groups.
9. Add `core`.
10. If confidence is below threshold, keep all tools.
11. In `shadow`, record the hypothetical filtered set but forward all tools.
12. In `auto`, forward only tools in selected groups plus `core`.

## Initial Thresholds

- Skip routing if:
  - tool count `< 20`, or
  - estimated tool tokens `< 5000`
- Auto-filter only if confidence `>= 0.90`
- Sticky-route reuse only if confidence `>= 0.92`

These are initial defaults and should be configurable.

## Session Stickiness

Sticky routing should prefer `sessionHash` as the cache key.

Behavior:
- If the current request belongs to a session with a recent high-confidence route, reuse that route before recomputing.
- Sticky reuse should expire with a TTL.
- Sticky reuse should be disabled when the user explicitly falls back to `All Tools`.

Note:
- `sessionHash` already exists in current Jannal server logic and is computed server-side from request characteristics.
- V1 should reuse that existing field rather than inventing a new session identifier.

## Tool-Use Instrumentation Requirement

Auto-routing must not ship without actual tool-use instrumentation.

V1 must extract tool-use names from:
- Streaming SSE responses
- Non-streaming JSON responses

This is a prerequisite for shadow-mode evaluation.

## Telemetry Dependency

Telemetry is local-first and file-backed. Exact schemas and file layout live in:

- [instrumentation-plan.md](/Users/athahar/work/claude-apps/playground/jannal/docs/router/instrumentation-plan.md)

`router-evals.ndjson` is the source of truth for evaluation.
Exported experiment snapshots and ad hoc reports should live under:

- `/Users/athahar/work/claude-apps/playground/jannal/data/output/`

## UI Changes

### Header

- Add router mode selector: `Off`, `Shadow`, `Auto`
- Add active routing badge, e.g. `ROUTED: Linear + Core`
- Add one-click fallback action: `Use All Tools`

### Request Detail Panel

Show:
- Router mode
- Confidence
- Selected groups
- Match source
- Estimated tokens saved
- In `shadow`, the hypothetical removed tool count and token savings

### Tools Modal

Distinguish:
- Manual profile filtering
- Router filtering
- Final tool set sent to Anthropic

## Frontend State Changes

Add to [src/state.js](/Users/athahar/work/claude-apps/playground/jannal/src/state.js):

```js
routerMode
routerStatus
routerConfig
sessionRoutes
```

Extend each request object with:

```js
routing: {
  mode,
  eligible,
  skipReason,
  selectedGroups,
  confidence,
  matchedBy,
  reason,
  stickyReused,
  toolsStrippedCount,
  estimatedTokensSaved
}
```

## APIs and WebSocket Changes

Add backend APIs:
- `GET /api/router/config`
- `POST /api/router/config`
- `GET /api/router/status`
- `GET /api/router/metrics`

Extend WebSocket payloads:
- `request` event includes routing metadata
- `response_complete` includes `toolsUsed`

## Success Metrics

Primary:
- `wouldHaveMissed` rate in `shadow`
- Median tool-token reduction on eligible requests
- Percentage of requests eligible for routing
- Match rate between predicted non-core groups and actually used non-core groups

Guardrails before broad `auto` rollout:
- `wouldHaveMissed <= 2%`
- No misses on manually tested core workflows
- Median tool-token reduction `>= 50%` on eligible requests

## Rollout Plan

### Step 0a

Add tool-use extraction only. No routing yet.

### Step 0b

Add local file-backed telemetry and emit baseline eval events with router mode set to `off`.

### Step 1

Add explicit backend group catalog and grouping logic.

### Step 2

Add rules + embeddings router in `shadow`.

### Step 3

Tune thresholds and group metadata using local eval logs.

### Step 4

Ship `auto` behind explicit user opt-in.

### Step 5

Optional: add a tiny local LLM only for ambiguous low-confidence cases.

## V1 Recommended Stack

- Rules: plain JS
- Embeddings: `@huggingface/transformers`
- Model: small sentence embedding model loaded once at startup
- No local generative LLM in the hot path for v1

## Open Decisions

- Whether `other` should be retained by default in `auto`
- Whether sticky routes should key only on `sessionHash` or also include `groupId`
- Whether metrics rollups should stay JSON-only in v1 or move to SQLite once UI analysis grows
