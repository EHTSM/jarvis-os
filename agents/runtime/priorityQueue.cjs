"use strict";
/**
 * priorityQueue — in-memory task queue, sorted by priority then enqueue time.
 * Priorities: HIGH = 0, NORMAL = 1, LOW = 2 (lower number = higher priority).
 */

const PRIORITY = Object.freeze({ HIGH: 0, NORMAL: 1, LOW: 2 });

const _queue = [];  // [{task, priority, enqueuedAt, id}]
let   _seq   = 0;

/** Insert and maintain priority order. */
function enqueue(task, priority = PRIORITY.NORMAL) {
    const entry = {
        id:         ++_seq,
        task,
        priority:   typeof priority === "number" ? priority : PRIORITY.NORMAL,
        enqueuedAt: Date.now(),
    };
    // Binary insert to keep sorted
    let lo = 0, hi = _queue.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const m   = _queue[mid];
        if (m.priority < entry.priority || (m.priority === entry.priority && m.enqueuedAt <= entry.enqueuedAt)) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    _queue.splice(lo, 0, entry);
    return entry.id;
}

/** Remove and return highest-priority entry, or null if empty. */
function dequeue() {
    return _queue.shift() || null;
}

/** Peek without removing. */
function peek() {
    return _queue[0] || null;
}

/** Number of pending items. */
function size() { return _queue.length; }

/** @returns {object[]} shallow snapshot (highest priority first) */
function snapshot() {
    return _queue.map(e => ({
        id:         e.id,
        priority:   e.priority,
        enqueuedAt: e.enqueuedAt,
        waitMs:     Date.now() - e.enqueuedAt,
        taskType:   e.task?.type || "unknown",
    }));
}

/** Remove a specific entry by queue id. Returns true if found. */
function remove(id) {
    const idx = _queue.findIndex(e => e.id === id);
    if (idx === -1) return false;
    _queue.splice(idx, 1);
    return true;
}

module.exports = { enqueue, dequeue, peek, size, snapshot, remove, PRIORITY };
