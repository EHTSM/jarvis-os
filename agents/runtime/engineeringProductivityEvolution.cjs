"use strict";
/**
 * Phase 641 — Engineering Productivity Evolution
 *
 * Tracks productivity trends: debugging speed, deployment frequency, patch success,
 * workflow reuse, recovery time. Surfaces actionable improvement insights.
 * Bounded reads only — no side effects.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/eng-productivity-evolution.json");
const MAX_EVENTS  = 500;
const TTL_MS      = 30 * 24 * 60 * 60 * 1000; // 30 days

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { events: [], snapshots: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.events    = (db.events    || []).filter(e => e.ts > cutoff).slice(0, MAX_EVENTS);
    db.snapshots = (db.snapshots || []).slice(-60);
}

// ── Event recording ────────────────────────────────────────────────────────────

const EVENT_TYPES = new Set([
    "debug-resolved",       // debug session closed with success
    "debug-timeout",        // debug session abandoned
    "deploy-success",       // deployment completed
    "deploy-fail",          // deployment failed
    "deploy-rollback",      // rollback triggered
    "patch-applied",        // patch successfully applied
    "patch-rejected",       // patch rejected or failed
    "workflow-reused",      // replay or known workflow executed
    "recovery-auto",        // autonomous recovery succeeded
    "recovery-manual",      // operator-driven recovery
    "recovery-failed",      // recovery failed
    "goal-completed",       // engineering goal completed
    "goal-abandoned",       // engineering goal abandoned
]);

function recordEvent(type, { sessionId = null, durationMs = null, detail = null } = {}) {
    if (!EVENT_TYPES.has(type)) return { ok: false, error: `Unknown event type: ${type}` };
    const db = _load(); _prune(db);
    db.events.unshift({ type, sessionId, durationMs, detail: (detail || "").slice(0, 200), ts: Date.now() });
    _save(db);
    return { ok: true, type };
}

// ── Debugging speed report ─────────────────────────────────────────────────────

function debuggingSpeedReport({ windowDays = 7 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const evts   = db.events.filter(e => e.ts > cutoff);

    const resolved  = evts.filter(e => e.type === "debug-resolved");
    const timeouts  = evts.filter(e => e.type === "debug-timeout");
    const total     = resolved.length + timeouts.length;
    const resRate   = total > 0 ? Math.round(resolved.length / total * 100) : null;

    const durations = resolved.map(e => e.durationMs).filter(Boolean);
    const avgMs     = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    const medMs     = durations.length > 0 ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null;

    return {
        ok: true,
        windowDays,
        resolved:       resolved.length,
        timeouts:       timeouts.length,
        resolutionRate: resRate !== null ? `${resRate}%` : "no data",
        avgResolveMs:   avgMs,
        medianResolveMs: medMs,
        trend:          resRate !== null && resRate >= 70 ? "healthy" : resRate !== null && resRate >= 50 ? "moderate" : "needs-attention",
    };
}

// ── Deployment cadence report ──────────────────────────────────────────────────

function deploymentCadenceReport({ windowDays = 14 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const evts   = db.events.filter(e => e.ts > cutoff);

    const successes = evts.filter(e => e.type === "deploy-success").length;
    const fails     = evts.filter(e => e.type === "deploy-fail").length;
    const rollbacks = evts.filter(e => e.type === "deploy-rollback").length;
    const total     = successes + fails;
    const successRate = total > 0 ? Math.round(successes / total * 100) : null;

    return {
        ok: true,
        windowDays,
        successes,
        fails,
        rollbacks,
        successRate: successRate !== null ? `${successRate}%` : "no data",
        rollbackRate: total > 0 ? `${Math.round(rollbacks / total * 100)}%` : "no data",
        trend: successRate !== null && successRate >= 80 ? "healthy" : "watch",
    };
}

// ── Patch quality report ───────────────────────────────────────────────────────

function patchQualityReport({ windowDays = 14 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const evts   = db.events.filter(e => e.ts > cutoff);

    const applied  = evts.filter(e => e.type === "patch-applied").length;
    const rejected = evts.filter(e => e.type === "patch-rejected").length;
    const total    = applied + rejected;
    const rate     = total > 0 ? Math.round(applied / total * 100) : null;

    // Pull in advanced patch trust data if available
    const apt = _tryRequire("./advancedPatchTrust.cjs");
    let trustSummary = null;
    if (apt) { try { trustSummary = apt.executionConfidenceSummary(); } catch {} }

    return {
        ok: true,
        windowDays,
        applied,
        rejected,
        applyRate:    rate !== null ? `${rate}%` : "no data",
        trustSummary: trustSummary || null,
        trend:        rate !== null && rate >= 75 ? "healthy" : "watch",
    };
}

// ── Workflow reuse report ──────────────────────────────────────────────────────

function workflowReuseReport({ windowDays = 14 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const evts   = db.events.filter(e => e.ts > cutoff);

    const reused      = evts.filter(e => e.type === "workflow-reused").length;
    const autoRecovery = evts.filter(e => e.type === "recovery-auto").length;
    const manualRecovery = evts.filter(e => e.type === "recovery-manual").length;
    const totalRecoveries = autoRecovery + manualRecovery;

    // Pull from workflow memory for richer stats
    const awm = _tryRequire("./autonomousWorkflowMemory.cjs");
    let memStats = null;
    if (awm) { try { memStats = awm.stats(); } catch {} }

    return {
        ok: true,
        windowDays,
        workflowsReused:    reused,
        autoRecoveries:     autoRecovery,
        manualRecoveries:   manualRecovery,
        automationRate:     totalRecoveries > 0 ? `${Math.round(autoRecovery / totalRecoveries * 100)}%` : "no data",
        memoryStats:        memStats,
    };
}

// ── Recovery performance ───────────────────────────────────────────────────────

function recoveryPerformance({ windowDays = 7 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const evts   = db.events.filter(e => e.ts > cutoff);

    const auto   = evts.filter(e => e.type === "recovery-auto").length;
    const manual = evts.filter(e => e.type === "recovery-manual").length;
    const failed = evts.filter(e => e.type === "recovery-failed").length;
    const total  = auto + manual + failed;
    const successRate = total > 0 ? Math.round((auto + manual) / total * 100) : null;

    // Check decision intelligence history
    const edi = _tryRequire("./engineeringDecisionIntelligence.cjs");
    let recentDecisions = [];
    if (edi) { try { recentDecisions = edi.decisionHistory({ type: "recovery-prioritization", limit: 5 }); } catch {} }

    return {
        ok: true,
        windowDays,
        autoRecoveries:   auto,
        manualRecoveries: manual,
        failedRecoveries: failed,
        successRate:      successRate !== null ? `${successRate}%` : "no data",
        recentDecisions:  recentDecisions.slice(0, 3).map(d => ({ path: d.path, confidence: d.confidence, ts: d.ts })),
        trend:            successRate !== null && successRate >= 80 ? "healthy" : "watch",
    };
}

// ── Daily snapshot ────────────────────────────────────────────────────────────

function takeSnapshot() {
    const db     = _load(); _prune(db);
    const today  = new Date().toISOString().slice(0, 10);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const todayEvts = db.events.filter(e => e.ts > cutoff);

    const byType = {};
    todayEvts.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });

    const snap = { date: today, eventCount: todayEvts.length, byType, ts: Date.now() };
    db.snapshots.push(snap);
    _save(db);
    return { ok: true, snapshot: snap };
}

// ── Full productivity summary ─────────────────────────────────────────────────

function productivitySummary({ windowDays = 7 } = {}) {
    const debug    = debuggingSpeedReport({ windowDays });
    const deploy   = deploymentCadenceReport({ windowDays });
    const patch    = patchQualityReport({ windowDays });
    const reuse    = workflowReuseReport({ windowDays });
    const recovery = recoveryPerformance({ windowDays });

    const healthyCount = [debug, deploy, patch, recovery].filter(r => r.trend === "healthy").length;
    const overallHealth = healthyCount >= 3 ? "healthy" : healthyCount >= 2 ? "moderate" : "needs-attention";

    return {
        ok:           true,
        windowDays,
        overallHealth,
        debug,
        deploy,
        patch,
        reuse,
        recovery,
        summary:      `Productivity: ${overallHealth} — debug=${debug.trend} deploy=${deploy.trend} patch=${patch.trend} recovery=${recovery.trend}`,
    };
}

// ── Trend analysis over snapshots ─────────────────────────────────────────────

function trendAnalysis({ windowDays = 14 } = {}) {
    const db     = _load();
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const snaps  = db.snapshots.filter(s => s.ts > cutoff);

    const totals = snaps.reduce((acc, s) => {
        Object.entries(s.byType || {}).forEach(([k, v]) => { acc[k] = (acc[k] || 0) + v; });
        return acc;
    }, {});

    return {
        ok:          true,
        windowDays,
        snapshots:   snaps.length,
        accumulated: totals,
        topEvent:    Object.entries(totals).sort((a, b) => b[1] - a[1])[0]?.[0] || null,
    };
}

module.exports = { recordEvent, debuggingSpeedReport, deploymentCadenceReport, patchQualityReport, workflowReuseReport, recoveryPerformance, takeSnapshot, productivitySummary, trendAnalysis };
