# CONTROLLED_PUBLIC_MVP_READINESS.md

## Public‑MVP Readiness Audit (Phase A)

| Area | Observation | Operator Impact |
|------|-------------|-----------------|
| **Onboarding clarity** | Three free‑form text steps (business, product, price) with only placeholder hints. No validation of currency format or required terminology. | Operators may enter ambiguous data (e.g., missing currency symbol) leading to downstream billing or reporting errors.
| **Runtime recoverability** | SSE connection is automatically re‑opened with exponential back‑off. UI shows a persistent “Reconnecting…” banner (`aria‑live="polite"`). No manual reconnect control. | During prolonged outages the operator sees no way to force a fresh connection and may refresh the page, losing context.
| **First‑session usability** | After login the health‑poll runs every 8 s; the status dot can remain gray for several seconds. The chat input is disabled while `loading` is true, which occurs during the first `sendMessage` call. | New users might think the system is broken if the green dot does not appear quickly or the send button is disabled.
| **Operator trust signals** | Success toasts on task queueing, error toasts on failures, always‑visible emergency stop button. Cancel button exists but does not emit a confirmation toast. | Lack of explicit “Task cancelled” feedback can cause confusion and duplicate actions.
| **Mobile survivability** | Mobile‑only tab bar hides non‑essential columns. Onboarding “Continue” button is 36 px × 36 px (below the 44 px WCAG minimum). No haptic feedback on critical actions. | Small touch targets may be missed on phones; operators receive no tactile cue that an action succeeded.
| **Reconnect resilience** | Back‑off array `[1 s,2 s,4 s,8 s,30 s]`. After the final delay the UI stays in “offline” state with no fallback polling for telemetry. | Operators see a dead UI for up to 30 s with no data, potentially leading to premature panic.
| **Queue reliability (normal usage)** | Queue health displayed as aggregates. Duplicate execution events are filtered client‑side (`queueExecEntry`). No UI for retrying failed tasks. | Operators must manually re‑queue a failed item without guidance, increasing error‑recovery time.
| **Multi‑hour session stability** | History buffer caps at 300 entries; older events are dropped. No on‑screen memory‑usage indicator. | In sessions longer than ~4 h the operator loses scroll‑back capability, hindering audit and troubleshooting.

**Overall readiness** – The core flows (login → console → task dispatch) are functionally stable, but the above usability and safety gaps should be documented for beta support. No code changes are introduced in this audit.
