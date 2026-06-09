"use strict";
/**
 * Phase 580 — Real Daily Engineering Validation
 *
 * Measures actual daily engineering productivity: debugging survivability,
 * deployment success, recovery effectiveness, patch trust, replay usefulness.
 *
 * Reports real metrics — no synthetic scores. Measures trust over time.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const REPORT_PATH = path.join(__dirname, "../../data/daily-engineering-validation.json");

function _load() {
    try { return JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")); }
    catch { return { days: [] }; }
}

function _save(db) {
    try { fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true }); fs.writeFileSync(REPORT_PATH, JSON.stringify(db, null, 2)); } catch {}
}

function _todayKey() {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _getOrCreateDay(db, key) {
    let day = db.days.find(d => d.date === key);
    if (!day) {
        day = { date: key, debugging: { sessions: 0, resolved: 0, avgTimeMs: 0 }, deployments: { attempts: 0, successes: 0, rollbacks: 0 }, patches: { proposed: 0, applied: 0, rolledBack: 0 }, recovery: { chains: 0, successes: 0 }, replays: { used: 0, useful: 0 }, sessions: 0 };
        db.days.unshift(day);
        db.days = db.days.slice(0, 30); // keep 30 days
    }
    return day;
}

// ── Event recording ───────────────────────────────────────────────────────────

function recordDebuggingSession({ resolved = false, durationMs = 0 } = {}) {
    const db  = _load();
    const day = _getOrCreateDay(db, _todayKey());
    day.debugging.sessions++;
    if (resolved) day.debugging.resolved++;
    if (durationMs > 0) {
        const prev = day.debugging.avgTimeMs;
        day.debugging.avgTimeMs = prev === 0 ? durationMs : Math.round((prev + durationMs) / 2);
    }
    _save(db);
}

function recordDeployment({ success = false, rollback = false } = {}) {
    const db  = _load();
    const day = _getOrCreateDay(db, _todayKey());
    day.deployments.attempts++;
    if (success)  day.deployments.successes++;
    if (rollback) day.deployments.rollbacks++;
    _save(db);
}

function recordPatch({ applied = false, rolledBack = false } = {}) {
    const db  = _load();
    const day = _getOrCreateDay(db, _todayKey());
    day.patches.proposed++;
    if (applied)    day.patches.applied++;
    if (rolledBack) day.patches.rolledBack++;
    _save(db);
}

function recordRecovery({ success = false } = {}) {
    const db  = _load();
    const day = _getOrCreateDay(db, _todayKey());
    day.recovery.chains++;
    if (success) day.recovery.successes++;
    _save(db);
}

function recordReplay({ useful = false } = {}) {
    const db  = _load();
    const day = _getOrCreateDay(db, _todayKey());
    day.replays.used++;
    if (useful) day.replays.useful++;
    _save(db);
}

// ── Daily report ──────────────────────────────────────────────────────────────

function todayReport() {
    const db  = _load();
    const day = db.days.find(d => d.date === _todayKey());
    if (!day) return { date: _todayKey(), empty: true, summary: "No engineering activity recorded today" };

    const debugRate  = day.debugging.sessions > 0   ? Math.round(day.debugging.resolved   / day.debugging.sessions * 100)   : 0;
    const deployRate = day.deployments.attempts > 0 ? Math.round(day.deployments.successes / day.deployments.attempts * 100) : 0;
    const patchRate  = day.patches.proposed > 0     ? Math.round(day.patches.applied       / day.patches.proposed * 100)     : 0;
    const recovRate  = day.recovery.chains > 0      ? Math.round(day.recovery.successes    / day.recovery.chains * 100)      : 0;
    const replayRate = day.replays.used > 0         ? Math.round(day.replays.useful        / day.replays.used * 100)         : 0;

    return {
        date: day.date,
        debugging:   { ...day.debugging,   resolutionRate: debugRate },
        deployments: { ...day.deployments, successRate:    deployRate },
        patches:     { ...day.patches,     applyRate:      patchRate },
        recovery:    { ...day.recovery,    successRate:    recovRate },
        replays:     { ...day.replays,     usefulRate:     replayRate },
        overallTrust: Math.round((debugRate + deployRate + patchRate + recovRate) / 4),
        summary:     `Debug:${debugRate}% Deploy:${deployRate}% Patch:${patchRate}% Recovery:${recovRate}% Replay:${replayRate}%`,
    };
}

function weeklyReport() {
    const db   = _load();
    const days = db.days.slice(0, 7);
    if (days.length === 0) return { empty: true };

    const totals = days.reduce((acc, d) => {
        acc.debugSessions   += d.debugging.sessions;
        acc.debugResolved   += d.debugging.resolved;
        acc.deployAttempts  += d.deployments.attempts;
        acc.deploySuccesses += d.deployments.successes;
        acc.patchesApplied  += d.patches.applied;
        acc.recoverySuccess += d.recovery.successes;
        acc.replayUseful    += d.replays.useful;
        return acc;
    }, { debugSessions: 0, debugResolved: 0, deployAttempts: 0, deploySuccesses: 0, patchesApplied: 0, recoverySuccess: 0, replayUseful: 0 });

    return {
        days:              days.length,
        debugResolutionRate: totals.debugSessions > 0   ? Math.round(totals.debugResolved   / totals.debugSessions   * 100) : 0,
        deploySuccessRate:   totals.deployAttempts > 0  ? Math.round(totals.deploySuccesses  / totals.deployAttempts  * 100) : 0,
        totals,
        trend:             days.map(d => ({ date: d.date, sessions: d.debugging.sessions + d.deployments.attempts })),
    };
}

module.exports = { recordDebuggingSession, recordDeployment, recordPatch, recordRecovery, recordReplay, todayReport, weeklyReport };
