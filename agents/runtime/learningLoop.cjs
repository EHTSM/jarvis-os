"use strict";
/**
 * learningLoop — runtime learning feedback coordinator.
 *
 * High-level API over failureMemory + patternCluster for continuous adaptation:
 *
 *   reinforceWorkflow(name, stepDetails)
 *     Successful run: reinforce strategy confidence for any step that recovered.
 *
 *   decayWorkflow(name, failedStep, errorType)
 *     Failed run: decay confidence for strategies associated with the failed step.
 *
 *   getConfidence(stepName, failureType?)
 *     Current aggregate success rate for a step from cluster history.
 *
 *   learningReport()
 *     Full snapshot of all learned patterns and strategy confidence levels.
 *
 * The actual confidence numbers live in failureMemory and patternCluster.
 * learningLoop is the high-level coordinator that wires them together after
 * each workflow completes.
 */

const memory  = require("./failureMemory.cjs");
const pcl     = require("./patternCluster.cjs");

// ── Feedback ──────────────────────────────────────────────────────────

/**
 * Reinforce learning after a successful workflow execution.
 * For each step that completed after recovery, record a verified outcome
 * in both failureMemory and patternCluster.
 *
 * @param {string}   workflowName
 * @param {object[]} stepDetails  — WorkflowResult.stepDetails
 */
function reinforceWorkflow(workflowName, stepDetails = []) {
    for (const step of stepDetails) {
        if (step.status !== "completed" || (step.recoveries || 0) === 0) continue;

        const clusters = pcl.getClusters().filter(c =>
            c.stepName && (
                step.name.includes(c.stepName) ||
                c.stepName.includes(step.name)
            )
        );

        for (const c of clusters) {
            if (!c.bestStrategy) continue;
            // Double-record on verified recovery success (same signal as recordVerifiedOutcome)
            memory.recordOutcome(c.failureType, c.bestStrategy, true);
            memory.recordOutcome(c.failureType, c.bestStrategy, true);
            pcl.record(c.failureType, step.name, c.bestStrategy, true);
        }
    }
}

/**
 * Decay learning after a workflow failure.
 * Records a failure signal for all strategies associated with the failing step.
 *
 * @param {string} workflowName
 * @param {object} failedStep    — one entry from WorkflowResult.stepDetails
 * @param {string} errorType     — failure type classification (F constant)
 */
function decayWorkflow(workflowName, failedStep, errorType) {
    if (!failedStep || !errorType) return;

    const clusters = pcl.getClusters().filter(c =>
        c.failureType === errorType &&
        c.stepName && (
            failedStep.name.includes(c.stepName) ||
            c.stepName.includes(failedStep.name)
        )
    );

    for (const c of clusters) {
        if (c.bestStrategy) {
            memory.recordOutcome(c.failureType, c.bestStrategy, false);
        }
    }
}

// ── Query ─────────────────────────────────────────────────────────────

/**
 * Current aggregate confidence for a step (from cluster history).
 * Returns null if there is no data.
 *
 * @param {string} stepName
 * @param {string} failureType  — optional; restricts search to this type
 * @returns {number|null}  0–1 success rate
 */
function getConfidence(stepName, failureType) {
    const clusters = pcl.getClusters().filter(c =>
        c.stepName &&
        (stepName.includes(c.stepName) || c.stepName.includes(stepName)) &&
        (!failureType || c.failureType === failureType)
    );

    if (clusters.length === 0) return null;

    const totalAttempts  = clusters.reduce((s, c) => s + c.totalAttempts,  0);
    const totalSuccesses = clusters.reduce((s, c) => s + c.totalSuccesses, 0);

    return totalAttempts > 0
        ? parseFloat((totalSuccesses / totalAttempts).toFixed(3))
        : null;
}

/**
 * Full learning state report.
 */
function learningReport() {
    const clusters  = pcl.getClusters();
    const memSnap   = memory.snapshot();
    const strategies = [];

    for (const [ft, strats] of Object.entries(memSnap)) {
        for (const [sid, data] of Object.entries(strats)) {
            strategies.push({
                failureType: ft,
                strategyId:  sid,
                attempts:    data.attempts,
                successes:   data.successes,
                successRate: data.attempts > 0
                    ? parseFloat((data.successes / data.attempts).toFixed(3))
                    : 0,
                lastSeen:    data.lastSeen,
            });
        }
    }

    return {
        totalClusters:   clusters.length,
        totalStrategies: strategies.length,
        strategies:      strategies.sort((a, b) => b.attempts - a.attempts),
        clusters: clusters.map(c => ({
            id:            c.id,
            failureType:   c.failureType,
            stepPattern:   c.stepName,
            successRate:   parseFloat(c.successRate.toFixed(3)),
            totalAttempts: c.totalAttempts,
            bestStrategy:  c.bestStrategy,
        })),
        generatedAt: new Date().toISOString(),
    };
}

module.exports = {
    reinforceWorkflow,
    decayWorkflow,
    getConfidence,
    learningReport,
};
