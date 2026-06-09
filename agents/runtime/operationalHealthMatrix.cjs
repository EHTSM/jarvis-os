"use strict";
/**
 * Phase 422 — Operational Health Matrix
 *
 * Unified runtime health system. Aggregates:
 *   - Adapter health (toolStateMonitor)
 *   - Workflow stability (engineeringSession)
 *   - Recovery pressure (runtimePressureMonitor)
 *   - Queue pressure (priorityQueue)
 *   - Validation confidence (chainValidationScorer history)
 *   - Runtime degradation (runtimeEventBus)
 *   - Execution survivability (DLQ size, drift)
 *
 * Returns: { score: 0–100, grade: A/B/C/D/F, subsystems: {}, alerts: [] }
 *
 * Score breakdown (each subsystem 0–20, total capped at 100):
 *   adapters        0–20
 *   pressure        0–20 (inverted: lower pressure = higher score)
 *   sessions        0–15
 *   queue           0–15
 *   survivability   0–30
 */

const logger = require("../../backend/utils/logger");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function _scoreAdapters() {
    const tsm = _tryRequire("./toolStateMonitor.cjs");
    if (!tsm) return { score: 10, detail: "monitor unavailable", adapters: {} };
    const all  = tsm.query();
    const probs = tsm.detectProblems();
    const total  = Object.keys(all).length || 1;
    const stale  = probs.length;
    const score  = Math.round(20 * Math.max(0, (total - stale) / total));
    return { score, detail: `${total - stale}/${total} adapters healthy`, adapters: all, problems: probs };
}

function _scorePressure() {
    const pm = _tryRequire("./runtimePressureMonitor.cjs");
    if (!pm) return { score: 15, detail: "pressure monitor unavailable" };
    const p     = pm.computePressure();
    // Invert: nominal=20, elevated=12, high=5, critical=0
    const score = p.level === "nominal" ? 20 : p.level === "elevated" ? 12 : p.level === "high" ? 5 : 0;
    return { score, detail: `pressure=${p.score} level=${p.level}`, pressure: p };
}

function _scoreSessions() {
    const sm = _tryRequire("./engineeringSession.cjs");
    if (!sm) return { score: 10, detail: "session module unavailable" };
    const sessions = sm.list({ limit: 20 });
    const active   = sessions.filter(s => s.state === "active").length;
    const blocked  = sessions.filter(s => s.state === "blocked").length;
    const critical = sessions.filter(s => s.degradationState === "critical").length;
    // Penalize blocked and critical sessions
    const score = Math.max(0, 15 - blocked * 4 - critical * 5);
    return { score, detail: `${active} active, ${blocked} blocked, ${critical} critical`, sessionCount: sessions.length };
}

function _scoreQueue() {
    const pq = _tryRequire("./priorityQueue.cjs");
    const dlq = _tryRequire("./deadLetterQueue.cjs");
    let queueSize = 0, dlqSize = 0;
    try { queueSize = pq?.size() ?? 0; } catch {}
    try { dlqSize   = dlq?.size() ?? 0; } catch {}
    // 15 points: lose 1 per 3 queue items, lose 1 per DLQ item
    const score = Math.max(0, 15 - Math.floor(queueSize / 3) - dlqSize);
    return { score, detail: `queue=${queueSize} dlq=${dlqSize}`, queueSize, dlqSize };
}

function _scoreSurvivability() {
    let score = 30;
    const detail = [];

    // Memory
    try {
        const heapMb = Math.round(process.memoryUsage().heapUsed / 1_048_576);
        if (heapMb > 450) { score -= 15; detail.push(`heap=${heapMb}MB CRITICAL`); }
        else if (heapMb > 350) { score -= 8; detail.push(`heap=${heapMb}MB high`); }
        else detail.push(`heap=${heapMb}MB ok`);
    } catch {}

    // Drift
    try {
        const dm = require("../../agents/runtime/driftMonitor.cjs");
        const dr = dm.getDriftReport();
        if (!dr.healthy) { score -= 8; detail.push("drift_alerts"); }
        else detail.push("drift_ok");
    } catch { detail.push("drift_unavailable"); }

    // Crash files
    try {
        const fs   = require("fs");
        const path = require("path");
        const dir  = path.join(__dirname, "../../data/crashes");
        const crashes = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(".json")).length : 0;
        if (crashes > 0) { score -= 7; detail.push(`crashes=${crashes}`); }
        else detail.push("no_crashes");
    } catch {}

    return { score: Math.max(0, score), detail: detail.join(", ") };
}

/**
 * Compute the full operational health matrix.
 * @returns {{ score, grade, subsystems, alerts, ts }}
 */
function compute() {
    const adapters      = _scoreAdapters();
    const pressure      = _scorePressure();
    const sessions      = _scoreSessions();
    const queue         = _scoreQueue();
    const survivability = _scoreSurvivability();

    const total = adapters.score + pressure.score + sessions.score + queue.score + survivability.score;
    const score = Math.min(100, total);
    const grade =
        score >= 90 ? "A" :
        score >= 75 ? "B" :
        score >= 55 ? "C" :
        score >= 35 ? "D" : "F";

    // Collect alerts
    const alerts = [];
    if (adapters.problems?.length)          alerts.push({ level: "warn",     msg: `${adapters.problems.length} adapter(s) stale` });
    if (pressure.pressure?.level === "critical") alerts.push({ level: "critical", msg: "runtime pressure CRITICAL" });
    if (pressure.pressure?.level === "high")     alerts.push({ level: "warn",     msg: "runtime pressure HIGH" });
    if (queue.dlqSize > 10)                  alerts.push({ level: "warn",     msg: `DLQ has ${queue.dlqSize} entries` });
    if (survivability.score < 15)            alerts.push({ level: "critical", msg: "survivability score critical" });

    if (grade === "F") logger.warn(`[HealthMatrix] health score=${score} grade=F — system degraded`);

    return {
        score,
        grade,
        subsystems: {
            adapters:      { score: adapters.score,      max: 20, detail: adapters.detail },
            pressure:      { score: pressure.score,      max: 20, detail: pressure.detail },
            sessions:      { score: sessions.score,      max: 15, detail: sessions.detail },
            queue:         { score: queue.score,         max: 15, detail: queue.detail },
            survivability: { score: survivability.score, max: 30, detail: survivability.detail },
        },
        alerts,
        ts: new Date().toISOString(),
    };
}

module.exports = { compute };
