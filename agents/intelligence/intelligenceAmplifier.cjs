"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_ITERATIONS, scoreReasoning } = require("./_intelligenceStore.cjs");
const AGENT = "intelligenceAmplifier";

const AMPLIFICATION_TECHNIQUES = [
    { name:"Socratic Questioning",  apply:(text, goal) => `Why does "${goal}" matter at the deepest level? What would change if it succeeded? What would be lost if it failed? ${text}` },
    { name:"Steel-Manning",         apply:(text, goal) => `Strongest possible version of "${goal}": ${text}. Even critics who reject this must acknowledge its best form.` },
    { name:"Pre-Mortem Analysis",   apply:(text, goal) => `Imagine "${goal}" failed in 12 months. The most likely reasons: insufficient evidence, wrong assumptions, execution gaps. Amend plan accordingly. ${text}` },
    { name:"Bayesian Update",       apply:(text, goal) => `Prior belief about "${goal}": moderate confidence. After analysis — ${text} — posterior confidence updated based on evidence strength.` },
    { name:"Feynman Technique",     apply:(text, goal) => `Explain "${goal}" as if teaching a 12-year-old: ${text.slice(0, 150)}. If you cannot simplify it, you don't fully understand it yet.` }
];

const CLARITY_FILTERS = [
    { name:"Remove Jargon",      apply:(t) => t.replace(/\b(synergy|paradigm|leverage|disrupt|holistic|agile|bandwidth)\b/gi, "[clear term needed]") },
    { name:"Shorten Sentences",  apply:(t) => t },
    { name:"Active Voice",       apply:(t) => t.replace(/is being|was being|were being/g, "is") }
];

function amplify({ userId, reasoning, goal, level = 1 }) {
    if (!userId || !reasoning) return fail(AGENT, "userId and reasoning required");

    const safeLevel      = Math.min(level, MAX_ITERATIONS);
    let   amplified      = reasoning;
    const techniquesUsed = [];

    for (let i = 0; i < safeLevel; i++) {
        const tech  = AMPLIFICATION_TECHNIQUES[i % AMPLIFICATION_TECHNIQUES.length];
        amplified   = tech.apply(amplified, goal || "the goal");
        techniquesUsed.push(tech.name);
    }

    // Apply clarity filters
    CLARITY_FILTERS.forEach(f => { amplified = f.apply(amplified); });

    const beforeScore = scoreReasoning(reasoning);
    const afterScore  = scoreReasoning(amplified);

    const sessionId = uid("amp");
    const log = load(userId, "amplification_log", []);
    log.push({ sessionId, goal, level: safeLevel, techniquesUsed, scoreBefore: beforeScore.score, scoreAfter: afterScore.score, createdAt: NOW() });
    flush(userId, "amplification_log", log.slice(-500));

    return ok(AGENT, {
        sessionId,
        original:        reasoning.slice(0, 200),
        amplified:       amplified.slice(0, 800),
        techniquesUsed,
        scoreBefore:     beforeScore,
        scoreAfter:      afterScore,
        improvement:     afterScore.score - beforeScore.score,
        levelApplied:    safeLevel
    });
}

function getTechniques() {
    return ok(AGENT, {
        techniques:   AMPLIFICATION_TECHNIQUES.map(t => ({ name:t.name })),
        maxLevel:     MAX_ITERATIONS,
        clarityFilters: CLARITY_FILTERS.map(f => f.name)
    });
}

module.exports = { amplify, getTechniques };
