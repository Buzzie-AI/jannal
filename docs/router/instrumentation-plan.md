# Router Instrumentation Plan

## Purpose

Define the v1 telemetry schema, file layout, write semantics, and retention rules for the local-first intent router.

This plan assumes:
- no centralized analytics backend
- local disk is the source of truth
- raw eval logs are append-only
- derived state and metrics can be rebuilt

## Storage Model

Create a local `data/` directory under the app root:

- [data/router-evals.ndjson](/Users/athahar/work/claude-apps/playground/jannal/data/router-evals.ndjson)
  - Append-only raw per-request eval events
  - Source of truth
- [data/router-errors.ndjson](/Users/athahar/work/claude-apps/playground/jannal/data/router-errors.ndjson)
  - Append-only router/runtime errors
- [data/router-state.json](/Users/athahar/work/claude-apps/playground/jannal/data/router-state.json)
  - Current router config, sticky routes, runtime counters
- [data/router-metrics.json](/Users/athahar/work/claude-apps/playground/jannal/data/router-metrics.json)
  - Derived aggregates for UI and quick inspection

Optional export/report directory:

- `/Users/athahar/work/claude-apps/playground/jannal/data/output/`
  - One-off run outputs
  - Experiment snapshots
  - Human-reviewed JSON reports

Do not store router telemetry in `localStorage`.

## Ownership Rules

- `router-evals.ndjson`: written by server only
- `router-errors.ndjson`: written by server only
- `router-state.json`: written by server only
- `router-metrics.json`: written by server only, read by UI

## Directory Rules

- Create `data/` on startup if missing.
- Treat `router-evals.ndjson` as the source of truth.
- Treat `router-state.json` and `router-metrics.json` as rebuildable files.
- Treat `data/output/` as non-canonical export output.
- Use atomic rewrite for JSON files:
  - write to `*.tmp`
  - `rename()` into place

## Event Lifecycle

One primary eval event is emitted per Anthropic `/v1/messages` request, after the response completes.

High-level flow:
1. Request enters proxy.
2. Manual profile filtering runs.
3. Router makes a prediction or skip decision.
4. Request is forwarded.
5. Response completes.
6. Actual tool-use names are extracted.
7. Evaluation is computed.
8. One `router_eval_v1` event is appended.

Errors at any routing stage emit `router_error_v1` immediately.

## Event Types

V1 event types:
- `router_eval_v1`
- `router_error_v1`

## `router_eval_v1` Schema

```json
{
  "schema_version": 1,
  "event_type": "router_eval_v1",
  "event_id": "evt_01HV8Y6K9J8W4F5N2T3A7B1C9D",
  "timestamp": "2026-03-13T21:14:22.481Z",
  "app": {
    "name": "jannal",
    "version": "0.2.2"
  },
  "request": {
    "turn": 29,
    "group_id": 6,
    "session_hash": "k9f2za",
    "model": "claude-opus-4-6",
    "stream": true,
    "anthropic_path": "/v1/messages"
  },
  "user_context": {
    "last_user_message": "Create a Linear ticket for this bug and include the reproduction steps.",
    "last_user_message_truncated": false,
    "last_user_message_chars": 73,
    "recent_user_messages": [
      "The build is failing on CI.",
      "Create a Linear ticket for this bug and include the reproduction steps."
    ]
  },
  "tool_inventory": {
    "tool_count_total": 101,
    "tool_count_core": 7,
    "tool_count_noncore": 94,
    "estimated_tool_tokens_total": 32741,
    "available_groups": ["core", "linear", "playwright", "firebase", "other"],
    "toolset_hash": "toolset_6d8a1b72",
    "available_tools_sample": [
      "Agent",
      "Bash",
      "Read",
      "mcp__linear__save_issue",
      "mcp__playwright__browser_navigate"
    ]
  },
  "manual_filter": {
    "active_profile": "All Tools",
    "profile_mode": null,
    "profile_tools": [],
    "filtered_tool_count": 101
  },
  "router": {
    "mode": "shadow",
    "eligible": true,
    "skip_reason": null,
    "matched_by": "hybrid",
    "confidence": 0.93,
    "selected_groups": ["core", "linear"],
    "selected_tools": [
      "Agent",
      "Bash",
      "Read",
      "Write",
      "Edit",
      "Glob",
      "Grep",
      "mcp__linear__save_issue",
      "mcp__linear__list_issues"
    ],
    "stripped_groups": ["firebase", "playwright", "other"],
    "stripped_tools": [
      "mcp__firebase__firestore_query",
      "mcp__playwright__browser_navigate"
    ],
    "selected_tool_count": 9,
    "stripped_tool_count": 92,
    "estimated_tokens_saved": 24110,
    "reason": "User requested project tracking / ticket creation",
    "sticky_reused": false
  },
  "response": {
    "stop_reason": "end_turn",
    "input_tokens": 112984,
    "output_tokens": 3871,
    "cost_usd_total": 0.5654,
    "tool_use_names": ["mcp__linear__save_issue"],
    "tool_use_groups": ["linear"],
    "tool_use_count": 1
  },
  "evaluation": {
    "would_have_missed": false,
    "missed_tools": [],
    "missed_groups": [],
    "precision_groups": 1.0,
    "recall_groups": 1.0,
    "selected_group_count": 1,
    "used_group_count": 1
  }
}
```

## Field Definitions

### Top-level

- `schema_version`: integer schema version
- `event_type`: fixed string `router_eval_v1`
- `event_id`: ULID or UUID
- `timestamp`: ISO-8601 UTC timestamp

### `request`

- `turn`: Jannal request id
- `group_id`: Jannal group id
- `session_hash`: Jannal session hash
- `model`: Anthropic model string
- `stream`: whether request used streaming
- `anthropic_path`: should be `/v1/messages` in v1

### `user_context`

- `last_user_message`: capped at 500 chars
- `last_user_message_truncated`: boolean
- `last_user_message_chars`: char count after truncation
- `recent_user_messages`: up to 3 user messages total, each capped at 300 chars

### `tool_inventory`

- `tool_count_total`: number of post-profile tools available to the router
- `tool_count_core`: count of tools in the `core` group
- `tool_count_noncore`: count of all remaining tools
- `estimated_tool_tokens_total`: estimated tokens for the post-profile tool set
- `available_groups`: groups represented in this request
- `toolset_hash`: stable hash of the post-profile tool set
- `available_tools_sample`: optional sample of up to 10 tool names present after manual profile filtering

### `manual_filter`

- `active_profile`: current manual profile name
- `profile_mode`: `allowlist`, `blocklist`, or `null`
- `profile_tools`: explicit tool names in the profile, or empty array
- `filtered_tool_count`: tool count after manual profile filtering

### `router`

- `mode`: `off`, `shadow`, or `auto`
- `eligible`: whether request met routing thresholds
- `skip_reason`: reason routing did not run or did not apply
- `matched_by`: `rules`, `embeddings`, `hybrid`, `sticky`, or `fallback_all`
- `confidence`: numeric confidence or `null`
- `selected_groups`: final selected groups for routing, including `core` if present
- `selected_tools`: optional sample of final tool names that router would send, or `null`
- `stripped_groups`: groups removed by router
- `stripped_tools`: optional sample of tools removed by router, or `null`
- `selected_tool_count`: final tool count router would send, or `null`
- `stripped_tool_count`: final tool count router would remove
- `estimated_tokens_saved`: estimated tool-token delta vs post-profile set
- `reason`: short debug string
- `sticky_reused`: whether sticky route was used

### `response`

- `stop_reason`: Anthropic stop reason
- `input_tokens`: actual input tokens when available
- `output_tokens`: actual output tokens when available
- `cost_usd_total`: actual total cost when available
- `tool_use_names`: actual tool names used by Claude
- `tool_use_groups`: actual non-core/core groups used by Claude
- `tool_use_count`: number of tool-use calls

### `evaluation`

- `would_have_missed`: true if any actual tool-used name would have been stripped
- `missed_tools`: actual used tool names that router would have removed
- `missed_groups`: actual used groups that router would have removed
- `precision_groups`: intersection over predicted non-core groups
- `recall_groups`: intersection over actual used non-core groups
- `selected_group_count`: count of selected non-core groups
- `used_group_count`: count of actually used non-core groups

`core` must be excluded from precision/recall math.

## Skip Example

Routing must still emit an eval event when skipped.

```json
{
  "schema_version": 1,
  "event_type": "router_eval_v1",
  "event_id": "evt_01HV8Y7H2J1F9P8X4Z6Q3R5M7N",
  "timestamp": "2026-03-13T21:18:10.100Z",
  "request": {
    "turn": 30,
    "group_id": 6,
    "session_hash": "k9f2za",
    "model": "claude-opus-4-6",
    "stream": true,
    "anthropic_path": "/v1/messages"
  },
  "user_context": {
    "last_user_message": "Read this file and summarize it.",
    "last_user_message_truncated": false,
    "last_user_message_chars": 31,
    "recent_user_messages": ["Read this file and summarize it."]
  },
  "tool_inventory": {
    "tool_count_total": 9,
    "tool_count_core": 7,
    "tool_count_noncore": 2,
    "estimated_tool_tokens_total": 1480,
    "available_groups": ["core", "other"],
    "toolset_hash": "toolset_2f44bc10",
    "available_tools_sample": ["Agent", "Bash", "Read"]
  },
  "manual_filter": {
    "active_profile": "All Tools",
    "profile_mode": null,
    "profile_tools": [],
    "filtered_tool_count": 9
  },
  "router": {
    "mode": "shadow",
    "eligible": false,
    "skip_reason": "below_threshold",
    "matched_by": null,
    "confidence": null,
    "selected_groups": null,
    "selected_tools": null,
    "stripped_groups": [],
    "stripped_tools": null,
    "selected_tool_count": null,
    "stripped_tool_count": 0,
    "estimated_tokens_saved": 0,
    "reason": null,
    "sticky_reused": false
  },
  "response": {
    "stop_reason": "end_turn",
    "input_tokens": 1800,
    "output_tokens": 220,
    "cost_usd_total": 0.0098,
    "tool_use_names": ["Read"],
    "tool_use_groups": ["core"],
    "tool_use_count": 1
  },
  "evaluation": {
    "would_have_missed": false,
    "missed_tools": [],
    "missed_groups": [],
    "precision_groups": null,
    "recall_groups": null,
    "selected_group_count": 0,
    "used_group_count": 0
  }
}
```

## `router_error_v1` Schema

```json
{
  "schema_version": 1,
  "event_type": "router_error_v1",
  "event_id": "err_01HV8YB5R3A8Q7K2N6M1C4D9E",
  "timestamp": "2026-03-13T21:20:01.331Z",
  "request": {
    "turn": 31,
    "group_id": 6,
    "session_hash": "k9f2za"
  },
  "stage": "embeddings",
  "severity": "error",
  "message": "Embedding model not loaded",
  "details": {
    "router_mode": "shadow"
  }
}
```

### Error Stage Enum

- `catalog`
- `grouping`
- `rules`
- `embeddings`
- `routing`
- `tool_use_parse`
- `metrics_write`

## Router State File

Path:
- [data/router-state.json](/Users/athahar/work/claude-apps/playground/jannal/data/router-state.json)

Purpose:
- Current config
- Sticky route cache
- Runtime counters
- Rotation timestamps

Schema:

```json
{
  "schema_version": 1,
  "updated_at": "2026-03-13T21:25:00.000Z",
  "config": {
    "mode": "shadow",
    "min_tool_count": 20,
    "min_tool_tokens": 5000,
    "auto_confidence_threshold": 0.9,
    "sticky_confidence_threshold": 0.92,
    "sticky_ttl_ms": 1800000,
    "core_tools": ["Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep"],
    "max_last_user_message_chars": 500,
    "max_recent_user_messages": 3
  },
  "runtime": {
    "events_written": 148,
    "errors_written": 3,
    "last_event_id": "evt_01HV8Y6K9J8W4F5N2T3A7B1C9D",
    "last_rotation_at": null
  },
  "sticky_routes": {
    "k9f2za": {
      "selected_groups": ["core", "linear"],
      "confidence": 0.93,
      "matched_by": "hybrid",
      "updated_at": "2026-03-13T21:14:22.481Z"
    }
  }
}
```

Use `session_hash` as the sticky-route key in v1.
This field already exists in current Jannal server logic and should be reused as-is.

## Metrics File

Path:
- [data/router-metrics.json](/Users/athahar/work/claude-apps/playground/jannal/data/router-metrics.json)

Purpose:
- Fast UI reads
- Quick local inspection
- Rebuildable summary data

Schema:

```json
{
  "schema_version": 1,
  "computed_at": "2026-03-13T21:30:00.000Z",
  "window": {
    "event_count": 148,
    "from": "2026-03-12T00:00:00.000Z",
    "to": "2026-03-13T21:29:59.999Z"
  },
  "summary": {
    "mode": "shadow",
    "eligible_rate": 0.61,
    "would_have_missed_rate": 0.018,
    "median_estimated_tokens_saved": 18320,
    "avg_estimated_tokens_saved": 17654,
    "avg_confidence": 0.88
  },
  "group_stats": {
    "linear": {
      "predicted": 32,
      "used": 29,
      "missed": 1
    },
    "supabase": {
      "predicted": 17,
      "used": 15,
      "missed": 0
    }
  },
  "top_missed_tools": [
    {
      "tool": "mcp__playwright__browser_navigate",
      "count": 2
    }
  ],
  "top_missed_groups": [
    {
      "group": "playwright",
      "count": 2
    }
  ]
}
```

## Enums

### `router.mode`

- `off`
- `shadow`
- `auto`

### `router.skip_reason`

- `below_threshold`
- `router_off`
- `no_candidate_groups`
- `low_confidence`
- `router_error`
- `manual_override_all_tools`

### `router.matched_by`

- `rules`
- `embeddings`
- `hybrid`
- `sticky`
- `fallback_all`

## Privacy and Redaction

V1 must be conservative:

- Store only last user message and at most 2 prior user messages
- Cap stored message lengths
- Do not store assistant message bodies
- Do not store tool arguments
- Do not store tool results
- Do not store API keys or request headers
- Do not store raw full request JSON

Optional future addition:
- `redacted_last_user_message`

## Write Semantics

- `router-evals.ndjson`: append one line after response completion
- `router-errors.ndjson`: append one line immediately on error
- `router-state.json`: rewrite atomically after config or sticky-route changes
- `router-metrics.json`: rewrite atomically every `N=20` eval events

## Retention

- Rotate `router-evals.ndjson` at `50 MB`
- Rename to `router-evals.YYYY-MM-DD.ndjson`
- Keep last `10` rotated files
- Delete older rotations automatically

`router-errors.ndjson` can share the same retention approach, but lower volume makes immediate rotation optional.

## Collection Requirements

### Required for Step 0a

- Parse tool-use names from streaming SSE responses
- Parse tool-use names from non-streaming JSON responses
- Attach tool-use names to the request lifecycle

### Required for Step 0b

- Create `data/` if missing
- Add append-only NDJSON writers
- Add log rotation for raw eval files
- Emit `router_eval_v1` even when router mode is `off`, with routing fields marked accordingly

### Deferred to Later

- SQLite rollups
- Cross-device export/sync
- Centralized reporting

## Future APIs

Later expose:
- `GET /api/router/metrics`
- `GET /api/router/recent-evals?limit=50`
- `POST /api/router/config`

V1 storage remains file-backed regardless of whether these endpoints are added.
