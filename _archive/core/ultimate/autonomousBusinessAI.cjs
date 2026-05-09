"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "autonomousBusinessAI";

// Business assistance AI — assists human operators with strategy, analysis,
// and recommendations. NEVER makes financial or legal decisions autonomously.

const BUSINESS_FUNCTIONS = ["strategy","marketing","operations","finance","hr","product","sales","legal","compliance","r_and_d"];
const ANALYSIS_TYPES     = ["market","competitive","swot","gap","risk","opportunity","financial","customer"];

function analyseBusinessGoal({ goal, functions = BUSINESS_FUNCTIONS, context = {} }) {
    if (!goal) return fail(AGENT, "goal is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const analyses = functions.slice(0, 6).map(fn => ({
        function:       fn,
        relevance_pct:  Math.round(40 + Math.random() * 60),
        keyInsight:     `${fn} perspective on: ${goal.slice(0, 60)}`,
        recommendation: `Optimise ${fn} operations to support stated goal`,
        effort:         ["low","medium","high"][Math.floor(Math.random()*3)],
        timelineWeeks:  Math.round(2 + Math.random() * 24)
    }));

    const plan = {
        planId:          uid("biz"),
        goal:            goal.slice(0, 200),
        analyses,
        priorityActions: analyses.filter(a => a.relevance_pct > 70).map(a => a.function),
        overallFeasibility: Math.round(60 + Math.random() * 38),
        estimatedROI_pct:   parseFloat((10 + Math.random() * 200).toFixed(1)),
        risks:           ["market_volatility","resource_constraint","regulatory_change"].slice(0, Math.floor(Math.random()*3)+1),
        humanDecisionRequired: true,
        note:            "Business recommendations are advisory. Human operator makes final business decisions.",
        generatedAt:     NOW()
    };

    const history = load("business_plans", []);
    history.push({ planId: plan.planId, goal: goal.slice(0,80), generatedAt: plan.generatedAt });
    flush("business_plans", history.slice(-200));

    ultimateLog(AGENT, "business_goal_analysed", { goal: goal.slice(0,80), functionCount: functions.length }, "INFO");
    return ok(AGENT, plan);
}

function generateStrategy({ goal, horizon = "medium_term", constraints = [] }) {
    if (!goal) return fail(AGENT, "goal is required");
    const HORIZONS = ["short_term","medium_term","long_term"];
    if (!HORIZONS.includes(horizon)) return fail(AGENT, `horizon must be: ${HORIZONS.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const phaseCount = { short_term: 3, medium_term: 5, long_term: 8 }[horizon];
    const phases = Array.from({ length: phaseCount }, (_, i) => ({
        phase:     i + 1,
        name:      `Phase ${i+1}: ${["Foundation","Expansion","Optimisation","Scale","Sustain","Innovate","Lead","Transform"][i] || `Phase_${i+1}`}`,
        duration:  `${Math.round(1 + Math.random() * 6)} months`,
        objectives: [`Objective ${i*2+1}`, `Objective ${i*2+2}`],
        milestones: [`Milestone ${i+1}A`, `Milestone ${i+1}B`],
        budget_pct: parseFloat((100 / phaseCount + (Math.random()-0.5)*10).toFixed(1))
    }));

    ultimateLog(AGENT, "strategy_generated", { goal: goal.slice(0,80), horizon }, "INFO");
    return ok(AGENT, {
        strategyId: uid("str"),
        goal: goal.slice(0,200),
        horizon,
        constraints,
        phases,
        totalPhases: phases.length,
        humanApprovalRequired: true,
        generatedAt: NOW()
    });
}

function assessMarket({ sector, region = "global", depth = "standard" }) {
    if (!sector) return fail(AGENT, "sector is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const assessment = {
        assessmentId:    uid("mkt"),
        sector,
        region,
        marketSize_USD_B: parseFloat((0.1 + Math.random() * 500).toFixed(2)),
        growthRate_pct:   parseFloat((-5 + Math.random() * 35).toFixed(2)),
        competitorCount:  Math.round(5 + Math.random() * 200),
        entryBarrier:     ["low","moderate","high","very_high"][Math.floor(Math.random()*4)],
        opportunities:    ["digital_transformation","underserved_segment","tech_disruption"].slice(0, Math.floor(Math.random()*3)+1),
        threats:          ["incumbent_dominance","regulatory_pressure","economic_cycle"].slice(0, Math.floor(Math.random()*2)+1),
        confidence:       Math.round(55 + Math.random() * 40),
        assessedAt:       NOW(),
        disclaimer:       "Market data is simulated. Integrate real market research APIs for production use."
    };

    ultimateLog(AGENT, "market_assessed", { sector, region }, "INFO");
    return ok(AGENT, assessment);
}

module.exports = { analyseBusinessGoal, generateStrategy, assessMarket, BUSINESS_FUNCTIONS };
