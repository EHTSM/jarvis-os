# AGENT OS V2
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Automate section — Agents, Workflows, Orchestrator, Intelligence. Backend unchanged.

---

## 1. OVERVIEW

The Agent OS covers all autonomous execution screens under the **Automate** navigation group.

| New Screen | Old Tab ID | Old Component | Section |
|---|---|---|---|
| Agents | `agents` | `AgentCenter.jsx` | Automate |
| Workflows | `autonomouswf` | `AutonomousWorkflowCenter.jsx` | Automate |
| Intelligence | `jarvisbrain` | `JarvisBrainCenter.jsx` | Automate |
| Orchestrator | `orchestrator` | `ExecutionOrchestratorCenter.jsx` | Automate |
| Chat (AI) | `chat` | `Chat.jsx` | Automate (sub-panel) |

**Secondary screens (under Automate, lower priority):**
- Agent Registry → `AgentRegistryCenter.jsx`
- Task Router → `TaskRouterCenter.jsx`
- Agent Collaboration → `AgentCollaborationCenter.jsx`
- Agent Factory → `AgentFactoryCenter.jsx`
- Autonomy Score → `AutonomyScoreCenter.jsx`

---

## 2. AGENTS SCREEN V2

### 2.1 Purpose

View, configure, and monitor all agents. Primary control surface for AI orchestration.

### 2.2 APIs Used

```javascript
// Phase APIs — from existing phase*Api.js files
sendMessage(input, mode)         // POST /jarvis (via api.js)
getStats()                       // GET /stats
getOpsData()                     // GET /ops → queue data
getRuntimeHistory(n)             // GET /runtime/history
dispatchTask(action)             // execute-with-retry wrapper
```

### 2.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Agents                                               │
│                                                                  │
│  Agents                                  [ + New Agent ] (soon) │
│  4 agents configured · 2 currently running                       │
│──────────────────────────────────────────────────────────────────│
│  [ Overview ] [ Registry ] [ Running ] [ Logs ] [ Factory ]      │
│               ──────────                                         │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  REGISTRY                                                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ ● jarvis-core                        RUNNING            │     │
│  │ AI command executor · 248 tasks completed               │     │
│  │ Avg: 380ms  Last run: 30s ago   Model: Groq/Mixtral     │     │
│  │ [ View Logs ] [ Configure ]                             │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │ ● workflow-runner                    IDLE               │     │
│  │ Workflow execution engine · 12 workflows                │     │
│  │ Avg: 1.2s   Last run: 8m ago    Queue: 0               │     │
│  │ [ View Logs ] [ Configure ]                             │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │ ○ follow-up-bot                      IDLE               │     │
│  │ WhatsApp follow-up sequencer · 89 messages sent         │     │
│  │ Avg: 220ms  Last run: 2h ago    Queue: 0               │     │
│  │ [ View Logs ] [ Configure ]                             │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │ ◎ agent-factory                  COMING SOON            │     │
│  │ Create and train custom agents                          │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 2.4 Agent Card Design

```
┌─────────────────────────────────────────────────────────┐
│  ● [name]                          [STATUS CHIP]        │
│  [description] · [N tasks completed]                    │
│  Avg: [Xms]   Last run: [relative]   Model/Queue: [val]  │
│                                                         │
│  [ View Logs → ]   [ Configure ]   [ ▶ Run ]           │
└─────────────────────────────────────────────────────────┘
```

- Status chip: RUNNING (teal pulse), IDLE (dim), ERROR (red), COMING SOON (violet outline)
- "View Logs →" navigates to Activity screen filtered to that agent
- "Run" button: dispatches via `sendMessage("run [agent-name]", "exec")`
- Coming Soon agents: all action buttons disabled, chip shows "◎ COMING SOON"

### 2.5 Sub-tabs

| Tab | Content |
|---|---|
| Overview | Summary — running/idle counts, aggregate queue stats |
| Registry | Agent cards list (default view above) |
| Running | Live view: only agents with status=running, auto-refreshes every 5s |
| Logs | Filtered activity log (type=agent) — same as Activity screen but filtered |
| Factory | AgentFactoryCenter (coming soon banner) |

---

## 3. WORKFLOWS SCREEN V2

### 3.1 Purpose

View and trigger autonomous workflows. Replaces `AutonomousWorkflowCenter.jsx`.

### 3.2 APIs Used

```javascript
sendMessage(input, mode)    // POST /jarvis — trigger workflow by name
getRuntimeHistory(n)        // GET /runtime/history — workflow execution logs
getOpsData()                // GET /ops — queue stats
```

### 3.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Workflows                                            │
│                                                                  │
│  Workflows                           [ + New Workflow ] (soon)  │
│  Autonomous execution sequences                                  │
│──────────────────────────────────────────────────────────────────│
│  [ All ] [ Running ] [ Scheduled ] [ Completed ] [ Failed ]      │
│                                                                  │
│  ◎ Workflow Builder — Coming Soon                                │
│  Visual workflow builder is under development. You can           │
│  trigger workflows by name using the Command input below.        │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  TRIGGER WORKFLOW                                                │
│  Type a workflow name or describe what to automate:              │
│  [ ── follow up with all new leads ─────────────────── ] [▶ Run]│
│                                                                  │
│  RECENT WORKFLOW RUNS                                            │
│  ─────────────────────────────────────────────────────────────   │
│  Jun 6 14:33  follow_up_sequence_v2      ● SUCCESS  4.2s        │
│  Jun 6 12:00  daily_lead_score_update    ● SUCCESS  8.1s        │
│  Jun 5 23:00  nightly_report_gen        ● SUCCESS  12.3s        │
│  Jun 5 18:30  payment_reminder_batch    ● ERROR    1.2s         │
│    └─ Error: WhatsApp template rejected                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 3.4 Workflow Trigger Input

Full-width text input. On submit (Enter or ▶ Run button):
- Calls `sendMessage(input, "exec")` via the AI gateway
- Shows loading state: animated dots in input
- Success: green toast "Workflow dispatched"
- Error: red toast with error detail

This reuses the existing `sendMessage` API — no new backend route required.

### 3.5 Workflow Run Row

```
[date time]  [workflow name]     ● STATUS  [duration]   [▶ Re-run]
  └─ [error detail if failed]
```

Run rows sourced from `GET /runtime/history` filtered by type=workflow.
"Re-run": dispatches same workflow name via `sendMessage`.

---

## 4. INTELLIGENCE SCREEN V2 (AI Chat)

### 4.1 Purpose

The primary AI command interface. Replaces `Chat.jsx` and `JarvisBrainCenter.jsx`. In V2 this is a single unified screen rather than two separate tabs.

### 4.2 APIs Used

```javascript
sendMessage(input, mode)       // POST /jarvis
checkHealth()                  // GET /health (for status)
```

### 4.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Intelligence                                         │
│                                                                  │
│  Jarvis                              ● Online · Groq/Mixtral     │
│  Natural language command interface                              │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │                                                         │     │
│  │  [Conversation area — scrollable]                       │     │
│  │                                                         │     │
│  │  ┌─────────────────────────────────────────────────┐   │     │
│  │  │ You  14:33                                      │   │     │
│  │  │ Analyze my leads and tell me which ones to      │   │     │
│  │  │ follow up with today.                           │   │     │
│  │  └─────────────────────────────────────────────────┘   │     │
│  │                                                         │     │
│  │  ┌─────────────────────────────────────────────────┐   │     │
│  │  │ Jarvis  14:33                                   │   │     │
│  │  │ I found 12 leads that haven't been contacted    │   │     │
│  │  │ in 3+ days. Top priority:                       │   │     │
│  │  │ 1. Raj Kumar (₹15k) — last contact 4 days ago  │   │     │
│  │  │ 2. Priya Sharma (₹8k) — never followed up      │   │     │
│  │  │ Want me to send follow-ups to these now?        │   │     │
│  │  └─────────────────────────────────────────────────┘   │     │
│  │                                                         │     │
│  │  [Loading indicator — 3 animated dots]                  │     │
│  │                                                         │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  SUGGESTED PROMPTS (shown when empty)                            │
│  [ Analyze my leads ]  [ Run follow-up ]  [ Generate report ]    │
│                                                                  │
│  [ Type a command or question…                         ] [ ▶ ]  │
└──────────────────────────────────────────────────────────────────┘
```

### 4.4 Message Design

**User message (right-aligned):**
```
                    ┌────────────────────────────────┐
                    │ [Message text]                  │  violet background
                    │                          14:33  │
                    └────────────────────────────────┘
```

**Jarvis message (left-aligned):**
```
  [⬡]  ┌────────────────────────────────┐
        │ [Response text]                │  surface-1 background
        │                        14:33  │
        └────────────────────────────────┘
```

- `⬡` = Jarvis avatar (violet hex icon, 28px)
- Timestamp: `--text-mono`, `--text-tertiary`, 11px
- Message bubble: `--radius-lg`, padding 12px 14px
- User bubble: `--fill-accent` background, `--border-accent` border
- Jarvis bubble: `--surface-1` background, `--border-default` border
- Auto-scroll to bottom on new message
- Loading state: 3-dot pulse animation in Jarvis bubble position

### 4.5 Suggested Prompts

Shown when message history is empty or has only 1 message.
Pre-defined prompts from current `Chat.jsx` suggestions (preserved).
Clicking a prompt: fills input + auto-submits.

### 4.6 Input Area

```
[ ──────────────── Type a command… ──────────────── ] [ ▶ ]
```
- Full-width textarea, auto-resize (max 4 rows)
- `--input-bg`, `--radius-md`, `--input-border`
- `▶` button: violet, disabled when empty or loading
- Enter submits, Shift+Enter adds newline
- Disabled with shimmer during load

### 4.7 Status Indicator

Top-right of header area:
- `● Online · Groq/Mixtral` — green dot, model name from `GET /health`
- `○ Offline — messages queued` — dim, shown when health check fails
- Click → navigates to Build › DevOps for AI model config

---

## 5. ORCHESTRATOR SCREEN V2

### 5.1 Purpose

High-level execution control. Replaces `ExecutionOrchestratorCenter.jsx`. Surfaces emergency controls and execution governor.

### 5.2 APIs Used

```javascript
emergencyStop(reason)     // POST /runtime/emergency/stop
emergencyResume()         // POST /runtime/emergency/resume
getRuntimeStatus()        // GET /runtime/status
getOpsData()              // GET /ops
getRuntimeHistory(n)      // GET /runtime/history
```

### 5.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Orchestrator                                         │
│                                                                  │
│  Orchestrator                                                    │
│  Execution control and emergency management                      │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  EXECUTION STATUS                                                │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  System Status:  ● RUNNING NORMALLY                     │     │
│  │  Emergency Stop: ○ INACTIVE                             │     │
│  │  Queue:          4 running · 2 queued · 0 failed        │     │
│  │  Uptime:         36h 42m                                │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  EMERGENCY CONTROLS                                              │
│  ┌──────────────────────────────┐  ┌──────────────────────────┐  │
│  │  ⏹ Emergency Stop            │  │  ▶ Resume Execution      │  │
│  │  Halts all agents + queue    │  │  Clears emergency mode   │  │
│  │  [ Confirm and Stop ]        │  │  [ Resume ]              │  │
│  └──────────────────────────────┘  └──────────────────────────┘  │
│                                                                  │
│  EXECUTION HISTORY (last 20)                                     │
│  [same activity log as Work › Activity but not filtered]         │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.4 Emergency Stop Flow

"Confirm and Stop" button:
1. Renders confirm dialog: "This will halt all running agents and queue processing. Continue?"
2. On confirm: `emergencyStop("operator-triggered")` → `POST /runtime/emergency/stop`
3. Success: status strip turns red, entire app shows `EmergencyModeBanner`
4. Button changes to disabled "Emergency Stop Active"

Resume button:
1. Only clickable when emergency is active
2. `emergencyResume()` → `POST /runtime/emergency/resume`
3. Success: status strip returns to normal, `EmergencyModeBanner` dismisses

---

## 6. MEMORY SCREEN V2

*(Part of Automate group — full spec in MEMORY_OS_V2.md)*

Brief summary:
- Replaces `MemoryCenter.jsx` + `SharedMemoryCenter.jsx`
- APIs: `GET /memory` (phase APIs)
- Shows memory index, search, recent writes
- Coming Soon banner for advanced memory editing

---

## 7. COMING SOON SURFACES

The following Automate sub-screens get Coming Soon banners, full UI preserved beneath:

| Screen | Coming Soon Reason |
|---|---|
| Agent Factory | Custom agent creation not yet in production |
| Task Router | Routing rules UI pending backend |
| Agent Collaboration | Multi-agent coordination pending |
| Autonomy Score | Scoring engine output UI pending |
| Agent Actions | Action catalogue UI pending |

Coming Soon banner template (from existing V1 pattern):
```jsx
<div className="coming-soon-banner">
  <span className="csb-icon">◎</span>
  <div className="csb-body">
    <span className="csb-title">[Feature] — Coming Soon</span>
    <span className="csb-sub">[1-line explanation]</span>
  </div>
</div>
```

---

## 8. RESPONSIVE DESIGN

| Screen | Mobile | Desktop |
|---|---|---|
| Agents | Single column card stack | 2-column (agents left, logs right) |
| Workflows | Single column | 2-column (trigger left, history right) |
| Intelligence | Full-screen chat | Same but with wider message area |
| Orchestrator | Single column | 2-column controls |

On mobile < 480px: suggested prompts hide, input always visible at bottom (fixed position).
