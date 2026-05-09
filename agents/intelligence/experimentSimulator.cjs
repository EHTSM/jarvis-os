"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, limitIdeas, MAX_ITERATIONS } = require("./_intelligenceStore.cjs");
const AGENT = "experimentSimulator";

const OUTCOME_BANDS = [
    { min:80, label:"BREAKTHROUGH",    icon:"🚀", meaning:"High-confidence positive result — strongly pursue" },
    { min:60, label:"PROMISING",       icon:"✅", meaning:"Likely positive — worth a real-world pilot" },
    { min:40, label:"INCONCLUSIVE",    icon:"⚠️", meaning:"Mixed signals — redesign experiment variables" },
    { min:20, label:"WEAK",            icon:"📉", meaning:"Low signal — fundamental approach may need revision" },
    { min:0,  label:"REJECTED",        icon:"❌", meaning:"Negative result — pivot away from this direction" }
];

const RISK_FACTORS = [
    { name:"Scalability Risk",    weight:0.20, check:(h) => !/scale|growth|expand/i.test(h) },
    { name:"Resource Risk",       weight:0.15, check:(h) => /expensive|complex|difficult/i.test(h) },
    { name:"Adoption Risk",       weight:0.15, check:(h) => /user|people|customer|adopt/i.test(h) },
    { name:"Technical Risk",      weight:0.20, check:(h) => /algorithm|model|system|data|code/i.test(h) },
    { name:"Market/Context Risk", weight:0.15, check:(h) => /market|society|environment|context/i.test(h) },
    { name:"Time Risk",           weight:0.15, check:(h) => /long|month|year|complex|phase/i.test(h) }
];

function _getOutcomeBand(score) {
    return OUTCOME_BANDS.find(b => score >= b.min) || OUTCOME_BANDS[OUTCOME_BANDS.length - 1];
}

function _simulateExperiment(hypothesis, priorScore = 50) {
    const text         = hypothesis.hypothesis || hypothesis.thought || hypothesis.idea || String(hypothesis);
    const length       = Math.min(text.length, 500);

    // Deterministic-ish score from text characteristics
    const structureScore = (
        (/if.*then/i.test(text) ? 20 : 0) +
        (/because|mechanism|cause/i.test(text) ? 15 : 0) +
        (/measure|metric|percent|rate/i.test(text) ? 15 : 0) +
        (length > 80 ? 10 : 0)
    );

    const riskScore = RISK_FACTORS.reduce((s, r) => s + (r.check(text) ? r.weight * 30 : 0), 0);
    const rawScore  = Math.min(95, Math.max(10, structureScore + (priorScore * 0.3) - riskScore + (Math.random() * 10)));
    const score     = Math.round(rawScore);
    const band      = _getOutcomeBand(score);

    const variables = [
        { name:"Independent",  value:"The hypothesis action" },
        { name:"Dependent",    value:"The measurable outcome" },
        { name:"Control",      value:"Baseline without intervention" },
        { name:"Confounding",  value:"External factors (time, environment, bias)" }
    ];

    return {
        simulatedScore:  score,
        outcome:         band.label,
        icon:            band.icon,
        meaning:         band.meaning,
        risks:           RISK_FACTORS.filter(r => r.check(text)).map(r => r.name),
        variables,
        confidenceLevel: score >= 60 ? "HIGH" : score >= 40 ? "MEDIUM" : "LOW",
        iterations:      Math.min(3, Math.ceil(score / 30))
    };
}

function simulateExperiment({ userId, hypothesis, priorValidationScore = 50 }) {
    if (!userId || !hypothesis) return fail(AGENT, "userId and hypothesis required");

    const text   = hypothesis.hypothesis || hypothesis.thought || (typeof hypothesis === "string" ? hypothesis : JSON.stringify(hypothesis));
    const result = _simulateExperiment(hypothesis, priorValidationScore);
    const simId  = uid("exp");

    const log = load(userId, "experiment_log", []);
    log.push({ simId, hypothesisSnippet: text.slice(0, 100), outcome: result.outcome, score: result.simulatedScore, createdAt: NOW() });
    flush(userId, "experiment_log", log.slice(-500));

    return ok(AGENT, {
        simId,
        hypothesisSnippet: text.slice(0, 200),
        ...result,
        note: "SIMULATION — no real-world experiment was conducted"
    });
}

function simulateBatch({ userId, hypotheses = [], priorScore = 50 }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!hypotheses.length) return fail(AGENT, "hypotheses[] required");

    const safe    = limitIdeas(hypotheses);
    const results = safe.map((h, i) => ({
        index:  i + 1,
        source: (h.hypothesis || h.thought || String(h)).slice(0, 80),
        result: _simulateExperiment(h, priorScore)
    }));

    const topResult = results.reduce((best, r) => r.result.simulatedScore > best.result.simulatedScore ? r : best, results[0]);

    return ok(AGENT, {
        totalSimulated:  results.length,
        results,
        topHypothesis:   topResult,
        recommendation:  `Best performing hypothesis scored ${topResult.result.simulatedScore}/100 (${topResult.result.outcome}) — ${topResult.result.meaning}`
    });
}

module.exports = { simulateExperiment, simulateBatch };
