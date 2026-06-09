# V5 Phase 2 — Capability Matrix

**Date:** 2026-06-02

---

## Goal Engine

| Capability | Implemented | Notes |
|---|---|---|
| **Goal creation** | ✓ | title, description, type, targetDate, blueprintId, tags |
| — All four goal types | ✓ | personal, business, development, operational |
| — Auto type inference | ✓ | keyword matching from title + description |
| — Blueprint context enrichment | ✓ | dev goals → getProjectMemory(blueprintId) |
| **Milestone generation** | ✓ | Rule-based, 5 milestones per type |
| — Full 5-milestone sequence | ✓ | |
| — Keyword trim (quick/simple/fix) | ✓ | → 3 milestones |
| — Focus trim (research/audit) | ✓ | → 2 milestones |
| — Operational monitoring trim | ✓ | → last 3 milestones |
| **Task decomposition** | ✓ | 2 tasks per milestone, typed, with estimatedMins |
| — All task types | ✓ | research, design, build, test, deploy, review, document, execute |
| — dependsOn array | ✓ | Wirable for task ordering |
| **Progress tracking** | ✓ | completionPct, milestone status cascade |
| — Per-task status | ✓ | pending, running, completed, failed, skipped |
| — Milestone status cascade | ✓ | auto-updates on advanceTask |
| — completionPct recomputation | ✓ | on every advanceTask |
| **Goal health scoring** | ✓ | 0–100, 4 dimensions |
| — velocity (30 pts) | ✓ | tasks/day vs expected 2/day |
| — momentum (25 pts) | ✓ | time since last update |
| — focus (25 pts) | ✓ | inverse of failed task rate |
| — alignment (20 pts) | ✓ | milestone sequence integrity |
| **Goal completion reports** | ✓ | totalTasks, completed, failed, duration, summary |
| **Goal memory integration** | ✓ | getGoalSummary, unifiedMemory index updated |
| **Goal lifecycle** | ✓ | active → paused/abandoned/completed |
| — pause / resume | ✓ | |
| — abandon with reason | ✓ | |
| — can't complete abandoned | ✓ | guard added |
| **projectRunner integration** | ✓ | executeGoalTask → runProject (async) |
| **listGoals filters** | ✓ | type, status, blueprintId, tags, limit |
| **HTTP: POST /goals** | ✓ | |
| **HTTP: GET /goals** | ✓ | |
| **HTTP: GET /goals/summary** | ✓ | |
| **HTTP: GET /goals/:id** | ✓ | |
| **HTTP: POST /goals/:id/advance** | ✓ | |
| **HTTP: POST /goals/:id/complete** | ✓ | |
| **HTTP: POST /goals/:id/abandon** | ✓ | |
| **HTTP: GET /goals/:id/report** | ✓ | |
| **Auth guard** | ✓ | All routes behind requireAuth + operatorAudit |
| **No AI in planning layer** | ✓ | Milestones/tasks are rule-based templates |
| **No new architecture** | ✓ | Single file, no new agents |

---

## Verification Test Coverage

| Scenario | What's Tested | Assertions |
|---|---|---|
| Goal creation | shape, fields, persistence | 13 |
| Milestone generation | counts, sequence, keyword trim, all types | 8 |
| Task structure | fields, types, estimatedMins, status | 10 |
| Progress updates | completionPct, milestone cascade, health, error cases | 9 |
| Completion report | all fields, storage, error guard | 13 |
| Health scoring | dimensions, fresh vs failed | 5 |
| Memory integration | getGoalSummary counts | 7 |
| Type inference | all 4 types from keywords | 4 |
| Lifecycle | pause, resume, abandon, guards | 9 |
| listGoals filters | type, status, blueprintId, null case | 5 |
| **Total** | | **85/85** |

---

## V5 Stack — Phases 1–2

| Layer | Module | What it does |
|---|---|---|
| Unified Memory | `unifiedMemoryEngine` | Read-through index + search across all stores |
| Goal Engine | `goalEngine` | Goal lifecycle, milestone/task tracking, health scoring |

**Goal execution flow:**
```
POST /goals { title: "Build payment API", type: "development" }
  → createGoal()
      → 5 milestones × 2 tasks = 10 tasks
      → blueprintId enrichment (if provided)
      → unifiedMemoryEngine.index() [setImmediate]

GET /goals/:id → full goal with milestones + tasks + health

POST /goals/:id/advance { taskId, ok: true, detail: "done" }
  → advanceTask()
      → task.status = completed
      → completionPct recomputed
      → milestone cascade (pending → active → completed)
      → healthScore updated

POST /goals/:id/complete { note: "launched" }
  → completeGoal()
      → LifecycleReport generated
      → goal.status = completed

GET /goals/:id/report → completion report
```
