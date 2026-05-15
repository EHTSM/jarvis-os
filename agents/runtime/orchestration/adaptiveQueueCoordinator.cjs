"use strict";
/**
 * adaptiveQueueCoordinator — multi-queue coordinator with adaptive routing,
 * bounded capacity, and per-queue health monitoring.
 *
 * enqueue(spec)                  → { enqueued, itemId, queueName, position }
 * dequeue(queueName?)            → QueueItem | null
 * peek(queueName?)               → QueueItem | null
 * requeue(spec)                  → { requeued, itemId, queueName }
 * getQueueDepth(queueName?)      → number
 * getQueueHealth()               → QueueHealthReport
 * purgeQueue(queueName)          → { purged, count }
 * getCoordinatorMetrics()        → CoordinatorMetrics
 * reset()
 *
 * Queues: default, priority, recovery, retry
 * Routing: emergency/critical → priority; recovery → recovery; retry → retry; else → default
 * MAX_QUEUE_SIZE = 1000 per queue (configurable)
 */

const QUEUE_NAMES    = ["default", "priority", "recovery", "retry"];
const MAX_QUEUE_SIZE = 1000;
const OVERFLOW_WARN  = 0.8;   // warn at 80% capacity

let _queues   = _initQueues();
let _counter  = 0;
let _total    = 0;
let _dropped  = 0;

function _initQueues() {
    const q = {};
    for (const n of QUEUE_NAMES) q[n] = [];
    return q;
}

function _routeQueue(spec) {
    const { priorityClass = "normal", recovery = false, retryCount = 0 } = spec;
    if (recovery)                                                    return "recovery";
    if (retryCount > 0)                                              return "retry";
    if (priorityClass === "emergency" || priorityClass === "critical") return "priority";
    return "default";
}

// ── enqueue ────────────────────────────────────────────────────────────

function enqueue(spec = {}) {
    const {
        executionId    = null,
        workflowId     = null,
        subsystem      = null,
        priorityScore  = 50,
        priorityClass  = "normal",
        recovery       = false,
        retryCount     = 0,
        authorityLevel = "operator",
        adapterType    = null,
        capability     = null,
        payload        = null,
        enqueuedAt     = new Date().toISOString(),
    } = spec;

    if (!executionId) return { enqueued: false, reason: "executionId_required" };

    const queueName = _routeQueue({ priorityClass, recovery, retryCount });
    const queue     = _queues[queueName];

    if (queue.length >= MAX_QUEUE_SIZE) {
        _dropped++;
        return { enqueued: false, reason: "queue_full", queueName, depth: queue.length };
    }

    const itemId = `qi-${++_counter}`;
    const item   = Object.freeze({
        itemId, executionId, workflowId: workflowId ?? null,
        subsystem: subsystem ?? null, adapterType: adapterType ?? null,
        capability: capability ?? null, payload: payload ? Object.freeze({ ...payload }) : null,
        priorityScore, priorityClass, recovery, retryCount,
        authorityLevel, enqueuedAt, queueName,
    });

    // Insert in priority order (highest score first)
    let inserted = false;
    for (let i = 0; i < queue.length; i++) {
        if (item.priorityScore > queue[i].priorityScore) {
            queue.splice(i, 0, item);
            inserted = true;
            break;
        }
    }
    if (!inserted) queue.push(item);

    _total++;
    return { enqueued: true, itemId, queueName, position: queue.indexOf(item) };
}

// ── dequeue ────────────────────────────────────────────────────────────

function dequeue(queueName = null) {
    if (queueName) {
        if (!QUEUE_NAMES.includes(queueName)) return null;
        return _queues[queueName].shift() ?? null;
    }
    // Priority order: priority → recovery → retry → default
    for (const name of ["priority", "recovery", "retry", "default"]) {
        if (_queues[name].length > 0) return _queues[name].shift();
    }
    return null;
}

// ── peek ───────────────────────────────────────────────────────────────

function peek(queueName = null) {
    if (queueName) {
        if (!QUEUE_NAMES.includes(queueName)) return null;
        return _queues[queueName][0] ?? null;
    }
    for (const name of ["priority", "recovery", "retry", "default"]) {
        if (_queues[name].length > 0) return _queues[name][0];
    }
    return null;
}

// ── requeue ────────────────────────────────────────────────────────────

function requeue(spec = {}) {
    const { item = null, forcePriorityClass = null } = spec;
    if (!item) return { requeued: false, reason: "item_required" };
    const updated = forcePriorityClass ? { ...item, priorityClass: forcePriorityClass } : item;
    const r = enqueue(updated);
    return r.enqueued
        ? { requeued: true, itemId: r.itemId, queueName: r.queueName }
        : { requeued: false, reason: r.reason };
}

// ── getQueueDepth ──────────────────────────────────────────────────────

function getQueueDepth(queueName = null) {
    if (queueName) return _queues[queueName]?.length ?? 0;
    return QUEUE_NAMES.reduce((s, n) => s + _queues[n].length, 0);
}

// ── getQueueHealth ─────────────────────────────────────────────────────

function getQueueHealth() {
    const report = {};
    for (const name of QUEUE_NAMES) {
        const depth      = _queues[name].length;
        const utilization = depth / MAX_QUEUE_SIZE;
        const state      = utilization >= 1.0 ? "full"
            : utilization >= OVERFLOW_WARN ? "warning"
            : "healthy";
        report[name] = { depth, capacity: MAX_QUEUE_SIZE, utilization: Math.round(utilization * 1000) / 1000, state };
    }
    return report;
}

// ── purgeQueue ─────────────────────────────────────────────────────────

function purgeQueue(queueName) {
    if (!QUEUE_NAMES.includes(queueName))
        return { purged: false, reason: `unknown_queue: ${queueName}` };
    const count = _queues[queueName].length;
    _queues[queueName] = [];
    return { purged: true, queueName, count };
}

// ── getCoordinatorMetrics ──────────────────────────────────────────────

function getCoordinatorMetrics() {
    const depths = {};
    for (const n of QUEUE_NAMES) depths[n] = _queues[n].length;
    return {
        totalEnqueued:  _total,
        droppedCount:   _dropped,
        currentDepth:   getQueueDepth(),
        byQueue:        depths,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _queues   = _initQueues();
    _counter  = 0;
    _total    = 0;
    _dropped  = 0;
}

module.exports = {
    QUEUE_NAMES, MAX_QUEUE_SIZE,
    enqueue, dequeue, peek, requeue,
    getQueueDepth, getQueueHealth, purgeQueue,
    getCoordinatorMetrics, reset,
};
