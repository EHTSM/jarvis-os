# Operator Experience Audit

**Date:** 2026-05-15  
**Scope:** All 8 operator frontend components + OperatorConsole orchestrator  
**Method:** Static code audit of `frontend/src/components/operator/` + runtime behavior review  
**Status:** Phase 3 of REAL-WORLD WORKFLOW VALIDATION

---

## Audit Summary

| Severity | Count |
|----------|-------|
| Critical (workflow-breaking) | 4 |
| High (misleading/confusing) | 6 |
| Medium (quality-of-life) | 7 |
| Low (cosmetic/polish) | 4 |

---

## Critical Issues (Workflow-Breaking)

### C1 — Fetch Errors Silently Swallowed

**File:** `OperatorConsole.jsx:74,82,88,102`  
**Impact:** Operator sees stale or blank data with no indication of failure.

All four fallback fetchers (`fetchOps`, `fetchTasks`, `fetchRt`, `fetchHistory`) catch errors and do nothing:

```javascript
} catch {} // ← silent swallow — no state update, no log, nothing
```

If the backend is down, the console shows last-known data indefinitely. There is no "fetch failed" indicator. An operator restarting the server after a crash has no way to know the console is stale.

**Fix:** Track fetch error state per data source; show "Failed to fetch" label with retry button.

---

### C2 — No Timeout on Fetch Calls

**File:** `OperatorConsole.jsx` + `api.js`  
**Impact:** If `getTasks()` or `getOpsData()` hangs (e.g. server under load), the loading spinner never resolves. Operator sees perpetual loading with no recourse.

There is no `AbortController` or timeout on any fetch call. The spinner (`op-loading`) for TaskQueuePanel is shown when `tasks === null` — if the initial fetch hangs indefinitely, it stays null forever.

**Fix:** Add 10s `AbortController` timeout to `_fetch` in `api.js`; surface timeout as a fetch error (feeds C1 fix).

---

### C3 — SSE Reconnect State Invisible to Operator

**File:** `OperatorConsole.jsx:167-185`  
**Impact:** When SSE drops, status shows "POLL" but operator has no information about reconnect attempt number, next retry timing, or whether automatic reconnect is working.

```javascript
const delay = SSE_BACKOFF[Math.min(sseRetryCount.current, SSE_BACKOFF.length - 1)];
sseRetryCount.current++;
sseRetryTimer.current = setTimeout(connectSSE, delay);
// ← retry count/delay never surfaced to UI state
```

SSE backoff caps at 30s. After 5 failures the operator could be waiting 30 seconds between reconnect attempts with no visual indication. Maximum observed wait: unbounded if the server never recovers.

**Fix:** Expose `sseRetryCount` and `nextRetryIn` (countdown timer) in stream state; display in status bar.

---

### C4 — Emergency State Detection Ambiguous

**File:** `GovernorPanel.jsx:12-13`  
**Impact:** The governor panel's "EMERGENCY" indicator may show incorrectly if `ops` is null, or may miss an active emergency if the backend responds with neither `status=critical` nor the `EMERGENCY_ACTIVE` warning code.

```javascript
const isEmergency = ops?.status === "critical" ||
  (ops?.warnings ?? []).some(w => w.code === "EMERGENCY_ACTIVE");
```

- If `ops` is null (initial load or fetch failure), `isEmergency` is `false` — the panel shows "NORMAL" even during an active emergency.
- If the governor backend uses a different warning code, the indicator is incorrect.
- The "Resume" button is disabled when `!isEmergency`, so an operator cannot resume a missed emergency.

**Fix:** Add a dedicated `/runtime/governor/status` poll; fall back to ops-based detection but show "Unknown" state when ops is null.

---

## High Severity Issues

### H1 — Result Messages Auto-Dismiss (6s) — Operator Misses Feedback

**File:** `WorkflowPanel.jsx:11-14`, `GovernorPanel.jsx:14-17`  
**Impact:** Dispatch results, queue confirmations, and E-Stop results disappear after 5-6 seconds. On a slow connection or during manual note-taking, the operator misses the outcome.

Errors also auto-dismiss — a failed dispatch silently vanishes, leaving no persistent record of what went wrong.

**Fix:** Keep error results persistent until manually dismissed (×); success results may still auto-dismiss.

---

### H2 — Result Output Truncated Without Indication

**File:** `WorkflowPanel.jsx:25`  
```javascript
showResult(true, typeof out === "string" ? out.slice(0, 200) : JSON.stringify(out).slice(0, 200));
```

Output is silently sliced at 200 characters. If the result is a git log or command output, the operator sees an incomplete response with no indication that content was cut. No "…(truncated)" suffix.

**Fix:** Add `(truncated)` suffix when `out.length > 200`.

---

### H3 — Circuit Breaker States Shown Without Context

**File:** `ExecLogPanel.jsx` (agent state rendering)  
**Impact:** The execution log panel shows circuit breaker state as raw strings ("closed", "open", "half-open"). Operators unfamiliar with the circuit breaker pattern do not know what these mean or whether action is required.

No tooltip, no legend, no color differentiation between "closed" (healthy) and "open" (blocking tasks).

**Fix:** Add color coding (green=closed, red=open, amber=half-open) and tooltip explaining each state.

---

### H4 — SSE Event Handlers Fail Silently

**File:** `OperatorConsole.jsx:121-164`  
All SSE event handlers (`execution`, `task:added`, `telemetry`, etc.) wrap JSON.parse in `try {} catch {}`. If the parse fails, the event is silently dropped. No counter, no log.

If the backend starts sending malformed events (schema change, regression), the history panel simply stops updating with no indication.

**Fix:** Track `parseErrors` counter in stream state; surface in status bar when > 0.

---

### H5 — TaskQueuePanel Shows No Next-Retry Time

**File:** `TaskQueuePanel.jsx:46-74`  
Retrying tasks show "retry N/M" but no time until next retry. For a task stuck in retry loops, the operator sees `retry 2/3` with no ETA for when attempt 3 fires.

The `scheduledFor` field exists on every task and contains exactly this timing. It is never displayed.

**Fix:** For pending/failed tasks with retries > 0, show `next: {fmtAge(task.scheduledFor)}`.

---

### H6 — No Timestamp Correlation Between Panels

**Impact:** When a task completes in TaskQueuePanel, there is no visible link to its entry in ExecLogPanel. The operator cannot trace "task X completed" → "execution entry Y" without manually correlating IDs.

TaskQueuePanel shows creation time; ExecLogPanel shows execution time. No shared task ID is surfaced in the ExecLogPanel row.

**Fix:** Show task ID (truncated to 8 chars) in ExecLogPanel rows that have a `taskId` field.

---

## Medium Severity Issues

### M1 — Loading State vs. Error State Indistinguishable

**File:** `TaskQueuePanel.jsx:41-43`  
```javascript
{!tasks && <div className="op-loading" />}
```

The spinner appears both during initial load (normal) and when fetch has failed (error). After C1 is fixed, this should show distinct states.

---

### M2 — lastError Truncated to 50 Chars With No Tooltip on Full Width

**File:** `TaskQueuePanel.jsx:63-68`  
`lastError` is truncated at 50 chars and `title={task.lastError}` is set correctly (tooltip on hover). However on mobile (no hover), the full error is inaccessible.

---

### M3 — GovernorPanel Reason Input Disappears During Emergency

**File:** `GovernorPanel.jsx:68-78`  
The stop reason input is hidden when `isEmergency` is true (correct — can't stop twice). But if the operator types a reason and the emergency resolves, the reason field reappears blank. Not a crash, but mildly confusing.

---

### M4 — Workflow Output Box Has No Scroll

**File:** `WorkflowPanel.jsx:127-130`  
The `op-result-box` has no max-height or scroll. Long outputs (git log, file listing) push the panel layout down, potentially pushing the E-Stop button off-screen.

---

### M5 — No Queue Empty State Explanation

**File:** `TaskQueuePanel.jsx:44-45`  
"No tasks" is shown when the queue is empty, but no indication of whether this is because the system is idle vs. the fetch failed and tasks field is an empty array vs. tasks is null (still loading).

---

### M6 — AdapterPanel Adapter Status Has No Offline Highlight

**File:** `AdapterPanel.jsx`  
Adapters show status text but do not visually highlight "offline" adapters in red. An offline Telegram or n8n adapter is the same visual weight as an online one.

---

### M7 — TelemetryPanel Memory Chart Has No Scale Label

**File:** `TelemetryPanel.jsx`  
Memory sparkline has no Y-axis labels. The operator sees a trend but cannot read the actual MB values without hovering.

---

## Low Severity Issues

### L1 — Uptime Resets on Console Remount
`fmtUptime` reads `ops.uptime.seconds` from server. If the console tab is remounted (route change), there's a brief flash of "—" before the first fetch resolves.

### L2 — Stream "SSE" vs "POLL" Label Has No Color Differentiation in Mobile View
On mobile the status bar truncates; "SSE" and "POLL" are the same font color.

### L3 — Heartbeat Age Does Not Reset to "0s" After New Beat
After a heartbeat arrives, `streamAge` shows "0s" only briefly before the next render cycle advances it. On slow machines this may flash "1s" or "2s" immediately.

### L4 — Panel Headers Have No Collapse Toggle
On small screens, fixed-height panels clip content. No collapse/expand control exists.

---

## Recommendations: Priority Order for MVP

| Priority | Fix | Effort |
|----------|-----|--------|
| 1 | C1 — Surface fetch errors (add error state to each fetch) | 30min |
| 2 | C2 — Add fetch timeout (AbortController 10s) | 20min |
| 3 | C3 — Show SSE retry counter + next-retry countdown | 20min |
| 4 | H1 — Keep error results persistent (only success auto-dismisses) | 10min |
| 5 | H2 — Add `(truncated)` suffix to clipped output | 5min |
| 6 | C4 — Harden emergency state detection | 20min |
| 7 | H5 — Show next-retry time in TaskQueuePanel | 10min |
| 8 | H3 — Color-code circuit breaker states | 15min |
| 9 | M4 — Add scroll to result output box | 5min |
| 10 | H6 — Show task ID in ExecLogPanel rows | 10min |

**Total estimated fix time for top 5 (all workflow-breaking): ~85 minutes**
