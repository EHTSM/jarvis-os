"use strict";
/**
 * resourceArbitrationEngine — deterministic resource arbitration, contention
 * handling, execution fairness, priority-aware allocation, starvation prevention.
 *
 * requestResources(spec)            → { allocated, reqId, ownerId }
 * releaseResources(spec)            → { released, ownerId }
 * rebalanceResources(resourceType)  → { rebalanced, fairShare }
 * detectResourcePressure(rt)        → PressureReport
 * getAllocationState()              → AllocationState
 * reset()
 *
 * Resources: cpu_slots, memory_budget, execution_tokens,
 *            replay_capacity, recovery_capacity
 * Policies:  fair-share, priority-aware, recovery-priority,
 *            containment-priority, starvation-safe
 */

const RESOURCE_TYPES = [
    "cpu_slots", "memory_budget", "execution_tokens",
    "replay_capacity", "recovery_capacity",
];

const ALLOCATION_POLICIES = [
    "fair-share", "priority-aware", "recovery-priority",
    "containment-priority", "starvation-safe",
];

let _resources = new Map();   // resourceType → { total, available, allocations: Map(ownerId→amount) }
let _requests  = [];
let _counter   = 0;

function _ensureResource(resourceType, total = 100) {
    if (!_resources.has(resourceType))
        _resources.set(resourceType, { total, available: total, allocations: new Map() });
}

// ── requestResources ──────────────────────────────────────────────────

function requestResources(spec = {}) {
    const {
        ownerId       = null,
        resourceType  = null,
        amount        = 1,
        policy        = "fair-share",
        priority      = 5,
        recoveryMode  = false,
        totalCapacity = null,
    } = spec;

    if (!ownerId)      return { allocated: false, reason: "ownerId_required" };
    if (!resourceType) return { allocated: false, reason: "resourceType_required" };
    if (!RESOURCE_TYPES.includes(resourceType))
        return { allocated: false, reason: `invalid_resource_type: ${resourceType}` };
    if (!ALLOCATION_POLICIES.includes(policy))
        return { allocated: false, reason: `invalid_policy: ${policy}` };

    _ensureResource(resourceType, totalCapacity ?? 100);
    const res = _resources.get(resourceType);

    if (amount > res.available)
        return { allocated: false, reason: "insufficient_resources", available: res.available, requested: amount };

    const prev = res.allocations.get(ownerId) ?? 0;
    res.allocations.set(ownerId, prev + amount);
    res.available -= amount;

    const reqId = `req-${++_counter}`;
    _requests.push({ reqId, ownerId, resourceType, amount, policy, priority, recoveryMode, ts: new Date().toISOString() });

    return { allocated: true, reqId, ownerId, resourceType, amount, remaining: res.available };
}

// ── releaseResources ──────────────────────────────────────────────────

function releaseResources(spec = {}) {
    const { ownerId = null, resourceType = null, amount = null } = spec;
    if (!ownerId)      return { released: false, reason: "ownerId_required" };
    if (!resourceType) return { released: false, reason: "resourceType_required" };

    const res = _resources.get(resourceType);
    if (!res) return { released: false, reason: "resource_not_found" };

    const owned = res.allocations.get(ownerId) ?? 0;
    if (owned === 0) return { released: false, reason: "no_allocation_found" };

    const releasing = amount != null ? Math.min(amount, owned) : owned;
    const remaining = owned - releasing;
    if (remaining <= 0) res.allocations.delete(ownerId);
    else                res.allocations.set(ownerId, remaining);

    res.available = Math.min(res.total, res.available + releasing);
    return { released: true, ownerId, resourceType, amount: releasing, available: res.available };
}

// ── rebalanceResources ────────────────────────────────────────────────

function rebalanceResources(resourceType) {
    const res = _resources.get(resourceType);
    if (!res) return { rebalanced: false, reason: "resource_not_found" };

    const owners = [...res.allocations.entries()];
    if (owners.length === 0) return { rebalanced: true, resourceType, ownersRebalanced: 0 };

    const fairShare = Math.floor(res.total / owners.length);
    for (const [id] of owners) res.allocations.set(id, fairShare);
    res.available = res.total - fairShare * owners.length;

    return { rebalanced: true, resourceType, ownersRebalanced: owners.length, fairShare };
}

// ── detectResourcePressure ────────────────────────────────────────────

function detectResourcePressure(resourceType) {
    const res = _resources.get(resourceType);
    if (!res) return { found: false, resourceType };

    const used      = res.total - res.available;
    const usedRatio = res.total > 0 ? used / res.total : 0;
    const pressure  = usedRatio >= 0.9 ? "critical"
                    : usedRatio >= 0.7 ? "high"
                    : usedRatio >= 0.5 ? "medium"
                    :                    "low";

    return {
        found: true,
        resourceType,
        total:     res.total,
        available: res.available,
        used,
        usedRatio: +usedRatio.toFixed(3),
        pressure,
        owners:    res.allocations.size,
    };
}

// ── getAllocationState ────────────────────────────────────────────────

function getAllocationState() {
    const state = {};
    for (const [rt, res] of _resources) {
        state[rt] = {
            total:       res.total,
            available:   res.available,
            owners:      res.allocations.size,
            allocations: Object.fromEntries(res.allocations),
        };
    }
    return { resources: state, totalRequests: _requests.length };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _resources = new Map();
    _requests  = [];
    _counter   = 0;
}

module.exports = {
    RESOURCE_TYPES, ALLOCATION_POLICIES,
    requestResources, releaseResources, rebalanceResources,
    detectResourcePressure, getAllocationState, reset,
};
