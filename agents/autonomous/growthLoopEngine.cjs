/**
 * Growth Loop Engine — controlled iterative improvement: analyze → improve → execute.
 * HARD LIMIT: max 3 iterations per run. No infinite loops.
 */

const { uid, NOW, logToMemory, ok, fail, MAX_GROWTH_ITERATIONS } = require("./_autoStore.cjs");

const GROWTH_STRATEGIES = {
    acquisition: ["SEO content", "Referral program", "Partnership outreach", "Community building"],
    activation:  ["Onboarding flow optimization", "First value in < 5 min", "In-app guidance"],
    retention:   ["Weekly email digest", "Feature announcements", "Usage-based nudges"],
    revenue:     ["Upsell triggers", "Annual plan discounts", "Add-on features"],
    referral:    ["Incentivized sharing", "Public success stories", "Affiliate program"]
};

const AARRR_METRICS = {
    acquisition:  { target: "100 signups/week",     kpi: "weekly_signups" },
    activation:   { target: "40% activate day 1",   kpi: "d1_activation_rate" },
    retention:    { target: "40% retain week 4",    kpi: "w4_retention_rate" },
    revenue:      { target: "₹50,000 MRR",          kpi: "mrr" },
    referral:     { target: "K-factor > 0.5",       kpi: "viral_coefficient" }
};

function _analyzeState(metrics = {}) {
    const gaps = [];
    const current = metrics.current || {};

    if (!current.signups || current.signups < 50)     gaps.push({ stage: "acquisition", severity: "high",   fix: "Increase content output + SEO" });
    if (!current.activation || current.activation < 0.3) gaps.push({ stage: "activation",  severity: "high",   fix: "Simplify onboarding — cut steps" });
    if (!current.retention  || current.retention  < 0.3) gaps.push({ stage: "retention",   severity: "medium", fix: "Add weekly email + feature reminders" });
    if (!current.mrr        || current.mrr        < 10000) gaps.push({ stage: "revenue",  severity: "medium", fix: "Introduce upsell trigger at day 7" });

    return gaps;
}

function _improveStep(gap) {
    const strategies = GROWTH_STRATEGIES[gap.stage] || GROWTH_STRATEGIES.acquisition;
    return {
        stage:    gap.stage,
        action:   strategies[0],
        expected: AARRR_METRICS[gap.stage]?.target || "measurable improvement",
        effort:   "medium",
        week:     1
    };
}

function _executeImprovement(improvement, iteration) {
    // Simulated execution — real execution requires workflowEngine + approval
    return {
        improvement,
        status:      "plan_ready",
        iteration,
        note:        `Iteration ${iteration}: ${improvement.action} planned for ${improvement.stage}`,
        simulated:   true
    };
}

function runLoop(metrics = {}, maxIterations = MAX_GROWTH_ITERATIONS) {
    const iterations  = Math.min(maxIterations, MAX_GROWTH_ITERATIONS); // enforce hard cap
    const loopId      = uid("loop");
    const results     = [];
    let   currentState = { ...metrics };

    for (let i = 1; i <= iterations; i++) {
        // Analyze
        const gaps = _analyzeState(currentState);
        if (!gaps.length) {
            results.push({ iteration: i, status: "no_gaps_found", message: "All metrics healthy — loop complete early" });
            break;
        }

        // Improve — take top gap
        const topGap     = gaps[0];
        const improvement = _improveStep(topGap);

        // Execute
        const execution  = _executeImprovement(improvement, i);

        results.push({
            iteration:   i,
            gapsFound:   gaps.length,
            topGap:      topGap.stage,
            improvement: improvement.action,
            execution,
            status:      "complete"
        });

        // Simulate marginal improvement for next iteration
        currentState = {
            ...currentState,
            current: {
                ...currentState.current,
                [topGap.stage === "acquisition" ? "signups" : topGap.stage]: "improved"
            }
        };
    }

    const summary = {
        loopId,
        totalIterations:  results.length,
        maxAllowed:       MAX_GROWTH_ITERATIONS,
        results,
        finalState:       currentState,
        recommendedNext:  results.at(-1)?.improvement || "Continue monitoring",
        completedAt:      NOW()
    };

    logToMemory("growthLoopEngine", `loop:${loopId}`, { iterations: results.length });
    return summary;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = runLoop(p.metrics || {}, p.iterations || MAX_GROWTH_ITERATIONS);
        return ok("growthLoopEngine", data, ["Fix the weakest link in AARRR first", "One metric per iteration"]);
    } catch (err) { return fail("growthLoopEngine", err.message); }
}

module.exports = { runLoop, GROWTH_STRATEGIES, AARRR_METRICS, MAX_GROWTH_ITERATIONS, run };
