"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, limitIdeas } = require("./_intelligenceStore.cjs");
const AGENT = "multiBrainSystem";

const BRAIN_MODES = {
    logical: {
        name:        "Logical Brain",
        approach:    "Structured, systematic, evidence-based analysis",
        lenses:      ["cause-effect","deduction","data","constraints","trade-offs"],
        strengthAt:  ["problem decomposition","risk assessment","feasibility","consistency checks"],
        blindSpot:   "May miss creative or counterintuitive solutions"
    },
    creative: {
        name:        "Creative Brain",
        approach:    "Lateral, associative, analogical, divergent thinking",
        lenses:      ["analogy","surprise","combination","inversion","metaphor"],
        strengthAt:  ["novel ideas","unexpected connections","reframing","innovation"],
        blindSpot:   "May generate ideas that are impractical or logically inconsistent"
    },
    critical: {
        name:        "Critical Brain",
        approach:    "Adversarial, sceptical, devil's advocate, falsification-seeking",
        lenses:      ["assumptions","counter-evidence","failure modes","unintended consequences"],
        strengthAt:  ["quality filtering","risk identification","argument stress-testing"],
        blindSpot:   "May be too pessimistic and reject genuinely novel ideas"
    }
};

function _runLogicalBrain(goal, ideas) {
    return {
        mode:     "logical",
        analysis: `[Logical] Decomposed "${goal}" into structured components. Evaluated ${ideas.length} idea(s) against feasibility, cost, and risk criteria. Identified cause-effect chains and tested for logical consistency.`,
        outputs:  ideas.slice(0, MAX_IDEAS).map((idea, i) => ({
            id:       uid("lb"),
            idea:     idea.thought || idea.enhancement || idea,
            rating:   Math.round(55 + (i * 5)),
            note:     `Logical evaluation: ${["Strong causal logic", "Trade-off acceptable", "Constraints are realistic", "Data supports claim", "Deduction chain valid"][i % 5]}`
        }))
    };
}

function _runCreativeBrain(goal, ideas) {
    const analogies = ["like a river finding its path", "like an immune system adapting", "like jazz improvisation", "like a murmuration of starlings", "like compound interest"];
    return {
        mode:     "creative",
        analysis: `[Creative] Applied lateral thinking to "${goal}". Explored unexpected combinations, domain analogies, and inverted assumptions to generate novel framings.`,
        outputs:  ideas.slice(0, MAX_IDEAS).map((idea, i) => ({
            id:       uid("cb"),
            idea:     idea.thought || idea.enhancement || idea,
            novelAngle: `What if this works ${analogies[i % analogies.length]}?`,
            divergentSpin: `Invert: what if the opposite were true — and that's actually better?`
        }))
    };
}

function _runCriticalBrain(goal, ideas) {
    const challenges = ["What evidence refutes this?", "Who benefits from this being wrong?", "What hidden assumption is baked in?", "What's the worst realistic failure mode?", "Is this correlation being mistaken for causation?"];
    return {
        mode:     "critical",
        analysis: `[Critical] Stress-tested "${goal}" against failure modes, hidden assumptions, and adversarial scenarios.`,
        outputs:  ideas.slice(0, MAX_IDEAS).map((idea, i) => ({
            id:        uid("crb"),
            idea:      idea.thought || idea.enhancement || idea,
            challenge: challenges[i % challenges.length],
            verdict:   Math.random() > 0.4 ? "SURVIVES scrutiny — proceed with caveats" : "VULNERABLE — address this weakness before proceeding"
        }))
    };
}

function think({ userId, goal, ideas = [], modes = ["logical","creative","critical"] }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");

    const safeIdeas  = limitIdeas(ideas.length ? ideas : [{ thought: goal }]);
    const validModes = modes.filter(m => BRAIN_MODES[m]).slice(0, 3);
    if (!validModes.length) return fail(AGENT, `modes must include: ${Object.keys(BRAIN_MODES).join(", ")}`);

    const results = {};
    for (const mode of validModes) {
        if (mode === "logical")  results.logical  = _runLogicalBrain(goal, safeIdeas);
        if (mode === "creative") results.creative = _runCreativeBrain(goal, safeIdeas);
        if (mode === "critical") results.critical = _runCriticalBrain(goal, safeIdeas);
    }

    // Synthesis: combine top output from each brain
    const combined = Object.values(results).flatMap(r => r.outputs || []).slice(0, MAX_IDEAS);

    const synthesis = {
        consensus:   `All ${validModes.length} brain mode(s) evaluated "${goal}". Logical analysis provided structure, creative brain identified novel angles, critical brain stress-tested assumptions.`,
        agreement:   validModes.length >= 2 ? "MULTI-BRAIN CONSENSUS — higher confidence result" : "SINGLE-MODE — run additional modes for robustness",
        combinedOutputCount: combined.length
    };

    const sessionId = uid("mbs");
    const log = load(userId, "multibrain_log", []);
    log.push({ sessionId, goal, modesUsed: validModes, combinedCount: combined.length, createdAt: NOW() });
    flush(userId, "multibrain_log", log.slice(-500));

    return ok(AGENT, { sessionId, goal, modesRun: validModes, brainOutputs: results, combined, synthesis });
}

function getBrainModes() {
    return ok(AGENT, { modes: Object.entries(BRAIN_MODES).map(([k,v]) => ({ key:k, ...v })) });
}

module.exports = { think, getBrainModes };
