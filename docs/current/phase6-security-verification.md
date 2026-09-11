# Phase 6 — Security Verification (V1 Production Readiness)

**Date:** 2026-07-17
**Method:** Live server test (`JWT_SECRET=security-verify-secret2 PORT=5064 node backend/server.js`) plus source verification. Builds on and re-verifies prior sessions' findings (`docs/current/v1-final-reality-report.md`, `docs/current/reality-inventory.json`) rather than re-deriving them.

## 1. JWT — PASS

- Tampered signature (corrupted last 5 chars of a valid token): **401** — rejected.
- Expired token (`exp` 1 hour in the past): **401** — rejected.
- Valid token (control): **200** — accepted.
- Re-confirms `backend/middleware/authMiddleware.js`'s constant-time signature comparison and expiry check are both live and correct.

## 2. CORS — PASS (with a minor finding)

- Disallowed origin (`https://evil-attacker.example.com`): request effectively rejected — **no `access-control-allow-origin` header granted** (`null`), but the response status is **500**, not a clean 403/blocked status. Root cause: `backend/server.js:157` calls `cb(new Error(...))` inside the `cors()` origin callback, which Express's default error handler turns into a 500. The rejection itself is real and correct; the status code is just not the cleanest choice. **Not fixed** — changing error-handling behavior here risks altering other error-handling paths that share the same Express default handler; flagged as a minor finding, not a vulnerability.
- Allowed origin (`https://ooplix.com`, matches `ALLOWED_ORIGINS` in `.env`): **200** with the correct `access-control-allow-origin` header echoed back.

## 3. Rate limits — PASS

- 15 consecutive `POST /auth/login` requests with a wrong password: **429 hit at request #11**, matching the documented 10-requests-per-window limit in `backend/middleware/rateLimiter.js`.
- Re-confirms the login endpoint's brute-force protection is live and working.

## 4. Security headers — PASS

Live headers observed on `GET /health`:
- `content-security-policy`: real, restrictive policy present — `default-src 'self'`, nonce-based `script-src`, `frame-ancestors 'none'`.
- `x-content-type-options`: `nosniff` — present.
- `x-frame-options`: `DENY` — present.
- `strict-transport-security`: `max-age=63072000; includeSubDomains; preload` — present (2-year HSTS with preload, a strong setting).
- `referrer-policy`: `strict-origin-when-cross-origin` — present.
- `x-powered-by`: absent (Express's default fingerprinting header is correctly suppressed).

## 5. Secrets — not re-scanned this pass

A prior session's audit already searched the tracked repo for committed secret patterns (AWS keys, private key headers, high-entropy tokens) and found none beyond the previously-remediated Firebase web API key situation (a public-by-design client key, not a server secret — see `docs/current/v1-final-reality-report.md`). Not re-run this pass to avoid duplicating recent, still-valid work.

## 6. Electron/IPC — PASS

`node scripts/electron-smoke-test.cjs`: **22/22 passing**, re-run fresh this session (twice — once before and once after an unrelated `electron-store` ESM-interop fix landed in `electron/main.cjs`). Confirms `contextIsolation:true`, `nodeIntegration:false`, CSP injection, navigation guards, and `setPermissionRequestHandler` are all still correctly set in the live `electron/main.cjs` (not reverted since the last verification). The `Store = require("electron-store")` fix (correcting for the package's ESM `.default` export shape) is a separate, real bug fix — verified live: `require("electron-store")` on this system returns `{__esModule:true, default:<class>}`, so the old code would have set `Store` to the wrong value and any `new Store()` call would have thrown at runtime.

## 7. XSS — PASS

`grep -rc dangerouslySetInnerHTML frontend/src --include=*.jsx`: **0 hits**, re-confirmed this session.

## 8. CSRF — FINDING (unchanged from prior sessions, not a new gap)

No dedicated CSRF-token middleware exists anywhere in `backend/`. Mitigation is `sameSite: "strict"` on the auth cookie (`backend/middleware/authMiddleware.js:93`, re-confirmed present this session) — real and meaningful for browser-driven cross-site requests, but not equivalent to a full CSRF-token defense (though it covers the overwhelming majority of realistic CSRF vectors for a cookie-authenticated app). Reported as a known gap, not fixed — adding a CSRF-token layer is a larger change than this pass's fixes-only scope.

## 9. Path traversal — PASS (fix from a prior session confirmed still in place)

`_safeResolve()` guards are still present and unreverted in both `backend/services/selfHealingFrontend.cjs` (`applyFix`/`rollbackFix`/`generateFix`) and `backend/services/uiPatchGenerator.cjs` (`generatePatch`/`applyPatch`/`rollbackPatch`), confirmed via direct source grep this session. This is the same fix documented in `docs/current/v1-final-reality-report.md` Phase 3.

## 10. Command injection — PASS

- `backend/core/safe-exec.js` uses `spawn(cmd, args, ...)` with no shell (args passed as an array, not a shell string), the dominant safe pattern across the codebase.
- One `execSync` with template-string interpolation found: `backend/routes/codingAssistant.js:63`, `` execSync(`git log --oneline -${n}`) ``. Traced `n`'s only call site (`backend/routes/codingAssistant.js:126`, `_gitLog(cwd)`) — called with **no second argument**, so `n` is always the hardcoded default `10`, never user-controlled. **Not exploitable as written.**

## 11. SSRF — REAL FINDING, NOT FIXED (reported precisely)

Three authenticated routes accept a client-supplied `url` and pass it into a real headless-browser navigation with **no validation against internal/private IP ranges or the cloud metadata endpoint** (`169.254.169.254`):

- `POST /odi/interactions/analyze` (`backend/routes/odi.js:494-501`) → `interactionIntelligence.cjs:133` `analyzeInteractions({url})`
- `POST /odi/editor/start` (`backend/routes/odi.js:762-769`) → `liveDesignEditor.cjs:56` `startSession({url})`
- `POST /odi/observer/cycle` (`backend/routes/odi.js:873-879`) → `continuousDesignObserver.cjs:182` `runManualCycle({url})`

All three are gated by `requireAuth` (`backend/routes/odi.js:90`, `router.use("/odi", requireAuth)` — not anonymously reachable) and rate-limited (`rateLimiter(5, 60_000)` on each route). No `127.0.0.1`/`localhost`/`169.254.x.x`/`10.x`/`172.16-31.x`/`192.168.x` blocklist exists anywhere in `agents/browser/browserSession.cjs` or the three consuming services (confirmed via grep — zero hits for any private-IP pattern or SSRF-guard naming).

**Impact:** an authenticated user (any role — no additional permission check beyond login) can direct the server's real headless browser to fetch/render any URL, including internal-network services or cloud-provider metadata endpoints if this is ever deployed on AWS/GCP/Azure infrastructure where the metadata endpoint could leak instance credentials.

**Not fixed this pass, deliberately:** the three consuming services are three separate files with no shared navigation choke point (`browserSession.cjs` only creates browser pages, it doesn't itself navigate — each consumer calls `page.goto(url)` independently, and `continuousDesignObserver.cjs` doesn't even use `browserSession.cjs`). A correct fix means either (a) duplicating a URL-validation check across 3-4 call sites, which is real but scattered engineering, or (b) introducing one shared validation utility, which risks crossing into "new architecture" for a mission explicitly scoped to fixes only. Flagged here as a genuine, reachable, real production risk requiring a deliberate follow-up decision, not silently patched.

## 12. Prototype pollution — PASS (pattern found, confirmed not exploitable)

One `{...JSON.parse(...)}`-shaped pattern found: `backend/services/selfHealingFrontend.cjs:160`, `return { ok: true, ...JSON.parse(jsonMatch[0]) }`. This spreads a parsed object into a **fresh object literal**, not merged via `Object.assign` onto an existing/shared object or a recursive-merge utility — the classic Node prototype-pollution vector requires the latter. Additionally, `jsonMatch` is extracted from an AI provider's text response (`ai.callAI(prompt, ...)`), not directly from user request input — one further layer removed from attacker control. **Not exploitable as written.**

---

## Summary

| # | Item | Verdict |
|---|---|---|
| 1 | JWT | PASS |
| 2 | CORS | PASS (minor: 500 instead of a cleaner rejection code) |
| 3 | Rate limits | PASS |
| 4 | Headers | PASS |
| 5 | Secrets | Not re-scanned (prior session's clean result stands) |
| 6 | Electron/IPC | PASS (plus one real, unrelated `electron-store` ESM-interop bug found and fixed) |
| 7 | XSS | PASS |
| 8 | CSRF | FINDING — no token layer, mitigated by sameSite:strict, not fixed (larger change) |
| 9 | Path traversal | PASS — prior fix confirmed still in place |
| 10 | Command injection | PASS |
| 11 | **SSRF** | **REAL FINDING — 3 authenticated, rate-limited routes let a user direct real browser navigation to internal/private network targets with zero validation. Not fixed — needs a deliberate shared-utility decision, out of scope for a fixes-only pass.** |
| 12 | Prototype pollution | PASS — pattern found, confirmed not exploitable |

**Most severe issue: SSRF via the ODI browser-automation routes (#11).** Real, reachable by any authenticated user, not previously flagged in any prior session's audit. Reported with full file:line evidence; not silently patched given the scattered-choke-point tradeoff described above.
