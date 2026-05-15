"use strict";
/**
 * executionPriorityEngine — computes priority scores for queued executions.
 * Incorporates authority level, urgency, aging (starvation prevention),
 * risk score, and retry count. Higher score = higher priority.
 *
 * computePriority(spec)          → { score, breakdown, priorityClass }
 * rankExecutions(executions[])   → ExecutionRef[] sorted high→low
 * applyAging(executions[])       → ExecutionRef[] with updated scores
 * getPriorityMetrics()           → PriorityMetrics
 * reset()
 *
 * Priority classes: emergency(≥90), critical(≥70), high(≥50), normal(≥30), low(<30)
 */

const AUTHORITY_WEIGHT = { observer: 1, operator: 2, controller: 3, governor: 4, "root-runtime": 5 };
const URGENCY_WEIGHT   = { low: 1, normal: 2, high: 3, critical: 4, emergency: 5 };

const PRIORITY_CLASSES = [
    { label: "emergency", min: 90 },
    { label: "critical",  min: 70 },
    { label: "high",      min: 50 },
    { label: "normal",    min: 30 },
    { label: "low",       min:  0 },
];

const AGING_RATE_PER_SEC = 0.5;    // score boost per second of waiting
const MAX_AGING_BONUS    = 30;     // cap starvation bonus

let _history = [];
let _counter = 0;

function _priorityClass(score) {
    for (const c of PRIORITY_CLASSES) if (score >= c.min) return c.label;
    return "low";
}

// ── computePriority ────────────────────────────────────────────────────

function computePriority(spec = {}) {
    const {
        authorityLevel = "operator",
        urgency        = "normal",
        riskScore      = 0,
        retryCount     = 0,
        waitSinceMs    = 0,      // milliseconds the execution has been waiting
        dryRun         = false,
        recovery       = false,
    } = spec;

    const authScore    = (AUTHORITY_WEIGHT[authorityLevel] ?? 2) * 8;   // max 40
    const urgScore     = (URGENCY_WEIGHT[urgency]          ?? 2) * 7;   // max 35
    const retryBonus   = Math.min(retryCount * 2, 8);                   // max 8  (retries need service)
    const recovBonus   = recovery  ? 5 : 0;
    const riskPenalty  = Math.round(riskScore * 5);                     // high risk lowers priority
    const agingBonus   = Math.min(Math.round((waitSinceMs / 1000) * AGING_RATE_PER_SEC), MAX_AGING_BONUS);
    const dryRunPenalty = dryRun ? 5 : 0;

    const raw   = authScore + urgScore + retryBonus + recovBonus + agingBonus - riskPenalty - dryRunPenalty;
    const score = Math.max(0, Math.min(100, raw));

    const breakdown = { authScore, urgScore, retryBonus, recovBonus, agingBonus, riskPenalty, dryRunPenalty };
    const priorityClass = _priorityClass(score);

    _history.push({ score, priorityClass, timestamp: new Date().toISOString() });
    if (_history.length > 10000) _history.shift();

    return { score, breakdown, priorityClass };
}

// ── rankExecutions ─────────────────────────────────────────────────────

function rankExecutions(executions = []) {
    return executions
        .map(e => {
            const p = computePriority(e);
            return { ...e, priorityScore: p.score, priorityClass: p.priorityClass };
        })
        .sort((a, b) => b.priorityScore - a.priorityScore);
}

// ── applyAging ─────────────────────────────────────────────────────────

function applyAging(executions = [], nowMs = Date.now()) {
    return executions.map(e => {
        const enqueuedAt = e.enqueuedAt ? new Date(e.enqueuedAt).getTime() : nowMs;
        const waitSinceMs = nowMs - enqueuedAt;
        const p = computePriority({ ...e, waitSinceMs });
        return { ...e, priorityScore: p.score, priorityClass: p.priorityClass, waitSinceMs };
    }).sort((a, b) => b.priorityScore - a.priorityScore);
}

// ── getPriorityMetrics ─────────────────────────────────────────────────

function getPriorityMetrics() {
    const byClass = {};
    for (const c of PRIORITY_CLASSES) byClass[c.label] = 0;
    for (const h of _history) byClass[h.priorityClass] = (byClass[h.priorityClass] ?? 0) + 1;
    const scores    = _history.map(h => h.score);
    const avgScore  = scores.length ? Math.round(scores.reduce((a, v) => a + v, 0) / scores.length) : 0;
    return { totalComputed: _history.length, avgScore, byClass };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() { _history = []; _counter = 0; }

module.exports = {
    AUTHORITY_WEIGHT, URGENCY_WEIGHT, PRIORITY_CLASSES,
    AGING_RATE_PER_SEC, MAX_AGING_BONUS,
    computePriority, rankExecutions, applyAging, getPriorityMetrics, reset,
};
