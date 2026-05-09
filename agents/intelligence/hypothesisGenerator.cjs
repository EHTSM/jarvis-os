"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_IDEAS, limitIdeas } = require("./_intelligenceStore.cjs");
const AGENT = "hypothesisGenerator";

const HYPOTHESIS_TEMPLATES = [
    { type:"causal",        template:"If [ACTION] is applied to [CONTEXT], then [OUTCOME] will occur because [MECHANISM]." },
    { type:"comparative",   template:"[A] will produce better [METRIC] than [B] because [RATIONALE]." },
    { type:"correlational", template:"There is a positive relationship between [VAR_A] and [VAR_B] in the context of [DOMAIN]." },
    { type:"predictive",    template:"Given [CONDITIONS], [EVENT] will occur within [TIMEFRAME] at a rate of [MAGNITUDE]." },
    { type:"mechanistic",   template:"[PHENOMENON] occurs because [MECHANISM], as evidenced by [EXPECTED_SIGNAL]." }
];

const TESTABILITY_CRITERIA = [
    { id:"T1", name:"Falsifiable",     check:(h) => /if|then|will|would|predict|expect/i.test(h) },
    { id:"T2", name:"Measurable",      check:(h) => /rate|score|level|amount|count|percent|increase|decrease/i.test(h) },
    { id:"T3", name:"Time-bound",      check:(h) => /within|after|before|weeks|months|years|days|timeframe/i.test(h) },
    { id:"T4", name:"Specific",        check:(h) => h.length >= 30 },
    { id:"T5", name:"Has Mechanism",   check:(h) => /because|due to|via|through|mechanism|cause/i.test(h) }
];

function _scoreTestability(hyp) {
    const passed = TESTABILITY_CRITERIA.filter(c => c.check(hyp));
    const score  = Math.round(passed.length / TESTABILITY_CRITERIA.length * 100);
    return { score, grade: score >= 80 ? "STRONG" : score >= 60 ? "TESTABLE" : score >= 40 ? "WEAK" : "UNTESTABLE", passedCriteria: passed.map(c => c.name) };
}

function generateHypotheses({ userId, goal, ideas = [], count = 3 }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");

    const safeCount = Math.min(count, MAX_IDEAS);
    const templates = HYPOTHESIS_TEMPLATES.slice(0, safeCount);
    const srcIdeas  = limitIdeas(ideas);

    const hypotheses = templates.map((tmpl, i) => {
        const srcThought = srcIdeas[i]?.thought || srcIdeas[i]?.enhancement || goal;
        const hyp = tmpl.template
            .replace(/\[ACTION\]/g, `implementing "${goal}"`)
            .replace(/\[CONTEXT\]/g, "the target environment")
            .replace(/\[OUTCOME\]/g, "improved measurable results")
            .replace(/\[MECHANISM\]/g, "systematic feedback and iteration")
            .replace(/\[A\]/g, goal)
            .replace(/\[B\]/g, "the current baseline approach")
            .replace(/\[METRIC\]/g, "performance score")
            .replace(/\[RATIONALE\]/g, srcThought)
            .replace(/\[VAR_A\]/g, "adoption of " + goal)
            .replace(/\[VAR_B\]/g, "positive outcomes")
            .replace(/\[DOMAIN\]/g, "the problem domain")
            .replace(/\[CONDITIONS\]/g, "conditions are stable and " + goal + " is active")
            .replace(/\[EVENT\]/g, "measurable improvement")
            .replace(/\[TIMEFRAME\]/g, "3 months")
            .replace(/\[MAGNITUDE\]/g, "20-40%")
            .replace(/\[PHENOMENON\]/g, goal)
            .replace(/\[EXPECTED_SIGNAL\]/g, "observable data trends");

        const testability = _scoreTestability(hyp);
        return {
            id:          uid("hyp"),
            type:        tmpl.type,
            hypothesis:  hyp,
            sourceIdea:  srcThought,
            testability,
            priority:    i + 1,
            generatedAt: NOW()
        };
    });

    const history = load(userId, "hypothesis_history", []);
    history.push({ goal, count: hypotheses.length, createdAt: NOW() });
    flush(userId, "hypothesis_history", history.slice(-500));

    const avgTestability = Math.round(hypotheses.reduce((s, h) => s + h.testability.score, 0) / hypotheses.length);
    return ok(AGENT, { goal, hypotheses, count: hypotheses.length, avgTestabilityScore: avgTestability });
}

function getHypothesisTemplates() {
    return ok(AGENT, { templates: HYPOTHESIS_TEMPLATES, testabilityCriteria: TESTABILITY_CRITERIA.map(c => ({ id:c.id, name:c.name })) });
}

module.exports = { generateHypotheses, getHypothesisTemplates };
