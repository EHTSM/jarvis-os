> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# Real Workflow Matrix
**Phase J — Month 1 Workflow Stabilization**
**Generated:** 2026-05-15

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Works correctly in production |
| ⚠️ | Partially works — has documented gaps |
| ❌ | Does not work / broken |
| 🔒 | Blocked by missing config |
| 🎭 | Demo/placeholder only |
| 🧪 | Untested in live production |

---

## Workflow Matrix

### 1. Terminal Execution

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `agents/terminalAgent.cjs` → `backend/core/safe-exec.js` |
| Actually works | ✅ | Verified: `git status`, `ls`, `node -v` execute correctly |
| Dangerous commands blocked | ✅ | `rm -rf`, `sudo`, `curl`, `bash`, path traversal — all blocked |
| Production safe | ✅ | `spawn(shell:false)`, allowlist, env sanitization, 128KB output cap |
| External credentials | none | |
| UI exists | ✅ | Operator console sends to `/runtime/dispatch` |
| Retries | ✅ | `safe-exec` has 15s timeout + SIGKILL; autonomousLoop retries 3x |
| Error handling | ✅ | Blocked/timeout/failure each return structured error |
| Missing | env sanitization was leaking until Phase J fix (now fixed) |

**Gap closed this session:** `terminalExecutionAdapter.cjs` was passing full `process.env` (including `JWT_SECRET`, `GROQ_API_KEY`) to child processes. Fixed — now uses `_sanitizeEnv()`.

---

### 2. Filesystem Operations

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `agents/runtime/adapters/filesystemExecutionAdapter.cjs` |
| Actually works | ❌ → ✅ | Was NEVER configured — all ops returned `sandbox_not_configured` |
| Production safe | ✅ | Sandbox path validation, traversal blocked, read-only by default |
| External credentials | none | |
| UI exists | ❌ | No operator UI for filesystem operations |
| Retries | ❌ | No retry layer — single attempt only |
| Error handling | ✅ | All failures return structured receipts |
| Missing | Write access disabled by design — read-only sandbox only |

**Gap closed this session:** `bootstrapRuntime.cjs` now calls `fsAdapter.configure(projectRoot, { writeAllowed: false })` at startup. Previously `filesystemExecutionAdapter` was an orphaned module with no configure call anywhere.

---

### 3. Git Operations

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `agents/runtime/adapters/gitExecutionAdapter.cjs` |
| Actually works | ✅ | Uses `spawn(shell:false)` — safe |
| Production safe | ✅ | Already in CI exempt list with documented safe-spawn reasoning |
| External credentials | none (local git only) | |
| UI exists | ⚠️ | Terminal input only — no dedicated git UI |
| Retries | ⚠️ | No retry layer — single attempt |
| Error handling | ✅ | Structured receipts |

---

### 4. Queue — Disk (autonomousLoop path)

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `agents/taskQueue.cjs` + `agents/autonomousLoop.cjs` |
| Actually works | ✅ | Tasks persist across restarts |
| Crash recovery | ✅ | `recoverStale()`: running → pending on restart |
| Stuck task cleanup | ✅ | `abandonStuckTasks(2h)`: pending > 2h → failed |
| Pruning | ✅ | `pruneOldTasks(50)`: keeps last 50 completed/failed |
| Duplicate dispatch | ❌ | **No dedup** — same input queued twice creates two tasks |
| Dead-letter | ⚠️ | Tasks go to `failed` state; no DLQ UI for disk queue |
| Emergency stop | ❌ → ✅ | Was NOT checking governor. Fixed — tick now suppressed when emergency active |
| Concurrent async update race | ⚠️ | `update()` does load→modify→save; concurrent calls can interleave. Tested stable in practice under Node.js event loop but not guaranteed under heavy IO pressure. |
| External credentials | none | |
| UI exists | ⚠️ | No operator UI to view/cancel disk queue tasks |

---

### 5. Queue — In-Memory (runtimeOrchestrator path)

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `agents/runtime/priorityQueue.cjs` |
| Actually works | ✅ | Priority ordering correct (HIGH → NORMAL → LOW verified) |
| Restart survival | ❌ | **All queued tasks are lost on restart** — no persistence |
| Dedup | ❌ | No dedup protection |
| Coordination with disk queue | ❌ | Two completely separate queue systems — no visibility between them |
| Dead-letter | ✅ | `agents/runtime/deadLetterQueue.cjs` exists and is exposed via API |
| Emergency stop | ✅ | Governor blocks `runtimeOrchestrator.dispatch()` |
| UI exists | ✅ | Operator console uses this path |

**Architectural gap:** An operator queuing via the UI (`POST /runtime/queue`) uses the in-memory priorityQueue. A task queued via natural language ("schedule X") goes to the disk taskQueue via autonomousLoop. These are two separate systems with no visibility into each other. The frontend shows one queue; the autonomousLoop runs the other.

---

### 6. Telegram Send

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `POST /telegram/send` → `backend/services/telegramService.js` |
| Actually works | ✅ | `TELEGRAM_TOKEN` is set; `isConfigured()` returns true |
| Production safe | ✅ | axios post with 10s timeout; returns `{ sent, reason }` |
| External credentials | `TELEGRAM_TOKEN` — **PRESENT** in .env | |
| UI exists | ❌ | No operator UI for outbound Telegram sends |
| Retries | ❌ | Single attempt — no retry on network failure |
| Error handling | ✅ | Returns `{ sent: false, reason }` on failure |
| Auth gate | ❌ | `POST /telegram/send` is NOT behind `requireAuth` — unauthenticated access possible |
| Missing | Retry logic; auth gate on send endpoint |

**Security gap:** `/telegram/send` is mounted in `routes/index.js` without `requireAuth`. Any caller with network access to the server can send Telegram messages without authentication.

---

### 7. WhatsApp Send

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `POST /whatsapp/send` → `backend/services/whatsappService.js` |
| Actually works | ✅ | `WA_TOKEN` and `WA_PHONE_ID` are set |
| Production safe | ✅ | axios + 12s timeout; auth cooldown on 401/403 |
| External credentials | `WA_TOKEN`, `WA_PHONE_ID` — **PRESENT** | |
| UI exists | ❌ | No operator UI for outbound WA sends |
| Retries | ✅ | Retries 2x with linear back-off (1.5s, 3s) |
| Error handling | ✅ | Auth cooldown on bad token; structured errors |
| Auth gate | ❌ | `/whatsapp/send` and `/whatsapp/bulk` are NOT behind `requireAuth` |
| Bulk rate limit | ✅ | Hard cap 50 recipients; 1.2s delay between sends |
| Missing | Auth gate on send endpoints; `/whatsapp/bulk` requires careful rate management |

**Security gap:** `/whatsapp/send` and `/whatsapp/bulk` are unauthenticated — any caller can trigger bulk sends.

---

### 8. Payments (Razorpay)

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `POST /payment/link` → `backend/services/paymentService.js` |
| Actually works | ✅ | `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set |
| Production safe | ✅ | HMAC webhook signature verification; `BASE_URL` is set |
| External credentials | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` — **PRESENT** | |
| UI exists | ❌ | No operator UI for payment link creation |
| Retries | ❌ | Single Razorpay API call — no retry |
| Error handling | ✅ | Returns `{ success: false, error }` on failure |
| Auth gate | ❌ | `POST /payment/link` is NOT behind `requireAuth` |
| Webhook verification | ✅ | HMAC verified in production; rejects if secret missing |
| Missing | Auth gate on payment link endpoint; retry on transient Razorpay API failures |

**Security gap:** `/payment/link` is unauthenticated — any caller can trigger payment link creation.

---

### 9. AI Routes (`/jarvis`, `/ai/chat`)

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `POST /jarvis` → planner → executor; `POST /ai/chat` → direct LLM |
| Actually works | ✅ | `GROQ_API_KEY` is set |
| Production safe | ✅ | Rate-limited; input truncated at 2000 chars |
| External credentials | `GROQ_API_KEY` — **PRESENT** | |
| UI exists | ✅ | Operator console chat input |
| Retries | ⚠️ | Depends on GROQ SDK internal retry; no explicit outer retry |
| Error handling | ✅ | Errors return structured response to frontend |
| Auth gate | ❌ | `/jarvis` and `/ai/chat` are NOT behind `requireAuth` — unauthenticated |
| Planner routing | ✅ | Terminal, time/date, queue, agent factory all route correctly |
| Missing | Auth gate; explicit retry on GROQ rate limit |

**Security gap:** `/jarvis` and `/ai/chat` are unauthenticated — any caller can use the AI pipeline at the operator's API cost.

---

### 10. SSE Reconnect

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `GET /runtime/stream` → `runtimeStream.cjs` |
| Actually works | ✅ | Replays last 50 events on reconnect; ring buffer of 500 |
| JWT expiry warning | ✅ | `jwt_expiry_warning` event 5min before expiry |
| Frontend banner | ✅ | Warning banner with dismiss/sign-out options |
| Connection cap | ✅ | Max 10 concurrent SSE connections |
| Keep-alive | ✅ | `: ping` every 20s |
| Multiple tabs | ⚠️ | Each tab opens a separate SSE connection — 10 tabs = cap hit |
| Browser sleep/wake | ⚠️ | EventSource reconnects automatically but missed events replayed from ring only if within 500-event buffer |
| Auth gate | ✅ | `GET /runtime/stream` is behind `requireAuth` via `/runtime` prefix gate |
| Missing | 🔒 Blocked — `JWT_SECRET` missing in production means the auth cookie can never be issued |

---

### 11. Auth Flows

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Actually works | ❌ | **BROKEN IN PRODUCTION** — `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` both missing from `.env` |
| Login returns | `503 Auth not configured` | Not `401` — auth is misconfigured, not wrong password |
| Dev passthrough | ✅ | Works when `NODE_ENV !== production` and no `JWT_SECRET` |
| Password hashing | ✅ | scrypt with 64-byte output + timing-safe compare |
| Cookie security | ✅ | httpOnly, secure (production), sameSite=strict |
| Rate limiting | ✅ | 10 attempts / 5 minutes per IP |
| Token expiry | ✅ | 8h; SSE warns at 5min remaining |
| Missing | `JWT_SECRET` and `OPERATOR_PASSWORD_HASH` must be set before ANY production use |

---

### 12. Emergency Stop / Resume

| Attribute | Status | Notes |
|-----------|--------|-------|
| Exists | ✅ | `POST /runtime/emergency/stop` + `/runtime/emergency/resume` |
| Blocks runtimeOrchestrator | ✅ | `governor.isEmergencyActive()` checked in dispatch |
| Blocks autonomousLoop | ❌ → ✅ | Was NOT checked. Fixed — `_tick()` now returns early if emergency active |
| Kills in-flight executions | ❌ | `emergencyKillAll()` records the kill intent but does NOT call `cancel()` on active `terminalExecutionAdapter` executions |
| Persists across restart | ❌ | Emergency state is in-memory only — a restart clears it |
| Auth gate | ✅ | Behind `requireAuth` via `/runtime` prefix gate |
| But auth gate broken | 🔒 | `JWT_SECRET` missing — routes return 503 |
| Missing | In-flight cancellation; persistence of emergency state |

---

### 13. Runtime Recovery (Restart)

| Attribute | Status | Notes |
|-----------|--------|-------|
| Disk queue recovery | ✅ | `recoverStale()`: running → pending on startup |
| In-memory queue recovery | ❌ | Lost on restart — all priorityQueue items gone |
| Cron task recovery | ✅ | `autonomousLoop.start()` re-registers cron jobs from disk queue |
| Execution receipts | ⚠️ | In-memory only — lost on restart |
| SSE state recovery | ✅ | Clients reconnect and replay last 50 events from ring buffer |
| Ring buffer recovery | ❌ | Ring buffer is in-memory — lost on restart, clients replay nothing |
| Emergency state recovery | ❌ | In-memory only — emergency cleared on restart |

---

## Summary Table

| Workflow | Works? | Production Safe? | Auth Gated? | Missing |
|----------|--------|-----------------|-------------|---------|
| Terminal execution | ✅ | ✅ | ✅ (via /runtime) | — |
| Filesystem (read) | ✅ (fixed) | ✅ | ✅ (via /runtime) | No write access, no UI |
| Git operations | ✅ | ✅ | ✅ (via /runtime) | No dedicated UI |
| Queue (disk) | ✅ | ✅ | ✅ (via /runtime) | No dedup, no operator UI |
| Queue (in-memory) | ✅ | ⚠️ (lost on restart) | ✅ | Not persisted, no dedup |
| Telegram send | ✅ | ✅ | ❌ **OPEN** | Auth gate, retry |
| WhatsApp send | ✅ | ✅ | ❌ **OPEN** | Auth gate |
| WhatsApp bulk | ✅ | ⚠️ | ❌ **OPEN** | Auth gate, rate limit UI |
| Payments | ✅ | ✅ | ❌ **OPEN** | Auth gate, retry |
| AI routes | ✅ | ⚠️ | ❌ **OPEN** | Auth gate, cost exposure |
| SSE reconnect | ✅ | ✅ | ✅ | Multiple-tab cap |
| Auth (login) | ❌ **BROKEN** | ✅ | N/A | `JWT_SECRET` missing in .env |
| Emergency stop | ⚠️ (partial) | ✅ | 🔒 (auth broken) | No in-flight kill, not persistent |
| Runtime recovery | ⚠️ (partial) | ✅ | N/A | In-memory state lost on restart |

---

## Top 5 Remaining P1 Gaps

1. **`JWT_SECRET` + `OPERATOR_PASSWORD_HASH` missing** — operator console is completely inaccessible in production. Every auth-gated route returns 503.
2. **`/telegram/send`, `/whatsapp/send`, `/whatsapp/bulk`, `/payment/link`, `/jarvis`, `/ai/chat` unauthenticated** — six production routes are open to the internet without any auth gate.
3. **In-memory priorityQueue not persisted** — queued tasks via operator UI are silently lost on any restart.
4. **Emergency kill does not cancel in-flight terminal executions** — `emergencyKillAll()` logs the intent but `terminalExecutionAdapter.cancel()` is never invoked.
5. **No task dedup in either queue** — same command queued twice executes twice with no guard.
