/**
 * X (Twitter) Growth Agent — platform-specific growth strategy for X/Twitter.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a Twitter/X growth expert. Give actionable, data-driven growth strategies.
Respond ONLY with valid JSON.`;

const TWEET_FORMATS = {
    thread:    { desc: "5-10 tweet thread", engBoost: "3×", best: "Educational/storytelling" },
    hook_post: { desc: "Single tweet with strong hook", engBoost: "2×", best: "Controversy/curiosity" },
    poll:      { desc: "4-option poll", engBoost: "5×", best: "Opinion/market research" },
    quote_rt:  { desc: "Quote retweet with commentary", engBoost: "2.5×", best: "Hot takes on news" },
    reply_guy: { desc: "Strategic replies to big accounts", engBoost: "Variable", best: "Early replies to viral tweets" }
};

const HOOK_TEMPLATES = [
    "I studied {n} top {niche} accounts. Here's what they all do:",
    "The {niche} advice that got me {result}. A thread 🧵",
    "Nobody talks about this {niche} strategy. Until now:",
    "Hot take: {controversial opinion}. Here's why I'm right:",
    "I spent {time} learning {topic}. You don't have to. Quick summary:"
];

function buildStrategy({ followers = 0, goal = 5000, niche = "business", tweetsPerWeek = 14 }) {
    const gap      = Math.max(0, goal - followers);
    const weeksEst = Math.ceil(gap / (tweetsPerWeek * 0.5));

    return {
        id:              uid("xg"),
        platform:        "twitter/x",
        niche,
        currentFollowers: followers,
        goalFollowers:    goal,
        estimatedWeeks:   weeksEst,
        postingStrategy: {
            tweetsPerDay:   Math.ceil(tweetsPerWeek / 7),
            threadsPerWeek: 2,
            pollsPerWeek:   1,
            replyGoalPerDay: 10
        },
        contentMix: {
            "40% Educational threads": "Share frameworks, lessons, how-tos",
            "25% Opinions/hot takes":  "Controversial but defensible views in your niche",
            "20% Personal stories":    "Behind-the-scenes, wins, failures",
            "15% Engagement posts":    "Polls, questions, quote RTs"
        },
        hookTemplates:    HOOK_TEMPLATES.slice(0, 3),
        formats:          TWEET_FORMATS,
        growthTactics: [
            "Reply to 10 tweets from accounts with 10k-100k followers in your niche daily",
            "Post your best tweet at 8am and 6pm EST — highest X traffic windows",
            "Turn every thread into a carousel for Instagram (repurpose)",
            "Pin your highest-performing thread to your profile",
            "Ask a question at the end of every thread to boost replies"
        ],
        createdAt: NOW()
    };
}

async function generate(params) {
    const base = buildStrategy(params);
    try {
        const prompt = `X/Twitter growth strategy for ${params.niche} creator. ${params.followers || 0} followers → ${params.goal || 5000}.
JSON: { "contentPillars": ["..."], "viralThreadIdea": "...", "profileOptimization": "...", "monetizationPath": "..." }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        base.aiInsights = groq.parseJson(raw);
    } catch { /* template only */ }
    return base;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({ followers: p.followers || 0, goal: p.goal || 5000, niche: p.niche || "business", tweetsPerWeek: p.tweetsPerWeek || 14 });
        return { success: true, type: "social", agent: "xGrowthAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "xGrowthAgent", data: { error: err.message } };
    }
}

module.exports = { buildStrategy, generate, run };
