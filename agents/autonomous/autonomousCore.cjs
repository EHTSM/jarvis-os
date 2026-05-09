/**
 * Autonomous Core — 7-step controlled execution pipeline.
 *
 * Flow:
 *   goal → opportunityFinder → scenarioSimulator → riskPredictionEngine
 *        → aiDecisionMaker → [approval gate] → plan execution
 *        → feedbackAnalyzerPro → selfOptimizationEngine → return result
 *
 * Safety:
 *   - High-risk actions return approvalRequired before ANY execution
 *   - Decision score must exceed DECISION_THRESHOLD (15)
 *   - Max 5 tasks per execution cycle (enforced by aiArmyManager)
 *   - No auto-execution of: payments, campaigns, mass messaging
 */

const { uid, NOW, logToMemory, ok, fail, approvalRequired, isHighRisk } = require("./_autoStore.cjs");

const opportunityFinder      = require("./opportunityFinder.cjs");
const scenarioSimulator      = require("./scenarioSimulator.cjs");
const riskPredictionEngine   = require("./riskPredictionEngine.cjs");
const aiDecisionMaker        = require("./aiDecisionMaker.cjs");
const feedbackAnalyzerPro    = require("./feedbackAnalyzerPro.cjs");
const selfOptimizationEngine = require("./selfOptimizationEngine.cjs");

async function _executeApprovedPlan(plan = [], context = {}) {
    const results      = [];
    const errors       = [];
    let   completedSteps = 0;

    for (const step of plan) {
        // Safety gate on every step
        if (isHighRisk(step.action)) {
            results.push({ step: step.step, action: step.action, status: "BLOCKED_REQUIRES_APPROVAL" });
            errors.push(`Step ${step.step} (${step.action}) requires approval`);
            continue;
        }

        try {
            // Steps are simulated — real execution goes through workflowEngine or specific agents
            results.push({ step: step.step, action: step.action, description: step.description, status: "simulated_complete" });
            completedSteps++;
        } catch (err) {
            results.push({ step: step.step, action: step.action, status: "error", error: err.message });
            errors.push(err.message);
        }
    }

    return { success: errors.length === 0, completedSteps, totalSteps: plan.length, results, errors };
}

async function run(goal = "", options = {}) {
    if (!goal) return fail("autonomousCore", "goal is required");

    const runId    = uid("core");
    const startedAt = NOW();
    const trace    = [];

    const log = (step, data) => {
        trace.push({ step, timestamp: NOW(), summary: typeof data === "string" ? data : JSON.stringify(data).slice(0, 150) });
    };

    try {
        // ── Step 1: Find opportunity ─────────────────────────────────
        log(1, "opportunityFinder → scanning goal");
        const opportunity = await opportunityFinder.find(goal);
        log(1, `found: ${opportunity.recommended?.title}`);

        // ── Step 2: Simulate scenarios ───────────────────────────────
        log(2, "scenarioSimulator → running outcome models");
        const scenario = await scenarioSimulator.simulateWithAI(opportunity.recommended || {});
        log(2, `expected revenue: ${scenario.expectedMonthlyRevenue}`);

        // ── Step 3: Evaluate risk ────────────────────────────────────
        log(3, "riskPredictionEngine → evaluating risk factors");
        const risk = riskPredictionEngine.evaluate({
            title:         opportunity.recommended?.title,
            capitalNeeded: opportunity.recommended?.capitalNeeded,
            actions:       options.actions || [],
            timeline:      opportunity.recommended?.timeline,
            targetMarket:  opportunity.recommended?.targetMarket
        });
        log(3, `risk: ${risk.riskLevel} (score: ${risk.weightedScore})`);

        // ── Step 4: Decision gate ────────────────────────────────────
        log(4, "aiDecisionMaker → scoring decision");
        const decision = aiDecisionMaker.decide({
            opportunity,
            scenario,
            risk,
            overrideApproval: options.overrideApproval === true
        });
        log(4, `approved: ${decision.approved}, score: ${decision.score}`);

        // Approval required — return without executing
        if (decision.needsApproval) {
            logToMemory("autonomousCore", goal, { status: "approval_required", runId });
            return {
                success:          false,
                type:             "autonomous",
                runId,
                goal,
                approvalRequired: true,
                decision,
                message:          decision.message,
                trace
            };
        }

        // Score too low — return recommendation without executing
        if (!decision.approved) {
            logToMemory("autonomousCore", goal, { status: "rejected", runId, score: decision.score });
            return {
                success:  false,
                type:     "autonomous",
                runId,
                goal,
                decision,
                message:  `Decision score ${decision.score.toFixed(1)} below threshold ${decision.threshold}. Idea needs refinement.`,
                scenario: { base: scenario.scenarios.base },
                trace
            };
        }

        // ── Step 5: Execute approved plan ────────────────────────────
        log(5, `workflowEngine → executing ${decision.plan.length} steps`);
        const execution = await _executeApprovedPlan(decision.plan, { goal, opportunity, scenario });
        log(5, `completed ${execution.completedSteps}/${execution.totalSteps} steps`);

        // ── Step 6: Analyze results ──────────────────────────────────
        log(6, "feedbackAnalyzerPro → analyzing execution");
        const feedback = await feedbackAnalyzerPro.analyze(execution, goal);
        log(6, `performance: ${feedback.performanceScore}/100 (${feedback.performanceLabel})`);

        // ── Step 7: Generate optimization ────────────────────────────
        log(7, "selfOptimizationEngine → generating improvements");
        const optimization = selfOptimizationEngine.optimize(feedback);
        log(7, `direction: ${optimization.direction}`);

        const actions = execution.results.map(r => r.action);

        logToMemory("autonomousCore", goal, { status: "completed", score: feedback.performanceScore, runId });

        return {
            success:      true,
            type:         "autonomous",
            runId,
            goal,
            decision:     `Approved (score: ${decision.score.toFixed(1)}) — ${feedback.performanceLabel} execution`,
            actions,
            result: {
                opportunity:  opportunity.recommended,
                scenario:     { base: scenario.scenarios.base, expected: scenario.expectedMonthlyRevenue },
                riskLevel:    risk.riskLevel,
                execution,
                feedback:     { score: feedback.performanceScore, direction: feedback.recommendedAction },
                optimization: { topActions: optimization.topActions }
            },
            trace,
            startedAt,
            completedAt:  NOW()
        };

    } catch (err) {
        logToMemory("autonomousCore", goal, { status: "error", error: err.message });
        return fail("autonomousCore", `Pipeline error: ${err.message}`);
    }
}

async function runTask(task) {
    const p = task.payload || {};
    return run(p.goal || task.input || "", {
        actions:          p.actions         || [],
        overrideApproval: p.overrideApproval || false
    });
}

module.exports = { run, runTask };
