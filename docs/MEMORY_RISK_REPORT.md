# MEMORY_RISK_REPORT.md

**Audit Date:** 2026-05-15

---

## Risk Summary

| Risk | Severity | Category |
|------|----------|----------|
| `data/memory-store.json` unbounded growth | **CRITICAL** | Disk |
| `data/workflow-checkpoints/` 908 dirs growing | **CRITICAL** | Disk |
| `data/memory-index.json` unbounded growth | **HIGH** | Disk |
| `data/learning.json` unbounded growth | **HIGH** | Disk |
| `data/audit.log` no rotation | **HIGH** | Disk |
| `data/workflow-trust.json` unbounded growth | **MEDIUM** | Disk |
| `data/learning-patterns.json` unbounded growth | **MEDIUM** | Disk |
| `autonomousLoop._failureTracker` Map unbounded | **MEDIUM** | Heap |
| `contextEngine` disk write on every execution | **MEDIUM** | Disk I/O |
| `runtimeEventBus._eventTimes` sliding window | LOW | Heap |

---

## CRITICAL: Disk Growth Without Bounds

### `data/memory-store.json` (131KB current, growing)

**Source:** `contextEngine.cjs:addConversation()` writes every task execution to disk  
**Cap in code:** In-memory `maxHistorySize = 10` entries, BUT disk write uses `DISK_MAX = 50`  
**Problem:** Every `autonomousLoop` task execution, every `/jarvis` call, and every `/runtime/dispatch` call calls `memory.recordExecution()` → `contextEngine.addConversation()` → disk write  
**Growth rate:** ~2-5KB per execution. At 100 tasks/day → ~500KB/week  
**Fix:**
```javascript
// In contextEngine.cjs, cap the disk entries more aggressively:
const DISK_MAX = 50; // currently
// → Reduce to 20, and add a TTL (e.g., entries older than 7 days are pruned)
```

### `data/memory-index.json` (141KB current, growing)

**Source:** Likely a lookup index for `memory-store.json` entries  
**Problem:** Same growth rate as memory-store; no pruning found  
**Fix:** Prune in sync with memory-store pruning

### `data/workflow-checkpoints/` (3.5MB, 908 dirs, growing)

**Source:** `agents/runtime/checkpointManager.cjs` — NOT wired in production, but dev/test runs created 908 checkpoint directories  
**Problem:** No garbage collection, no TTL, no pruning script  
**Immediate action:** These are safe to delete entirely (checkpointManager is unreachable from production)  
**Fix:**
```bash
rm -rf data/workflow-checkpoints/*
```
Then add a note: checkpoint directories are created by dev tools only, never in production.

---

## HIGH: Log & Learning File Growth

### `data/audit.log` (48KB, no rotation)

**Source:** `agents/runtime/security/auditLog.cjs` — but wait, this module is unreachable. The log may be written by `backend/utils/logger.js` or a different path.  
**Problem:** Plain text log, no size limit, no rotation  
**Fix:** Add log rotation (rotate at 10MB, keep 3 files) or use a structured log sink that auto-rotates.

### `data/learning.json` (53KB, growing)

**Source:** Likely `agents/learningSystem.cjs` or `agents/runtime/learningLoop.cjs` — both are unreachable. May also be written by `contextEngine` indirectly.  
**Problem:** Grows indefinitely; no pruning found in any reachable code  
**Fix:** Add age-based pruning (entries > 30 days deleted) on startup.

### `data/workflow-trust.json` (36KB, growing)

**Source:** `agents/runtime/trustScorer.cjs` — unreachable from production  
**Problem:** File grows but the module writing it is never called  
**Observation:** This file is probably a leftover from previous architecture iterations  
**Fix:** If `trustScorer.cjs` is deleted (as recommended in DEAD_CODE_REPORT), delete this file and stop writing it.

---

## MEDIUM: Heap Accumulation Risks

### `autonomousLoop._failureTracker` — Map with no eviction

**Source:** `agents/autonomousLoop.cjs:_failureTracker`  
**Type:** `Map<string, {count, lastError, lastTs}>`  
**Keys:** First 40 chars of every failing task input  
**Problem:** No eviction. If inputs are highly variable (e.g., user prompts), this Map grows by one entry per unique failing prefix.  
**Bounded by:** In practice, unique failing inputs are limited. Risk is low but measurable over weeks.  
**Fix:**
```javascript
// Add eviction when map exceeds cap:
const MAX_FAILURE_KEYS = 200;
// After setting:
if (_failureTracker.size > MAX_FAILURE_KEYS) {
    const oldest = _failureTracker.keys().next().value;
    _failureTracker.delete(oldest);
}
```

### `autonomousLoop._typeStats` — Map with no eviction

**Source:** `agents/autonomousLoop.cjs:_typeStats`  
**Type:** `Map<string, {count, totalMs, failures}>`  
**Keys:** Task type strings  
**Problem:** Grows with unique task types. In practice there are <20 task types, so this is bounded. Safe as-is.

### `autonomousLoop._cronJobs` — Map of cron tasks

**Source:** `agents/autonomousLoop.cjs:_cronJobs`  
**Type:** `Map<taskId, ScheduledTask>`  
**Cleanup:** Entries deleted when task is cancelled/failed  
**Risk:** If a task is deleted from the queue file externally (e.g., manual edit), the cron job persists until process restart. Low risk, existing stop() guard helps.

---

## LOW: Acceptable Bounded Structures

These structures are properly bounded and do not pose memory risks:

| Structure | Location | Bound | Eviction |
|-----------|----------|-------|---------|
| `executionHistory` ring buffer | `executionHistory.cjs` | 500 entries | Circular overwrite |
| `runtimeEventBus._ring` | `runtimeEventBus.cjs` | 500 events | `shift()` on overflow |
| `runtimeEventBus._eventTimes` | `runtimeEventBus.cjs` | 60s sliding window | `shift()` on TTL |
| `runtimeEventBus._subscribers` | `runtimeEventBus.cjs` | 20 max | `delete()` on error |
| `runtimeStream._active` | `runtimeStream.cjs` | 10 max SSE | Decremented on close |
| `errorTracker` | `backend/utils/errorTracker.js` | Ring buffer | Circular |
| `memoryTracker.samples` | `backend/utils/memoryTracker.js` | Fixed samples | Fixed |
| `autonomousLoop._slowTasks` | `autonomousLoop.cjs` | 20 max | `shift()` |
| `autonomousLoop._execTimings` | `autonomousLoop.cjs` | 100 max | `shift()` |
| `priorityQueue` | `agents/runtime/priorityQueue.cjs` | In-memory only | Drained on execute |
| Telegram `userState` | `backend/server.js` | 500 max | Evict oldest on overflow |

---

## Process Memory Baseline

Based on `memoryTracker` samples and `backend/routes/ops.js` warnings:

| Level | Heap MB | Action |
|-------|---------|--------|
| Normal | <350MB | Green |
| Warning | 350-450MB | `MEMORY_HIGH` warning in /ops |
| Critical | >450MB | `MEMORY_CRITICAL` warning in /ops |

The 323 dead modules do NOT contribute to heap since they are never required. Node.js only allocates module memory when `require()` is called. **The dead modules are a disk/maintenance problem, not a heap problem.**

The actual heap consumers are:
1. `executor.cjs` (152KB source → moderate parsed AST in V8)
2. `contextEngine` conversation history (capped at 10 in-memory)
3. All active Express route handlers
4. Groq/Axios HTTP client buffers
5. Event bus ring buffers (two × 500 entries × ~500B/entry ≈ 500KB total — acceptable)

---

## Recommended Immediate Actions

```bash
# 1. Delete all workflow checkpoints (safe — module is unreachable)
rm -rf data/workflow-checkpoints/*

# 2. Truncate large learning files (they are written by unreachable modules)
echo "[]" > data/learning.json
echo "[]" > data/learning-patterns.json  
echo "{}" > data/workflow-trust.json

# 3. Cap memory-store and memory-index on next startup
# (code change in contextEngine.cjs — reduce DISK_MAX from 50 to 20,
#  prune entries older than 7 days in ContextEngine constructor)
```
