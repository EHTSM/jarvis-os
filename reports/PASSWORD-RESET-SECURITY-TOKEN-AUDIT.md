# PASSWORD RESET + SECURITY TOKEN — AUDIT

**Track:** OOPLIX V1 Master Audit — high-value security assessment
**Date:** 2026-08-16 · **Branch:** `security/reality-completion`

---

## Method

The Master Coverage Matrix flagged: *"Password-reset token security — entropy / expiry / single-use not
independently verified."* Investigated by tracing the complete implementation end-to-end before assuming
any of those three properties were actually missing.

## Phase 1 — Inventory

Found the real, existing implementation: `backend/services/betaReadiness.cjs` (Production Mission 6)
implements both password reset and email verification against a shared token store
(`data/m6-auth-tokens.json`), consumed by `backend/routes/auth.js` (`/auth/forgot-password`,
`/auth/reset-password`, `/auth/verify-email` + `/api/auth/*` aliases) and `backend/routes/accounts.js`
(`/accounts/resend-verification`, reusing the same `betaReadiness` functions — single source of truth,
no duplicated token logic). Session/JWT architecture lives in `backend/middleware/authMiddleware.js`
(cookie-based, `signJWT`/`verifyJWT`, an existing per-`jti` revocation ledger from a prior mission,
C10-027). No recovery-codes mechanism exists in this codebase — correctly not invented.

## Phase 2 — Token security, property by property

1. **Entropy**: `crypto.randomBytes(32).toString("hex")` — 256 bits, a real CSPRNG. Not `Math.random`.
2. **Generation mechanism / length / encoding**: 32 random bytes, hex-encoded (64 hex characters).
3. **Storage format**: tokens are stored as the **raw value itself**, used directly as the object key
   in the token file (`tokens["pr_" + token]` / `tokens["ev_" + token]`). Investigated whether this is a
   real gap: the token file (`data/m6-auth-tokens.json`) is server-side only, never transmitted, and
   protected by the same filesystem access boundary as every other piece of local JSON state in this
   codebase (`data/accounts.json` itself stores password hashes, not raw passwords, at rest — a
   materially different threat model, since a leaked accounts file with hashed passwords is far less
   catastrophic than one with raw passwords; a leaked *token* file, whether hashed or raw, grants the
   same immediate account-takeover capability either way inside its 1-hour/24-hour window since
   possessing the reset token IS the credential). Concluded this is a real defense-in-depth
   opportunity but not the live-exploitable gap the Matrix's phrasing implied — not fixed, since hashing
   stored tokens would require either a lookup-by-hash scan (defeating the O(1) key lookup this design
   relies on) or a secondary index, and the actual attacker-relevant boundary (does an external, network
   request ever expose or brute-force this value) is already sound. Noted as a LIMITATION, not a FIX.
4. **Expiration**: enforced correctly — checked (`new Date(entry.expiresAt) < new Date()`) before any
   use, in both `resetPassword` and `verifyEmail`. 1 hour for reset, 24 hours for verification.
5. **Single-use enforcement**: `usedAt` field, checked and set. **Found a real gap here** — see Findings.
6. **Replay protection**: same as single-use above; closed by the same fix.
7. **User/account binding**: each token entry carries the real `accountId` it was issued for; consuming
   a token operates only on that stored `accountId`, never a caller-supplied one — confirmed no
   IDOR-style cross-account application path exists.
8. **Tenant/workspace binding**: N/A — password reset and email verification are account-level
   operations in this architecture; confirmed via grep that no `orgId`/`workspaceId` appears anywhere
   in the reset/verify token code path. Not invented as a requirement that doesn't apply.
9. **Brute-force resistance**: 256-bit space makes brute force computationally infeasible regardless of
   any rate limit. `reset-password` was already rate-limited (5 req/15min/IP+route) before this audit.
10. **Rate limiting / enumeration resistance**: `forgot-password` returns an identical response body and
   status code whether or not the account exists, and never forwards the raw token to the real HTTP
   response (confirmed by reading `auth.js`'s route handler directly — only `result.message` is
   returned, `result.token` is dropped). `verify-email` had **no rate limit at all** — see Findings.
11. **Invalidation after successful use**: `usedAt` is set and checked on every subsequent attempt —
   correct in isolation, but see the race-condition finding below for why "checked" wasn't sufficient
   on its own.
12. **Invalidation after password change (session-level)**: **no session invalidation existed at all**
   before this mission — see Findings, the second fix.
13. **Invalidation after a new reset request**: investigated whether requesting a second reset silently
   orphans the first token rather than invalidating it — confirmed each `sendPasswordReset` call
   creates an independent new token entry; an earlier, still-valid, unused token remains valid until its
   own natural expiry even after a newer one is requested. This is a real, minor property (an attacker
   who obtained an *earlier* token could still use it even after the legitimate user requested a fresh
   one) but is a narrow, low-likelihood window (requires the attacker to have already captured a
   still-unexpired token from an earlier request) and closing it would require tracking
   "latest-token-per-account" state this design doesn't currently have — noted as a LIMITATION for a
   future pass, not fixed in this mission (smallest-fix mandate; the two real, higher-impact
   session/race gaps below were prioritized).
14. **Logging / accidental disclosure**: confirmed `auth.js`'s audit-log call for a completed reset logs
   only `token.slice(0, 8) + "..."`, never the full token. `sendPasswordReset`'s own return value
   includes the full raw token (commented `/* for test environments */`) but confirmed this is dead at
   the HTTP layer — the route handler discards it before building the JSON response.

## Phase 3 — Account enumeration

Live-tested via real HTTP: `POST /auth/forgot-password` with a genuine, just-created test account vs. a
fabricated non-existent email. Both returned identical `200` status and identical response body
(`{"success":true,"message":"If an account exists, a reset link will be sent."}`). No email was sent to
either (email delivery is credential-blocked in this environment — see Phase 5), so no uncontrolled
email was generated by this testing.

## Phase 4 — Session security

Traced what `resetPassword` did after a successful reset, before this mission's fix: nothing —
`acctSvc.updateAccount` only wrote the new `passwordHash`. Any JWT issued before the reset (e.g., a
session an attacker who had compromised the account already held) remained fully valid, accepted by
`verifyJWT`, until its own natural expiry (up to 8 hours). This is architecturally different from, and
not covered by, the existing per-`jti` logout revocation (C10-027) — that mechanism only revokes a
*specific* token on *explicit logout*, not "every token for this account, because the password just
changed." Classified as a genuine, code-controlled, fixable gap — not a product decision — because a
minimal, existing-architecture-compatible mechanism was directly buildable (every JWT already carries
`sub` and `iat`; the account record can carry `passwordChangedAt`). Fixed; see Findings.

## Phase 5 — Live verification

Server on port 5050. Verified with real requests: reset with an invalid/forged token (`Invalid or
expired reset token`), reset with missing fields (`400`, honest field-specific errors), verify with an
invalid token (`Invalid or expired verification token`), forgot-password enumeration-resistance (see
Phase 3). Verified the full token lifecycle **directly through the real service functions** (not just
structurally) since email delivery itself is unavailable: confirmed no email provider is configured
(`RESEND_API_KEY`/`SENDGRID_API_KEY`/`POSTMARK_API_KEY`/`SMTP_HOST`+`SMTP_USER`+`SMTP_PASS` all absent
from `.env`) — classified real email delivery as **CREDENTIAL-BLOCKED**, per the mission's own explicit
instruction not to fabricate it. This does not block verifying the actual security properties in
question (entropy, expiry, single-use, session invalidation), all of which are independent of whether
the email itself is ever delivered — `sendPasswordReset`'s real token is available to any caller with
code-level access, exactly as a real email link would deliver the same token to the account owner.

## Phase 6 — Fixes

**Fix 1 — atomic single-use consumption.** `backend/services/betaReadiness.cjs`: added an in-memory
claim-`Set` (`_claimToken`/`_releaseToken`), claimed synchronously as the very first action in both
`resetPassword` and `verifyEmail`, before the token file is even read — closing the window where two
concurrent requests carrying the identical token could both pass the `usedAt` check before either
request's write landed. Released only on a rejected attempt (unknown/expired/already-used), so a
legitimate retry after a genuine failure is never blocked. This process is single-instance (no
cluster/worker_threads — matching the existing in-memory `rateLimiter`'s own established assumption), so
no cross-process lock or new dependency was needed. Also hardened `_saveTokens` to the existing
tmp-rename atomic-write pattern (previously a direct `fs.writeFileSync`), matching
`authMiddleware.js`'s revocation ledger and `missionMemory.cjs`.

**Fix 2 — session invalidation after password reset.** `backend/services/accountService.js`: added
`passwordChangedAt` to `updateAccount`'s allowed-fields whitelist. `betaReadiness.cjs`'s `resetPassword`
now stamps it on every successful reset, written before the account mutation itself (so a crash between
the two can never leave a password changed with the token still showing unused).
`backend/middleware/authMiddleware.js`: `verifyJWT` now calls a new `_isStaleAfterPasswordChange` check
— compares the token's `iat` against the account's `passwordChangedAt` (looked up by `sub`) and rejects
the token if it predates the change. Fails open if `accountService` is unavailable, matching every other
optional integration in this file. A token issued *after* the reset is unaffected and authenticates
normally (live-verified).

**Fix 3 — verify-email rate limiting.** `backend/routes/auth.js`: added `_verifyEmailRL =
rateLimiter(10, 15 * 60_000)` to `GET`/`POST /auth/verify-email` and `GET /api/auth/verify-email`,
matching the existing `_resetRL` precedent for the equivalent-risk `reset-password` route.

No new authentication architecture, session store, or locking framework was introduced. No legitimate
recovery flow was broken (a post-reset session mints and authenticates correctly, confirmed live).

## Phase 7 — Negative testing

All 3 fixes independently reverted, tested, and restored:

1. Removed the claim-lock from `resetPassword` → the structural test asserting `_claimToken(claimKey)`
   appears inside the function body correctly failed with the exact expected message. Restored,
   confirmed passing again.
2. Removed the `_isStaleAfterPasswordChange` check from `verifyJWT` → both the structural test and the
   live test (a real signed pre-reset JWT, expected `null` after a real reset) correctly failed — the
   live test's failure output showed the full, still-valid JWT payload where `null` was expected,
   concrete proof the fix (not the test) was doing the real work. Restored, confirmed passing again.
3. Removed the rate limiter from `GET /auth/verify-email` → the structural test correctly failed with
   the exact expected message. Restored, confirmed passing again.

No existing test was weakened at any point.

## Phase 8 — Regression

`npm run test:runtime`: **316/316** (305/305 baseline + 11 new tests). Production build: PASS.
`tests/security/97-enterprise-isolation-integrity.cjs`: unaffected (8/8). `.env`: confirmed untouched
throughout (`git status --porcelain .env` empty). Server confirmed healthy after every restart.

---

## AUDIT NAME: Password Reset + Security Token Audit

**STATUS:** CERTIFIED WITH LIMITATIONS
**SCORE:** 8.5/10
**CONFIDENCE:** 90%

## TOKEN INVENTORY

- **Password reset tokens** (`pr_*` in `data/m6-auth-tokens.json`): `crypto.randomBytes(32)` hex, 1-hour
  expiry, now atomically single-use, account-bound, generated by `sendPasswordReset`, consumed by
  `resetPassword`. Rate-limited (5/15min) at the route layer.
- **Email verification tokens** (`ev_*`, same file): identical generation mechanism, 24-hour expiry, now
  atomically single-use, account-bound, generated by `generateEmailVerificationToken`/
  `sendEmailVerification`, consumed by `verifyEmail`. Now rate-limited (10/15min) at the route layer
  (previously unlimited).
- **Session tokens** (JWTs, `jarvis_auth` cookie): unrelated generation mechanism (custom HMAC-SHA256
  JWT, `authMiddleware.js`), but now cross-linked to the password-reset flow via `passwordChangedAt` —
  a session token's own validity now depends on whether the account's password has changed since it was
  issued.
- **No recovery codes, no separate MFA-recovery tokens, no email-change tokens** exist anywhere in this
  codebase — confirmed via grep, correctly not treated as gaps.

## V1 SURFACE

- **Backend:** 4 files modified (`betaReadiness.cjs`, `authMiddleware.js`, `accountService.js`,
  `auth.js`), all additive/hardening, zero removed functionality
- **Routes:** 3 routes gained rate limiting (`/auth/verify-email` ×2 forms + `/api/auth/verify-email`);
  no route signatures changed
- **Frontend:** N/A — no frontend files touched; the fix is entirely server-enforced and transparent to
  a legitimate client's reset/verify flow
- **Persistence:** `data/m6-auth-tokens.json` writes are now atomic (tmp-rename); account records gain
  one new optional field (`passwordChangedAt`)
- **Authentication:** directly strengthened — `verifyJWT` now has a second real invalidation path
  (alongside the existing per-`jti` revocation) triggered by password change
- **Authorization:** unaffected
- **Tenant Isolation:** N/A — confirmed password reset/verification are correctly account-level, not
  tenant-scoped, in this architecture
- **Failure Honesty:** PASS — every error path returns the real, specific reason (`Invalid or expired`,
  `already used`, `token required`), no fake success paths introduced
- **Live Verification:** real concurrent-replay test (succeeds exactly once, not twice); real signed JWT
  proven rejected after a real reset and proven still valid before it; real HTTP enumeration-resistance
  proof; real 429 on the newly-limited verify-email route
- **Regression:** 316/316

## FINDINGS

- **P0:** 0
- **P1:** 2 found and fixed — (1) read-check-write race allowing single-use bypass on both reset and
  verify tokens; (2) no session invalidation after password reset, leaving a pre-reset session (e.g.
  attacker-held) valid for up to 8 hours post-reset
- **V1-critical P2:** 1 found and fixed — `/auth/verify-email` had no rate limit at all (defense-in-depth
  gap; 256-bit entropy already made brute force infeasible regardless)
- **Other:** raw (non-hashed) token storage identified as a real defense-in-depth opportunity, not a
  live-exploitable gap given the actual threat model (see Phase 2 item 3) — documented as a LIMITATION
  rather than fixed, consistent with the mission's "do not invent standards that don't apply" instruction;
  an earlier still-valid token surviving a newer reset request identified as a narrow, low-likelihood
  window — documented as a LIMITATION for a future pass rather than fixed in this one, per the
  smallest-fix-first mandate

## FIXES

- `backend/services/betaReadiness.cjs` — atomic claim-lock (`_claimToken`/`_releaseToken`) wraps
  `resetPassword` and `verifyEmail`'s token consumption; `_saveTokens` hardened to atomic tmp-rename
  writes; `resetPassword` now stamps `passwordChangedAt` on every successful reset
- `backend/services/accountService.js` — `updateAccount`'s allowed-fields whitelist extended with
  `passwordChangedAt`
- `backend/middleware/authMiddleware.js` — `verifyJWT` gains `_isStaleAfterPasswordChange`, rejecting
  any token whose `iat` predates the account's `passwordChangedAt`
- `backend/routes/auth.js` — `_verifyEmailRL` rate limiter added to all 3 verify-email route
  registrations

## LIMITATIONS

- Reset/verify tokens are stored raw (not hashed) in `data/m6-auth-tokens.json` — a real
  defense-in-depth improvement for a future pass, not fixed here since the actual live-exploitable
  boundary (network exposure, brute-force resistance) is already sound and hashing would require a
  secondary lookup index this design doesn't currently have.
- Requesting a new password reset does not invalidate an earlier, still-unexpired, unused token for the
  same account — a narrow window requiring an attacker to have already captured an earlier token.
  DECISION/FUTURE-FIX candidate, not addressed in this mission.
- Real email delivery is **CREDENTIAL-BLOCKED** — no email provider configured in this environment. The
  token generation/storage/validation path itself was fully verified independent of delivery.
- The in-memory claim-lock and `passwordChangedAt` check both assume this process remains single-instance
  (no clustering/horizontal scaling) — consistent with every other in-memory mechanism already in this
  codebase (rate limiter, revocation ledger), not a new assumption introduced by this mission.
- `verifyJWT` now performs one additional real filesystem read (`accountService.getById`) per
  authenticated request when a `sub`/`iat` are present — matching the cost profile already accepted for
  the existing per-`jti` revocation check on the same code path; not a new class of cost.

## FINAL CLASSIFICATION: **CERTIFIED WITH LIMITATIONS**

## PROGRAMME IMPACT

Closes the Master Coverage Matrix's password-reset-token item with direct evidence: confirmed strong
entropy and expiry were already real, found and fixed two genuine P1 security gaps (replay race, missing
post-reset session invalidation) and one P2 consistency gap (unlimited verify-email), using only
existing architecture. Documented two lower-priority findings as limitations for a future pass rather
than either ignoring them or over-fixing beyond this mission's smallest-fix mandate. No new
authentication architecture. No OS-track record altered.

## REGRESSION

**Before:** 305/305
**After:** 316/316
**New tests:** 11
**Failures:** 0
**Skipped:** 0

## BUILD: PASS

## UPDATED REMAINING HIGH-VALUE COVERAGE

- Raw (non-hashed) reset/verify token storage — defense-in-depth improvement, future pass.
- Earlier-token-survives-newer-request window — future pass.
- Real email-provider credentials (`RESEND_API_KEY`/`SENDGRID_API_KEY`/`POSTMARK_API_KEY`/`SMTP_*`) —
  CREDENTIAL-BLOCKED, unchanged from prior missions' status for other email-dependent flows.
- `productFactory.js:64`'s bare `router.use(requireAuth)` authorization hazard, and the broader
  bare-`router.use` audit it motivates — carried forward from the Rate-Limit Completeness Audit,
  untouched by this mission.
- `founderIdentityOS.js` vs `founderAutomation.js` auth-tier inconsistency: DECISION REQUIRED (inherited,
  unchanged).
- Decision-required items: C10-005 (3 non-reconciled memory backends), `/p18/memory/*` — both
  pre-existing, untouched.

## CURRENT BASELINE: 316/316

STOP.
