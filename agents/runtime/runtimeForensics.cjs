"use strict";
/**
 * Phase 428 — Runtime Forensics System
 *
 * Captures post-failure debugging intelligence.
 * Stores: workflow failures, validation breakdowns, recovery attempts,
 *         adapter instability, execution causality chains.
 *
 * File-backed: data/forensics-log.json
 * Max 200 entries, 14-day TTL.
 * Read-only query interface for operator post-mortem inspection.
 */

const fs   = require("fs");
const path = require("path");

const LOG_PATH  = path.join(__dirname, "../../data/forensics-log.json");
const MAX_ENTRIES = 200;
const TTL_MS    = 14 * 24 * 60 * 60 * 1000;

const ENTRY_TYPES = ["workflow-failure", "validation-breakdown", "recovery-attempt", "adapter-fault", "causality-chain"];

function _load() {
    try { return JSON.parse(fs.readFileSync(LOG_PATH, "utf8")); }
    catch { return []; }
}

function _save(entries) {
    try {
        const dir = path.dirname(LOG_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(LOG_PATH, JSON.stringify(entries, null, 2));
    } catch {}
}

function _prune(entries) {
    const cutoff = Date.now() - TTL_MS;
    return entries
        .filter(e => e.ts > cutoff)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MAX_ENTRIES);
}

function _append(entry) {
    const entries = _load();
    entries.unshift({ ...entry, ts: entry.ts || Date.now() });
    _save(_prune(entries));
}

/**
 * Record a workflow failure with causality context.
 * @param {object} opts
 * @param {string} opts.chainName
 * @param {string} opts.failedStep    — step label
 * @param {string} opts.cmd
 * @param {string} opts.error
 * @param {string} [opts.sessionId]
 * @param {number} [opts.stepIndex]
 */
function recordWorkflowFailure({ chainName, failedStep, cmd, error, sessionId, stepIndex }) {
    _append({
        type:       "workflow-failure",
        chainName,
        failedStep: (failedStep || "").slice(0, 100),
        cmd:        (cmd     || "").slice(0, 200),
        error:      (error   || "").slice(0, 500),
        sessionId:  sessionId || null,
        stepIndex:  stepIndex ?? null,
    });
}

/**
 * Record a validation breakdown (probe returned false after step said OK).
 * @param {object} opts
 */
function recordValidationBreakdown({ chainName, cmd, probe, sessionId }) {
    _append({
        type:      "validation-breakdown",
        chainName: chainName || null,
        cmd:       (cmd || "").slice(0, 200),
        probe:     probe || null,
        sessionId: sessionId || null,
    });
}

/**
 * Record a recovery attempt (success or failure).
 */
function recordRecoveryAttempt({ cmd, sessionId, chainName, recovered, attemptNumber, error }) {
    _append({
        type:          "recovery-attempt",
        cmd:           (cmd || "").slice(0, 200),
        sessionId:     sessionId || null,
        chainName:     chainName || null,
        recovered:     !!recovered,
        attemptNumber: attemptNumber ?? null,
        error:         (error || "").slice(0, 300),
    });
}

/**
 * Record an adapter fault.
 */
function recordAdapterFault({ adapter, error, sessionId }) {
    _append({
        type:      "adapter-fault",
        adapter:   (adapter || "").slice(0, 40),
        error:     (error   || "").slice(0, 300),
        sessionId: sessionId || null,
    });
}

/**
 * Record a causality chain — what triggered what.
 * @param {object[]} chain  — [{ event, ts, detail }]
 */
function recordCausalityChain(chain, sessionId) {
    _append({
        type:      "causality-chain",
        sessionId: sessionId || null,
        chain:     (Array.isArray(chain) ? chain : []).slice(0, 20).map(e => ({
            event:  (e.event  || "").slice(0, 60),
            ts:     e.ts || Date.now(),
            detail: (e.detail || "").slice(0, 100),
        })),
    });
}

/**
 * Query forensics log.
 * @param {object} opts
 * @param {string} [opts.type]      — filter by entry type
 * @param {string} [opts.sessionId] — filter by session
 * @param {number} [opts.limit]     — max results
 * @returns {Array}
 */
function query({ type, sessionId, limit = 50 } = {}) {
    const entries = _prune(_load());
    return entries
        .filter(e => (!type || e.type === type))
        .filter(e => (!sessionId || e.sessionId === sessionId))
        .slice(0, Math.min(limit, MAX_ENTRIES));
}

/** Summary statistics for a post-mortem. */
function summarize(sessionId = null) {
    const entries = query({ sessionId, limit: 200 });
    const byType  = {};
    for (const e of entries) byType[e.type] = (byType[e.type] || 0) + 1;

    const failures    = entries.filter(e => e.type === "workflow-failure");
    const recoveries  = entries.filter(e => e.type === "recovery-attempt");
    const succeeded   = recoveries.filter(e => e.recovered).length;
    const breakdowns  = entries.filter(e => e.type === "validation-breakdown");
    const adapterFaults = entries.filter(e => e.type === "adapter-fault");

    return {
        total:           entries.length,
        byType,
        workflowFailures:  failures.length,
        recoveries:        recoveries.length,
        recoveryRate:      recoveries.length ? Math.round(succeeded / recoveries.length * 100) : null,
        validationBreakdowns: breakdowns.length,
        adapterFaults:     adapterFaults.length,
        mostRecentFailure: failures[0] || null,
    };
}

module.exports = {
    recordWorkflowFailure, recordValidationBreakdown, recordRecoveryAttempt,
    recordAdapterFault, recordCausalityChain,
    query, summarize,
    ENTRY_TYPES,
};
