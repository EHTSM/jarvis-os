# 09 — Tenant Isolation (Phase 4)

## Org-context resolution — nuance vs. CLAUDE.md §6

`backend/middleware/orgMiddleware.cjs`'s `attachOrg` accepts `X-Org-Id`
header / query / body as an org **selector** when no `:orgId` path param is
present (e.g. `/plan/current`, `/business/x/*`). This is narrower than
CLAUDE.md §6's absolute wording ("never taken from a client-supplied header or
body field") but is not itself a defect: the selector only picks which of the
caller's OWN orgs the request concerns — `req.orgRole` is always computed
server-side via `organizationService.getMemberRole(orgId, accountId)`, and real
authorization is enforced downstream by `requireOrgMember`/`requireOrgPermission`
against real membership, never a client claim. A real, now-fixed defect
(Phase B.7) previously let a header disagree with a path param and have the
header win (confused-deputy: permission checked against header's org, data
served from path's org) — now the path param always wins when both are present.
**Classification: P3/DOCUMENTATION DRIFT** — the code is correct and has fixed
history proving the selector/authorizer distinction was taken seriously; the
CLAUDE.md text overstates the rule as an absolute that the code doesn't
literally implement.

## 8 Store → Service → Route → Auth → OrgContext chains traced

| # | Data type | Store | Service | Route(s) | Auth/Org gate | Status |
|---|---|---|---|---|---|---|
| 1 | Organizations | `data/organizations.json` | `organizationService.cjs` | `organizations.js` | `attachOrg` + `requireOrgMember`/`requireOrgPermission` per route (25+ distinct permission strings — most granular family in repo) | Correctly isolated |
| 2 | Users/accounts | — | `accountService.js` | `auth.js`/`accounts.js` | `requireAuth`; `GET /accounts` operator-gated | Correctly isolated |
| 3 | Leads/CRM | — | `crmService.js` | `crm.js`, `plan-management.js`, `obi-x.js` | org-parameterized at function level; callers now correctly pass `orgId` (Mission 51 fix) | Correctly isolated as of Mission 51 |
| 4 | Billing | — | `billingService.cjs` | `billing.js` | `requireAuth` + global `requireActiveAccount` gate | No defect surfaced in any searched report (not independently re-verified line-by-line this pass) |
| 5 | Missions | `data/missions.json` | `missionMemory.cjs` (orgId **optional by design**) | `mission.js` | `requireAuth` + `resourceOwnership.cjs`'s `assertOwnable` (Mission 51 fix) | Correctly isolated as of Mission 51; orgId-less missions remain intentionally shared |
| 6 | Credentials/vault | vault file | `secretVault.cjs` | `founderVault.js` (operator), `myConnectors.js` (org-scoped) | `_assertOrgAccess` opt-in check, `GLOBAL_ORG` partition | Correctly isolated; 2 historical leaks fixed |
| 7 | Knowledge graph | — | org-graph service | `orgKnowledgeGraph.js` (V5 M2) | `requireAuth` + in-file permission gating | No defect found in searched reports |
| 8 | Support/customer org | — | `customerOrg.js` backing services | `/customer-org/*` (POST-Ω P11) | `requireAuth`, correctly not escalated to `operatorOnly` (genuinely tenant-facing) | No defect found |

## The 9 Mission 43A / follow-up defects — current status: ALL FIXED

`reports/MISSION-PLAN-BACKEND-TENANT-ISOLATION-FIX.md` consolidated 9 confirmed
defects from `MISSION-43A-BACKEND-ROUTE-GAP-DISCOVERY.md` and its follow-up.
**Mission 50 (2026-08-24) stated this plan "has never been executed."** Direct
inspection of current code (HEAD `719fe0aa`) shows **all 9 are now fixed**,
attributed via in-code comments to "Mission 51 (2026-08-26)" — a mission with
no corresponding `reports/MISSION-51*.md` file, but extensively evidenced in
code comments and corroborated by git-log entries from that date
(`35d4daa2`, `18972132`, etc.). **This supersedes Mission 50's finding** — the
plan was executed two days after Mission 50 audited it as unexecuted.

| # | File | Defect | Status | Evidence |
|---|---|---|---|---|
| 1 | `mission.js` | cross-tenant IDOR on `:id` routes | **FIXED** | `assertOwnable(req, memory.getMission(id), ...)` at 4 call sites |
| 2 | `collaboration.js` | cross-tenant IDOR via `missionId` | **FIXED** | derives ownership transitively from the underlying mission, exactly per plan |
| 3 | `plan-management.js` | unscoped `crm.getStats()` | **FIXED** | mounted behind `attachOrg`, calls `crm.getStats(req.org?.id)` |
| 4 | `browserPlatform.js` | cross-account credential/session exposure + `?all=true` bypass | **FIXED** | ownership helper applied to 8 previously-unchecked routes; `?all=true` restricted to operator role |
| 5 | `workspaceMesh.js` | parallel ungated door to `/computer/*` controller stack | **FIXED** | mount-level `requireAuth, operatorOnly` added |
| 6 | `obi-x.js` | unscoped `crmService.getStats()` + 6 more unscoped calls | **FIXED (access gap only)** | mounted behind `attachOrg` + `requireOrgMember`; deeper per-analysis orgId threading inside the reasoning engine intentionally not attempted (engine has no orgId concept) — flagged, not faked |
| 7 | `pipeline.js` | cross-tenant IDOR on `:id` | **FIXED (ownership only)** | `assertOwnable` at 3 call sites; rate-limit half of the same plan item NOT done (see `07_SECURITY_MODEL.md` finding #2) |
| 8 | `autonomousAgent.js` | cross-tenant IDOR on `:id` | **FIXED** | `assertOwnable` at 5 call sites |
| 9 | `engineering.js` | unrated repo-mutating routes, no operator gate | **FIXED (operator-gate half only)** | `operatorOnly` added to 3 mutating routes; rate-limit half NOT done |

**Shared helper**: `backend/services/resourceOwnership.cjs` implements the
plan's Group-A design exactly — orgId-less resources pass through unchanged
(preserving `missionMemory.cjs`'s documented majority-shared-resource behavior),
non-null-orgId resources checked against real membership/grants/enterprise-admin
status, 404-not-403 on denial (matching the codebase's existence-leak-avoidance
convention).

**Net conclusion: 9/9 fixed. Two of the nine are partial fixes** — `pipeline.js`
and `engineering.js` both got their auth/ownership half but not the
rate-limiting half the same plan item specified.

## OS-layer-level tenant isolation findings (cross-reference to `03_OOPLIX_OS_MAP.md`)

Independent of the Mission 43A/51 route-level work, the OS-layer audit
(`reports/OS-REGISTER.md`) surfaced three currently-open, unrelated cross-tenant
defects at the service/data-model level, none folded into their OS's headline
score as resolved:

1. **Mission OS (MSN-1)** — cross-tenant mission read **and cancel** (destructive
   write) on 2,124 records with no ownership field at the `missionMemory.cjs`
   data-model level (distinct from the route-level IDOR fixed under Mission 51's
   `assertOwnable` work — this is a different, deeper gap: even a caller who
   passes the ownership check on an orgId-less mission can still act on any
   mission ID system-wide, since the majority of missions have no orgId to
   check in the first place).
2. **Finance OS (F-1)** — `/cbeta/billing/*` invoices/credits not
   account-scoped.
3. **Memory OS (M-4)** — cross-tenant memory read/write, no ownership field on
   ~4,000 memory records, spanning shared infrastructure multiple OS layers
   write into.

These three are **not** covered by the Mission 51 route-level fix and remain
open as of this mission's audit. They are the master report's top security
priorities.
