> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# Real Feature Status
**Phase J — Month 1 Workflow Stabilization**
**Generated:** 2026-05-15

No hype. No "AI OS" framing. Only what is operationally true.

---

## Classification Key

| Class | Meaning |
|-------|---------|
| **REAL** | Works end-to-end in production. External call or side effect actually occurs. |
| **PARTIAL** | Core logic exists but has documented gaps that prevent reliable production use. |
| **PLACEHOLDER** | Code exists; returns a response; does not do what it claims. |
| **DISABLED** | Intentionally turned off (Phase I). Returns 410. |
| **BROKEN** | Should work but doesn't — missing config, wiring error, or silent failure. |
| **UNSAFE** | Works but should not be called by untrusted callers — no auth gate. |

---

## Feature Inventory

### Core Infrastructure

| Feature | Class | Evidence |
|---------|-------|---------|
| HTTP server (Express 5) | **REAL** | Starts, listens on PORT, handles requests |
| Request ID middleware | **REAL** | `x-request-id` on every response |
| Request logging (structured) | **REAL** | NDJSON to logger |
| Operator audit log | **REAL** | `data/logs/operator-audit.ndjson` per authenticated request |
| Rate limiting (per-IP sliding window) | **REAL** | `rateLimiter.js` applied on dispatch routes |
| Graceful shutdown (SIGTERM/SIGINT) | **REAL** | Closes HTTP, stops auto-loop, drains with 5s timeout |
| Queue integrity check on startup | **REAL** | Detects corrupt JSON, backs up and resets |

---

### Authentication

| Feature | Class | Evidence |
|---------|-------|---------|
| Operator login (`POST /auth/login`) | **BROKEN** | `OPERATOR_PASSWORD_HASH` missing → 503 in production |
| JWT signing (HS256) | **REAL** | Correct implementation; not usable until secret is set |
| JWT verification (timing-safe) | **REAL** | `crypto.timingSafeEqual` — not vulnerable to timing attacks |
| httpOnly cookie session | **REAL** | `secure: true` in production, `sameSite: strict` |
| Dev passthrough (non-production) | **REAL** | `requireAuth` bypasses auth when `NODE_ENV !== production` and no `JWT_SECRET` |
| Login rate limiting | **REAL** | 10 attempts / 5 min per IP |
| SSE JWT expiry warning | **REAL** | `jwt_expiry_warning` event 5 min before token expiry |
| Frontend expiry banner | **REAL** | Shown in `OperatorConsole.jsx` with dismiss / sign-out |

---

### Operator Console (Runtime Layer)

| Feature | Class | Evidence |
|---------|-------|---------|
| `POST /runtime/dispatch` | **REAL** (blocked) | Works correctly; returns 503 because `JWT_SECRET` missing |
| `POST /runtime/queue` | **REAL** (blocked) | In-memory queue; lost on restart |
| `GET /runtime/status` | **REAL** (blocked) | Live orchestrator diagnostics |
| `GET /runtime/history` | **REAL** (blocked) | Execution history from ring buffer |
| `POST /runtime/emergency/stop` | **PARTIAL** (blocked) | Stops orchestrator + autonomousLoop (Phase J fix); does NOT kill in-flight processes |
| `POST /runtime/emergency/resume` | **REAL** (blocked) | Clears emergency state |
| `GET /runtime/health/deep` | **REAL** (blocked) | Memory, agents, DLQ, log status |
| `GET /runtime/dead-letter` | **REAL** (blocked) | Lists failed tasks from DLQ |
| SSE event stream (`/runtime/stream`) | **REAL** (blocked) | Ring buffer + replay + JWT expiry warning |

All runtime routes are blocked because `JWT_SECRET` is not set. They work correctly once the secret is configured.

---

### Terminal Execution

| Feature | Class | Evidence |
|---------|-------|---------|
| Safe terminal execution (`safe-exec.js`) | **REAL** | `spawn(shell:false)`, allowlist, env sanitization, 128KB cap, 15s timeout |
| Shell injection prevention | **REAL** | No shell expansion — arguments passed as array |
| Dangerous command blocking | **REAL** | `rm`, `sudo`, `curl`, `bash`, etc. in BLOCKED_COMMANDS set |
| Path traversal blocking | **REAL** | `../../` pattern blocked in argument validator |
| Env sanitization | **REAL** | Strips TOKEN/SECRET/KEY/PASSWORD/HASH/JWT/AUTH/COOKIE before child spawn |
| Execution receipts | **REAL** | `terminalExecutionAdapter.cjs` emits structured receipts with stdout/stderr/exitCode/duration |
| CI enforcement (no raw exec) | **REAL** | `npm run security:no-raw-exec` — 0 violations confirmed |

---

### AI / LLM

| Feature | Class | Evidence |
|---------|-------|---------|
| GROQ inference (`/jarvis`) | **REAL** | `GROQ_API_KEY` present; Llama 3 family via GROQ API |
| Direct AI chat (`/ai/chat`) | **REAL** | Unauthenticated but functional |
| Planner (NL → task type) | **REAL** | Routes terminal, time, queue, web_search, app launch correctly |
| Time/date routing | **REAL** (fixed Phase J) | "What is the time" now returns current time, not web search |
| Context memory | **PARTIAL** | `memoryContext.cjs` exists; context injected into planner; no persistent long-term memory |
| Auth gate on `/jarvis` | **UNSAFE** | No `requireAuth` — any caller uses operator's GROQ quota |

---

### WhatsApp

| Feature | Class | Evidence |
|---------|-------|---------|
| Outbound text message | **REAL** (UNSAFE) | `WA_TOKEN` + `WA_PHONE_ID` present; `sendMessage()` calls Meta API |
| Retry on transient failure | **REAL** | 2 retries with 1.5s/3s back-off |
| Auth cooldown on 401/403 | **REAL** | 1-hour cooldown after bad token — prevents Meta API abuse |
| Inbound webhook (lead capture) | **REAL** | Parses incoming messages, routes to CRM + AI sales pipeline |
| Bulk send (up to 50 recipients) | **REAL** (UNSAFE) | Hard cap 50; 1.2s delay between sends |
| Auth gate | **UNSAFE** | `/whatsapp/send` and `/whatsapp/bulk` are unauthenticated |

---

### Telegram

| Feature | Class | Evidence |
|---------|-------|---------|
| Bot (polling) | **REAL** | `TELEGRAM_TOKEN` present; bot starts on server startup |
| Lead registration flow | **REAL** | `/start` → name → phone → WA send → payment link — full 5-step flow |
| Outbound send (`/telegram/send`) | **REAL** (UNSAFE) | Single message send via axios |
| Payment link in bot flow | **REAL** | Creates Razorpay link if configured; falls back to static URL |
| Auth gate | **UNSAFE** | `POST /telegram/send` is unauthenticated |
| Polling error handling | **REAL** | 401 → stop polling; 409 → stop polling; transient → throttled log |

---

### Payments (Razorpay)

| Feature | Class | Evidence |
|---------|-------|---------|
| Payment link creation | **REAL** (UNSAFE) | Keys present; creates real Razorpay payment links |
| Webhook HMAC verification | **REAL** | `RAZORPAY_WEBHOOK_SECRET` present; rejected if signature invalid |
| CRM update on payment | **REAL** | `webhookController` updates lead status on `payment.captured` |
| WA notification on payment | **REAL** | Sends WA message to lead after verified payment |
| Auth gate on link creation | **UNSAFE** | `/payment/link` unauthenticated |
| Retry on Razorpay API failure | ❌ **MISSING** | Single attempt; no retry |

---

### Queue System

| Feature | Class | Evidence |
|---------|-------|---------|
| Disk queue (task persistence) | **REAL** | Atomic JSON write via `tmp + rename`; survives restarts |
| Cron task scheduling | **REAL** | `node-cron` integration; cron jobs re-registered on startup |
| Crash recovery (`recoverStale`) | **REAL** | `running → pending` on startup |
| Stuck task abandonment | **REAL** | Pending > 2h → failed |
| Queue pruning | **REAL** | Keeps last 50 completed/failed + all active |
| In-memory priority queue | **REAL** | HIGH/NORMAL/LOW ordering correct; lost on restart |
| Task dedup | ❌ **MISSING** | No dedup in either queue |
| Disk queue DLQ UI | ❌ **MISSING** | No operator view of failed disk tasks |
| Emergency stop (autonomousLoop) | **REAL** (fixed Phase J) | `_tick()` now checks `governor.isEmergencyActive()` |

---

### Filesystem

| Feature | Class | Evidence |
|---------|-------|---------|
| Sandboxed read | **REAL** (fixed Phase J) | `filesystemExecutionAdapter` now configured at bootstrap |
| Path traversal prevention | **REAL** | `_sandboxResolve()` blocks paths outside project root |
| Write access | **DISABLED by design** | `writeAllowed: false` at bootstrap |
| UI for filesystem ops | ❌ **MISSING** | No operator UI — only reachable via runtime dispatch |

---

### Disabled / Permanently Off

| Feature | Class | Endpoint | Since |
|---------|-------|----------|-------|
| Dynamic agent creation (HTTP) | **DISABLED** | `POST /agents/dynamic/create` | Phase I |
| Dynamic agent creation (executor) | **DISABLED** | `create_agent` task type | Phase J |
| Autonomous continuous learning | **DISABLED** | `POST /agents/500/start-learning` | Phase I |

---

### Legacy / Not On Operator Routes

| Feature | Class | Notes |
|---------|-------|-------|
| `versionControlAgent.cjs` | **REAL** | Dev-tooling; uses `execSync`; not accessible from any HTTP route |
| `desktopAgent.cjs` | **REAL** | macOS desktop automation; no-ops on headless Linux |
| `voiceAgent.cjs` | **REAL** | macOS `say` command; disabled on Linux |
| `evolutionEngine.cjs` | Exists | Not on any active route; legacy |
| `learningSystem.cjs` | Exists | Not on any active route; disabled at HTTP level |

---

## Operational Maturity Score

| Category | Score | Reason |
|----------|-------|--------|
| Execution safety | 9/10 | safe-exec Phase I + env sanitization Phase J |
| Auth security | 2/10 | JWT_SECRET missing — console inaccessible |
| Route auth coverage | 4/10 | 6 production routes unauthenticated |
| Queue reliability | 6/10 | Disk queue solid; in-memory queue not persisted; no dedup |
| External integrations | 8/10 | WA, Telegram, Razorpay all configured and functional |
| Emergency controls | 6/10 | Governor works; no in-flight kill; not persistent |
| Startup diagnostics | 8/10 | Clear startup log; errors surfaced; auth state shown |
| Documentation | 8/10 | Phase I report + Phase J matrix generated |
| **Overall** | **6.4/10** | Auth block is the single largest gap |

**Single highest-impact action:** Set `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` in `.env` and restart. This alone moves the system from "console inaccessible" to "operator can log in and use all runtime features."

**Second highest-impact action:** Add `requireAuth` to `/jarvis`, `/ai/chat`, `/whatsapp/send`, `/whatsapp/bulk`, `/payment/link`, `/telegram/send`. Six unauthenticated production routes.
