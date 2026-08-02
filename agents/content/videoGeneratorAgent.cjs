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

// ── Real rendered video (Sora) ──────────────────────────────────────────────
// Enterprise Capability Expansion mission. generate()/run() above produce a
// text production brief (script, scenes, b-roll) — genuinely useful but
// never an actual video file. This adds REAL rendered MP4 output via
// OpenAI's Sora API, credential-gated on OPENAI_API_KEY exactly like
// imageGeneratorAgent.cjs's DALL-E 3 integration: if the key is missing,
// generated:false with an honest reason is returned, never fabricated
// output. Kept in this same file (not a second agent) since it's the same
// capability domain — "video" — just a different output type.
const fs   = require("fs");
const path = require("path");
const VIDEO_DIR = path.join(__dirname, "../../data/video");
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 90_000; // Sora renders can take minutes; poll inline for
                             // up to 90s and report a pending job id back
                             // rather than blocking the HTTP request forever
                             // or faking a completed result.

function _openaiClient() {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;
    const OpenAI = require("openai");
    return new OpenAI({ apiKey: key });
}

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * generateRealVideo({ prompt, seconds, size }) -> real rendered MP4 or honest failure
 * @param {string} seconds "4" | "8" | "12"
 * @param {string} size    "720x1280" | "1280x720" | "1024x1792" | "1792x1024"
 */
async function generateRealVideo({ prompt, seconds = "4", size = "1280x720" } = {}) {
    if (!prompt) throw new Error("prompt required");

    const result = {
        prompt, seconds, size,
        generated: false,
        videoUrl: null,
        jobId: null,
        status: null,
        note: "Set OPENAI_API_KEY to generate real video via Sora",
    };

    const client = _openaiClient();
    if (!client) return result;

    try {
        let video = await client.videos.create({ model: "sora-2", prompt, seconds, size });
        result.jobId  = video.id;
        result.status = video.status;

        const deadline = Date.now() + MAX_POLL_MS;
        while (video.status === "queued" || video.status === "in_progress") {
            if (Date.now() > deadline) {
                result.status = video.status;
                result.note = `Video still rendering (job ${video.id}) — not yet complete after ${MAX_POLL_MS / 1000}s. Retrieve by jobId later; no fake output returned.`;
                return result;
            }
            await _sleep(POLL_INTERVAL_MS);
            video = await client.videos.retrieve(video.id);
        }

        result.status = video.status;
        if (video.status !== "completed") {
            result.note = `Video generation failed (job ${video.id}, status: ${video.status})`;
            return result;
        }

        const content = await client.videos.downloadContent(video.id);
        const arrayBuffer = await content.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        fs.mkdirSync(VIDEO_DIR, { recursive: true });
        const filename = `video_${Date.now()}.mp4`;
        fs.writeFileSync(path.join(VIDEO_DIR, filename), buffer);

        result.generated  = true;
        result.filename   = filename;
        result.via        = "sora-2";
        result.sizeBytes  = buffer.length;
        result.note       = null;
        return result;
    } catch (err) {
        result.generationError = err.message;
        result.note = `Sora API error: ${err.message}`;
        return result;
    }
}

module.exports = { generate, run, generateRealVideo };
