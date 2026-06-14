"use strict";
/**
 * ImprovementLoop — Jarvis self-evaluation and weekly improvement reporting.
 * Track F, Priority F6 — Jarvis Brain project.
 *
 * Wraps continuousLearningEngine.cjs for failure/success analysis.
 * Collects self-evaluation metrics from existing data files.
 * Generates rule-based weekly self-improvement recommendations.
 *
 * Data sources (read-only):
 *   data/reasoned-recommendations.json   — prediction accuracy + reasoning quality
 *   data/healing-history.json            — deployment success/failure events
 *   data/autonomous-cycles.json          — cycle success, override detection
 *   data/recommendations.json            — acceptance/rejection rates
 *   data/task-queue.json                 — mission / task completion tracking
 *   data/agent-runs.json                 — agent success rates
 *   data/pattern-clusters.json           — error pattern data (error rate proxy)
 *
 * Writes (atomic .tmp → rename):
 *   data/improvement-reports.json        — weekly self-improvement reports
 *   data/improvement-metrics.json        — rolling metrics snapshots + override events
 *
 * Public API:
 *   collectMetrics()                                    → MetricsSnapshot
 *   generateWeeklyReport()                              → WeeklyReport (persisted)
 *   getLatestReport()                                   → WeeklyReport | null
 *   getReports(opts)                                    → WeeklyReport[]
 *   getMetricsHistory(weeks)                            → MetricsSnapshot[]
 *   getMetrics()                                        → MetricsSnapshot
 *   trackOperatorOverride(context)                      → void
 *   trackRecommendationOutcome(recId, accepted, outcome)→ void
 *   startWeeklySchedule()                               → Interval handle
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

// Wrap continuousLearningEngine — reuse its failure/success analysis
const learningEngine = require("./continuousLearningEngine.cjs");

// ── File paths ────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, "../../data");
const REPORTS_FILE   = path.join(DATA_DIR, "improvement-reports.json");
const METRICS_FILE   = path.join(DATA_DIR, "improvement-metrics.json");

const SRC = {
    reasonedRecs:  path.join(DATA_DIR, "reasoned-recommendations.json"),
    healHistory:   path.join(DATA_DIR, "healing-history.json"),
    cycles:        path.join(DATA_DIR, "autonomous-cycles.json"),
    recommendations: path.join(DATA_DIR, "recommendations.json"),
    taskQueue:     path.join(DATA_DIR, "task-queue.json"),
    agentRuns:     path.join(DATA_DIR, "agent-runs.json"),
    patternClusters: path.join(DATA_DIR, "pattern-clusters.json"),
};

// ── Utility helpers ───────────────────────────────────────────────────────
function _rj(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function _wj(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

function _safeWrite(file, data) {
    try { _wj(file, data); } catch (err) { logger.error(`[ImprovementLoop] Failed to write ${file}:`, err.message); }
}

function _pct(num, denom) {
    if (!denom || denom === 0) return 0;
    return Math.round((num / denom) * 100);
}

function _clamp(v) { return Math.max(0, Math.min(100, v)); }

// ── Improvement rules (rule-based, no AI calls) ───────────────────────────
const IMPROVEMENT_RULES = [
    { metric: "deploymentSuccessRate", threshold: 80,  op: "lt", recommendation: "Increase pre-deployment validation coverage and add automated smoke tests." },
    { metric: "rollbackFrequency",     threshold: 20,  op: "gt", recommendation: "Implement canary deployment gates before full rollout." },
    { metric: "predictionAccuracy",    threshold: 70,  op: "lt", recommendation: "Review reasoning engine confidence thresholds — increase minimum confidence before acting." },
    { metric: "operatorOverrideRate",  threshold: 30,  op: "gt", recommendation: "Autonomous decision quality is low — increase human-in-the-loop checkpoints." },
    { metric: "missionCompletionRate", threshold: 60,  op: "lt", recommendation: "Mission planning needs better scope decomposition — subtasks are too large or ambiguous." },
    { metric: "agentSuccessRate",      threshold: 85,  op: "lt", recommendation: "Agent execution reliability is below threshold — review tool execution layer for failures." },
    { metric: "errorRate",             threshold: 10,  op: "gt", recommendation: "Error rate is elevated — check error aggregator for top fingerprints and resolve root causes." },
];

// Human-friendly area labels for each metric key
const METRIC_LABELS = {
    predictionAccuracy:           "Prediction Accuracy",
    reasoningQuality:             "Reasoning Quality",
    deploymentSuccessRate:        "Deployment Success Rate",
    rollbackFrequency:            "Rollback Frequency",
    operatorOverrideRate:         "Operator Override Rate",
    recommendationAcceptanceRate: "Recommendation Acceptance Rate",
    missionCompletionRate:        "Mission Completion Rate",
    agentSuccessRate:             "Agent Success Rate",
    errorRate:                    "Error Rate",
    selfImprovementScore:         "Self-Improvement Score",
};

// ── Metric collection ─────────────────────────────────────────────────────

/**
 * collectMetrics()
 * Reads all relevant data files and computes self-evaluation metrics.
 * @returns {MetricsSnapshot}
 */
function collectMetrics() {
    const reasonedRecs   = _rj(SRC.reasonedRecs,    []);
    const healHistory    = _rj(SRC.healHistory,      []);
    const cycles         = _rj(SRC.cycles,           []);
    const recommendations = _rj(SRC.recommendations, []);
    const taskQueue      = _rj(SRC.taskQueue,        []);
    const agentRuns      = _rj(SRC.agentRuns,        []);
    const patternClusters = _rj(SRC.patternClusters, {});

    // Also pull from continuousLearningEngine for enriched success/failure data
    let engineStats = null;
    try { engineStats = learningEngine.getStats(); } catch { /* non-critical */ }

    // ── 1. Prediction accuracy
    // A recommendation "led to success" if its status is "applied" or "accepted"
    // For reasoned-recommendations, cross-reference with recommendations.json statuses
    const recStatusMap = new Map();
    for (const r of recommendations) {
        recStatusMap.set(r.recId, r.status);
    }
    let predSuccessCount  = 0;
    let predTotal         = reasonedRecs.length;
    let confidenceSum     = 0;
    let confidenceCount   = 0;
    for (const r of reasonedRecs) {
        const status = recStatusMap.get(r.recId) || r.status || "open";
        if (status === "applied" || status === "accepted" || status === "done" || status === "closed") {
            predSuccessCount++;
        }
        if (typeof r.confidence === "number") {
            confidenceSum += r.confidence;
            confidenceCount++;
        }
    }
    const predictionAccuracy = predTotal > 0 ? _clamp(_pct(predSuccessCount, predTotal)) : 0;

    // ── 2. Reasoning quality — average confidence score from reasoned-recommendations
    const reasoningQuality = confidenceCount > 0 ? _clamp(Math.round(confidenceSum / confidenceCount)) : 0;

    // ── 3. Deployment success rate & rollback frequency
    // healing-history: each record with strategy "restart_workflow" or similar is a deployment action
    // success=true → success, success=false → failure/rollback needed
    const healingRecords = Array.isArray(healHistory) ? healHistory : [];
    const deployEvents   = healingRecords.filter(h => h.strategy === "restart_workflow" || h.strategy === "deploy" || h.strategy === "rollback" || h.strategy === "hotfix");
    const deploySuccess  = deployEvents.filter(h => h.success === true).length;
    const deployFailed   = deployEvents.filter(h => h.success === false).length;
    const deployTotal    = deployEvents.length;

    // Also count completed vs failed cycles as proxy for deployment health
    const completedCycles = cycles.filter(c => c.status === "completed").length;
    const failedCycles    = cycles.filter(c => c.status === "failed").length;
    const totalCycles     = cycles.length;

    // Combined deployment success: weighted between healing events and cycle completions
    let deploymentSuccessRate = 0;
    let rollbackFrequency     = 0;

    if (deployTotal > 0 || totalCycles > 0) {
        const combinedSuccess = deploySuccess + completedCycles;
        const combinedTotal   = deployTotal + totalCycles;
        deploymentSuccessRate = _clamp(_pct(combinedSuccess, combinedTotal));

        const rollbackCount = deployFailed + failedCycles;
        rollbackFrequency   = _clamp(_pct(rollbackCount, combinedTotal));
    }

    // ── 4. Operator override rate
    // autonomous-cycles.json: status === "overridden"
    // + override events recorded in improvement-metrics.json
    const overriddenCycles  = cycles.filter(c => c.status === "overridden").length;
    const metricsStore      = _rj(METRICS_FILE, { snapshots: [], overrideEvents: [], outcomeEvents: [] });
    const overrideEvents    = Array.isArray(metricsStore.overrideEvents) ? metricsStore.overrideEvents : [];
    const totalOverrides    = overriddenCycles + overrideEvents.length;
    const autonomousBase    = Math.max(totalCycles, totalOverrides);
    const operatorOverrideRate = autonomousBase > 0 ? _clamp(_pct(totalOverrides, autonomousBase)) : 0;

    // ── 5. Recommendation acceptance rate
    // recommendations.json: status "applied" | "accepted" | "done" | "closed" = accepted
    // + outcome events from improvement-metrics.json
    const outcomeEvents   = Array.isArray(metricsStore.outcomeEvents) ? metricsStore.outcomeEvents : [];
    const acceptedOutcomes = outcomeEvents.filter(e => e.accepted === true).length;
    const rejectedOutcomes = outcomeEvents.filter(e => e.accepted === false).length;

    const acceptedRecs = recommendations.filter(r =>
        r.status === "applied" || r.status === "accepted" || r.status === "done" || r.status === "closed"
    ).length;
    const totalRecs = recommendations.length;

    const combinedAccepted = acceptedRecs + acceptedOutcomes;
    const combinedRecs     = totalRecs + acceptedOutcomes + rejectedOutcomes;
    const recommendationAcceptanceRate = combinedRecs > 0 ? _clamp(_pct(combinedAccepted, combinedRecs)) : 0;

    // ── 6. Mission completion rate
    // task-queue.json: tasks/missions with status "completed" vs total non-cancelled
    const allTasks        = Array.isArray(taskQueue) ? taskQueue : [];
    const completedTasks  = allTasks.filter(t => t.status === "completed" || t.status === "done").length;
    const cancelledTasks  = allTasks.filter(t => t.status === "cancelled" || t.status === "canceled").length;
    const missionBase     = allTasks.length - cancelledTasks;
    const missionCompletionRate = missionBase > 0 ? _clamp(_pct(completedTasks, missionBase)) : 0;

    // ── 7. Agent success rate
    // agent-runs.json: success count / total
    const allRuns     = Array.isArray(agentRuns) ? agentRuns : [];
    const successRuns = allRuns.filter(r => r.success === true).length;
    const agentSuccessRate = allRuns.length > 0 ? _clamp(_pct(successRuns, allRuns.length)) : 0;

    // ── 8. Error rate (errors per hour)
    // pattern-clusters.json: sum of totalAttempts that failed across all clusters
    // Use a 24h window proxy from available data
    let errorRate = 0;
    if (patternClusters && typeof patternClusters === "object") {
        const clusters     = Object.values(patternClusters);
        const totalErrors  = clusters.reduce((sum, c) => sum + (c.totalAttempts || 0) - (c.totalSuccesses || 0), 0);
        // Estimate time window: use earliest lastSeen vs now
        const timestamps   = clusters.map(c => c.lastSeen).filter(Boolean).map(t => new Date(t).getTime());
        if (timestamps.length > 0) {
            const earliest  = Math.min(...timestamps);
            const hoursSpan = Math.max(1, (Date.now() - earliest) / 3_600_000);
            errorRate       = Math.round((totalErrors / hoursSpan) * 10) / 10;
        } else {
            errorRate = 0;
        }
    }

    // ── 9. Self-improvement score (composite)
    // Invert rollbackFrequency and operatorOverrideRate before averaging (lower = better)
    // For errorRate: map to 0-100 score where < 1 = 100, >= 50 = 0
    const errorScore = _clamp(100 - Math.min(100, errorRate * 2));
    const scoreInputs = [
        predictionAccuracy,
        reasoningQuality,
        deploymentSuccessRate,
        _clamp(100 - rollbackFrequency),
        _clamp(100 - operatorOverrideRate),
        recommendationAcceptanceRate,
        missionCompletionRate,
        agentSuccessRate,
        errorScore,
    ];
    const selfImprovementScore = _clamp(Math.round(scoreInputs.reduce((a, b) => a + b, 0) / scoreInputs.length));

    // ── Data quality assessment
    const dataSampleCount =
        reasonedRecs.length +
        healingRecords.length +
        cycles.length +
        recommendations.length +
        allTasks.length +
        allRuns.length;

    const dataQuality = dataSampleCount < 10 ? "low" : dataSampleCount < 50 ? "medium" : "high";

    return {
        predictionAccuracy,
        reasoningQuality,
        deploymentSuccessRate,
        rollbackFrequency,
        operatorOverrideRate,
        recommendationAcceptanceRate,
        missionCompletionRate,
        agentSuccessRate,
        errorRate,
        selfImprovementScore,
        collectedAt: new Date().toISOString(),
        dataQuality,
        // raw counts for debugging / transparency
        _raw: {
            reasonedRecsTotal: predTotal,
            healingEventsTotal: deployTotal,
            cyclesTotal: totalCycles,
            recsTotal: totalRecs,
            tasksTotal: allTasks.length,
            agentRunsTotal: allRuns.length,
            overrideEventsRecorded: overrideEvents.length,
            outcomeEventsRecorded: outcomeEvents.length,
        },
    };
}

// ── Report generation ─────────────────────────────────────────────────────

/**
 * _applyRules(current)
 * Returns improvement recommendations triggered by current metric values.
 */
function _applyRules(current) {
    const improvements = [];
    for (const rule of IMPROVEMENT_RULES) {
        const value = current[rule.metric];
        if (value === undefined || value === null) continue;
        const triggered =
            (rule.op === "lt" && value < rule.threshold) ||
            (rule.op === "gt" && value > rule.threshold);
        if (triggered) {
            const isInverted = rule.op === "gt"; // higher = worse for rollback/override/error
            const targetScore = rule.op === "lt"
                ? Math.min(100, rule.threshold + 10)
                : Math.max(0, rule.threshold - 10);
            improvements.push({
                area:            METRIC_LABELS[rule.metric] || rule.metric,
                currentScore:    value,
                targetScore,
                recommendation:  rule.recommendation,
                priority:        _priorityFromScore(value, rule.threshold, isInverted),
            });
        }
    }
    // Sort by priority asc (1 = highest)
    return improvements.sort((a, b) => a.priority - b.priority);
}

function _priorityFromScore(value, threshold, isInverted) {
    const gap = isInverted ? value - threshold : threshold - value;
    if (gap >= 30) return 1;
    if (gap >= 15) return 2;
    return 3;
}

/**
 * _detectWins(current, previous)
 * Returns metrics that improved meaningfully vs the previous snapshot.
 */
function _detectWins(current, previous) {
    if (!previous) return [];
    const wins = [];
    const positiveMetrics = [
        "predictionAccuracy", "reasoningQuality", "deploymentSuccessRate",
        "recommendationAcceptanceRate", "missionCompletionRate", "agentSuccessRate",
        "selfImprovementScore",
    ];
    const negativeMetrics = ["rollbackFrequency", "operatorOverrideRate", "errorRate"];

    for (const m of positiveMetrics) {
        const delta = (current[m] ?? 0) - (previous[m] ?? 0);
        if (delta >= 5) {
            wins.push({
                area:        METRIC_LABELS[m] || m,
                improvement: `+${delta.toFixed(1)}%`,
                description: `${METRIC_LABELS[m] || m} improved from ${previous[m]}% to ${current[m]}%.`,
            });
        }
    }
    for (const m of negativeMetrics) {
        const delta = (previous[m] ?? 0) - (current[m] ?? 0);
        if (delta >= 5) {
            wins.push({
                area:        METRIC_LABELS[m] || m,
                improvement: `-${delta.toFixed(1)}`,
                description: `${METRIC_LABELS[m] || m} decreased from ${previous[m]} to ${current[m]} (lower is better).`,
            });
        }
    }
    return wins;
}

/**
 * _detectConcerns(current, previous)
 * Returns metrics that degraded meaningfully vs previous snapshot.
 */
function _detectConcerns(current, previous) {
    if (!previous) return [];
    const concerns = [];
    const positiveMetrics = [
        "predictionAccuracy", "reasoningQuality", "deploymentSuccessRate",
        "recommendationAcceptanceRate", "missionCompletionRate", "agentSuccessRate",
        "selfImprovementScore",
    ];
    const negativeMetrics = ["rollbackFrequency", "operatorOverrideRate", "errorRate"];

    for (const m of positiveMetrics) {
        const delta = (previous[m] ?? 0) - (current[m] ?? 0);
        if (delta >= 5) {
            concerns.push({
                area:    METRIC_LABELS[m] || m,
                trend:   `declining (${delta.toFixed(1)}% drop)`,
                description: `${METRIC_LABELS[m] || m} dropped from ${previous[m]}% to ${current[m]}%.`,
                urgency: delta >= 20 ? "high" : delta >= 10 ? "medium" : "low",
            });
        }
    }
    for (const m of negativeMetrics) {
        const delta = (current[m] ?? 0) - (previous[m] ?? 0);
        if (delta >= 5) {
            concerns.push({
                area:    METRIC_LABELS[m] || m,
                trend:   `worsening (+${delta.toFixed(1)})`,
                description: `${METRIC_LABELS[m] || m} increased from ${previous[m]} to ${current[m]} (lower is better).`,
                urgency: delta >= 20 ? "high" : delta >= 10 ? "medium" : "low",
            });
        }
    }
    return concerns.sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3);
    });
}

/**
 * _computeDelta(current, previous)
 * Returns per-metric numeric delta between two snapshots.
 */
function _computeDelta(current, previous) {
    if (!previous) return {};
    const allMetrics = Object.keys(METRIC_LABELS);
    const delta = {};
    for (const m of allMetrics) {
        const c = current[m];
        const p = previous[m];
        if (typeof c === "number" && typeof p === "number") {
            delta[m] = Math.round((c - p) * 10) / 10;
        }
    }
    return delta;
}

/**
 * generateWeeklyReport()
 * Runs collectMetrics(), analyses trends vs last week, generates improvement plan.
 * Persists report and metrics snapshot.
 * @returns {WeeklyReport}
 */
function generateWeeklyReport() {
    logger.info("[ImprovementLoop] Generating weekly self-improvement report...");

    // Also trigger learning engine's full analysis to keep lessons/recommendations fresh
    try { learningEngine.runFullAnalysis(); } catch (err) {
        logger.warn("[ImprovementLoop] Learning engine analysis error (non-fatal):", err.message);
    }

    const current = collectMetrics();

    // Load previous metrics snapshot (most recent weekly snapshot)
    const metricsStore = _rj(METRICS_FILE, { snapshots: [], overrideEvents: [], outcomeEvents: [] });
    const snapshots    = Array.isArray(metricsStore.snapshots) ? metricsStore.snapshots : [];
    const previous     = snapshots.length > 0 ? snapshots[snapshots.length - 1].metrics : null;

    const now   = new Date();
    const start = new Date(now.getTime() - 7 * 24 * 3600_000);

    const improvements = _applyRules(current);
    const wins         = _detectWins(current, previous);
    const concerns     = _detectConcerns(current, previous);
    const delta        = _computeDelta(current, previous);

    const report = {
        reportId:    `rpt_${crypto.randomUUID()}`,
        period:      { start: start.toISOString(), end: now.toISOString() },
        metrics:     {
            current,
            previous:  previous || null,
            delta,
        },
        improvements,
        wins,
        concerns,
        generatedAt: now.toISOString(),
        dataQuality: current.dataQuality,
    };

    // Persist report — keep last 52 weeks
    const reportsStore = _rj(REPORTS_FILE, []);
    const reports      = Array.isArray(reportsStore) ? reportsStore : [];
    reports.push(report);
    _safeWrite(REPORTS_FILE, reports.slice(-52));

    // Persist metrics snapshot — keep last 12 weeks
    snapshots.push({ snapshotAt: now.toISOString(), metrics: current });
    metricsStore.snapshots = snapshots.slice(-12);
    _safeWrite(METRICS_FILE, metricsStore);

    logger.info(
        `[ImprovementLoop] Report generated: ${report.reportId} — ` +
        `score=${current.selfImprovementScore} ` +
        `improvements=${improvements.length} wins=${wins.length} concerns=${concerns.length}`
    );

    return report;
}

// ── Report retrieval ──────────────────────────────────────────────────────

/**
 * getLatestReport()
 * Returns the most recent weekly report.
 * @returns {WeeklyReport | null}
 */
function getLatestReport() {
    const reports = _rj(REPORTS_FILE, []);
    if (!Array.isArray(reports) || reports.length === 0) return null;
    return reports[reports.length - 1];
}

/**
 * getReports(opts)
 * @param {{ limit?: number, since?: string }} opts
 * @returns {WeeklyReport[]}
 */
function getReports({ limit = 20, since } = {}) {
    const reports = _rj(REPORTS_FILE, []);
    if (!Array.isArray(reports)) return [];
    let rows = [...reports].reverse(); // newest first
    if (since) {
        const cutoff = new Date(since);
        rows = rows.filter(r => new Date(r.generatedAt) >= cutoff);
    }
    return rows.slice(0, limit);
}

// ── Metrics history ───────────────────────────────────────────────────────

/**
 * getMetricsHistory(weeks)
 * @param {number} weeks - how many weekly snapshots to return (default: 12)
 * @returns {Array<{ snapshotAt: string, metrics: MetricsSnapshot }>}
 */
function getMetricsHistory(weeks = 12) {
    const store     = _rj(METRICS_FILE, { snapshots: [] });
    const snapshots = Array.isArray(store.snapshots) ? store.snapshots : [];
    return snapshots.slice(-Math.max(1, Math.min(52, weeks)));
}

/**
 * getMetrics()
 * Runs collectMetrics() and returns current snapshot without generating a report.
 * @returns {MetricsSnapshot}
 */
function getMetrics() {
    return collectMetrics();
}

// ── Tracking ──────────────────────────────────────────────────────────────

/**
 * trackOperatorOverride(context)
 * Records that an operator manually overrode an autonomous decision.
 * Appended to improvement-metrics.json as an override event.
 * @param {{ decisionId: string, reason: string, outcome: string }} context
 */
function trackOperatorOverride(context) {
    const store        = _rj(METRICS_FILE, { snapshots: [], overrideEvents: [], outcomeEvents: [] });
    const overrides    = Array.isArray(store.overrideEvents) ? store.overrideEvents : [];

    overrides.push({
        eventId:    `ovr_${crypto.randomUUID()}`,
        decisionId: context.decisionId || null,
        reason:     context.reason     || null,
        outcome:    context.outcome    || null,
        recordedAt: new Date().toISOString(),
    });

    store.overrideEvents = overrides.slice(-1000); // keep last 1000 events
    _safeWrite(METRICS_FILE, store);

    logger.info(`[ImprovementLoop] Operator override recorded: decisionId=${context.decisionId}`);
}

/**
 * trackRecommendationOutcome(recId, accepted, outcome)
 * Records whether a recommendation was accepted/rejected and the resulting outcome.
 * @param {string} recId
 * @param {boolean} accepted
 * @param {string} outcome - free-text description of what happened
 */
function trackRecommendationOutcome(recId, accepted, outcome) {
    const store    = _rj(METRICS_FILE, { snapshots: [], overrideEvents: [], outcomeEvents: [] });
    const outcomes = Array.isArray(store.outcomeEvents) ? store.outcomeEvents : [];

    outcomes.push({
        eventId:    `out_${crypto.randomUUID()}`,
        recId:      recId   || null,
        accepted:   Boolean(accepted),
        outcome:    outcome || null,
        recordedAt: new Date().toISOString(),
    });

    store.outcomeEvents = outcomes.slice(-1000);
    _safeWrite(METRICS_FILE, store);

    logger.info(
        `[ImprovementLoop] Recommendation outcome recorded: recId=${recId} accepted=${accepted}`
    );

    // Mirror acceptance into learning engine recommendation status
    if (recId) {
        try {
            learningEngine.updateRecommendation(recId, {
                status:    accepted ? "accepted" : "dismissed",
                outcome:   outcome  || null,
                resolvedAt: new Date().toISOString(),
            });
        } catch { /* recommendation may not exist in learningEngine — non-fatal */ }
    }
}

// ── Weekly schedule ───────────────────────────────────────────────────────

/**
 * startWeeklySchedule()
 * Starts a background interval to run generateWeeklyReport() every 7 days.
 * Calls .unref() so the interval does not prevent the process from exiting.
 * @returns {NodeJS.Timeout} interval handle
 */
function startWeeklySchedule() {
    const WEEK_MS  = 604_800_000;
    const interval = setInterval(() => {
        logger.info("[ImprovementLoop] Weekly schedule tick — running self-improvement report");
        try { generateWeeklyReport(); } catch (err) {
            logger.error("[ImprovementLoop] Weekly report error:", err.message);
        }
    }, WEEK_MS);

    if (typeof interval.unref === "function") interval.unref();
    logger.info("[ImprovementLoop] Weekly self-improvement schedule started (7-day interval).");
    return interval;
}

// ── Exports ───────────────────────────────────────────────────────────────
module.exports = {
    collectMetrics,
    generateWeeklyReport,
    getLatestReport,
    getReports,
    getMetricsHistory,
    getMetrics,
    trackOperatorOverride,
    trackRecommendationOutcome,
    startWeeklySchedule,
};
