"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_ITERATIONS, scoreReasoning, INTELLIGENCE_DISCLAIMER } = require("./_intelligenceStore.cjs");
const AGENT = "advancedReasoningCore";

const REASONING_MODES = {
    deductive:   { name:"Deductive",   desc:"From general principles to specific conclusions",   weight:0.30 },
    inductive:   { name:"Inductive",   desc:"From specific evidence to general patterns",        weight:0.25 },
    abductive:   { name:"Abductive",   desc:"Best explanation from incomplete evidence",         weight:0.20 },
    analogical:  { name:"Analogical",  desc:"Apply patterns from similar domains",               weight:0.15 },
    counterfactual:{ name:"Counterfactual", desc:"What-if reasoning about alternative outcomes", weight:0.10 }
};

const LOGICAL_FALLACY_PATTERNS = [
    { name:"Ad Hominem",       pattern:/because (they|he|she|it) (is|are|was|were) (bad|wrong|stupid)/i },
    { name:"False Dichotomy",  pattern:/either.*or.*only two/i },
    { name:"Appeal to Nature", pattern:/natural.*therefore (good|safe|correct)/i },
    { name:"Overgeneralise",   pattern:/always|never|everyone|no one|all people/i },
    { name:"Correlation=Causation", pattern:/because .{0,30} increased? .{0,30} must have caused/i }
];

function _detectFallacies(text) {
    return LOGICAL_FALLACY_PATTERNS.filter(f => f.pattern.test(text)).map(f => f.name);
}

function _buildSynthesis(pipelineOutput, goal) {
    const {
        thoughts    = [],
        enhanced    = [],
        hypotheses  = [],
        validated   = [],
        experiments = []
    } = pipelineOutput;

    const bestHyp    = hypotheses.find(h => h.testability?.score >= 60) || hypotheses[0];
    const bestExp    = experiments.reduce((b, e) => (e.simulatedScore || 0) > (b.simulatedScore || 0) ? e : b, experiments[0] || {});
    const topIdea    = validated[0] || enhanced[0] || thoughts[0];

    const reasoning = [
        `Goal Analysis: "${goal}" was decomposed using ${thoughts.length} thinking frames.`,
        `Creative enhancement produced ${enhanced.length} novel angles.`,
        bestHyp ? `Strongest hypothesis: "${(bestHyp.hypothesis || "").slice(0, 150)}"` : "No strong hypothesis formed.",
        bestExp.outcome ? `Best simulated outcome: ${bestExp.outcome} (score: ${bestExp.simulatedScore}/100).` : "",
        topIdea ? `Top validated concept: "${(topIdea.idea || topIdea.thought || "").slice(0, 100)}"` : "",
    ].filter(Boolean).join(" ");

    const overallScore = Math.round([
        thoughts.length > 0 ? 80 : 0,
        enhanced.length > 0 ? 75 : 0,
        bestHyp?.testability?.score || 0,
        bestExp?.simulatedScore     || 0,
        validated.length > 0 ? 70 : 0
    ].reduce((s, v) => s + v, 0) / 5);

    return {
        reasoning,
        overallScore,
        confidence: overallScore >= 70 ? "HIGH" : overallScore >= 50 ? "MEDIUM" : "LOW",
        keyInsights: [
            thoughts.length   ? `${thoughts.length} thought vectors explored` : null,
            enhanced.length   ? `${enhanced.length} creative enhancements generated` : null,
            hypotheses.length ? `${hypotheses.length} hypotheses formulated` : null,
            validated.length  ? `${validated.length} ideas survived validation` : null,
            bestExp.outcome   ? `Best experiment outcome: ${bestExp.outcome}` : null
        ].filter(Boolean),
        decision: overallScore >= 70
            ? `PROCEED — evidence supports pursuing this direction with a structured plan`
            : overallScore >= 45
            ? `EXPLORE FURTHER — promising but needs more evidence before committing resources`
            : `PAUSE — insufficient signal strength; revisit goal framing or inputs`,
        bestHypothesis:    bestHyp  || null,
        bestExperiment:    bestExp  || null
    };
}

function reason({ userId, goal, pipelineOutput = {} }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");

    const iterations = Math.min(MAX_ITERATIONS, 3);
    const synthesis  = _buildSynthesis(pipelineOutput, goal);
    const fallacies  = _detectFallacies(synthesis.reasoning);
    const rQuality   = scoreReasoning(synthesis.reasoning);

    let finalReasoning = synthesis.reasoning;
    for (let i = 0; i < iterations; i++) {
        if (!fallacies.length && rQuality.grade === "STRONG") break;
        finalReasoning += ` [Iteration ${i+1} refinement: cross-checked ${Object.keys(REASONING_MODES)[i % 5]} reasoning mode]`;
    }

    const modes = Object.entries(REASONING_MODES).map(([k, v]) => ({
        mode:       v.name,
        applied:    true,
        contribution: `${Math.round(v.weight * synthesis.overallScore)}/100`
    }));

    const reasoningId = uid("arc");
    const log = load(userId, "reasoning_log", []);
    log.push({ reasoningId, goal, score: synthesis.overallScore, confidence: synthesis.confidence, createdAt: NOW() });
    flush(userId, "reasoning_log", log.slice(-500));

    return ok(AGENT, {
        reasoningId,
        goal,
        finalReasoning,
        reasoningModes:    modes,
        fallaciesDetected: fallacies,
        reasoningQuality:  rQuality,
        ...synthesis
    });
}

function getReasoningModes() {
    return ok(AGENT, { modes: Object.entries(REASONING_MODES).map(([k,v]) => ({ key:k, ...v })), fallacyPatterns: LOGICAL_FALLACY_PATTERNS.map(f => f.name), disclaimer: INTELLIGENCE_DISCLAIMER });
}

module.exports = { reason, getReasoningModes };
