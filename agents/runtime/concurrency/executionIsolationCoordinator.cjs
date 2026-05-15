"use strict";
/**
 * executionIsolationCoordinator — concurrent isolation enforcement, execution
 * boundary protection, cross-workflow containment, and isolation-aware scheduling.
 *
 * createIsolationBoundary(spec)       → { created, boundaryId, isolationDomain }
 * validateIsolationSafety(spec)       → { safe, workflowId, boundaryId }
 * isolateWorkflow(spec)               → { isolated, isoId, workflowId }
 * quarantineUnsafeExecution(spec)     → { quarantined, workflowId }
 * getIsolationTopology()              → IsolationTopology
 * reset()
 */

const BOUNDARY_TYPES    = ["strict", "permissive", "quarantine-only", "recovery-safe"];
const ISOLATION_STATUSES = ["active", "violated", "quarantined", "released"];

let _boundaries  = new Map();   // boundaryId → BoundaryRecord
let _isolations  = new Map();   // workflowId → IsolationRecord
let _quarantined = new Set();   // workflowIds
let _counter     = 0;

// ── createIsolationBoundary ───────────────────────────────────────────

function createIsolationBoundary(spec = {}) {
    const {
        isolationDomain = null,
        boundaryType    = "strict",
        maxWorkflows    = 10,
        allowedTypes    = [],
    } = spec;

    if (!isolationDomain) return { created: false, reason: "isolationDomain_required" };
    if (!BOUNDARY_TYPES.includes(boundaryType))
        return { created: false, reason: `invalid_boundary_type: ${boundaryType}` };

    const boundaryId = `bnd-${++_counter}`;
    _boundaries.set(boundaryId, {
        boundaryId,
        isolationDomain,
        boundaryType,
        maxWorkflows,
        allowedTypes:  [...allowedTypes],
        workflowCount: 0,
        status:        "active",
        createdAt:     new Date().toISOString(),
    });

    return { created: true, boundaryId, isolationDomain, boundaryType };
}

// ── validateIsolationSafety ───────────────────────────────────────────

function validateIsolationSafety(spec = {}) {
    const { workflowId = null, boundaryId = null } = spec;
    if (!workflowId) return { safe: false, reason: "workflowId_required" };

    if (_quarantined.has(workflowId))
        return { safe: false, reason: "workflow_quarantined", workflowId };

    if (boundaryId) {
        const boundary = _boundaries.get(boundaryId);
        if (!boundary)              return { safe: false, reason: "boundary_not_found" };
        if (boundary.status === "quarantined")
            return { safe: false, reason: "boundary_quarantined" };
        if (boundary.workflowCount >= boundary.maxWorkflows)
            return { safe: false, reason: "boundary_capacity_exceeded", capacity: boundary.maxWorkflows };
    }

    return { safe: true, workflowId, boundaryId: boundaryId ?? null };
}

// ── isolateWorkflow ───────────────────────────────────────────────────

function isolateWorkflow(spec = {}) {
    const { workflowId = null, boundaryId = null, isolationDomain = "default" } = spec;
    if (!workflowId) return { isolated: false, reason: "workflowId_required" };

    if (_quarantined.has(workflowId))
        return { isolated: false, reason: "workflow_already_quarantined" };

    const isoId = `iso-${++_counter}`;
    _isolations.set(workflowId, {
        isoId,
        workflowId,
        boundaryId,
        isolationDomain,
        status:     "active",
        isolatedAt: new Date().toISOString(),
    });

    if (boundaryId && _boundaries.has(boundaryId))
        _boundaries.get(boundaryId).workflowCount++;

    return { isolated: true, isoId, workflowId, boundaryId, isolationDomain };
}

// ── quarantineUnsafeExecution ─────────────────────────────────────────

function quarantineUnsafeExecution(spec = {}) {
    const { workflowId = null, reason = "unsafe_execution" } = spec;
    if (!workflowId) return { quarantined: false, reason: "workflowId_required" };

    _quarantined.add(workflowId);
    const iso = _isolations.get(workflowId);
    if (iso) iso.status = "quarantined";

    return { quarantined: true, workflowId, reason };
}

// ── getIsolationTopology ──────────────────────────────────────────────

function getIsolationTopology() {
    return {
        totalBoundaries:     _boundaries.size,
        totalIsolations:     _isolations.size,
        quarantinedCount:    _quarantined.size,
        boundaries:          [..._boundaries.values()].map(b => ({ ...b })),
        quarantinedWorkflows: [..._quarantined],
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _boundaries  = new Map();
    _isolations  = new Map();
    _quarantined = new Set();
    _counter     = 0;
}

module.exports = {
    BOUNDARY_TYPES, ISOLATION_STATUSES,
    createIsolationBoundary, validateIsolationSafety,
    isolateWorkflow, quarantineUnsafeExecution,
    getIsolationTopology, reset,
};
