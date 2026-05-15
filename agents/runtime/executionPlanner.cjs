"use strict";
/**
 * executionPlanner — goal-oriented workflow planning and verified execution.
 *
 * Pipeline:
 *   Goal → plan() → simulate → validate → executePlan() → verify
 *
 * plan(goal, steps, opts):
 *   1. Compute workflow risk score from step analysis
 *   2. Derive adaptive retry budget
 *   3. Run predictive failure analysis
 *   4. Run static simulation (risk detection)
 *   5. Return a Plan object — no execution yet
 *
 * executePlan(plan, opts):
 *   1. Run workflow with plan's retry budget
 *   2. Record verified outcomes for successful recoveries
 *   3. Run optional verify(result) callback
 *   4. Score the execution (health + verification quality)
 *
 * planAndExecute(goal, steps, opts):
 *   Convenience: plan + execute in one call.
 *
 * Integrates with:
 *   costModel         — risk score + adaptive budget
 *   failurePredictor  — predictive analysis
 *   simulator         — static step analysis
 *   autonomousWorkflow — execution engine
 *
 * Does NOT add a new orchestration layer — it is a call-site helper that
 * computes better options before delegating to runWorkflow.
 */

const { workflowRiskScore, adaptiveRetryBudget } = require("./costModel.cjs");
const { analyzePredictions }  = require("./failurePredictor.cjs");
const { simulateWorkflow }    = require("../../evaluation/simulator.cjs");
const { runWorkflow }         = require("./autonomousWorkflow.cjs");
const { analyzeGraph }        = require("./executionGraph.cjs");
const { reorderSteps, filterRedundantRetries } = require("./executionOptimizer.cjs");
const qualityScorer           = require("./qualityScorer.cjs");
const trustScorer             = require("./trustScorer.cjs");
const stabilizer              = require("./runtimeStabilizer.cjs");
const anomalyDetector         = require("./anomalyDetector.cjs");
const learningLoop            = require("./learningLoop.cjs");
const executionPolicy         = require("./executionPolicy.cjs");

// ── Plan object ───────────────────────────────────────────────────────

/**
 * @typedef {object} Plan
 * @property {string}   goal
 * @property {object[]} steps
 * @property {number}   riskScore        0–1 aggregate workflow risk
 * @property {number}   retryBudget      adaptive retry count
 * @property {object}   predictions      PredictionReport from failurePredictor
 * @property {object}   simulation       SimulationResult from simulator
 * @property {string}   plannedAt
 * @property {object}   meta             caller-supplied metadata
 */

// ── Execution scoring ─────────────────────────────────────────────────

/**
 * Score an execution result against an optional verification outcome.
 *
 * Returns 0–100 reflecting both execution quality and verification confidence.
 */
function scoreExecution(result, verificationResult) {
    const health = result.healthScore || 0;
    if (!verificationResult) return health;

    const { passed, confidence = 1.0 } = verificationResult;
    if (!passed) return Math.max(0, Math.round(health * 0.4));   // verification failed → heavy penalty
    return Math.round(health * 0.7 + confidence * 30);           // weighted: health 70%, verify 30%
}

// ── Plan ─────────────────────────────────────────────────────────────

/**
 * Build a Plan without executing.
 *
 * @param {string}   goal
 * @param {object[]} steps
 * @param {{
 *   projectPath?: string
 *   baseRetries?: number
 *   meta?:        object
 * }} opts
 * @returns {Promise<Plan>}
 */
async function plan(goal, steps, opts = {}) {
    const riskScore   = workflowRiskScore(steps);
    const retryBudget = adaptiveRetryBudget(riskScore, opts.baseRetries ?? 3);

    const [predictions, simulation] = await Promise.all([
        Promise.resolve(analyzePredictions(steps, opts.projectPath || null)),
        simulateWorkflow(steps, opts.ctx || {}),
    ]);

    const graphAnalysis = analyzeGraph(steps);

    return {
        goal,
        steps,
        riskScore,
        retryBudget,
        predictions,
        simulation,
        graphAnalysis,
        plannedAt: new Date().toISOString(),
        meta:      opts.meta || {},
    };
}

// ── Validate plan ─────────────────────────────────────────────────────

/**
 * Validate a plan before execution.
 *
 * Returns { valid, warnings, blockers } — callers may abort on blockers.
 */
function validatePlan(thePlan) {
    const warnings = [];
    const blockers = [];

    if (thePlan.riskScore > 0.8) {
        warnings.push(`High workflow risk score: ${thePlan.riskScore.toFixed(2)}`);
    }

    for (const p of thePlan.predictions.high) {
        blockers.push(`[${p.type}] ${p.message}`);
    }

    for (const p of thePlan.predictions.medium) {
        warnings.push(`[${p.type}] ${p.message}`);
    }

    if (thePlan.simulation.highRiskSteps?.length > 0) {
        warnings.push(`High-risk steps: ${thePlan.simulation.highRiskSteps.join(", ")}`);
    }

    return {
        valid:    blockers.length === 0,
        warnings,
        blockers,
    };
}

// ── Execute plan ──────────────────────────────────────────────────────

/**
 * Execute a pre-built Plan.
 *
 * @param {Plan} thePlan
 * @param {{
 *   ctx?:        object
 *   verify?:     async (result) => { passed: boolean, confidence?: number, detail?: any }
 *   allowBlockers?: boolean   — proceed even if plan validation found blockers
 * }} opts
 * @returns {Promise<ExecutionResult>}
 */
async function executePlan(thePlan, opts = {}) {
    const validation = validatePlan(thePlan);

    if (!validation.valid && !opts.allowBlockers) {
        return {
            plan:           thePlan,
            result:         null,
            validation,
            verified:       null,
            executionScore: 0,
            aborted:        true,
            abortReason:    `Plan validation blocked: ${validation.blockers.join("; ")}`,
        };
    }

    // ── Quarantine check (blocks only when enforceQuarantine: true) ──────
    if (opts.enforceQuarantine && stabilizer.isQuarantined(thePlan.goal)) {
        return {
            plan:           thePlan,
            result:         null,
            validation,
            verified:       null,
            executionScore: 0,
            aborted:        true,
            quarantined:    true,
            abortReason:    `Workflow "${thePlan.goal}" is quarantined`,
        };
    }

    // ── Policy selection: auto-select from risk score if no policy set ───
    const policyName    = opts.policy || executionPolicy.selectPolicy(thePlan.riskScore);
    const policyConfig  = executionPolicy.getPolicy(policyName);
    const effectiveRetries = opts.maxRetries ?? thePlan.retryBudget ?? policyConfig.maxRetries;

    // Apply optimizations: reduce retries for reliable steps, respect topo order
    const optimizedSteps = reorderSteps(
        filterRedundantRetries(thePlan.steps),
        thePlan.graphAnalysis
    );

    const result = await runWorkflow(thePlan.goal, optimizedSteps, {
        maxRetries: effectiveRetries,
        ctx:        { _plan: thePlan, ...(opts.ctx || {}) },
    });

    // ── Post-run: trust scoring, anomaly detection, learning feedback ────
    if (result.success) {
        trustScorer.recordSuccess(thePlan.goal);
        learningLoop.reinforceWorkflow(thePlan.goal, result.stepDetails || []);
    } else {
        trustScorer.recordFailure(thePlan.goal);
        const failedStep = (result.stepDetails || []).find(s => s.status === "failed");
        if (failedStep) {
            stabilizer.recordInstability(thePlan.goal, failedStep.error || "step_failed");
            learningLoop.decayWorkflow(thePlan.goal, failedStep, "unknown");
        }
    }

    const anomalies = anomalyDetector.analyzeWorkflow(result);

    // Optional caller-supplied verification
    let verificationResult = null;
    if (typeof opts.verify === "function") {
        try {
            verificationResult = await opts.verify(result);
        } catch (e) {
            verificationResult = { passed: false, confidence: 0, detail: e.message };
        }
    }

    const executionScore = scoreExecution(result, verificationResult);

    // Quality metrics for the workflow goal
    const quality = {
        reliability:  qualityScorer.workflowReliabilityScore(thePlan.goal),
        determinism:  qualityScorer.determinismScore(thePlan.goal),
        trend:        qualityScorer.executionConfidenceTrend(thePlan.goal, 5),
    };

    return {
        plan:           thePlan,
        result,
        validation,
        verified:       verificationResult,
        executionScore,
        anomalies,
        policy:         policyName,
        trust:          trustScorer.getTrust(thePlan.goal),
        quarantined:    stabilizer.isQuarantined(thePlan.goal),
        quality,
        aborted:        false,
    };
}

// ── Plan and execute ──────────────────────────────────────────────────

/**
 * Convenience: plan + validate + execute in one call.
 */
async function planAndExecute(goal, steps, opts = {}) {
    const thePlan = await plan(goal, steps, opts);
    return executePlan(thePlan, opts);
}

module.exports = { plan, validatePlan, executePlan, planAndExecute, scoreExecution };
