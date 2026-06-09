# V5 Phase 3 — Updated Capability Matrix

**Date:** 2026-06-02

---

## V5 Phases — Cumulative Capability

| Phase | Module | Status | Assertions |
|---|---|---|---|
| Phase 1 | Unified Memory Engine | COMPLETE | 85/85 |
| Phase 2 | Goal Engine | COMPLETE | 85/85 |
| Phase 3 | Personal AI OS | COMPLETE | 85/85 |

---

## Phase 3 — personalOS.cjs Capability Matrix

### Task Management

| Capability | Entry Point | Verified |
|---|---|---|
| Create task with priority, tags, dueDate, goalLink | `createTask(opts)` | ✓ |
| Update any task field | `updateTask(taskId, patch)` | ✓ |
| Complete task (sets completedAt, idempotent guard) | `completeTask(taskId)` | ✓ |
| Soft-delete task | `deleteTask(taskId)` | ✓ |
| List with filters: status, priority, tag, overdue, goalId | `listTasks(opts)` | ✓ |
| Retrieve by ID | `getTask(taskId)` | ✓ |

### Notes Management

| Capability | Entry Point | Verified |
|---|---|---|
| Create note with content, tags, pinned flag | `createNote(opts)` | ✓ |
| Update content, tags, pinned | `updateNote(noteId, patch)` | ✓ |
| Soft-delete note | `deleteNote(noteId)` | ✓ |
| Keyword search across title + content | `listNotes({ search })` | ✓ |
| Filter by pinned, tags | `listNotes({ pinned, tags })` | ✓ |
| Retrieve by ID | `getNote(noteId)` | ✓ |

### Reminder Management

| Capability | Entry Point | Verified |
|---|---|---|
| Create reminder with dueAt, repeatMins | `createReminder(opts)` | ✓ |
| Dismiss reminder | `dismissReminder(reminderId)` | ✓ |
| Snooze reminder N minutes | `snoozeReminder(reminderId, mins)` | ✓ |
| Get currently overdue reminders | `getDueReminders()` | ✓ |
| List upcoming (sorted by dueAt) | `listReminders({ upcoming: true })` | ✓ |

### Personal Knowledge Base

| Capability | Entry Point | Verified |
|---|---|---|
| Store fact/insight by key+category | `addKnowledge(opts)` | ✓ |
| Upsert: same key overwrites | `addKnowledge({ key })` | ✓ |
| Retrieve by key (increments uses) | `getKnowledge(key)` | ✓ |
| Keyword search: key + content + tags | `searchKnowledge(query)` | ✓ |
| List by category | `listKnowledge({ category })` | ✓ |
| Delete entry | `deleteKnowledge(key)` | ✓ |

### Summaries & Dashboard

| Capability | Entry Point | Verified |
|---|---|---|
| Live dashboard: tasks, notes, reminders, goals, health | `getDashboard()` | ✓ |
| Daily summary for any date | `getDailySummary(date?)` | ✓ |
| Weekly summary for any week | `getWeeklySummary(weekStart?)` | ✓ |
| Counts across all stores | `getStats()` | ✓ |

### Memory Integration

| Capability | Entry Point | Verified |
|---|---|---|
| Cross-store search: tasks + notes + KB | `searchMemory(query)` | ✓ |
| Cross-namespace via unifiedMemoryEngine | `searchMemory(query)` (UME fallback) | ✓ |
| Goal data in dashboard/summaries | via `goalEngine.listGoals()` | ✓ |
| Lifecycle maturity in weekly summary | via `lifecycle-reports.json` | ✓ |
| System health in dashboard/daily | via `telemetry-summary.json` | ✓ |

### Error Handling

| Scenario | Behaviour | Verified |
|---|---|---|
| createTask with no title | `{ ok: false, error: "title required" }` | ✓ |
| createNote with no title | `{ ok: false, error: "title required" }` | ✓ |
| createReminder with no dueAt | `{ ok: false, error: "dueAt required" }` | ✓ |
| updateTask unknown ID | `{ ok: false, error: "task_not_found" }` | ✓ |
| searchMemory empty query | `[]` | ✓ |

---

## Storage Summary

| File | Purpose | Cap |
|---|---|---|
| `data/personal-tasks.json` | Task list | 500 |
| `data/personal-notes.json` | Notes | 500 |
| `data/personal-reminders.json` | Reminders | 200 |
| `data/personal-kb.json` | Knowledge base | 1000 |

All files use the same atomic write pattern (`.tmp` → `rename`) established in V1.

---

## Cumulative Jarvis V5 Capability Summary

| Domain | Capability |
|---|---|
| Memory | Cross-namespace indexing, search, lookup — unified across project/workflow/incident/decision/knowledge |
| Goals | Create + milestone generation, advance tasks, complete goals, health scoring (0–100), velocity tracking |
| Personal OS | Tasks, notes, reminders, knowledge base, daily/weekly summaries, cross-store memory search |
| Lifecycle | Product maturity scoring, debt tracking, lifecycle reports, recommendations |
| Learning | Incident/RCA pattern learning, repeat detection, fix recommendations |
