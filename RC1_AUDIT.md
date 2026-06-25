# Ooplix / Jarvis-OS — Release Candidate 1 Audit Report (I1)

**Audit Date:** 2026-06-15  
**Scope:** Full codebase — backend, frontend, Electron, API surface, security, performance, accessibility, navigation  
**Total Issues:** 42 (7 CRITICAL · 18 MAJOR · 14 MINOR · 3 COSMETIC)

---

## Summary Table

| # | Severity | Surface | Issue |
|---|---|---|---|
| 1 | CRITICAL | Backend | `router.post("/runtime/reboot")` is dead code (nested inside GET handler body) |
| 2 | CRITICAL | Auth/Security | `/auth/firebase-session` does not verify Firebase ID token — auth bypass |
| 3 | CRITICAL | Electron/Frontend | `VisualGit.jsx` uses `{ cmd }` instead of `{ command }` — all shell ops fail |
| 4 | CRITICAL | Electron/Frontend | `AIPairProgramming.jsx` shell injection via AI patch + wrong param name |
| 5 | CRITICAL | Electron/Frontend | `VisualGit.jsx` `fsReadFile({ path })` should be `{ filePath }` — reads wrong file |
| 6 | CRITICAL | Frontend | `operatorApi.js:49` uses undefined `BASE`/`creds` — deleteGraph always throws ReferenceError |
| 7 | CRITICAL | Electron | Native menu sends `"contacts"`/`"dashboard"` tab IDs that don't exist — blank screen |
| 8 | MAJOR | Frontend | 3 runtime hooks missing `credentials: "include"` → all 401 |
| 9 | MAJOR | Frontend | 6 frontend endpoints use `/api/runtime/...` prefix that doesn't exist in backend → 404 |
| 10 | MAJOR | Backend | `runtime/reboot` also references undeclared `logger` (secondary to dead-code bug) |
| 11 | MAJOR | Backend | Phase routes bypass billing gate — expired-trial users retain full runtime access |
| 12 | MAJOR | Security | Dev auth passthrough active when `JWT_SECRET` unset in non-production envs |
| 13 | MAJOR | Security | `x-auth-token` header bypass partially undermines httpOnly cookie protection |
| 14 | MAJOR | CRM/WhatsApp | WhatsApp incoming webhook has no HMAC signature validation |
| 15 | MAJOR | Backend | CRM synchronous disk read/write on every call — event loop blocking risk |
| 16 | MAJOR | Frontend | Single `ErrorBoundary` for all 69 tabs — no per-tab isolation |
| 17 | MAJOR | Frontend | `Suspense fallback={null}` on landing/onboarding — white screen on slow loads |
| 18 | MAJOR | Frontend | `export-contacts` native menu action unhandled in App.jsx |
| 19 | MAJOR | API Surface | `plan-management.js` route file not mounted in routes/index.js |
| 20 | MAJOR | Electron | Evolution routes (`/evolution/score`, `/suggestions`, `/approve`) don't exist in backend |
| 21 | MAJOR | Electron | `pty-create` requires native `node-pty` — may not be packaged correctly |
| 22 | MAJOR | Perf | 4 pollers simultaneously active on home tab without background-tab guard |
| 23 | MAJOR | A11y | Tab buttons have no `aria-current` — screen readers cannot determine active tab |
| 24 | MAJOR | A11y | MoreMenu items have no `aria-current` for active state |
| 25 | MINOR | CRM/Billing | Razorpay webhook HMAC fallback re-serializes body — HMAC may mismatch |
| 26 | MINOR | CRM | `updateLead` has no file lock — race condition on concurrent webhooks |
| 27 | MINOR | Backend | `PAYMENT_FALLBACK_LINK` defaults to developer's personal Razorpay link |
| 28 | MINOR | Backend | WhatsApp webhook has no rate limiting |
| 29 | MINOR | API Surface | P26 graph `stats` route may be shadowed by `/:id` if registered after |
| 30 | MINOR | API Surface | P25 deploy `history` route may be shadowed by `/:id` if registered after |
| 31 | MINOR | Security | `signJWT` can throw uncaught in password-only login path |
| 32 | MINOR | Perf | All pollers continue firing in background browser tabs |
| 33 | MINOR | Perf | `JarvisBrainCenter` cosmetic ticker fires every 2800ms |
| 34 | MINOR | Perf | `ContactsV2` loads all leads with no pagination or virtualization |
| 35 | MINOR | A11y | MoreMenu does not return focus to trigger button on close |
| 36 | MINOR | A11y | MoreMenu Escape key calls `onSelect(currentTab)` instead of just closing |
| 37 | MINOR | A11y | "More ▾" and "AI" tab have no descriptive `aria-label` |
| 38 | MINOR | A11y | ErrorBoundary Copy button has no `aria-label` |
| 39 | MINOR | Navigation | RuntimeTab re-checks auth redundantly — possible login flash |
| 40 | COSMETIC | Navigation | `"oroplix"` tab ID appears to be typo for `"ooplix"` |
| 41 | COSMETIC | Navigation | `WorkflowOSV2` mapped to `"autonomouswf"` — inconsistent naming |
| 42 | COSMETIC | Backend | `app.disable("x-powered-by")` called twice in server.js |

---

## 1. Backend

### CRITICAL #1 — `/runtime/reboot` is dead code
**Location:** `backend/routes/ops.js`  
**Description:** `router.post("/runtime/reboot", ...)` is physically placed *inside* the body of the `router.get("/ops", ...)` callback. Calling `router.post()` at runtime inside a request handler does not register a route — it silently no-ops. The endpoint is never registered and always returns 404. Additionally, `logger` is referenced inside that handler but never imported in ops.js — if it were ever reachable it would throw `ReferenceError: logger is not defined`.  
**Impact:** Operator-initiated safe reboot is completely broken.

### CRITICAL #2 — Firebase session auth bypass
**Location:** `backend/routes/auth.js` lines 142–183  
**Description:** `POST /auth/firebase-session` accepts `{ idToken, email }` and checks only that both are non-empty strings. It never calls `firebaseAdmin.auth().verifyIdToken()`. Any caller can supply any email + any non-empty string and receive a valid backend session JWT.  
**Impact:** Complete authentication bypass for all Google/Phone OAuth login paths.

### MAJOR #10 — `logger` undeclared in ops.js reboot handler
**Location:** `backend/routes/ops.js` line 181  
**Description:** `logger.warn(...)` used but `logger` never imported.  
**Impact:** Secondary to #1 — if reboot were reachable, it would crash.

### MAJOR #11 — Phase routes bypass billing gate
**Location:** `backend/routes/billingService.js` line 229  
**Description:** `requireActiveAccount` returns `next()` for unauthenticated requests (`if (!req.user) return next()`). Any expired-trial user with a valid session can freely use all `/p18`–`/p27` and `/runtime/*` endpoints.  
**Impact:** Billing enforcement does not apply to autonomous intelligence, brain, memory, plugin, deployment routes.

### MAJOR #15 — CRM synchronous disk I/O on every request
**Location:** `backend/services/crmService.js`  
**Description:** Every CRM call reads the entire JSON file synchronously via `fs.readFileSync`. With multiple concurrent pollers (8s + 5s), this blocks the Node.js event loop on every call.  
**Impact:** Event loop stalls at scale; latency spikes for all concurrent requests.

### MINOR #27 — Hardcoded personal Razorpay payment link
**Location:** `backend/server.js` line 425  
**Description:** `PAYMENT_FALLBACK_LINK` defaults to `"https://rzp.io/l/jarvis-ai"` — the developer's personal payment page.  
**Impact:** Telegram-acquired leads directed to wrong payment page without this env var set.

### MINOR #28 — WhatsApp webhook has no rate limiting
**Location:** `backend/routes/whatsapp.js` line 16  
**Description:** No rate limiter on `POST /whatsapp/webhook`.  
**Impact:** Webhook can be flooded with no throttling defence.

### COSMETIC #42 — `app.disable("x-powered-by")` called twice
**Location:** `backend/server.js` lines 95, 97  
**Description:** Duplicate call; harmless but untidy.

---

## 2. Frontend / React

### CRITICAL #6 — `operatorApi.js:49` uses undefined `BASE`/`creds`
**Location:** `frontend/src/components/operator-os/operatorApi.js` line 49  
**Description:** `deleteGraph` calls `fetch(\`${BASE}/p26/graph/${id}\`, { method: "DELETE", ...creds })`. Neither `BASE` nor `creds` are defined or imported. Always throws `ReferenceError: BASE is not defined`.  
**Impact:** Plugin/graph deletion in operator console always throws; operation never reaches backend.

### MAJOR #8 — Runtime hooks missing `credentials: "include"`
**Location:**  
- `frontend/src/runtime/execution/useAdapterCoordination.js` lines 25, 38  
- `frontend/src/runtime/execution/useExecutionValidation.js` line 23  
- `frontend/src/runtime/execution/useRecoveryCoordinator.js` line 22  
**Description:** Raw `fetch()` calls without credentials. Session cookie never sent → all return 401 silently.  
**Impact:** Adapter health monitoring, post-execution verification, and recovery coordination permanently broken.

### MAJOR #9 — `/api/runtime/...` prefix doesn't exist in backend
**Location:** Same three files + `FeedbackPanel.jsx` + `useBetaTelemetry.js`  
**Description:** Frontend calls `/api/runtime/tools/state`, `/api/runtime/verify`, `/api/runtime/recover`, `/api/runtime/feedback`, `/api/runtime/diagnostics/bundle`. Backend registers all as `/runtime/...` (no `/api` prefix). All return 404.  
**Impact:** 6 frontend→backend integrations are permanently broken.

### MAJOR #16 — Single ErrorBoundary for all 69 tabs
**Location:** `frontend/src/App.jsx` lines 842–964  
**Description:** One `<ErrorBoundary>` wraps the entire tab panel. A crash in one tab's content renders crash UI across the full panel until retried.  
**Impact:** Tab crash blocks access to all other tabs until user retries.

### MAJOR #17 — `Suspense fallback={null}` on landing/onboarding
**Location:** `frontend/src/App.jsx` lines 569–571  
**Description:** `LandingPage`, `Onboarding`, `PricingPage` lazy-loaded with `fallback={null}` — blank white screen while chunks download on slow connections.  
**Impact:** New users on slow connections see white screen on the marketing landing.

### MAJOR #18 — `export-contacts` native menu action unhandled
**Location:** `electron/main.cjs` line 446; `frontend/src/App.jsx` line 455  
**Description:** Native menu sends `"menu-action", "export-contacts"`. App.jsx only handles `"new-contact"`. Silently ignored.  
**Impact:** Export Contacts menu item does nothing.

### MAJOR #22 — 4 pollers active on home tab without background guard
**Location:** `App.jsx` (8s), `CommandCenter.jsx` (5s×2 + 15s)  
**Description:** 4 concurrent intervals fire while home tab active; none check `document.hidden`.  
**Impact:** Unnecessary backend load; battery drain for backgrounded tabs.

### MINOR #32 — All pollers fire in background tabs
**Location:** All polling components  
**Description:** No `visibilitychange` listener pauses polling when browser tab is hidden.  
**Impact:** Wasteful network/battery usage.

### MINOR #33 — `JarvisBrainCenter` ticker re-renders every 2800ms
**Location:** `frontend/src/components/JarvisBrainCenter.jsx` line 43  
**Description:** `setInterval(() => setTick(x => x+1), 2800)` for animated time display.  
**Impact:** Unnecessary React re-renders.

### MINOR #34 — `ContactsV2` loads all leads with no virtualization
**Location:** `frontend/src/components/ContactsV2.jsx`  
**Description:** All leads fetched and rendered; no pagination or virtual list.  
**Impact:** Large DOM at scale; slow initial render with many leads.

---

## 3. Electron

### CRITICAL #3 — `VisualGit.jsx` uses `{ cmd }` not `{ command }` — all shell ops broken
**Location:** `frontend/src/components/VisualGit.jsx` lines 201, 211, 252, 272, 328  
**Description:** Every `api().shellExec()` call passes `{ cmd: '...' }`. Preload validates `_str(opts.command, 2048)` — `opts.command` is `undefined` → `TypeError: Expected string`. IPC call never reaches main process.  
**Impact:** All git stash, conflict-resolve, and staging operations in VisualGit silently fail.

### CRITICAL #4 — `AIPairProgramming.jsx` shell injection + wrong param
**Location:** `frontend/src/components/AIPairProgramming.jsx` line 276  
**Description:** Builds `` `echo '${result.patch}' | git apply` `` where `result.patch` is raw AI output. Single quotes in patch break the command; `'; cmd; echo '` achieves injection. Also uses `{ cmd }` (wrong key — same bug as #3).  
**Impact:** (1) AI patches with `'` chars fail silently. (2) If key bug fixed, shell injection via AI output.

### CRITICAL #5 — `VisualGit.jsx` `fsReadFile({ path })` should be `{ filePath }`
**Location:** `frontend/src/components/VisualGit.jsx` line 263  
**Description:** `api().fsReadFile({ path: \`${cwd}/${file}\` })` — preload handler destructures `{ filePath }`. `filePath` is `undefined`; `path.resolve(undefined)` returns process cwd. Always reads wrong file.  
**Impact:** File content viewer always shows wrong content.

### CRITICAL #7 — Native menu sends wrong tab IDs
**Location:** `electron/main.cjs` lines 459, 461  
**Description:** Menu sends `"contacts"` (correct is `"clients"`) and `"dashboard"` (correct is `"home"`). App.jsx has no matching tab handler for either — content area goes blank.  
**Impact:** `CmdOrCtrl+1` and `CmdOrCtrl+3` keyboard shortcuts show blank screen.

### MAJOR #20 — Evolution routes don't exist in backend
**Location:** `electron/main.cjs` lines 767–769  
**Description:** IPC handlers call `GET /evolution/score`, `GET /evolution/suggestions`, `POST /evolution/approve/:id`. None exist in any backend route file. Always return error.  
**Impact:** Evolution score and suggestion approval features never work.

### MAJOR #21 — `node-pty` may not be packaged for Electron ABI
**Location:** `electron/main.cjs` lines 963–1010  
**Description:** PTY handlers require `node-pty` (native addon). Requires `electron-rebuild` and `asar.unpack` config. If not done, integrated terminal fails silently.  
**Impact:** Terminal feature broken in packaged Electron app if build process lacks native rebuild.

---

## 4. API Surface

### MAJOR #19 — `plan-management.js` not mounted
**Location:** `backend/routes/plan-management.js`; `backend/routes/index.js`  
**Description:** Route file exists but never `require()`d in index.js. All its routes are unreachable (404).  
**Impact:** Any plan management features are completely inaccessible.

### MINOR #29 — P26 `GET /p26/graph/stats` may be shadowed by `/:id`
**Location:** `backend/routes/phase26.js`  
**Description:** If `GET /p26/graph/:id` registered before `GET /p26/graph/stats`, `/p26/graph/stats` matches `:id = "stats"`.  
**Impact:** Graph statistics endpoint returns wrong data or 404.

### MINOR #30 — P25 `GET /p25/deploy/history` may be shadowed by `/:id`
**Location:** `backend/routes/phase25.js`  
**Description:** Same route ordering issue as #29.  
**Impact:** Deploy history endpoint returns wrong data.

---

## 5. CRM / Billing / WhatsApp

### MAJOR #14 — WhatsApp webhook has no HMAC validation
**Location:** `backend/routes/whatsapp.js` line 16  
**Description:** `POST /whatsapp/webhook` processes payloads without verifying the `X-Hub-Signature-256` header. Anyone can POST crafted WhatsApp payloads.  
**Impact:** Arbitrary webhook injection triggering CRM writes and AI pipeline calls.

### MINOR #25 — Razorpay webhook HMAC fallback may mismatch
**Location:** `backend/controllers/webhookController.js` line 23  
**Description:** Falls back to `JSON.stringify(req.body)` for HMAC if `req.rawBody` is missing. Re-serialized JSON has different whitespace than original — HMAC mismatch → payment notification silently dropped.  
**Impact:** Payment notifications could be dropped; customers not activated.

### MINOR #26 — CRM concurrent write race condition
**Location:** `backend/services/crmService.js`  
**Description:** No file lock on `updateLead`. Concurrent webhooks can interleave file writes → data loss.  
**Impact:** Lead data corruption under high traffic.

---

## 6. Auth / Security

### MAJOR #12 — Dev passthrough active without `NODE_ENV=production`
**Location:** `backend/middleware/authMiddleware.js` lines 59–64  
**Description:** Sets `req.user = { role: "operator" }` for any request in non-production without `JWT_SECRET`. Any staging/demo env without explicit `NODE_ENV=production` is fully open.  
**Impact:** Staging environments are operator-open by default.

### MAJOR #13 — `x-auth-token` header bypass
**Location:** `backend/middleware/authMiddleware.js` line 69  
**Description:** `const token = cookies[COOKIE_NAME] || req.headers["x-auth-token"]`. A non-cookie auth path exists. JS can set this header — partially undermines httpOnly cookie design.  
**Impact:** Reduces the value of httpOnly cookie protection.

### MINOR #31 — `signJWT` uncaught throw in password-only login
**Location:** `backend/routes/auth.js` lines 84–88  
**Description:** Password-only login path does not wrap `signJWT` in try/catch. If `JWT_SECRET` is cleared mid-process, throws unhandled.  
**Impact:** Edge case; unhandled error crash in login flow.

---

## 7. Performance

*(See summary table — items 22, 32, 33, 34)*

---

## 8. Accessibility

*(See summary table — items 23, 24, 35, 36, 37, 38)*

### MAJOR #23 — Tab buttons missing `aria-current`
**Location:** `frontend/src/App.jsx` lines 717–724  
**Description:** Active tab indicated only via CSS class; no `aria-current="page"` or `aria-selected`.  
**Impact:** Screen readers cannot determine current navigation location.

### MAJOR #24 — MoreMenu items missing `aria-current`
**Location:** `frontend/src/App.jsx` lines 260–269  
**Description:** Overflow menu items have `role="menuitem"` but no `aria-current` for active state.  
**Impact:** Screen reader users cannot identify active overflow tab.

---

## 9. Navigation

### MINOR #39 — RuntimeTab double auth check
**Location:** `frontend/src/App.jsx` line 962  
**Description:** RuntimeTab re-runs `useAuth()` inside despite outer auth gate. May flash LoginPage.  
**Impact:** Cosmetic flash on runtime tab navigation.

### COSMETIC #40 — `"oroplix"` tab ID typo
**Location:** `frontend/src/App.jsx` line 179  
**Description:** `{ id: "oroplix" }` — likely typo for `"ooplix"`. Works but unsearchable as "ooplix".  
**Impact:** Discoverability issue in More menu search.

### COSMETIC #41 — WorkflowOSV2 mapped to `"autonomouswf"`
**Location:** `frontend/src/App.jsx` line 944  
**Description:** Naming inconsistency; "workflow" search in More menu shows "Auto Workflows" not "Workflows".  
**Impact:** Cosmetic confusion.

---

*End of I1 Audit. 42 issues: 7 CRITICAL · 18 MAJOR · 14 MINOR · 3 COSMETIC.*  
*No fixes applied in this document. Proceed to I2 Bug Fix Sprint.*
