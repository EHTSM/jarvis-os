# PRODUCT_TRUST_VALIDATION.md

## Evaluation Criteria
| Aspect | Current Observation | Trust Impact |
|--------|---------------------|--------------|
| **Operator trust** | Success toasts appear for every dispatched task; error toasts appear for failures. However, dangerous actions (Emergency stop, Cancel) lack confirmation feedback. | Operators can see most outcomes but feel uneasy about actions that have no explicit acknowledgment. |
| **Runtime predictability** | SSE reconnection follows a deterministic back‑off schedule; the UI shows a persistent “Reconnecting…” banner with `aria‑live="polite"`. The status dot updates only on the binary `online` flag. | Predictable reconnect timing, but mixed signals (dot + banner) can create momentary confusion about actual connectivity. |
| **Recovery confidence** | Emergency stop halts all execution instantly; resume appears only when backend reports `critical`. No guidance is shown after a stop. | Operators may be unsure how to bring the system back online, reducing confidence in recovery. |
| **Onboarding clarity** | Three free‑form fields (business, product, price) provide only placeholder examples. No format validation (e.g., currency symbol) and no inline help. | New users can submit malformed data, leading to downstream payment or reporting errors, eroding trust in the system’s correctness. |
| **Incident understandability** | Errors are shown as short toasts; detailed logs are only available in the Logs tab. No direct linkage from toast to log entry. | Operators must manually locate the cause, which can feel opaque during incidents. |
| **Reconnect trust** | Reconnect banner persists until a successful SSE event; no manual retry button. |
| **Long‑session calmness** | History buffer caps at 300 entries; older events are discarded after several hours. No on‑screen memory‑usage indicator. |
| **Operational transparency** | Health checks run every 8 s and only expose a green/red dot; no latency or error‑code details are shown. |
| **Production confidence level** | Core runtime (task dispatch, queue handling, SSE streaming) operates deterministically and passes all stress tests. UI feedback gaps and onboarding ambiguity remain the primary trust concerns. |

## Summary
Jarvis provides a solid deterministic backbone, but trust is weakened by missing confirmations on critical actions, ambiguous onboarding, limited incident traceability, and mixed connectivity signals. Addressing these UI‑level feedback gaps will raise the production confidence to a level suitable for a controlled beta rollout.
