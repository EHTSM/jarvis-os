/**
 * Caption Generator Agent — platform-optimized captions.
 * Platform-aware (character limits, emoji density, line breaks differ per platform).
 * Groq-powered with template fallback.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a social media expert who writes captions that stop the scroll and drive engagement.
Platform-specific rules: Instagram (storytelling, emojis, line breaks), LinkedIn (professional, insightful),
Twitter/X (punchy, < 280 chars), TikTok (casual, trend-aware), YouTube (SEO-rich).
Respond ONLY with valid JSON.`;

const PLATFORM_RULES = {
    instagram: { maxChars: 2200, emojiDensity: "high",   lineBreaks: true,  cta: "💬 Drop your thoughts below!" },
    linkedin:  { maxChars: 3000, emojiDensity: "low",    lineBreaks: true,  cta: "What do you think? Share below 👇" },
    twitter:   { maxChars: 280,  emojiDensity: "medium", lineBreaks: false, cta: "RT if you agree 🔁" },
    tiktok:    { maxChars: 2200, emojiDensity: "high",   lineBreaks: false, cta: "Follow for more! 🔥" },
    youtube:   { maxChars: 5000, emojiDensity: "medium", lineBreaks: true,  cta: "Subscribe for more → link in bio" },
    facebook:  { maxChars: 63206, emojiDensity: "medium", lineBreaks: true, cta: "Share this if it helped you! 🙌" }
};

// Tone-specific openers
const OPENERS = {
    motivational: ["This changed everything for me →", "Nobody talks about this but —", "One year ago I had nothing. Now —"],
    educational:  ["Most people don't know this:", "Here's a fact that will blow your mind:", "The truth about this that nobody tells you:"],
    storytelling: ["It started on a Monday morning.", "I almost quit. Then this happened:", "3 years ago, I was broke and confused."],
    promotional:  ["Introducing something big 👇", "We built this so you don't have to struggle:", "This is the tool I wish I had when starting:"],
    casual:       ["okay so hear me out 👀", "not gonna lie, this is wild —", "day X of building in public and I finally figured it out:"]
};

function _templateCaption(topic, platform, tone) {
    const rules   = PLATFORM_RULES[platform] || PLATFORM_RULES.instagram;
    const openers = OPENERS[tone] || OPENERS.educational;
    const opener  = openers[Math.floor(Math.random() * openers.length)];

    const body = platform === "twitter"
        ? `${opener}\n\n${topic} is more important than you think.\n\nHere's why → [your insight about ${topic}]`
        : `${opener}\n\n[Main point about ${topic}]\n\n[Supporting detail]\n\n[Personal story or example]\n\n[Takeaway]\n\n${rules.cta}`;

    return {
        platform,
        tone,
        caption: body,
        characterCount: body.length,
        limit: rules.maxChars,
        withinLimit: body.length <= rules.maxChars,
        cta: rules.cta
    };
}

async function _groqCaption(topic, platform, tone) {
    const rules  = PLATFORM_RULES[platform] || PLATFORM_RULES.instagram;
    const prompt = `Write a ${tone} ${platform} caption about "${topic}".
Rules: max ${rules.maxChars} chars, emoji density: ${rules.emojiDensity}, line breaks: ${rules.lineBreaks}.
JSON: { "caption": "full caption text", "characterCount": 123, "hook": "first line only", "cta": "call to action text" }`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 800 });
    return { platform, tone, ...groq.parseJson(raw) };
}

async function generate({ topic, platform = "instagram", tone = "educational" }) {
    if (!topic) throw new Error("topic required");
    try {
        return await _groqCaption(topic, platform, tone);
    } catch {
        return _templateCaption(topic, platform, tone);
    }
}

/** Generate captions for multiple platforms at once. */
async function generateMulti(topic, platforms = ["instagram", "linkedin", "twitter"], tone = "educational") {
    return Promise.all(platforms.map(p => generate({ topic, platform: p, tone })));
}

async function run(task) {
    const p        = task.payload || {};
    const topic    = p.topic || p.about || task.input || "";
    const platform = p.platform || "instagram";
    const tone     = p.tone     || "educational";
    const multi    = p.platforms || null;

    if (!topic) return { success: false, type: "content", agent: "captionGeneratorAgent", data: { error: "topic required" } };

    try {
        const data = multi
            ? { captions: await generateMulti(topic, multi, tone) }
            : await generate({ topic, platform, tone });
        return { success: true, type: "content", agent: "captionGeneratorAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "captionGeneratorAgent", data: { error: err.message } };
    }
}

module.exports = { generate, generateMulti, run };
