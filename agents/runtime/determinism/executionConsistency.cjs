"use strict";
/**
 * executionConsistency — track and validate workflow outcome consistency.
 *
 * record(workflowId, runId, outcome)          — record one run outcome
 * validate(workflowId)
 *   → { consistent, flipRate, consensusOutcome, deviations, sampleSize }
 * stableOrder(steps[])                        → steps sorted deterministically by name
 * getHistory(workflowId)                      → sorted outcome records
 * reset()
 *
 * "consistent" = flipRate ≤ FLIP_THRESHOLD (0.15)
 */

const FLIP_THRESHOLD = 0.15;

// workflowId → [{runId, outcome, ts, seq}]
const _records = new Map();
let   _seq     = 0;

function record(workflowId, runId, outcome) {
    if (!_records.has(workflowId)) _records.set(workflowId, []);
    _records.get(workflowId).push({
        seq:    ++_seq,
        runId:  runId || `run-${_seq}`,
        outcome: !!outcome,
        ts:     new Date().toISOString(),
    });
}

function validate(workflowId) {
    const recs = getHistory(workflowId);

    if (recs.length < 2) {
        return {
            consistent:      true,
            flipRate:        0,
            consensusOutcome: recs.length === 1 ? recs[0].outcome : null,
            deviations:       0,
            sampleSize:       recs.length,
        };
    }

    let flips = 0;
    for (let i = 1; i < recs.length; i++) {
        if (recs[i].outcome !== recs[i - 1].outcome) flips++;
    }

    const flipRate        = parseFloat((flips / (recs.length - 1)).toFixed(3));
    const successes       = recs.filter(r => r.outcome).length;
    const consensusOutcome = successes / recs.length >= 0.5;
    const deviations      = recs.filter(r => r.outcome !== consensusOutcome).length;

    return {
        consistent:       flipRate <= FLIP_THRESHOLD,
        flipRate,
        consensusOutcome,
        deviations,
        sampleSize:       recs.length,
    };
}

function stableOrder(steps) {
    if (!Array.isArray(steps)) return [];
    return [...steps].sort((a, b) => {
        const na = (a.name || "").toLowerCase();
        const nb = (b.name || "").toLowerCase();
        return na < nb ? -1 : na > nb ? 1 : 0;
    });
}

function getHistory(workflowId) {
    return (_records.get(workflowId) || []).slice().sort((a, b) => a.seq - b.seq);
}

function reset() { _records.clear(); _seq = 0; }

module.exports = { record, validate, stableOrder, getHistory, reset, FLIP_THRESHOLD };
