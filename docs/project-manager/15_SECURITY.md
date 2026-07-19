# 15 — Security

**Status of this document:** VERIFIED against direct source reads (`backend/middleware/authMiddleware.js`, `backend/middleware/rateLimiter.js`, `backend/middleware/orgMiddleware.cjs`, `backend/server.js`), cross-checked against `docs/current/phase6-security-verification.md` (a live, 2026-07-17 penetration-style audit) and `SECURITY.md` (the repo's own policy document — used cautiously, since two factual errors were found in it during this audit, both flagged below).

---

## Authentication

**Hand-rolled JWT (HS256), not a third-party library.** `backend/middleware/authMiddleware.js` implements `signJWT()`/`verifyJWT()` manually using Node's built-in `crypto.createHmac("sha256", secret)`, with `crypto.timingSafeEqual()` for signature comparison — no `jsonwebtoken` package dependency exists.

- **Token delivery**: httpOnly cookie (`jarvis_auth`), 8-hour expiry, `{httpOnly: true, secure: NODE_ENV==='production', sameSite: 'strict'}`.
- **Fail-closed by design**: if `JWT_SECRET` is unset, `requireAuth` returns 503 unless both `NODE_ENV !== 'production'` **and** an explicit `ALLOW_DEV_AUTH_BYPASS=1` opt-in are present — a deliberate choice documented in-code to avoid silently failing open on a forgotten `NODE_ENV`.
- **Password hashing: `crypto.scryptSync`, not bcrypt.** Confirmed in both `backend/routes/auth.js` and `scripts/generate-password-hash.cjs` — stored as a `salt:hash` hex string in `OPERATOR_PASSWORD_HASH`. **This directly contradicts `SECURITY.md`, which claims "bcrypt password hashing (cost factor 12)."** No bcrypt package exists anywhere in the dependency tree. scrypt is a reasonable, modern choice — the documentation claim is simply factually wrong and should be corrected.
- **Live-verified this session**: JWT tampering rejected, expiry enforced, no-cookie → 401, valid token → 200, real 403 returned to a second "attacker" identity attempting another user's data.
- **Firebase OAuth also exists** on the web build (Google/Phone sign-in) — this **contradicts `SECURITY.md`'s "no SSO/OAuth provider login" claim**, which appears stale relative to the actual code. `frontend/src/firebaseService.js` and Firebase JS SDK 10.14.1 are real, present dependencies.

## Authorization / RBAC

Two-tier model, both tiers live-verified:
1. **Coarse role gate** — `operatorOnly` middleware checks `req.user.role === "operator"`.
2. **Organization-scoped RBAC** — `backend/middleware/orgMiddleware.cjs`: `attachOrg()` resolves the active org from a header/query/body param or the user's first membership; `requireOrgMember()` and `requireOrgPermission(action)` delegate to the organization service's `hasPermission()`. Live-verified in the 2026-07-17 audit: a second identity correctly receives 403 on both read and privileged (delete) operations against another org's data.

A `ROLE_MATRIX.md` exists at the repo root documenting the intended role structure in more detail (not independently re-verified line-by-line in this audit).

**A code-level finding worth flagging**: the route barrel (`backend/routes/index.js`) contains explicit comments admitting that at least 3 in-route `requireAuth` guards resolved to no-ops due to bad require paths (`/agents`, `/computer`, `/twin`, `/workforce-os`), compensated for by a barrel-level gate placed ahead of the mount. This was live-verified as currently effective (real 403s returned), but it indicates auth enforcement has had genuine gaps in the past that were patched defensively at the barrel level rather than at the source of the bug.

## Rate Limiting

**Custom in-memory limiter, not a library** (`backend/middleware/rateLimiter.js`) — keyed by `${ip}:${routeId}:${windowMs}` in a module-level Map, 5-minute sweep for stale entries. Sets standard `X-RateLimit-*` headers, returns 429 with `Retry-After`.

**Coverage is thin: only 7 of 126 route files apply it** — accounts, auth, browser, jarvis, odi, runtime, whatsapp. Every org-ladder, POST-Ω domain, coding-assistant, and production-tooling route is unthrottled. This is **authenticated-only exposure, not an open door** — but a single valid token can issue unbounded requests to expensive AI-backed endpoints. See [19_RISK_REGISTER.md](19_RISK_REGISTER.md) R3.

Nginx layers additional rate limiting at the reverse-proxy level (`limit_req_zone` for `api_global` 60r/min, `api_auth` 10r/min, `api_jarvis` 30r/min, `api_broad` 120r/min) — real defense-in-depth, confirmed in `nginx.conf`.

## CORS

Implemented via the `cors` package with a custom origin-allowlist callback — not wildcard. Production origins are hardcoded (`ooplix.com` family) and unioned with the `ALLOWED_ORIGINS` env var, `credentials: true` for cookie auth. A real production incident is documented in `AUTH_AUDIT_REPORT.md` (assessed as genuinely code-verified, not aspirational — it includes literal curl reproductions and a real diff): a misconfigured `ALLOWED_ORIGINS` on the VPS once caused all production auth requests to fail with CORS 500s, root-caused and fixed by hardcoding the production origin list directly in `server.js`.

## Security Headers

Hand-rolled middleware (no `helmet` dependency) sets: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and a CSP with a per-request nonce + `strict-dynamic` in production (permissive `unsafe-inline`/`unsafe-eval` in dev). HSTS added only in production. Live-verified this session: full security header set present, zero XSS sinks found, no `X-Powered-By` leak.

## Secrets

- `.env`-based configuration, excluded from git via `.gitignore` and from the Electron build via `electron-builder`'s `files` exclusions.
- A dedicated **secret vault** (`backend/services/secretVault.cjs`) with AES-256-GCM encryption, paired with `secretRotationAutomation.cjs` for scheduled rotation reminders and auto-staging of rotation candidates — real, wired at server startup, not just documentation.
- `deploy/start-production.sh` validates `JWT_SECRET` is ≥32 bytes and not a placeholder, and `BASE_URL` is HTTPS and not localhost, before allowing a production start.
- **A real gap found during this documentation effort, outside the scope of the codebase audit**: an untracked file `.env.bak.module8` was found in the repo root containing what appears to be a live OpenAI API key in plaintext, and it is **not** covered by `.gitignore`'s `.env*` patterns (only `.env`, `.env.local`, `.env.production` are explicitly listed — not `.env.bak.*`). This means a broad `git add` could stage and commit it. **Flagged directly to the user; not something this documentation set can fix on its own — recommend deleting the file and rotating the exposed key if there is any chance it was staged or pushed.**

## Backup & Recovery

See [14_INFRASTRUCTURE.md](14_INFRASTRUCTURE.md). Summary: real, working backup mechanism (`safe-backup.cjs`, live-verified); a real naming-mismatch bug in the restore *validator* (not the backup itself); `.env` deliberately excluded from all backups by design (to avoid every backup copy also being a credentials leak); off-server backup replication explicitly not yet set up, per the founder's own `DISASTER_RECOVERY.md`.

## Known Risks (VERIFIED, not fixed)

1. **SSRF** — 3 authenticated, rate-limited ODI browser-automation routes (`/odi/interactions/analyze`, `/odi/editor/start`, `/odi/observer/cycle`) let a logged-in user direct real browser navigation to arbitrary URLs, including internal network addresses and cloud metadata endpoints, with zero validation. No IP-range blocklist exists anywhere in the consuming service files. **This is the single highest-severity unmitigated finding in the codebase** as of the 2026-07-17 audit. A subsequent commit on the current branch (`06e50b2`) appears to address it — verify before relying on this.
2. **No CSRF-token layer** — mitigated by `sameSite: "strict"` on the auth cookie, which covers the overwhelming majority of realistic CSRF vectors for a cookie-authenticated app, but is not a complete substitute for a token-based defense.
3. **Thin rate-limiting coverage** — 7 of 126 route files (see above).
4. **No database-enforced tenant isolation** — the application-layer RBAC is real and live-tested, but there is no schema/row-level backstop behind it. See [19_RISK_REGISTER.md](19_RISK_REGISTER.md) R2.
5. **`SECURITY.md` itself contains stale/incorrect claims** — bcrypt (actual: scrypt), "no SSO" (actual: Firebase OAuth exists on web), and a "3.x current" version reference inconsistent with the actual `1.0.0-rc6` package version. This documentation set flags these as a maintenance item: **`SECURITY.md` should be updated to match the actual code before being relied upon externally** (e.g. for a security disclosure program or a compliance review).

---

*Next: [16_DEVOPS.md](16_DEVOPS.md) for the CI/CD and release process protecting this security posture.*
