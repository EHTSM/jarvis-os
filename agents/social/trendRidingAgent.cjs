/**
 * Trend Riding Agent — maps detected trends to actionable content ideas.
 * Consumes trendAnalyzerAgent output (internet layer). Extends viralContentDetector.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a social media trend expert. Convert trends into viral content angles.
Respond ONLY with valid JSON.`;

// Content angles for any trend
const ANGLES = [
    (trend) => `Hot take: Why [${trend}] is changing everything in 2025`,
    (trend) => `POV: You just discovered [${trend}] and your life will never be the same`,
    (trend) => `3 things nobody tells you about [${trend}]`,
    (trend) => `Why [${trend}] is the skill everyone will need in 6 months`,
    (trend) => `The truth about [${trend}] that brands don't want you to know`,
    (trend) => `How I used [${trend}] to [result] in 7 days`
];

const FORMATS_BY_TREND = {
    tech:      ["Tutorial Reel", "Carousel: Step-by-step", "YouTube Short", "LinkedIn Article"],
    business:  ["Listicle Carousel", "LinkedIn Post", "Twitter Thread", "YouTube Video"],
    lifestyle: ["Story Poll", "Instagram Reel", "TikTok POV", "Before/After Post"],
    news:      ["Twitter Thread", "Instagram Story", "YouTube Commentary", "LinkedIn Post"],
    viral:     ["Reel Reaction", "Duet/Stitch", "Meme Post", "Instagram Story Quiz"]
};

function generateIdeas(trends = [], niche = "business") {
    if (!trends.length) return { message: "No trends provided. Run trendAnalyzerAgent first.", ideas: [] };

    const ideas = trends.slice(0, 5).map((trend, i) => {
        const trendStr  = typeof trend === "object" ? trend.term || trend.topic || JSON.stringify(trend) : String(trend);
        const category  = typeof trend === "object" ? trend.category || niche : niche;
        const formats   = FORMATS_BY_TREND[category] || FORMATS_BY_TREND.business;
        const angle     = ANGLES[i % ANGLES.length](trendStr);
        const score     = typeof trend === "object" ? trend.score || 50 : 50;

        return {
            id:          uid("tr"),
            trend:       trendStr,
            trendScore:  score,
            contentAngle: angle,
            suggestedFormats: formats.slice(0, 2),
            hook:        angle.split(":")[0] || angle,
            cta:         "Save this + share with someone who needs to know",
            hashtags:    [`#${trendStr.replace(/\s+/g, "")}`, `#${niche}`, "#trending", "#viral"],
            urgency:     score >= 70 ? "🔥 Act now — trend is peaking" : score >= 40 ? "📈 Good timing this week" : "🌱 Emerging — early mover advantage",
            generatedAt: NOW()
        };
    });

    return { trendsAnalysed: trends.length, ideasGenerated: ideas.length, niche, ideas };
}

async function generateWithAI(trends = [], niche = "business", platform = "instagram") {
    const base = generateIdeas(trends, niche);
    if (!base.ideas?.length) return base;

    try {
        const trendList = base.ideas.map(i => i.trend).join(", ");
        const prompt    = `Top trends: ${trendList}. Niche: ${niche}. Platform: ${platform}.
Create 3 viral content concepts riding these trends.
JSON: { "concepts": [{ "trend": "...", "title": "...", "format": "...", "script_hook": "...", "viralReason": "..." }] }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
        const ai  = groq.parseJson(raw);
        base.aiConcepts = ai?.concepts || [];
    } catch { /* template only */ }

    return base;
}

async function run(task) {
    const p = task.payload || {};
    try {
        let trends = p.trends || [];

        // Auto-fetch trends if not provided
        if (!trends.length && task.type !== "manual_trends") {
            try {
                const trendAgent = require("../internet/trendAnalyzerAgent.cjs");
                const result     = await trendAgent.run({ type: "analyze_trends", payload: { topic: p.niche || p.topic || "business" } });
                trends           = result?.data?.trends || [];
            } catch { trends = [{ term: p.topic || "AI tools", score: 70, category: "tech" }]; }
        }

        const data = await generateWithAI(trends, p.niche || "business", p.platform || "instagram");
        return { success: true, type: "social", agent: "trendRidingAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "trendRidingAgent", data: { error: err.message } };
    }
}

module.exports = { generateIdeas, generateWithAI, run };
