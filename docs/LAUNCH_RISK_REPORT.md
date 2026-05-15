# LAUNCH_RISK_REPORT.md

**Date:** 2026-05-15

---

## Risk Matrix

| Risk | Likelihood | Impact | Severity | Mitigation |
|------|-----------|--------|----------|------------|
| Groq API outage | Medium | Critical | **HIGH** | No retry/fallback — all AI responses fail |
| `data/memory-store.json` unbounded growth | High | Medium | **HIGH** | Cap to 20 entries + 7-day TTL (see MEMORY_RISK_REPORT) |
| Single VPS — no failover | High | High | **HIGH** | Accepted for MVP; PM2 auto-restart covers process crashes |
| Task queue sequential execution under load | Medium | Medium | **MEDIUM** | 10+ due tasks = 10s–5min delay; acceptable for MVP scale |
| Stale running tasks on crash | Low | Medium | **MEDIUM** | `recoverStale()` fixes on next boot; 5m window |
| Disk fills from `workflow-checkpoints/` | Low | Medium | **MEDIUM** | Already mitigated: delete existing dirs; module unreachable |
| Memory leak in `_failureTracker` Map | Low | Low | **LOW** | Unbounded map but bounded by unique failing inputs in practice |
| `data/audit.log` no rotation | Medium | Low | **LOW** | 48KB now, grows ~1KB/day; not critical at MVP scale |
| Session cookie theft (httpOnly mitigates) | Low | High | **LOW** | httpOnly + SameSite=Strict + HTTPS cookie; adequate for single-operator |
| WhatsApp token expiry | Medium | Medium | **LOW** | Manual renewal; affects only WhatsApp features |

---

## Critical Risk 1: Groq API — Single Point of Failure

All three execution paths call Groq. There is no:
- Circuit breaker on Groq API calls
- Retry on transient network errors in PATH A
- Fallback to a secondary AI provider

**At launch:** acceptable. Groq uptime is >99.5% on free tier.

**First-week mitigation:** Add a 3-retry wrapper around `aiService.callAI()` with exponential backoff. Not required for launch.

---

## Critical Risk 2: No Horizontal Scaling

JARVIS runs as a single Node.js process. All state (in-memory ring buffers, task queue singleton, SSE connections) lives in one process.

**Constraints:**
- Max ~10 concurrent SSE connections (enforced by `runtimeStream.cjs`)
- Task execution is single-threaded (sequential within PATH B)
- PM2 is configured for `fork` mode — adding instances would break singletons

**At launch:** single operator + small lead volume = no problem. No change needed.

---

## Critical Risk 3: No Database — JSON File Store

All data is JSON files in `data/`. Risks:
- File corruption if disk fills (mitigation: atomic tmp+rename for queue)
- No indexing — all queries scan full file
- No backup unless configured manually

**At launch:** `data/leads.json` is likely the most valuable file. Schedule daily backup.

---

## Medium Risk: executor.cjs Monolith (2099 lines)

A bug in any handler (CRM, payments, WhatsApp, browser, terminal) affects all task types. Test coverage is zero for this file.

**At launch:** PATH B (autonomous loop) is not the primary interaction path. Most user value is through PATH A (chat). Risk is contained.

---

## Low Risk: Auth Bypass in Development

If `JWT_SECRET` is not set, `authMiddleware.js` allows all requests in non-production mode. This is by design.

**At launch:** ensure `JWT_SECRET` is set in production `.env`. This is in the launch checklist.

---

## Not Risks (Resolved)

- ~~TELEGRAM_TOKEN causing start failure~~ — fixed (now `warn`, not `die`)
- ~~Frontend build ESLint error~~ — fixed (generic disable comment)
- ~~`_active` counter accumulating in tests~~ — fixed in test harness
- ~~`workflow-checkpoints/` disk growth~~ — safe to delete; module unreachable
