# 08 — Auth, RBAC, MFA (Phase 3 detail)

## Auth middleware surface

`backend/middleware/authMiddleware.js` exports `requireAuth`, `operatorOnly`,
`signJWT`, `verifyJWT`, `revokeToken`, `COOKIE_NAME`, `TOKEN_EXPIRY`,
`COOKIE_DEFAULTS` (line 211). `requireAuth` accepts both an httpOnly cookie and
a mobile `Authorization: Bearer` header symmetrically; `operatorOnly` layers a
role check on top.

## MFA enforcement — policyService.cjs

`assertMfaSatisfied`/`assertProviderAllowed` are called, in that order, before
`signJWT`/`res.cookie` on every login-shaped route this mission checked:
local password login, Firebase/Google/Phone login. This ordering was itself a
fix — "Mission 33 — MFA End-to-End Certification (2026-08-22)" found the
Firebase/Google/Phone path had **zero** MFA/provider-policy enforcement at the
time, a full bypass of org MFA policy. Confirmed fixed and currently correct.

SSO/SAML/OIDC routes intentionally do not call `assertMfaSatisfied` locally —
they delegate MFA to the org's own external IdP. This matches CLAUDE.md §6's
explicit statement that this is documented, accepted behavior, not a gap.

## RBAC

6 roles across the Org→Dept→Team→Member hierarchy (Organization OS,
`organizationService.cjs`), 11+ distinct permission actions, exercised via
`requireOrgPermission`/`hasPermission`. Backend authorization boundary was
previously certified in `reports/RBAC-ROLE-EXERCISE-AUDIT.md` — that report
explicitly scoped itself to backend-only. **Frontend RBAC visibility parity has
no dedicated audit** — see `16_FRONTEND_UX.md` for the current state of that
named gap (Mission 49 first surfaced it; not yet independently closed as of
this mission's read).

## Password reset / session invalidation

`_isStaleAfterPasswordChange` (authMiddleware.js:89) invalidates any JWT issued
before the account's last `passwordChangedAt` timestamp — fixed under "Security
Token Audit (2026-08-16)". Fails open if `accountService` throws
(explicitly reasoned in comments as an optional-integration fallback) — worth
operator awareness, not treated as an open defect (P3/DESIGN DECISION).

Logout (`_handleLogout` in `auth.js`) revokes the JWT's `jti` server-side via
`revokeToken`, recovering the token from either cookie or mobile Bearer header
— symmetric with `requireAuth`'s own dual-transport acceptance. This closes a
previously-real defect ("MASTER RECOVERY, 2026-08-15, C10-027") where logout
did not revoke server-side at all.

## Revocation list

`data/revoked-tokens.json`, atomic tmp+rename write, self-pruning on every
write (drops entries whose `exp` has already passed) so the file does not grow
unboundedly.

## Findings specific to this file

No new defect found in JWT lifecycle, MFA ordering, or password-reset/session
invalidation. All historical defects in this area (Firebase MFA bypass, missing
server-side logout revocation) are confirmed fixed with dated evidence. See
`07_SECURITY_MODEL.md` for the full findings table including the two P2/P3
open items (rate limiting gaps) that are adjacent to, but not part of, this
file's scope.
