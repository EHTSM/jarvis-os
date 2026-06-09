"use strict";
/**
 * Phase 728 — Execution Performance Optimization
 *
 * Replay rendering, workflow execution speed, environment restoration,
 * deployment coordination, runtime responsiveness, workspace loading.
 * Bounded caches. Memory discipline. Reconnect-safe optimization.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH    = path.join(__dirname, "../../data/exec-perf-opt.json");
const TTL_MS        = 12 * 60 * 60 * 1000;
const CACHE_MAX     = 100;
const CACHE_TTL     = 5  * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { cache: [], metrics: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - TTL_MS;
    db.cache   = (db.cache   || []).filter(c => c.ts > Date.now() - CACHE_TTL).slice(0, CACHE_MAX);
    db.metrics = (db.metrics || []).filter(m => m.ts > cut).slice(0, 200);
}

function _cacheGet(db, key) {
    const entry = (db.cache || []).find(c => c.key === key && (Date.now() - c.ts) < CACHE_TTL);
    return entry ? entry.value : null;
}
function _cacheSet(db, key, value) {
    const idx = db.cache.findIndex(c => c.key === key);
    const record = { key, value, ts: Date.now() };
    if (idx >= 0) { db.cache[idx] = record; } else { db.cache.unshift(record); }
    db.cache = db.cache.slice(0, CACHE_MAX);
}

// ── Replay rendering optimization ────────────────────────────────────────────

function optimizeReplayRendering(replayId) {
    if (!replayId) return { ok: false, error: "replayId required" };
    const db = _load(); _prune(db);

    const cacheKey = `replay:${replayId}`;
    const cached   = _cacheGet(db, cacheKey);
    if (cached) { return { ok: true, replayId, fromCache: true, ...cached }; }

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    let sessionData = null;
    if (lhpc) {
        try {
            const r = lhpc.restoreProductivitySession(replayId, { force: false });
            if (r.ok) sessionData = { goal: r.record?.goal, progress: r.record?.progress, env: r.record?.env };
        } catch {}
    }

    const result = { replayId, sessionData, renderMs: 0, cached: false };
    _cacheSet(db, cacheKey, result);
    db.metrics.push({ type: "replay-render", replayId, ts: Date.now() });
    _save(db);

    return { ok: true, ...result };
}

// ── Workflow execution speed ──────────────────────────────────────────────────

function measureWorkflowExecutionSpeed(flowType = "startup-restore") {
    const db  = _load(); _prune(db);
    const key = `flow-speed:${flowType}`;
    const cached = _cacheGet(db, key);
    if (cached) return { ok: true, flowType, fromCache: true, ...cached };

    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    let stepCount = 0;
    if (ocf) {
        try {
            const catalog = ocf.catalogOneClickFlows();
            const flow = catalog.find(f => f.type === flowType);
            stepCount = flow?.stepCount || 0;
        } catch {}
    }

    const estimatedMs = stepCount * 150;
    const result = { flowType, stepCount, estimatedMs, optimized: stepCount <= 6 };
    _cacheSet(db, key, result);
    db.metrics.push({ type: "flow-speed", flowType, ts: Date.now() });
    _save(db);

    return { ok: true, ...result };
}

// ── Environment restoration speed ────────────────────────────────────────────

function optimizeEnvironmentRestoration(snapshotId) {
    if (!snapshotId) return { ok: false, error: "snapshotId required" };
    const db  = _load(); _prune(db);
    const key = `env-restore:${snapshotId}`;
    const cached = _cacheGet(db, key);
    if (cached) return { ok: true, snapshotId, fromCache: true, ...cached };

    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    let components = [];
    if (iwr) {
        try {
            const snapshots = iwr.listWorkspaceSnapshots({ limit: 20 });
            const snap = snapshots.find(s => s.snapshotId === snapshotId);
            if (snap) components = snap.components || [];
        } catch {}
    }

    const estimatedMs = components.length * 200;
    const result = { snapshotId, components, estimatedMs, optimized: components.length <= 4 };
    _cacheSet(db, key, result);
    db.metrics.push({ type: "env-restore", snapshotId, ts: Date.now() });
    _save(db);

    return { ok: true, ...result };
}

// ── Deployment coordination speed ─────────────────────────────────────────────

function optimizeDeploymentCoordination(deploymentId = "") {
    const db  = _load(); _prune(db);
    const key = `deploy-coord:${deploymentId || "default"}`;
    const cached = _cacheGet(db, key);
    if (cached) return { ok: true, fromCache: true, ...cached };

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    let stage = "unknown", trust = "unknown";
    if (dec) {
        try { const s = dec.deploymentStateSummary(deploymentId); stage = s.stage; } catch {}
        try { const t = dec.deploymentTrustIndicator(deploymentId); trust = t.indicator; } catch {}
    }

    const result = { deploymentId, stage, trust, coordOptimized: trust !== "red" };
    _cacheSet(db, key, result);
    _save(db);
    return { ok: true, ...result };
}

// ── Runtime responsiveness check ─────────────────────────────────────────────

function checkRuntimeResponsiveness() {
    const db  = _load(); _prune(db);
    const key = "runtime-responsiveness";
    const cached = _cacheGet(db, key);
    if (cached) return { ok: true, fromCache: true, ...cached };

    const start = Date.now();
    const checks = [];

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) { try { const r = odc.detectUnstableCoordinationStates(); checks.push({ check: "coordination", ok: r.stable }); } catch {} }

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) { try { const r = lhpc.productivityStormStatus(); checks.push({ check: "storm-free", ok: !r.storm }); } catch {} }

    const elapsedMs  = Date.now() - start;
    const responsive = elapsedMs < 500 && checks.every(c => c.ok !== false);
    const result = { checks, elapsedMs, responsive };
    _cacheSet(db, key, result);
    db.metrics.push({ type: "responsiveness", elapsedMs, ts: Date.now() });
    _save(db);

    return { ok: responsive, ...result };
}

// ── Cache stats + clear ───────────────────────────────────────────────────────

function cacheStats() {
    const db = _load(); _prune(db);
    return { ok: true, cacheSize: db.cache.length, maxCache: CACHE_MAX, metrics: db.metrics.length, cacheTtlMs: CACHE_TTL };
}

function clearPerfCache() {
    const db = _load();
    const cleared = db.cache.length;
    db.cache = [];
    _save(db);
    return { ok: true, cleared };
}

module.exports = { optimizeReplayRendering, measureWorkflowExecutionSpeed, optimizeEnvironmentRestoration, optimizeDeploymentCoordination, checkRuntimeResponsiveness, cacheStats, clearPerfCache };
