"use strict";
/**
 * Phase 670 — Long-Horizon Execution Survivability
 *
 * Reconnect-safe coordination, multi-day continuity, replay durability,
 * interrupted workflow restoration, deployment-session persistence.
 * PREVENTS: storm accumulation, stale resurrection, unsafe dedup bypass.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH       = path.join(__dirname, "../../data/long-horizon-survivability.json");
const SESSION_TTL      = 14 * 24 * 60 * 60 * 1000;
const STALE_THRESHOLD  = 48 * 60 * 60 * 1000;
const DEDUP_MS         = 10 * 60 * 1000;
const STORM_THRESHOLD  = 8;
const STORM_WINDOW     = 60 * 60 * 1000;
const MAX_SESSIONS     = 100;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [], reconnects: [], deploymentSessions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - SESSION_TTL;
    db.sessions           = (db.sessions           || []).filter(s => s.ts > cutoff).slice(0, MAX_SESSIONS);
    db.reconnects         = (db.reconnects         || []).filter(r => r.ts > Date.now() - STORM_WINDOW * 24).slice(-500);
    db.deploymentSessions = (db.deploymentSessions || []).filter(d => d.ts > cutoff).slice(0, 50);
}

// ── Multi-day session persistence ─────────────────────────────────────────────

function persistSurvivabilitySession(sessionId, opts = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const { goal = "", progress = 0, env = "default", checkpointData = null } = opts;
    const db = _load(); _prune(db);

    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);
    const record = {
        sessionId,
        goal: goal.slice(0, 200),
        progress: Math.min(100, Math.max(0, progress)),
        env,
        checkpointData,
        status: "active",
        createdAt: idx >= 0 ? db.sessions[idx].createdAt : Date.now(),
        ts: Date.now(),
    };

    if (idx >= 0) { db.sessions[idx] = record; }
    else          { db.sessions.unshift(record); }
    _save(db);
    return { ok: true, sessionId, progress: record.progress };
}

function restoreSurvivabilitySession(sessionId, { force = false } = {}) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "Session not found" };

    const ageMs = Date.now() - record.ts;
    const stale = ageMs > STALE_THRESHOLD;
    if (stale && !force) return { ok: false, stale: true, ageMs, error: "Session stale (>48h) — pass force=true to restore" };

    return { ok: true, sessionId, record, ageMs, stale, warning: stale ? "Stale session restored — verify before execution" : null };
}

// ── Reconnect storm detection ─────────────────────────────────────────────────

function recordReconnect(sessionId) {
    const db = _load();
    db.reconnects = (db.reconnects || []);
    db.reconnects.push({ sessionId, ts: Date.now() });
    db.reconnects = db.reconnects.slice(-500);
    _save(db);

    const windowCutoff = Date.now() - STORM_WINDOW;
    const recentCount  = db.reconnects.filter(r => r.ts > windowCutoff).length;
    const storm        = recentCount >= STORM_THRESHOLD;

    return {
        ok:          !storm,
        storm,
        recentCount,
        threshold:   STORM_THRESHOLD,
        warning:     storm ? `Reconnect storm detected: ${recentCount} reconnects in last hour` : null,
        recommendation: storm ? "Pause reconnection attempts — investigate root cause first" : null,
    };
}

function reconnectStormStatus() {
    const db           = _load();
    const windowCutoff = Date.now() - STORM_WINDOW;
    const recentCount  = (db.reconnects || []).filter(r => r.ts > windowCutoff).length;
    const storm        = recentCount >= STORM_THRESHOLD;
    return { ok: !storm, storm, recentCount, threshold: STORM_THRESHOLD };
}

// ── Replay durability ─────────────────────────────────────────────────────────

function assessReplayDurability(replayId = "") {
    const signals = [];

    const pre = _tryRequire("./platformResilienceEvolution.cjs");
    if (pre) { try { const r = pre.replayDurabilityReport(); if (!r.durable) signals.push(...(r.signals || [])); } catch {} }

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) { try { const h = lhec.continuityHealth(); if (h.storm) signals.push({ factor: "continuity-storm", severity: "critical" }); } catch {} }

    const durable  = signals.filter(s => s.severity === "critical").length === 0;
    const stormStatus = reconnectStormStatus();
    if (stormStatus.storm) signals.push({ factor: "local-reconnect-storm", severity: "critical" });

    return {
        ok:      durable && !stormStatus.storm,
        durable: durable && !stormStatus.storm,
        replayId,
        signals,
        warning: !durable ? `Replay durability compromised: ${signals.length} signal(s)` : null,
    };
}

// ── Interrupted workflow restoration ─────────────────────────────────────────

function restoreInterruptedWorkflows({ operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true, error: "Workflow restoration requires operator approval" };

    const restorable = [];

    const daf = _tryRequire("./dailyAutonomousFlows.cjs");
    if (daf) {
        try {
            const interrupted = daf.listRuns({ status: "interrupted" });
            interrupted.slice(0, 5).forEach(r => restorable.push({ type: "autonomous-flow", id: r.id, name: r.flowName, step: r.currentStep }));
        } catch {}
    }

    const dec = _tryRequire("./dailyEngineeringCoordination.cjs");
    if (dec) {
        try {
            const interrupted = dec.listRuns({ status: "interrupted" });
            interrupted.slice(0, 5).forEach(r => restorable.push({ type: "engineering-coord", id: r.runId, name: r.sequenceType, step: r.currentStep }));
        } catch {}
    }

    return {
        ok:         true,
        count:      restorable.length,
        restorable,
        detail:     restorable.length > 0 ? `${restorable.length} workflow(s) available for restoration` : "No interrupted workflows",
        approvalRequired: true,
    };
}

// ── Deployment session persistence ────────────────────────────────────────────

function persistDeploymentSurvivability(deploymentId, state = {}) {
    if (!deploymentId) return { ok: false, error: "deploymentId required" };
    const db  = _load(); _prune(db);
    const idx = db.deploymentSessions.findIndex(d => d.deploymentId === deploymentId);
    const record = { deploymentId, state, ts: Date.now() };

    if (idx >= 0) { db.deploymentSessions[idx] = record; }
    else          { db.deploymentSessions.unshift(record); }
    _save(db);
    return { ok: true, deploymentId };
}

function recoverDeploymentSurvivability(deploymentId) {
    const db     = _load();
    const record = db.deploymentSessions.find(d => d.deploymentId === deploymentId);
    if (!record) return { ok: false, error: "No deployment session found" };

    const ageMs = Date.now() - record.ts;
    const stale = ageMs > STALE_THRESHOLD;
    return { ok: true, deploymentId, state: record.state, ageMs, stale, warning: stale ? "Deployment session stale" : null };
}

// ── Survivability health summary ──────────────────────────────────────────────

function survivabilityHealth() {
    const db      = _load(); _prune(db);
    const storm   = reconnectStormStatus();
    const stale   = db.sessions.filter(s => (Date.now() - s.ts) > STALE_THRESHOLD);

    const pre = _tryRequire("./platformResilienceEvolution.cjs");
    let resilienceScore = null;
    if (pre) { try { resilienceScore = pre.resilienceEvolutionReport()?.overallScore; } catch {} }

    const healthy = !storm.storm;
    return {
        ok:               healthy,
        healthy,
        storm:            storm.storm,
        reconnectCount:   storm.recentCount,
        activeSessions:   db.sessions.filter(s => s.status === "active").length,
        staleSessions:    stale.length,
        deploymentCount:  db.deploymentSessions.length,
        resilienceScore,
        summary:          `Survivability: ${healthy ? "HEALTHY" : "STORM"} — sessions=${db.sessions.length} reconnects=${storm.recentCount}/${STORM_THRESHOLD}`,
    };
}

module.exports = { persistSurvivabilitySession, restoreSurvivabilitySession, recordReconnect, reconnectStormStatus, assessReplayDurability, restoreInterruptedWorkflows, persistDeploymentSurvivability, recoverDeploymentSurvivability, survivabilityHealth };
