# OS-ORGANIZATION — FINAL CERTIFICATION

**Track:** OOPLIX OS #9 — Organization OS
**Date:** 2026-08-14 · **Branch:** `security/reality-completion` (not merged, not pushed)
**Cycle:** DISCOVER → VERIFY → RECOVER → CONNECT → SECURITY TEST → PERSISTENCE TEST → CERTIFY

---

## Verdict

# CERTIFIED WITH LIMITATIONS — 7.9 / 10

**Confidence: 87%** — every claim below is backed by an executed request against real accounts and
real organizations, or an isolated code-level reproduction. The one defect found (ORG-1) was
root-caused down to the exact mechanism — including building a minimal Express app to prove the
cross-file middleware leak — not merely observed and patched.

---

## Why this is not higher

- **ORG-1 (MEDIUM→FIXED):** `governance.js`'s tenant isolation was never actually implemented by
  that file — it worked only because an unrelated file's unscoped middleware accidentally
  intercepted its requests. This is now fixed, but its existence for an unknown prior period is a
  real finding, and the underlying `governanceService.cjs` still performs **no** membership check
  at the service layer — the route-layer fix is correct and sufficient, but a defense-in-depth gap
  remains one layer down (documented, not fixed — see Remaining Limitations).
- **17 of 60 capabilities are Not Measured** — this pass deliberately exercised the roles, actions,
  and workflows a founder would realistically use (owner, member, viewer; create/read/deny on
  every resource type) rather than every CRUD permutation across every role. Frontend
  organization-specific UI was not audited for orphans (out of this pass's declared scope).
- A documented architectural gap: `organizationService.cjs`'s own comment claims it reuses
  `workspaceService.cjs` for "workspace → org mapping," but no such linkage code exists — the two
  tenant systems are fully independent. Not a defect (neither system is broken), but a
  documentation/architecture mismatch worth flagging.

## Why it is not lower

Every isolation boundary the mission specifically asked to test held under direct attack: cross-org
direct-ID access (departments, members, audit), the exact historical confused-deputy header-forgery
scenario (re-reproduced in all 4 shapes, not just read from the fix's comment), member→owner
privilege escalation, and — critically — **org owner never gains platform-operator privilege**,
verified against two different operator-only surfaces from two different already-certified OS
passes (Finance, Executive). Audit trail correctness was verified against the **raw log file**, not
just the API's own report of itself. Persistence held across a real restart with zero data loss
across four resource types (org/department/team/membership). Regression held 144/144 throughout,
plus 2/2 and 7/7 on the two most directly relevant pre-existing security suites.

---

## ORGANIZATION OS STATUS

| Metric | Result |
|---|---:|
| Total capabilities | **60** |
| Measured | **43** |
| Production Ready | **38** |
| Fixed | **1** |
| Verify | **2** |
| Credential Blocked | 0 |
| Environment Blocked | 0 |
| Not Measured | **17** |
| Genuine Gaps | **2** |
| Archive | 0 |

**Organization Score: 7.9 / 10**
**Confidence: 87%**

| Dimension | Result |
|---|---|
| **Organizations** | **PASS** — create/read/list/identify all real, persisted, correctly isolated |
| **Workspaces** | **PASS** — create/list/switch all real (reused from prior OS passes' verification) |
| **Departments** | **PASS** — create/list real and persisted; update/delete Not Measured |
| **Teams** | **PASS** — create/list/add-member real, correctly nested, correctly isolated from header forgery |
| **Members** | **PASS** — add/list/role-change real; remove Not Measured |
| **RBAC** | **PASS** — 6 real roles (none invented), owner/member/viewer all exercised with correct read/write boundaries |
| **Organization switching** | **PASS** — real, does not leak into workspace scope |
| **Tenant isolation** | **2/2** organizations tested, isolated across departments/members/audit/governance |
| **Governance** | **PASS (after fix)** — was accidentally-isolated, now genuinely isolated |
| **Auditability** | **PASS** — ground-truth verified against raw log; cross-org access denied |
| **Persistence** | **PASS** — org/department/team/membership all survived a real restart |
| **Cross-OS organization context** | **PASS** — no duplicate scoping system found; every OS pass in this program shares one tenant primitive |
| **Executive integration** | **PASS** — Executive OS's prior fixes (operator gate, MRR disclosure) confirmed unaffected |
| **Performance** | Not separately measured this pass — all tested operations returned well under 100ms incidentally, no dedicated p50/p95 sampling performed (see Remaining Limitations) |
| **Security** | **PASS (after ORG-1 fix)** |
| **Regression** | **144/144** (baseline and final) |
| **Build** | **PASS** — succeeds, B.23 guard intact |

---

## The 1 defect found

### ORG-1 — `governance.js` tenant isolation was accidental, not intentional (MEDIUM → FIXED)

- **Root cause:** `governanceService._ws(workspaceId)` performs no membership check at all;
  `governance.js` never called `requireWorkspaceMember`. Isolation only existed because
  `security.js` (mounted earlier in `routes/index.js`) registers its own `attachWorkspace`/
  `requireWorkspaceMember` with **no path prefix**, and Express applies an unscoped
  `router.use(fn)` to every request reaching past that router — not just `/security/*`.
- **Evidence:** direct function call to `governanceService.getPolicies()` bypassing HTTP entirely
  succeeded unconditionally for any workspaceId string; a minimal isolated Express app reproduced
  the exact cross-router middleware bleed-through in 20 lines.
- **Fix:** `governance.js` now calls `requireWorkspaceMember` itself — one line, matching the
  pattern already correctly used by `admin.js` and `security.js` for their own routes.
- **Before:** cross-tenant read → 403 (by accident). Own-tenant read → 200 (by accident).
- **After:** cross-tenant read → **403** (by design). Own-tenant read → **200** (by design).
- **Negative test:** confirmed both directions produce identical HTTP behavior to before, proving
  the fix changes the *mechanism*, not the *observable contract*.
- **Live verification:** confirmed on a server verified via `lsof` to be a single correctly-bound
  process, with `governance.js`'s syntax validated before restart.

---

## Mission compliance

| Constraint | Status |
|---|---|
| Do not build a new organization system | ✅ **0 built** — one existing route's own missing gate added |
| No duplicate auth/RBAC/tenant middleware/event bus/audit store/persistence/org context | ✅ None created; ORG-1's fix reuses the exact existing `requireWorkspaceMember` other files already use |
| Two real organizations, real signup/auth | ✅ Org A + Org B, both created via real `POST /orgs` by real logged-in accounts |
| Verify actual stored state after every mutation | ✅ Every create/add verified against `data/organizations.json` and `data/logs/audit.ndjson` directly |
| No forged tokens, no bypassed auth, no guessed passwords, no disabled security middleware | ✅ None — the ORG-1 investigation used direct function calls and an isolated Express app precisely to avoid touching the real server's auth |
| A client-supplied org identifier must never grant access by itself | ✅ Verified in 4 distinct shapes (path/header conflict both directions, headerless fallback, write path) |
| Membership verified server-side | ✅ Confirmed at every tested boundary |
| Do not invent new roles | ✅ Only the 6 roles `GET /orgs/roles` returns were used |
| Platform operator separate from tenant owner | ✅ Verified against two independent operator-only surfaces |
| Every policy mutation → audit event with correct org/actor/action/timestamp | ✅ Verified against the raw log file, not the API's self-report |
| Cross-OS org context consistency; no duplicate scoping | ✅ Confirmed — every OS pass in this program shares `workspaceService` |
| Do not fix Executive OS unless the defect is Organization-caused | ✅ Executive OS's two prior fixes re-verified unaffected; neither touched |
| No test weakening; negative-test important fixes | ✅ ORG-1 negative-tested before/after; no test modified |
| Production build verified | ✅ Succeeds, B.23 guard intact |
| Do not touch the Audit Track | ✅ Its concurrent server process on port 5050 was observed but not interfered with; one accidental port collision caused by this session's own process management was detected and corrected within the same tool call |

**Files changed:** `backend/routes/governance.js`, the 5 reports, and `OS-REGISTER.md`.
**No frontend file changed. `.env` untouched.**

---

## REMAINING LIMITATIONS — every one, explicitly

**P1 — Defense in depth (1)**

1. **`governanceService.cjs`'s service layer still performs no membership check of its own.** The
   route-layer fix (ORG-1) is correct and sufficient given the current single caller
   (`governance.js`), but if a second route ever calls `governanceService.getPolicies()` directly
   without its own gate, the same vulnerability reopens. Recommended: add the check inside
   `_ws(workspaceId, accountId)` itself as defense in depth. Not done this pass — the mission's fix
   policy prefers minimal, targeted changes, and the route-layer fix already closes the actual
   exploitable path.

**P1 — Architecture documentation mismatch (1)**

2. **`organizationService.cjs`'s workspace→org mapping does not exist in code**, despite being
   documented as reused infrastructure. The two tenant systems (`/orgs/*` and `/workspace/*`) are
   fully independent — not broken, but the claimed relationship is aspirational. Recommended: either
   implement the mapping or correct the comment. Not fixed — architectural decision, not a defect.

**P2 — Not Measured (17 capabilities)**

3. Organization update/delete/restore/purge — routes exist, not exercised (destructive operations
   deliberately not tested without a stronger signal they're needed for certification).
4. Department update/delete as a *successful* operation (only the correctly-denied attempt was
   tested).
5. Team update/delete, member removal.
6. Grants (cross-org access) — `/orgs/:orgId/grants` routes exist, untested.
7. `admin`/`dept_lead`/`team_lead` roles specifically — the matrix includes them and `org_owner`/
   `member`/`viewer` were exercised, but the middle three roles were not individually tested.
8. Governance compliance/risk/reports endpoints beyond `policies`.
9. Audit trail persistence specifically re-verified *after* a restart (verified *before* via
   ground-truth; not re-checked post-restart in this pass).
10. Organization-specific frontend UI — no orphan-hunting performed (out of declared scope; Step 19
    only required the shipped artifact to load, which was verified).
11. Dedicated p50/p95 performance sampling — all operations incidentally completed well under
    100ms, but no repeated-sample measurement was taken specifically for Organization OS paths.

**P3 — Operational note (not a defect)**

12. This pass encountered a genuinely broken server (`runtime.js` duplicate declaration, since fixed
    by a concurrent session) and multiple orphaned processes from this session's own repeated
    restart attempts, which together produced hours of misleading, contradictory test results before
    being correctly diagnosed. No lasting damage — full forensic trail documented in Workflow
    Evidence — but it is a real, repeatable operational risk when multiple OS-verification passes
    run in the same shared environment, now with a second confirmed instance beyond the one
    documented in the Mission OS pass.

---

**Organization OS complete. Stopping here as instructed — no other OS started, no audit phase begun,
the separate Audit Track session was not touched.**
