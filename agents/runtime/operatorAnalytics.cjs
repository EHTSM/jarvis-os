"use strict";
/**
 * Phase 533 — Real Operator Analytics
 *
 * Tracks: debugging productivity, recovery effectiveness, deployment reliability,
 * workflow success rates, runtime stability, operator fatigue indicators.
 *
 * Local-first, bounded metrics only.
 * data/operator-analytics.json — max 500 metric entries, 30-day TTL.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const ANALYTICS_PATH = path.join(__dirname, "../../data/operator-analytics.json");
const MAX_ENTRIES    = 500;
const TTL_MS         = 30 * 24 * 60 * 60 * 1000;

const METRIC_TYPES = [
    "session-start", "session-complete", "session-abandoned",
    "workflow-run", "workflow-success", "workflow-failure",
    "recovery-triggered", "recovery-success", "recovery-failure",
    "deployment-started", "deployment-passed", "deployment-failed", "deployment-rolled-back",
    "debug-session-start", "debug-session-resolved",
    "stall-detected", "pressure-spike",
];

function _load() {
    try {
        const data = JSON.parse(fs.readFileSync(ANALYTICS_PATH, "utf8"));
        const now  = Date.now();
        return data.filter(e => now - e.ts < TTL_MS);
    } catch { return []; }
}

function _save(entries) {
    try { fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(entries.slice(-MAX_ENTRIES), null, 2)); } catch {}
}

// ── Record ────────────────────────────────────────────────────────────────────

function record(type, meta = {}) {
    if (!METRIC_TYPES.includes(type)) return;
    const entries = _load();
    entries.push({ type, ts: Date.now(), ...Object.fromEntries(Object.entries(meta).slice(0, 8)) });
    _save(entries);
}

// ── Summary ───────────────────────────────────────────────────────────────────

function summary() {
    const entries = _load();
    const now     = Date.now();

    const count = (type) => entries.filter(e => e.type === type).length;
    const countSince = (type, ms) => entries.filter(e => e.type === type && now - e.ts < ms).length;

    // Session metrics
    const sessionsStarted   = count("session-start");
    const sessionsCompleted = count("session-complete");
    const sessionsAbandoned = count("session-abandoned");
    const completionRate    = sessionsStarted > 0 ? Math.round((sessionsCompleted / sessionsStarted) * 100) : null;

    // Workflow metrics
    const wfRuns    = count("workflow-run");
    const wfSuccess = count("workflow-success");
    const wfFail    = count("workflow-failure");
    const wfSuccessRate = wfRuns > 0 ? Math.round((wfSuccess / wfRuns) * 100) : null;

    // Recovery metrics
    const recoveries        = count("recovery-triggered");
    const recoverySuccess   = count("recovery-success");
    const recoveryEffective = recoveries > 0 ? Math.round((recoverySuccess / recoveries) * 100) : null;

    // Deployment metrics
    const deplStarted = count("deployment-started");
    const deplPassed  = count("deployment-passed");
    const deplFailed  = count("deployment-failed");
    const deplRolled  = count("deployment-rolled-back");
    const deplReliability = deplStarted > 0 ? Math.round((deplPassed / deplStarted) * 100) : null;

    // Debugging metrics
    const debugStarts    = count("debug-session-start");
    const debugResolved  = count("debug-session-resolved");
    const debugEffective = debugStarts > 0 ? Math.round((debugResolved / debugStarts) * 100) : null;

    // Fatigue indicators (high activity in last hour)
    const recentStalls    = countSince("stall-detected", 60 * 60_000);
    const recentPressure  = countSince("pressure-spike",  60 * 60_000);
    const recentWfFails   = countSince("workflow-failure", 60 * 60_000);
    const fatigueScore    = Math.min(100, recentStalls * 20 + recentPressure * 15 + recentWfFails * 10);
    const fatigueLevel    = fatigueScore >= 60 ? "high" : fatigueScore >= 30 ? "moderate" : "low";

    return {
        sessions: { started: sessionsStarted, completed: sessionsCompleted, abandoned: sessionsAbandoned, completionRate },
        workflows: { runs: wfRuns, success: wfSuccess, failure: wfFail, successRate: wfSuccessRate },
        recovery:  { triggered: recoveries, successful: recoverySuccess, effectiveness: recoveryEffective },
        deployments: { started: deplStarted, passed: deplPassed, failed: deplFailed, rolledBack: deplRolled, reliability: deplReliability },
        debugging: { started: debugStarts, resolved: debugResolved, effectiveness: debugEffective },
        fatigue:   { score: fatigueScore, level: fatigueLevel, recentStalls, recentPressureSpikes: recentPressure, recentWorkflowFailures: recentWfFails },
        totalEvents: entries.length,
        ts: new Date().toISOString(),
    };
}

/**
 * Auto-record events from existing runtime state (non-invasive sweep).
 */
function sweep() {
    const pressure = _tryRequire("./runtimePressureMonitor.cjs");
    const recorded = [];

    if (pressure) {
        const p = pressure.computePressure();
        if (p.level === "high" || p.level === "critical") {
            record("pressure-spike", { level: p.level, score: p.score });
            recorded.push("pressure-spike");
        }
    }

    return { swept: recorded.length, recorded };
}

function storageStats() {
    const entries = _load();
    return { total: entries.length, max: MAX_ENTRIES, ttlDays: 30 };
}

module.exports = { record, summary, sweep, storageStats, METRIC_TYPES };
