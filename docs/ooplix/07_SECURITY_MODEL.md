# 07 — Security Model (Phase 3)

Method: static analysis only (no server run, no test execution, no `.env`/credential
values read), per this mission's constraints. Branch `security/reality-completion`,
HEAD `719fe0aa`.

## Route inventory and middleware consistency

`backend/routes/index.js` (416 lines, ~213 `router.use` mounts) groups into
distinct functional families (core account/auth, messaging/CRM, runtime core,
mission/agents, business/enterprise, "OS Level 2-10" platform tier, ACP repo
tooling, POST-Ω P1-P20, founder/ops cluster, V5 org-scoped M1-M7, OBI-X). No new
sibling-middleware inconsistency was found across a 25+ file sample beyond what
prior missions already fixed. Zero-orgId platform-wide engines are uniformly
escalated to mount-level `operatorOnly`, each with an inline justification
comment naming the confirmed zero-orgId backing service.

One style nit: `backend/routes/accounts.js:203-208` (`GET /accounts`) implements
the operator role check manually instead of composing the shared `operatorOnly`
middleware. Same behavior, no gap — P3/DESIGN DECISION.

## JWT lifecycle

`backend/middleware/authMiddleware.js` — HS256, manual base64url signing (no
`jsonwebtoken` dependency), `crypto.timingSafeEqual` for signature comparison,
`jti`-based revocation list (`data/revoked-tokens.json`, atomic write,
self-pruning), 8h default expiry (org-overridable via `policyService`), and
`_isStaleAfterPasswordChange` invalidation keyed on `passwordChangedAt`. Dev
auth bypass requires both non-production AND an explicit opt-in env flag, and
fails closed (503) if `JWT_SECRET` is merely unset in production. No defect
found. `revokeToken` is symmetric across both cookie and mobile Bearer-token
transports.

## MFA / provider-policy ordering on login-shaped routes

Confirmed correct on all four route families:
- **Local password login**: verify → SSO-mandated check → `assertProviderAllowed`
  → `assertMfaSatisfied` → `signJWT`/`res.cookie`, in that order.
- **Firebase/Google/Phone**: Firebase token verify → account lookup →
  `assertProviderAllowed` → `assertMfaSatisfied` → `signJWT`/`res.cookie`. This
  exact ordering was the fix for a documented, dated defect ("Mission 33 — MFA
  End-to-End Certification, 2026-08-22") where this path previously had **zero**
  MFA/provider-policy enforcement — a full bypass. Confirmed fixed, currently
  correct in code.
- **SSO/SAML/OIDC**: intentionally delegates MFA to the org's own IdP — matches
  CLAUDE.md §6's stated design decision exactly. Not a gap.

## Rate limiting

Custom in-memory limiter (`backend/middleware/rateLimiter.js`), no external
dependency, per CLAUDE.md §13. Confirmed applied to login, forgot/reset
password, Firebase login, email verification, registration, and both payment
webhook aliases (`/webhook/razorpay`, `/razorpay-webhook`).

**Open gap (P2, REAL DEFECT — partial fix):** `pipeline.js` (`POST /pipeline/run`,
triggers real git commits) and `engineering.js` (`/scenario/run`, `/benchmark/run`,
`/benchmark/scenario/:id`, also git-committing) have zero `rateLimiter` call
sites. The remediation plan that fixed these routes' auth gates
(`MISSION-PLAN-BACKEND-TENANT-ISOLATION-FIX.md`, Group D item 9) explicitly
called for adding rate limiting alongside the auth fix — the auth/ownership half
was implemented, the rate-limiting half was not. `browserPlatform.js`'s session
CRUD routes have the same partial-fix shape (IDOR now fixed, still unthrottled).

## Secrets, CORS/CSP, SSRF, path traversal, command injection, Electron IPC

- **secretVault.cjs**: AES-256-GCM, HKDF-SHA256-derived key with a random
  persistent salt, no plaintext at rest, a genuine append-only reveal-audit
  log. Two historical leaks (raw filesystem error paths leaking through
  storeSecret/deleteSecret/rotateSecret; a cross-org env-var fallback exposing
  the founder's own platform API key under a customer org's status check) are
  both confirmed **fixed** (dated 2026-08-21 in code comments).
- **CORS/CSP**: manual header block in `backend/server.js` replicates helmet's
  coverage; explicit origin allowlist; per-request-nonce CSP in production. No
  dedicated CSRF token/double-submit scheme exists — reliance is on
  `SameSite=Strict` cookies plus the origin allowlist (P3/DESIGN DECISION,
  common accepted pattern for this app shape, now explicitly named rather than
  silently assumed).
- **SSRF**: shared choke point `backend/utils/urlSafety.cjs`'s
  `assertSafeNavigationTarget()` blocks RFC1918/loopback/link-local/cloud
  metadata addresses. Two historical SSRF defects
  (`operationsAlertingLayer.cjs` webhook channel, `vsCodeExtensionService.cjs`'s
  Ollama completion echo) are confirmed **fixed** (Mission 17, 2026-08-22, with
  live-reproduction and negative-testing documented in the source report).
- **Path traversal**: `exportFiles.js`'s "global" export scope previously relied
  on unguessable filenames alone (false in practice — predictable
  `Date.now()`/date-string names); now fails closed on a missing ownership
  record. Confirmed fixed.
- **Command injection**: `terminalAgent.cjs` → `backend/core/safe-exec` uses
  `spawn(shell:false)`, an executable allowlist, argument-pattern validation,
  pinned CWD, sanitized environment, timeout + output cap. The one raw-shell
  route (`POST /computer/terminal/run`) is `requireAuth + operatorOnly`-gated.
  No defect found.
- **Electron IPC**: `contextIsolation: true`, `nodeIntegration: false` confirmed
  at all `BrowserWindow` construction sites in `electron/main.cjs`. No defect
  found (see `18_ELECTRON.md` for the fuller Electron-specific history —
  Missions 53/54/58 found and fixed real IPC/navigation issues that predate
  this mission's own read).

## Findings table

| # | Finding | Severity | Classification | Status |
|---|---|---|---|---|
| 1 | 9 Mission 43A/follow-up tenant-isolation/IDOR/auth-gate defects | was P0/P1 | REAL DEFECT (historical) | **FIXED** (Mission 51, 2026-08-26) — see `09_TENANT_ISOLATION.md` |
| 2 | `pipeline.js`/`engineering.js` mutating routes have no rate limiter (plan item not fully executed) | P2 | REAL DEFECT | **OPEN** |
| 3 | `browserPlatform.js` session CRUD routes: IDOR fixed, still unthrottled | P3 | REAL DEFECT (minor) | **OPEN** |
| 4 | CLAUDE.md §6 states org context is "never" client-supplied; actual code allows client-supplied org **selection** (not authorization) via `X-Org-Id` — narrower and safe, but the doc text overstates the absolute rule | P3 | DOCUMENTATION DRIFT | Code correct; doc imprecise |
| 5 | `accounts.js` `GET /accounts` operator check implemented inline vs. shared middleware | P3 | DESIGN DECISION | No behavioral gap |
| 6 | Several optional-integration checks fail OPEN if a dependency throws (`_isStaleAfterPasswordChange` et al.) | P3 | DESIGN DECISION (reasoned in comments) | Operator awareness item |
| 7 | No CSRF token scheme; relies on SameSite+CORS | P3 | DESIGN DECISION | Accepted pattern, now explicit |
| 8 | SSO/SAML/OIDC delegates MFA to IdP | INFO | DESIGN DECISION | Matches CLAUDE.md exactly |
| 9 | Historical SSRF (2 instances) | was P1 | REAL DEFECT (historical) | **FIXED** |
| 10 | Historical secretVault leaks (2 instances) | was P1/P2 | REAL DEFECT (historical) | **FIXED** |
| 11 | Path traversal fail-open in `exportFiles.js` | was P1 | REAL DEFECT (historical) | **FIXED** |

See `08_AUTH_RBAC_MFA.md` and `09_TENANT_ISOLATION.md` for the RBAC/MFA and
tenant-isolation-chain detail, and `evidence/security/` for the citation index.
