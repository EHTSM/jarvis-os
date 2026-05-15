"use strict";
/**
 * deadlockDetectionEngine — deadlock graph analysis, circular wait detection,
 * blocked dependency detection, and deterministic deadlock resolution.
 *
 * analyzeWaitGraph(spec)               → { graphId, hasCycles, cycles, nodeCount }
 * detectDeadlocks()                    → { deadlocksFound, deadlockCount, cycles }
 * resolveDeadlock(spec)                → { resolved, resId, removedNodes }
 * getBlockedExecutions()               → BlockedRecord[]
 * validateLockSafety(spec)             → { safe, lockId, deadlockRisk }
 * registerStalledExecution(id, reason) → void
 * reset()
 *
 * Detects: circular waits, orphaned locks, stalled workflows,
 *          unreleased resources, infinite blocking chains.
 */

let _waitGraph         = new Map();   // execId → Set<execId it's waiting for>
let _locks             = new Map();   // lockId → { holder, waiters[] }
let _stalled           = new Map();   // execId → { reason, stalledSince }
let _resolvedDeadlocks = [];
let _counter           = 0;

// ── internal helpers ──────────────────────────────────────────────────

function _addWait(waiterId, waitingFor) {
    if (!_waitGraph.has(waiterId)) _waitGraph.set(waiterId, new Set());
    _waitGraph.get(waiterId).add(waitingFor);
}

function _findAllCycles() {
    const cycles  = [];
    const visited = new Set();
    const inStack = new Set();
    const stack   = [];

    function dfs(node) {
        visited.add(node);
        stack.push(node);
        inStack.add(node);

        const neighbors = _waitGraph.get(node) ?? new Set();
        for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
                dfs(neighbor);
            } else if (inStack.has(neighbor)) {
                const cycleStart = stack.indexOf(neighbor);
                cycles.push(stack.slice(cycleStart));
            }
        }

        stack.pop();
        inStack.delete(node);
    }

    for (const node of _waitGraph.keys()) {
        if (!visited.has(node)) dfs(node);
    }
    return cycles;
}

// ── analyzeWaitGraph ──────────────────────────────────────────────────

function analyzeWaitGraph(spec = {}) {
    const { waits = [] } = spec;
    for (const w of waits) {
        if (w.waiterId && w.waitingFor) _addWait(w.waiterId, w.waitingFor);
    }

    const graphId   = `wg-${++_counter}`;
    const cycles    = _findAllCycles();
    const edgeCount = [..._waitGraph.values()].reduce((s, v) => s + v.size, 0);

    return {
        graphId,
        nodeCount:  _waitGraph.size,
        edgeCount,
        hasCycles:  cycles.length > 0,
        cycles,
    };
}

// ── detectDeadlocks ───────────────────────────────────────────────────

function detectDeadlocks() {
    const cycles = _findAllCycles();

    const orphanedLocks = [];
    for (const [lockId, lock] of _locks) {
        if (lock.waiters.length > 0 && lock.holder && !_waitGraph.has(lock.holder))
            orphanedLocks.push(lockId);
    }

    return {
        deadlocksFound:   cycles.length > 0,
        deadlockCount:    cycles.length,
        cycles,
        orphanedLocks,
        stalledWorkflows: _stalled.size,
    };
}

// ── resolveDeadlock ───────────────────────────────────────────────────

function resolveDeadlock(spec = {}) {
    const { cycle = [], strategy = "abort_lowest_priority" } = spec;
    if (!cycle.length) return { resolved: false, reason: "no_cycle_provided" };

    for (const node of cycle) {
        _waitGraph.delete(node);
        for (const waitSet of _waitGraph.values()) waitSet.delete(node);
    }

    const resId = `dres-${++_counter}`;
    _resolvedDeadlocks.push({ resId, cycle: [...cycle], strategy, resolvedAt: new Date().toISOString() });
    return { resolved: true, resId, strategy, removedNodes: cycle.length };
}

// ── getBlockedExecutions ──────────────────────────────────────────────

function getBlockedExecutions() {
    const blocked = [];
    for (const [execId, waitsFor] of _waitGraph) {
        if (waitsFor.size > 0)
            blocked.push({ executionId: execId, waitingFor: [...waitsFor] });
    }
    for (const [execId, info] of _stalled) {
        if (!blocked.find(b => b.executionId === execId))
            blocked.push({ executionId: execId, stalledReason: info.reason, stalledSince: info.stalledSince });
    }
    return blocked;
}

// ── validateLockSafety ────────────────────────────────────────────────

function validateLockSafety(spec = {}) {
    const { lockId = null, holderId = null, requiredBy = [] } = spec;
    if (!lockId) return { safe: false, reason: "lockId_required" };

    // Deadlock risk check applies to both new and existing locks:
    // if holderId already waits for any requiredBy node, adding the reverse
    // edge (requiredBy → holderId) would create a cycle.
    const holderWaits   = holderId ? (_waitGraph.get(holderId) ?? new Set()) : new Set();
    const wouldDeadlock = requiredBy.some(r => holderWaits.has(r));

    if (!_locks.has(lockId)) {
        _locks.set(lockId, { holder: holderId, waiters: [...requiredBy] });
        if (holderId && requiredBy.length > 0) {
            for (const r of requiredBy) _addWait(r, holderId);
        }
        return {
            safe:         !wouldDeadlock,
            lockId,
            holder:       holderId,
            waiters:      requiredBy.length,
            deadlockRisk: wouldDeadlock,
        };
    }

    const lock = _locks.get(lockId);
    for (const r of requiredBy) {
        if (!lock.waiters.includes(r)) lock.waiters.push(r);
        if (holderId) _addWait(r, holderId);
    }

    return {
        safe:         !wouldDeadlock,
        lockId,
        holder:       lock.holder,
        waiters:      lock.waiters.length,
        deadlockRisk: wouldDeadlock,
    };
}

// ── registerStalledExecution ──────────────────────────────────────────

function registerStalledExecution(execId, reason = "unknown") {
    _stalled.set(execId, { reason, stalledSince: new Date().toISOString() });
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _waitGraph         = new Map();
    _locks             = new Map();
    _stalled           = new Map();
    _resolvedDeadlocks = [];
    _counter           = 0;
}

module.exports = {
    analyzeWaitGraph, detectDeadlocks, resolveDeadlock,
    getBlockedExecutions, validateLockSafety, registerStalledExecution, reset,
};
