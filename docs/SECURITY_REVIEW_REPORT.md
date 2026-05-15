# Security Review Report
**Phase G — Real Operator Deployment**
**Generated:** 2026-05-15

---

## Scope

Full operator security review of the JARVIS production runtime:
- Authentication layer
- Route exposure map
- Dev passthrough risks
- Shell execution paths
- Sensitive log exposure
- Production-only protections
- Cookie configuration
- Rate limiting
- Input validation
- Nginx security headers

---

## Authentication Architecture

### JWT Implementation

| Property | Value | Assessment |
|---|---|---|
| Algorithm | HS256 (HMAC-SHA256) | Acceptable for single-server operator tool |
| Secret | 32-byte random hex (from `scripts/generate-password-hash.cjs`) | Correct |
| Expiry | 8 hours | Appropriate for daily operator session |
| Storage | httpOnly cookie `jarvis_auth` | Correct — not accessible to JavaScript |
| Transmission | `withCredentials: true` on SSE | Correct — cookies sent on XHR and SSE |
| Signing | `crypto.createHmac("sha256", secret)` | Correct |
| Verification | `crypto.timingSafeEqual()` | Correct — no timing oracle |
| Parsing | Manual base64url decode | Custom implementation, verified correct |

### Password Storage

| Property | Value | Assessment |
|---|---|---|
| Hash function | `crypto.scryptSync(password, salt, 64)` | Strong — scrypt is memory-hard |
| Salt | `crypto.randomBytes(16).toString("hex")` | 128-bit random salt ✓ |
| Storage format | `salt:hash` in env var | Correct — not in code, not in DB |
| Comparison | `crypto.timingSafeEqual()` | Correct — no timing oracle |

### Cookie Security

| Attribute | Production Value | Assessment |
|---|---|---|
| `httpOnly` | `true` | ✓ Not accessible to JavaScript |
| `secure` | `true` (when `NODE_ENV=production`) | ✓ HTTPS only |
| `sameSite` | `"strict"` | ✓ CSRF protection |
| `path` | `"/"` | Fine |
| `maxAge` | 8h | Matches JWT expiry |

**Finding:** `secure: true` is gated on `NODE_ENV === "production"`. In dev mode, the cookie is sent over HTTP. This is acceptable for local development but **must** be verified as `production` on the VPS before deploy.

---

## Dev Passthrough Risk Analysis

The `requireAuth` middleware bypasses authentication when:
```
!process.env.JWT_SECRET && process.env.NODE_ENV !== "production"
```

### Risk Matrix

| Condition | Behavior | Risk |
|---|---|---|
| `NODE_ENV=production`, `JWT_SECRET` set | Full auth enforced | ✓ Safe |
| `NODE_ENV=production`, `JWT_SECRET` missing | 503 on all auth-gated routes | ✓ Fail-safe (console inaccessible but not bypassed) |
| `NODE_ENV=development`, `JWT_SECRET` missing | Dev passthrough — all requests pass | ⚠ Dev-only risk |
| `NODE_ENV=development`, `JWT_SECRET` set | Full auth enforced | ✓ Safe |

**Key point:** Dev passthrough is a **complete auth bypass** — no token or password is checked. This is intentional for local development but would be catastrophic on a production VPS.

**Mitigation in place:**
- `start-production.sh` now validates both `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` and **refuses to start** if either is missing
- `server.js` startup diagnostics logs auth status clearly
- `.env.example` has `NODE_ENV=production` set

**Residual risk:** An operator could manually set `NODE_ENV=development` on the VPS and start the server without PM2. This would expose the runtime with no authentication.

**Recommendation:** Add an explicit check in `requireAuth`: if `NODE_ENV=production` **or** port 5050 is open to the internet, enforce auth regardless of `JWT_SECRET`. (Medium priority, P2.)

---

## Route Exposure Map

### Public Routes (no auth required)

| Route | Method | Rate Limited | Notes |
|---|---|---|---|
| `/health` | GET | No | Exposes service status flags — intentional |
| `/jarvis` | POST | 60/min/IP | Main AI gateway — public for Telegram/WA integration |
| `/auth/login` | POST | 10/5min/IP | Correct rate limit |
| `/auth/logout` | POST | No | Safe |
| `/webhook/razorpay` | POST | No | Razorpay IPs only (HMAC verified) |
| `/whatsapp/webhook` | POST/GET | No | Meta verify token checked |
| `/ops` | GET | No | **See below** |
| `/stats` | GET | No | **See below** |
| `/metrics` | GET | No | **See below** |
| `/crm` | GET | No | **See below** |

**Finding: `/ops`, `/stats`, `/metrics`, `/crm` are public.** These endpoints expose:
- Agent names, counts, circuit breaker state
- CRM lead counts and revenue numbers
- Memory usage, queue depth

**Risk:** An external attacker can fingerprint the system (agent count, adapter names, error rates, revenue) without authentication.

**Recommendation (P2):** Gate `/ops`, `/stats`, `/metrics` behind `requireAuth`. CRM data (`/crm`) should also be auth-gated. The `/health` endpoint can stay public (status only, no revenue data).

### Auth-Gated Routes

| Route prefix | Gate |
|---|---|
| `/runtime/*` | `requireAuth` (all sub-routes via `router.use("/runtime", requireAuth)`) |
| `/auth/me` | `requireAuth` |

---

## Shell Execution Security

### Terminal Adapter

The `terminalExecutionAdapter.cjs` uses:
- `spawn(executable, args, { shell: false })` — no shell interpolation
- Allowlist enforcement via `adapterSandboxPolicyEngine.cjs`
- Global blocked patterns (prevents path traversal, piped commands, etc.)
- Timeout: 15s default, 60s max
- Output cap: 512KB

**Assessment: Solid.** `shell: false` with an explicit argument array eliminates shell injection. The allowlist is the primary control.

**Residual risk:** The allowlist is in `adapterSandboxPolicyEngine.cjs`. If the allowlist is permissive, an operator could execute dangerous commands. The allowlist has not been audited in this review — see the adapter file for the full list.

### Legacy `terminalAgent.cjs`

Uses `exec(command, { cwd, timeout })` — this calls `sh -c command`. If this agent is reachable from the `/jarvis` POST endpoint and user input reaches it unfiltered, it is a **command injection risk**.

**Finding:** `terminalAgent.cjs` uses `child_process.exec()` with a shell. The parser in `backend/utils/parser.js` routes `run X`, `execute X`, `terminal X` intents to a tool path. Whether user input from `/jarvis` reaches `terminalAgent.cjs` directly (vs the safer adapter) depends on the execution path.

**Recommendation (P1):** Audit the execution path from `/jarvis` → `toolAgent.cjs` → confirm only `terminalExecutionAdapter.cjs` (with `shell:false`) is used for terminal intents, never legacy `terminalAgent.cjs`.

---

## Sensitive Log Exposure

### What is logged

| Logger | Output | Sensitive data |
|---|---|---|
| `requestLogger` | Method, path, status, latency | Path may contain IDs |
| `logger.info` | Service status, auth state | Auth state (configured/not) |
| `execLog` | Task input, output, status | Task input could contain secrets |

**Finding:** Execution log (`data/logs/execution.ndjson`) persists task input verbatim. If an operator dispatches a command containing a secret (e.g. `run curl -H "Authorization: Bearer sk-..."`) it will be written to disk.

**Recommendation (P2):** Add a log scrubber that redacts common secret patterns (Bearer tokens, API keys matching known formats) before writing to `execution.ndjson`.

### PM2 log files

PM2 logs are written to `logs/pm2-out.log` and `logs/pm2-err.log`. The `data/logs/` directory is not restricted by the nginx config — if the app root is accessible, logs could be served as static files.

**Finding (P1):** The nginx config serves `frontend/build` as the static root. If `frontend/build` is the nginx `root`, the `data/` and `logs/` directories are NOT under that root — they're at the project root, not inside `frontend/build`. So they are NOT directly served by nginx.

**Assessment:** Not exposed via nginx. But if the project root is accidentally configured as the nginx static root (e.g. setting `root /opt/jarvis-os` instead of `root /opt/jarvis-os/frontend/build`), all files including `.env` and logs become accessible. **The nginx `root` path must be exactly `/path/to/project/frontend/build`.**

---

## Production-Only Protections

| Protection | Status |
|---|---|
| `secure` cookie in production | ✓ Enforced by `process.env.NODE_ENV === "production"` |
| JWT_SECRET validation at startup | ✓ Added in Phase G — logs error and fails login on missing key |
| `NODE_ENV=production` in `.env.example` | ✓ Default for production deployments |
| Startup validation in `start-production.sh` | ✓ Validates JWT_SECRET and OPERATOR_PASSWORD_HASH, aborts if missing |
| HSTS header | ✓ Added in Phase G nginx config |
| Content-Security-Policy | ✓ Added in Phase G nginx config |
| Server tokens off | ✓ `server_tokens off` in nginx |
| Rate limiting on auth routes | ✓ 10 req/5min on `/auth/login` |

---

## Nginx Security Posture

| Header | Value | Status |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | ✓ |
| `X-Content-Type-Options` | `nosniff` | ✓ |
| `X-XSS-Protection` | `1; mode=block` | ✓ |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | ✓ |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | ✓ Added |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'...` | ✓ Added (tighten after testing) |
| `Permissions-Policy` | `geolocation=(), microphone=(), camera=()` | ✓ Added |
| `server_tokens off` | Off | ✓ |

**Note:** The CSP includes `'unsafe-inline'` for scripts because React's CRA build uses inline chunk loaders. After confirming no inline scripts are needed, remove `'unsafe-inline'` and use a nonce-based policy.

---

## Summary Findings

| Severity | Finding | Status |
|---|---|---|
| P1 | Audit execution path — confirm `shell:false` adapter is always used for terminal | Needs audit |
| P1 | Verify nginx `root` path points to `frontend/build`, not project root | Deploy checklist |
| P1 | `/ops`, `/stats`, `/metrics`, `/crm` are unauthenticated — expose system internals | Known, not yet gated |
| P2 | Dev passthrough bypassable if `NODE_ENV=development` set manually on VPS | Startup check added |
| P2 | Execution log persists raw task input — may capture secrets | No scrubber yet |
| P2 | CSP uses `'unsafe-inline'` — should be tightened after build audit | Post-launch |
| Low | 8-hour session limit — SSE reconnect after expiry shows no banner | P1 in beta blockers |
