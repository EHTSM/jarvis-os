# OS-ORGANIZATION — DISCOVERY REPORT

**Track:** OOPLIX OS #9 — Organization OS
**Date:** 2026-08-14 · **Branch:** `security/reality-completion`
**Method:** Repository inspection BEFORE any change. **No new organization system was built.**
**Isolation:** Verification server on **port 5133**. The Audit Track's own server was independently
observed running concurrently on port 5050 during this pass — it was not touched, and one accidental
port collision caused by my own process management was detected and immediately corrected (see
Workflow Evidence's Operational Hazard section).

---

## 1. Method

Traced actual route mounts in `backend/routes/index.js` rather than guessing paths. Capability was
confirmed by execution, not assumed from filenames.

---

## 2. Two real, distinct tenant systems — not duplicates

| System | Route prefix | Depth | Role |
|---|---|---|---|
| **`organizationService.cjs`** | `/orgs/*` | Organization → Department → Team → Member, full RBAC | The genuine Organization OS the mission targets |
| **`workspaceService.cjs`** | `/workspace/*` | Flat workspace → member | The simpler tenant primitive used as `x-workspace-id` across every prior OS pass in this program |

`organizationService.cjs`'s header comment claims it reuses `workspaceService.cjs` for
"workspace → org mapping," but **no such mapping code was found** — the two systems have
independent id namespaces (`org_...` vs `ws_...`) and independent membership stores. They are not
duplicates of each other (different depth, different purpose), but the documented relationship
between them does not exist in code. Documented as a genuine gap, not fixed.

## 3. Backend Inventory

| File | Lines | Role |
|---|---:|---|
| `backend/services/organizationService.cjs` | 1,111 | Org/dept/team/member CRUD, RBAC (`hasPermission`), grants, real audit-log calls |
| `backend/middleware/orgMiddleware.cjs` | 88 | `attachOrg`/`requireOrgMember`/`requireOrgPermission` — a **previously hardened** confused-deputy fix (documented Phase B.7 fix for header-vs-path-param precedence) already in place |
| `backend/routes/organizations.js` | 348 | 33 endpoints — orgs, members, departments, teams (nested), missions, billing, grants |
| `backend/services/workspaceService.cjs` | 398 | Workspace CRUD, invite, switch, members |
| `backend/routes/workspace.js` | 203 | 10 endpoints |
| `backend/routes/enterpriseAudit.js` | — | 8 org-scoped audit endpoints, `view_audit_log`-gated |
| `backend/routes/governance.js` | 121 (+ this pass's fix) | Policies/templates/compliance/risk, workspace-scoped |
| `backend/services/governanceService.cjs` | — | Governance store, **no membership check of its own** (§6) |

Route registration confirmed: `backend/routes/index.js:74` (`/orgs`), `:94` (`/workspace`),
`:63` (`/governance`).

## 4. RBAC — 6 documented roles, verified live, none invented

```
org_owner (0) > org_admin (1) > dept_lead (2) > team_lead (3) > member (4) > viewer (5)
```
`GET /orgs/roles` returned exactly these 6 roles live, matching `organizationService.cjs`'s own
header comment exactly. No role was fabricated for testing.

## 5. Data store

`data/organizations.json` — **1,337 real organizations** at time of verification. Not a fixture;
this is live production-shaped data.

## 6. Genuine gap found — `governanceService.cjs` has no membership check

`governanceService._ws(workspaceId)` lazily auto-creates a policy store for **any** workspaceId
string with zero validation that the caller belongs to it. `governance.js`'s own route file never
called `requireWorkspaceMember`. The route was, in practice, only protected because
`backend/routes/security.js` (mounted earlier in `index.js`) registers its own
`router.use(attachWorkspace)` / `router.use(requireWorkspaceMember)` with **no path prefix** —
which Express applies to every request reaching past that router, not just `/security/*`.
Reproduced in isolation with a minimal Express app (see Workflow Evidence). This accidental
cross-file leak was the *only* thing preventing `GET /governance/policies?workspaceId=<any other
tenant's id>` from succeeding. **Fixed** — see Security report.

## 7. Frontend Inventory

Organization-facing UI was not the focus of this pass (the mission's Step 19 asks only that the
production build succeed and the shipped artifact loads — verified, see Workflow Evidence). No
orphan-hunting was performed on org-specific frontend components; this is noted as Not Measured
rather than asserted PASS.

## 8. Key Discovery Findings

1. **Organization OS already exists and is substantial** — 1,111-line service, 33 routes, real RBAC,
   real audit trail, 1,337 real organizations. Nothing needed building.
2. **A previously-fixed confused-deputy vulnerability (header vs. path-param org id) remains fixed**
   — verified live, not merely read from a comment.
3. **A real cross-file middleware leak** (`security.js`'s unscoped `router.use()` accidentally
   protecting `governance.js`) was discovered, root-caused via isolated reproduction, and fixed with
   the intentional, documented gate `governance.js` should have had itself.
4. **A significant operational hazard was encountered and resolved mid-pass**: a stray `git stash
   pop`-style duplicate declaration in `runtime.js` intermittently crashed the server; multiple
   orphaned prior processes (including one from an unrelated, concurrently-running Audit Track
   session) answered requests inconsistently. Fully documented in Workflow Evidence.

---

**Outcome:** Organization OS is a recovery/verification target. One security defect found,
root-caused, and fixed with a negative test and live re-verification. One documentation/gap finding
recorded. **0 systems built.**
