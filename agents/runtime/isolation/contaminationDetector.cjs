"use strict";
/**
 * contaminationDetector — detect state contamination, trace corruption sources,
 * identify invalid transitions, and validate state integrity.
 *
 * scanExecutionState(execId, state)       → ScanRecord
 * detectContamination(execId)             → { execId, contaminated, findingCount, byType, findings }
 * traceContaminationSource(execId)        → { execId, found, rootSource, sources, totalSources }
 * validateStateIntegrity(state)           → { valid, issues }
 * reset()
 */

const CONTAMINATION_TYPES = [
    "memory_leak",
    "state_corruption",
    "recursive_mutation",
    "invalid_transition",
    "unsafe_shared_state",
];

// Valid state machine transitions for execution lifecycle
const VALID_TRANSITIONS = {
    created:   ["running", "cancelled"],
    running:   ["completed", "failed", "cancelled"],
    completed: [],
    failed:    ["retry", "cancelled"],
    retry:     ["running", "cancelled"],
    cancelled: [],
};

let _scans    = new Map();
let _findings = [];
let _counter  = 0;

function scanExecutionState(execId, state = {}) {
    const scanId   = `scn-${++_counter}`;
    const findings = [];

    // Memory leak
    if (state.allocatedMb != null && state.maxAllowedMb != null &&
        state.allocatedMb > state.maxAllowedMb)
        findings.push({ type: "memory_leak",
                        detail: `allocated=${state.allocatedMb}MB exceeds max=${state.maxAllowedMb}MB` });

    // State corruption — missing required fields
    if (Array.isArray(state.requiredFields)) {
        for (const field of state.requiredFields) {
            if (state.data?.[field] == null)
                findings.push({ type: "state_corruption",
                                detail: `missing required field: ${field}` });
        }
    }

    // Recursive mutation depth
    if (state.mutationDepth != null &&
        state.mutationDepth > (state.maxMutationDepth ?? 10))
        findings.push({ type: "recursive_mutation",
                        detail: `depth=${state.mutationDepth} exceeds max=${state.maxMutationDepth ?? 10}` });

    // Invalid state transition
    if (state.fromStatus != null && state.toStatus != null) {
        const allowed = VALID_TRANSITIONS[state.fromStatus] ?? [];
        if (!allowed.includes(state.toStatus))
            findings.push({ type: "invalid_transition",
                            detail: `${state.fromStatus}→${state.toStatus} not allowed` });
    }

    // Unsafe shared state mutations
    if (state.sharedMutations != null && state.sharedMutations > 0)
        findings.push({ type: "unsafe_shared_state",
                        detail: `sharedMutations=${state.sharedMutations}` });

    const ts   = new Date().toISOString();
    const clean = findings.length === 0;

    const record = {
        scanId,
        execId,
        clean,
        contaminated: !clean,
        findings,
        scannedAt: ts,
    };

    _scans.set(scanId, record);
    for (const f of findings)
        _findings.push({ ...f, scanId, execId, ts });

    return record;
}

function detectContamination(execId) {
    const relevant    = [..._scans.values()].filter(s => s.execId === execId);
    const allFindings = relevant.flatMap(s => s.findings);
    const byType      = {};

    for (const f of allFindings)
        byType[f.type] = (byType[f.type] ?? 0) + 1;

    return {
        execId,
        contaminated: allFindings.length > 0,
        findingCount: allFindings.length,
        byType,
        findings:     allFindings,
    };
}

function traceContaminationSource(execId) {
    const relevant = _findings.filter(f => f.execId === execId);
    if (relevant.length === 0) return { execId, found: false, sources: [] };

    const sources = relevant
        .map(f => ({ type: f.type, detail: f.detail, scanId: f.scanId, ts: f.ts }))
        .sort((a, b) => a.ts < b.ts ? -1 : 1);

    return {
        execId,
        found:        true,
        rootSource:   sources[0],
        sources,
        totalSources: sources.length,
    };
}

function validateStateIntegrity(state = {}) {
    const issues = [];

    if (state.version != null && typeof state.version !== "number")
        issues.push("version_not_numeric");
    if (state.checksum != null && state.expectedChecksum != null &&
        state.checksum !== state.expectedChecksum)
        issues.push("checksum_mismatch");
    if (state.closed === true && state.activeOperations > 0)
        issues.push("operations_on_closed_state");

    return { valid: issues.length === 0, issues };
}

function reset() {
    _scans    = new Map();
    _findings = [];
    _counter  = 0;
}

module.exports = {
    CONTAMINATION_TYPES, VALID_TRANSITIONS,
    scanExecutionState, detectContamination, traceContaminationSource,
    validateStateIntegrity, reset,
};
