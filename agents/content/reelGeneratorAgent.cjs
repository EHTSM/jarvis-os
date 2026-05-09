/**
 * Reel Generator Agent — complete short-form content pack (Instagram/TikTok/Shorts).
 * Returns: multiple hook variants, scene-by-scene with timing, text overlays,
 * caption, hashtags, and music mood — all in one package.
 *
 * Different from business/contentAgent which returns a basic reel script.
 * This returns a full creator production brief.
 */

const groq              = require("../core/groqClient.cjs");
const hashtagGenerator  = require("./hashtagGeneratorAgent.cjs");
const captionGenerator  = require("./captionGeneratorAgent.cjs");

const SYSTEM = `You are a viral short-form content strategist for Instagram Reels, TikTok, and YouTube Shorts.
You know that the first 1-3 seconds decide everything. Write hooks that stop the scroll.
Respond ONLY with valid JSON.`;

// Proven hook formulas
const HOOK_FORMULAS = [
    (topic) => `Nobody is talking about this ${topic} trick 👇`,
    (topic) => `Stop doing ${topic} this way — here's why:`,
    (topic) => `I spent 30 days testing ${topic}. Here's what happened:`,
    (topic) => `The ${topic} secret that changed everything for me:`,
    (topic) => `If you do ${topic}, you NEED to see this:`,
    (topic) => `POV: You finally understand ${topic} 🤯`,
    (topic) => `${topic} in 60 seconds (most people take weeks):`,
    (topic) => `Hot take: Most ${topic} advice is completely wrong.`
];

// Trending sound/music categories
const MUSIC_MOODS = {
    educational: ["Lo-fi study beats", "Soft electronic", "Calm instrumental"],
    motivational: ["Epic build-up", "Hip-hop instrumental", "Cinematic rise"],
    entertainment: ["Trending sound", "Viral audio clip", "Comedy sound effect"],
    professional: ["Corporate background music", "Light jazz", "Ambient electronic"]
};

function _detectMood(topic) {
    const t = topic.toLowerCase();
    if (/how to|learn|guide|tutorial|tips|step/.test(t)) return "educational";
    if (/success|growth|money|win|goals|motivation/.test(t)) return "motivational";
    if (/funny|react|prank|skit|trend/.test(t)) return "entertainment";
    return "educational";
}

function _buildScenes(topic, duration = 30) {
    const isShort = duration <= 30;
    if (isShort) {
        return [
            { second: "0-2",  label: "HOOK",    voiceover: HOOK_FORMULAS[0](topic),        overlay: "Bold text of hook",          visual: "Creator close-up to camera / eye-catching visual" },
            { second: "2-8",  label: "SETUP",   voiceover: `Most people approach ${topic} like this — and it's costing them.`, overlay: "❌ Wrong approach",       visual: "Quick example of common mistake" },
            { second: "8-22", label: "PAYOFF",  voiceover: `Here's the right way: [step 1], [step 2], [step 3].`,              overlay: "✅ 1. 2. 3. (numbered list)", visual: "Screen recording or demo" },
            { second: "22-28", label: "PROOF",  voiceover: "And here's what that looks like in practice.",                     overlay: "Result / before→after",   visual: "Result screenshot or stat" },
            { second: "28-30", label: "CTA",    voiceover: "Save this for later and follow for more.",                         overlay: "💾 Save | 👆 Follow",     visual: "Creator pointing at screen" }
        ];
    }
    return [
        { second: "0-3",   label: "HOOK",    voiceover: HOOK_FORMULAS[Math.floor(Math.random() * HOOK_FORMULAS.length)](topic), overlay: "Bold hook text",       visual: "Attention-grabbing opener" },
        { second: "3-15",  label: "PROBLEM", voiceover: `Here's the real issue with ${topic}: [key insight].`,                 overlay: "The Problem 🔴",       visual: "Relatable problem scenario" },
        { second: "15-45", label: "SOLUTION", voiceover: "Step 1: [action]. Step 2: [action]. Step 3: [action].",              overlay: "Steps appearing on screen", visual: "Demo / walkthrough" },
        { second: "45-55", label: "RESULT",  voiceover: "Here's what you get when you do this right.",                         overlay: "The Result ✅",        visual: "Outcome visual" },
        { second: "55-60", label: "CTA",     voiceover: "Follow for part 2 — dropping tomorrow.",                              overlay: "Follow for Part 2 👆", visual: "Creator face + subscribe" }
    ];
}

async function _groqReel(topic, duration) {
    const prompt = `Create a complete Instagram Reel / TikTok production brief for "${topic}" (target duration: ${duration} seconds).
JSON: {
  "title": "reel title",
  "hooks": ["hook1","hook2","hook3"],
  "scenes": [{ "second": "0-3", "label": "HOOK", "voiceover": "...", "overlay": "...", "visual": "..." }],
  "caption": "Instagram caption",
  "musicMood": "music recommendation",
  "contentAngle": "unique angle/perspective"
}`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 1200 });
    return groq.parseJson(raw);
}

/**
 * Generate a complete reel production pack.
 * @param {string} topic
 * @param {number} duration  Target duration in seconds (15|30|60|90)
 * @param {string} platform  instagram | tiktok | youtube_shorts
 */
async function generate({ topic, duration = 30, platform = "instagram" }) {
    if (!topic) throw new Error("topic required");
    const mood = _detectMood(topic);

    let aiData = null;
    try {
        aiData = await _groqReel(topic, duration);
    } catch { /* use templates */ }

    // Parallel: get hashtags + caption for the topic
    const [hashData, captionData] = await Promise.allSettled([
        hashtagGenerator.generate({ topic, platform, count: platform === "instagram" ? 20 : 5 }),
        captionGenerator.generate({ topic, platform, tone: "storytelling" })
    ]);

    const hooks  = aiData?.hooks || HOOK_FORMULAS.slice(0, 3).map(fn => fn(topic));
    const scenes = aiData?.scenes || _buildScenes(topic, duration);

    return {
        topic,
        platform,
        duration:     `${duration}s`,
        contentAngle: aiData?.contentAngle || `First-person ${topic} breakdown with actionable steps`,
        hooks,
        bestHook:     hooks[0],
        scenes,
        caption:      captionData.status === "fulfilled" ? captionData.value.caption : aiData?.caption || `Everything you need to know about ${topic} 👇`,
        hashtags:     hashData.status === "fulfilled" ? hashData.value.hashtags : [],
        music: {
            mood,
            suggestions: MUSIC_MOODS[mood] || MUSIC_MOODS.educational,
            tip: "Use trending audio from your platform's library for extra reach boost"
        },
        editingTips: [
            "Captions on every word (auto-generate via CapCut/Premiere)",
            "Jump cuts every 2-3 seconds to maintain pace",
            "Zoom in on key moments for emphasis",
            "End on a cliffhanger or CTA before the last second"
        ]
    };
}

async function run(task) {
    const p        = task.payload || {};
    const topic    = p.topic    || p.about    || task.input || "";
    const duration = p.duration || 30;
    const platform = p.platform || "instagram";

    if (!topic) return { success: false, type: "content", agent: "reelGeneratorAgent", data: { error: "topic required" } };

    try {
        const data = await generate({ topic, duration, platform });
        return { success: true, type: "content", agent: "reelGeneratorAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "reelGeneratorAgent", data: { error: err.message } };
    }
}

module.exports = { generate, run };
