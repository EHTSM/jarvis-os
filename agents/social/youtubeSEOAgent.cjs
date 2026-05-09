/**
 * YouTube SEO Agent — optimises titles, descriptions, tags, and thumbnails for YouTube search.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a YouTube SEO expert. Optimise video metadata for maximum search discovery and click-through rate.
Respond ONLY with valid JSON.`;

const TITLE_FORMULAS = [
    "[Number] [Adjective] Ways to [Achieve Result] in [Timeframe]",
    "How to [Achieve Goal] WITHOUT [Common Obstacle] (Step-by-Step)",
    "The TRUTH About [Topic] — Nobody Talks About This",
    "I Tried [Method] for [Timeframe] — Here's What Happened",
    "Why [Common Belief] Is WRONG (And What Actually Works)",
    "[Topic] EXPLAINED in [Short Timeframe] — Beginner to Pro"
];

const CHAPTER_TEMPLATE = [
    "0:00 — Introduction",
    "1:00 — [Main point 1]",
    "3:00 — [Main point 2]",
    "6:00 — [Main point 3]",
    "9:00 — [Practical example]",
    "12:00 — Key takeaways",
    "13:30 — What's next"
];

function _buildTags(topic, niche) {
    const base = topic.toLowerCase().split(" ");
    return [
        topic.toLowerCase(),
        `${topic} tutorial`,
        `${topic} for beginners`,
        `${topic} guide`,
        `how to ${topic}`,
        `best ${topic}`,
        niche.toLowerCase(),
        `${niche} ${topic}`,
        "2025",
        `${topic} tips`,
        `learn ${topic}`,
        `${topic} strategy`
    ].slice(0, 15);
}

function optimise({ topic, niche = "education", description = "", existingTitle = "" }) {
    if (!topic) throw new Error("topic required");

    const titleOptions = TITLE_FORMULAS.map(f =>
        f.replace("[Topic]", topic).replace("[Number]", "5").replace("[Adjective]", "Proven").replace("[Achieve Result]", `Master ${topic}`).replace("[Timeframe]", "30 Days").replace("[Achieve Goal]", `Learn ${topic}`).replace("[Common Obstacle]", "Wasting Time").replace("[Method]", topic).replace("[Short Timeframe]", "10 Minutes").replace("[Common Belief]", `Most ${topic} Advice`).replace("[Adjective] Ways", "Ways").replace("[Main point", "[Insight")
    );

    const tags = _buildTags(topic, niche);

    const metaDescription = `Learn ${topic} in this complete guide. We cover everything from basics to advanced ${topic} strategies. Perfect for ${niche} professionals and beginners. Watch now to master ${topic}.`;

    return {
        id:              uid("yt"),
        topic,
        niche,
        recommendedTitles: titleOptions.slice(0, 4),
        tags,
        description: {
            hook:      `In this video, you'll learn exactly how to ${topic} — step by step.`,
            chapters:  CHAPTER_TEMPLATE,
            keywords:  `${topic}, ${niche}, how to ${topic}, ${topic} tutorial`,
            template:  `🔔 Subscribe for more ${niche} content\n👇 Timestamps below\n\n${metaDescription}`
        },
        thumbnailTips: [
            "Use a surprised/excited face — 32% higher CTR",
            `Bold text: "${topic.toUpperCase()}" in 3 words max`,
            "High contrast: yellow/white on dark background",
            "Arrow or circle pointing to your face",
            "Test 2 thumbnail variants in first 48 hours"
        ],
        seoScore: {
            titleLength:   existingTitle ? (existingTitle.length >= 40 && existingTitle.length <= 70 ? "✅ Good" : "⚠️ Adjust to 40-70 chars") : "—",
            tagCount:      `${tags.length}/15 tags`,
            descLength:    "500+ chars recommended",
            chapterMarkers: "✅ Improves watch time + SEO"
        },
        createdAt: NOW()
    };
}

async function optimiseWithAI(params) {
    const base = optimise(params);
    try {
        const prompt = `Optimise YouTube SEO for "${params.topic}" in ${params.niche} niche.
JSON: { "bestTitle": "...", "searchKeywords": ["..."], "descriptionOpening": "...", "cardsCTA": "...", "endscreenTip": "..." }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 450 });
        base.aiOptimisation = groq.parseJson(raw);
    } catch { /* template only */ }
    return base;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await optimiseWithAI({ topic: p.topic || p.title || "", niche: p.niche || "education", description: p.description || "", existingTitle: p.existingTitle || "" });
        return { success: true, type: "social", agent: "youtubeSEOAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "youtubeSEOAgent", data: { error: err.message } };
    }
}

module.exports = { optimise, optimiseWithAI, run };
