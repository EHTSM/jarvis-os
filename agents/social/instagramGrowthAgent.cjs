/**
 * Instagram Growth Agent — strategy recommendations for account growth.
 * No direct Instagram API (requires approved access). Provides actionable plans.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are an Instagram growth expert with 10 years experience.
Give data-driven, actionable growth strategies. Respond ONLY with valid JSON.`;

const STORE = "ig-growth";

const NICHES = {
    business:   { postFreq: 5, bestTimes: ["8am", "12pm", "6pm"], formats: ["Reels", "Carousels", "Stories"] },
    lifestyle:  { postFreq: 7, bestTimes: ["7am", "11am", "8pm"], formats: ["Reels", "Stories", "Posts"] },
    education:  { postFreq: 4, bestTimes: ["9am", "2pm", "7pm"], formats: ["Carousels", "Reels", "Infographics"] },
    fitness:    { postFreq: 6, bestTimes: ["6am", "12pm", "5pm"], formats: ["Reels", "Before/After", "Stories"] },
    ecommerce:  { postFreq: 5, bestTimes: ["10am", "1pm", "7pm"], formats: ["Product Reels", "Reviews", "UGC"] },
    tech:       { postFreq: 4, bestTimes: ["8am", "1pm", "6pm"], formats: ["Carousels", "Tutorials", "Reels"] }
};

const GROWTH_HOOKS = [
    "Stop scrolling — here's the 1 thing most [niche] creators miss",
    "I grew from 0 to {followers}k doing this one thing",
    "POV: You finally understand [pain point]",
    "The [niche] strategy nobody talks about (but everyone needs)",
    "Day {n} of [challenge] — the results will surprise you"
];

function buildStrategy({ niche = "business", followers = 0, goal = 10000, username = "" }) {
    const config   = NICHES[niche] || NICHES.business;
    const gap      = Math.max(0, goal - followers);
    const weeksEst = Math.ceil(gap / (config.postFreq * 7 * 2)); // ~2 new followers per post

    return {
        id:         uid("ig"),
        username,
        niche,
        currentFollowers: followers,
        goalFollowers:    goal,
        estimatedWeeks:   weeksEst,
        postFrequency:    `${config.postFreq} posts/week`,
        bestPostTimes:    config.bestTimes,
        contentMix:       config.formats,
        contentPillars:   ["Educational", "Entertaining", "Inspirational", "Promotional (20%)"],
        hookTemplates:    GROWTH_HOOKS.slice(0, 3),
        weeklyPlan: [
            { day: "Mon", format: config.formats[0], topic: "Educational/How-to" },
            { day: "Wed", format: config.formats[1], topic: "Value/Tips" },
            { day: "Fri", format: config.formats[2], topic: "Engagement/Story" },
            { day: "Sun", format: "Stories",         topic: "Behind the scenes" }
        ],
        quickWins: [
            "Post 3 Reels this week — Reels get 3× more reach than static posts",
            "Reply to every comment in the first 30 minutes (boosts distribution)",
            "Use 5-10 niche hashtags, not 30 generic ones",
            "Collaborate with 1 creator this month (story swap / collab post)",
            "Pin your best 3 posts — they're your first impression for new visitors"
        ],
        createdAt: NOW()
    };
}

async function generate(params) {
    const base = buildStrategy(params);
    try {
        const prompt = `Instagram growth strategy for @${params.username || "account"} in ${params.niche} niche.
Current: ${params.followers || 0} followers. Goal: ${params.goal || 10000}.
JSON: { "audienceInsight": "...", "contentGap": "...", "viralFormula": "...", "collab90DayPlan": "...", "monetizationPath": "..." }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
        const ai   = groq.parseJson(raw);
        Object.assign(base, { aiInsights: ai });
    } catch { /* template only */ }

    const history = load(STORE, []);
    history.push(base);
    if (history.length > 50) history.splice(0, history.length - 50);
    flush(STORE, history);

    return base;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({ niche: p.niche || "business", followers: p.followers || 0, goal: p.goal || 10000, username: p.username || "" });
        return { success: true, type: "social", agent: "instagramGrowthAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "instagramGrowthAgent", data: { error: err.message } };
    }
}

module.exports = { generate, buildStrategy, run };
