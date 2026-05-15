"use strict";
/**
 * executionConcurrencyManager — semaphore-based concurrency control.
 * Enforces per-adapter, per-subsystem, and global concurrency limits.
 *
 * configure(spec)                → { configured }
 * acquire(spec)                  → { acquired, slotId } | { acquired: false, reason }
 * release(slotId)                → { released, slotId }
 * getConcurrencyState()          → ConcurrencyState
 * isAdmitted(spec)               → { admitted, reason }
 * getConcurrencyMetrics()        → ConcurrencyMetrics
 * reset()
 *
 * Default limits: global=50, per-adapter=10, per-subsystem=20
 */

const DEFAULT_LIMITS = {
    global:       50,
    perAdapter:   10,
    perSubsystem: 20,
};

let _limits    = { ...DEFAULT_LIMITS };
let _slots     = new Map();    // slotId → SlotRecord
let _counter   = 0;
let _acquired  = 0;
let _rejected  = 0;

function _activeCount(filter = {}) {
    let count = 0;
    for (const s of _slots.values()) {
        if (s.released) continue;
        if (filter.adapterType  && s.adapterType  !== filter.adapterType)  continue;
        if (filter.subsystem    && s.subsystem    !== filter.subsystem)    continue;
        count++;
    }
    return count;
}

// ── configure ─────────────────────────────────────────────────────────

function configure(spec = {}) {
    if (spec.global       !== undefined && spec.global       > 0) _limits.global       = spec.global;
    if (spec.perAdapter   !== undefined && spec.perAdapter   > 0) _limits.perAdapter   = spec.perAdapter;
    if (spec.perSubsystem !== undefined && spec.perSubsystem > 0) _limits.perSubsystem = spec.perSubsystem;
    return { configured: true, limits: { ..._limits } };
}

// ── isAdmitted ─────────────────────────────────────────────────────────

function isAdmitted(spec = {}) {
    const { adapterType = null, subsystem = null } = spec;

    const globalActive = _activeCount();
    if (globalActive >= _limits.global)
        return { admitted: false, reason: "global_limit_reached", active: globalActive, limit: _limits.global };

    if (adapterType) {
        const adActive = _activeCount({ adapterType });
        if (adActive >= _limits.perAdapter)
            return { admitted: false, reason: "adapter_limit_reached", adapterType, active: adActive, limit: _limits.perAdapter };
    }

    if (subsystem) {
        const ssActive = _activeCount({ subsystem });
        if (ssActive >= _limits.perSubsystem)
            return { admitted: false, reason: "subsystem_limit_reached", subsystem, active: ssActive, limit: _limits.perSubsystem };
    }

    return { admitted: true };
}

// ── acquire ────────────────────────────────────────────────────────────

function acquire(spec = {}) {
    const {
        executionId    = null,
        adapterType    = null,
        subsystem      = null,
        authorityLevel = null,
        workflowId     = null,
    } = spec;

    if (!executionId) return { acquired: false, reason: "executionId_required" };

    const check = isAdmitted({ adapterType, subsystem });
    if (!check.admitted) {
        _rejected++;
        return { acquired: false, reason: check.reason, active: check.active, limit: check.limit };
    }

    const slotId = `slot-${++_counter}`;
    _slots.set(slotId, {
        slotId, executionId,
        adapterType:    adapterType    ?? null,
        subsystem:      subsystem      ?? null,
        authorityLevel: authorityLevel ?? null,
        workflowId:     workflowId     ?? null,
        acquiredAt:     new Date().toISOString(),
        released:       false,
    });

    _acquired++;
    return { acquired: true, slotId, executionId };
}

// ── release ────────────────────────────────────────────────────────────

function release(slotId) {
    if (!slotId) return { released: false, reason: "slotId_required" };
    const slot = _slots.get(slotId);
    if (!slot)  return { released: false, reason: "slot_not_found", slotId };
    if (slot.released) return { released: false, reason: "slot_already_released", slotId };

    slot.released   = true;
    slot.releasedAt = new Date().toISOString();

    return { released: true, slotId, executionId: slot.executionId };
}

// ── getConcurrencyState ────────────────────────────────────────────────

function getConcurrencyState() {
    const active = [..._slots.values()].filter(s => !s.released);
    const byAdapter   = {};
    const bySubsystem = {};

    for (const s of active) {
        if (s.adapterType) byAdapter[s.adapterType]     = (byAdapter[s.adapterType]     ?? 0) + 1;
        if (s.subsystem)   bySubsystem[s.subsystem]     = (bySubsystem[s.subsystem]     ?? 0) + 1;
    }

    return {
        globalActive:     active.length,
        globalLimit:      _limits.global,
        utilization:      Math.round(active.length / _limits.global * 1000) / 1000,
        byAdapter,
        bySubsystem,
        limits:           { ..._limits },
    };
}

// ── getConcurrencyMetrics ──────────────────────────────────────────────

function getConcurrencyMetrics() {
    const state = getConcurrencyState();
    return {
        totalAcquired:  _acquired,
        totalRejected:  _rejected,
        currentActive:  state.globalActive,
        globalLimit:    _limits.global,
        utilization:    state.utilization,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _limits   = { ...DEFAULT_LIMITS };
    _slots    = new Map();
    _counter  = 0;
    _acquired = 0;
    _rejected = 0;
}

module.exports = {
    DEFAULT_LIMITS,
    configure, acquire, release, isAdmitted,
    getConcurrencyState, getConcurrencyMetrics, reset,
};
