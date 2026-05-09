"use strict";
const { load, flush, uid, NOW, ok, fail, blocked, MAX_IDEAS, MAX_THOUGHTS, limitIdeas, INTELLIGENCE_DISCLAIMER } = require("./_intelligenceStore.cjs");
const AGENT = "thoughtGenerator";

const THINKING_FRAMES = [
    { id:"TF01", name:"First Principles",  prompt:"Break down to the most fundamental truths. What are the irreducible components?" },
    { id:"TF02", name:"Inversion",         prompt:"Invert the problem. What would make this definitely fail? Now avoid those things." },
    { id:"TF03", name:"Analogy",           prompt:"What does this resemble in nature, history, or another domain? Apply that structure." },
    { id:"TF04", name:"Systems Thinking",  prompt:"What are the feedback loops? What inputs, outputs, and unintended consequences exist?" },
    { id:"TF05", name:"Opportunity Cost",  prompt:"What are you giving up by pursuing this? What else could those resources achieve?" },
    { id:"TF06", name:"Second Order",      prompt:"Beyond the immediate effect — what happens next? And after that?" },
    { id:"TF07", name:"Falsification",     prompt:"What evidence would prove this wrong? How do you test for that?" }
];

const DOMAIN_LENSES = {
    technology: ["automation","data","ai","network effect","scalability","API","platform"],
    business:   ["revenue","market","customer","unit economics","distribution","moat","churn"],
    science:    ["hypothesis","experiment","variable","control","reproducibility","peer review"],
    society:    ["incentive","culture","policy","behaviour","equity","access","community"],
    philosophy: ["epistemology","ethics","ontology","causality","emergence","identity","purpose"]
};

function _generateThoughtsFromGoal(goal) {
    const g        = (goal || "").toLowerCase();
    const thoughts = [];
    const frames   = THINKING_FRAMES.slice(0, MAX_IDEAS);

    // Detect domain lens
    let lens = "technology";
    for (const [domain, kws] of Object.entries(DOMAIN_LENSES)) {
        if (kws.some(kw => g.includes(kw))) { lens = domain; break; }
    }
    const lensWords = DOMAIN_LENSES[lens];

    frames.forEach((frame, i) => {
        thoughts.push({
            id:        uid("tht"),
            frame:     frame.name,
            frameId:   frame.id,
            thought:   `[${frame.name}] Regarding "${goal}": ${frame.prompt} Domain lens (${lens}): consider ${lensWords[i % lensWords.length]}.`,
            lens,
            confidence: Math.round(60 + Math.random() * 35),
            generatedAt: NOW()
        });
    });

    return thoughts;
}

function generateThoughts({ userId, goal, domain, maxIdeas = MAX_IDEAS }) {
    if (!userId || !goal) return fail(AGENT, "userId and goal required");
    if (!goal.trim() || goal.length < 3) return fail(AGENT, "goal must be a meaningful phrase (3+ characters)");

    const cap     = Math.min(maxIdeas, MAX_IDEAS);
    const history = load(userId, "thought_history", []);

    // Dedup check — avoid re-generating same goal within last 10 sessions
    const recentGoals = history.slice(-10).map(h => h.goal.toLowerCase().trim());
    const isDuplicate = recentGoals.includes(goal.toLowerCase().trim());

    const thoughts = limitIdeas(_generateThoughtsFromGoal(goal)).slice(0, cap);
    if (domain) thoughts.forEach(t => { t.domainHint = domain; });

    const session = {
        sessionId:  uid("ts"),
        goal,
        domain:     domain || "auto-detected",
        thoughts,
        count:      thoughts.length,
        duplicate:  isDuplicate,
        createdAt:  NOW()
    };

    history.push(session);
    flush(userId, "thought_history", history.slice(-200));

    return ok(AGENT, {
        sessionId:  session.sessionId,
        goal,
        thoughts,
        count:      thoughts.length,
        note:       isDuplicate ? "⚡ Similar goal detected recently — thoughts may overlap with prior session" : null
    });
}

function getThoughtHistory({ userId, limit = 20 }) {
    if (!userId) return fail(AGENT, "userId required");
    const history = load(userId, "thought_history", []);
    return ok(AGENT, { total: history.length, sessions: history.slice(-limit).reverse() });
}

function getThinkingFrames() {
    return ok(AGENT, { frames: THINKING_FRAMES, domainLenses: Object.keys(DOMAIN_LENSES), disclaimer: INTELLIGENCE_DISCLAIMER });
}

module.exports = { generateThoughts, getThoughtHistory, getThinkingFrames };
