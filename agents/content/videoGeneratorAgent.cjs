/**
 * Video Generator Agent — full video production package.
 * Generates: scene breakdown, voiceover per scene, b-roll suggestions, timeline.
 * Output is a complete production brief a creator can execute directly.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a professional video director and scriptwriter for social media and YouTube.
Create detailed video production packages with scene-by-scene breakdowns.
Respond ONLY with valid JSON.`;

// Video format specs
const FORMAT_SPECS = {
    youtube_long:  { duration: "8-15 min", ratio: "16:9", scenes: 8,  fps: 30 },
    youtube_short: { duration: "60 sec",   ratio: "9:16", scenes: 5,  fps: 30 },
    instagram_reel:{ duration: "30-90s",   ratio: "9:16", scenes: 6,  fps: 30 },
    tiktok:        { duration: "15-60s",   ratio: "9:16", scenes: 5,  fps: 30 },
    facebook_ad:   { duration: "15-30s",   ratio: "16:9", scenes: 4,  fps: 24 },
    linkedin:      { duration: "1-3 min",  ratio: "1:1",  scenes: 5,  fps: 24 },
    explainer:     { duration: "2-3 min",  ratio: "16:9", scenes: 6,  fps: 24 }
};

function _buildScenes(topic, format) {
    const spec = FORMAT_SPECS[format] || FORMAT_SPECS.youtube_long;
    const n    = spec.scenes;
    const isShort = ["youtube_short","instagram_reel","tiktok","facebook_ad"].includes(format);

    if (isShort) {
        return [
            { scene: 1, name: "Hook",        duration: "0-3s",   voiceover: `Stop — if you're into ${topic}, this is for you.`,       bRoll: "Close-up of relevant product/action",                textOverlay: "Bold hook statement" },
            { scene: 2, name: "Problem",      duration: "3-8s",   voiceover: `Most people get ${topic} completely wrong.`,             bRoll: "Person looking frustrated at problem",               textOverlay: "The problem" },
            { scene: 3, name: "Solution",     duration: "8-20s",  voiceover: `Here's what actually works: [your method for ${topic}].`, bRoll: "Step-by-step screen recording or demo",            textOverlay: "Key steps numbered" },
            { scene: 4, name: "Proof",        duration: "20-28s", voiceover: "Here's the result you can expect.",                      bRoll: "Before/after or result screenshot",                  textOverlay: "Result stat or testimonial" },
            { scene: 5, name: "CTA",          duration: "28-30s", voiceover: "Follow for more tips like this.",                        bRoll: "Creator pointing at camera / subscribe animation",   textOverlay: "Follow | Like | Share" }
        ].slice(0, n);
    }

    return [
        { scene: 1, name: "Intro & Hook",    duration: "0:00-0:30", voiceover: `Are you struggling with ${topic}? By the end of this video, you'll know exactly how to solve it.`, bRoll: "Creator talking to camera, animated title card",         textOverlay: "Episode title + subscribe reminder" },
        { scene: 2, name: "Problem Setup",   duration: "0:30-1:30", voiceover: `Here's why ${topic} is harder than it looks: [elaborate on pain points].`,                        bRoll: "Stock footage illustrating the problem, screen recording", textOverlay: "Problem label, statistics if available" },
        { scene: 3, name: "What You Need",   duration: "1:30-2:30", voiceover: "Before we dive in, here's what you'll need: [prerequisites].",                                   bRoll: "List appearing on screen, creator with tools/setup",      textOverlay: "Requirements checklist" },
        { scene: 4, name: "Main Content",    duration: "2:30-7:00", voiceover: `Step 1 for ${topic}: [detail]. Step 2: [detail]. Step 3: [detail].`,                             bRoll: "Screen recording, hands-on demo, B-roll of process",      textOverlay: "Step numbers, key terms, callout boxes" },
        { scene: 5, name: "Common Mistakes", duration: "7:00-8:30", voiceover: "Here's what most people get wrong — and how to avoid it.",                                       bRoll: "Creator pointing out mistake, red X animations",          textOverlay: "❌ Wrong way vs ✅ Right way" },
        { scene: 6, name: "Results & Proof", duration: "8:30-9:30", voiceover: "When you follow this system, here's what you can expect.",                                       bRoll: "Results dashboard, testimonial clip, before/after",       textOverlay: "Numbers, social proof callouts" },
        { scene: 7, name: "Recap",           duration: "9:30-10:30", voiceover: "Let's recap: [key point 1], [key point 2], [key point 3].",                                     bRoll: "Animated summary bullet points",                          textOverlay: "3-point summary" },
        { scene: 8, name: "CTA & Outro",     duration: "10:30-11:00", voiceover: "If this helped, smash that like button. Subscribe for more. Next video drops [day].",          bRoll: "End screen with subscribe button + next video preview",   textOverlay: "Subscribe CTA + links" }
    ].slice(0, n);
}

async function _groqVideo(topic, format) {
    const spec   = FORMAT_SPECS[format] || FORMAT_SPECS.youtube_long;
    const prompt = `Create a full video production package for "${topic}" (format: ${format}, duration: ${spec.duration}).
JSON: { "title": "video title", "description": "YouTube description (SEO-rich)", "scenes": [{ "scene": 1, "name": "scene name", "duration": "time", "voiceover": "script", "bRoll": "b-roll description", "textOverlay": "overlay text" }], "musicMood": "describe music", "colorGrade": "describe color tone", "callToAction": "final CTA" }`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 2000 });
    return groq.parseJson(raw);
}

async function generate({ topic, format = "youtube_long" }) {
    if (!topic) throw new Error("topic required");
    const spec = FORMAT_SPECS[format] || FORMAT_SPECS.youtube_long;

    try {
        const ai = await _groqVideo(topic, format);
        return { topic, format, spec, ...ai };
    } catch {
        return {
            topic, format, spec,
            title:        `${topic} — Complete Guide ${new Date().getFullYear()}`,
            description:  `In this video, we cover everything about ${topic}. Learn the strategies, avoid common mistakes, and get results fast.`,
            scenes:       _buildScenes(topic, format),
            musicMood:    "Upbeat, motivational — no lyrics during talking sections",
            colorGrade:   "Warm tones, slight vignette, contrast boost",
            callToAction: "Like + Subscribe + Comment your question below"
        };
    }
}

async function run(task) {
    const p      = task.payload || {};
    const topic  = p.topic || p.about || task.input || "";
    const format = p.format || "youtube_long";

    if (!topic) return { success: false, type: "content", agent: "videoGeneratorAgent", data: { error: "topic required" } };

    try {
        const data = await generate({ topic, format });
        return { success: true, type: "content", agent: "videoGeneratorAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "videoGeneratorAgent", data: { error: err.message } };
    }
}

module.exports = { generate, run };
