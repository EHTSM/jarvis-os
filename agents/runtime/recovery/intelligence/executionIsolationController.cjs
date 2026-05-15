"use strict";
/**
 * executionIsolationController — safe execution quarantine, zone-based
 * isolation, and cascading failure containment.
 *
 * isolateExecution(spec)         → { isolated, isolationId, workflowId, zone }
 * quarantineExecution(spec)      → { quarantined, quarantineId, workflowId }
 * releaseIsolation(spec)         → { released, isolationId }
 * validateIsolationSafety(spec)  → { safe, violations }
 * getIsolationState()            → IsolationState
 * reset()
 *
 * Zone strictness (least → most): safe-zone < degraded-zone < recovery-zone < quarantine-zone
 * Quarantine is terminal — workflows cannot be moved to a less-strict zone.
 */

const ZONES         = ["safe-zone", "degraded-zone", "recovery-zone", "quarantine-zone"];
const ZONE_RANK     = { "safe-zone": 0, "degraded-zone": 1, "recovery-zone": 2, "quarantine-zone": 3 };

let _isolated    = new Map();   // workflowId → IsolationRecord
let _quarantined = new Set();
let _zoneMembers = new Map();   // zone → Set<workflowId>
let _counter     = 0;

for (const z of ZONES) _zoneMembers.set(z, new Set());

// ── isolateExecution ──────────────────────────────────────────────────

function isolateExecution(spec = {}) {
    const { workflowId = null, zone = "recovery-zone", reason = "unspecified" } = spec;
    if (!workflowId)         return { isolated: false, reason: "workflowId_required" };
    if (!ZONES.includes(zone)) return { isolated: false, reason: `invalid_zone: ${zone}` };
    if (_quarantined.has(workflowId))
        return { isolated: false, reason: "workflow_is_quarantined" };

    const existing = _isolated.get(workflowId);
    if (existing) {
        const existingRank = ZONE_RANK[existing.zone];
        const newRank      = ZONE_RANK[zone];
        if (newRank < existingRank)
            return { isolated: false, reason: "zone_downgrade_not_allowed", currentZone: existing.zone };
        // Move to stricter zone
        _zoneMembers.get(existing.zone).delete(workflowId);
    }

    const isolationId = `iso-${++_counter}`;
    const record = { isolationId, workflowId, zone, reason, active: true, isolatedAt: new Date().toISOString() };
    _isolated.set(workflowId, record);
    _zoneMembers.get(zone).add(workflowId);

    return { isolated: true, isolationId, workflowId, zone, reason };
}

// ── quarantineExecution ───────────────────────────────────────────────

function quarantineExecution(spec = {}) {
    const { workflowId = null, reason = "unsafe_execution" } = spec;
    if (!workflowId) return { quarantined: false, reason: "workflowId_required" };
    if (_quarantined.has(workflowId))
        return { quarantined: false, reason: "already_quarantined", workflowId };

    _quarantined.add(workflowId);

    // Force into quarantine-zone, removing from any existing zone
    const existing = _isolated.get(workflowId);
    if (existing) _zoneMembers.get(existing.zone).delete(workflowId);

    const quarantineId = `quar-${++_counter}`;
    const record = { isolationId: quarantineId, workflowId, zone: "quarantine-zone", reason, active: true, isolatedAt: new Date().toISOString() };
    _isolated.set(workflowId, record);
    _zoneMembers.get("quarantine-zone").add(workflowId);

    return { quarantined: true, quarantineId, workflowId, reason };
}

// ── releaseIsolation ──────────────────────────────────────────────────

function releaseIsolation(spec = {}) {
    const { workflowId = null } = spec;
    if (!workflowId) return { released: false, reason: "workflowId_required" };
    if (_quarantined.has(workflowId))
        return { released: false, reason: "quarantine_escape_blocked" };

    const rec = _isolated.get(workflowId);
    if (!rec)        return { released: false, reason: "isolation_not_found" };
    if (!rec.active) return { released: false, reason: "isolation_already_released" };

    rec.active      = false;
    rec.releasedAt  = new Date().toISOString();
    _zoneMembers.get(rec.zone).delete(workflowId);
    _isolated.delete(workflowId);

    return { released: true, workflowId, zone: rec.zone };
}

// ── validateIsolationSafety ───────────────────────────────────────────

function validateIsolationSafety(spec = {}) {
    const { workflowId = null, targetZone = "safe-zone" } = spec;
    const violations = [];

    if (!workflowId)           { return { safe: false, violations: ["workflowId_required"] }; }
    if (!ZONES.includes(targetZone)) { violations.push(`invalid_zone: ${targetZone}`); }

    if (_quarantined.has(workflowId) && targetZone !== "quarantine-zone")
        violations.push("quarantine_escape_blocked");

    const existing = _isolated.get(workflowId);
    if (existing && violations.length === 0) {
        if (ZONE_RANK[targetZone] < ZONE_RANK[existing.zone])
            violations.push("zone_downgrade_not_allowed");
    }

    return { safe: violations.length === 0, violations, workflowId, targetZone };
}

// ── getIsolationState ─────────────────────────────────────────────────

function getIsolationState() {
    const byZone = {};
    for (const z of ZONES) byZone[z] = _zoneMembers.get(z).size;

    return {
        totalIsolated:   _isolated.size,
        quarantinedCount: _quarantined.size,
        byZone,
        quarantinedIds:  [..._quarantined],
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _isolated    = new Map();
    _quarantined = new Set();
    _zoneMembers = new Map();
    _counter     = 0;
    for (const z of ZONES) _zoneMembers.set(z, new Set());
}

module.exports = {
    ZONES, ZONE_RANK,
    isolateExecution, quarantineExecution, releaseIsolation,
    validateIsolationSafety, getIsolationState, reset,
};
