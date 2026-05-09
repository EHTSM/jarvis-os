/**
 * AI Decision Maker — scores and gates every autonomous action.
 * Formula: score = (reward × feasibility) / (risk + 1)
 * Execution only proceeds if score > DECISION_THRESHOLD (15).
 */

const { uid, NOW, logToMemory, ok, fail, approvalRequired, DECISION_THRESHOLD, isHighRisk } = require("./_autoStore.cjs");

const FEASIBILITY_MAP = {
    "Very High": 9, "High": 7, "Medium": 5, "Low": 3, "Very Low": 1
};

const REWARD_MAP = {
    "Explosive": 10, "Very High": 8, "High": 6, "Steady": 4, "Low": 2
};

function _scoreDecision({ risk = 5, reward = "High", feasibility = "Medium", confidence = 70 }) {
    const r = typeof reward      === "number" ? reward      : (REWARD_MAP[reward]      || 6);
    const f = typeof feasibility === "number" ? feasibility : (FEASIBILITY_MAP[feasibility] || 5);
    const rsk = typeof risk === "number" ? risk : 5;

    const raw          = (r * f) / (rsk + 1);
    const confidenceAdj = raw * (confidence / 100);
    return {
        raw:          +raw.toFixed(2),
        adjusted:     +confidenceAdj.toFixed(2),
        components:   { reward: r, feasibility: f, risk: rsk, confidence }
    };
}

function decide({ opportunity = {}, scenario = {}, risk = {}, overrideApproval = false }) {
    const riskScore     = risk.weightedScore   || 5;
    const demand        = opportunity?.recommended?.demand || "High";
    const scalability   = opportunity?.recommended?.scalability || "High";
    const confidence    = opportunity?.recommended?.confidence || 70;

    const scores        = _scoreDecision({ risk: riskScore, reward: demand, feasibility: scalability, confidence });
    const approved      = scores.adjusted > DECISION_THRESHOLD && !risk.blocked;
    const needsApproval = risk.requiresApproval && !overrideApproval;

    // Build execution plan from approved opportunity
    const plan = approved && !needsApproval ? [
        { step: 1, action: "validate",     description: `Validate "${opportunity?.recommended?.title || "idea"}" with target market` },
        { step: 2, action: "build_mvp",    description: "Build minimum viable version" },
        { step: 3, action: "soft_launch",  description: "Launch to small audience, collect feedback" },
        { step: 4, action: "iterate",      description: "Improve based on feedback (max 3 cycles)" },
        { step: 5, action: "scale",        description: "Scale validated approach" }
    ] : [];

    const result = {
        id:              uid("dec"),
        approved,
        needsApproval,
        score:           scores.adjusted,
        threshold:       DECISION_THRESHOLD,
        scoreBreakdown:  scores,
        riskLevel:       risk.riskLevel       || "Medium",
        reason:          !approved ? (risk.blocked ? `Execution blocked — risk score ${riskScore.toFixed(1)} too high` : `Score ${scores.adjusted.toFixed(1)} below threshold ${DECISION_THRESHOLD}`) : "All checks passed",
        plan,
        flaggedActions:  risk.flaggedActions  || [],
        mitigations:     risk.mitigations     || [],
        decidedAt:       NOW()
    };

    logToMemory("aiDecisionMaker", opportunity?.recommended?.title || "decision", { approved, score: scores.adjusted });

    if (needsApproval) {
        return {
            ...result,
            approvalRequired: true,
            message: `⚠️ High-risk actions detected (${risk.flaggedActions?.join(", ")}). Human approval required before execution.`
        };
    }

    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = decide({
            opportunity:      p.opportunity || {},
            scenario:         p.scenario    || {},
            risk:             p.risk        || {},
            overrideApproval: p.overrideApproval === true
        });

        if (data.needsApproval) {
            return approvalRequired("aiDecisionMaker", "High-risk action requires approval", data.flaggedActions.join(", "));
        }
        return ok("aiDecisionMaker", data, data.approved ? ["Execute plan", "Monitor each step"] : ["Reconsider approach", "Reduce risk factors"]);
    } catch (err) { return fail("aiDecisionMaker", err.message); }
}

module.exports = { decide, DECISION_THRESHOLD, run };
