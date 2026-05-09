/**
 * Meme Generator Agent — generates meme text concepts and templates.
 * Pure text output (image rendering needs external tool like canvas/sharp).
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are a viral meme creator. Generate relatable, funny meme concepts for social media.
Keep it brand-safe. Respond ONLY with valid JSON.`;

const MEME_FORMATS = {
    drake:         { name: "Drake Pointing", structure: "Reject [old thing] / Approve [new thing]" },
    distracted:    { name: "Distracted Boyfriend", structure: "[Person] looking at [new thing] ignoring [old thing]" },
    this_is_fine:  { name: "This Is Fine Dog", structure: "[Person] saying 'this is fine' while [chaos]" },
    expanding:     { name: "Expanding Brain", structure: "Level 1: [basic idea] → Level 4: [galaxy brain idea]" },
    two_buttons:   { name: "Two Buttons Sweating", structure: "Me: can't decide between [option A] and [option B]" },
    change_my_mind: { name: "Change My Mind", structure: "[Controversial hot take]. Change my mind." },
    gru_plan:      { name: "Gru's Plan", structure: "Step 1: [plan]. Step 2: [plan]. Step 3: [same thing, goes wrong]." },
    bernie:        { name: "Bernie Mittens", structure: "Me, sitting in [relatable situation]" },
    woman_yelling: { name: "Woman Yelling at Cat", structure: "[Overreacting person] vs [unbothered response]" },
    roll_safe:     { name: "Roll Safe / Big Brain", structure: "Can't [problem] if you [absurd workaround]" }
};

const NICHE_MEMES = {
    business:    ["entrepreneurs at 3am vs 9am", "budget vs actual spend", "clients vs freelancers", "the pivot email"],
    tech:        ["it works on my machine", "deploy on friday", "10x engineer vs average", "stack overflow copy-paste"],
    fitness:     ["day 1 vs day 365", "leg day skippers", "pre-workout effect", "gym selfie logic"],
    marketing:   ["ROI conversations", "organic reach 2025", "A/B test results", "client feedback cycle"],
    social_media:["algorithm change", "going viral for the wrong thing", "follower count anxiety", "DM inbox chaos"]
};

function generate({ topic, niche = "business", format = "drake", count = 3 }) {
    const fmt     = MEME_FORMATS[format] || MEME_FORMATS.drake;
    const topics  = NICHE_MEMES[niche.toLowerCase()] || NICHE_MEMES.business;
    const seed    = topic || topics[Math.floor(Math.random() * topics.length)];

    const templates = [
        { text1: `Using ${seed} the wrong way`, text2: `Using ${seed} the RIGHT way — watching this video` },
        { text1: `Everyone else struggling with ${seed}`, text2: `Me after finding the 1 trick that works` },
        { text1: `${seed}? Never heard of it`, text2: `${seed}? It's my whole personality now` }
    ];

    return Array.from({ length: Math.min(count, 5) }, (_, i) => ({
        id:       uid("meme"),
        format:   fmt.name,
        template: fmt.structure,
        topic:    seed,
        niche,
        text1:    templates[i % templates.length].text1,
        text2:    templates[i % templates.length].text2,
        caption:  `When ${seed} hits different 💀 Save this if you feel attacked`,
        hashtags: [`#${niche}humor`, `#${seed.replace(/\s+/g, "").toLowerCase()}`, "#relatable", "#meme"],
        createdAt: NOW()
    }));
}

async function generateWithAI({ topic, niche = "business", format = "drake", count = 3 }) {
    const base = generate({ topic, niche, format, count });
    try {
        const prompt = `Create ${count} viral meme concepts for ${niche} audience about "${topic || niche}".
Format: ${MEME_FORMATS[format]?.name || "Drake"}.
JSON: { "memes": [{ "format": "...", "topText": "...", "bottomText": "...", "caption": "...", "viralReason": "..." }] }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
        const ai   = groq.parseJson(raw);
        return { count: base.length, memes: base, aiMemes: ai?.memes || [], formats: Object.keys(MEME_FORMATS) };
    } catch {
        return { count: base.length, memes: base, formats: Object.keys(MEME_FORMATS) };
    }
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generateWithAI({ topic: p.topic || p.niche, niche: p.niche || "business", format: p.format || "drake", count: p.count || 3 });
        return { success: true, type: "social", agent: "memeGeneratorAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "memeGeneratorAgent", data: { error: err.message } };
    }
}

module.exports = { generate, generateWithAI, MEME_FORMATS, run };
