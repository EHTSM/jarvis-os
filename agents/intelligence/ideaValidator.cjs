"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, MAX_IDEAS, limitIdeas, scoreReasoning } = require("./_intelligenceStore.cjs");
const AGENT = "ideaValidator";

const VALIDATION_DIMENSIONS = [
    { id:"V1", name:"Logical Coherence",  weight:0.25, test:(idea) => idea.length > 20 && !/contradiction|impossible|paradox/i.test(idea) },
    { id:"V2", name:"Feasibility",        weight:0.20, test:(idea) => !/magic|infinite|unlimited|impossible/i.test(idea) },
    { id:"V3", name:"Novelty",            weight:0.20, test:(idea) => !/obvious|trivial|everyone knows/i.test(idea) },
    { id:"V4", name:"Specificity",        weight:0.15, test:(idea) => idea.split(/\s+/).length >= 8 },
    { id:"V5", name:"Actionability",      weight:0.10, test:(idea) => /can|could|should|will|implement|build|create|do|apply|use/i.test(idea) },
    { id:"V6", name:"Clarity",            weight:0.10, test:(idea) => !/vague|unclear|somehow|maybe later/i.test(idea) }
];

const REJECTION_SIGNALS = [
    { pattern:/harm|destroy|weaponize|exploit|deceive|manipulate/i,  reason:"Potentially harmful intent detected" },
    { pattern:/guaranteed|100%|always works|no risk/i,               reason:"Unrealistic certainty claim" },
    { pattern:/^\s*test\s*$/i,                                       reason:"Trivial input — not a meaningful idea" }
];

function _validateSingle(ideaText) {
    // Check rejection signals first
    for (const { pattern, reason } of REJECTION_SIGNALS) {
        if (pattern.test(ideaText)) return { passed: false, reason, score: 0, grade: "REJECTED" };
    }

    const results = VALIDATION_DIMENSIONS.map(dim => ({
        dimension: dim.name,
        passed:    dim.test(ideaText),
        weight:    dim.weight
    }));

    const weightedScore = Math.round(
        results.reduce((s, r) => s + (r.passed ? r.weight * 100 : 0), 0)
    );
    const reasoningQ   = scoreReasoning(ideaText);
    const finalScore   = Math.round((weightedScore + reasoningQ.score) / 2);
    const grade        = finalScore >= 75 ? "STRONG" : finalScore >= 55 ? "VALID" : finalScore >= 35 ? "WEAK" : "REJECTED";

    return {
        passed:     finalScore >= 35,
        score:      finalScore,
        grade,
        dimensions: results,
        reasoningQuality: reasoningQ
    };
}

function validateIdeas({ userId, ideas = [], goal }) {
    if (!userId) return fail(AGENT, "userId required");
    if (!ideas.length) return fail(AGENT, "ideas[] required — pass thought/hypothesis objects or strings");

    const safeIdeas  = limitIdeas(ideas);
    const validated  = [];
    const rejected   = [];

    for (const idea of safeIdeas) {
        const text   = idea.thought || idea.hypothesis || idea.enhancement || (typeof idea === "string" ? idea : JSON.stringify(idea));
        const result = _validateSingle(text);
        const entry  = {
            id:           uid("val"),
            sourceId:     idea.id || null,
            idea:         text.slice(0, 300),
            ...result,
            validatedAt:  NOW()
        };
        if (result.passed) validated.push(entry);
        else               rejected.push(entry);
    }

    const log = load(userId, "validation_log", []);
    log.push({ goal, total: safeIdeas.length, passed: validated.length, rejected: rejected.length, createdAt: NOW() });
    flush(userId, "validation_log", log.slice(-500));

    return ok(AGENT, {
        goal:        goal || null,
        totalInput:  safeIdeas.length,
        validated,
        rejected,
        passRate:    Math.round(validated.length / safeIdeas.length * 100),
        recommendation: validated.length ? `${validated.length} idea(s) passed validation — proceed to simulation` : "No ideas passed — refine inputs before proceeding"
    });
}

function validateSingleIdea({ userId, idea }) {
    if (!userId || !idea) return fail(AGENT, "userId and idea required");
    const result = _validateSingle(idea);
    return ok(AGENT, { idea: idea.slice(0, 300), ...result });
}

module.exports = { validateIdeas, validateSingleIdea };
