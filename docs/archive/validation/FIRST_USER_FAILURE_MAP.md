# FIRST_USER_FAILURE_MAP.md

## High‑Priority Failure Scenarios Identified

| Failure | Symptoms (operator view) | Root Cause (code / UX) | Consequence |
|--------|--------------------------|------------------------|-------------|
| **Onboarding input ambiguity** | After entering a price like `999` the system shows an “Invalid price” error. | Backend expects a currency symbol (`₹`) but the UI placeholder does not enforce it. | Billing logic may receive malformed data, causing downstream payment failures.
| **Stale reconnect banner** | “Reconnecting…” stays visible for >1 min with no data updates. | SSE back‑off exhausted; no manual reconnect button. | Operator may think the system is dead and refresh the page, losing context.
| **Duplicate task dispatch** | Two identical success toasts after clicking “Run” once. | `busy` flag set only after async call begins; rapid double‑click can fire two requests. | Duplicate actions (e.g., two payment links sent).
| **Missing cancel confirmation** | Pressing “Cancel” clears the spinner but no toast appears. | Cancel request aborts the fetch but no UI feedback is emitted. | Operator assumes cancel failed and may re‑queue the task.
| **Overloaded Activity panel** | On small screens the Task Queue panel expands, pushing the bottom tab bar off‑screen. | Fixed CSS height for `.log-section-wrap` does not adapt to viewport size. | Mobile operators cannot navigate to other tabs without scrolling the entire page.
| **Confusing connectivity signals** | Red status dot stays visible while “Reconnecting…” banner appears. | Dot toggles only on `online` flag; banner is a separate element. | Mixed signals cause uncertainty about actual connection state.
| **Emergency stop without guidance** | After clicking “Emergency stop”, the red button remains and there is no clear instruction on how to resume. | “Resume” button only appears when backend reports `status === "critical"`. | Operators may remain in a halted state, causing service downtime.
| **No error‑to‑log linkage** | An error toast shows `Error: request failed` with no link to the detailed log entry. | Toast component does not expose the log ID. | Support cannot quickly locate the root cause, increasing MTTR.
| **Limited session history** | History buffer caps at 300 entries; older events disappear after ~4 h. | Fixed size array in `useRuntimeStream`. | Operators lose audit trail for long sessions.
| **Auth session loss** | Refreshing the page forces a full re‑login; long‑running tasks are aborted. | JWT stored in memory only; no refresh token. | Operators lose progress on long tasks.

These scenarios represent the most likely points where a real external operator would encounter confusion, errors, or loss of trust.
