"use strict";
/**
 * executionConcurrencyManager — concurrent workflow execution control, slot
 * allocation, concurrency isolation, and deterministic concurrency boundaries.
 *
 * acquireExecutionSlot(spec)     → { acquired, slotId, workflowId }
 * releaseExecutionSlot(slotId)   → { released, slotId }
 * getActiveExecutions(filter)    → SlotRecord[]
 * getConcurrencyState()          → ConcurrencyState
 * enforceConcurrencyLimits(spec) → { enforced, overflow, overflowCount }
 * reset()
 */

const DEFAULT_MAX_SLOTS = 32;

let _slots   = new Map();   // slotId → SlotRecord
let _domains = new Map();   // isolationDomain → { maxSlots, activeCount }
let _groups  = new Map();   // concurrencyGroup → Set<slotId>
let _counter = 0;

// ── acquireExecutionSlot ──────────────────────────────────────────────

function acquireExecutionSlot(spec = {}) {
    const {
        workflowId       = null,
        executionId      = null,
        isolationDomain  = "default",
        concurrencyGroup = null,
        priority         = 5,
        recoveryMode     = false,
        maxSlots         = null,
    } = spec;

    if (!workflowId) return { acquired: false, reason: "workflowId_required" };

    if (!_domains.has(isolationDomain))
        _domains.set(isolationDomain, { maxSlots: maxSlots ?? DEFAULT_MAX_SLOTS, activeCount: 0 });

    const domain = _domains.get(isolationDomain);

    if (domain.activeCount >= domain.maxSlots) {
        return {
            acquired: false,
            reason:   "slot_limit_reached",
            domain:   isolationDomain,
            active:   domain.activeCount,
            max:      domain.maxSlots,
        };
    }

    const slotId = `slot-${++_counter}`;
    _slots.set(slotId, {
        slotId,
        workflowId,
        executionId,
        isolationDomain,
        concurrencyGroup,
        priority,
        recoveryMode,
        status:     "active",
        acquiredAt: new Date().toISOString(),
    });
    domain.activeCount++;

    if (concurrencyGroup) {
        if (!_groups.has(concurrencyGroup)) _groups.set(concurrencyGroup, new Set());
        _groups.get(concurrencyGroup).add(slotId);
    }

    return { acquired: true, slotId, workflowId, isolationDomain };
}

// ── releaseExecutionSlot ──────────────────────────────────────────────

function releaseExecutionSlot(slotId) {
    const slot = _slots.get(slotId);
    if (!slot)                      return { released: false, reason: "slot_not_found" };
    if (slot.status === "released") return { released: false, reason: "slot_already_released" };

    slot.status = "released";
    const domain = _domains.get(slot.isolationDomain);
    if (domain) domain.activeCount = Math.max(0, domain.activeCount - 1);

    if (slot.concurrencyGroup) {
        const group = _groups.get(slot.concurrencyGroup);
        if (group) group.delete(slotId);
    }

    return { released: true, slotId, workflowId: slot.workflowId };
}

// ── getActiveExecutions ───────────────────────────────────────────────

function getActiveExecutions(filter = {}) {
    let result = [..._slots.values()].filter(s => s.status === "active");
    if (filter.isolationDomain  != null) result = result.filter(s => s.isolationDomain  === filter.isolationDomain);
    if (filter.concurrencyGroup != null) result = result.filter(s => s.concurrencyGroup === filter.concurrencyGroup);
    if (filter.recoveryMode     != null) result = result.filter(s => s.recoveryMode     === filter.recoveryMode);
    return result;
}

// ── getConcurrencyState ───────────────────────────────────────────────

function getConcurrencyState() {
    const active      = [..._slots.values()].filter(s => s.status === "active");
    const domainStats = {};
    for (const [id, dom] of _domains)
        domainStats[id] = { activeCount: dom.activeCount, maxSlots: dom.maxSlots };

    return {
        totalActiveSlots: active.length,
        totalSlots:       _slots.size,
        domains:          domainStats,
        groups:           Object.fromEntries([..._groups.entries()].map(([g, s]) => [g, s.size])),
    };
}

// ── enforceConcurrencyLimits ──────────────────────────────────────────

function enforceConcurrencyLimits(spec = {}) {
    const { isolationDomain = "default", maxSlots = null } = spec;
    const domain = _domains.get(isolationDomain);
    if (!domain) return { enforced: false, reason: "domain_not_found" };

    if (maxSlots != null) domain.maxSlots = maxSlots;

    const overflow = domain.activeCount > domain.maxSlots;
    return {
        enforced:      true,
        isolationDomain,
        activeCount:   domain.activeCount,
        maxSlots:      domain.maxSlots,
        overflow,
        overflowCount: overflow ? domain.activeCount - domain.maxSlots : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _slots   = new Map();
    _domains = new Map();
    _groups  = new Map();
    _counter = 0;
}

module.exports = {
    acquireExecutionSlot, releaseExecutionSlot,
    getActiveExecutions, getConcurrencyState,
    enforceConcurrencyLimits, reset,
};
