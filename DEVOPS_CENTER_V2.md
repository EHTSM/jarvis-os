# DEVOPS CENTER V2
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Build › DevOps screen + Electron Operator Console redesign. Backend unchanged.

---

## 1. OVERVIEW

DevOps Center covers:
1. **Web:** Build › DevOps screen — system monitoring, deployment controls, runtime management
2. **Electron:** Operator Console redesign — panel grid, IPC-connected widgets, real-time feeds

| New Screen | Old Tab ID | Old Component | Platform |
|---|---|---|---|
| DevOps Center | `devops` | `DevOpsCenter.jsx` | Web + Electron |
| Operator Console | `runtime` | `operator/OperatorConsole.jsx` | Electron (primary) |

---

## 2. DEVOPS CENTER SCREEN V2 (WEB)

### 2.1 Purpose

Full system observability for operators. Runtime control, deployment management, AI model monitoring, crash logs.

### 2.2 APIs Used

```javascript
checkHealth()                   // GET /health
getOpsData()                    // GET /ops
getMetrics()                    // GET /metrics
getRuntimeHistory(n)            // GET /runtime/history
getRuntimeStatus()              // GET /runtime/status
emergencyStop(reason)           // POST /runtime/emergency/stop
emergencyResume()               // POST /runtime/emergency/resume
// Electron-only:
window.electronAPI.getServerHealth()
window.electronAPI.getRendererCrashes()
window.electronAPI.getEvolutionScore()
window.electronAPI.getSuggestions()
```

### 2.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Build › DevOps                                                  │
│                                                                  │
│  DevOps Center                                                   │
│  Runtime monitoring and deployment control                       │
│──────────────────────────────────────────────────────────────────│
│  [ Overview ] [ Runtime ] [ AI Model ] [ Logs ] [ Deploy ]       │
│    ─────────                                                     │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  OVERVIEW                                                        │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  SYSTEM HEALTH                                 ● ONLINE  │    │
│  │  ──────────────────────────────────────────────────────  │    │
│  │  Server uptime    36h 42m      Process memory   312 MB   │    │
│  │  Node.js version  v22.x        Port             5050      │    │
│  │  Environment      production   PID              10025     │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  SERVICES                      │  EXECUTION CONTROLS            │
│  ─────────────────────────────  │  ─────────────────────────     │
│  ● AI (Groq)       99.1% up    │  [ ⏹ Emergency Stop ]         │
│  ● WhatsApp        Active      │  [ ▶ Resume Execution ]        │
│  ⚠ Razorpay        Auth error  │  [ ↻ Restart Workers ]  (soon) │
│  ● Telegram        Active      │                                 │
│  ● Task Queue      4 running   │  EVOLUTION SCORE               │
│                                │  ─────────────────────────     │
│  [ View Engineering → ]        │  72 / 100   ██████████░░░      │
│                                │  [ View Suggestions ]          │
└────────────────────────────────┴─────────────────────────────────┘
```

### 2.4 Runtime Sub-tab

```
┌──────────────────────────────────────────────────────────────────┐
│  RUNTIME STATUS (from GET /runtime/status)                       │
│                                                                  │
│  Mode:           normal                                          │
│  Emergency Stop: inactive                                        │
│  Queue depth:    4 running / 2 queued                            │
│  Last command:   "analyze leads" — 30s ago                       │
│  Executor:       agents/executor.cjs v2.4.1                      │
│                                                                  │
│  RECENT EXECUTIONS                                               │
│  ─────────────────────────────────────────────────────────────   │
│  [Same feed as Activity screen — last 10 events]                │
│                                                                  │
│  SSE Stream Status:   ● Connected (GET /ops/rt/history)          │
│  Fallback Polling:    inactive                                   │
│  Retry Backoff:       n/a (connected)                            │
└──────────────────────────────────────────────────────────────────┘
```

SSE stream status sourced from `useRuntimeStream` hook state.

### 2.5 AI Model Sub-tab

```
┌──────────────────────────────────────────────────────────────────┐
│  AI ENGINE CONFIGURATION                                         │
│                                                                  │
│  Current Model:    Groq / Mixtral-8x7b-32768                    │
│  Provider:         Groq API (api.groq.com)                       │
│  Status:           ● Online   Last response: 320ms              │
│  Key configured:   ✓ GROQ_API_KEY set                           │
│                                                                  │
│  EVOLUTION SCORING                                               │
│  ─────────────────────────────────────────────────────────────   │
│  Score:  72 / 100                                                │
│  ████████████████████████████████░░░░░░░░░░░░░░░░░░░░           │
│                                                                  │
│  SUGGESTIONS (from GET /evolution/suggestions)                   │
│  ─────────────────────────────────────────────────────────────   │
│  ○ Suggestion: "Increase WhatsApp template diversity"            │
│    [ Approve ] [ Dismiss ]                                       │
│  ○ Suggestion: "Enable retry on payment link failure"            │
│    [ Approve ] [ Dismiss ]                                       │
└──────────────────────────────────────────────────────────────────┘
```

Evolution score: `GET /evolution/score` or `window.electronAPI.getEvolutionScore()`.
Suggestions: `GET /evolution/suggestions` or `window.electronAPI.getSuggestions()`.
"Approve": `POST /evolution/approve/{id}` or `window.electronAPI.approveSuggestion(id)`.

### 2.6 Logs Sub-tab

```
┌──────────────────────────────────────────────────────────────────┐
│  SERVER LOGS                             [ ↓ Download ] (soon)  │
│                                                                  │
│  [ All ] [ Errors ] [ Warnings ] [ AI ] [ HTTP ]                 │
│                                                                  │
│  [Scroll feed — same as Activity screen runtime/history]         │
│  Filtered to type=system|error|warning when those tabs selected  │
│                                                                  │
│  CRASH LOG (Electron)                                            │
│  ─────────────────────────────────────────────────────────────   │
│  Jun 6 02:14  Renderer crash #3 — auto-recovered                 │
│  Jun 3 18:40  Renderer crash #2 — auto-recovered                 │
│  Jun 1 09:12  Renderer crash #1 — auto-recovered                 │
└──────────────────────────────────────────────────────────────────┘
```

Crash log: `window.electronAPI.getRendererCrashes()` — Electron only.
On web: crash log section hidden (no IPC).

### 2.7 Deploy Sub-tab

```
◎ Deployment Controls — Coming Soon
One-click deploy, rollback, and environment management.
Currently, deployment is managed via the server CLI:
  pm2 restart all
  kill $(lsof -ti:5050) && node backend/server.js
```

Shows static deploy commands for operator reference. No interactive deploy in V1.

---

## 3. OPERATOR CONSOLE V2 (ELECTRON)

### 3.1 Purpose

The Electron-exclusive full-screen operator interface. Replaces `operator/OperatorConsole.jsx`. In V2 it becomes a proper panel grid with clear zones, not a vertical stack of collapsed panels.

### 3.2 Architecture

The Operator Console is accessed from the Electron sidebar (compact icon), opening a full-window split-panel layout. It is NOT a tab in the main app flow — it's an overlay or dedicated window mode.

**Activation:**
- Electron: Press `Cmd+Shift+O` or click Operator icon in sidebar footer
- Alternative: Create floating window via `window.electronAPI.createFloatingWindow()`

### 3.3 Layout (Full Screen, 4-Zone Grid)

```
┌─────────────────────────────────────────────────────────────────┐
│ TITLEBAR: ● IPC Connected · Server: ONLINE · Emergency: INACTIVE │
├──────────────────────┬──────────────────────┬───────────────────┤
│                      │                      │                   │
│   EXECUTION LOG      │   AI CONSOLE         │   HEALTH          │
│                      │                      │                   │
│  [Live stream of     │  [Command input      │  ● AI: Online     │
│   runtime events]    │   + response]        │  ● WA: Active     │
│                      │                      │  ⚠ Pay: Error     │
│  [10 rows, scrolls   │  [same as Chat V2    │  Queue: 4/2/0     │
│   up as new arrive]  │   but compact]       │  Mem: 312MB       │
│                      │                      │  Uptime: 36h      │
│  [Filter: All/WA/    │  [Suggestion chips   │                   │
│   Agent/Error]       │   from evolution]    │  [EVS: 72/100]    │
│                      │                      │                   │
├──────────────────────┴──────────────────────┤                   │
│                                             │                   │
│   WORKFLOW PANEL                            │  EMERGENCY        │
│                                             │  ─────────────    │
│  [Trigger input — same as Workflows V2]     │  [⏹ STOP]        │
│  [Last 5 workflow runs with status]         │  [▶ RESUME]       │
│                                             │                   │
└─────────────────────────────────────────────┴───────────────────┘
```

Grid: CSS Grid `grid-template-columns: 1fr 1fr 280px`.
Row split: top 60% / bottom 40%.
Health + Emergency panel: right column, full height.

### 3.4 Panel Design Tokens (Electron-specific)

```css
/* Operator console uses tighter spacing */
--op-panel-gap:     8px;
--op-panel-bg:      rgba(6, 8, 14, 0.99);
--op-panel-border:  rgba(255, 255, 255, 0.06);
--op-panel-radius:  var(--radius-lg);
--op-panel-padding: var(--space-4);

/* Execution log row */
--op-log-font:      var(--font-mono);
--op-log-size:      11px;
--op-log-line-height: 1.6;
```

### 3.5 Execution Log Panel

```
14:33:12 ● [TASK]   analyze_leads   → jarvis-core         SUCCESS 380ms
14:33:10 ● [WA]     send_msg_raj   → follow-up-bot        SUCCESS 220ms
14:32:58 ● [AGENT]  workflow_run   → workflow-runner       RUNNING 4.2s...
14:28:30 ⚠ [AGENT]  workflow_err   → workflow-runner       ERROR  timeout
```

- Monospace font, 11px, tight line height
- Dot color per status (green/amber/red)
- Type badges: `[TASK]` `[WA]` `[AGENT]` `[SYSTEM]` — dim, monospace
- Auto-scrolls down on new entries
- "Pause scroll" checkbox when operator is reading
- Max 200 rows in DOM (virtual scroll or windowing)

Source: `GET /runtime/history?n=100` initial + `GET /ops/rt/history` SSE stream.

### 3.6 AI Console Panel

Compact version of the Intelligence chat:
- Input: single line, monospace
- Responses: plain text, monospace, compact
- No avatars — just `YOU >` and `AI >` prefixes
- Suggested prompts hidden in compact mode
- Full focus on speed and density

### 3.7 Health Panel

```
SYSTEM HEALTH                    ●
─────────────────────────────────
● AI Engine      Online    320ms
⚠ Razorpay       Error     N/A
● WhatsApp        Active    220ms
● Telegram        Active    180ms

QUEUE
Running   4 │ Queued   2 │ Failed  0

SYSTEM
Memory    312 MB / 512 MB  ████████░
Uptime    36h 42m
Node.js   v22.x
PID       10025

EVOLUTION SCORE
72 / 100  ██████████░░░
```

All values from `GET /health` + `GET /ops` + `GET /metrics`.
IPC-aware: uses `window.electronAPI.getServerHealth()` in Electron, falls back to HTTP `GET /health` on web.

### 3.8 Emergency Panel

```
EMERGENCY CONTROLS
─────────────────────────────────
Status:   ○ INACTIVE

[ ⏹ Emergency Stop  ]
[ ▶ Resume          ]  ← disabled when inactive

Last event: —
```

Confirm dialog before Stop (same as Orchestrator screen).
When emergency active: both panel and titlebar turn red. "EMERGENCY STOP ACTIVE" replaces titlebar text.

---

## 4. IPC CONNECTIVITY SPEC

All Electron panels use a consistent IPC-aware data fetching pattern:

```javascript
function _isElectron() {
  return typeof window !== "undefined" && !!window.electronAPI;
}

async function fetchHealth() {
  if (_isElectron()) {
    return window.electronAPI.getServerHealth();
  }
  return checkHealth(); // HTTP fallback
}
```

The 15 IPC channels (from Phase 37 cert) remain unchanged:
- `send-command`, `get-evolution-score`, `get-suggestions`, `approve-suggestion`
- `get-server-health`, `create-floating-window`
- `report-renderer-crash`, `get-renderer-crashes`
- Listeners: `onServerDisconnected`, `onToggleFloatingWindow`, `onLowMemory`
- System: `onSystemResume`, `onNetworkChange`, `onWindowRestored`

---

## 5. OFFLINE MODE (ELECTRON)

When `connectionState === "offline"` (from `useRuntimeStream` hook):

1. Status strip turns amber: "Offline — Reconnecting…"
2. All data panels show last-known values with timestamp: "Last seen 2m ago"
3. Input panels disable with message: "Commands unavailable while offline"
4. Retry backoff: 1→2→4→8→30s then persistent 30s polling
5. When reconnected: green flash animation on status strip, data refreshes

Offline state CSS:
```css
[data-connection="offline"] .op-panel-input { opacity: 0.5; pointer-events: none; }
[data-connection="offline"] .op-header-status { color: var(--status-warning); }
```

---

## 6. RESPONSIVE SPEC

**Web (DevOps screen):**
- Mobile: single column, stats stacked
- Tablet: 2-column layout
- Desktop: full 3-zone layout

**Electron (Operator Console):**
- Always full-screen — no responsive breakpoints needed
- Minimum window size: 900×600px (enforced by main.cjs `minWidth`/`minHeight`)
- Resizable panels via CSS `grid-template-columns` (future: draggable dividers)
