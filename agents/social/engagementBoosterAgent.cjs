/**
 * Engagement Booster Agent — recommends optimal posting times, CTAs, and
 * engagement-maximizing tactics per platform.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are an engagement optimization expert. Give specific, data-backed tactics to maximize engagement.
Respond ONLY with valid JSON.`;

const BEST_TIMES = {
    instagram: { weekdays: ["8:00am","12:00pm","5:00pm","7:00pm"], weekends: ["10:00am","2:00pm"] },
    twitter:   { weekdays: ["8:00am","12:00pm","5:00pm","9:00pm"], weekends: ["9:00am","3:00pm"] },
    linkedin:  { weekdays: ["7:30am","12:00pm","5:30pm"],          weekends: ["never — low B2B traffic"] },
    youtube:   { weekdays: ["2:00pm","5:00pm","9:00pm"],           weekends: ["12:00pm","3:00pm"] },
    facebook:  { weekdays: ["9:00am","1:00pm","4:00pm"],           weekends: ["12:00pm","2:00pm"] },
    tiktok:    { weekdays: ["7:00am","3:00pm","8:00pm"],           weekends: ["11:00am","7:00pm"] }
};

const CTA_BANK = {
    comment:  ["Comment your answer below 👇", "Drop a 🔥 if you agree", "What would YOU add? Tell me below"],
    save:     ["Save this for later 📌 — you'll need it", "Bookmark this post 🔖", "Save + share with your team"],
    share:    ["Share this with someone who needs to hear it", "Tag a friend who should see this", "Repost if this helped you ❤️"],
    follow:   ["Follow for more [niche] tips daily", "Turn on notifications 🔔 — this content gets taken down", "Hit follow — I post here every week"],
    click:    ["Link in bio 👆", "Click the link in my profile", "DM me '[keyword]' and I'll send it directly"],
    question: ["What's your biggest challenge with [topic]?", "Have you tried this? Yes or No 👇", "Which of these do you struggle with most?"]
};

const ENGAGEMENT_TACTICS = [
    { name: "Golden Hour", desc: "Reply to every comment in the first 60 min — signals to algorithm that post is active", impact: "High" },
    { name: "Hook Test",   desc: "Post same content with 3 different hooks on 3 consecutive days — keep the best performer", impact: "High" },
    { name: "Collab Post", desc: "Co-create 1 post/week with another creator — gets you in front of their audience", impact: "Very High" },
    { name: "Story CTA",   desc: "Post a story 1 hour after feed post directing followers to engage with it", impact: "Medium" },
    { name: "Engagement Pod", desc: "Join 5-10 peer creators for mutual first-comment support (not spam — genuine peer feedback)", impact: "Medium" },
    { name: "Save Bait",   desc: "End every post with 'Save this for [future situation]' — saves boost reach significantly", impact: "High" },
    { name: "Question Box", desc: "Use IG story question box weekly — responses become content + DM connections", impact: "Medium" }
];

function buildPlan({ platform = "instagram", niche = "business", currentEngRate = 2.0, postsPerWeek = 4 }) {
    const times     = BEST_TIMES[platform.toLowerCase()] || BEST_TIMES.instagram;
    const targetEng = Math.min(10, currentEngRate * 1.5);

    const weekSchedule = [];
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const slots = [...times.weekdays, ...times.weekdays].slice(0, postsPerWeek);
    for (let i = 0; i < postsPerWeek; i++) {
        weekSchedule.push({ day: days[i * Math.floor(7 / postsPerWeek)], time: slots[i], cta: CTA_BANK.comment[i % CTA_BANK.comment.length] });
    }

    return {
        id:               uid("eng"),
        platform,
        niche,
        currentEngRate:   `${currentEngRate}%`,
        targetEngRate:    `${targetEng.toFixed(1)}%`,
        bestPostingTimes: times,
        weeklySchedule:   weekSchedule,
        ctaBank:          CTA_BANK,
        tactics:          ENGAGEMENT_TACTICS.slice(0, 5),
        quickWins: [
            `Post at ${times.weekdays[0]} tomorrow — highest ${platform} traffic window`,
            "Add a yes/no question to your next 3 posts — easy engagement",
            "Reply to your last 10 comments right now — reactivates old posts",
            "Create a 'Save this' post — saves are worth 10× comments in algorithm weight"
        ],
        createdAt: NOW()
    };
}

async function optimise(params) {
    const base = buildPlan(params);
    try {
        const prompt = `Engagement optimization for ${params.platform} ${params.niche} creator.
Current engagement: ${params.currentEngRate || 2}%. Target: ${base.targetEngRate}.
JSON: { "topTactic": "...", "contentFormat": "...", "algorithmHack": "...", "30DayChallenge": "..." }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        base.aiAdvice = groq.parseJson(raw);
    } catch { /* template only */ }
    return base;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await optimise({ platform: p.platform || "instagram", niche: p.niche || "business", currentEngRate: p.engRate || p.currentEngRate || 2.0, postsPerWeek: p.postsPerWeek || 4 });
        return { success: true, type: "social", agent: "engagementBoosterAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "engagementBoosterAgent", data: { error: err.message } };
    }
}

module.exports = { buildPlan, optimise, CTA_BANK, BEST_TIMES, run };
