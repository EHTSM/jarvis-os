# 10 — The 17-Company Strategy

**Status of this document:** Mixed. The *mechanism* (Company Factory, Workspace Mesh, Organization Network) is VERIFIED as real, existing code. The specific "17 companies" target is **founder-stated intent for this documentation project**, not a figure found anywhere in the codebase itself — treated here as PLANNED/aspirational and clearly marked as such throughout.

---

## The Idea

The founder's stated goal (per the mandate for this documentation set, echoing the README's "operate like a company of 10" framing) is to operate **up to 17 companies from one platform** — one founder, one AI runtime, one knowledge base, many separate businesses. This document assesses how much of the actual infrastructure required for that already exists in code today, and how much is still architecture work.

## What Exists Today (VERIFIED)

Three real, code-complete subsystems point directly at this goal:

### 1. Company Factory (`backend/routes/companyFactory.js`, `frontend/src/components/CompanyFactoryCenter.jsx`)

Lets an operator create a company record from an idea or name (with template auto-inference), track it through a 7-stage lifecycle (planning → building → testing → launch → growth → scale → maintenance), view a company grid filterable by stage, and view a per-company detail panel (blueprint, workspace, quality gates, risks, roadmap, KPIs). Backed by 6 services: `companyFactory.cjs`, `companyBlueprintEngine.cjs`, `companyWorkspaceBuilder.cjs`, `companyLifecycleEngine.cjs`, `companyDashboard.cjs`, `businessTemplateEngine.cjs`.

**Important context**: this backend was fully built in an earlier development phase but was unreachable from the UI (no nav entry) until 2026-07 — it was surfaced as part of the same "reality completion" effort that produced this documentation's primary source material. It also had a real bug (a dead `requireAuth` import, matching a pattern found elsewhere in the codebase) that was fixed when it was surfaced.

### 2. Workspace Mesh (`backend/routes/workspaceMesh.js`)

A real, extensive backend for multi-workspace coordination: a workspace registry (register/list/deregister, assign missions), a bootstrap/execute layer that routes commands to a workspace by capability, a coordinator for multi-workspace execution graphs, and a synchronization layer (context propagation, artifact sync, conflict resolution). Not yet wired to a frontend screen in the current nav — confirmed as backend-only at present.

### 3. Organization Network (`backend/routes/organizationNetwork.js`)

The most directly relevant subsystem: an org-to-org registry, inter-org collaboration, a capability exchange (discover/find-best-org/detect-gaps), governance (agreements, trust network, compliance), and an "evolution" engine. This is architecturally exactly what a multi-company platform needs — one organization per company, with real cross-org discovery and collaboration primitives.

**Caveat, consistent with the rest of this documentation's honesty standard**: these route files and their backing services are real and mounted, but functional depth was confirmed only at the "routes exist, services exist" level in this audit — not independently load-tested with real multi-org traffic.

## Workspace Isolation

**Real at the application-authorization layer, not real at the data layer.** Org RBAC and workspace membership checks were live-verified in the 2026-07-17 audit to correctly return 403 to a second identity attempting to read or modify another org's data. But this is enforced entirely in application code — there is no database schema or row-level isolation boundary behind it, because **there is no database**: all state is flat JSON files under `/data`. A single future bug in the application-layer authorization logic would have no backstop.

**This is the single blocking gap between today's system and 17 genuinely-isolated companies.** The 2026-07-17 audit states this in the most direct language available in the entire repository: *"No database-enforced tenant isolation — all state in flat `data/*.json` files ... this is the single largest piece of remaining engineering work, and it is architectural — not something patchable in a quick fix."*

## Shared AI

**Real today.** The 12-provider AI router (`aiService.js`) and the mission/agent runtime are singleton services shared across the whole application — there is no per-company AI provisioning today, which is consistent with a "shared AI, separate companies" model, though it also means AI usage/cost is not yet cleanly attributable per-company (see Financial Plan, [17_FINANCIAL_PLAN.md](17_FINANCIAL_PLAN.md)).

## Shared Knowledge

**Real today.** The knowledge graph (`knowledgeGraph.cjs`) and TF-IDF memory search are also singleton services. A genuinely multi-company deployment would need to decide whether knowledge should be shared across all 17 companies (as a founder's own accumulated expertise) or isolated per-company (to avoid leaking one portfolio company's information into another) — **this is a product decision that has not yet been made in code.**

## Separate Branding

**Not yet implemented.** No per-organization theming/branding system was found in this audit. The design system (`frontend/src/design/`, `brand.js`, `tokens.js` — see [13_UI_UX_STRATEGY.md](13_UI_UX_STRATEGY.md)) is currently a single, unified Ooplix brand applied globally. Per-company white-labeling would be new work.

## Separate Permissions

**Real today**, via the org RBAC layer described above — each organization already has its own role/permission scope, live-verified to enforce isolation at the authorization layer.

## Separate Analytics

**Partially real.** The business-intelligence and executive-dashboard subsystems compute real metrics, but whether they are cleanly scoped per-organization/per-company or computed globally was not independently re-verified line-by-line in this pass — flagged for a closer look before promising per-company analytics isolation to a real customer.

## Separate Billing

**Not yet implemented at the multi-company level.** The billing system (`billingService.js`) is account-scoped, not per-company. Running 17 separate companies with 17 separate billing relationships (e.g. if some are agencies with their own paying customers) would require new billing architecture layered on top of the existing single-account model.

## Gap Summary — What Stands Between Today and 17 Companies

| Requirement | Status |
|---|---|
| Create/track a company through a lifecycle | REAL (Company Factory) |
| Cross-company/org collaboration primitives | REAL (Organization Network) — functional depth not fully load-tested |
| Multi-workspace command routing | REAL (Workspace Mesh) — not yet wired to a frontend screen |
| Application-layer permission isolation between companies | REAL — live-verified |
| **Database-level tenant isolation** | **NOT REAL — the top blocker** |
| Shared AI/knowledge across companies | REAL, but knowledge-isolation policy is an unmade product decision |
| Per-company branding | NOT IMPLEMENTED |
| Per-company billing | NOT IMPLEMENTED |
| Per-company analytics isolation | PARTIAL — not independently confirmed |

**Bottom line for a new Project Manager**: the founder's 17-company vision is architecturally *aimed at* by real, existing code (Company Factory + Workspace Mesh + Organization Network is a coherent, deliberate design for exactly this purpose) — this is not a vision with zero technical grounding. But the database-level tenant isolation gap is real, is explicitly out of scope for any "quick fix" mission this repository's own audits have run, and is the correct place to scope the next major architecture project if the 17-company vision is the priority.

---

*Next: [11_AUTONOMOUS_CAPABILITIES.md](11_AUTONOMOUS_CAPABILITIES.md) for what "autonomous" actually means in this codebase.*
