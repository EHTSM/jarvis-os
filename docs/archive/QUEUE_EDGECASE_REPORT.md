> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# Queue Edge-Case Report
**Phase J — Month 1 Workflow Stabilization**
**Generated:** 2026-05-15

---

## System Overview

JARVIS OS has two separate, uncoordinated queue systems:

| | Disk Queue (`taskQueue.cjs`) | In-Memory Queue (`priorityQueue.cjs`) |
|--|--|--|
| **Path** | `agents/taskQueue.cjs` | `agents/runtime/priorityQueue.cjs` |
| **Consumer** | `agents/autonomousLoop.cjs` | `agents/runtime/runtimeOrchestrator.cjs` |
| **Entry point** | Natural language → planner → executor → `queue_task` handler | `POST /runtime/queue` via operator console |
| **Persistence** | ✅ JSON file (`data/task-queue.json`), atomic rename | ❌ In-memory only — lost on restart |
| **Priorities** | ❌ No priority ordering | ✅ HIGH / NORMAL / LOW |
| **Visible in UI** | ❌ No UI | ✅ Operator console |
| **Emergency stop** | ✅ (fixed Phase J) | ✅ (already gated by governor) |
| **Recovery on startup** | ✅ `recoverStale()` | ❌ Always empty on startup |

These two queues are independent. An operator using the UI queues tasks in the in-memory system. The autonomousLoop only drains the disk queue. A user saying "schedule git status every 5 minutes" goes to the disk queue. These tasks are invisible to each other.

---

## Test Results (2026-05-15)

### T1 — Concurrent Async Updates
**Test:** 3 tasks added; all 3 updated concurrently via `Promise.all` at 5ms delay.

```
concurrent update t1 (completed): PASS
concurrent update t2 (failed):    PASS
concurrent update t3 (running):   PASS
```

**Result:** PASS under single-process Node.js event loop.

**Caveat:** `update()` does `_load() → modify → _save()`. Under high IO pressure where the same task is updated by two concurrent async callers within the same event loop tick, the second `_load()` may read stale state written by neither. Tested safe at 5ms delay but not under sustained concurrent load (100+ concurrent updates to the same task ID). Not a realistic scenario for this system.

---

### T2 — Duplicate Dispatch
**Test:** Same input (`'dup-check'`) added twice.

```
Result: CONFIRMED — queue has NO dedup protection
Two separate tasks created with different IDs
```

**Impact:** An operator double-clicking "send" or a retry loop queuing the same input creates duplicate executions. For terminal commands this is a nuisance; for payment sends or WhatsApp blasts it is a real problem.

**No fix applied** — dedup would require input hashing and a lookup before insert. Deferred to Phase K.

---

### T3 — `recoverStale()` (crash recovery)
**Test:** Task manually set to `running`, then `recoverStale()` called.

```
running → pending: PASS
```

**Confirmed:** Tasks stuck in `running` state (from a crash mid-execution) are reset to `pending` on startup. The execution log gets a `"recovered — was running on crash"` entry.

---

### T4 — `abandonStuckTasks(2h)`
**Test:** Task with `scheduledFor` set 3 hours in the past, status=`pending`.

```
abandonStuck old task: PASS (status → failed)
abandonStuck count: PASS (1 abandoned)
```

**Confirmed:** Tasks pending for more than 2 hours are moved to `failed` with `lastError: "Abandoned — stuck in pending for >2h"`. Recurring tasks are never abandoned (correct by design).

---

### T5 — Priority Queue Ordering
**Test:** Enqueued HIGH, NORMAL, LOW priority items. Dequeued first item.

```
First dequeued: task-a (HIGH priority)
Queue size after dequeue: 2 items remaining
```

**Confirmed:** Priority queue dequeues HIGH before NORMAL before LOW.

---

### T6 — Restart Simulation (In-Memory Queue)
**Manual verification:** The `priorityQueue.cjs` module holds state in a local variable (`_items = []`). On process restart this array is empty. There is no load-from-disk path.

```
After hypothetical restart: 0 items (lost)
Snapshot before restart would show: N items
```

**Impact:** Any tasks queued via the operator console between the last restart and the current restart are silently dropped. No error is shown to the operator. The UI shows an empty queue after restart.

---

### T7 — `pruneOldTasks(N)`
**Test:** Queue with mixed completed/failed/pending tasks; prune with keepCompleted=2.

```
After prune with 2: kept 6 items (2 completed/failed + active + recurring)
```

**Confirmed:** Prune keeps all pending/running tasks, all recurring tasks, and the N most recent completed/failed. No active work is lost.

---

### T8 — `deleteTask(id)`
**Test:** Task added then immediately deleted.

```
deleteTask: PASS (removed, not found in getAll())
```

---

### T9 — Dead-Letter Queue (In-Memory Path)
`agents/runtime/deadLetterQueue.cjs` exists and is exposed via `GET /runtime/dead-letter`. API verified accessible (behind `/runtime` auth gate).

For the **disk queue** there is no DLQ. Failed tasks remain in `task-queue.json` with `status: "failed"`. They are pruned by `pruneOldTasks()` after 50 completed/failed accumulate. There is no separate dead-letter view or retry mechanism for disk queue failures.

---

### T10 — Shutdown Race Condition
**Scenario:** Server receives SIGTERM while a disk queue task is in `running` state.

**Current behavior:**
1. SIGTERM → `_gracefulShutdown()` in `server.js`
2. `_autoLoopRef.stop()` called — clears the poll interval
3. HTTP server closed
4. 5-second drain timer fires, then `process.exit(0)`

**Gap:** If `_runTask()` is currently awaiting an async executor call, it will be cut off by the 5-second exit. The task stays in `running` state. On next startup, `recoverStale()` resets it to `pending` and it re-executes.

**Assessment:** This is safe for terminal/git commands (idempotent side effects). For payment sends or WhatsApp messages, a task that was 50% through could fire again on restart. This is the expected trade-off for disk-queue recovery; callers should be designed for at-least-once delivery.

---

## Known Gaps Summary

| Gap | Severity | Status |
|-----|----------|--------|
| No dedup protection in either queue | P2 | Open — deferred Phase K |
| In-memory priorityQueue lost on restart | P1 | Open — architectural; would require disk persistence |
| Two queue systems with no coordination | P2 | Open — architectural |
| No DLQ or retry UI for disk queue failures | P2 | Open |
| Concurrent async `update()` race under extreme load | P3 | Open — not realistic for single-operator deployment |
| Shutdown race: running task cut off at 5s drain | P3 | Acceptable — `recoverStale()` handles it on restart |
| Emergency state not persisted across restart | P2 | Open |

---

## Recommendations

**Short term (this sprint):**
- Add `JWT_SECRET` + `OPERATOR_PASSWORD_HASH` to `.env` so any manual queue testing via the operator console is possible.

**Phase K candidates:**
- Add simple dedup: hash of `(input + scheduledFor.slice(0,10))` checked before `addTask()` inserts.
- Persist priorityQueue to disk on enqueue (write to `data/runtime-queue.json`; load on startup).
- Add disk queue DLQ view to operator console.
- Extend drain timeout from 5s to 15s to reduce shutdown race window for slow tasks.
