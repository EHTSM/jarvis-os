/**
 * LinkedIn Growth Agent — B2B focused LinkedIn growth strategy.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a LinkedIn growth strategist specialising in B2B and personal branding.
Respond ONLY with valid JSON.`;

const LI_CONTENT_TYPES = {
    story_post:   { desc: "Personal story with lesson", reach: "High", notes: "No links — add in comments" },
    carousel:     { desc: "PDF carousel (10 slides)", reach: "Very High", notes: "Most saved content type on LinkedIn" },
    text_only:    { desc: "Long-form insight post", reach: "Medium-High", notes: "First 3 lines must be a hook" },
    poll:         { desc: "Industry opinion poll", reach: "High", notes: "4 options, ends with CTA" },
    video:        { desc: "Native LinkedIn video", reach: "High", notes: "Under 3 minutes, captions on" },
    article:      { desc: "LinkedIn newsletter article", reach: "Low immediate, High SEO", notes: "Great for thought leadership" }
};

const HOOK_BANK = [
    "I got rejected 47 times before landing my first client. Here's what changed:",
    "The LinkedIn advice nobody gives you (but everyone needs):",
    "I analyzed 100 viral LinkedIn posts. Every single one did this:",
    "My revenue went from ₹0 to ₹{n} in 90 days. The simple reason:",
    "Controversial: Most [job title] are doing [thing] completely wrong."
];

function buildStrategy({ niche = "business", role = "founder", connections = 500, goal = 5000 }) {
    return {
        id:              uid("li"),
        platform:        "linkedin",
        niche,
        role,
        currentConnections: connections,
        goalConnections:    goal,
        postingSchedule: {
            postsPerWeek:       3,
            bestDays:           ["Tuesday", "Wednesday", "Thursday"],
            bestTimes:          ["7:30am", "12:00pm", "5:30pm"],
            warmupPeriod:       "First 60 min after posting = critical engagement window"
        },
        contentMix: {
            "33% Personal stories":  "Career lessons, failures, breakthroughs",
            "33% Professional value": "Industry insights, how-tos, frameworks",
            "20% Social proof":      "Client wins, testimonials, results",
            "14% Soft CTAs":         "Free resources, newsletter, DMs open"
        },
        contentTypes:  LI_CONTENT_TYPES,
        hookBank:      HOOK_BANK.slice(0, 3),
        profileOptimisation: [
            "Headline: [Who you help] + [how] + [measurable result]",
            "Banner: Use Canva — show your service + social proof in 1 image",
            "About section: Story format (problem → journey → solution you offer)",
            "Featured section: Pin your best carousel + CTA post",
            "Creator Mode: ON (adds Follow button, increases reach)"
        ],
        engagementTactics: [
            "Comment 5 thoughtful comments daily on posts from your ICP",
            "Never post a link in main post — add in first comment",
            "Respond to all comments in first 2 hours (boosts reach 4×)",
            "Connect with commenters on competitors' viral posts",
            "Send personalised connection notes — 3x higher accept rate"
        ],
        createdAt: NOW()
    };
}

async function generate(params) {
    const base = buildStrategy(params);
    try {
        const prompt = `LinkedIn growth plan for a ${params.role || "professional"} in ${params.niche || "business"}.
${params.connections || 500} connections → ${params.goal || 5000}.
JSON: { "contentCalendar": [{"day": "Mon", "type": "...", "topic": "..."}], "leadGenTactic": "...", "personalBrandTip": "..." }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 450 });
        base.aiInsights = groq.parseJson(raw);
    } catch { /* template only */ }
    return base;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({ niche: p.niche || "business", role: p.role || "founder", connections: p.connections || 500, goal: p.goal || 5000 });
        return { success: true, type: "social", agent: "linkedinGrowthAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "linkedinGrowthAgent", data: { error: err.message } };
    }
}

module.exports = { buildStrategy, generate, run };
