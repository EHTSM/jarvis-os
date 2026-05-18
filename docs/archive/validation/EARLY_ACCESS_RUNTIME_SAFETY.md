# EARLY_ACCESS_RUNTIME_SAFETY.md

## Safety Audit for Early Beta Access

### Session Isolation & Auth
- All operators share a single backend process; there is no per‑user sandbox.
- JWT token is stored only in memory; a page refresh clears the token and aborts any in‑progress tasks.
- No refresh‑token mechanism; token expiry forces a full re‑login, disrupting long‑running operations.

### Dangerous Actions
- **Emergency stop** button is always visible and triggers an immediate halt of all task execution without a confirmation dialog.
- **Cancel** action aborts the fetch request but does not emit a confirmation toast, leaving the operator unsure whether the cancellation succeeded.
- **Manual reconnect** is unavailable; after the SSE back‑off reaches the maximum (30 s) the UI remains in “Reconnecting…” state indefinitely.

### Runtime Desynchronization Risks
- `useRuntimeStream` closes any prior `EventSource` before opening a new one, but if the network drops repeatedly the client may repeatedly close and reopen, causing momentary gaps where UI state reflects stale data.
- History buffer caps at 300 entries; older events are dropped, which can lead to loss of audit trail during long sessions (>4 h).
- Duplicate task dispatch is possible if a user double‑clicks before the `busy` flag is set, resulting in two identical tasks reaching the backend.

### Mobile / Operator Friction
- Touch targets on onboarding and key buttons are below the 44 px minimum, increasing the chance of mis‑taps.
- No haptic feedback on critical actions, providing no tactile confirmation for mobile operators.
- Mobile tab bar hides non‑essential columns, but the bottom navigation can be pushed off‑screen by the expanding Activity panel.

### Observability Gaps (affecting safety)
- Errors are shown as toasts with no direct link to the detailed log entry.
- Health check latency is not exposed; the green/red dot gives only binary status.
- No explicit “Task cancelled” toast or log entry for abort actions.

**Conclusion**: The system is functionally stable, but several safety‑critical feedback loops and session‑isolation mechanisms are missing, which could lead to operator confusion, accidental duplicate actions, or loss of context during beta usage.
