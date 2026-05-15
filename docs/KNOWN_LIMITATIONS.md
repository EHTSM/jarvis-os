# KNOWN_LIMITATIONS.md

**Date:** 2026-05-15

---

## Runtime Limitations

### Three parallel execution paths (no unified dispatcher)

Tasks go through one of three independent paths depending on their entry point. There is no single place where "all active tasks" is visible, and retry/circuit-breaker behavior differs per path.

- PATH A (`/jarvis`): no retry, no circuit breaker, no history
- PATH B (autonomous loop): linear retry, no circuit breaker
- PATH C (`/runtime/dispatch`): exponential retry, circuit breakers

**Impact:** inconsistent error handling. A task queued via chat may fail silently while a task dispatched via WorkflowPanel shows retry history.

### Sequential task execution in PATH B

The autonomous loop executes all due tasks one at a time. If 10 tasks are due simultaneously, they execute over 10–20 minutes before the next poll cycle.

**Impact:** high task volume causes queue latency. Not a problem at <50 tasks/day.

### executor.cjs monolith (2099 lines)

The background loop's executor handles all task types in a single file. A code error in one handler (e.g., CRM) could affect unrelated types (e.g., terminal commands).

**Impact:** reduced isolation. No per-handler testing.

---

## Data Limitations

### All data is in JSON files

No database. `data/leads.json`, `data/task-queue.json`, and `data/memory-store.json` are the primary stores. All reads scan the full file.

**Impact:** degradation at large lead volumes (>10,000 leads). Not a concern at MVP scale.

### No backup system

No automated backups. Manual backup: `tar -czf backups/data-$(date +%Y%m%d).tar.gz data/`

### `data/memory-store.json` grows unbounded

`contextEngine.cjs` writes every task execution to disk. The cap is 50 entries (DISK_MAX) but no TTL. File is currently 131KB and growing.

**Planned fix:** reduce DISK_MAX to 20 and add 7-day age pruning in ContextEngine constructor.

---

## Auth Limitations

### Single operator role only

The auth system supports one operator with a single global password. There is no per-user identity, no audit trail of which user performed which action.

**Impact:** suitable for single-operator MVP. Not suitable for multi-tenant or team use.

### No rate limiting on `/auth/login`

Login endpoint has no brute-force protection.

**Planned fix:** add 5-attempt/minute rate limit to `backend/routes/auth.js`.

---

## Frontend Limitations

### OperatorConsole is not functional on very small screens (<360px)

The operator grid layout requires ~600px minimum width for usability. The mobile breakpoints added in Phase 3 improve things for tablets and 768px phones, but sub-360px screens will be cramped.

### No offline support

The React app has no service worker. When the backend is offline, all API calls fail silently (with error toasts).

### No WebSocket — SSE only

The realtime event stream uses Server-Sent Events (one-direction, server→client). Client-to-server actions go through REST. This is by design.

---

## Integration Limitations

### Telegram and WhatsApp are optional at startup

If credentials are missing, those features are silently disabled. There is no in-app UI to indicate which integrations are active beyond the ConnectBar.

### Razorpay webhooks require a public HTTPS URL

Payment confirmation only works in production with a real domain and TLS certificate. Not testable locally without `ngrok` or similar.

### No AI provider fallback

All AI calls go to Groq. If Groq is unavailable, all AI responses fail. There is no fallback to OpenAI or other providers.
