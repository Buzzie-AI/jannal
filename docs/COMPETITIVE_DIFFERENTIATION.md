# Jannal Competitive Differentiation

> Deep research on how Jannal differs from competitors and why it can become a differentiated product that enterprises and developers want.

**Document version:** 1.0  
**Last updated:** March 2025  
**Status:** Draft for review  
**Companion doc:** [ENTERPRISE_STRATEGY.md](./ENTERPRISE_STRATEGY.md)

---

## Executive Summary

Jannal occupies a **unique position** in the LLM proxy/observability landscape: it is the only tool that combines **real-time visual context inspection** with **interactive MCP tool filtering** for Anthropic/Claude Code workflows. Competitors either visualize (Context Lens) or filter (liteLLM), but none offer both in a developer-first, local-first package. This document synthesizes competitive research and articulates why Jannal can win with both developers and enterprises.

---

## 1. The Problem: MCP Token Bloat

### 1.1 The Pain (Validated by Research)

MCP (Model Context Protocol) token bloat is a **documented, severe pain point** for Claude Code developers:

| Finding | Source |
|---------|--------|
| 67,000 tokens consumed connecting just 4 MCP servers | Claude Code GitHub issues |
| Docker MCP server with 135 tools = ~125,000 tokens alone | Industry analysis |
| 50–98% of 200K context window consumed by tool metadata before work starts | Claude Code #13717 |
| **69% of Opus context = tool definitions** (16.4K tokens) re-sent every turn | Context Lens analysis (DEV.to) |
| "Like a surgeon performing brain surgery wearing a backpack with garden equipment" | Lars de Ridder, Context Lens author |

**Developer workflow impact:** Restart sessions to reconfigure servers, predict tool requirements at session start, choose between context overhead and limiting MCP servers.

### 1.2 Who Addresses This?

| Solution | Approach | Limitation |
|----------|----------|------------|
| **Claude Code Tool Search** | Native lazy loading when tools exceed ~10% of context | Claude Code only; requires Claude's implementation |
| **liteLLM MCP Semantic Filter** | Semantic matching, return top-K relevant tools | Config-based; no UI; requires embedding model |
| **liteLLM allowed_tools** | Config allowlist/blocklist per MCP server | Static config; no per-session switching |
| **Jannal** | **Interactive UI**: click to disable, save profiles, switch on the fly | Anthropic-only; local proxy |

---

## 2. Competitive Landscape (Deep Dive)

### 2.1 Context Lens — Closest Visual Competitor

| Attribute | Context Lens | Jannal |
|-----------|--------------|--------|
| **Purpose** | Context window visualizer | Context inspector + **tool filter** |
| **Visualization** | ✅ Real-time composition breakdown | ✅ Real-time composition breakdown |
| **Segments shown** | System, tools, history, tool results, thinking | System, tools, messages, tool results |
| **Tool filtering** | ❌ None | ✅ **Interactive profiles** |
| **Providers** | OpenAI, Anthropic, Google (framework-agnostic) | Anthropic only |
| **Deployment** | Local proxy (port 4040), UI (4041) | Local proxy + UI (single port) |
| **Key insight** | "Flags issues like oversized tool results" | **Fixes them** by stripping tools before request |
| **Stars** | ~253 (GitHub) | — |

**Context Lens author's own finding:** "Nearly 70% of Opus's context window is tool definitions... The model itself is surgical, but it's like a surgeon performing brain surgery wearing a backpack with garden equipment."

**Jannal's answer:** Remove the backpack. Strip unused tools before the request hits the API.

### 2.2 liteLLM — Multi-Provider Proxy Leader

| Attribute | liteLLM | Jannal |
|-----------|---------|--------|
| **Focus** | Multi-provider (OpenAI, Anthropic, Google, etc.) | Anthropic-only |
| **UI** | Admin UI (enterprise); no context inspector | **Full visual inspector** |
| **Tool filtering** | Config: semantic filter, allowed_tools | **UI: click, profile, switch** |
| **Cost tracking** | Spend API, budgets, virtual keys | Per-request cost, session, daily |
| **Auth** | JWT, SSO, key management | None (local) |
| **Enterprise** | SOC 2, audit logs, secret managers | Roadmap |
| **Target** | 100+ users, 10+ AI use cases | Developers, Claude Code teams |

**liteLLM's strength:** Breadth, enterprise features, multi-provider.  
**liteLLM's gap:** No visual context breakdown; tool filtering is config-driven, not interactive.

### 2.3 ProxyGuard — Commercial AI Gateway

| Attribute | ProxyGuard | Jannal |
|-----------|------------|--------|
| **Focus** | Unified endpoint, cost control, failover | Context inspection, tool filtering |
| **UI** | Analytics dashboard | **Segment-level context inspector** |
| **Tool filtering** | ❌ None | ✅ Core feature |
| **Deployment** | Cloud / managed | Local, self-hosted |
| **Use case** | Product teams, production apps | Developers, Claude Code, MCP workflows |

**ProxyGuard's strength:** Production reliability, budgets, audit.  
**ProxyGuard's gap:** No context visibility; no tool filtering; cloud-first.

### 2.4 Other Tools

| Tool | What it does | Jannal overlap |
|------|--------------|----------------|
| **ExplainLLM Context Visualizer** | Web-based prompt vs. context limit | Visualization only; no proxy |
| **ctxlens** (dabit3) | CLI token analysis across files | Different: static analysis, not live proxy |
| **Letta Context Window Viewer** | Agent dev: real-time breakdown | Agent framework–specific |
| **Gravitee Agent Mesh** | API management for AI | Enterprise API mgmt; no inspector |

---

## 3. Jannal's Differentiation Matrix

### 3.1 Feature Comparison

| Feature | Context Lens | liteLLM | ProxyGuard | Jannal |
|---------|:------------:|:-------:|:----------:|:------:|
| Visual context breakdown | ✅ | ❌ | ❌ | ✅ |
| Real-time segment view | ✅ | ❌ | ❌ | ✅ |
| **Interactive tool filtering** | ❌ | Config only | ❌ | ✅ |
| **Named profiles** (Coding Only, etc.) | ❌ | ❌ | ❌ | ✅ |
| **"From this turn" quick profile** | ❌ | ❌ | ❌ | ✅ |
| **MCP server grouping** | ❌ | Partial | ❌ | ✅ |
| **Never-used tool indicator** | ❌ | ❌ | ❌ | ✅ |
| **Tool cost ranking** | ❌ | ❌ | ❌ | ✅ |
| Anthropic count_tokens integration | ❌ | ❌ | ❌ | ✅ |
| Request latency (TTFT, duration) | ❌ | ❌ | ❌ | ✅ |
| Local-first, no key storage | ✅ | Self-host | ❌ | ✅ |
| Multi-provider | ✅ | ✅ | ✅ | ❌ |
| Enterprise auth (SSO, etc.) | ❌ | ✅ | ✅ | Roadmap |

### 3.2 The "Only" Statement

**Jannal is the only tool that combines:**

1. **Visual context inspector** — See exactly what fills your context (system, tools, messages, results) in real time  
2. **Interactive tool filtering** — Disable tools via UI, save profiles, switch without restarting  
3. **Anthropic-native** — Built for Claude Code and MCP; count_tokens, segment types, cost tracking  
4. **Local-first** — Runs on your machine; API key never stored; privacy by design  

No competitor offers all four.

---

## 4. Why Developers Want This

### 4.1 Developer Pain Points (Research-Backed)

1. **"I don't know what's eating my tokens"** → Jannal's context bar and segment breakdown  
2. **"I have 40+ MCP tools but only need 5 for this task"** → Jannal's tool filtering and profiles  
3. **"Tool definitions dominate my context"** → Jannal strips them before the request  
4. **"I want to optimize but have no visibility"** → Jannal's cost tracking, tokens-saved badge, tool cost ranking  
5. **"I need to share config with my team"** → Jannal's profile import/export  

### 4.2 Developer Psychology (From Pricing Research)

- **73% prefer self-service evaluation** — Jannal is free, local, no signup  
- **Transparent pricing** — No hidden costs; you see exactly what you'd pay  
- **Test before commit** — Run Claude Code through Jannal, see impact, then decide  
- **Community trust** — Open source core; no lock-in  

### 4.3 Workflow Fit

| Scenario | Without Jannal | With Jannal |
|----------|----------------|-------------|
| Starting a coding session | Connect all MCP servers, hope for the best | Select "Coding Only" profile, strip 30 unused tools |
| Debugging high token usage | Guess from logs | Open inspector, see 70% is tool definitions |
| Trying a new MCP server | Add it, restart, see if it helps | Add it, see token impact in real time, disable if not needed |
| Sharing setup with teammate | "Here's my mcp.json" | Export profile, teammate imports |

---

## 5. Why Enterprises Want This

### 5.1 Enterprise Requirements (From Gartner & Market Research)

| Requirement | How Jannal Addresses (Today / Roadmap) |
|-------------|----------------------------------------|
| **Cost visibility** | ✅ Per-request cost, session total, daily summary |
| **Cost control** | ✅ Tool filtering reduces tokens; roadmap: budgets, alerts |
| **Audit trail** | Roadmap: persistent request log, who/what/when |
| **Governance** | ✅ Profiles = tool policies; roadmap: org profiles, RBAC |
| **Compliance** | Local-first = data stays on-prem; roadmap: retention, GDPR controls |
| **No key storage** | ✅ API key passes through; never stored |

### 5.2 Enterprise Differentiation

Enterprises adopting Claude + MCP face:

1. **Token spend explosion** — 40+ tools × many developers = runaway costs  
2. **Lack of visibility** — "We're spending $X on Claude but don't know where"  
3. **Tool sprawl** — No policy on which tools are allowed per team/project  

**Jannal's enterprise value proposition:**

- **See** — Visual breakdown of every request; know where tokens go  
- **Control** — Tool filtering = instant token reduction; profiles = policies  
- **Scale** — Roadmap: org profiles, RBAC, audit logs, cost allocation  

### 5.3 Competitive Moat for Enterprise

| Competitor | Enterprise angle | Jannal's counter |
|------------|------------------|------------------|
| liteLLM | Multi-provider, spend API, auth | Anthropic depth; visual inspector; interactive filtering |
| ProxyGuard | Reliability, budgets, audit | Context visibility; tool filtering; local/self-host |
| Context Lens | Visualization | **+ Tool filtering**; profiles; Anthropic-native |

**Moat:** The combination of visualization + interactive filtering + Anthropic/MCP focus is defensible. General-purpose gateways won't replicate the developer UX; visualization-only tools won't add filtering without significant scope creep.

---

## 6. Gaps and Risks

### 6.1 Current Gaps

| Gap | Impact | Mitigation |
|-----|--------|------------|
| Anthropic-only | Limits market vs. multi-provider | Double down on Anthropic/MCP; expand later if needed |
| No enterprise auth | Blocks enterprise adoption | Roadmap: API key, OIDC, SSO |
| No persistent log | No audit trail | Roadmap: DB-backed request log |
| Context Lens exists | Overlap on visualization | Tool filtering is the differentiator; lean into it |

### 6.2 Risks

| Risk | Mitigation |
|------|------------|
| Claude Code adds native tool filtering | Jannal still offers visualization, profiles, cost tracking; proxy layer allows enterprise features |
| Context Lens adds tool filtering | First-mover in combined solution; community and UX matter |
| liteLLM adds visual inspector | liteLLM is API-first; Jannal is UX-first; different audiences |

---

## 7. Positioning Statement

**For** developers and teams using Claude Code with MCP tools  
**Who** struggle with token bloat and lack of visibility into context usage  
**Jannal** is a context inspector and proxy  
**That** visualizes your context in real time and lets you filter out unused tools before requests hit the API  
**Unlike** liteLLM (config-based, no UI) and Context Lens (visualization only)  
**Jannal** is the only tool that lets you **see** and **fix** context bloat in one place.

---

## 8. Recommendations

### 8.1 For Product

1. **Lead with tool filtering** — It's the unique fix; visualization is table stakes (Context Lens does it).  
2. **Amplify "From this turn"** — No competitor has this; it's a workflow win.  
3. **Profile import/export** — Enables team sharing; low effort, high value.  
4. **Document the pain** — Use research (67K tokens, 69% tool definitions) in marketing.

### 8.2 For Enterprise Strategy

1. **Keep core free** — Tool filtering + inspector = adoption driver.  
2. **Gate by persistence and auth** — DB log, org profiles, SSO = natural enterprise upsell.  
3. **Anthropic partnership** — Explore referral, co-marketing, or integration.  
4. **Benchmark against Context Lens** — Same space; ensure Jannal is the "filtering" answer.

### 8.3 For Go-to-Market

1. **Target Claude Code + MCP users** — Where the pain is highest.  
2. **Content:** "How we cut our Claude token bill 40% with tool filtering"  
3. **Community:** GitHub, Anthropic forums, MCP community.  
4. **Differentiation message:** "Context Lens shows you the problem. Jannal lets you fix it."

---

## 9. References

- [Context Lens](https://github.com/larsderidder/context-lens) — Framework-agnostic context visualizer
- [I Intercepted 3,177 API Calls...](https://dev.to/larsderidder/i-intercepted-3177-api-calls-across-4-ai-coding-tools-heres-whats-actually-filling-your-context-36il) — Context Lens author analysis
- [liteLLM Enterprise](https://docs.litellm.ai/docs/proxy/enterprise)
- [liteLLM MCP Semantic Filter](https://docs.litellm.ai/docs/mcp_semantic_filter)
- [Claude Code MCP Token Bloat](https://github.com/anthropics/claude-code/issues/13717)
- [Claude Code Tool Search](https://medium.com/@joe.njenga/claude-code-just-cut-mcp-context-bloat-by-46-9-51k-tokens-down-to-8-5k-with-new-tool-search-ddf9e905f734)
- [ProxyGuard](https://proxyguard.dev/)
