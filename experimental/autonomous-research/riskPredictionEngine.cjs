/**
 * Risk Prediction Engine — evaluates multi-dimensional risk before execution.
 * Returns structured risk scores that aiDecisionMaker uses to gate execution.
 */

const { uid, NOW, logToMemory, ok, fail, isHighRisk } = require("./_autoStore.cjs");

const RISK_FACTORS = {
    financial:    { weight: 0.30, description: "Capital at risk" },
    legal:        { weight: 0.25, description: "Regulatory / legal exposure" },
    technical:    { weight: 0.20, description: "Implementation complexity" },
    market:       { weight: 0.15, description: "Market acceptance uncertainty" },
    operational:  { weight: 0.10, description: "Execution / team capability" }
};

const RISK_LEVELS = [
    { label: "Critical", minScore: 8,  action: "BLOCK",   color: "red"    },
    { label: "High",     minScore: 6,  action: "REQUIRE_APPROVAL", color: "orange" },
    { label: "Medium",   minScore: 4,  action: "WARN",    color: "yellow" },
    { label: "Low",      minScore: 2,  action: "PROCEED", color: "green"  },
    { label: "Minimal",  minScore: 0,  action: "PROCEED", color: "green"  }
];

function _scoreFactors(context = {}) {
    const { capitalNeeded, actions = [], timeline, targetMarket } = context;

    const financial = capitalNeeded === "None" ? 1 : capitalNeeded === "Very Low" ? 2 :
                      capitalNeeded === "Low"  ? 3 : capitalNeeded === "Medium" ? 6 : 8;

    const legal = actions.some(a => isHighRisk(a)) ? 8 :
                  (targetMarket || "").toLowerCase().includes("global") ? 6 : 3;

    const technical = (typeof timeline === "string" && parseInt(timeline) <= 1) ? 7 :
                      (typeof timeline === "string" && parseInt(timeline) <= 3) ? 4 : 2;

    const market = 5; // always medium uncertainty for new ideas

    const operational = 3; // baseline execution risk

    return { financial, legal, technical, market, operational };
}

function evaluate(context = {}) {
    const rawScores = _scoreFactors(context);

    const weightedScore = Object.entries(rawScores).reduce((total, [factor, score]) => {
        return total + score * (RISK_FACTORS[factor]?.weight || 0);
    }, 0);

    const overallScore = +weightedScore.toFixed(2);
    const level        = [...RISK_LEVELS].sort((a, b) => b.minScore - a.minScore).find(l => overallScore >= l.minScore) || RISK_LEVELS[0];

    // Detect specific high-risk actions
    const flaggedActions = (context.actions || []).filter(a => isHighRisk(a));

    const mitigations = [
        rawScores.financial >= 6 ? "Start with minimal viable version — validate before investing capital" : null,
        rawScores.legal >= 6     ? "Consult legal/compliance before proceeding with this action" : null,
        rawScores.technical >= 6 ? "Break into smaller testable milestones; build MVP first" : null,
        flaggedActions.length    ? `⚠️ High-risk actions detected: ${flaggedActions.join(", ")} — require manual approval` : null
    ].filter(Boolean);

    const result = {
        id:              uid("risk"),
        context:         context.title || context.goal || "Unnamed action",
        scores:          rawScores,
        weightedScore:   overallScore,
        maxScore:        10,
        riskLevel:       level.label,
        recommendedAction: level.action,
        flaggedActions,
        requiresApproval: level.action === "REQUIRE_APPROVAL" || flaggedActions.length > 0,
        blocked:          level.action === "BLOCK",
        mitigations,
        evaluatedAt:     NOW()
    };

    logToMemory("riskPredictionEngine", context.title || "evaluation", { level: level.label, score: overallScore });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = evaluate({
            title:        p.title || p.goal || task.input,
            capitalNeeded: p.capitalNeeded || "Low",
            actions:      p.actions || [],
            timeline:     p.timeline || "3 months",
            targetMarket: p.targetMarket || ""
        });
        return ok("riskPredictionEngine", data, ["Higher risk = smaller first step", "Always have an exit/pivot plan"]);
    } catch (err) { return fail("riskPredictionEngine", err.message); }
}

module.exports = { evaluate, RISK_FACTORS, RISK_LEVELS, run };
