# Router Enhancements

## Purpose

Capture follow-on router requirements that improve observability and usability without expanding the core Step 2 implementation beyond shadow-mode routing.

These enhancements are intentionally lightweight. They are meant to make the router inspectable and debuggable in the existing Jannal UI, not introduce a large new settings surface.

## API Enhancements

Add minimal read-only router endpoints on the server:

- `GET /api/router/config`
- `GET /api/router/status`

These endpoints should be considered baseline enhancements for router observability.

### `GET /api/router/config`

Purpose:
- Return the effective router configuration currently loaded by the server.
- Allow the frontend and debugging tools to inspect router behavior without reading local files directly.

Exact response shape for v1:

```json
{
  "schema_version": 1,
  "mode": "shadow",
  "min_tool_count": 20,
  "min_tool_tokens": 5000,
  "auto_confidence_threshold": 0.9,
  "sticky_confidence_threshold": 0.92,
  "sticky_ttl_ms": 1800000,
  "core_tools": ["Agent", "Bash", "Read", "Write", "Edit", "Glob", "Grep"],
  "embedding": {
    "model": "BAAI/bge-small-en-v1.5",
    "cache_dir": "/Users/athahar/work/claude-apps/playground/jannal/data/models-cache"
  }
}
```

Enables:
- Frontend to show the real router mode and thresholds
- Easier debugging of `router-state.json` load issues
- Future UI settings/debug panels

### `GET /api/router/status`

Purpose:
- Return runtime router health and readiness information.
- Make shadow-mode behavior understandable when embeddings are unavailable or degraded.

Exact response shape for v1:

```json
{
  "schema_version": 1,
  "mode": "shadow",
  "runtime": {
    "embeddings_ready": true,
    "embeddings_failed": false,
    "rules_ready": true,
    "sticky_route_count": 3,
    "last_error": null,
    "last_error_at": null,
    "last_metrics_refresh_at": "2026-03-13T21:30:00.000Z"
  },
  "capabilities": {
    "can_route": true,
    "can_auto_filter": false,
    "shadow_active": true
  },
  "metrics": {
    "window_event_count": 148,
    "eligible_rate": 0.61,
    "would_have_missed_rate": 0.018,
    "avg_confidence": 0.88,
    "median_estimated_tokens_saved": 18320
  },
  "model": {
    "name": "BAAI/bge-small-en-v1.5",
    "cache_dir": "/Users/athahar/work/claude-apps/playground/jannal/data/models-cache"
  }
}
```

Enables:
- A simple router status badge in the app header
- Clear “rules only” fallback messaging when embeddings are not ready
- Operational debugging without reading telemetry files manually

## Minimal UI Enhancements

Do not build a large router settings page yet.

Preferred minimal UI surfaces:

### 1. Header Badge

Add a compact router badge near the existing profile selector / connection status area.

Possible states:
- `Router Off`
- `Router Shadow`
- `Router Shadow (Rules Only)`
- `Router Auto`

Behavior:
- Keep it lightweight and non-intrusive
- Tooltip or click can later reveal more status details

Recommended placement:
- Next to the profile selector in the existing header
- Or between the profile selector and connection status

### 2. Request Detail Panel

Add a small router decision block in the request detail panel.

Recommended fields:
- Router mode
- `matched_by`
- confidence
- selected groups
- estimated savings
- whether the request was eligible
- “forwarded all tools” when in shadow mode

Recommended placement:
- In the right-side request detail summary area
- Above the per-segment breakdown

### 3. Optional Debug Popover

Optional future enhancement:
- click the header badge to open a small debug popover or modal

Potential fields:
- embeddings ready / failed
- cache path
- sticky route count
- last router error
- last metrics refresh

This is lower priority than the header badge and detail-panel block.

## Why These Enhancements Matter

Without these read-only APIs and lightweight UI surfaces:
- the frontend must guess router state from WebSocket payloads
- users cannot tell whether shadow mode is active
- debugging embeddings failures becomes opaque
- telemetry may exist, but the product remains hard to inspect

These enhancements keep the router understandable without expanding scope into a full management interface.
