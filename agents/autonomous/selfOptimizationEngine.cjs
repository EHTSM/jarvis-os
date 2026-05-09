/**
 * Self-Optimization Engine — generates improvement actions from feedback.
 * Outputs a concrete optimization plan; does NOT auto-execute changes.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const STORE = "optimization-log";

const OPTIMIZATION_PLAYBOOK = {
    scale_up: [
        { action: "increase_budget",      description: "Allocate 20-30% more resources to proven channels" },
        { action: "expand_audience",      description: "Target adjacent markets with same messaging" },
        { action: "automate_more",        description: "Replace manual steps with automation scripts" },
        { action: "hire_or_outsource",    description: "Add capacity through delegation" }
    ],
    optimize: [
        { action: "ab_test",              description: "A/B test the highest-impact step" },
        { action: "reduce_friction",      description: "Remove 1-2 steps from the main user flow" },
        { action: "improve_conversion",   description: "Optimize CTA, pricing, or onboarding" },
        { action: "speed_up_delivery",    description: "Identify bottleneck and remove it" }
    ],
    iterate: [
        { action: "fix_top_error",        description: "Address the #1 failure factor from last cycle" },
        { action: "retest_assumptions",   description: "Validate market assumptions with new data" },
        { action: "simplify_product",     description: "Cut features — focus on core value only" },
        { action: "change_channel",       description: "Try a different acquisition channel" }
    ],
    pivot: [
        { action: "customer_interviews",  description: "Talk to 10 customers — understand real pain point" },
        { action: "reframe_product",      description: "Reposition the same tech for a different market" },
        { action: "new_revenue_model",    description: "Switch from one-time to subscription or vice versa" },
        { action: "target_new_segment",   description: "Move up/down market or to adjacent vertical" }
    ]
};

function _prioritize(feedback = {}) {
    const direction = feedback.recommendedAction || "optimize";
    const playbook  = OPTIMIZATION_PLAYBOOK[direction] || OPTIMIZATION_PLAYBOOK.optimize;
    // Return top 3 actions based on direction
    return playbook.slice(0, 3);
}

function optimize(feedback = {}) {
    const prioritized = _prioritize(feedback);
    const prev        = load(STORE, []);

    const improvement = {
        id:               uid("opt"),
        basedOn:          feedback.id || "latest_feedback",
        goal:             feedback.goal || "",
        performanceScore: feedback.performanceScore || 50,
        direction:        feedback.recommendedAction || "optimize",
        topActions:       prioritized,
        implementationPlan: prioritized.map((a, i) => ({
            priority: i + 1,
            ...a,
            estimatedImpact: i === 0 ? "High" : i === 1 ? "Medium" : "Low",
            timeToImplement: "1-3 days"
        })),
        learnings:        feedback.aiInsights?.learnings || feedback.failureFactors || [],
        systemAdjustments: [
            feedback.performanceScore < 40 ? "Lower risk threshold for next cycle — be more selective" : null,
            feedback.errors?.length > 2    ? "Add error handling and fallbacks before next run" : null,
            feedback.recommendedAction === "scale_up" ? "Increase max tasks per cycle from 5 to 7 (pending approval)" : null
        ].filter(Boolean),
        optimizedAt: NOW()
    };

    prev.push({ id: improvement.id, direction: improvement.direction, score: improvement.performanceScore, optimizedAt: improvement.optimizedAt });
    flush(STORE, prev.slice(-50));
    logToMemory("selfOptimizationEngine", feedback.goal || "optimize", { direction: improvement.direction });
    return improvement;
}

function getOptimizationHistory(limit = 10) {
    return load(STORE, []).slice(-limit);
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = optimize(p.feedback || p);
        return ok("selfOptimizationEngine", data, ["Optimize one variable at a time", "Measure before and after every change"]);
    } catch (err) { return fail("selfOptimizationEngine", err.message); }
}

module.exports = { optimize, getOptimizationHistory, OPTIMIZATION_PLAYBOOK, run };
