"use strict";
/**
 * Phase 666 — Engineering Context Coordination
 *
 * Correlates debugging sessions, preserves deployment context, maintains workflow
 * continuity, reconnects interrupted chains, prioritizes relevant operational memory.
 * Replay-safe. Bounded context depth. Stale-context cleanup.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/engineering-context-coord.json");
const MAX_CONTEXTS = 50;
const CTX_TTL      = 48 * 60 * 60 * 1000;
const STALE_CTX    = 8 * 60 * 60 * 1000;
const MAX_DEPTH    = 5;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { contexts: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - CTX_TTL;
    db.contexts = (db.contexts || []).filter(c => c.updatedAt > cutoff).slice(0, MAX_CONTEXTS);
}

// ── Context persistence ───────────────────────────────────────────────────────

function saveContext(contextId, opts = {}) {
    if (!contextId) return { ok: false, error: "contextId required" };
    const { type = "debug", goal = "", linkedSessions = [], linkedDeployId = null, notes = "", depth = 0 } = opts;

    if (depth > MAX_DEPTH) return { ok: false, error: `Max context depth (${MAX_DEPTH}) exceeded` };

    const db  = _load(); _prune(db);
    const idx = db.contexts.findIndex(c => c.contextId === contextId);

    const record = {
        contextId,
        type,
        goal:           (goal || "").slice(0, 200),
        linkedSessions: (linkedSessions || []).slice(0, 10),
        linkedDeployId,
        notes:          (notes || "").slice(0, 400),
        depth,
        createdAt:      idx >= 0 ? db.contexts[idx].createdAt : Date.now(),
        updatedAt:      Date.now(),
    };

    if (idx >= 0) { db.contexts[idx] = record; }
    else          { db.contexts.unshift(record); }
    _save(db);
    return { ok: true, contextId, type };
}

function restoreContext(contextId) {
    const db     = _load(); _prune(db);
    const record = db.contexts.find(c => c.contextId === contextId);
    if (!record) return { ok: false, error: "Context not found" };

    const ageMs = Date.now() - record.updatedAt;
    const stale = ageMs > STALE_CTX;
    return { ok: true, contextId, record, ageMs, stale, warning: stale ? "Context stale (>8h)" : null };
}

// ── Debug session correlation ─────────────────────────────────────────────────

function correlateDebuggingSessions(errorText = "") {
    const db      = _load(); _prune(db);
    const debugCtx = db.contexts.filter(c => c.type === "debug");

    // Find contexts with similar goals
    const q     = errorText.toLowerCase().slice(0, 100);
    const related = debugCtx.filter(c => c.goal.toLowerCase().includes(q) || c.notes.toLowerCase().includes(q));

    // Also query smart debug intelligence
    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    let pattern = null;
    if (sdi && errorText) { try { pattern = sdi.identifyPattern(errorText); } catch {} }

    // Operational memory
    const omi = _tryRequire("./operationalMemoryIntelligence.cjs");
    let memRecoveries = null;
    if (omi && errorText) { try { memRecoveries = omi.recallSuccessfulRecoveries(errorText); } catch {} }

    return {
        ok:              true,
        relatedContexts: related.slice(0, 5).map(c => ({ contextId: c.contextId, goal: c.goal, ageMs: Date.now() - c.updatedAt })),
        pattern,
        memoryRecoveries: memRecoveries?.recoveries?.slice(0, 3) || [],
        count:           related.length,
    };
}

// ── Deployment context preservation ──────────────────────────────────────────

function preserveDeploymentContext(deploymentId, state = {}) {
    return saveContext(`deploy-ctx:${deploymentId}`, { type: "deployment", ...state, linkedDeployId: deploymentId });
}

function restoreDeploymentContext(deploymentId) {
    return restoreContext(`deploy-ctx:${deploymentId}`);
}

// ── Interrupted chain reconnection ────────────────────────────────────────────

function reconnectInterruptedChains() {
    const reconnectable = [];

    const daf = _tryRequire("./dailyAutonomousFlows.cjs");
    if (daf) {
        try {
            const interrupted = daf.listRuns({ status: "interrupted" });
            interrupted.slice(0, 5).forEach(r => reconnectable.push({
                type:      "autonomous-flow",
                id:        r.id,
                name:      r.flowName,
                resumeAt:  r.currentStep,
                approvalRequired: true,
            }));
        } catch {}
    }

    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const interrupted = awc.listChains({ status: "interrupted" });
            interrupted.slice(0, 5).forEach(c => reconnectable.push({
                type:    "adaptive-chain",
                id:      c.chainId,
                name:    c.goal,
                depth:   c.depth,
                approvalRequired: true,
            }));
        } catch {}
    }

    return {
        ok:             true,
        count:          reconnectable.length,
        reconnectable,
        detail:         reconnectable.length > 0 ? `${reconnectable.length} chain(s) available to reconnect` : "No interrupted chains",
        approvalRequired: reconnectable.some(r => r.approvalRequired),
    };
}

// ── Relevant memory prioritization ───────────────────────────────────────────

function prioritizeRelevantMemory(goal = "") {
    const results = [];

    const omi = _tryRequire("./operationalMemoryIntelligence.cjs");
    if (omi && goal) {
        try {
            const recalled = omi.recall(goal, { limit: 5 });
            recalled.forEach(r => results.push({ source: "operational-memory", ...r }));
        } catch {}
    }

    const awm = _tryRequire("./autonomousWorkflowMemory.cjs");
    if (awm && goal) {
        try {
            const recalled = awm.recall(goal, { limit: 3 });
            recalled.results.forEach(r => results.push({ source: "workflow-memory", ...r }));
        } catch {}
    }

    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return { ok: true, goal, results: results.slice(0, 8), count: results.length };
}

// ── Stale context cleanup ─────────────────────────────────────────────────────

function cleanupStaleContexts({ dryRun = true } = {}) {
    const db     = _load();
    const cutoff = Date.now() - STALE_CTX;
    const stale  = db.contexts.filter(c => c.updatedAt < cutoff);

    if (!dryRun) {
        const ids = new Set(stale.map(c => c.contextId));
        db.contexts = db.contexts.filter(c => !ids.has(c.contextId));
        _save(db);
    }

    return { ok: true, staleCount: stale.length, pruned: !dryRun };
}

function listContexts({ type = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.contexts
        .filter(c => !type || c.type === type)
        .slice(0, limit)
        .map(c => ({ contextId: c.contextId, type: c.type, goal: c.goal, ageMs: Date.now() - c.updatedAt }));
}

module.exports = { saveContext, restoreContext, correlateDebuggingSessions, preserveDeploymentContext, restoreDeploymentContext, reconnectInterruptedChains, prioritizeRelevantMemory, cleanupStaleContexts, listContexts };
