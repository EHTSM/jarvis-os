"use strict";
/**
 * Phase 591 — Operator Workflow Memory
 *
 * Stores: stable debugging chains, successful deployment patterns,
 *         replay-linked recovery flows, validated execution sequences,
 *         environment-specific workflows.
 *
 * Bounded (200 entries, 21-day TTL), deduped by fingerprint, stale-cleaned.
 * State: data/operator-workflow-memory.json
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

const MEM_PATH    = path.join(__dirname, "../../data/operator-workflow-memory.json");
const MAX_ENTRIES = 200;
const TTL_MS      = 21 * 24 * 60 * 60 * 1000; // 21 days

const VALID_TYPES = ["debug-chain", "deploy-pattern", "recovery-flow", "exec-sequence", "env-workflow"];

function _load() {
    try { return JSON.parse(fs.readFileSync(MEM_PATH, "utf8")); }
    catch { return { entries: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(MEM_PATH), { recursive: true }); fs.writeFileSync(MEM_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.entries = db.entries.filter(e => e.ts > cutoff).sort((a, b) => b.ts - a.ts).slice(0, MAX_ENTRIES);
}
function _fp(type, key) {
    return crypto.createHash("md5").update(`${type}:${key}`).digest("hex").slice(0, 12);
}
function _upsert(db, entry) {
    const idx = db.entries.findIndex(e => e._fp === entry._fp);
    if (idx >= 0) db.entries[idx] = entry;
    else db.entries.unshift(entry);
}

// ── Record functions ──────────────────────────────────────────────────────────

function recordDebugChain(opts = {}) {
    const { chainName, errorPattern, resolution, confidence = 0, environment = "default" } = opts;
    if (confidence < 60 || !chainName) return;
    const db = _load();
    const fp = _fp("debug-chain", chainName + (errorPattern || "").slice(0, 40));
    _upsert(db, { type: "debug-chain", ts: Date.now(), chainName, errorPattern: (errorPattern || "").slice(0, 100), resolution: (resolution || "").slice(0, 200), confidence, environment, _fp: fp });
    _prune(db); _save(db);
}

function recordDeployPattern(opts = {}) {
    const { pipelineName, environment = "default", successRate = 0, avgDurationMs = 0, notes = "" } = opts;
    if (successRate < 0.5 || !pipelineName) return;
    const db = _load();
    const fp = _fp("deploy-pattern", pipelineName + environment);
    _upsert(db, { type: "deploy-pattern", ts: Date.now(), pipelineName, environment, successRate, avgDurationMs, notes: (notes || "").slice(0, 200), _fp: fp });
    _prune(db); _save(db);
}

function recordRecoveryFlow(opts = {}) {
    const { flowId, trigger, steps = [], confidence = 0, replayId = null } = opts;
    if (confidence < 60 || !flowId) return;
    const db = _load();
    const fp = _fp("recovery-flow", flowId + (trigger || "").slice(0, 30));
    _upsert(db, { type: "recovery-flow", ts: Date.now(), flowId, trigger: (trigger || "").slice(0, 100), steps: steps.slice(0, 10), confidence, replayId, _fp: fp });
    _prune(db); _save(db);
}

function recordExecSequence(opts = {}) {
    const { sequenceName, purpose = "", stepCount = 0, successRate = 0 } = opts;
    if (!sequenceName) return;
    const db = _load();
    const fp = _fp("exec-sequence", sequenceName);
    _upsert(db, { type: "exec-sequence", ts: Date.now(), sequenceName, purpose: (purpose || "").slice(0, 150), stepCount, successRate, _fp: fp });
    _prune(db); _save(db);
}

function recordEnvWorkflow(opts = {}) {
    const { environment, workflowName, outcome = "success", notes = "" } = opts;
    if (!environment || !workflowName) return;
    const db = _load();
    const fp = _fp("env-workflow", environment + workflowName);
    _upsert(db, { type: "env-workflow", ts: Date.now(), environment, workflowName, outcome, notes: (notes || "").slice(0, 200), _fp: fp });
    _prune(db); _save(db);
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
            const hay = [e.chainName, e.pipelineName, e.flowId, e.sequenceName, e.workflowName, e.errorPattern, e.trigger, e.notes].filter(Boolean).join(" ").toLowerCase();
            return hay.includes(lower);
        })
        .slice(0, limit)
        .map(({ _fp, ...safe }) => safe);
}

function suggest(goal = "") {
    const lower = goal.toLowerCase();
    const results = {};

    if (/debug|error|crash|fail/.test(lower)) {
        results.debugChains = query(goal, "debug-chain", 3);
    }
    if (/deploy|release|ship/.test(lower)) {
        results.deployPatterns = query(goal, "deploy-pattern", 3);
    }
    if (/recover|restore|rollback/.test(lower)) {
        results.recoveryFlows = query(goal, "recovery-flow", 3);
    }

    return results;
}

function stats() {
    const db = _load(); _prune(db);
    const byType = {};
    for (const e of db.entries) byType[e.type] = (byType[e.type] || 0) + 1;
    return { total: db.entries.length, max: MAX_ENTRIES, ttlDays: TTL_MS / 86400000, byType };
}

module.exports = { recordDebugChain, recordDeployPattern, recordRecoveryFlow, recordExecSequence, recordEnvWorkflow, query, suggest, stats };
