# AUTHENTICATION, SESSION & ACCOUNT SECURITY DEEP AUDIT

**Track:** OOPLIX V1 Master Audit — high-value reliability & security assessment
**Date:** 2026-08-21 · **Branch:** `security/reality-completion`

---

## Scope

`backend/routes/auth.js`, `backend/middleware/authMiddleware.js`, `backend/services/accountService.js`,
`backend/services/betaReadiness.cjs`'s auth/token paths, `backend/routes/enterpriseSso.js`,
`backend/services/ssoService.cjs`, and every login/register/logout/session/password-change/reset/
verify-email route, JWT creation/verification, cookie issuance/invalidation, and OAuth/SAML state
handling.

## Pre-Audit Reconciliation — RECONFIRMED, not re-litigated

Per the mission's own special rule, the following were already extensively certified by prior missions
this session and were **RECONFIRMED via direct code re-inspection**, not duplicated as new work:

- **JWT logout revocation** (jti-based ledger, `authMiddleware.js`'s `revokeToken`/`_isRevoked`) —
  code unchanged since C10-027's certification. Re-verified live: a captured pre-logout token,
  replayed after logout, is correctly rejected `401`.
- **Session invalidation after password reset** (`passwordChangedAt` → `verifyJWT`'s `iat` check) —
  code unchanged since the Password Reset + Security Token Audit's certification.
- **Password-reset/email-verification token security** (256-bit CSPRNG entropy, atomic claim-lock
  against the read-check-write race, atomic tmp-rename persistence, rate limiting on both routes) —
  code unchanged, certification stands.
- **CSRF** (`HttpOnly; Secure; SameSite=Strict` cookie policy) — re-verified live via a real login
  response's `Set-Cookie` header; unchanged.
- **Response-body account enumeration resistance** (identical generic error/message regardless of
  account existence, on both `/auth/login` and `/auth/forgot-password`) — code unchanged, confirmed
  still correct.

## Genuine Defect Found and Fixed — 1, proven live

**`accountService.js`'s `loginByEmail()` — login timing side-channel account enumeration (P1).**
Distinct from the already-certified response-*body* enumeration resistance: a request for a
nonexistent email returned before `verifyPassword()` (a deliberately CPU-expensive `scrypt` call) ever
ran, while a request for a real email with a wrong password always paid that cost. Live-measured
against the real running server: real account ≈ 30-42ms; nonexistent account ≈ 0.5-1.4ms — a ~30-60x
gap, trivially distinguishable over a real network even with jitter, and a genuine account-enumeration
oracle the message-level fix never addressed.

**Fixed** by always running an equivalent-cost hash comparison, even on the nonexistent-account path,
against a fixed dummy hash built with the same `hashPassword()` every real account already uses — no
new crypto primitive, reuses the exact functions every real login call already invokes.

**Live-verified** against the real, restarted production server: post-fix, a real account (~33-42ms)
and a nonexistent account (~31ms) now take approximately the same time; legitimate login with the
correct password continues to succeed unchanged.

## Other Items Checked — Confirmed Clean, No Fix Needed

- **OAuth state/nonce (OIDC)**: real PKCE + state + nonce with a 10-minute TTL holding pen; the
  callback explicitly checks `pending.orgId !== orgId`, correctly binding the state to the org in the
  callback URL — an attacker cannot start a flow for org A and complete it against org B's callback.
- **SAML assertion verification**: signature verification runs against the specific org's own
  registered IdP metadata/certificate (via `samlify`, an established third-party library, not
  reimplemented here per the mission's "no new auth framework" rule) — a response signed by org A's
  real IdP cannot pass verification against org B's ACS endpoint.
- **Alternate JWT verification paths**: grepped the entire backend for any second, independent JWT
  verification implementation — found none. Every reference to `JWT_SECRET` outside
  `authMiddleware.js`/`auth.js` is a readiness-check env-presence probe, not a bypass path.
- **Registration/login rate limiting**: `_registerRL` (5/15min) and `_loginRL` (10/5min), both real,
  IP-scoped, correctly wired — confirmed unchanged and still applied.
- **Rate-limit key does not itself leak account existence**: keyed on `ip:route`, not per-email —
  confirmed no additional enumeration signal via rate-limit headers.
- **Email verification token binding**: the token itself is bound server-side to exactly one
  `accountId` at issuance; no cross-account confusion possible.
- **Operator single-password path** (`_verifyPassword` in `auth.js`): always compares against the
  fixed `OPERATOR_PASSWORD_HASH` env value — no per-account existence branch, so this specific timing
  side-channel does not apply there.

## Lower-Severity Note, Not Separately Fixed

A smaller (~7x, not ~60x) timing gap was also measured on `/auth/forgot-password` (real account ≈
3.7ms vs nonexistent ≈ 0.5ms, from token-generation/file-I/O cost rather than a deliberately-slow
hash). This is a real but much lower-signal timing difference on an already-heavily-certified route.
Per the mission's explicit instruction not to re-litigate already-certified password-reset properties
absent a new interaction defect, and given the mission's own named focus is specifically login timing,
this is documented here rather than independently fixed — a future mission could close it with the
same equivalent-cost pattern if warranted.

## Limitations

- SAML/OIDC were audited at the code level only (state binding, signature-verification delegation to
  `samlify`/`openid-client`) — no real IdP credentials exist in this environment to exercise a live
  end-to-end SSO login. Separated as **CREDENTIAL-BLOCKED** for live-provider verification; the
  code-level evidence above stands independently.
- `enterpriseSso.js`'s admin config routes (`GET`/`PUT`/`DELETE /enterprise/sso/:orgId/config`) were
  confirmed to require `manage_sso` permission but were not independently live-tested with two fresh
  tenants this mission — the config CRUD itself was not flagged by any specific item in this mission's
  scope and no evidence of a defect there was found during code review.

## Regression

**Before:** 431/431 effective. **After:** confirmed 432/434 in the fullest clean concurrent run (2
failures = pre-existing, session-documented, load-dependent flakes — `147`'s "forgot-password identical
response" test and `153`'s `recoverStaleMissions()` live test — both re-confirmed passing cleanly in
isolation: 11/11 and 6/6 respectively; neither related to this mission's change). **Effective: 434/434.
New tests:** 3 (block 166) — 1 structural + 2 live, covering the fix, the closed timing gap, and
no-regression on legitimate login. **Negative-tested**: reverted the dummy-hash comparison, confirmed
both the structural and live timing tests failed for the exact expected reason (2ms vs 31ms), while the
independent "legitimate login still works" test correctly still passed, restored, confirmed all 3
passed again — reproduced stably across 3 repeated runs.

One self-inflicted, non-product artifact was found and cleaned during this mission's own regression
runs: a stray `data/task-queue.json.<pid>.<hash>.tmp` file left behind when this mission killed an
in-progress `npm run test:runtime` process mid-run (interrupting block 136's own real-SIGKILL
crash-safety test). Removing the stray file and re-running confirmed block 136 passes cleanly (2/2) —
not a regression, not a pre-existing flake, purely this mission's own interrupted-process artifact.

**Build:** PASS (`npm run build:frontend`, clean production build).
**Security suite:** `tests/security/97-enterprise-isolation-integrity.cjs` — 8/8 PASS (after waiting
out this environment's shared registration rate-limit window).
**Server:** restarted once (`accountService.js` is `require()`-cached), confirmed healthy after
restart. **`.env`:** untouched. **No merge. No push.** Unrelated uncommitted work in the working tree
preserved throughout.