# GG-1 — IP ALLOWLIST ENFORCEMENT CLOSURE

**Track:** OOPLIX V1 Master Audit — next unresolved item after Engineering OS
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`
**Prior finding:** B25-01/GG-1 (`reports/OOPLIX-V1-MASTER-AUDIT-REGISTER.md`, Phase B.25) — "IP allowlist enforces nothing" — the #2 launch blocker in the entire Audit Track register, after `SENTRY_DSN`.

---

## Why this item

Read the full `OOPLIX-V1-MASTER-AUDIT-REGISTER.md` (B.22 through C.10). Every remaining item in the
OS-track's own `MASTER-OPEN-FINDINGS.md` is FOUNDER DECISION or CREDENTIAL BLOCKED — none is
genuinely code-fixable. The Audit Track's own C.10 explicitly closed with "No C.11." The one item in
the entire combined register still carrying an actual **NOT CERTIFIED** verdict (screen-reader
accessibility) is environment-blocked (would seize the desktop; no Android device). B25-01/GG-1 is
the highest-priority item that is (a) genuinely unresolved, (b) explicitly named a launch blocker,
and (c) code-fixable without requiring credentials or a new environment.

## Discovery

`policyService.cjs` already contained a correct `requireIpAllowed` middleware and a real, persisted
`ipAllowlist` field per org — but it was mounted on zero routes (B25 found this, correctly disclosed
it rather than faking enforcement, and scored the compliance check as never-passing while inert).

**Live inspection this pass found the risk was not hypothetical**: 8 real org policy records already
carried a populated allowlist (`203.0.113.9`, a test IP from B24/B25's own prior sessions) — meaning
a careless blind global mount would have retroactively locked out real access for those orgs the
moment enforcement was flipped on.

## User decision

Given the real lockout risk, I asked the user how to proceed rather than unilaterally deciding.
**User selected: "Enforce it carefully, scoped to the enterprise routes it was built for"** (the
recommended option) — mount on the 4 real `/enterprise/*` route files (`enterprisePolicy.js`,
`enterpriseAudit.js`, `enterpriseMonitoring.js`, `enterpriseDashboard.js`), the module's own
documented intended home ("compose after requireAuth on specific routers... never applied
globally").

## Implementation

Added `assertIpAllowed(orgId, req)` to `policyService.cjs` (a throwing variant matching the file's
existing `assertProviderAllowed`/`assertConnectorAllowed` shape). Called it from each of the 4 route
files' own existing per-route membership-check helper functions, **after** real org membership is
confirmed — never before, so an unrelated caller learns nothing about an org's IP-restriction status
from the response shape.

## Self-lockout bug — found live during this pass's own verification, then fixed

Live-tested the fix on a real test org: set an allowlist excluding my own testing IP, confirmed the
dashboard/audit/monitoring routes correctly denied access — **and then found the policy-management
route itself was also denied, with no way to undo the restriction.** This is a genuine, serious
design flaw a careless implementation would have shipped: a real admin could permanently lock
themselves out of their own organization's enterprise features with no recovery path short of direct
database editing.

**Fixed**: `enterprisePolicy.js`'s `GET`/`PUT /enterprise/policy/:orgId` route is deliberately **not**
IP-gated — the one door that must never be locked by the same key. The other 3 route files remain
fully gated.

**Live-verified the full cycle**: restrict → dashboard/audit/monitoring all correctly 403 → policy
route stays reachable → clear the allowlist through it → access restored. Also verified: cross-tenant
isolation (Org B's own unrestricted access unaffected by Org A's restriction; Org B's cross-tenant
attempt on Org A gets the membership 403, not the IP error — no info leak); an org with no allowlist
configured behaves exactly as before (zero behavior change for the common case); persistence across
a real server restart (the 8+ real orgs' existing test data and my own test org's cleared state both
survived intact).

## Disclosure surfaces updated to match the new reality

`enterpriseDashboard.cjs`'s `ip_allowlist_set` compliance check now reports `enforced:true` (was
`false`) and `pass` reflects real configuration state. `getSecurity()`'s `ipAllowlistEnforced` is now
`true`. `enterprisePolicy.js`'s write-time warning now describes the real lockout risk instead of the
old (now false) "does not restrict access" claim. Reporting `enforced:false` now would itself be a
**new** dishonesty defect — the opposite of B25-01's original finding — so this update is required by
the same honesty discipline that produced the original finding, not merely nice-to-have.

## Regression

- Added 4 new tests to `tests/runtime/10-c10-cross-system-closure.test.cjs` (describe block
  `116-master-audit-b25-01`), all negative-tested individually (each reverted in turn, each caught by
  name, each restored and re-confirmed passing).
- **Updated `tests/security/98-b25-control-honesty.cjs`** (not weakened) — its own header comment
  explicitly anticipated this exact moment ("If IP enforcement is genuinely implemented later,
  `enforced` becomes true and these assertions must be updated deliberately — which is the point").
  Rewrote to assert the new honest-and-enforced contract instead of the old honest-and-inert one,
  including a new section proving the self-lockout recovery path stays safe. Ran against the live
  server: correctly self-reported SKIPPED under signup rate limiting (an honest environment
  condition from this session's own prior test-account creation, not a false pass) — every one of its
  assertions was then independently manually verified live against the real server instead, with
  identical results.
- `npm run test:runtime`: **218/218** (was 214/214 at phase start).
- `tests/security/97-enterprise-isolation-integrity.cjs`: 8/8, unaffected.
- Production build: clean (no frontend file touched).
- `.env`: confirmed untouched throughout.

---

## AUDIT NAME: GG-1 — IP Allowlist Enforcement Closure (B25-01)

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.0/10
**CONFIDENCE:** 87%

## V1 SURFACE

- **Backend:** `policyService.cjs` (new `assertIpAllowed()`, reuses existing `isIpAllowed()`/storage — no new architecture); 4 route files updated (`enterprisePolicy.js`, `enterpriseAudit.js`, `enterpriseMonitoring.js`, `enterpriseDashboard.js`); `enterpriseDashboard.cjs`'s compliance/security disclosure surfaces updated to match.
- **Routes:** 4 real `/enterprise/*` route families (policy, audit, monitoring, dashboard) now genuinely IP-gated per-org when configured; the policy-management route itself deliberately exempt for lockout recovery.
- **Frontend:** `OrgAdminCenter.jsx` (real consumer of `/enterprise/policy/:orgId` and `/enterprise/audit/:orgId/search`, both `.catch()`-wrapped — confirmed a 403 degrades gracefully, not a crash). No frontend code changed this pass.
- **Persistence:** PASS — real disk storage (`data/org-policies.json`), confirmed enforcement and data both survive a real server restart.
- **Authentication:** PASS — unaffected; all routes still require `requireAuth` as before.
- **Authorization:** PASS — IP check composes after real org-membership check, never before; correct order confirmed live (unrelated org gets membership 403, not IP error).
- **Tenant Isolation:** PASS — Org A's restriction has zero effect on Org B's own access; live-verified with real two-tenant data.
- **Failure Honesty:** PASS after this fix — compliance/security surfaces now report `enforced:true`/correct `pass` state, closing the exact class of dishonesty B25-01 originally found (a stored-but-inert control scored as passing); the opposite failure mode (claiming enforcement that doesn't exist) was checked for and not introduced.
- **Live Verification:** Every material claim in this report backed by a real HTTP request against the running server — restriction, denial, recovery, cross-tenant isolation, restart-persistence.
- **Regression:** 218/218 (214/214 baseline + 4 new tests), 0 weakened, 1 pre-existing test deliberately and correctly updated per its own documented anticipation of this exact change.

## FINDINGS

- **P0:** 0
- **P1:** 1 found and fixed (the self-lockout bug — a careless implementation of this exact fix would have permanently locked real admins out of their own org's enterprise features, found live during this pass's own verification before it could ship)
- **V1-critical P2:** 0
- **Other:** the original B25-01 finding itself (inert control scored as passing) is now fully closed, not merely re-disclosed

## FIXES

- `backend/services/policyService.cjs`: added `assertIpAllowed(orgId, req)`.
- `backend/routes/enterpriseAudit.js`, `enterpriseMonitoring.js`, `enterpriseDashboard.js`: call `assertIpAllowed` after real org-membership checks.
- `backend/routes/enterprisePolicy.js`: deliberately NOT IP-gated (self-lockout recovery path) — documented inline.
- `backend/services/enterpriseDashboard.cjs`: compliance/security disclosure surfaces updated to `enforced:true`.
- `tests/security/98-b25-control-honesty.cjs`: rewritten to assert the new honest-and-enforced contract, per its own anticipated-update instruction.

## LIMITATIONS

- Enforcement is scoped to the 4 enterprise route files where the feature was designed to live — not platform-wide. This is deliberate (matching the module's own documented design and the user's explicit choice), not a residual gap.
- The automated version of `98-b25-control-honesty.cjs` self-reported SKIPPED under this session's own signup rate limiting rather than running to completion — every one of its assertions was independently verified live and manually instead, but a clean, non-rate-limited automated run was not captured in this pass.
- Real production network conditions (actual corporate VPN egress IPs, IPv6, proxy/CDN header spoofing beyond the existing `x-forwarded-for` parsing) were not tested — only local IPv4 loopback behavior.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

This closes the #2 launch blocker in the Audit Track's own register (`SENTRY_DSN`, #1, remains
credential-blocked and out of this pass's authority to fix). The Master Audit Register's B.25 section
should be understood as updated: GG-1 is no longer an open genuine gap requiring "enforce it or
remove it from the UI" — it is now enforced, live-verified, and regression-locked.

## REGRESSION RESULT: 218/218 (0 failures, 0 skipped, 4 net new tests)

## BUILD RESULT: PASS (clean, no frontend file changed)
