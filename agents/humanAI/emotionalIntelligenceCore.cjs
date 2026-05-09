"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "emotionalIntelligenceCore";

// ⚠️ SIMULATION ONLY — EQ assessments are educational tools, not clinical diagnostics

const EQ_DOMAINS = {
    self_awareness:     "Ability to recognise own emotions and their impact",
    self_regulation:    "Managing disruptive emotions and impulses effectively",
    motivation:         "Internal drive and resilience toward goals",
    empathy:            "Understanding and sharing the feelings of others",
    social_skills:      "Managing relationships and building networks"
};

const EQ_BANDS = { low:[0,39], developing:[40,59], competent:[60,74], high:[75,89], exceptional:[90,100] };

function _getBand(score) {
    for (const [band, [min, max]] of Object.entries(EQ_BANDS)) {
        if (score >= min && score <= max) return band;
    }
    return "developing";
}

function assessEQ({ userId, consent, selfResponses = {} }) {
    const gate = requireConsent(consent, "EQ assessment");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const domainScores = {};
    Object.keys(EQ_DOMAINS).forEach(d => {
        domainScores[d] = selfResponses[d] !== undefined
            ? Math.min(100, Math.max(0, Number(selfResponses[d])))
            : Math.round(40 + Math.random() * 55);
    });

    const overallEQ = Math.round(Object.values(domainScores).reduce((a,b) => a+b, 0) / Object.keys(EQ_DOMAINS).length);
    const band = _getBand(overallEQ);
    const weakest = Object.entries(domainScores).sort((a,b)=>a[1]-b[1])[0][0];
    const strongest = Object.entries(domainScores).sort((a,b)=>b[1]-a[1])[0][0];

    const assessment = {
        id:             uid("eq"),
        domainScores,
        overallEQ,
        band,
        strongestDomain: strongest,
        weakestDomain:   weakest,
        developmentTip:  `Focus on ${weakest.replace(/_/g," ")}: ${EQ_DOMAINS[weakest]}`,
        assessedAt:      NOW(),
        ...watermark(AGENT)
    };

    const history = load(userId, "eq_assessments", []);
    history.push({ id: assessment.id, overallEQ, band, assessedAt: assessment.assessedAt });
    flush(userId, "eq_assessments", history.slice(-500));

    humanAILog(AGENT, userId, "eq_assessed", { overallEQ, band }, "INFO");
    return ok(AGENT, assessment, { clinicalNote: "Educational simulation only — not a clinical EQ diagnostic tool" });
}

function getEQProgress({ userId, consent }) {
    const gate = requireConsent(consent, "EQ progress tracking");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const history = load(userId, "eq_assessments", []);
    if (!history.length) return ok(AGENT, { message: "No EQ assessments yet", history: [] });

    const trend = history.length >= 2 ? history[history.length-1].overallEQ - history[0].overallEQ : 0;
    return ok(AGENT, {
        totalAssessments: history.length,
        latestEQ:  history[history.length-1].overallEQ,
        latestBand: history[history.length-1].band,
        firstEQ:   history[0].overallEQ,
        trend:     trend > 0 ? `+${trend}` : String(trend),
        trendDirection: trend > 2 ? "improving" : trend < -2 ? "declining" : "stable",
        history:   history.slice(-20)
    });
}

function getEQCoachingTip({ userId, consent, domain }) {
    const gate = requireConsent(consent, "EQ coaching");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (domain && !EQ_DOMAINS[domain]) return fail(AGENT, `domain must be: ${Object.keys(EQ_DOMAINS).join(", ")}`);

    const targetDomain = domain || Object.keys(EQ_DOMAINS)[Math.floor(Math.random() * Object.keys(EQ_DOMAINS).length)];
    const tips = {
        self_awareness:  "Try journaling for 5 minutes daily — note what you feel and what triggered it.",
        self_regulation: "Pause 10 seconds before reacting in emotional situations — name the emotion first.",
        motivation:      "Connect your daily tasks to your deeper 'why'. Review your purpose statement each morning.",
        empathy:         "Practice active listening: summarise what others say before responding.",
        social_skills:   "Find one opportunity today to build rapport — remember a detail from a previous conversation."
    };

    return ok(AGENT, {
        domain: targetDomain,
        description: EQ_DOMAINS[targetDomain],
        coachingTip: tips[targetDomain],
        generatedAt: NOW()
    });
}

module.exports = { assessEQ, getEQProgress, getEQCoachingTip };
