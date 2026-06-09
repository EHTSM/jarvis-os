"use strict";
/**
 * Phase 578 — Engineering Context Memory
 *
 * Bounded, deduplicated, stale-cleaned memory for:
 *   - successful debugging chains
 *   - stable recovery workflows
 *   - deployment repair history
 *   - replay-linked engineering context
 *   - workflow outcome summaries
 *
 * Extends engineeringMemory.cjs with richer context types.
 * State: data/engineering-context-memory.json
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const MEM_PATH    = path.join(__dirname, "../../data/engineering-context-memory.json");
const MAX_ENTRIES = 150;
const TTL_MS      = 14 * 24 * 60 * 60 * 1000; // 14 days

const VALID_TYPES = new Set(["debug-chain", "recovery-workflow", "deployment-repair", "replay-context", "outcome-summary"]);

function _load() {
    try { return JSON.parse(fs.readFileSync(MEM_PATH, "utf8")); }
    catch { return { entries: [] }; }
}

function _save(db) {
    try {
        fs.mkdirSync(path.dirname(MEM_PATH), { recursive: true });
        fs.writeFileSync(MEM_PATH, JSON.stringify(db, null, 2));
    } catch {}
}

function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.entries = db.entries
        .filter(e => e.ts > cutoff)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MAX_ENTRIES);
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function _fingerprint(type, key) {
    return crypto.createHash("md5").update(`${type}:${key}`).digest("hex").slice(0, 12);
}

function _dedupe(db, fp) {
    const idx = db.entries.findIndex(e => e._fp === fp);
    if (idx !== -1) db.entries.splice(idx, 1); // remove old, will re-add as fresh
}

// ── Record functions ──────────────────────────────────────────────────────────

/**
 * Record a successful debugging chain.
 */
function recordDebugChain(opts = {}) {
    const { chainName, errorPattern, resolution, confidence = 0, sessionId = null } = opts;
    if (confidence < 60) return;
    const db = _load();
    const fp = _fingerprint("debug-chain", chainName + errorPattern);
    _dedupe(db, fp);
    db.entries.unshift({ type: "debug-chain", ts: Date.now(), chainName, errorPattern: (errorPattern || "").slice(0, 100), resolution: (resolution || "").slice(0, 200), confidence, sessionId, _fp: fp });
    _prune(db);
    _save(db);
}

/**
 * Record a stable recovery workflow that succeeded.
 */
function recordRecoveryWorkflow(opts = {}) {
    const { workflowId, goal, stepCount, confidence = 0, replayId = null } = opts;
    if (confidence < 60) return;
    const db = _load();
    const fp = _fingerprint("recovery-workflow", workflowId + (goal || "").slice(0, 50));
    _dedupe(db, fp);
    db.entries.unshift({ type: "recovery-workflow", ts: Date.now(), workflowId, goal: (goal || "").slice(0, 100), stepCount, confidence, replayId, _fp: fp });
    _prune(db);
    _save(db);
}

/**
 * Record a deployment repair (a deployment that failed then was fixed).
 */
function recordDeploymentRepair(opts = {}) {
    const { pipelineName, failureCause, repairAction, success = true, runId = null } = opts;
    if (!success) return;
    const db = _load();
    const fp = _fingerprint("deployment-repair", pipelineName + failureCause);
    _dedupe(db, fp);
    db.entries.unshift({ type: "deployment-repair", ts: Date.now(), pipelineName, failureCause: (failureCause || "").slice(0, 100), repairAction: (repairAction || "").slice(0, 200), runId, _fp: fp });
    _prune(db);
    _save(db);
}

/**
 * Record replay-linked engineering context.
 */
function recordReplayContext(opts = {}) {
    const { replayId, goal, outcome, confidence = 0 } = opts;
    if (confidence < 50) return;
    const db = _load();
    const fp = _fingerprint("replay-context", replayId);
    _dedupe(db, fp);
    db.entries.unshift({ type: "replay-context", ts: Date.now(), replayId, goal: (goal || "").slice(0, 100), outcome: (outcome || "").slice(0, 200), confidence, _fp: fp });
    _prune(db);
    _save(db);
}

/**
 * Record a session outcome summary.
 */
function recordOutcome(opts = {}) {
    const { sessionId, goal, durationMs, successRate, workflowCount } = opts;
    if (!sessionId) return;
    const db = _load();
    const fp = _fingerprint("outcome-summary", sessionId);
    _dedupe(db, fp);
    db.entries.unshift({ type: "outcome-summary", ts: Date.now(), sessionId, goal: (goal || "").slice(0, 100), durationMs, successRate, workflowCount, _fp: fp });
    _prune(db);
    _save(db);
}

// ── Query ─────────────────────────────────────────────────────────────────────

function query(text = "", type = null, limit = 20) {
    const db    = _load();
    _prune(db);
    const lower = text.toLowerCase();
    return db.entries
        .filter(e => {
            if (type && e.type !== type) return false;
            if (!lower) return true;
            const haystack = [e.chainName, e.workflowId, e.pipelineName, e.goal, e.errorPattern, e.repairAction, e.resolution].filter(Boolean).join(" ").toLowerCase();
            return haystack.includes(lower);
        })
        .slice(0, limit)
        .map(({ _fp, ...safe }) => safe);
}

function stats() {
    const db     = _load();
    _prune(db);
    const byType = {};
    for (const e of db.entries) byType[e.type] = (byType[e.type] || 0) + 1;
    return { total: db.entries.length, max: MAX_ENTRIES, ttlDays: TTL_MS / 86400000, byType };
}

/**
 * Suggest best debug chains for a given error text.
 */
function suggestDebugChains(errorText) {
    const matches = query(errorText, "debug-chain", 5);
    return matches.sort((a, b) => b.confidence - a.confidence);
}

module.exports = { recordDebugChain, recordRecoveryWorkflow, recordDeploymentRepair, recordReplayContext, recordOutcome, query, stats, suggestDebugChains };
