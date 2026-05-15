"use strict";
/**
 * executionOptimizer — autonomous step ordering and retry reduction.
 *
 *   reorderSteps(steps, graphAnalysis)
 *     Respects topological order from parallelGroups.
 *     Within each parallel group, sorts by historical reliability (best first).
 *
 *   filterRedundantRetries(steps, opts)
 *     Reduces maxRetries to 1 for steps with very high historical success rate.
 *
 *   skipLowSuccessStrategies(strategies, opts)
 *     Filters out recovery strategies whose aggregate cluster success rate
 *     is below threshold with sufficient samples.
 *
 *   workflowPriorityScore(workflowName)
 *     Returns 0–100 priority based on historical success rate + data volume.
 */

const pcl     = require("./patternCluster.cjs");
const history = require("./executionHistory.cjs");

const DEFAULT_REDUNDANCY_THRESHOLD = 0.90;  // steps above this get maxRetries=1
const DEFAULT_SKIP_THRESHOLD       = 0.10;  // strategies below this are skipped

// ── Step reordering ───────────────────────────────────────────────────

/**
 * Reorder steps according to dependency topology, then sort within each
 * parallel group by historical success rate (most reliable first).
 *
 * @param {object[]} steps
 * @param {GraphAnalysis} graphAnalysis  — from executionGraph.analyzeGraph
 * @returns {object[]} reordered steps (always same length as input)
 */
function reorderSteps(steps, graphAnalysis) {
    if (!graphAnalysis || !graphAnalysis.parallelGroups || graphAnalysis.parallelGroups.length === 0) {
        return steps;
    }

    const byName    = new Map(steps.map(s => [s.name, s]));
    const result    = [];
    const scheduled = new Set();

    for (const group of graphAnalysis.parallelGroups) {
        const groupSteps = group
            .map(name => byName.get(name))
            .filter(Boolean);

        // Sort within group: highest historical success rate first
        const sorted = _sortByReliability(groupSteps);
        for (const s of sorted) {
            result.push(s);
            scheduled.add(s.name);
        }
    }

    // Append any steps not covered by the graph (defensive)
    for (const s of steps) {
        if (!scheduled.has(s.name)) result.push(s);
    }

    return result;
}

// ── Redundant retry reduction ─────────────────────────────────────────

/**
 * Reduce maxRetries to 1 for steps that almost always succeed on the first try,
 * eliminating wasted retry budget.
 *
 * @param {object[]} steps
 * @param {{ threshold?: number, minSamples?: number }} opts
 * @returns {object[]} steps with adjusted maxRetries
 */
function filterRedundantRetries(steps, opts = {}) {
    const { threshold = DEFAULT_REDUNDANCY_THRESHOLD, minSamples = 5 } = opts;

    return steps.map(step => {
        const records = history.byType(`step:${step.name}`);
        if (records.length < minSamples) return step;

        const rate = records.filter(r => r.success).length / records.length;
        if (rate >= threshold && (step.maxRetries === undefined || step.maxRetries > 1)) {
            return { ...step, maxRetries: 1 };
        }
        return step;
    });
}

// ── Low-success strategy filtering ───────────────────────────────────

/**
 * Remove recovery strategies whose aggregate cluster success rate is below
 * threshold (with sufficient samples), to avoid wasting recovery budget on
 * historically failing strategies.
 *
 * @param {object[]} strategies  — from recoveryEngine.getStrategies()
 * @param {{ threshold?: number, minSamples?: number }} opts
 * @returns {object[]} filtered strategies (always at least 1 if input non-empty)
 */
function skipLowSuccessStrategies(strategies, opts = {}) {
    if (!strategies || strategies.length === 0) return strategies;

    const { threshold = DEFAULT_SKIP_THRESHOLD, minSamples = 5 } = opts;
    const clusters = pcl.getClusters();

    const filtered = strategies.filter(s => {
        // Aggregate this strategy's performance across all clusters
        let totalAttempts  = 0;
        let totalSuccesses = 0;

        for (const c of clusters) {
            const sData = c.strategies?.[s.id];
            if (!sData) continue;
            totalAttempts  += sData.attempts;
            totalSuccesses += sData.successes;
        }

        if (totalAttempts < minSamples) return true;  // insufficient data — keep it
        return totalSuccesses / totalAttempts >= threshold;
    });

    // Guarantee at least one strategy remains (never remove all options)
    return filtered.length > 0 ? filtered : strategies.slice(0, 1);
}

// ── Workflow priority scoring ─────────────────────────────────────────

/**
 * Compute a 0–100 priority score for a workflow.
 * Higher score = should run earlier in a queue (more likely to succeed quickly).
 *
 * Formula: successRate × 80 + dataSaturation × 20
 *   dataSaturation = min(sampleCount / 10, 1.0)
 */
function workflowPriorityScore(workflowName) {
    const records = history.byType(`workflow:${workflowName}`);
    if (records.length === 0) return 50;  // neutral default

    const successRate  = records.filter(r => r.success).length / records.length;
    const saturation   = Math.min(records.length / 10, 1.0);

    return Math.round(successRate * 80 + saturation * 20);
}

// ── Internal helpers ──────────────────────────────────────────────────

function _sortByReliability(steps) {
    return [...steps].sort((a, b) => {
        const rA = _stepRate(a.name);
        const rB = _stepRate(b.name);
        if (rA === null && rB === null) return 0;
        if (rA === null) return 1;   // unknown goes last
        if (rB === null) return -1;
        return rB - rA;              // highest rate first
    });
}

function _stepRate(stepName) {
    const recs = history.byType(`step:${stepName}`);
    if (recs.length < 3) return null;
    return recs.filter(r => r.success).length / recs.length;
}

module.exports = {
    reorderSteps,
    filterRedundantRetries,
    skipLowSuccessStrategies,
    workflowPriorityScore,
    DEFAULT_REDUNDANCY_THRESHOLD,
    DEFAULT_SKIP_THRESHOLD,
};
