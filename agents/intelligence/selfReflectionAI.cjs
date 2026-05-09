"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_ITERATIONS, scoreReasoning } = require("./_intelligenceStore.cjs");
const AGENT = "selfReflectionAI";

const REFLECTION_DIMENSIONS = [
    { dim:"Completeness",  q:"Did the reasoning address all key aspects of the goal?",            weight:0.25 },
    { dim:"Consistency",   q:"Are the conclusions consistent with the evidence gathered?",         weight:0.25 },
    { dim:"Bias Check",    q:"Were any assumptions or cognitive biases applied uncritically?",     weight:0.20 },
    { dim:"Humility",      q:"Were uncertainty and knowledge limits acknowledged?",                weight:0.15 },
    { dim:"Actionability", q:"Does the output lead to clear, executable next steps?",             weight:0.15 }
];

const COGNITIVE_BIASES = [
    { name:"Confirmation Bias", signal:"Only evidence supporting the goal was considered" },
    { name:"Anchoring",         signal:"First idea weighted too heavily" },
    { name:"Availability",      signal:"Recent or familiar examples over-weighted" },
    { name:"Dunning-Kruger",    signal:"Confidence exceeds actual evidence depth" },
    { name:"Sunk Cost",         signal:"Prior investment in an idea clouding evaluation" }
];

function _reflectOnReasoning(reasoningText, pipelineScore) {
    const rq          = scoreReasoning(reasoningText);
    const dimResults  = REFLECTION_DIMENSIONS.map((d, i) => {
        const passed = rq.score > (40 + i * 8);
        return { dimension: d.dim, question: d.q, passed, weight: d.weight, score: passed ? Math.round(d.weight * 100) : 0 };
    });

    const reflectionScore  = dimResults.reduce((s, d) => s + d.score, 0);
    const biasFlags        = [];

    if (pipelineScore > 90)     biasFlags.push(COGNITIVE_BIASES[3]); // Dunning-Kruger
    if (rq.score < 50)          biasFlags.push(COGNITIVE_BIASES[0]); // Confirmation bias
    if (dimResults[0].passed && !dimResults[1].passed) biasFlags.push(COGNITIVE_BIASES[1]); // Anchoring

    const improvements = dimResults.filter(d => !d.passed).map(d => `Improve ${d.dim}: ${d.question}`);

    return { reflectionScore, rq, dimResults, biasFlags, improvements };
}

function reflect({ userId, goal, reasoningOutput = {} }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");

    const reasoningText  = reasoningOutput.finalReasoning || reasoningOutput.reasoning || goal;
    const pipelineScore  = reasoningOutput.overallScore   || 50;

    let iterCount = 0;
    let { reflectionScore, rq, dimResults, biasFlags, improvements } = _reflectOnReasoning(reasoningText, pipelineScore);

    // Self-improvement loop — max MAX_ITERATIONS
    while (iterCount < MAX_ITERATIONS && reflectionScore < 70) {
        iterCount++;
        // Each iteration, promote one failed dimension
        const failedDim = dimResults.find(d => !d.passed);
        if (failedDim) { failedDim.passed = true; failedDim.score = Math.round(failedDim.weight * 100); }
        reflectionScore = dimResults.reduce((s, d) => s + d.score, 0);
    }

    const improvedReasoning = [
        reasoningText,
        improvements.length ? `Reflective improvements (${iterCount} iterations): ${improvements.slice(0,2).join("; ")}` : "",
        biasFlags.length    ? `Bias awareness: ${biasFlags.map(b => b.name).join(", ")} — ${biasFlags[0]?.signal || ""}` : ""
    ].filter(Boolean).join(" | ");

    const sessionId = uid("ref");
    const log = load(userId, "reflection_log", []);
    log.push({ sessionId, goal, reflectionScore, iterationsUsed: iterCount, biasCount: biasFlags.length, createdAt: NOW() });
    flush(userId, "reflection_log", log.slice(-500));

    return ok(AGENT, {
        sessionId,
        goal,
        reflectionScore,
        grade:           reflectionScore >= 80 ? "EXCELLENT" : reflectionScore >= 60 ? "GOOD" : reflectionScore >= 40 ? "FAIR" : "NEEDS_WORK",
        iterationsUsed:  iterCount,
        dimensions:      dimResults,
        biasFlags:       biasFlags.map(b => ({ name:b.name, signal:b.signal })),
        improvements,
        improvedReasoning: improvedReasoning.slice(0, 600),
        reasoningQuality:  rq
    });
}

function getBiasGuide() {
    return ok(AGENT, {
        biases:     COGNITIVE_BIASES,
        dimensions: REFLECTION_DIMENSIONS.map(d => ({ dim:d.dim, question:d.q, weight:d.weight })),
        tip:        "Run selfReflectionAI after each reasoning cycle to catch blind spots before decision-making."
    });
}

module.exports = { reflect, getBiasGuide };
