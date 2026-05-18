> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# AUTH VALIDATION REPORT
Phase K — Production Unlock + Route Hardening  
Date: 2026-05-16  
Tester: Automated regression suite (`/tmp/jarvis_regression.cjs`)

---

## Regression Results: 40/40 PASS

All auth and hardening tests passed on final run after server restart and two bug fixes (see §5).

---

## A. Auth Flow (A1–A9)

| ID | Test | Result |
|----|------|--------|
| A1 | Valid login → HTTP 200, `success: true` | PASS |
| A2 | Token generated via `signJWT` with real `JWT_SECRET` | PASS |
| A3 | Wrong password → HTTP 401 | PASS |
| A4 | Missing password body → HTTP 400 | PASS |
| A5 | `GET /auth/me` with valid `x-auth-token` → 200, role=operator | PASS |
| A6 | `GET /auth/me` with no token → 401 | PASS |
| A7 | Malformed JWT → 401 | PASS |
| A8 | Expired JWT → 401 | PASS |
| A9 | Tampered JWT (signature mismatch) → 401 | PASS |

**Notes:**
- Password verification uses `crypto.scryptSync` (64-byte key, stored as `salt:hash` hex).
- JWT is HS256 signed with `process.env.JWT_SECRET` read at call time (not module-load time), so key rotation takes effect immediately after server restart.
- `requireAuth` accepts tokens from `jarvis_auth` httpOnly cookie OR `x-auth-token` header. The header path is required for local HTTP testing because `secure: true` (set when `NODE_ENV=production`) prevents browsers/curl from sending the cookie over plain HTTP.
- `verifyJWT` uses `crypto.timingSafeEqual` for signature comparison — timing-safe against length-extension probing.
- Login rate limit: 10 attempts / 5 minutes per IP. Subsequent attempts → 429.

---

## B. Route Hardening — Unauthenticated → 401 (B1–B6)

| Route | Method | Result |
|-------|--------|--------|
| `/jarvis` | POST | PASS 401 |
| `/ai/chat` | POST | PASS 401 |
| `/whatsapp/send` | POST | PASS 401 |
| `/whatsapp/bulk` | POST | PASS 401 |
| `/telegram/send` | POST | PASS 401 |
| `/payment/link` | POST | PASS 401 |

All six routes that were previously open (or using optional/Firebase auth) now require a valid operator JWT.

**Intentionally open routes (no auth required):**
- `POST /whatsapp/webhook` — Meta callback, verified by `wa.verifyWebhook()` HMAC
- `POST /webhook/razorpay`, `POST /razorpay-webhook` — Razorpay callbacks, verified by signature
- `GET /health`, `GET /test`, `GET /api/status` — monitoring/CI probes
- `GET /telegram/status` — read-only config status

---

## C. Authenticated Routes (C1–C12)

| Test | Result |
|------|--------|
| `POST /runtime/dispatch` git status — 200, stdout present | PASS |
| `POST /runtime/dispatch` time query — 200, time regex match | PASS |
| `POST /runtime/dispatch` node -v — 200 | PASS |
| `POST /runtime/queue` — 200, `success: true`, `queueId` present | PASS |
| `GET /runtime/history` — 200, `success: true` | PASS |
| `GET /runtime/status` — 200 | PASS |
| `GET /runtime/health/deep` — 207 (degraded), heap < 512MB | PASS |
| `GET /runtime/dead-letter` — 200 | PASS |
| `POST /runtime/emergency/stop` — 200, `success: true`, emergencyId set | PASS |
| `POST /runtime/emergency/resume` — 200, `resolved: true` | PASS |
| `POST /payment/link` (with auth) — 500 from Razorpay (not 401) | PASS |

Heap at test time: **34–37 MB** (well within limits).

---

## D. Open Probes (D1–D4)

| Route | Result |
|-------|--------|
| `GET /health` | PASS 200 |
| `GET /test` | PASS 200 |
| `GET /api/status` | PASS 200 |
| `GET /telegram/status` | PASS 200 |

---

## E. Memory Snapshot

| Metric | Value |
|--------|-------|
| Heap used | 34.5 MB |
| RSS | 125.7 MB |
| Uptime at test | < 1 min |

---

## 5. Bugs Found and Fixed During Phase K

### Bug K-1: `/health` behind auth gate
**File:** `backend/routes/ops.js`  
**Issue:** `/health` handler was defined AFTER `router.use(requireAuth, operatorAudit)`, despite the comment saying it should be open.  
**Fix:** Moved the entire `/health` handler block to before the `router.use(requireAuth, ...)` gate, alongside `/test` and `/api/status`.  
**Impact:** `/health` was returning 401 for all monitoring tools and Docker HEALTHCHECK.

### Bug K-2: `executor.cjs` missing `execute` export
**File:** `agents/executor.cjs`  
**Issue:** `executionEngine.cjs` calls `legacy.execute(task, ctx)` to dispatch to the legacy executor, but `executor.cjs` exported only `{ executorAgent }`. `legacy.execute` was `undefined`, so the engine fell through to "No handler" for all capabilities including `system` (time, date, status, clear_memory).  
**Fix:** Added `execute: executorAgent` to exports.  
**Impact:** `/runtime/dispatch "what is the time"` returned "No handler for capability 'system'" instead of the time string.

### Bug K-3: Regression script JWT_SECRET poisoning
**File:** `/tmp/jarvis_regression.cjs` (test script, not production code)  
**Issue:** Script called `process.env.JWT_SECRET = require(...).COOKIE_NAME` before dotenv loaded, then used `dotenv.config()` without `override: true`. dotenv preserves existing env vars by default, so JWT_SECRET remained "jarvis_auth" (the cookie name) instead of the real secret. Tokens signed with wrong key → 401 on all authenticated tests.  
**Fix:** Removed the incorrect assignment; used `dotenv.config({ ..., override: true })` before loading authMiddleware.  
**Impact:** Test-only bug — no production impact.

---

## 6. Auth Security Assessment

| Property | Status |
|----------|--------|
| Password hashing | scrypt-64 — adequate |
| JWT algorithm | HS256 — acceptable for single-server operator tool |
| JWT secret length | 32 bytes (hex 64 chars) — adequate |
| Timing-safe compare | Yes (`crypto.timingSafeEqual`) |
| Token expiry | 8 hours |
| Cookie flags | `httpOnly: true`, `sameSite: strict`, `secure: true` (production) |
| Rate limiting | 10 login attempts / 5 min per IP |
| No user enumeration | Yes — wrong password and missing password return different codes (401 vs 400), but 400 only fires on missing body, not on wrong username |
| Refresh token | None — tokens are 8h, no silent refresh |
| Logout | No server-side revocation — `POST /auth/logout` clears cookie client-side only |

**Remaining attack surface:**
- No server-side token revocation. A stolen JWT is valid for up to 8h. Mitigation: operator can change `JWT_SECRET` to invalidate all tokens.
- No brute-force protection on `/auth/me` (only `/auth/login` is rate-limited). Low risk since `/auth/me` only validates, not issues, tokens.
- JWT secret is 32 bytes random hex — adequate, but if the .env file is leaked the entire auth system is compromised.
