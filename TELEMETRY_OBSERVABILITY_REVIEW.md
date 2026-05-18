# TELEMETRY_OBSERVABILITY_REVIEW.md

## Scope
Audit of the observability surface that will be available to beta operators. No code changes performed; this document records the current state.

## Findings
| Aspect | Implementation | Operator Visibility | Gaps |
|--------|----------------|--------------------|------|
| Runtime metrics | SSE `telemetry` events push metric objects to `useRuntimeStream`; displayed in `Dashboard` cards and `OperatorConsole` status dot. | Visible as aggregate numbers; individual metric timestamps are not shown. | No per‑metric timestamps; operators cannot correlate spikes with actions. |
| Queue observability | `opsData.queue` (counts, `oldestPendingMins`, `failedLast24h`) updated via SSE `execution` and `task:*` events. | Shown in `Activity` → “Task Queue” panel. | Only aggregate counts; no per‑task status timeline. |
| Incident traceability | Backend writes errors to SQLite log; frontend receives error messages as toasts (`role="alert"`). | Toasts appear briefly; full logs accessible in `Logs` tab (manual navigation). | No direct link from toast to log entry; no searchable filter in UI. |
| Execution replay | Each `execution` event includes `{id, status, input, ts}`; client buffers up to 300 entries in `history`. | Buffered history displayed in the Runtime tab list. | Buffer truncates older entries; no replay button. |
| Failure reconstruction | Errors returned from API (`{success:false,error:msg}`) displayed as error toasts. Backend also records in the SQLite task‑queue log. | Toast visible; log must be opened manually. | No UI correlation between toast and log entry. |
| Operator activity audit | Frontend does not record UI actions (clicks, navigation) in any persistent store. | None. | No audit trail of operator decisions; support cannot reconstruct steps. |
| Health check metrics | `checkHealth()` ping runs every 8 s; updates `online` flag and header dot. | Small green/red dot; “Reconnecting…” banner on failure. | No numeric latency or error‑code exposure; operators cannot distinguish slow vs down. |
| Metric granularity | `opsData` and `stats` provide high‑level totals only. | Not displayed in UI beyond summary cards. | No per‑service latency, memory, or CPU usage exposed. |

## High‑Level Recommendations (for future remediation, not applied now)
1. Show timestamps next to each metric in Dashboard cards.
2. Add a “View raw log” link on error toasts that jumps to the corresponding entry in the Logs tab.
3. Increase the history buffer to 600 entries to cover longer sessions.
4. Provide an “Export session” button that downloads buffered history as JSON.
5. Persist operator UI actions to a lightweight client‑side log (e.g., localStorage) for support use.
6. Surface health‑check latency and error codes in the header tooltip.
7. Expose per‑service resource usage (CPU, memory) in a new “Runtime metrics” panel.

*The above items are recorded for later post‑freeze work; no changes have been made during this audit.*