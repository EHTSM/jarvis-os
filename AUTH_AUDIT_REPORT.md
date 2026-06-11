# AUTH_AUDIT_REPORT — Phase 1 Authentication Debug

**Date:** 2026-06-11  
**Branch:** main  
**Commit:** e6fd863  
**Method:** curl-based reproduction against running backend — browser behaviour as source of truth

---

## Root Cause (Confirmed by Evidence)

**Single root cause for all three errors: CORS rejection**

```
curl -X POST http://localhost:5050/accounts/register \
  -H "Origin: https://app.ooplix.com" \
  -d '{"email":"test@example.com","password":"TestPass123!","name":"Test"}'

→ HTTP 500
→ {"success":false,"error":"Internal server error","details":"CORS: origin 'https://app.ooplix.com' not allowed"}
```

**Why:** `ALLOWED_ORIGINS=http://localhost:3000` was the value in `.env`.  
`.env` is gitignored — VPS has never received a CORS update in any prior deploy.  
Every browser fetch from `https://app.ooplix.com` carries `Origin: https://app.ooplix.com`.  
That origin was not in the allowlist → Express CORS middleware rejected all requests → browser received 500 → Firebase SDK received no response → displayed "Network error" / "internal error".

**Firebase authorized domain errors (Google/Phone) were secondary** — Firebase Console was updated but the fetch to `/auth/firebase-session` also failed with the same CORS 500.

---

## Evidence: Before Fix

| Request | Origin | Response | Error |
|---------|--------|----------|-------|
| POST /accounts/register | https://app.ooplix.com | 500 | CORS: origin not allowed |
| POST /auth/login | https://app.ooplix.com | 500 | CORS: origin not allowed |
| GET /auth/me | https://app.ooplix.com | 500 | CORS: origin not allowed |
| POST /auth/firebase-session | https://app.ooplix.com | 500 | CORS: origin not allowed |

## Evidence: After Fix

| Request | Origin | Response | CORS Header |
|---------|--------|----------|-------------|
| POST /accounts/register | https://app.ooplix.com | **201** | Access-Control-Allow-Origin: https://app.ooplix.com |
| POST /auth/login | https://app.ooplix.com | **200** | ✓ |
| GET /auth/me (with cookie) | https://app.ooplix.com | **200** `{"success":true,"user":{...}}` | ✓ |

Cookie issued: `jarvis_auth=<JWT>; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`

---

## Fix Applied

**File:** `backend/server.js`

Before:
```js
const _allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
```

After:
```js
const _PRODUCTION_ORIGINS = [
    "https://ooplix.com",
    "https://www.ooplix.com",
    "https://app.ooplix.com",
    "https://api.ooplix.com",
];
const _envOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
const _allowedOrigins = [...new Set([..._PRODUCTION_ORIGINS, ..._envOrigins])];
```

Production domains are now hardcoded and always included regardless of `.env` value.  
`ALLOWED_ORIGINS` env var still works — it adds to the list (e.g. `http://localhost:3000` for local dev).

---

## Additional Fixes in This Session (commits 0acb75f → e6fd863)

| Fix | File | Detail |
|-----|------|--------|
| Phone login broken | LoginPage.jsx | `login(null, phoneEmail)` → backend returned 400 "Password required". Fixed: use `firebaseSession(idToken)` |
| Phone signup broken | SignupPage.jsx | Same `login(null, email)` bug. Fixed: use `firebaseSession(idToken)` + `silentCheck()` |
| Email signup blocks on Firebase | SignupPage.jsx | Firebase `auth/network-request-failed` aborted the entire flow before backend was called. Fixed: Firebase errors (network, internal) are now bypassed; backend registration always runs |
| Double login call | SignupPage.jsx | Was calling `loginWithEmail()` (raw) then `login()` (AuthContext) — duplicate request. Removed the raw call. |
| JWT refresh | backend/routes/auth.js | Added `POST /auth/refresh` |
| Forgot password | backend/routes/auth.js | Added `POST /auth/forgot-password` (anti-enumeration) |
| Firebase session bridge | backend/routes/auth.js | Added `POST /auth/firebase-session` for Google/Phone OAuth |

---

## Flow Status After Deploy

| Flow | Endpoint | Expected Result |
|------|----------|----------------|
| Email signup | POST /accounts/register | 201 + account object |
| Email login | POST /auth/login | 200 + jarvis_auth cookie |
| Session check | GET /auth/me | 200 + user object |
| Logout | POST /auth/logout | 200 + cookie cleared |
| Google OAuth | POST /auth/firebase-session | 200 + jarvis_auth cookie (requires Firebase authorized domain) |
| Phone OTP | POST /auth/firebase-session | 200 + jarvis_auth cookie (requires Firebase authorized domain) |
| JWT refresh | POST /auth/refresh | 200 + fresh cookie |
| Forgot password | POST /auth/forgot-password | 200 always (anti-enumeration) |

---

## Deploy Command (VPS)

```bash
cd /var/www/jarvis
git pull origin main
npm run build --prefix frontend
pm2 restart jarvis
pm2 logs jarvis --lines 5 --nostream
```

No `.env` changes required for this fix — CORS is now hardcoded in server.js.

---

## Remaining Issues

| Issue | Severity | Action |
|-------|----------|--------|
| SSL: ooplix.com / www.ooplix.com ERR_CERT | Medium | VPS: `certbot --nginx -d ooplix.com -d www.ooplix.com -d app.ooplix.com --expand` |
| BASE_URL=http://localhost:5050 in VPS .env | Medium | Edit VPS .env: `BASE_URL=https://app.ooplix.com` (payment callbacks fail without this) |
| Port 5050 publicly accessible | Low | VPS: `ufw deny 5050 && ufw reload` |
