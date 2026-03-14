# Jannal Enterprise Strategy & Monetization

> A research-backed strategy for evolving Jannal into an enterprise product that generates sustainable revenue while serving the developer community.

**Document version:** 1.0  
**Last updated:** March 2025  
**Status:** Draft for review

---

## Executive Summary

Jannal is a context-window inspector and proxy for the Anthropic API, with a unique focus on **tool filtering** and **token optimization** for Claude Code and MCP-heavy workflows. This document outlines a path to monetize Jannal through an **Open Core** model: keep the core free and open source, while offering enterprise features that address governance, compliance, and scale.

**Key opportunity:** The AI gateway market is projected to reach **$9.6B by 2032** (14.7% CAGR), with **70% enterprise adoption by 2028** (Gartner). MCP adoption is explosive—8M+ server downloads by April 2025—creating demand for tools that help enterprises control cost and governance in Claude/MCP workflows.

---

## 1. Market Analysis

### 1.1 AI Gateway & Proxy Market

| Metric | Value | Source |
|--------|-------|--------|
| AI Gateway market (2025) | $3.66B | Research and Markets |
| AI Gateway market (2032) | $9.61B | Research and Markets |
| CAGR | 14.70% | — |
| Enterprise-grade segment (2025) | $38.15M | LP Information |
| Enterprise-grade segment (2032) | $185M | LP Information |
| Enterprise adoption (2028) | 70% | Gartner 2025 Market Guide |

### 1.2 MCP & Claude Ecosystem

| Metric | Value | Source |
|--------|-------|--------|
| MCP server downloads (Nov 2024) | ~100K | Anthropic / industry |
| MCP server downloads (Apr 2025) | 8M+ | Industry estimates |
| MCP servers available | 5,800+ | Agentic AI Foundation |
| MCP clients | 300+ | — |
| Org adoption (2025 est.) | 90% | Enterprise adoption guides |
| Major deployments | Block (10K employees), Bloomberg, Amazon, Fortune 500 | Public reports |

**Implication:** Enterprises are rapidly adopting Claude + MCP. Jannal's tool-filtering and context-visualization capabilities directly address the pain of **token bloat from 40+ MCP tools** and **lack of visibility** into spend.

### 1.3 Competitive Landscape

| Product | Focus | Model | Key differentiator |
|---------|-------|-------|--------------------|
| **liteLLM** | Multi-provider proxy, routing, cost | Open Core, usage-based | Broad model support, spend API, virtual keys |
| **ProxyGuard** | AI gateway, budget enforcement | Commercial | Failover, audit trails |
| **Gravitee Agent Mesh** | API management for AI | Enterprise | Token optimization, agent orchestration |
| **LLM Gateway** | Cost breakdown in responses | — | Real-time cost in API response |
| **Jannal** | Anthropic-only, context inspection, tool filtering | Open source (today) | **Visual inspector**, **MCP tool filtering**, **developer-first UX** |

**Jannal's unique position:** Anthropic-focused, visual context breakdown, and **tool filtering** (strip unused MCP tools before the request hits the API). No direct competitor offers this combination for Claude Code workflows.

---

## 2. Monetization Strategy

### 2.1 Recommended Model: Open Core

**Rationale:** Open Core is the dominant model for developer tools (MongoDB, GitLab, Elastic, liteLLM). It preserves community trust, drives adoption through the free tier, and converts power users to paid when they hit governance/scale limits.

| Layer | Free (OSS) | Paid (Enterprise) |
|-------|------------|-------------------|
| **Core** | Proxy, inspector, tool filtering, profiles | Same |
| **Persistence** | localStorage, profiles.json | DB-backed, audit log |
| **Auth** | None (local) | API keys, OIDC, SSO |
| **Multi-user** | Single user | Teams, RBAC |
| **Compliance** | — | Audit logs, retention, GDPR controls |
| **Support** | Community | SLA, dedicated channel |

### 2.2 Pricing Models (Research-Backed)

Developer tools monetize best with **transparent, usage-aligned pricing**:

1. **Usage-based** — Charge per tokens proxied or requests. Best for infrastructure tools (Datadog, Sentry). Twilio reports 155% YoY spend expansion with usage-based.
2. **Seat-based** — Charge per user/seat. Best for collaboration (GitHub, GitLab).
3. **Hybrid** — Combine both. Tiered pricing yields **30% higher ARPU** than flat pricing (Monetizely research).

**Recommended for Jannal:**

| Tier | Target | Price | Gating |
|------|--------|-------|--------|
| **Free** | Individual devs, small teams | $0 | Current OSS feature set |
| **Pro** | Teams 5–50 | $X/user/month or $Y/tokens | DB persistence, org profiles, basic auth |
| **Enterprise** | 50+ users, compliance needs | Custom | SSO, audit logs, RBAC, SLA, support |

**Pricing discovery:** liteLLM uses "contact us" for enterprise. Consider a **generous free tier** (e.g., 100K tokens/month proxied) to drive adoption, then gate advanced features.

### 2.3 Feature Gating Principles

From developer-tool pricing research:

- **Never gate core functionality** — Inspector, basic filtering, cost visibility stay free.
- **Gate by sophistication and scale** — Audit logs, SSO, team management, extended retention.
- **Gate by compliance** — GDPR controls, SOC 2, data residency.
- **73% of developers prefer self-service evaluation** — Avoid forcing sales demos; offer trials.

---

## 3. Enterprise Feature Roadmap

### 3.1 Tier 1: Foundation (3–6 months)

| Feature | Description | Enterprise value |
|---------|-------------|------------------|
| **Persistent request log** | Store requests, costs, segments in SQLite/Postgres | Audit, debugging, compliance |
| **Auth (API key / OIDC)** | Require auth to use proxy | Access control |
| **Org profiles** | Shared tool-filtering profiles per team/project | Consistent policies |
| **Rate limiting** | Per-user/team request limits | Cost control, abuse prevention |
| **Docker / K8s** | Production deployment configs | Easy ops rollout |

### 3.2 Tier 2: Governance (6–12 months)

| Feature | Description | Enterprise value |
|---------|-------------|------------------|
| **RBAC** | Admin, viewer, user roles | Least-privilege access |
| **Policy engine** | Enforce tool allowlists, model restrictions, context limits | Central governance |
| **Cost allocation** | Tag by project/team, chargebacks | FinOps, budgeting |
| **Dashboards** | Aggregated usage, cost trends | Leadership visibility |
| **Export / REST API** | Bulk export, programmatic access | BI, integrations |

### 3.3 Tier 3: Platform (12+ months)

| Feature | Description | Enterprise value |
|---------|-------------|------------------|
| **SSO** | Okta, Azure AD, Google | Enterprise identity |
| **Webhooks** | Events to Slack, PagerDuty, etc. | Alerts, automation |
| **SIEM integration** | Splunk, Datadog | Security monitoring |
| **Multi-region** | Geo-distributed proxies | Latency, data residency |
| **SOC 2 / ISO 27001** | Certifications | Risk reduction, procurement |

### 3.4 Competitive Feature Parity (liteLLM reference)

liteLLM Enterprise features to consider:

- Key rotations, IP allowlists
- JWT auth, audit logs with retention
- Secret manager integrations (AWS, GCP, Azure, Vault)
- Team-based logging, GDPR disable-logging
- Spend reporting API, USD budget tracking
- Export to GCS, Azure Blob

---

## 4. Deployment Models

| Model | Target customer | Pros | Cons |
|-------|-----------------|------|------|
| **Self-hosted (single)** | Small teams | Full control, simple | No central management |
| **Self-hosted (fleet)** | Mid-size orgs | Central config, scaling | Ops burden |
| **VPC / private cloud** | Regulated industries | Data stays in VPC | Higher setup |
| **Managed SaaS** | Fast adoption | No ops, quick start | Less control |

**Recommendation:** Support self-hosted first (enterprise preference for data control), then offer managed cloud for lower-friction adoption.

---

## 5. Go-to-Market

### 5.1 Target Segments

1. **Developer teams using Claude Code** — Primary. Pain: token bloat, no visibility.
2. **Enterprises standardizing on Anthropic** — Need governance, cost control.
3. **MCP-heavy orgs** — 40+ tools, need filtering and optimization.

### 5.2 Channels

- **Product-led growth** — Free tier → value → upgrade when hitting limits.
- **Developer community** — GitHub, Anthropic ecosystem, MCP community.
- **Content** — Blog posts on token optimization, MCP best practices.
- **Partnerships** — Anthropic, Cursor (when base URL override ships).

### 5.3 Success Metrics

| Metric | Target |
|--------|--------|
| GitHub stars / forks | Growth rate |
| Active proxies (telemetry opt-in) | MAU |
| Free → Paid conversion | 2–5% (industry benchmark) |
| Enterprise trials | Pipeline |
| NPS (developers) | > 40 |

---

## 6. Technical Foundations for Enterprise

### 6.1 Architecture Additions

```
Current:  Proxy (server.js) + Inspector (SPA) + WebSocket
          
Enterprise:  + Database layer (Postgres/SQLite)
             + Auth middleware (API key, JWT, OIDC)
             + Config service (env → API)
             + Metrics (Prometheus/OpenTelemetry)
             + API versioning
```

### 6.2 Data Model (Minimal)

- **Organizations** — Tenant root
- **Users / Teams** — RBAC
- **Profiles** — Tool-filtering configs (org-scoped)
- **Requests** — Logged requests with segments, cost, latency
- **Audit log** — Who did what, when

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| **Community backlash** | Keep core free; gate only enterprise features |
| **Anthropic policy changes** | Diversify to OpenAI/others if needed (liteLLM multi-provider) |
| **Competition from liteLLM** | Double down on Anthropic + visual inspector + MCP filtering |
| **Low conversion** | Generous free tier, clear value prop, usage-based expansion |

---

## 8. Recommended First Steps

1. **Add persistent request log** — SQLite for single-node, Postgres for scale. Enables audit and analytics.
2. **Add auth** — API key or OIDC. Enables multi-user and access control.
3. **Org profiles** — Sync profiles from central store. Enables team policies.
4. **Docker + env config** — Production deployment. Enables enterprise rollout.
5. **Pricing page + waitlist** — Validate willingness-to-pay before building full platform.

---

## 9. References

- [liteLLM Enterprise Features](https://docs.litellm.ai/docs/proxy/enterprise)
- [liteLLM Billing](https://docs.litellm.ai/docs/proxy/billing)
- [Gartner 2025 AI Gateway Market Guide](https://landing.gravitee.io/gartner-2025-market-guide-ai-gateway)
- [MCP Enterprise Adoption Guide](https://guptadeepak.com/the-complete-guide-to-model-context-protocol-mcp-enterprise-adoption-market-trends-and-implementation-strategies/)
- [Open Source to Commercial SaaS](https://www.getmonetizely.com/articles/how-can-you-transition-from-open-source-to-commercial-saas)
- [Developer Tool Pricing Strategy](https://www.getmonetizely.com/articles/developer-tool-pricing-strategy-how-to-gate-technical-features-and-build-profitable-tiers-3a96f)
- [AI Gateway Market Report](https://www.researchandmarkets.com/reports/6148958/ai-gateway-market-global-forecast)

---

## Appendix A: liteLLM Enterprise Feature Checklist

For competitive parity, consider implementing:

- [ ] Key rotations
- [ ] IP-based access control
- [ ] JWT auth
- [ ] Audit logs with retention policy
- [ ] SSO for admin UI
- [ ] Secret manager integrations
- [ ] Team-based logging
- [ ] GDPR disable-logging per team
- [ ] Spend reporting API
- [ ] USD budget tracking
- [ ] Export to GCS / Azure Blob
- [ ] Max request/response size limits
- [ ] Required params enforcement
- [ ] Content moderation / guardrails

---

## Appendix B: Glossary

| Term | Definition |
|------|------------|
| **Open Core** | Free open-source core + paid enterprise features |
| **MCP** | Model Context Protocol — Anthropic's standard for AI-tool connections |
| **TTFT** | Time to first token — latency metric |
| **RBAC** | Role-based access control |
| **FinOps** | Financial operations — cost optimization discipline |
