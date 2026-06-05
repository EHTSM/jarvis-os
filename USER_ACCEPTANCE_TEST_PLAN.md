# User Acceptance Test Plan — JARVIS-OS / Ooplix

**Date:** 2026-06-05  
**Tester:** Ehtesham (owner)  
**Environment:** Production server at `https://app.ooplix.com`  
**Backend port:** 5050 (local) / nginx on 443 (production)  
**Test tool:** `curl`, browser, Android phone

---

## How to Use This Document

1. Run each test in order
2. Mark **PASS** or **FAIL** in the checkbox
3. For FAIL: note the error message in the Notes column
4. Do not proceed to the next section until all P0 tests in current section pass

**Priority:**
- P0 = Launch blocker — must pass before going live
- P1 = Important — fix within first week post-launch
- P2 = Nice to have — fix in next sprint

---

## Environment Setup

```bash
# Set base URL for curl tests
export BASE=http://localhost:5050       # local
# export BASE=https://app.ooplix.com   # production

# Login and capture auth cookie
TOKEN=$(curl -s -X POST $BASE/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<your-operator-password>"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))")

COOKIE="Cookie: jarvis_auth=$TOKEN"
echo "Token: ${TOKEN:0:20}..."
```

---

## Section 1 — Authentication

### 1.1 Operator Login

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 1.1.1 | Login with correct password | `POST /auth/login {"password":"<pw>"}` | `{"success":true}` + cookie set | P0 | ☐ PASS ☐ FAIL | |
| 1.1.2 | Login sets httpOnly cookie | Check response headers `Set-Cookie` | `httpOnly; Secure; SameSite=Strict` | P0 | ☐ PASS ☐ FAIL | |
| 1.1.3 | Wrong password rejected | `POST /auth/login {"password":"wrong"}` | HTTP 401 | P0 | ☐ PASS ☐ FAIL | |
| 1.1.4 | Brute force blocked after 10 attempts | 11× wrong password requests | HTTP 429 on 11th | P0 | ☐ PASS ☐ FAIL | |
| 1.1.5 | Get current user | `GET /auth/me` with cookie | `{"role":"operator","sub":"..."}` | P0 | ☐ PASS ☐ FAIL | |
| 1.1.6 | Logout clears cookie | `POST /auth/logout` | HTTP 200, `Set-Cookie: jarvis_auth=; Max-Age=0` | P0 | ☐ PASS ☐ FAIL | |
| 1.1.7 | Protected route without cookie | `GET /runtime/status` (no cookie) | HTTP 401 | P0 | ☐ PASS ☐ FAIL | |
| 1.1.8 | Protected route with expired token | Tamper token | HTTP 401 | P0 | ☐ PASS ☐ FAIL | |

### 1.2 Email Account Login (Account System)

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 1.2.1 | Register new account | `POST /accounts/register {"email":"test@x.com","password":"Test1234","name":"Test"}` | `{"success":true}` | P0 | ☐ PASS ☐ FAIL | |
| 1.2.2 | Login with email + password | `POST /auth/login {"email":"test@x.com","password":"Test1234"}` | `{"success":true,"role":"user"}` | P0 | ☐ PASS ☐ FAIL | |
| 1.2.3 | Duplicate registration rejected | Re-register same email | HTTP 409 or error | P1 | ☐ PASS ☐ FAIL | |
| 1.2.4 | Get account profile | `GET /accounts/me` with cookie | email, name returned | P1 | ☐ PASS ☐ FAIL | |

---

## Section 2 — CRM

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 2.1 | List leads (empty) | `GET /crm` | `{"leads":[]}` or empty array | P0 | ☐ PASS ☐ FAIL | |
| 2.2 | Create lead | `POST /crm {"name":"Ali","phone":"+91999","source":"manual"}` | Lead ID returned | P0 | ☐ PASS ☐ FAIL | |
| 2.3 | List leads (populated) | `GET /crm` | Lead from 2.2 present | P0 | ☐ PASS ☐ FAIL | |
| 2.4 | Get lead by ID | `GET /crm/lead/<id>` | Lead object returned | P0 | ☐ PASS ☐ FAIL | |
| 2.5 | Update lead status | `PATCH /crm/lead/<id> {"status":"contacted"}` | Updated status returned | P1 | ☐ PASS ☐ FAIL | |
| 2.6 | CRM-leads endpoint | `GET /crm-leads` | Returns lead list | P1 | ☐ PASS ☐ FAIL | |
| 2.7 | Unauthenticated CRM access blocked | `GET /crm` (no cookie) | HTTP 401 | P0 | ☐ PASS ☐ FAIL | |

---

## Section 3 — AI Agents (JARVIS)

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 3.1 | Basic AI chat | `POST /jarvis {"input":"Hello"}` | `{"reply":"..."}` non-empty | P0 | ☐ PASS ☐ FAIL | |
| 3.2 | AI with context | `POST /jarvis {"input":"What is 2+2?"}` | Reply contains "4" | P0 | ☐ PASS ☐ FAIL | |
| 3.3 | Runtime dispatch | `POST /runtime/dispatch {"intent":"summarise","input":"test"}` | Task ID returned | P1 | ☐ PASS ☐ FAIL | |
| 3.4 | Runtime status | `GET /runtime/status` | Status object returned | P1 | ☐ PASS ☐ FAIL | |
| 3.5 | Runtime stream (SSE) | `GET /runtime/stream` | Event stream opens, stays connected | P1 | ☐ PASS ☐ FAIL | |
| 3.6 | Tasks list | `GET /tasks` | Array returned (empty OK) | P1 | ☐ PASS ☐ FAIL | |
| 3.7 | Rate limit on /jarvis | 61× requests in 60s | HTTP 429 on 61st | P0 | ☐ PASS ☐ FAIL | |

### 3.8 Engineering AI Routes (Phase 24)

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 3.8.1 | VS Code explain | `POST /p24/vscode/explain {"code":"fn add(a,b){return a+b}","lang":"js"}` | Explanation returned | P1 | ☐ PASS ☐ FAIL | |
| 3.8.2 | Repo index | `POST /p24/repo/index {"workspacePath":"."}` | `{"symbolCount":>0}` | P1 | ☐ PASS ☐ FAIL | |
| 3.8.3 | Repo search | `POST /p24/repo/search {"query":"requireAuth","repoPath":"."}` | Results returned | P1 | ☐ PASS ☐ FAIL | |
| 3.8.4 | Code search | `POST /p25/search {"query":"router.use"}` | Results with file+line | P1 | ☐ PASS ☐ FAIL | |

---

## Section 4 — Billing

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 4.1 | Billing status (new account) | `GET /billing/status` | `{"plan":"trial","status":"trialing","daysLeft":7}` | P0 | ☐ PASS ☐ FAIL | |
| 4.2 | Trial allows access | `GET /billing/status` | `{"allowed":true}` | P0 | ☐ PASS ☐ FAIL | |
| 4.3 | Upgrade initiates | `POST /billing/upgrade {"plan":"starter"}` | Returns `paymentUrl` | P0 | ☐ PASS ☐ FAIL | |
| 4.4 | Payment link created | Check paymentUrl is valid Razorpay URL | URL starts with `https://rzp.io` | P0 | ☐ PASS ☐ FAIL | |
| 4.5 | Invalid plan rejected | `POST /billing/upgrade {"plan":"enterprise"}` | HTTP 400 | P1 | ☐ PASS ☐ FAIL | |
| 4.6 | Webhook signature verify | `POST /webhook/razorpay` with wrong sig | HTTP 400 "Invalid signature" | P0 | ☐ PASS ☐ FAIL | |
| 4.7 | Webhook payment.captured | `POST /webhook/razorpay` with valid event payload | HTTP 200 `{"status":"ok"}` | P0 | ☐ PASS ☐ FAIL | |

**Webhook test payload (replace with real HMAC for sig test):**
```bash
curl -X POST $BASE/webhook/razorpay \
  -H "Content-Type: application/json" \
  -H "x-razorpay-signature: test_sig" \
  -d '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_test","contact":"+919999999999"}}}}'
# Expected in dev (no secret): HTTP 200
# Expected in production (with secret): HTTP 400 (wrong sig) → test with real HMAC
```

---

## Section 5 — OAuth

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 5.1 | OAuth status (no creds) | `GET /oauth/status` | Google/GitHub `configured:false` | P1 | ☐ PASS ☐ FAIL | |
| 5.2 | OAuth status (after creds set) | `GET /oauth/status` | Google/GitHub `configured:true` | P0 | ☐ PASS ☐ FAIL | |
| 5.3 | Get Google auth URL | `GET /oauth/google/url` | Returns `url` with `accounts.google.com` | P0 | ☐ PASS ☐ FAIL | |
| 5.4 | Get GitHub auth URL | `GET /oauth/github/url` | Returns `url` with `github.com/login/oauth` | P0 | ☐ PASS ☐ FAIL | |
| 5.5 | State nonce present in URL | Check URL from 5.3 | Contains `state=` param | P0 | ☐ PASS ☐ FAIL | |
| 5.6 | Callback with invalid state | `GET /oauth/google/callback?code=x&state=invalid` | HTTP 400 error | P0 | ☐ PASS ☐ FAIL | |
| 5.7 | List connections | `GET /oauth/connections` | Array (empty OK before any auth) | P1 | ☐ PASS ☐ FAIL | |
| 5.8 | Google callback full flow | Browser: visit auth URL → approve → land on `/?oauth=google&status=connected` | Redirect received | P0 | ☐ PASS ☐ FAIL | |
| 5.9 | GitHub callback full flow | Browser: visit auth URL → approve → redirect | Redirect received | P0 | ☐ PASS ☐ FAIL | |
| 5.10 | Revoke token | `DELETE /oauth/google/revoke` | `{"revoked":true}` | P1 | ☐ PASS ☐ FAIL | |

---

## Section 6 — Notifications

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 6.1 | Telegram status | `GET /telegram/status` | `{"configured":true/false}` | P1 | ☐ PASS ☐ FAIL | |
| 6.2 | Send Telegram message | `POST /telegram/send {"message":"UAT test ping"}` | Message received in Telegram | P1 | ☐ PASS ☐ FAIL | |
| 6.3 | WhatsApp status | Server startup log | `[Startup] Optional env — whatsapp` not logged as error | P1 | ☐ PASS ☐ FAIL | |
| 6.4 | Ops alerting fire | `POST /p22/alerts/fire {"service":"api","metric":"error_rate","value":5,"severity":"warning"}` | Alert created | P1 | ☐ PASS ☐ FAIL | |
| 6.5 | Alert list | `GET /p22/alerts` | Alert from 6.4 present | P1 | ☐ PASS ☐ FAIL | |
| 6.6 | Alert resolve | `POST /p22/alerts/<id>/resolve` | `{"resolved":true}` | P1 | ☐ PASS ☐ FAIL | |
| 6.7 | Observability metrics | `POST /p25/obs/metrics {"service":"api","name":"req","value":1,"type":"counter"}` | Metric stored | P2 | ☐ PASS ☐ FAIL | |
| 6.8 | System metrics | `GET /p25/obs/metrics/system` | `heapUsedMB`, `loadAvg1` present | P2 | ☐ PASS ☐ FAIL | |

---

## Section 7 — Mobile (Capacitor/React)

Test on physical Android device with USB debugging enabled.

| # | Test | Action | Expected | P | Result | Notes |
|---|------|--------|---------|---|--------|-------|
| 7.1 | App installs without crash | `npm run cap:run` or Android Studio | App opens on device | P0 | ☐ PASS ☐ FAIL | |
| 7.2 | Splash screen shows | Open app | Splash visible for ~2 seconds | P0 | ☐ PASS ☐ FAIL | |
| 7.3 | Login screen loads | After splash | Email + password fields visible | P0 | ☐ PASS ☐ FAIL | |
| 7.4 | Firebase email signup | Tap Signup → enter email/password | Account created, redirected to Home | P0 | ☐ PASS ☐ FAIL | |
| 7.5 | Firebase email login | Login with same credentials | Authenticated, Home screen loads | P0 | ☐ PASS ☐ FAIL | |
| 7.6 | Google Sign-In | Tap "Continue with Google" | Google account picker opens, auth completes | P0 | ☐ PASS ☐ FAIL | |
| 7.7 | AI Chat | Home tab → type "Hello" → send | AI response appears | P0 | ☐ PASS ☐ FAIL | |
| 7.8 | Bottom navigation | Tap each tab | Correct screen loads without crash | P0 | ☐ PASS ☐ FAIL | |
| 7.9 | Dashboard loads | Tap Dashboard tab | Stats/metrics visible | P1 | ☐ PASS ☐ FAIL | |
| 7.10 | Profile screen | Tap Profile tab | Email and logout button visible | P1 | ☐ PASS ☐ FAIL | |
| 7.11 | Logout | Tap logout | Returns to Login screen | P0 | ☐ PASS ☐ FAIL | |
| 7.12 | Offline state | Disable WiFi | "Offline" or error message shown (no crash) | P1 | ☐ PASS ☐ FAIL | |
| 7.13 | Back button handling | Android back button on home | Does not close app unexpectedly | P1 | ☐ PASS ☐ FAIL | |
| 7.14 | Payment link generation | Tools → Generate Payment Link → ₹999 | Link created, copyable | P1 | ☐ PASS ☐ FAIL | |
| 7.15 | Keyboard does not cover inputs | Tap email/password fields | Layout adjusts (adjustResize) | P1 | ☐ PASS ☐ FAIL | |
| 7.16 | App does not crash on background/foreground | Press home, return to app | App resumes correctly | P0 | ☐ PASS ☐ FAIL | |

### 7.17 Mobile API Client Validation

| # | Test | Action | Expected | P | Result | Notes |
|---|------|--------|---------|---|--------|-------|
| 7.17.1 | OS command blocked | Type "open figma" in chat | "This command is not available on mobile." | P0 | ☐ PASS ☐ FAIL | |
| 7.17.2 | Normal query passes | Type "generate a task list" | AI response received | P0 | ☐ PASS ☐ FAIL | |

---

## Section 8 — Security

| # | Test | Command | Expected | P | Result | Notes |
|---|------|---------|---------|---|--------|-------|
| 8.1 | Health endpoint public | `GET /health` (no auth) | HTTP 200 `{"status":"ok"}` | P0 | ☐ PASS ☐ FAIL | |
| 8.2 | Security headers present | `curl -I $BASE/health` | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` present | P0 | ☐ PASS ☐ FAIL | |
| 8.3 | HSTS in production | `curl -I https://app.ooplix.com/health` | `Strict-Transport-Security` header present | P0 | ☐ PASS ☐ FAIL | |
| 8.4 | X-Powered-By removed | `curl -I $BASE/health` | No `X-Powered-By: Express` header | P0 | ☐ PASS ☐ FAIL | |
| 8.5 | Readiness score | `POST /p21/readiness/check` | Score ≥ 80 | P0 | ☐ PASS ☐ FAIL | |
| 8.6 | Security hardening score | `POST /p22/security/check` | Score ≥ 90 | P0 | ☐ PASS ☐ FAIL | |
| 8.7 | SQL injection (n/a — no SQL) | N/A | N/A | N/A | — | Using JSON files |
| 8.8 | CORS blocked for unknown origin | `curl -H "Origin: https://evil.com" $BASE/health` | CORS error or no `Access-Control-Allow-Origin: https://evil.com` | P0 | ☐ PASS ☐ FAIL | |
| 8.9 | Oversized payload rejected | `curl -X POST $BASE/jarvis -d "$(python3 -c "print('x'*11000000)")"` | HTTP 413 | P1 | ☐ PASS ☐ FAIL | |

---

## Section 9 — Production Infrastructure

| # | Test | Action | Expected | P | Result | Notes |
|---|------|--------|---------|---|--------|-------|
| 9.1 | Server running under PM2 | `pm2 status` on VPS | `jarvis-os` listed as `online` | P0 | ☐ PASS ☐ FAIL | |
| 9.2 | PM2 auto-restart on crash | `kill <node pid>` | PM2 restarts within 5s | P0 | ☐ PASS ☐ FAIL | |
| 9.3 | Nginx serving HTTPS | Browser → `https://app.ooplix.com` | No cert warning, padlock shown | P0 | ☐ PASS ☐ FAIL | |
| 9.4 | HTTP redirects to HTTPS | Browser → `http://app.ooplix.com` | Redirects to HTTPS (301) | P0 | ☐ PASS ☐ FAIL | |
| 9.5 | Frontend served correctly | Browser → `https://app.ooplix.com` | App UI loads | P0 | ☐ PASS ☐ FAIL | |
| 9.6 | API reachable via domain | `curl https://app.ooplix.com/health` | HTTP 200 | P0 | ☐ PASS ☐ FAIL | |
| 9.7 | Logs persisted | `pm2 logs jarvis-os --lines 20` | Recent requests visible | P1 | ☐ PASS ☐ FAIL | |
| 9.8 | Deployment validator | `POST /p22/deploy/check` | Score > 50 | P1 | ☐ PASS ☐ FAIL | |

---

## UAT Sign-Off Criteria

**GO / NO-GO criteria for launch:**

| Gate | Requirement |
|------|------------|
| Auth | All Section 1 P0 tests PASS |
| Core AI | 3.1, 3.2, 3.7 PASS |
| Billing | 4.1–4.4, 4.6–4.7 PASS |
| Mobile | All Section 7 P0 tests PASS |
| Security | 8.1–8.6, 8.8 PASS |
| Infrastructure | All Section 9 P0 tests PASS |

**If any P0 test FAILS: do not launch until fixed.**

---

## UAT Sign-Off

```
Date:          _______________
Tester:        Ehtesham (owner)
Environment:   ☐ Local  ☐ Production

Section 1 Auth:          ☐ PASS  ☐ FAIL  (P0 failures: ___)
Section 2 CRM:           ☐ PASS  ☐ FAIL  (P0 failures: ___)
Section 3 Agents:        ☐ PASS  ☐ FAIL  (P0 failures: ___)
Section 4 Billing:       ☐ PASS  ☐ FAIL  (P0 failures: ___)
Section 5 OAuth:         ☐ PASS  ☐ FAIL  (P0 failures: ___)
Section 6 Notifications: ☐ PASS  ☐ FAIL  (P0 failures: ___)
Section 7 Mobile:        ☐ PASS  ☐ FAIL  (P0 failures: ___)
Section 8 Security:      ☐ PASS  ☐ FAIL  (P0 failures: ___)
Section 9 Infrastructure:☐ PASS  ☐ FAIL  (P0 failures: ___)

Overall decision:        ☐ GO FOR LAUNCH  ☐ NOT READY

Signature: _______________________  Date: _______________
```
