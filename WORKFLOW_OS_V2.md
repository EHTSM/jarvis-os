# WORKFLOW OS V2
**Phase:** 39 — Frontend Rebuild Strategy
**Date:** 2026-06-07
**Status:** Specification — No code written
**Scope:** Automate section — Workflows, Task Router, Orchestrator. Backend unchanged.

---

## 1. OVERVIEW

Workflow OS covers the autonomous execution and task management layer. These screens let operators create, trigger, monitor, and manage automated sequences.

| New Screen | Old Tab IDs | Old Components | Section |
|---|---|---|---|
| Workflows | `autonomouswf` | `AutonomousWorkflowCenter.jsx` | Automate |
| Task Router | `taskrouter` | `TaskRouterCenter.jsx` | Automate |
| Orchestrator | `orchestrator` | `ExecutionOrchestratorCenter.jsx` | Automate |
| Autonomous Company | `autonomy` | `AutonomousCompanyCenter.jsx` | Automate |

The full Workflow screen spec is summarized in AGENT_OS_V2.md (section 3). This document adds the visual workflow designer spec and Task Router in detail.

---

## 2. WORKFLOW DESIGNER V2

### 2.1 Purpose

Eventually: a visual node-based workflow builder. Currently: trigger-by-name interface with history. The V2 spec defines the full layout including the future-state designer panel.

### 2.2 Screen Layout (Full)

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Workflows                                            │
│                                                                  │
│  Workflows                           [ + New Workflow ] (soon)  │
│  Autonomous execution sequences                                  │
│──────────────────────────────────────────────────────────────────│
│  [ Library ] [ Running ] [ History ] [ Scheduled ]               │
│    ───────                                                       │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  WORKFLOW LIBRARY                                                │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │ 🔄  follow_up_sequence_v2          [ ▶ Run ] [ ⚙ ]     │     │
│  │ Sends tiered WhatsApp follow-ups to all uncontacted leads│     │
│  │ Last run: Jun 6 14:33  Duration: 4.2s  Status: ● SUCCESS │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │ 📊  daily_lead_score_update        [ ▶ Run ] [ ⚙ ]     │     │
│  │ Scores and prioritizes all leads based on activity      │     │
│  │ Last run: Jun 6 12:00  Duration: 8.1s  Status: ● SUCCESS │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │ 🌙  nightly_report_gen             [ ▶ Run ] [ ⚙ ]     │     │
│  │ Generates executive summary and sends via email         │     │
│  │ Last run: Jun 5 23:00  Duration: 12.3s  Status: ● SUCCESS│     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │ 💸  payment_reminder_batch         [ ▶ Run ] [ ⚙ ]     │     │
│  │ Sends payment reminders to overdue leads                │     │
│  │ Last run: Jun 5 18:30  Duration: 1.2s   Status: ● ERROR  │     │
│  │   └─ Error: WhatsApp template rejected by Meta          │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ── QUICK TRIGGER ──────────────────────────────────────────────│
│  [ Type a workflow name or describe what to automate…  ] [ ▶ ] │
│                                                                  │
│  ◎ Workflow Builder — Coming Soon                                │
│  Visual drag-and-drop workflow designer with conditions,         │
│  branches, and triggers is under development.                    │
└──────────────────────────────────────────────────────────────────┘
```

### 2.3 Workflow Card Design

```
┌──────────────────────────────────────────────────────────────────┐
│  [emoji]  [workflow name]               [ ▶ Run ] [ ⚙ Config ] │
│  [description — 1 line max]                                      │
│  Last run: [relative time]   Duration: [Xs]   Status: [chip]     │
│  └─ [error detail if failed]                                     │
└──────────────────────────────────────────────────────────────────┘
```

The workflow list is currently hardcoded (no "list workflows" API exists yet). V2 hardcodes the 4 known workflow names from the runtime history and adds a stub for future dynamic listing.

**"▶ Run" action:**
- Calls `sendMessage("run " + workflowName, "exec")`
- Button changes to "Running…" with spinner during execution
- On complete: refreshes history, shows toast

**"⚙ Config" action:**
- Coming Soon popover: "Workflow configuration is under development"

### 2.4 Running Tab

Shows only workflows currently executing:
```
┌─────────────────────────────────────────────────────────┐
│  ⚡ follow_up_sequence_v2         RUNNING   3.1s so far │
│  Progress: ██████░░░░ Step 3 of 6                       │
│  [ View Log ] [ ⏹ Cancel ]                              │
└─────────────────────────────────────────────────────────┘
```

Progress is estimated based on known workflow step count.
"Cancel" dispatches emergency stop to that specific workflow (if API supports it, else shows "Emergency stop will halt all workflows").

### 2.5 History Tab

Full paginated workflow run history from `GET /runtime/history?n=50` filtered by type=workflow.

```
Jun 6 14:33  follow_up_sequence_v2  SUCCESS  4.2s   Tokens: 2,400
Jun 6 12:00  daily_lead_score       SUCCESS  8.1s   Tokens: 5,100
Jun 5 23:00  nightly_report_gen     SUCCESS  12.3s  Tokens: 8,800
Jun 5 18:30  payment_reminder       ERROR    1.2s   [expand for error]
```

### 2.6 Scheduled Tab

Currently no scheduling API — full Coming Soon state:
```
◎ Workflow Scheduling — Coming Soon
Set cron-based triggers for automated workflow execution.
Currently you can trigger workflows manually or via API.
```

---

## 3. TASK ROUTER SCREEN V2

### 3.1 Purpose

View how tasks are being routed to agents. Currently `TaskRouterCenter.jsx` is a stub. V2 renders available data from the ops queue and shows routing rules (currently static).

### 3.2 APIs Used

```javascript
getOpsData()           // GET /ops — queue.running, queue.queued, queue.failed
getRuntimeHistory(n)   // GET /runtime/history — for task routing events
```

### 3.3 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Task Router                                          │
│                                                                  │
│  Task Router                                                     │
│  Routing queue and dispatch state                                │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  QUEUE STATUS                                                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Running      │  │ Queued       │  │ Failed       │           │
│  │ 4            │  │ 2            │  │ 0            │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
│                                                                  │
│  ROUTING RULES (configured in backend)                           │
│  ─────────────────────────────────────────────────────────────   │
│  ● jarvis-core        → AI commands (natural language)           │
│  ● workflow-runner    → Named workflow execution                 │
│  ● follow-up-bot      → WhatsApp send tasks                      │
│  ● executor           → General task dispatch                   │
│                                                                  │
│  RECENT ROUTING EVENTS                                           │
│  ─────────────────────────────────────────────────────────────   │
│  14:33  analyze_leads → jarvis-core    SUCCESS  380ms            │
│  14:33  send_whatsapp → follow-up-bot  SUCCESS  220ms            │
│  14:28  run_workflow  → workflow-runner SUCCESS  4.2s            │
│                                                                  │
│  ◎ Dynamic Routing Rules — Coming Soon                           │
│  Create custom routing rules and agent assignment logic.         │
└──────────────────────────────────────────────────────────────────┘
```

### 3.4 Queue Stats

Same 3 metric cards as Control Center queue tile.
Source: `getOpsData() → { queue: { running, queued, failed } }`.
Auto-refreshes every 10s.

### 3.5 Routing Rules

Currently static — hardcoded based on known agent architecture.
Rendered as a list of `agent → task type → [status dot]` rows.
Future: fetch from a routing config API when implemented.

---

## 4. AUTONOMOUS COMPANY SCREEN V2

### 4.1 Purpose

Meta-view of Ooplix running itself — agents managing other agents, self-healing, self-improvement. This is the most aspirational screen and is mostly Coming Soon.

### 4.2 Screen Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Automate › Autonomous Company                                   │
│                                                                  │
│  Autonomous Company                                              │
│  Ooplix runs Ooplix                                              │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  ◎ Autonomous Operations — Coming Soon                           │
│  This is where Ooplix will manage itself: auto-optimize          │
│  workflows, self-heal agents, and improve performance over time. │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  LIVE TODAY (what's already running)                             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐     │
│  │  ● Self-healing agent monitor        ACTIVE             │     │
│  │  Restarts crashed agents automatically                  │     │
│  │  24 restarts prevented this week                        │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │  ● Retry logic with exponential backoff   ACTIVE        │     │
│  │  Failed tasks retried up to 3× before dead-letter       │     │
│  │  12 tasks recovered this week                           │     │
│  ├─────────────────────────────────────────────────────────┤     │
│  │  ○ Evolution scoring engine           MONITORING        │     │
│  │  Scoring system improvement opportunities               │     │
│  │  Score: 72/100 — GET /evolution/score                   │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  COMING SOON                                                     │
│  ○  Agent self-optimization (auto-tuning prompts)                │
│  ○  Workflow auto-generation from patterns                       │
│  ○  Ooplix Runs Ooplix (OoplixRunsOoplixCenter)                  │
└──────────────────────────────────────────────────────────────────┘
```

"Live Today" items source data from:
- `GET /ops → queue.failed_recovered_count` (if exists)
- `GET /evolution/score` via `window.electronAPI.getEvolutionScore()` or `GET /evolution/score`
- Static count fallbacks when API fields don't exist

---

## 5. SHARED WORKFLOW PATTERNS

### 5.1 Trigger Input Pattern

Used across Workflows, Intelligence, and anywhere a command input exists:

```jsx
// Consistent trigger input component
<div className="trigger-input-group">
  <input
    className="trigger-input"
    placeholder="Type a workflow name or command…"
    value={input}
    onChange={e => setInput(e.target.value)}
    onKeyDown={e => e.key === "Enter" && handleSubmit()}
    disabled={loading}
  />
  <button
    className="trigger-submit"
    onClick={handleSubmit}
    disabled={!input.trim() || loading}
  >
    {loading ? <Spinner /> : <Play size={16} />}
  </button>
</div>
```

Styles:
- Height: 44px
- Background: `--surface-1`
- Border: `--border-default` → `--border-accent` on focus
- Submit button: 44×44px, `--brand-violet` background, `--radius-md`

### 5.2 Run Status Toast

All workflow/task dispatch operations show a toast notification:

```
// Success
[ ✓  Workflow "follow_up_sequence_v2" dispatched ]    [✕]

// Error
[ ✗  Could not dispatch — [error message]  ]          [✕]
```

Toast appears bottom-right, dismisses after 4s.

---

## 6. EMPTY STATES

**Workflows — no runs yet:**
```
    [GitBranch icon — 32px]
    No workflows have run yet
    Type a workflow name in the trigger box, or ask Jarvis
    to run a workflow using natural language.
    [ Ask Jarvis → ]
```

**Task Router — no queue items:**
```
    [CheckCircle icon — 32px, green]
    Queue is clear
    All tasks completed. No items pending.
```

**Autonomous Company — new account:**
```
    [Bot icon — 32px]
    Building autonomy…
    As you use Ooplix, the autonomous systems will accumulate
    data and start self-optimizing. Check back in a few days.
```
