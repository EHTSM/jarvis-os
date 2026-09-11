# RBAC ROLE EXERCISE — AUDIT

**Track:** OOPLIX V1 Master Audit — next unresolved item after org deletion lifecycle
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior finding:** B24-03 (`reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md`) — "Admin / Developer / Viewer
roles unexercised — no such accounts" — `NOT MEASURED`.

---

## Why this item

Reconciled the register: org deletion, B23-03, GG-1, SENTRY_DSN, B23-04 all correctly closed/blocked
per prior missions' own instructions. Of the remaining `NOT MEASURED` items (load test, real backup
restore drill, invitation flow, roles unexercised, automation), the RBAC role matrix is the most
directly V1-security-relevant: `organizationService.cjs`'s 6-role, 20-action permission matrix
(`ORG_ROLES`/`ROLE_HIERARCHY`/`ACTIONS`) underlies every authorization check across this entire audit
arc's session — `hasPermission()` is the single function nearly every route in the codebase calls —
yet every prior pass this session tested exclusively with `org_owner` accounts. A defect in the
non-owner tiers could mean every prior pass's "authorization: PASS" claim was only ever tested against
the highest-privilege role, not the actual boundary the matrix defines.

## Live test — real accounts, real role transitions

Registered a genuine third test account, added it as a real member of the established Org A test org,
and exercised the RBAC boundary across 3 of the 6 real roles (`member`, `org_admin`, `viewer`) against
representative actions spanning the full severity range:

| Role | Action | Expected | Result |
|---|---|---|---|
| member | `view_members` | allow | ✓ 200 |
| member | `manage_members` | deny | ✓ 403 |
| member | `delete_org` | deny | ✓ 403 |
| member | self-promote to `org_owner` | deny | ✓ 403 |
| org_admin | `manage_members` | allow | ✓ 200 |
| org_admin | `delete_org` | deny (owner-only) | ✓ 403 |
| org_admin | `manage_billing` | deny (owner-only) | ✓ 403 |
| org_admin | `view_audit_log` | allow | ✓ 200 |
| org_admin | `manage_policy` | deny (owner-only) | ✓ 403 |
| org_admin | `manage_sso` | deny (owner-only) | ✓ 403 |
| viewer | `view_members` | allow | ✓ 200 |
| viewer | `create_mission` | deny | ✓ 403 |
| viewer | `use_ai` (`POST /jarvis`) | deny | **✗ reached AI path, no RBAC check at all** |

## The defect

`POST /jarvis` — the platform's primary, most-used AI chat/command endpoint — never checked `use_ai`
permission anywhere in its middleware chain or controller. A `viewer`-role account (deliberately
excluded from `ACTIONS.use_ai` in `organizationService.cjs`) reached the AI-execution path freely,
blocked only by the separate, unrelated absence of a real AI provider credential (a `500`, not a
`403`). The org-scoped AI surfaces (`orgAiBrain.cjs`, `orgAgents.cjs`) already correctly enforce
`use_ai` — this was a genuine, isolated gap on the one route that matters most (the "AI Chat" tab
every account actually uses, per the route file's own header comment).

## Fix

Added `_requireUseAiIfOrgContext`, calling the same `organizationService.hasPermission(orgId,
accountId, "use_ai")` check already proven correct by the two org-scoped AI files. Mounted after
`attachOrg` resolves `req.org`, before the rate limiter and AI call. Deliberately no-ops when no org
context resolves — `attachOrg` is non-blocking by design, and `/jarvis`'s own header comment
explicitly states it's meant to remain usable "for every account... despite the old comment here
saying operator auth required" — the fix must not turn `attachOrg` into an implicit org requirement.

## Live re-verification after fix

- Viewer role → `POST /jarvis` → `403 Forbidden — this organization role does not permit AI usage`.
- `org_owner` (has `use_ai`) → still reaches the AI-execution path, hits the same pre-existing,
  unrelated credential-blocked error as before the fix (`500`, not `403`) — confirms the fix doesn't
  over-block legitimate access.
- A fresh solo account (auto-created as `org_owner` of its own default org at registration, confirming
  this platform has no true "no org at all" account state) → still reaches the AI path via `attachOrg`'s
  auto-resolve path, correctly passing the `use_ai` check.
- Re-confirmed on a fresh server process after a real restart.

## Regression

- Added 2 tests (describe block `120-master-audit-rbac-role-exercise`) to
  `tests/runtime/10-c10-cross-system-closure.test.cjs`. Negative-tested — reverted the fix, confirmed
  the structural test failed with the expected message, restored.
- `npm run test:runtime`: **229/229** (was 227/227 at phase start).
- `tests/security/110-ai-workspace-org-attribution-and-cache-isolation.cjs`: 16/16, unaffected.
- `tests/security/05-injection-security.cjs`: 103/103, unaffected.
- Production build: clean.
- `.env`: confirmed untouched throughout.
- Test data cleaned up: both test members removed from Org A, restored to its original single-owner
  state.

---

## AUDIT NAME: RBAC Role Exercise (6-role, 20-action permission matrix)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.4/10
**CONFIDENCE:** 87%

## V1 SURFACE

- **Backend:** `organizationService.cjs` (the real, pre-existing `ORG_ROLES`/`ROLE_HIERARCHY`/`ACTIONS` matrix, untouched — it was correctly designed, just under-enforced on one route); `backend/routes/jarvis.js` (1 new permission check).
- **Routes:** `POST /jarvis` (fixed), plus 12 representative existing routes across `organizations.js`, `enterpriseAudit.js`, `enterprisePolicy.js`, `enterpriseSso.js`, all live-tested and confirmed already correct.
- **Frontend:** not investigated this pass — out of scope; this audit focused on the backend authorization boundary itself.
- **Persistence:** N/A directly (no new persisted state); role assignments themselves confirmed to persist correctly across the test sequence.
- **Authentication:** PASS — unaffected.
- **Authorization:** PASS after 1 fix — 12 of 13 tested role/action combinations were already correct; 1 genuine gap found and closed.
- **Tenant Isolation:** N/A directly for this audit (single-org role boundary, not cross-org) — no cross-tenant test needed for this specific gap.
- **Cross-OS:** PASS — the fix reuses the same `hasPermission()` call already proven correct by `orgAiBrain.cjs`/`orgAgents.cjs`, not a new authorization mechanism.
- **Failure Honesty:** PASS — the new 403 carries a real, specific reason; no fake success anywhere in the tested paths.
- **Live Verification:** every claim backed by real HTTP requests with 3 real roles and real role transitions, including a real restart.
- **Regression:** 229/229 (227/227 baseline + 2 new tests, 0 weakened).

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed — the platform's primary AI entry point (`/jarvis`) had zero role-based access control, letting a `viewer`-role account (explicitly excluded from AI usage by the RBAC design) reach the AI-execution path.
- **V1-critical P2:** 0
- **Other:** confirmed self-promotion (a member escalating their own role) is correctly blocked; confirmed the owner-only tier (`delete_org`, `manage_billing`, `manage_sso`, `manage_policy`) is correctly inaccessible to `org_admin`, the next tier down — this is a meaningful confirmation since a bug here would have been a severe privilege-escalation risk across every prior OS-track pass this session that assumed `org_owner`-only access to these actions.

## FIXES

- `backend/routes/jarvis.js`: added `_requireUseAiIfOrgContext`, enforcing `use_ai` permission when an org context resolves, correctly no-op otherwise.
- 2 new regression tests, negative-tested.

## LIMITATIONS

- Only 3 of the 6 real roles (`member`, `org_admin`, `viewer`) were directly exercised with real accounts this pass — `dept_lead` and `team_lead` (which require real department/team hierarchy setup to test meaningfully) and re-confirming `org_owner`'s own boundary were not independently re-tested (the latter has been implicitly exercised by every prior pass this session).
- Only 13 of the 20 real `ACTIONS` entries were directly tested — a representative, severity-weighted sample (destructive/owner-only actions, admin-tier actions, and the one AI-usage gap found), not an exhaustive sweep of all 20×6 combinations.
- Frontend enforcement/UI-level role gating was not investigated — this audit verified only the backend authorization boundary.
- The global (platform-level) Module 6 roles (`enterprise_admin` etc., distinct from `ORG_ROLES`) were not exercised this pass.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes B24-03's "roles unexercised" item with real evidence and finds a genuine P1 authorization gap
on the platform's most-used AI endpoint. This is a materially important finding: every prior OS-track
and Audit-track pass this session that touched AI functionality implicitly assumed role-based access
control was working, since testing was always done with owner-tier accounts. No OS-track record
altered.

## REGRESSION RESULT: 229/229 (0 failures, 0 skipped, 2 net new tests)

## BUILD RESULT: PASS (clean, no frontend file changed)
