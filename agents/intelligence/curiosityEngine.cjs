"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS } = require("./_intelligenceStore.cjs");
const AGENT = "curiosityEngine";

const QUESTION_TYPES = {
    clarifying:   { prefix:"What exactly do you mean by",   depth:1 },
    causal:       { prefix:"What causes",                   depth:2 },
    consequential:{ prefix:"What happens if",               depth:2 },
    comparative:  { prefix:"How does this compare to",      depth:2 },
    meta:         { prefix:"Why does it matter that",       depth:3 },
    edge_case:    { prefix:"What breaks down when",         depth:3 },
    philosophical:{ prefix:"At the deepest level, what is", depth:4 }
};

const CURIOSITY_SEEDS = [
    "What do we know for certain about this?",
    "What would an expert from a completely different field say?",
    "What's the rarest or most unusual version of this problem?",
    "What hidden assumption is everyone making?",
    "What would change in 100 years?",
    "Who profits from this staying unsolved?",
    "What's the smallest possible version of this experiment?"
];

function generateQuestions({ userId, topic, types = ["clarifying","causal","consequential"], count = 5 }) {
    if (!userId || !topic) return fail(AGENT, "userId and topic required");

    const safeCount = Math.min(count, MAX_IDEAS);
    const validTypes = types.filter(t => QUESTION_TYPES[t]).slice(0, safeCount);
    if (!validTypes.length) return fail(AGENT, `types must include: ${Object.keys(QUESTION_TYPES).join(", ")}`);

    const questions = [];
    for (let i = 0; i < safeCount && questions.length < safeCount; i++) {
        const qtype = QUESTION_TYPES[validTypes[i % validTypes.length]];
        const seed  = CURIOSITY_SEEDS[i % CURIOSITY_SEEDS.length];
        questions.push({
            id:       uid("cq"),
            type:     validTypes[i % validTypes.length],
            question: `${qtype.prefix} "${topic}"? (Depth ${qtype.depth}) | Seed: ${seed}`,
            depth:    qtype.depth,
            purpose:  `Drives exploration at curiosity depth ${qtype.depth}/4`
        });
    }

    const log = load(userId, "curiosity_log", []);
    log.push({ topic, count: questions.length, createdAt: NOW() });
    flush(userId, "curiosity_log", log.slice(-500));

    return ok(AGENT, { topic, questions, count: questions.length, deepestDepth: Math.max(...questions.map(q => q.depth)) });
}

function getExplorationSeeds({ userId, topic }) {
    if (!userId) return fail(AGENT, "userId required");
    const seeds = CURIOSITY_SEEDS.slice(0, MAX_IDEAS).map((s, i) => ({ id:uid("cs"), seed:s, appliedTo: topic ? `${s.replace("this", `"${topic}"`)}`  : s }));
    return ok(AGENT, { seeds, totalSeeds: CURIOSITY_SEEDS.length, questionTypes: Object.keys(QUESTION_TYPES) });
}

module.exports = { generateQuestions, getExplorationSeeds };
