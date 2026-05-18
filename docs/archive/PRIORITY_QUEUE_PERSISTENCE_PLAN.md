> [!WARNING]
> ARCHIVED / LEGACY / NOT ACTIVE PRODUCTION RUNTIME
> This document describes historical or experimental architecture that is not part of the active Jarvis production core.

# PRIORITY QUEUE PERSISTENCE PLAN
Phase K — Design Document (No Implementation)  
Date: 2026-05-16

---

## Current State

There are two separate queue systems in this codebase. This document covers only the **priority queue** used by `runtimeOrchestrator`.

### Queue 1: `agents/taskQueue.cjs` (disk-backed)
- Used by `agents/autonomousLoop.cjs`
- Persists to `data/tasks.json` with atomic rename (`tmp → final`)
- Already survives server restarts
- **Not in scope for this document**

### Queue 2: `agents/runtime/priorityQueue.cjs` (in-memory)
- Used by `agents/runtime/runtimeOrchestrator.cjs`
- `pq.enqueue({ input }, priority)` → returns integer id
- Priority levels: CRITICAL=0, HIGH=1, NORMAL=2, LOW=3
- Drains via `_ensureDrainLoop()` — runs `setInterval` that pops and dispatches
- **Lives entirely in process memory — all queued tasks are lost on server restart**
- **This is what this plan addresses**

---

## Problem Statement

If the server crashes or restarts while tasks are queued:
- All in-memory priority queue entries are lost with no record
- The operator has no visibility into what was dropped
- Queued tasks submitted via `POST /runtime/queue` with `priority: CRITICAL` (e.g., stop a runaway automation) could be silently dropped

Severity: **Medium** for the current operator-tool use case (single server, single operator). Would become High if multiple users or multi-server deployment.

---

## Design Goals

1. Tasks queued via `POST /runtime/queue` survive a server restart
2. Recovery is safe — no duplicate execution of tasks that already ran
3. Corruption in the persistence file does not prevent server startup
4. The drain loop behavior is unchanged — persistence is a write-through layer
5. No new dependencies — use only Node.js built-ins (fs, crypto)
6. No behavioral changes to the current API surface

---

## Design: Write-Through Disk Journal

### File: `data/priority-queue.json`

Format:
```json
[
  {
    "id": 7,
    "input": "git status",
    "priority": 1,
    "enqueuedAt": "2026-05-16T18:00:00.000Z",
    "status": "pending"
  }
]
```

### Lifecycle

**On `enqueue(task, priority)`:**
1. Assign id (current in-memory counter)
2. Add entry to in-memory heap (existing behavior)
3. Append to `data/priority-queue.json` with `status: "pending"` — **atomic write** (write to `.tmp`, rename)

**On `dequeue()` (task picked up by drain loop):**
1. Return top-priority item from heap (existing behavior)
2. Update its record in `data/priority-queue.json` to `status: "running"` — **atomic write**

**On task completion (success or failure):**
1. Remove entry from `data/priority-queue.json` — **atomic write**
2. If failed: write to dead-letter queue (existing behavior — `runtimeDeadLetterQueue.cjs`)

**On server startup:**
1. Read `data/priority-queue.json`
2. If parse fails: log warning, start with empty queue (do not crash)
3. Filter entries with `status: "pending"` — re-enqueue these into the in-memory heap
4. Filter entries with `status: "running"` — these were in-flight when the server died:
   - Move to dead-letter with `error: "server-restart-in-flight"` and `attempts: 0`
   - Do NOT re-execute — we don't know if they completed or not
5. Clear `data/priority-queue.json` to remove all recovered entries (they are now either re-queued or dead-lettered)

---

## Atomic Write Pattern

All writes to `data/priority-queue.json` must use atomic rename to prevent corruption:

```js
const tmp = QUEUE_FILE + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), "utf8");
fs.renameSync(tmp, QUEUE_FILE);
```

This is the same pattern already used by `agents/taskQueue.cjs`.

---

## Recovery / Replay / Corruption Semantics

| Scenario | Behavior |
|----------|----------|
| File missing | Start with empty queue — normal first-run |
| File empty | Start with empty queue — valid state |
| File contains valid JSON, all `pending` | Re-enqueue all — normal recovery |
| File contains valid JSON, some `running` | `running` → dead-letter; `pending` → re-enqueue |
| File parse error (corrupted) | Log warning, start empty — never crash |
| File exists but cannot be read (permissions) | Log error, start empty |
| Rename fails during write | Old file unchanged — safe; log error |
| Task re-enqueued from recovery, runs again | Expected behavior for `pending` tasks |
| Task was `running` at crash re-enqueued | NOT allowed — moved to dead-letter instead |
| Duplicate IDs after recovery (id counter reset) | Use max(recovered_ids) + 1 as starting counter |

---

## Files to Modify

| File | Change |
|------|--------|
| `agents/runtime/priorityQueue.cjs` | Add `_persist()`, `_loadFromDisk()`, call on enqueue/dequeue/complete |
| `agents/runtime/runtimeOrchestrator.cjs` | Call `pq.loadFromDisk()` at module init; pass completion signal to pq after task finishes |
| `agents/runtime/bootstrapRuntime.cjs` | No change needed — orchestrator init happens before agents register |

**New file:** `data/priority-queue.json` (created on first enqueue, gitignored)

**Add to `.gitignore`:**
```
data/priority-queue.json
data/priority-queue.json.tmp
```

---

## What This Does NOT Cover

- Ordered replay of tasks across restarts (priority order is restored from file, not original submission order)
- Multi-process or distributed queue (single server only)
- Queue encryption at rest
- Task deduplication (same input, same priority can be enqueued multiple times)
- Persistent task IDs visible to external callers across restarts (id counter resets)

These are not needed for the current single-operator deployment.

---

## Implementation Estimate

- `priorityQueue.cjs`: ~40 lines (persist/load/update methods)
- `runtimeOrchestrator.cjs`: ~10 lines (init call, completion signal)
- Testing: existing regression tests cover the queue path; add startup-recovery test

**Total effort:** 2–3 hours to implement, test, and verify crash recovery.

---

## Decision: Implement Now or Later?

**Recommendation: Later.**

The current failure mode (queue loss on restart) only matters if the server crashes mid-operation with pending tasks. For a single-operator internal tool that is intentionally restarted, this is an acceptable risk. The disk-backed `taskQueue.cjs` (used by autonomousLoop) already covers background task persistence.

Implement this before any of:
- Server restarts become unpredictable (deploy automation, process managers)
- Multiple operators or scheduled queue consumers are added
- Tasks queued via `/runtime/queue` carry any time-critical semantics
