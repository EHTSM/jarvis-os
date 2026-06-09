"use strict";
/**
 * Phase 432 — Execution Recovery Memory
 *
 * Persists validated recovery paths, failed recovery patterns,
 * unstable workflows, and high-confidence repair sequences.
 *
 * Separate from engineeringMemory (Phase 411) which stores session-level outcomes.
 * This module stores step-level recovery intelligence — which specific commands
 * worked or failed in which contexts, so future runs can learn from them.
 *
 * File: data/recovery-memory.json
 * Max 300 entries, 30-day TTL.
 * Lightweight operational learning only — no speculative self-modification.
 */

const fs   = require("fs");
const path = require("path");

const MEM_PATH    = path.join(__dirname, "../../data/recovery-memory.json");
const MAX_ENTRIES = 300;
const TTL_MS      = 30 * 24 * 60 * 60 * 1000;

// Entry types
const TYPE_VALIDATED_PATH  = "validated-path";
const TYPE_FAILED_PATTERN  = "failed-pattern";
const TYPE_UNSTABLE_CHAIN  = "unstable-chain";
const TYPE_REPAIR_SEQUENCE = "repair-sequence";

function _load() {
    try { return JSON.parse(fs.readFileSync(MEM_PATH, "utf8")); }
    catch { return []; }
}

function _save(entries) {
    try {
        const dir = path.dirname(MEM_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MEM_PATH, JSON.stringify(entries, null, 2));
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
    entries.unshift({ ...entry, ts: Date.now() });
    _save(_prune(entries));
}

/**
 * Record a validated recovery path — a sequence that successfully resolved an issue.
 * @param {object} opts
 * @param {string} opts.chainName
 * @param {string[]} opts.cmds        — ordered commands that succeeded
 * @param {string} opts.context       — brief description of what was broken
 * @param {number} opts.confidence    — session confidence at end (0–100)
 */
function recordValidatedPath({ chainName, cmds, context, confidence }) {
    if (confidence < 60) return; // only store high-quality recoveries
    _append({
        type:       TYPE_VALIDATED_PATH,
        chainName,
        cmds:       (cmds || []).slice(0, 10).map(c => String(c).slice(0, 150)),
        context:    (context || "").slice(0, 200),
        confidence,
    });
}

/**
 * Record a failed recovery pattern — a command or sequence that consistently fails.
 * @param {object} opts
 * @param {string} opts.cmd
 * @param {string} opts.chainName
 * @param {string} opts.errorPattern  — brief description of the error
 * @param {number} opts.failCount     — how many times this has failed
 */
function recordFailedPattern({ cmd, chainName, errorPattern, failCount }) {
    _append({
        type:         TYPE_FAILED_PATTERN,
        cmd:          (cmd          || "").slice(0, 150),
        chainName:    chainName || null,
        errorPattern: (errorPattern || "").slice(0, 200),
        failCount:    failCount || 1,
    });
}

/**
 * Record an unstable workflow — one that repeatedly fails or produces inconsistent results.
 * @param {object} opts
 * @param {string} opts.chainName
 * @param {number} opts.failureRate   — 0.0–1.0
 * @param {string} opts.evidence      — brief description of instability
 */
function recordUnstableChain({ chainName, failureRate, evidence }) {
    _append({
        type:        TYPE_UNSTABLE_CHAIN,
        chainName,
        failureRate: Math.min(1, Math.max(0, failureRate || 0)),
        evidence:    (evidence || "").slice(0, 200),
    });
}

/**
 * Record a high-confidence repair sequence for a specific problem type.
 * @param {object} opts
 * @param {string} opts.problemType   — e.g. "frontend-build-failure"
 * @param {string[]} opts.sequence    — ordered chain names that resolved it
 * @param {number} opts.successCount  — how many times this sequence worked
 */
function recordRepairSequence({ problemType, sequence, successCount }) {
    _append({
        type:         TYPE_REPAIR_SEQUENCE,
        problemType:  (problemType || "").slice(0, 80),
        sequence:     (sequence || []).slice(0, 6).map(s => String(s).slice(0, 80)),
        successCount: successCount || 1,
    });
}

/**
 * Query recovery memory.
 * @param {object} opts
 * @param {string} [opts.type]
 * @param {string} [opts.chainName]
 * @param {number} [opts.limit]
 * @returns {Array}
 */
function query({ type, chainName, limit = 50 } = {}) {
    const entries = _prune(_load());
    return entries
        .filter(e => !type      || e.type === type)
        .filter(e => !chainName || e.chainName === chainName)
        .slice(0, Math.min(limit, MAX_ENTRIES));
}

/**
 * Look up the best validated recovery path for a given context/chain.
 * @param {string} chainName
 * @returns {object|null}
 */
function bestPath(chainName) {
    const paths = query({ type: TYPE_VALIDATED_PATH, chainName });
    return paths[0] || null; // already sorted newest-first, highest confidence among recent
}

/**
 * Check if a command is a known failure pattern.
 * @param {string} cmd
 * @returns {boolean}
 */
function isKnownFailure(cmd) {
    const lower = (cmd || "").toLowerCase().slice(0, 150);
    const failures = query({ type: TYPE_FAILED_PATTERN, limit: 100 });
    return failures.some(f => lower.includes((f.cmd || "").toLowerCase().slice(0, 60)));
}

/**
 * Suggest repair sequences for a problem type.
 * @param {string} problemType
 * @returns {string[][]}
 */
function suggestRepair(problemType) {
    const lower = (problemType || "").toLowerCase();
    const repairs = query({ type: TYPE_REPAIR_SEQUENCE, limit: 100 });
    return repairs
        .filter(r => (r.problemType || "").toLowerCase().includes(lower))
        .slice(0, 3)
        .map(r => r.sequence);
}

/** Statistics. */
function stats() {
    const entries = _prune(_load());
    const byType  = {};
    for (const e of entries) byType[e.type] = (byType[e.type] || 0) + 1;
    return { total: entries.length, max: MAX_ENTRIES, byType };
}

module.exports = {
    recordValidatedPath, recordFailedPattern, recordUnstableChain, recordRepairSequence,
    query, bestPath, isKnownFailure, suggestRepair, stats,
    TYPES: { TYPE_VALIDATED_PATH, TYPE_FAILED_PATTERN, TYPE_UNSTABLE_CHAIN, TYPE_REPAIR_SEQUENCE },
};
