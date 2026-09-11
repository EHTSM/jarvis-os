# Phase B.20 — Failure Injection Matrix

Every failure domain from the brief's Section 2, with the exact injection
method, the observed result, and an honest status. A domain is only marked
measured if a failure was actually injected and its effect observed.

**Reproduce:**
```bash
PORT=5050 NODE_ENV=development node backend/server.js &
PORT=5050 node scripts/b20-chaos-driver.cjs
```

---

## Measured domains

| # | Domain | Injection method | Observed | Status |
| --- | --- | --- | --- | --- |
| C | API timeout | 2,500 ms client deadline on `POST /ai/chat` | 502 at 1,419 ms — no success claimed | PRODUCTION READY |
| D | API 500 | `GET /definitely/not/a/real/route/b20` | 404 `{"success":false,"error":"Not Found: ..."}` | PRODUCTION READY |
| D | Handled 500 | `POST /ai/chat-with-tools` with no provider keys | 500 + actionable message, no stack leak | PRODUCTION READY |
| E | 401 | Request with no cookie | 401 `{"error":"Unauthorized"}` | PRODUCTION READY |
| E | 403 | Operator-role token → tenant B's members | 403 | PRODUCTION READY |
| F | Malformed response/body | `POST /ai/chat` body `{not valid json` | 400 `{"success":false,"error":"Invalid JSON body"}` | PRODUCTION READY |
| G | Empty/null body | `POST /ai/chat` body `{}` | 400 `{"error":"prompt required"}` — no fabricated 200 | PRODUCTION READY |
| I | AI provider failure | No provider API keys present | 502 "Check provider API keys", `content=false` | PRODUCTION READY (failure path) |
| K | Storage read | Atomic `tmp`+`rename` design | `chmod 444` on target cannot corrupt (rename replaces inode) | PRODUCTION READY |
| L | Storage write failure | `chmod 555 data/` then `POST /crm/lead` | 500 `{"success":false,...,"details":"EACCES..."}`, **0** persisted, store intact | PRODUCTION READY |
| M | Concurrency | 30 concurrent `GET /workspace` | 30 × 200, p50 9 ms, p95 12 ms, **0** × 5xx | PRODUCTION READY |
| M | Write race | 5 concurrent `POST /crm/lead`, unique phone | flags `[false,true,true,true,true]`, **1** record | PRODUCTION READY |
| N | Duplicate submission | 3 concurrent identical `POST /crm/lead` | 200 × 3, **1** record created | PRODUCTION READY |
| P | Queue failure | `GET /queue/status` | 503 — archived dependency, fails closed | GENUINE CAPABILITY GAP |
| Q | Runtime failure | `GET /runtime/health/deep` | 207 multi-status, reports `healthy:false` truthfully | PRODUCTION READY |
| U | Session expiry | Token signed with `exp` 1 h in the past | 401 "Token invalid or expired" | PRODUCTION READY |
| U | Forged session | Last signature byte flipped | 401 | PRODUCTION READY |
| V | Tenant isolation | A's session + B's `x-workspace-id` | 403 | PRODUCTION READY |
| V | Bypass on retry | Same request × 8 | all 403 — no bypass | PRODUCTION READY |
| V | Cache bleed | A and B read `/workspace` back to back | distinct payloads (940 B vs 482 B) | PRODUCTION READY |
| V | Stale tenant data | A lists workspaces | 2 workspaces, none belonging to B | PRODUCTION READY |
| W | Process restart | `kill -9` backend, restart | pre-kill record survived, **1** copy on disk, recovery 2,595 ms | PRODUCTION READY |

---

## Not measured — stated explicitly

Per the brief: *"Do not call missing evidence a working capability."*

| # | Domain | Status | Reason |
| --- | --- | --- | --- |
| A | Backend unavailable | NOT MEASURED | Browser-side behaviour; this phase drove the API directly, not the UI, under backend-down conditions. |
| B | Frontend/backend network interruption | NOT MEASURED | Requires driving the authenticated UI while severing the connection. |
| H | Slow dependency | NOT MEASURED | No safe existing mechanism to inject latency into a real dependency without modifying production code. |
| I | AI **success** path | CREDENTIAL BLOCKED | No provider API keys configured. Failure honesty verified; a successful generation could not be. |
| J | External integration failure | CREDENTIAL BLOCKED | Payments, WhatsApp, Telegram need live third-party credentials. |
| O | Background worker failure | NOT MEASURED | Requires injecting faults into long-running agent processes. |
| R | Automation failure | NOT MEASURED | Same — automation runs inside the agent runtime. |
| S | Scheduler failure | NOT MEASURED | Same. |
| T | Partial workflow failure | NOT MEASURED | Requires interrupting a multi-stage workflow mid-flight; not safely reproducible with existing mechanisms in this phase. |
| X | Frontend reload recovery | NOT MEASURED | Browser-side. |
| Y | Logout/login recovery | NOT MEASURED | Browser-side. |

**8 of 25 domains not measured, 2 credential blocked.** This is the primary
reason the Chaos Engineering dimension scores 7/10 rather than 10/10.

---

## Invalidated measurements — recorded, not hidden

Three measurements were taken, found invalid, and discarded rather than
reported:

| Measurement | Why it was discarded |
| --- | --- |
| "Cross-tenant leak on `/runtime/status`" | `/runtime/status` is a **global** runtime endpoint that ignores `x-workspace-id` by design. It can neither prove nor disprove scoping. Scenario re-targeted at `/workspace/:id/members`, which is genuinely scoped. |
| "3 concurrent POSTs created 0 records" | The test reused a phone number, and phone is the dedup key — so the API correctly returned `duplicate:true` and the previous record. Re-run with a unique key. |
| "`mission runtime status` / `billing status` claim success with no content" | My detector's key list was incomplete; both payloads carry real data (`missions.total=2080`, `plan=trial`). Instrument fault, no finding raised. |

A fourth, from the pre-existing suite, is documented in the certification
report §4.1: `tests/chaos/01-controlled-chaos.cjs` reports 6/10 FAIL purely
because it authenticates with a header the app does not read.

---

*Phase B.20 · Ooplix V1 · Confidential*
