/**
 * Viral Content Detector — scores content for virality potential using
 * engagement signals, emotional triggers, and format analysis.
 * Extends trendAnalyzerAgent data when available.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a viral content analyst. Score content virality 0-100 and explain why.
Respond ONLY with valid JSON.`;

// Emotion triggers that drive shares
const TRIGGERS = {
    curiosity:    { patterns: [/\?|you won't believe|secret|hidden|nobody talks|surprising/i], weight: 20 },
    controversy:  { patterns: [/wrong|myth|unpopular opinion|hot take|disagree|truth about/i], weight: 18 },
    relatability: { patterns: [/pov:|me when|anyone else|we all|this is us|literally me/i], weight: 16 },
    value:        { patterns: [/how to|tips|guide|tutorial|step[- ]by[- ]step|free|hack/i], weight: 15 },
    emotion:      { patterns: [/i cried|beautiful|heartbreaking|inspiring|proud|love|incredible/i], weight: 14 },
    urgency:      { patterns: [/today|now|limited|expires|last chance|don't miss/i], weight: 12 },
    social_proof: { patterns: [/million|viral|trending|everyone|thousands|most people/i], weight: 10 }
};

// Format multipliers
const FORMAT_BOOST = {
    reel:      1.4,
    video:     1.3,
    carousel:  1.2,
    image:     1.0,
    text:      0.8
};

function scoreContent({ content, caption = "", format = "image", platform = "instagram" }) {
    const text   = `${content} ${caption}`.toLowerCase();
    let score    = 30; // base
    const signals = [];

    for (const [name, { patterns, weight }] of Object.entries(TRIGGERS)) {
        if (patterns.some(p => p.test(text))) {
            score += weight;
            signals.push(name);
        }
    }

    // Length check
    const wordCount = text.split(/\s+/).length;
    if (wordCount >= 15 && wordCount <= 80) { score += 8; signals.push("optimal_length"); }
    if (/\d+/.test(text)) { score += 5; signals.push("has_numbers"); }
    if (/#\w+/.test(text)) { score += 5; signals.push("has_hashtags"); }
    if (/💡|🔥|🚀|❤️|👇|✅|⚡|👏|🙌|💯/.test(text)) { score += 5; signals.push("has_emoji"); }

    const multiplier = FORMAT_BOOST[format.toLowerCase()] || 1.0;
    const finalScore = Math.min(100, Math.round(score * multiplier));

    const verdict = finalScore >= 80 ? "🔥 HIGH viral potential"
                  : finalScore >= 60 ? "📈 MODERATE viral potential"
                  : finalScore >= 40 ? "🌱 LOW-MODERATE — needs hooks"
                  :                    "⚠️ LOW — rework recommended";

    return { score: finalScore, verdict, signals, format, multiplier, platform, analysedAt: NOW() };
}

async function analyseWithAI(params) {
    const base = scoreContent(params);
    try {
        const prompt = `Analyse this content for virality on ${params.platform}: "${(params.content || params.caption || "").slice(0, 200)}".
Current score: ${base.score}. Format: ${params.format}.
JSON: { "improvements": ["..."], "bestPlatformFit": "...", "suggestedHook": "...", "estimatedReach": "..." }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        const ai  = groq.parseJson(raw);
        return { ...base, aiSuggestions: ai };
    } catch { return base; }
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await analyseWithAI({ content: p.content || p.text || "", caption: p.caption || "", format: p.format || "image", platform: p.platform || "instagram" });
        return { success: true, type: "social", agent: "viralContentDetector", data };
    } catch (err) {
        return { success: false, type: "social", agent: "viralContentDetector", data: { error: err.message } };
    }
}

module.exports = { scoreContent, analyseWithAI, run };
