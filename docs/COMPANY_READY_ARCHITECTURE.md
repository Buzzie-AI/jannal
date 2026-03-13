# Jannal — Company-Ready Architecture

High-level architecture plan for making Jannal useful at a company level. This document outlines the design for the **company-ready set** of features.

---

## Company-Ready Set (Phase 1)

| # | Feature | Description |
|---|---------|-------------|
| 1 | **Profile export/import** | Share profiles across teams |
| 2 | **Budget alerts** | Daily/weekly cost limits with notifications |
| 3 | **Audit log** | Basic logging of key actions |
| 4 | **Cost allocation tags** | Project/team labels on usage |
| 5 | **Central dashboard** | Aggregate data from multiple Jannal instances |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           COMPANY DEPLOYMENT MODEL                               │
└─────────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │  Developer A │     │  Developer B │     │  Developer C │
  │  (Claude)    │     │  (Claude)    │     │  (Claude)    │
  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
         │                    │                    │
         ▼                    ▼                    ▼
  ┌──────────────────────────────────────────────────────────┐
  │              Jannal Proxy (per-dev or shared)              │
  │  • Cost allocation tags (project, team)                    │
  │  • Budget alerts                                           │
  │  • Audit log                                               │
  │  • Profile import/export                                   │
  └──────────────────────────┬─────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
  ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
  │  Anthropic   │   │  Local       │   │  Central         │
  │  API         │   │  Storage     │   │  Dashboard       │
  │              │   │  (profiles,  │   │  (optional)      │
  │              │   │   audit log) │   │  aggregates from │
  └──────────────┘   └──────────────┘   │  multiple nodes  │
                                        └──────────────────┘
```

---

## Feature Architecture

### 1. Profile Export/Import

**Goal:** Share tool-filtering profiles across developers and teams.

**Current state:** Profiles stored in `profiles.json` locally.

**Design:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Profile Export/Import                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Export format (JSON):                                           │
│  {                                                               │
│    "version": 1,                                                 │
│    "profiles": { "Coding Only": {...}, "Browser": {...} },       │
│    "exportedAt": "2025-03-13T...",                               │
│    "source": "team-backend"                                       │
│  }                                                               │
│                                                                  │
│  UI: Header dropdown → "Export profiles" / "Import profiles"     │
│  Import: Merge or replace; conflict resolution for same names    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- **Frontend:** Export button (download JSON), Import button (file picker → parse → merge)
- **Storage:** No server change; export/import is client-side only
- **Optional:** Shared profile URL (e.g. internal URL to team's canonical profiles.json) for "Load from URL"

**Data flow:**
```
User clicks Export → JSON built from state.profiles → Blob download
User clicks Import → File picker → Parse JSON → Merge into profiles → Save → Broadcast
```

---

### 2. Budget Alerts

**Goal:** Notify when daily or weekly spend exceeds a limit.

**Design:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Budget Alerts                                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Config (stored in localStorage or config file):                 │
│  {                                                               │
│    "dailyLimit": 10.00,      // $ per day                        │
│    "weeklyLimit": 50.00,     // $ per week                       │
│    "notifyAt": 0.8,          // notify at 80% of limit            │
│    "notifications": true     // browser notifications             │
│  }                                                               │
│                                                                  │
│  Triggers:                                                       │
│  • On each turn cost (addDailyCost) → check daily total           │
│  • On each turn cost → check weekly total (rolling 7 days)       │
│  • Browser Notification API when threshold crossed               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- **session.js:** `getDailyCost`, `getWeeklyCost`, `checkBudgetAlerts(cost)`
- **New: config.js or budget config in session.js:** Load/save budget settings
- **render.js:** Show warning badge in header when approaching limit
- **Browser Notifications:** Request permission; show when limit hit

**Data flow:**
```
Turn completes → addDailyCost → checkBudgetAlerts → if over threshold → Notification + UI badge
```

---

### 3. Audit Log

**Goal:** Log key actions for compliance and debugging.

**Design:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Audit Log                                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Events to log:                                                  │
│  • profile_created, profile_deleted, profile_switched             │
│  • profile_imported, profile_exported                             │
│  • budget_alert_triggered                                         │
│  • session_cleared                                                │
│  • (optional) request_proxied with metadata (no PII)             │
│                                                                  │
│  Log entry format:                                                │
│  {                                                               │
│    "ts": 1710345600000,                                          │
│    "event": "profile_created",                                   │
│    "detail": { "name": "Coding Only", "toolCount": 5 },           │
│    "source": "ui"                                                 │
│  }                                                               │
│                                                                  │
│  Storage: audit.json (append-only, rotate at N entries)           │
│  UI: Settings/Admin panel with log viewer (optional)              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- **Server:** `auditLog(event, detail)` → append to file
- **Client:** Call `POST /api/audit` for UI-triggered events (or server logs proxy events)
- **Storage:** `audit.json` or `audit/YYYY-MM-DD.json` for rotation

**Data flow:**
```
User action → API call or WS message → Server appends to audit log
```

---

### 4. Cost Allocation Tags

**Goal:** Tag usage by project, team, or cost center for chargeback.

**Design:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Cost Allocation Tags                                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Tag source (one of):                                            │
│  A) Environment variable: JANNAL_TAG=project:api-gateway          │
│  B) Request header: X-Jannal-Tag: team:backend                    │
│  C) UI selector: User picks tag before/during session            │
│                                                                  │
│  Tag format: "category:value" (e.g. project:xyz, team:platform)   │
│  Multiple tags: comma-separated or multiple headers              │
│                                                                  │
│  Storage: Each turn stores tags; daily cost breakdown by tag      │
│  Export: CSV/JSON includes tags for BI integration                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**
- **Server:** Read `X-Jannal-Tag` or `JANNAL_TAG` env; attach to analysis
- **Turn object:** `tags: ["project:api", "team:backend"]`
- **session.js:** `getDailyCostByTag()` for breakdown
- **UI:** Tag selector in header; show tag on turn cards

**Data flow:**
```
Request arrives → Extract tags from header/env → Attach to analysis → Store with turn
```

---

### 5. Central Dashboard

**Goal:** Aggregate usage from multiple Jannal instances (team/org view).

**Design:**

```
┌─────────────────────────────────────────────────────────────────┐
│  Central Dashboard (Optional Component)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Deployment options:                                             │
│                                                                  │
│  A) Push model: Each Jannal instance POSTs summary to central    │
│     • Endpoint: POST /api/report (central server)                 │
│     • Payload: { instanceId, tags, dailyCost, turnCount, ... }   │
│     • Frequency: On turn complete, or batched every N min        │
│                                                                  │
│  B) Pull model: Central server scrapes/polls Jannal instances    │
│     • Each Jannal exposes GET /api/summary (optional, secured)   │
│     • Central fetches periodically                               │
│                                                                  │
│  C) Shared storage: All instances write to same DB/object store   │
│     • e.g. SQLite file on NFS, or S3                            │
│     • Central dashboard reads from shared store                  │
│                                                                  │
│  Central dashboard (separate app or mode):                       │
│  • Aggregate cost by tag, by day, by instance                    │
│  • Simple UI: table + charts                                     │
│  • Auth: API key or SSO (future)                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Recommendation for Phase 1:** Start with **Push model** — minimal change to Jannal; add optional `JANNAL_REPORT_URL` env. When set, POST anonymized summary on each turn. Central dashboard is a separate minimal service.

---

## Implementation Phases

### Phase 1a — Local Features (No new services)
| Feature | Effort | Dependencies |
|---------|--------|--------------|
| Profile export/import | Low | None |
| Budget alerts | Low | session.js, Notifications API |
| Audit log | Low | server.js, file append |
| Cost allocation tags | Medium | server.js, env/header parsing |

### Phase 1b — Central Dashboard (New service)
| Feature | Effort | Dependencies |
|---------|--------|--------------|
| Report endpoint (push) | Low | Optional env var |
| Central dashboard app | Medium | New repo or `/dashboard` in Jannal |

---

## File Structure (Proposed)

```
jannal/
├── server.js                 # + audit log, tags, report push
├── src/
│   ├── session.js           # + budget alerts, getDailyCostByTag
│   ├── profiles.js          # + export/import
│   ├── config.js            # NEW: budget config, tag selector
│   └── ...
├── docs/
│   └── COMPANY_READY_ARCHITECTURE.md
├── profiles.json
├── audit.json               # NEW: audit log
└── config.json              # NEW (optional): budget, report URL
```

---

## Configuration (Company Mode)

Optional `config.json` or env vars for company deployment:

```json
{
  "budget": {
    "dailyLimit": 10,
    "weeklyLimit": 50,
    "notifyAt": 0.8
  },
  "reporting": {
    "url": "https://internal-dashboard.company.com/api/report",
    "apiKey": "optional-auth"
  },
  "audit": {
    "enabled": true,
    "maxEntries": 10000
  }
}
```

---

## Security Considerations

| Concern | Mitigation |
|---------|------------|
| Audit log contains metadata | No PII; no prompt content; only event types + counts |
| Report URL receives usage data | Use HTTPS; optional API key auth; anonymize instance ID |
| Budget config | Stored locally; no secrets in config |
| Tags | Validate format; sanitize to prevent injection |

---

## Success Metrics

- **Profile export/import:** Teams can share profiles in < 1 min
- **Budget alerts:** 100% of configured limits trigger notification
- **Audit log:** All profile/budget events logged with timestamp
- **Cost tags:** Export includes tags; daily breakdown by tag available
- **Central dashboard:** Aggregated view from N instances with < 5 min latency

---

## Next Steps

1. **Review** this architecture with stakeholders
2. **Prioritize** Phase 1a features (profile export/import first — lowest effort)
3. **Implement** in order: Profile export/import → Budget alerts → Audit log → Tags → Dashboard
4. **Iterate** based on early company adopters
