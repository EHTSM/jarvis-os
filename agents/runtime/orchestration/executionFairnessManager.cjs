"use strict";
/**
 * executionFairnessManager — weighted fair queuing to prevent subsystem and
 * workflow starvation. Tracks execution share per subsystem and workflow.
 * Selects the next execution from the candidate set with the lowest share used.
 *
 * recordExecution(spec)          → { recorded, shareId }
 * getNextFairExecution(candidates[]) → candidate | null
 * getShareDistribution()         → ShareDistribution
 * getStarvedEntities(threshold?) → StarvedEntity[]
 * getFairnessMetrics()           → FairnessMetrics
 * reset()
 *
 * Share = executions completed / total completions for that dimension.
 * Starvation threshold: entity has < MIN_SHARE_FRACTION of expected share.
 * Expected share per entity = 1 / active-entities.
 * MIN_SHARE_FRACTION default = 0.5 (entity gets < 50% of fair share).
 */

const DEFAULT_STARVATION_THRESHOLD = 0.5;
const MAX_HISTORY = 50000;

let _history       = [];   // execution records
let _subsystemShare = new Map();   // subsystem → count
let _workflowShare  = new Map();   // workflowId → count
let _total          = 0;
let _counter        = 0;

// ── recordExecution ────────────────────────────────────────────────────

function recordExecution(spec = {}) {
    const {
        executionId = null,
        subsystem   = null,
        workflowId  = null,
        adapterType = null,
        timestamp   = new Date().toISOString(),
    } = spec;

    if (!executionId) return { recorded: false, reason: "executionId_required" };

    const shareId = `fair-${++_counter}`;
    if (_history.length >= MAX_HISTORY) _history.shift();
    _history.push(Object.freeze({ shareId, executionId, subsystem: subsystem ?? null, workflowId: workflowId ?? null, adapterType: adapterType ?? null, timestamp }));

    if (subsystem)  _subsystemShare.set(subsystem,  (_subsystemShare.get(subsystem)  ?? 0) + 1);
    if (workflowId) _workflowShare.set(workflowId,  (_workflowShare.get(workflowId)  ?? 0) + 1);
    _total++;

    return { recorded: true, shareId, executionId };
}

// ── getNextFairExecution ───────────────────────────────────────────────

function getNextFairExecution(candidates = []) {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // Score each candidate: lower share consumed → lower score → higher preference
    const scored = candidates.map(c => {
        const ssCount  = _subsystemShare.get(c.subsystem)  ?? 0;
        const wfCount  = _workflowShare.get(c.workflowId)  ?? 0;
        const ssShare  = _total > 0 ? ssCount / _total : 0;
        const wfShare  = _total > 0 ? wfCount / _total : 0;
        const fairScore = ssShare * 0.5 + wfShare * 0.5;
        return { candidate: c, fairScore };
    });

    // Sort ascending (least-served first); tie-break by priorityScore descending
    scored.sort((a, b) =>
        Math.abs(a.fairScore - b.fairScore) < 0.0001
            ? (b.candidate.priorityScore ?? 0) - (a.candidate.priorityScore ?? 0)
            : a.fairScore - b.fairScore
    );

    return scored[0].candidate;
}

// ── getShareDistribution ───────────────────────────────────────────────

function getShareDistribution() {
    const bySubsystem = {};
    const byWorkflow  = {};

    for (const [k, v] of _subsystemShare)
        bySubsystem[k] = { count: v, share: _total > 0 ? Math.round(v / _total * 1000) / 1000 : 0 };
    for (const [k, v] of _workflowShare)
        byWorkflow[k]  = { count: v, share: _total > 0 ? Math.round(v / _total * 1000) / 1000 : 0 };

    return { totalExecutions: _total, bySubsystem, byWorkflow };
}

// ── getStarvedEntities ─────────────────────────────────────────────────

function getStarvedEntities(threshold = DEFAULT_STARVATION_THRESHOLD) {
    if (_total === 0) return [];

    const starved = [];

    // Expected share = 1 / number of active entities
    const ssCount = _subsystemShare.size;
    const wfCount = _workflowShare.size;

    if (ssCount > 0) {
        const expected = 1 / ssCount;
        for (const [ss, count] of _subsystemShare) {
            const share = count / _total;
            if (share < expected * threshold)
                starved.push({ dimension: "subsystem", entity: ss, share, expected: Math.round(expected * 1000) / 1000 });
        }
    }
    if (wfCount > 0) {
        const expected = 1 / wfCount;
        for (const [wf, count] of _workflowShare) {
            const share = count / _total;
            if (share < expected * threshold)
                starved.push({ dimension: "workflow", entity: wf, share, expected: Math.round(expected * 1000) / 1000 });
        }
    }

    return starved.sort((a, b) => a.share - b.share);
}

// ── getFairnessMetrics ─────────────────────────────────────────────────

function getFairnessMetrics() {
    const dist    = getShareDistribution();
    const starved = getStarvedEntities();
    return {
        totalExecutions:   _total,
        subsystemCount:    _subsystemShare.size,
        workflowCount:     _workflowShare.size,
        starvedEntities:   starved.length,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _history        = [];
    _subsystemShare = new Map();
    _workflowShare  = new Map();
    _total          = 0;
    _counter        = 0;
}

module.exports = {
    DEFAULT_STARVATION_THRESHOLD,
    recordExecution, getNextFairExecution, getShareDistribution,
    getStarvedEntities, getFairnessMetrics, reset,
};
