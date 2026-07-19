# Multi-Organization Implementation Roadmap

Status: planning document. No code written, no architecture redesigned — this converts the approved Multi-Organization Architecture Blueprint into milestones grounded in the current repository, per `MULTI_ORG_GAP_ANALYSIS.md`, `MIGRATION_PLAN.md`, `CONNECTOR_ISOLATION_PLAN.md`, and `AI_ISOLATION_PLAN.md`.

Ten milestones. Sequencing rationale is in `IMPLEMENTATION_SEQUENCE.md` — this document specifies what each milestone contains, not the order to run them in (though the numbering below happens to match the recommended order).

---

## M1 — Organization Foundation (incl. Workspace Reconciliation)

**Goal**: Establish one coherent tenant identifier. Reconcile the two independent tenancy systems found in the repository — `organizationService.cjs` (Org→Dept→Team, `orgId`-keyed) and `workspaceService.cjs` (flat, `accountId`-keyed) — into a single hierarchy matching the blueprint (Org → Workspace → Team). Add atomic writes to `organizations.json`. Add the `portfolio_owner` role for Founder mode.

**Files affected**:
- `backend/services/organizationService.cjs` — add `portfolio_owner` to `ROLE_HIERARCHY`, add Workspace as a formal child node type alongside Department/Team, fix `_read()`/`_write()` to use temp-file + rename.
- `backend/services/workspaceService.cjs` — becomes org-aware; every Workspace row gains a required `orgId`.
- `backend/middleware/workspaceMiddleware.cjs` — merges its role checks to defer to `orgMiddleware.cjs`'s permission model, or is retired in favor of a unified middleware (decision needed at implementation time, not here).
- `backend/routes/workspace.js` and the eight route files currently using `attachWorkspace`/`requireRole` (`security.js`, `automation.js`, `plugins.js`, `analytics.js`, `governance.js`, `extensions.js`, `admin.js`, `marketplace.js`) — each needs its middleware chain updated.
- `data/organizations.json`, `data/workspaces.json`.

**Risk**: High — this is the largest structural change in the program. Wrong reconciliation can silently change effective permissions for existing Workspace users across eight live route files.

**Migration**: Every existing Workspace row needs an `orgId`. For Workspaces with no natural parent Organization (the common case, since these systems evolved independently), auto-create a shim Organization per orphaned Workspace, named after the Workspace, owned by the Workspace's existing Owner. This preserves current access exactly — one Workspace, one implicit Org — without forcing any real-world reorganization on day one.

**Backward compatibility**: Existing Workspace API contracts (routes, response shapes) do not change externally. Internally, every Workspace-scoped request now also resolves an `orgId`, but this is invisible to existing clients as long as the shim-org auto-creation runs before the new middleware goes live.

**Rollback**: Ship behind a feature flag that gates whether `workspaceMiddleware.cjs` consults the new org-aware path or the legacy standalone path. Flip off, and the system behaves exactly as pre-M1. Shim orgs created during a rolled-back attempt are inert (nothing reads them if the flag is off) and can be cleaned up or left in place harmlessly.

---

## M2 — Workspace Isolation

**Goal**: With Workspace now a real child of Organization (from M1), enforce that a Workspace's data (whatever it stores — automations, plugins, analytics, per the eight consuming route files) cannot be read across Organization boundaries, not just across Workspace boundaries as today.

**Files affected**: The same eight route files from M1, this time changing query logic (not just middleware) to filter by the resolved `orgId` in addition to `workspaceId`. `backend/middleware/orgMiddleware.cjs` — the `attachOrg` membership-check gap (see Gap Analysis §3) is fixed here at the latest, ideally earlier as an out-of-band patch (see Implementation Sequence note).

**Risk**: Medium. Isolated to the eight known consuming files; the risk is missing a ninth undiscovered consumer, mitigated by a repo-wide grep for `attachWorkspace` before considering this milestone done.

**Migration**: None beyond M1's — this milestone is enforcement logic, not new data shape.

**Backward compatibility**: A Workspace's own data is unaffected; only cross-org access (which shouldn't have existed anyway) is newly blocked. Any existing behavior that accidentally relied on cross-org Workspace visibility (unlikely, but possible given the systems were unconnected) would break — flagged as a risk to watch in staging, not assumed absent.

**Rollback**: Same feature-flag mechanism as M1; the query-filter change is additive (a `WHERE orgId = ?` clause) and trivially removable per file.

---

## M3 — Organization Billing

**Goal**: Move billing from purely account-scoped to entity-scoped (Account, Organization, or Enterprise Account), per `MIGRATION_PLAN.md` §2.

**Files affected**: `backend/services/billingService.js` (add `orgId` to `BillingRecord`, extend `checkUsageQuota` to accept an org context), `backend/services/usageMetering.cjs` (extend history filtering to `orgId` in addition to `accountId`), `backend/routes/billing.js`, `frontend/src/billingApi.js`.

**Risk**: Medium — revenue-adjacent. A bug here either over-bills or under-meters real paying customers.

**Migration**: Per Migration Plan §2 — synthetic 1-member Organization auto-created for every existing `accountId` billing record, ledger introduced in shadow mode (both old and new quota logic run, compared, discrepancies logged) before cutover.

**Backward compatibility**: Existing account-scoped trial/plan/quota behavior is unchanged for any customer who hasn't joined a multi-member Organization — the synthetic org is invisible to them.

**Rollback**: Shadow mode means the ledger-backed path can be disabled at any time before cutover with zero customer-visible effect. After cutover, rollback requires reverting `checkUsageQuota` to read the legacy per-account path, which remains intact (not deleted) throughout this milestone.

---

## M4 — Organization Connectors

**Goal**: Org-scope the connector credential vault, per `CONNECTOR_ISOLATION_PLAN.md`.

**Files affected**: `backend/services/secretVault.cjs` (`_vkey` gains `orgId`), `backend/services/integrationConnectors.cjs` (all 40 `connect*` functions gain a leading `orgId` parameter), every route that currently calls a `connect*` function directly.

**Risk**: High-consequence if done wrong (credential leak across tenants), but low-risk *process* because the rollout is additive with a sentinel default (see Connector Isolation Plan rollout shape) — no existing credential stops working at any point in this milestone.

**Migration**: Sentinel-keyed re-keying of the existing vault (`"__platform__"` org), zero behavior change on day one; explicit per-connector "claim for this org" as a separate, later, human-triggered action — not part of this milestone's automated migration.

**Backward compatibility**: Total, by design — the three-tier fallback (`org-scoped → sentinel-scoped → env var`) means no deployment (including the single-user Electron build) changes behavior unless it explicitly starts passing real `orgId`s.

**Rollback**: Parameter-addition changes revert cleanly. The one-way-door caveat noted in the Connector Isolation Plan (credentials already explicitly claimed by a real org) applies only once real-world usage of the "claim" action begins, which is intentionally a separate, later step from this milestone.

---

## M5 — Organization AI Memory

**Goal**: Enforce `orgId` at write and read time across the memory subsystem, per `AI_ISOLATION_PLAN.md`.

**Files affected**: `backend/services/missionMemory.cjs`, `backend/services/memoryPersistenceLayer.cjs`, `backend/services/engineeringMemoryEngine.cjs`, `backend/services/semanticMemorySearch.cjs`, `backend/services/memoryIntelligenceEngine.cjs`, `backend/services/knowledgeGraph.cjs` (extending its existing partial org-awareness).

**Risk**: High breadth (five+ independent services), but each individual change is a straightforward mandatory-parameter addition. The real risk is an overlooked call site silently continuing to query without an `orgId` and getting a hard error in production rather than being caught at review time — mitigated by the service-by-service rollout in the AI Isolation Plan, each shippable and testable independently.

**Migration**: Sentinel-tagged backfill for existing memory records lacking a resolvable `orgId` (the common case today), explicitly not auto-assigned to any real org — see Migration Plan §4.

**Backward compatibility**: This is the one milestone in the roadmap that is **not** silently backward compatible by design — a missing `orgId` on a memory read must fail loudly, not fall back to global scope, because global-scope fallback is exactly the bug being fixed. Every call site must be updated in the same change, tracked via the enumerable grep-and-fix approach described in the AI Isolation Plan.

**Rollback**: Per-service revert restores prior (unsafe but functional) global-read behavior without data loss, since no data is deleted or reassigned by this milestone — only a required filter dimension is added.

---

## M6 — Cross-Organization Sharing (Grants)

**Goal**: Introduce the Grants object from the approved blueprint — the mechanism by which Founder portfolio access, Enterprise policy inheritance, Agency client access, and ad hoc collaboration all become one auditable, revocable, first-class construct rather than four bespoke mechanisms.

**Files affected**: New service, e.g. `backend/services/grantsService.cjs`; new store (SQLite table by this point, per Migration Plan sequencing, or JSON if M1's storage decision hasn't migrated Organizations yet); `orgMiddleware.cjs` extended to consult grants when `attachOrg`/`requireOrgPermission` resolve access to an org the requester doesn't directly belong to.

**Risk**: Medium. This is new surface area (no existing analog to reconcile, unlike M1), which makes it lower-risk than M1 despite being architecturally significant — there's no legacy behavior to accidentally break.

**Migration**: None — Grants is new. The Founder portfolio and Enterprise policy grant *types* are the ones actually exercised by M7/M8 below; Agency and ad hoc grant types can ship later without blocking those milestones.

**Backward compatibility**: Fully additive — `orgMiddleware.cjs`'s existing direct-membership check path is untouched; grants are consulted only as an additional path, never a replacement.

**Rollback**: Grants table/service can be disabled entirely (grant-consulting code path short-circuits to "no grants found") with the rest of the system unaffected, since nothing yet depends on grants existing until M7.

---

## M7 — Portfolio Dashboard (Founder Mode)

**Goal**: Ship the Founder mode UX — cross-org portfolio view, org switcher, `portfolio_owner` role from M1 made visible and usable — as the first mode built on the full M1-M6 foundation. Chosen first among the mode-specific milestones because it exercises the multi-org and Grants machinery with the smallest UX surface (per the original blueprint's sequencing note).

**Files affected**: Frontend — `frontend/src/App.jsx`, `frontend/src/components/BusinessOS.jsx`, `frontend/src/components/CommandPalette.jsx` (org switcher), likely a new `frontend/src/components/PortfolioDashboard.jsx`; backend — new read-aggregation routes that run N single-org queries and merge in the application layer (per the blueprint's explicit prohibition on relaxing isolation predicates for aggregation), building on `companyFactory.cjs`'s existing founder-owns-many-companies orchestration logic.

**Risk**: Low-medium. Primarily additive UI plus aggregation queries; the underlying isolation guarantees were already established in M1-M6.

**Migration**: None new — this milestone consumes existing `companyFactory.cjs` run data (currently a flat append-only log with no founder→org index) and needs a one-time index built from that log, not a schema change to it.

**Backward compatibility**: Fully additive — existing single-org users see no change; the portfolio view only activates for identities holding `portfolio_owner` on more than one org.

**Rollback**: Frontend feature flag; backend aggregation routes are new endpoints, not modifications to existing ones, so disabling them has no effect on any other feature.

---

## M8 — Enterprise Administration

**Goal**: Enterprise Account node (one level above Organization), `enterprise_admin` role, policy-inheritance grants (built on M6's Grants object), SSO/SCIM-driven provisioning, per-child-org compliance rollup. This is also the milestone where the deployment-model gap (PM2 `instances: 1`, in-process singleton state) needs to be revisited if a specific Enterprise customer's contract requires Schema- or Deployment-tier isolation (per the original blueprint's tenancy tiers) rather than Row-tier.

**Files affected**: New `backend/services/enterpriseService.cjs`; extends `organizationService.cjs`'s role constants; new SSO/SCIM integration (new connector types, following the pattern from `CONNECTOR_ISOLATION_PLAN.md`); `ecosystem.config.cjs` only if/when a specific customer requires Deployment-tier isolation — most Enterprise customers are served by Row-tier and don't touch this file at all.

**Risk**: High. This is the first milestone that touches production topology (potentially) and introduces a policy-inheritance model that, if buggy, could either over-grant (compliance failure) or under-grant (locks out legitimate Enterprise admins) across many child orgs at once.

**Migration**: Enterprise Accounts are new; no existing data models this concept today, so no backfill is required — only new-customer onboarding flows.

**Backward compatibility**: Fully additive for existing customers; Enterprise Account is an optional node that only exists for organizations explicitly enrolled.

**Rollback**: Enterprise-specific code paths are gated behind Enterprise Account existence — disabling the feature for a given customer is a data-level toggle, not a code rollback, for anything short of the rare Deployment-tier infrastructure changes, which would follow normal infra rollback procedure (out of scope for this document).

---

## M9 — Agency Mode

**Goal**: Ship Agency mode UX and the client-org-per-engagement pattern — the sharpest isolation boundary in the blueprint (client orgs must never see each other, agency staff access is grant-based and time-boxed).

**Files affected**: New `frontend/src/components/AgencyRoster.jsx` (client roster UX); leans on M4 (per-client connector credentials — Agency mode is explicitly called out in the Connector Isolation Plan as requiring org-scoped connectors) and M6 (Agency service grants, time-boxed, per-client-org).

**Risk**: Medium. Mechanically similar to Founder mode (M7) in that it's mostly UX plus existing primitives, but the isolation stakes are higher (client A must never learn client B exists) so testing burden is higher than the code-change size suggests.

**Migration**: None new beyond what M1-M6 already provide.

**Backward compatibility**: Fully additive.

**Rollback**: Frontend feature flag; no backend primitives are unique to this milestone that other modes don't also use.

---

## M10 — Marketplace Integration

**Goal**: Ship the Marketplace — agent templates, workflow templates, connector packages, Creative Studio assets — with the copy-not-reference semantics specified in the original blueprint and detailed in `AI_ISOLATION_PLAN.md`'s "Shared AI templates" section.

**Files affected**: New `backend/services/marketplaceService.cjs`, new `marketplace_listings`/`marketplace_installs` tables (per Migration Plan §6, built directly against whatever storage substrate Organizations landed on by this point), extends `agentRegistry.cjs`'s `register()` to accept `orgId` (needed regardless of Marketplace, but Marketplace is the first consumer that makes it urgent), new frontend `frontend/src/components/MarketplaceCenter.jsx`.

**Risk**: Medium. Depends on M4 (connector credential re-mapping at install time) and M5 (agent memory isolation) both being solid — Marketplace is where a gap in either would first become customer-visible at scale (many orgs installing the same template).

**Migration**: None — new surface area, built against the target schema directly, no legacy marketplace data exists.

**Backward compatibility**: Fully additive.

**Rollback**: New feature, disable at the route/flag level with no effect on existing functionality.

---

## Cross-milestone dependency graph

```
M1 (Org Foundation + Workspace Reconciliation)
 ├─→ M2 (Workspace Isolation)
 ├─→ M3 (Org Billing)
 ├─→ M4 (Org Connectors)
 ├─→ M5 (Org AI Memory)
 └─→ M6 (Cross-Org Grants)
      ├─→ M7 (Portfolio Dashboard / Founder Mode)
      ├─→ M8 (Enterprise Administration)
      └─→ M9 (Agency Mode) ← also depends on M4
           M10 (Marketplace) ← depends on M4 + M5
```

M2 through M5 do not depend on each other and can proceed in parallel once M1 lands — see `IMPLEMENTATION_SEQUENCE.md` for the recommended parallelization and staffing shape.
