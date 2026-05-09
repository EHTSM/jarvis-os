"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, killed } = require("./_ultimateStore.cjs");

const AGENT = "economyEngine";

const IMPACT_DIMENSIONS = ["financial","operational","reputational","social","environmental","regulatory","strategic"];
const COST_CATEGORIES   = ["compute","data","human_time","external_api","storage","bandwidth","licensing"];

// ── Evaluate the economic impact of a goal / action ──────────────
function evaluateImpact({ goal, actions = [], budget_USD, timeframeMonths = 12 }) {
    if (!goal) return fail(AGENT, "goal is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const impacts = IMPACT_DIMENSIONS.map(dim => ({
        dimension:     dim,
        estimatedValue: parseFloat((Math.random() * 1000000 - 200000).toFixed(2)),
        confidence_pct: Math.round(50 + Math.random() * 45),
        direction:      Math.random() > 0.3 ? "positive" : "negative",
        timeframe:      `${Math.round(1 + Math.random() * timeframeMonths)} months`
    }));

    const netValue = parseFloat(impacts.reduce((s, i) => s + i.estimatedValue, 0).toFixed(2));
    const roi      = budget_USD ? parseFloat(((netValue / budget_USD) * 100).toFixed(2)) : null;

    const evaluation = {
        evaluationId:  uid("eco"),
        goal:          goal.slice(0, 200),
        actions:       actions.slice(0, 10),
        budget_USD:    budget_USD || null,
        timeframeMonths,
        impacts,
        netEstimatedValue_USD: netValue,
        roi_pct:       roi,
        verdict:       netValue > 0 ? "positive_return" : "negative_return",
        risk:          Math.abs(netValue) > 500000 ? "high" : Math.abs(netValue) > 100000 ? "moderate" : "low",
        confidence:    Math.round(55 + Math.random() * 40),
        evaluatedAt:   NOW(),
        disclaimer:    "Economic projections are simulated estimates. Integrate real financial data for production use."
    };

    const log = load("economy_evaluations", []);
    log.push({ evaluationId: evaluation.evaluationId, goal: goal.slice(0,80), verdict: evaluation.verdict, evaluatedAt: evaluation.evaluatedAt });
    flush("economy_evaluations", log.slice(-500));

    ultimateLog(AGENT, "impact_evaluated", { goal: goal.slice(0,80), verdict: evaluation.verdict, netValue }, "INFO");
    return ok(AGENT, evaluation);
}

// ── Estimate execution cost of a set of actions ─────────────────
function estimateCost({ actions = [], categories = COST_CATEGORIES, currency = "USD" }) {
    if (!actions.length) return fail(AGENT, "actions array required");
    if (isKillSwitchActive()) return killed(AGENT);

    const breakdown = categories.map(cat => ({
        category:      cat,
        estimatedCost: parseFloat((Math.random() * 5000).toFixed(2)),
        unit:          ["per_call","per_hour","per_month","flat"][Math.floor(Math.random()*4)]
    }));

    const totalCost = parseFloat(breakdown.reduce((s, b) => s + b.estimatedCost, 0).toFixed(2));
    ultimateLog(AGENT, "cost_estimated", { actionCount: actions.length, totalCost, currency }, "INFO");
    return ok(AGENT, { actionCount: actions.length, currency, breakdown, totalCost, estimatedAt: NOW() });
}

// ── Run a simple economic simulation ────────────────────────────
function simulateScenario({ goal, scenario = "baseline", variables = {} }) {
    if (!goal) return fail(AGENT, "goal is required");
    const SCENARIOS = ["baseline","optimistic","pessimistic","stress_test"];
    if (!SCENARIOS.includes(scenario)) return fail(AGENT, `scenario must be: ${SCENARIOS.join(", ")}`);

    const multiplier = { baseline: 1, optimistic: 1.4, pessimistic: 0.6, stress_test: 0.3 }[scenario];
    const base       = Math.random() * 1000000;

    const simulation = {
        simulationId:     uid("sim"),
        goal:             goal.slice(0,200),
        scenario,
        variables,
        baselineValue_USD: parseFloat(base.toFixed(2)),
        adjustedValue_USD: parseFloat((base * multiplier).toFixed(2)),
        multiplier,
        keyAssumptions:   [`${scenario} market conditions`, "stable regulatory environment", "linear growth model"],
        sensitivityFactors: ["interest_rate","market_demand","regulatory_change","tech_adoption"],
        confidence:       Math.round(50 + Math.random() * 40),
        simulatedAt:      NOW()
    };

    ultimateLog(AGENT, "scenario_simulated", { goal: goal.slice(0,80), scenario }, "INFO");
    return ok(AGENT, simulation);
}

module.exports = { evaluateImpact, estimateCost, simulateScenario, IMPACT_DIMENSIONS };
