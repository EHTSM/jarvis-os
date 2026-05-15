"use strict";
/**
 * telemetry — structured runtime reports and observability snapshots.
 *
 *   snapshotWorkflow(result, traceId, opts)
 *     Machine-readable record of one workflow execution.
 *
 *   strategyPerformanceSnapshot()
 *     All recorded strategy outcomes from failureMemory, sorted by usage.
 *
 *   predictionAccuracyReport()
 *     Compares failurePredictor thresholds to observed cluster success rates.
 *
 *   workflowSummary(results[])
 *     Aggregate stats across a batch of workflow results.
 *
 * All outputs are plain JSON-serialisable objects — no I/O side effects.
 */

const memory = require("./failureMemory.cjs");
const pcl    = require("./patternCluster.cjs");
const obs    = require("./observability.cjs");

// ── Workflow snapshot ─────────────────────────────────────────────────

/**
 * Produce a machine-readable snapshot of one workflow execution result.
 *
 * @param {WorkflowResult} result   — from runWorkflow / executePlan
 * @param {string|null}    traceId  — from tracer (if tracing was enabled)
 * @param {object}         opts     — { extra: {} } merged into output
 * @returns {object}
 */
function snapshotWorkflow(result, traceId = null, opts = {}) {
    const timeline = result.id ? obs.timelineFor(result.id) : [];

    return {
        schemaVersion: "1.0",
        workflowId:    result.id,
        workflowName:  result.name,
        traceId:       traceId || null,
        success:       result.success,
        error:         result.error || null,
        durationMs:    result.durationMs,
        completedAt:   result.completedAt,
        healthScore:   result.healthScore || 0,
        executionScore: result.executionScore || null,
        steps: {
            total:     result.steps?.total     ?? 0,
            completed: result.steps?.completed ?? 0,
            failed:    result.steps?.failed    ?? 0,
            skipped:   result.steps?.skipped   ?? 0,
        },
        stepDetails:  result.stepDetails  || [],
        timeline:     timeline.slice(0, 200),
        generatedAt:  new Date().toISOString(),
        ...(opts.extra || {}),
    };
}

// ── Strategy performance snapshot ────────────────────────────────────

/**
 * Returns all recorded strategy outcomes from failureMemory,
 * sorted by usage (most-used first).
 *
 * @returns {object[]}
 */
function strategyPerformanceSnapshot() {
    const snap   = memory.snapshot();
    const output = [];

    for (const [failureType, strategies] of Object.entries(snap)) {
        for (const [strategyId, data] of Object.entries(strategies)) {
            const rate = data.attempts > 0 ? data.successes / data.attempts : 0;
            output.push({
                failureType,
                strategyId,
                attempts:    data.attempts,
                successes:   data.successes,
                failures:    data.attempts - data.successes,
                successRate: parseFloat(rate.toFixed(3)),
                lastSeen:    data.lastSeen,
            });
        }
    }

    return output.sort((a, b) => b.attempts - a.attempts);
}

// ── Prediction accuracy report ────────────────────────────────────────

/**
 * Compares the failurePredictor's risk threshold (< 40% successRate → flagged)
 * against observed cluster outcomes to measure prediction accuracy.
 *
 * @returns {{ total, correct, accuracy, records[], generatedAt }}
 */
function predictionAccuracyReport() {
    const clusters = pcl.getClusters();
    const records  = [];

    for (const c of clusters) {
        if (c.totalAttempts < 3) continue;

        const predictedHighRisk = c.successRate < 0.40;  // repeatedFailureScan threshold
        const observedHighRisk  = c.successRate < 0.50;  // majority of attempts failed

        records.push({
            clusterId:        c.id,
            stepPattern:      c.stepName,
            failureType:      c.failureType,
            successRate:      parseFloat(c.successRate.toFixed(3)),
            totalAttempts:    c.totalAttempts,
            predictedHighRisk,
            observedHighRisk,
            correct:          predictedHighRisk === observedHighRisk,
        });
    }

    const total    = records.length;
    const correct  = records.filter(r => r.correct).length;
    const accuracy = total > 0 ? parseFloat((correct / total).toFixed(3)) : null;

    return { total, correct, accuracy, records, generatedAt: new Date().toISOString() };
}

// ── Workflow summary ──────────────────────────────────────────────────

/**
 * Aggregate summary across a batch of workflow results.
 *
 * @param {WorkflowResult[]} results
 * @returns {object}
 */
function workflowSummary(results) {
    if (!results || results.length === 0) {
        return { total: 0, succeeded: 0, failed: 0, successRate: 0, avgDurationMs: 0, avgHealthScore: 0, generatedAt: new Date().toISOString() };
    }

    const total    = results.length;
    const succeeded = results.filter(r => r.success).length;
    const durations = results.map(r => r.durationMs || 0);
    const healths   = results.map(r => r.healthScore || 0);

    return {
        total,
        succeeded,
        failed:         total - succeeded,
        successRate:    parseFloat((succeeded / total).toFixed(3)),
        avgDurationMs:  Math.round(durations.reduce((s, v) => s + v, 0) / total),
        avgHealthScore: Math.round(healths.reduce((s, v) => s + v, 0) / total),
        generatedAt:    new Date().toISOString(),
    };
}

module.exports = {
    snapshotWorkflow,
    strategyPerformanceSnapshot,
    predictionAccuracyReport,
    workflowSummary,
};
