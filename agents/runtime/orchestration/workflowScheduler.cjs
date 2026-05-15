"use strict";
/**
 * workflowScheduler — priority queue with dependency-aware, starvation-safe scheduling.
 *
 * enqueue(plan, opts?)     → QueueEntry
 * dequeue(readyDeps?)      → QueueEntry | null
 * peek()                   → QueueEntry | null
 * getQueue()               → QueueEntry[]
 * hasPending()             → boolean
 * checkStarvation(nowMs?)  → StarvationReport
 * promote(taskId, delta?)  → boolean
 * reset()
 */

let _queue   = [];
let _seq     = 0;
const DEFAULT_STARVATION_MS = 30000;

// ── enqueue ───────────────────────────────────────────────────────────

function enqueue(plan, opts = {}) {
    const entry = {
        id:           `sq-${++_seq}`,
        taskId:       plan.taskId ?? plan.id ?? `task-${_seq}`,
        plan,
        priority:     Math.max(0, Math.min(100, opts.priority ?? 50)),
        critical:     opts.critical ?? false,
        deps:         opts.deps ?? (plan.deps ?? []),
        enqueuedAt:   Date.now(),
        enqueuedAtTs: new Date().toISOString(),
        attempts:     0,
    };
    _queue.push(entry);
    _sort();
    return entry;
}

// ── dequeue ───────────────────────────────────────────────────────────

function dequeue(readyDeps = null) {
    if (_queue.length === 0) return null;

    // Find highest-priority entry whose deps are satisfied
    for (let i = 0; i < _queue.length; i++) {
        const entry = _queue[i];
        if (_depsReady(entry.deps, readyDeps)) {
            _queue.splice(i, 1);
            entry.dequeuedAt   = Date.now();
            entry.waitMs       = entry.dequeuedAt - entry.enqueuedAt;
            return entry;
        }
    }
    return null;  // all entries are dep-blocked
}

// ── peek ──────────────────────────────────────────────────────────────

function peek(readyDeps = null) {
    for (const entry of _queue) {
        if (_depsReady(entry.deps, readyDeps)) return entry;
    }
    return null;
}

// ── starvation check ──────────────────────────────────────────────────

function checkStarvation(nowMs = Date.now(), thresholdMs = DEFAULT_STARVATION_MS) {
    const starved = _queue.filter(e => (nowMs - e.enqueuedAt) > thresholdMs);
    return {
        detected: starved.length > 0,
        count:    starved.length,
        entries:  starved.map(e => ({
            id:       e.id,
            taskId:   e.taskId,
            waitMs:   nowMs - e.enqueuedAt,
            priority: e.priority,
        })),
    };
}

// ── promote ───────────────────────────────────────────────────────────

function promote(taskId, delta = 10) {
    const entry = _queue.find(e => e.taskId === taskId || e.id === taskId);
    if (!entry) return false;
    entry.priority = Math.min(100, entry.priority + delta);
    _sort();
    return true;
}

// ── helpers ───────────────────────────────────────────────────────────

function _sort() {
    _queue.sort((a, b) => {
        // Critical tasks first, then by priority desc, then by enqueue time asc
        if (a.critical !== b.critical) return a.critical ? -1 : 1;
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.enqueuedAt - b.enqueuedAt;
    });
}

function _depsReady(deps, readyDeps) {
    if (!deps || deps.length === 0) return true;
    if (!readyDeps) return true;   // no dep info provided → assume ready
    const ready = new Set(Array.isArray(readyDeps) ? readyDeps : Object.keys(readyDeps));
    return deps.every(d => ready.has(d));
}

function getQueue()   { return [..._queue]; }
function hasPending() { return _queue.length > 0; }
function size()       { return _queue.length; }
function reset()      { _queue = []; _seq = 0; }

module.exports = { enqueue, dequeue, peek, getQueue, hasPending, size, checkStarvation, promote, reset };
