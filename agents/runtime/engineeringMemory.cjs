"use strict";
/**
 * Phase 411 — Contextual Engineering Memory
 *
 * Stores successful sessions, validated recovery paths, high-confidence steps.
 * Compressed aggressively: max 100 entries, prune on every write.
 *
 * Memory types:
 *   "recovery-path"   — a chain that successfully resolved a goal pattern
 *   "validated-step"  — a specific command that was verified post-execution
 *   "session-outcome" — a completed session with its final confidence + goal
 *
 * All entries expire after 30 days. Only success-path data is stored.
 * Failures are NOT stored (use pressure monitor / session logs for that).
 */

const fs   = require("fs");
const path = require("path");

const MEM_PATH  = path.join(__dirname, "../../data/engineering-memory.json");
const MAX_ENTRIES = 100;
const TTL_MS    = 30 * 24 * 60 * 60 * 1000; // 30 days

function _load() {
    try {
        const raw = fs.readFileSync(MEM_PATH, "utf8");
        return JSON.parse(raw);
    } catch { return { entries: [] }; }
}

function _save(db) {
    try {
        const dir = path.dirname(MEM_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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

/**
 * Record a successful recovery path.
 * @param {string} chainName
 * @param {string} goalPattern — matched goal text (max 100 chars)
 * @param {number} confidence  — session confidence at end (0–100)
 * @param {number} stepCount
 */
function recordRecoveryPath(chainName, goalPattern, confidence, stepCount) {
    if (confidence < 60) return; // only store high-quality outcomes
    const db = _load();
    db.entries.push({
        type:        "recovery-path",
        ts:          Date.now(),
        chainName,
        goalPattern: (goalPattern || "").slice(0, 100),
        confidence,
        stepCount,
    });
    _prune(db);
    _save(db);
}

/**
 * Record a validated step (command verified post-execution).
 * @param {string} cmd
 * @param {string} chainName
 * @param {object} probeResult — { verified: bool, checks: [] }
 */
function recordValidatedStep(cmd, chainName, probeResult) {
    if (!probeResult?.verified) return; // only verified steps
    const db = _load();
    db.entries.push({
        type:       "validated-step",
        ts:         Date.now(),
        cmd:        (cmd || "").slice(0, 120),
        chainName,
        checkCount: probeResult.checks?.length || 0,
    });
    _prune(db);
    _save(db);
}

/**
 * Record a session outcome (completed or high-confidence).
 * @param {object} s — engineeringSession summary
 */
function recordSessionOutcome(s) {
    if (!s || s.executionConfidence < 70) return;
    const db = _load();
    db.entries.push({
        type:        "session-outcome",
        ts:          Date.now(),
        goal:        (s.goal || "").slice(0, 100),
        confidence:  s.executionConfidence,
        degradation: s.degradationState,
        workflowCount: s.workflowCount,
        sessionId:   s.id,
    });
    _prune(db);
    _save(db);
}

/**
 * Retrieve entries relevant to a goal string.
 * @param {string} goalText
 * @param {string} [type]  — optional filter by type
 * @returns {Array}
 */
function query(goalText = "", type = null) {
    const db = _load();
    _prune(db);
    const lower = goalText.toLowerCase();
    return db.entries.filter(e => {
        if (type && e.type !== type) return false;
        if (!lower) return true;
        const text = (e.goalPattern || e.goal || e.chainName || e.cmd || "").toLowerCase();
        return text.includes(lower);
    });
}

/**
 * Best chains for a goal (sorted by most-recent success).
 * @param {string} goalText
 * @returns {Array<{ chainName: string, confidence: number, ts: number }>}
 */
function suggestChains(goalText) {
    const paths = query(goalText, "recovery-path");
    const seen  = new Set();
    return paths
        .filter(e => { if (seen.has(e.chainName)) return false; seen.add(e.chainName); return true; })
        .slice(0, 5)
        .map(e => ({ chainName: e.chainName, confidence: e.confidence, ts: e.ts }));
}

/** Diagnostic stats. */
function stats() {
    const db = _load();
    _prune(db);
    const byType = {};
    for (const e of db.entries) {
        byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return { total: db.entries.length, max: MAX_ENTRIES, byType };
}

module.exports = { recordRecoveryPath, recordValidatedStep, recordSessionOutcome, query, suggestChains, stats };
