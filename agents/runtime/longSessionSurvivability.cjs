"use strict";
/**
 * Phase 729 — Long-Session Survivability
 *
 * Multi-day workspace continuity, replay durability, reconnect-safe restoration,
 * deployment-session persistence, interrupted-workflow recovery.
 * PREVENTS: stale replay continuation, duplicate execution resurrection, corrupted recovery.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH      = path.join(__dirname, "../../data/long-session-survivability.json");
const SESSION_TTL     = 14 * 24 * 60 * 60 * 1000;
const STALE_THRESHOLD = 48 * 60 * 60 * 1000;
const DEDUP_MS        = 10 * 60 * 1000;
const STORM_THRESHOLD = 8;
const STORM_WINDOW    = 60 * 60 * 1000;
const MAX_SESSIONS    = 50;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { sessions: [], reconnects: [], deploymentSessions: [], dedup: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - SESSION_TTL;
    db.sessions           = (db.sessions           || []).filter(s => s.ts > cut).slice(0, MAX_SESSIONS);
    db.reconnects         = (db.reconnects         || []).filter(r => r.ts > Date.now() - STORM_WINDOW * 24).slice(-500);
    db.deploymentSessions = (db.deploymentSessions || []).filter(d => d.ts > cut).slice(0, 30);
    db.dedup              = (db.dedup              || []).filter(d => d.ts > Date.now() - DEDUP_MS);
}
function _isDup(db, key) { return (db.dedup || []).some(d => d.key === key && (Date.now() - d.ts) < DEDUP_MS); }

function persistSurvivabilitySession(sessionId, opts = {}) {
    if (!sessionId) return { ok: false, error: "sessionId required" };
    const { goal = "", env = "default", progress = 0, checkpointData = null } = opts;
    const db  = _load(); _prune(db);
    const idx = db.sessions.findIndex(s => s.sessionId === sessionId);
    const record = {
        sessionId, goal: goal.slice(0, 200), env,
        progress: Math.min(100, Math.max(0, progress)),
        checkpointData, status: "active",
        createdAt: idx >= 0 ? db.sessions[idx].createdAt : Date.now(),
        ts: Date.now(),
    };
    if (idx >= 0) { db.sessions[idx] = record; } else { db.sessions.unshift(record); }
    _save(db);
    return { ok: true, sessionId, progress: record.progress };
}

function restoreSurvivabilitySession(sessionId, { force = false } = {}) {
    const db     = _load(); _prune(db);
    const record = db.sessions.find(s => s.sessionId === sessionId);
    if (!record) return { ok: false, error: "Session not found" };
    const ageMs = Date.now() - record.ts;
    const stale = ageMs > STALE_THRESHOLD;
    if (stale && !force) return { ok: false, stale: true, ageMs, error: "Session stale (>48h) — pass force=true" };
    return { ok: true, sessionId, record, ageMs, stale, warning: stale ? "Stale session — verify before execution" : null };
}

function recordSurvivabilityReconnect(sessionId) {
    const db = _load();
    db.reconnects = (db.reconnects || []);
    db.reconnects.push({ sessionId, ts: Date.now() });
    db.reconnects = db.reconnects.slice(-500);
    _save(db);
    const recentCount = db.reconnects.filter(r => r.ts > Date.now() - STORM_WINDOW).length;
    const storm       = recentCount >= STORM_THRESHOLD;
    return { ok: !storm, storm, recentCount, threshold: STORM_THRESHOLD, warning: storm ? `Storm: ${recentCount}/hour` : null };
}

function survivabilityStormStatus() {
    const db          = _load();
    const recentCount = (db.reconnects || []).filter(r => r.ts > Date.now() - STORM_WINDOW).length;
    const storm       = recentCount >= STORM_THRESHOLD;
    return { ok: !storm, storm, recentCount, threshold: STORM_THRESHOLD };
}

function persistDeploymentSurvivabilitySession(deploymentId, workspaceState = {}) {
    if (!deploymentId) return { ok: false, error: "deploymentId required" };
    const db  = _load(); _prune(db);
    const key = `deploy:${deploymentId}`;
    if (_isDup(db, key)) return { ok: true, duplicate: true };
    const idx = db.deploymentSessions.findIndex(d => d.deploymentId === deploymentId);
    const record = { deploymentId, workspaceState, ts: Date.now() };
    if (idx >= 0) { db.deploymentSessions[idx] = record; } else { db.deploymentSessions.unshift(record); }
    db.dedup.push({ key, ts: Date.now() });
    _save(db);
    return { ok: true, deploymentId };
}

function recoverInterruptedWorkflows({ operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db = _load(); _prune(db);
    const interrupted = db.sessions.filter(s => s.status === "interrupted" || s.checkpointData?.interrupted);

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    let prodInterrupted = 0;
    if (lhpc) { try { prodInterrupted = lhpc.listProductivitySessions({ limit: 50 }).filter(s => s.status === "interrupted").length; } catch {} }

    return {
        ok:              true,
        interruptedSessions:    interrupted.length,
        productivityInterrupted: prodInterrupted,
        approvalRequired: true,
        detail:           `Recovery: ${interrupted.length} survivability + ${prodInterrupted} productivity sessions interrupted`,
    };
}

function assessSurvivabilityDurability() {
    const signals = [];
    const storm   = survivabilityStormStatus();
    if (storm.storm) signals.push({ factor: "survivability-storm", severity: "critical" });

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) { try { const d = lhwc.assessCrossEnvReplayDurability(); if (!d.durable) signals.push(...(d.signals || [])); } catch {} }

    const durable = signals.filter(s => s.severity === "critical").length === 0;
    return { ok: durable, durable, signals, detail: durable ? "Survivability durability intact" : `${signals.length} signal(s)` };
}

function survivabilityHealth() {
    const db    = _load(); _prune(db);
    const storm = survivabilityStormStatus();
    const stale = db.sessions.filter(s => (Date.now() - s.ts) > STALE_THRESHOLD);
    const dur   = assessSurvivabilityDurability();

    return {
        ok:             !storm.storm && dur.durable,
        storm:          storm.storm,
        reconnectCount: storm.recentCount,
        activeSessions: db.sessions.filter(s => s.status === "active").length,
        staleSessions:  stale.length,
        replayDurable:  dur.durable,
        summary:        `Survivability: ${!storm.storm ? "HEALTHY" : "STORM"} — sessions=${db.sessions.length} storm=${storm.storm}`,
    };
}

function listSurvivabilitySessions({ limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.sessions.slice(0, limit).map(s => ({ sessionId: s.sessionId, goal: s.goal, status: s.status, progress: s.progress, ageMs: Date.now() - s.ts }));
}

module.exports = { persistSurvivabilitySession, restoreSurvivabilitySession, recordSurvivabilityReconnect, survivabilityStormStatus, persistDeploymentSurvivabilitySession, recoverInterruptedWorkflows, assessSurvivabilityDurability, survivabilityHealth, listSurvivabilitySessions };
