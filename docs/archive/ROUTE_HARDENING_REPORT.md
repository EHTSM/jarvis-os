> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# ROUTE HARDENING REPORT
Phase K — Production Unlock + Route Hardening  
Date: 2026-05-16

---

## Summary

6 previously unauthenticated routes hardened with `requireAuth` middleware.  
2 bugs fixed as a side effect of hardening audit.  
40/40 regression tests passing.

---

## Routes Hardened

| Route | File | Change | Webhook-safe? |
|-------|------|--------|---------------|
| `POST /jarvis` | `backend/routes/jarvis.js` | Replaced `optionalAuth` (Firebase) with `requireAuth` | N/A |
| `POST /ai/chat` | `backend/routes/ai.js` | Added `requireAuth` | N/A |
| `POST /telegram/send` | `backend/routes/telegram.js` | Added `requireAuth` | Yes — GET /telegram/status left open |
| `POST /whatsapp/send` | `backend/routes/whatsapp.js` | Added `requireAuth` | Yes — /whatsapp/webhook left open |
| `POST /whatsapp/bulk` | `backend/routes/whatsapp.js` | Added `requireAuth` | Yes — /whatsapp/webhook left open |
| `POST /payment/link` | `backend/routes/payment.js` | Added `requireAuth` | Yes — /webhook/razorpay left open |

---

## Routes Intentionally Left Open

| Route | Reason |
|-------|--------|
| `POST /whatsapp/webhook` | Meta Cloud API callback — verified by HMAC (`wa.verifyWebhook`) |
| `GET /whatsapp/webhook` | Meta webhook verification challenge |
| `POST /webhook/razorpay` | Razorpay webhook — verified by Razorpay signature in `webhookController` |
| `POST /razorpay-webhook` | Alias of above |
| `GET /health` | Docker HEALTHCHECK, nginx, monitoring probes |
| `GET /test` | CI smoke tests |
| `GET /api/status` | External status page monitoring |
| `GET /telegram/status` | Read-only config status — no sensitive data |
| `GET /auth/login` (POST) | Must be open — this IS the auth endpoint |
| `POST /auth/logout` | Clears cookie — safe to be open |
| `GET /auth/me` | Already requires valid JWT to return useful data |

---

## Runtime Routes — Auth at Prefix Level

`/runtime/*` routes are gated by `router.use(requireAuth)` in `backend/routes/index.js` before the runtime router is mounted. This means every route under `/runtime/` — including `/runtime/dispatch`, `/runtime/queue`, `/runtime/emergency/stop`, etc. — automatically requires a valid operator JWT with no per-handler annotation needed.

---

## Bugs Found During Hardening

### `/health` was behind auth gate
**Root cause:** In `ops.js`, the `/health` handler appeared after `router.use(requireAuth, operatorAudit)`. The comment said it should be open, but the code gated it.  
**Fix:** Moved `/health` to before the gate.  
**Impact severity:** High — Docker HEALTHCHECK, PM2, nginx, and all monitoring tools were receiving 401.

---

## Before/After State

### Before Phase K
```
POST /jarvis          — optionalAuth (Firebase, often a no-op — allowed unauthenticated)
POST /ai/chat         — no auth
POST /telegram/send   — no auth
POST /whatsapp/send   — no auth
POST /whatsapp/bulk   — no auth
POST /payment/link    — no auth
GET  /health          — 401 (behind gate — BUG)
```

### After Phase K
```
POST /jarvis          — requireAuth (operator JWT)
POST /ai/chat         — requireAuth (operator JWT)
POST /telegram/send   — requireAuth (operator JWT)
POST /whatsapp/send   — requireAuth (operator JWT)
POST /whatsapp/bulk   — requireAuth (operator JWT)
POST /payment/link    — requireAuth (operator JWT)
GET  /health          — open (fixed)
```

---

## Remaining Attack Surface

| Surface | Risk | Status |
|---------|------|--------|
| `POST /whatsapp/webhook` | Low — HMAC-verified by Meta signature | Acceptable |
| `POST /webhook/razorpay` | Low — signature-verified by Razorpay | Acceptable |
| `GET /health` | Minimal — uptime/memory stats, no credentials | Acceptable |
| `GET /api/status` | Minimal — version string only | Acceptable |
| Login brute-force | Rate-limited to 10/5min per IP | Acceptable |
| JWT stolen from header | Valid 8h — no revocation | Acceptable for operator tool |
| `.env` file leak | Full compromise | Operator responsibility |
