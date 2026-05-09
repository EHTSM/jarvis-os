"use strict";
const { load, flush, uid, NOW, humanAILog, requireConsent, watermark, ok, fail, blocked, BCI_DISCLAIMER } = require("./_humanAIStore.cjs");
const AGENT = "brainComputerInterfaceAgent";

// ⚠️ SIMULATION ONLY — no real BCI hardware or neural data is accessed

const SIMULATED_SIGNAL_TYPES = {
    focus:     { name:"Focus Signal",     hz:"13-30 Hz (Beta)",  description:"Concentration and active thinking state" },
    relaxed:   { name:"Relaxed Signal",   hz:"8-13 Hz (Alpha)",  description:"Calm, creative, eyes-closed state" },
    deep_focus:{ name:"Deep Focus",       hz:"30-100 Hz (Gamma)",description:"High-level cognitive processing state" },
    drowsy:    { name:"Drowsy Signal",    hz:"4-8 Hz (Theta)",   description:"Light sleep and meditative state" },
    sleep:     { name:"Sleep Signal",     hz:"0.5-4 Hz (Delta)", description:"Deep sleep and unconscious processing" }
};

const INPUT_MODES = ["text_intent","gesture_intent","emotion_intent","command_intent"];

function simulateSignalReading({ userId, consent, signalType = "focus", intentText }) {
    const gate = requireConsent(consent, "BCI signal simulation");
    if (gate) return { ...gate, agent: AGENT };

    if (!userId) return fail(AGENT, "userId required");
    if (!SIMULATED_SIGNAL_TYPES[signalType]) return fail(AGENT, `signalType must be: ${Object.keys(SIMULATED_SIGNAL_TYPES).join(", ")}`);

    const signal  = SIMULATED_SIGNAL_TYPES[signalType];
    const reading = {
        id:            uid("bci"),
        signalType,
        signalName:    signal.name,
        frequency:     signal.hz,
        description:   signal.description,
        simulatedAmplitude: parseFloat((Math.random() * 50 + 10).toFixed(2)),
        noiseLevel:    parseFloat((Math.random() * 0.3).toFixed(3)),
        interpretedIntent: intentText ? `Simulated neural intent: "${intentText}"` : `Baseline ${signalType} state detected`,
        confidence:    Math.round(60 + Math.random() * 35),
        readingAt:     NOW(),
        ...watermark(AGENT)
    };

    const history = load(userId, "bci_readings", []);
    history.push({ id: reading.id, signalType, confidence: reading.confidence, timestamp: reading.readingAt });
    flush(userId, "bci_readings", history.slice(-1000));

    humanAILog(AGENT, userId, "bci_signal_simulated", { signalType, confidence: reading.confidence }, "INFO");

    return ok(AGENT, reading, { bciDisclaimer: BCI_DISCLAIMER });
}

function getSignalHistory({ userId, consent, limit = 20 }) {
    const gate = requireConsent(consent, "BCI history access");
    if (gate) return { ...gate, agent: AGENT };
    if (!userId) return fail(AGENT, "userId required");

    const history = load(userId, "bci_readings", []);
    humanAILog(AGENT, userId, "bci_history_accessed", { count: history.length }, "INFO");
    return ok(AGENT, { total: history.length, readings: history.slice(-limit).reverse(), bciDisclaimer: BCI_DISCLAIMER });
}

function getSupportedSignals() {
    return ok(AGENT, { signals: Object.entries(SIMULATED_SIGNAL_TYPES).map(([k,v]) => ({ key:k, ...v })), inputModes: INPUT_MODES, bciDisclaimer: BCI_DISCLAIMER });
}

module.exports = { simulateSignalReading, getSignalHistory, getSupportedSignals };
