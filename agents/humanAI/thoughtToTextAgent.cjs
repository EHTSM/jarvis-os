"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked } = require("./_humanAIStore.cjs");
const AGENT = "thoughtToTextAgent";

// ⚠️ SIMULATION ONLY — no real neural reading or thought extraction occurs

const COGNITIVE_MODES = {
    narrative:   "Continuous story / inner monologue stream",
    conceptual:  "Abstract idea / concept crystallisation",
    emotional:   "Emotion-weighted affective labelling",
    analytical:  "Logical decomposition and structured output",
    creative:    "Free-associative divergent generation"
};

const FILLER_THOUGHTS = [
    "processing context...", "forming intent...", "retrieving associations...",
    "evaluating options...", "synthesising response...", "encoding output..."
];

function _simulateDecoding(rawThought, mode) {
    const prefix = `[SIM:${mode.toUpperCase()}]`;
    if (!rawThought) return `${prefix} ${FILLER_THOUGHTS[Math.floor(Math.random() * FILLER_THOUGHTS.length)]}`;
    const words = rawThought.trim().split(/\s+/);
    const confidence = Math.round(55 + Math.random() * 40);
    const decoded = words.length > 3
        ? `${prefix} "${rawThought.trim()}" → decoded with ${confidence}% confidence`
        : `${prefix} Sparse signal — inferred: "${rawThought.trim()}"`;
    return decoded;
}

function decodeThought({ userId, consent, rawThought, cognitiveMode = "narrative" }) {
    const gate = requireConsent(consent, "thought-to-text simulation");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");
    if (!COGNITIVE_MODES[cognitiveMode]) return fail(AGENT, `cognitiveMode must be: ${Object.keys(COGNITIVE_MODES).join(", ")}`);

    const result = {
        id:            uid("t2t"),
        cognitiveMode,
        modeDescription: COGNITIVE_MODES[cognitiveMode],
        rawInput:      rawThought ? "[provided]" : "[none — baseline scan]",
        decodedText:   _simulateDecoding(rawThought, cognitiveMode),
        wordCount:     rawThought ? rawThought.trim().split(/\s+/).length : 0,
        confidence:    Math.round(55 + Math.random() * 40),
        processingMs:  Math.round(10 + Math.random() * 90),
        decodedAt:     NOW(),
        ...watermark(AGENT)
    };

    const history = load(userId, "t2t_history", []);
    history.push({ id: result.id, cognitiveMode, confidence: result.confidence, decodedAt: result.decodedAt });
    flush(userId, "t2t_history", history.slice(-2000));

    humanAILog(AGENT, userId, "thought_decoded", { cognitiveMode, confidence: result.confidence }, "INFO");
    return ok(AGENT, result);
}

function getThoughtHistory({ userId, consent, limit = 20 }) {
    const gate = requireConsent(consent, "thought history access");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const history = load(userId, "t2t_history", []);
    humanAILog(AGENT, userId, "thought_history_accessed", { count: history.length }, "INFO");
    return ok(AGENT, { total: history.length, thoughts: history.slice(-limit).reverse() });
}

function getCognitiveModes() {
    return ok(AGENT, { modes: Object.entries(COGNITIVE_MODES).map(([k,v]) => ({ key:k, description:v })) });
}

module.exports = { decodeThought, getThoughtHistory, getCognitiveModes };
