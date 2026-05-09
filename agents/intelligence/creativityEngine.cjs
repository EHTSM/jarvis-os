"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, limitIdeas } = require("./_intelligenceStore.cjs");
const AGENT = "creativityEngine";

// SCAMPER technique + lateral thinking lenses
const SCAMPER = [
    { op:"Substitute",  q:"What components can be replaced with something better or cheaper?" },
    { op:"Combine",     q:"What two or more ideas can be merged for a compound effect?" },
    { op:"Adapt",       q:"What works in another field that can be adapted here?" },
    { op:"Modify",      q:"What if you magnified, minimised, or distorted a key element?" },
    { op:"Put to other uses", q:"How else can this idea be applied beyond its original purpose?" },
    { op:"Eliminate",   q:"What if you stripped away the least essential element?" },
    { op:"Reverse",     q:"What if you reversed the process, order, or role of the components?" }
];

const CREATIVITY_BOOSTERS = [
    "Consider the opposite user — who would hate this and why?",
    "Apply the 10× rule — how would you achieve 10× the goal with the same resources?",
    "Think decade forward — what does a mature version of this look like in 10 years?",
    "Constraint storm — what if cost was zero? What if time was zero? What if geography didn't exist?",
    "Cross-domain transfer — how does biology / architecture / music solve a similar problem?",
    "Worst possible idea — brainstorm the most ridiculous version; extract a seed from it."
];

function enhanceIdeas({ userId, ideas = [], goal, iterations = 1 }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!ideas.length && !goal) return fail(AGENT, "ideas[] or goal required");

    // Safety cap
    const safeIterations = Math.min(iterations, 3);
    const safeIdeas      = limitIdeas(ideas);

    // If no ideas passed, synthesise from goal
    const sourceIdeas = safeIdeas.length ? safeIdeas : [{ thought: goal, frame: "Raw Goal" }];

    const enhanced = [];
    let iter = 0;

    while (iter < safeIterations && enhanced.length < MAX_IDEAS) {
        iter++;
        for (const idea of sourceIdeas) {
            if (enhanced.length >= MAX_IDEAS) break;
            const scamperOp = SCAMPER[enhanced.length % SCAMPER.length];
            const booster   = CREATIVITY_BOOSTERS[enhanced.length % CREATIVITY_BOOSTERS.length];
            enhanced.push({
                id:            uid("ce"),
                sourceThought: idea.thought || idea,
                scamperOp:     scamperOp.op,
                enhancement:   `${scamperOp.q} Applied to: "${idea.thought || idea}"`,
                creativityBoost: booster,
                iteration:     iter,
                noveltyScore:  Math.round(50 + Math.random() * 45),
                generatedAt:   NOW()
            });
        }
    }

    const log = load(userId, "creativity_log", []);
    log.push({ sessionId: uid("cs"), goal, ideaCount: enhanced.length, iterations: iter, createdAt: NOW() });
    flush(userId, "creativity_log", log.slice(-500));

    return ok(AGENT, { enhanced, iterationsRun: iter, totalEnhanced: enhanced.length });
}

function brainstorm({ userId, topic, technique = "scamper", count = 5 }) {
    if (!userId || !topic) return fail(AGENT, "userId and topic required");

    const safeCount = Math.min(count, MAX_IDEAS);
    const ops       = technique === "scamper" ? SCAMPER : CREATIVITY_BOOSTERS.map((b, i) => ({ op:`Boost${i+1}`, q:b }));
    const ideas     = Array.from({ length: safeCount }, (_, i) => ({
        id:      uid("bs"),
        technique,
        op:      ops[i % ops.length].op || `Technique ${i+1}`,
        prompt:  ops[i % ops.length].q || ops[i % ops.length],
        idea:    `[${ops[i % ops.length].op || `B${i+1}`}] For topic "${topic}": ${ops[i % ops.length].q || ops[i % ops.length]}`,
        score:   Math.round(40 + Math.random() * 55)
    }));

    return ok(AGENT, { topic, technique, ideas, count: ideas.length });
}

module.exports = { enhanceIdeas, brainstorm };
