"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, limitIdeas, INTELLIGENCE_DISCLAIMER } = require("./_intelligenceStore.cjs");
const AGENT = "quantumInterface";

// ── SIMULATION ONLY — no real quantum computing ───────────────────
const QUANTUM_DISCLAIMER = "⚠️ QUANTUM SIMULATION ONLY — This module uses quantum-inspired algorithms as metaphors for parallel idea exploration. It does NOT interact with real quantum hardware or execute actual quantum circuits.";

const QUANTUM_PRINCIPLES_APPLIED = {
    superposition:  "Multiple states (ideas) considered simultaneously before collapsing to a decision",
    entanglement:   "Ideas that evolve together — changing one insight updates correlated insights",
    interference:   "Destructive: cancel weak ideas. Constructive: amplify strong overlapping ideas",
    tunneling:      "Occasionally explore seemingly impossible solutions that a classical approach would reject",
    decoherence:    "The act of measuring/deciding collapses superposition to a single outcome"
};

function _simulateSuperposition(ideas) {
    // Each idea gets a quantum amplitude (complex-ish probability weight)
    return ideas.map((idea, i) => ({
        ideaId:    idea.id || uid("qi"),
        state:     "superposed",
        amplitude: parseFloat((0.3 + Math.random() * 0.7).toFixed(3)),
        phase:     parseFloat((Math.random() * 2 * Math.PI).toFixed(3)),
        idea:      idea.thought || idea.enhancement || idea.hypothesis || String(idea).slice(0,150)
    }));
}

function _collapse(superposed) {
    // "Measure" — pick highest amplitude as winner
    const measured = superposed.reduce((best, s) => s.amplitude > best.amplitude ? s : best, superposed[0]);
    return {
        collapsed:   true,
        winner:      measured,
        probability: parseFloat((measured.amplitude / superposed.reduce((s, x) => s + x.amplitude, 0)).toFixed(3))
    };
}

function _applyInterference(superposed) {
    const avg = superposed.reduce((s, x) => s + x.amplitude, 0) / superposed.length;
    return superposed.map(s => ({
        ...s,
        interferenceType: s.amplitude > avg ? "constructive" : "destructive",
        postAmplitude:    s.amplitude > avg
            ? Math.min(1.0, parseFloat((s.amplitude * 1.3).toFixed(3)))
            : Math.max(0.1, parseFloat((s.amplitude * 0.7).toFixed(3)))
    }));
}

function superpose({ userId, ideas = [], goal }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!ideas.length && !goal) return fail(AGENT, "ideas[] or goal required");

    const sourceIdeas = limitIdeas(ideas.length ? ideas : [{ thought: goal }]);
    const superposed  = _simulateSuperposition(sourceIdeas);
    const interfered  = _applyInterference(superposed);
    const collapsed   = _collapse(interfered);

    const sessionId = uid("qsi");
    const log = load(userId, "quantum_log", []);
    log.push({ sessionId, ideaCount: sourceIdeas.length, winnerAmplitude: collapsed.winner.amplitude, createdAt: NOW() });
    flush(userId, "quantum_log", log.slice(-500));

    return ok(AGENT, {
        sessionId,
        principle:      "Superposition + Interference",
        superposedStates: interfered,
        measurement:     collapsed,
        quantumInsight:  `From ${sourceIdeas.length} superposed idea(s), quantum interference amplified the strongest and suppressed the weakest. Collapsed state: "${collapsed.winner.idea.slice(0,100)}" (probability: ${(collapsed.probability * 100).toFixed(1)}%).`,
        warning:         QUANTUM_DISCLAIMER,
        disclaimer:      INTELLIGENCE_DISCLAIMER
    });
}

function tunnel({ userId, idea, barrierDescription = "conventional thinking" }) {
    if (!userId || !idea) return fail(AGENT, "userId and idea required");

    const ideaText = idea.thought || idea.hypothesis || (typeof idea === "string" ? idea : JSON.stringify(idea));
    const tunneled = Math.random() > 0.5; // Probabilistic — sometimes you get through, sometimes you don't
    const result   = {
        principle:   "Quantum Tunneling",
        input:       ideaText.slice(0, 150),
        barrier:     barrierDescription,
        tunneled,
        output:      tunneled
            ? `[TUNNELED] The idea successfully bypassed "${barrierDescription}" — exploring: "${ideaText.slice(0,100)}... applied in the non-obvious domain beyond the barrier"`
            : `[REFLECTED] The idea did not tunnel through "${barrierDescription}" — classical constraints hold for this approach`,
        warning:     QUANTUM_DISCLAIMER
    };

    return ok(AGENT, result);
}

function getQuantumPrinciples() {
    return ok(AGENT, {
        principles: Object.entries(QUANTUM_PRINCIPLES_APPLIED).map(([k,v]) => ({ principle:k, application:v })),
        warning:    QUANTUM_DISCLAIMER,
        disclaimer: INTELLIGENCE_DISCLAIMER,
        note:       "This module uses quantum metaphors to structure creative exploration — it is not a real quantum computer"
    });
}

module.exports = { superpose, tunnel, getQuantumPrinciples };
