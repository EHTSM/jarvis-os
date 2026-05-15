# UX Improvement List
**Phase F — Daily Operator Mode**
**Generated:** 2026-05-15

---

## Improvements Shipped in Phase F

### Session Persistence

| Item | File | Detail |
|---|---|---|
| Console message history persisted | `AIConsolePanel.jsx` | `localStorage` key `jarvis_console_msgs`, max 50 messages, survives page refresh |
| Workflow dispatch history persisted | `WorkflowPanel.jsx` | `localStorage` key `jarvis_workflow_hist`, max 20 entries, survives page refresh |
| Workflow history UI | `WorkflowPanel.jsx` | Collapsible history dropdown above command input; click entry to re-fill; shows pass/fail indicator and time-ago |
| Clear console history | `AIConsolePanel.jsx` | Clear button wipes both in-memory and localStorage |

### Auth Error Handling

| Item | File | Detail |
|---|---|---|
| Session expired banner | `OperatorConsole.jsx` + `operator.css` | Red banner with "Sign out" button when 401 is detected on any runtime call |
| Auth unconfigured banner | `OperatorConsole.jsx` + `operator.css` | Amber banner when 503 "not configured" is detected; shows env var instructions |
| Error status propagation | `api.js` | `err.status` now set on all `_fetch` errors so components can distinguish 401 vs 503 vs 5xx |
| Dev login fix | `backend/routes/auth.js` | `signJWT()` wrapped in try/catch; dev mode login no longer crashes when `JWT_SECRET` is absent |

### Execution Visibility

| Item | File | Detail |
|---|---|---|
| Last execution indicator | `OperatorConsole.jsx` | Status bar shows last task completion/failure: input snippet + status + elapsed time |
| SSE execution events surfaced | `OperatorConsole.jsx` | `execution` events from stream update `lastExec` state in real time |

### Mobile Layout

| Item | File | Detail |
|---|---|---|
| Mobile tab bar | `OperatorConsole.jsx` + `operator.css` | Fixed bottom tab bar on ≤768px: Workflow / Log / Queue / Adapters |
| Single-panel mobile view | `operator.css` | Active tab panel fills viewport; others hidden via `.op-mobile-hide` |
| Mobile tab highlight | `operator.css` | `.op-tab.active` uses accent colour with visible underline |
| `.op-mobile-only` utility | `operator.css` | `display:none` on desktop, `display:flex` on mobile |

### Readability

| Item | File | Detail |
|---|---|---|
| Governor warning font size | `GovernorPanel.jsx` | 9px → 10px; bold warning code; `—` separator before detail text |
| Auth banner styles | `operator.css` | `.op-session-banner` and `.op-session-banner.expired` with distinct colours |
| SSE `withCredentials: true` | `OperatorConsole.jsx` | Fixes SSE on auth-gated stream; without this, cookies were never sent |
| CORS origin reflection | `agents/runtime/runtimeStream.cjs` | Server reflects `req.headers.origin` instead of `*`; required for `withCredentials` to work |

---

## Remaining UX Items (Not Shipped — Backlog)

### High Priority

| Item | Effort | Why Deferred |
|---|---|---|
| Queue state restored on refresh | Medium | Backend is source of truth but frontend has no `/runtime/queue/list` polling; panel shows empty on refresh until next event |
| Reconnect status indicator | Small | No visual feedback when SSE is reconnecting; operator doesn't know if stream is live |
| Toasts for async queue completions | Medium | When a queued task finishes, there's no notification unless the operator is watching the execution log |
| Task detail modal | Medium | Clicking a completed task in history shows no detail (no detail endpoint consumed) |

### Medium Priority

| Item | Effort | Why Deferred |
|---|---|---|
| Adapter health colour coding | Small | Adapter list shows status text but no colour-coded health indicator |
| Execution log filter by status | Small | Operator can't filter execution log to show only failures |
| Panel resize / collapse | Medium | Fixed panel grid; no way to expand one panel to focus |
| Keyboard shortcut map | Small | Ctrl+Enter dispatches but no shortcut reference visible in UI |

### Low Priority

| Item | Effort | Why Deferred |
|---|---|---|
| Dark/light theme toggle | Small | UI is dark-only; some operators prefer light |
| Compact vs verbose console mode | Small | Console messages show full JSON payloads; verbose for debugging but noisy for daily use |
| Export console history | Small | No way to download console history to a file |
| Sound notifications | Small | No audio cue on task failure or emergency state |

---

## Phase E Improvements (Previously Shipped)

- Dead frontend files removed: `App.js`, `Dashboard.js`, `ChatBox.js`
- SSE `withCredentials: true` + CORS origin reflection
- Emergency state derived from polled ops data (not local state)
- Auth route integration (login, logout, session check)
- Runtime stream endpoint wired to EventSource
- Governor panel wired to real ops data warnings
- Adapter panel connected to real `/runtime/status` adapters array
