/**
 * Image Generator Agent — builds optimized prompts for AI image generators.
 * If OPENAI_API_KEY is set → calls DALL-E 3 and returns the image URL.
 * Otherwise → returns a structured prompt ready for DALL-E / Midjourney / SD.
 */

const axios = require("axios");
const groq  = require("../core/groqClient.cjs");

const DALLE_URL = "https://api.openai.com/v1/images/generations";
const TIMEOUT   = 60_000;

const SYSTEM = `You are an expert AI image prompt engineer.
Create detailed, specific prompts that produce high-quality, professional images.
Consider: subject, style, lighting, mood, composition, camera angle, color palette.
Respond ONLY with valid JSON.`;

// Style presets
const STYLES = {
    photorealistic: "ultra-realistic photography, DSLR quality, natural lighting, 8K resolution",
    cinematic:      "cinematic shot, movie-grade color grading, dramatic lighting, wide angle lens",
    illustration:   "digital illustration, vibrant colors, clean lines, professional graphic design",
    flat_design:    "flat design style, minimal, vector art, pastel colors, clean composition",
    linkedin_banner: "professional LinkedIn banner, corporate style, blue gradient, modern typography",
    thumbnail:      "YouTube thumbnail style, bold colors, high contrast, attention-grabbing",
    product:        "product photography, white background, studio lighting, commercial quality",
    social_post:    "social media post design, 1080x1080, vibrant, scroll-stopping, modern",
    infographic:    "clean infographic style, data visualization, icons, flat colors, readable"
};

function _buildPrompt(subject, style, mood, extraDetails) {
    const styleDesc = STYLES[style] || STYLES.photorealistic;
    const parts = [
        subject,
        styleDesc,
        mood ? `mood: ${mood}` : "",
        extraDetails || "",
        "professional quality, detailed, sharp focus"
    ].filter(Boolean);
    return parts.join(", ");
}

function _templatePrompt(topic, style, mood) {
    const prompt       = _buildPrompt(topic, style, mood, "");
    const negativePrompt = "blurry, low quality, distorted, watermark, text overlay, amateur, overexposed";

    return {
        topic, style, mood,
        prompt,
        negativePrompt,
        recommendations: {
            dalle3:     `Image: ${prompt}`,
            midjourney: `${prompt} --ar 16:9 --q 2 --v 6`,
            stable:     `${prompt}\nNegative: ${negativePrompt}`
        },
        sizes: { square: "1024x1024", landscape: "1792x1024", portrait: "1024x1792" },
        generated: false,
        note: "Set OPENAI_API_KEY to generate directly via DALL-E 3"
    };
}

async function _enhancePrompt(topic, style) {
    const prompt = `Create an optimized AI image prompt for: "${topic}" in ${style} style.
JSON: { "prompt": "detailed prompt", "negativePrompt": "things to exclude", "style": "${style}", "mood": "describe mood", "colorPalette": "describe palette" }`;
    const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
    return groq.parseJson(raw);
}

async function _callDalle3(prompt, size = "1024x1024") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY not set");

    const res = await axios.post(DALLE_URL, {
        model:   "dall-e-3",
        prompt,
        n:       1,
        size,
        quality: "standard"
    }, {
        headers:  { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        timeout:  TIMEOUT
    });
    return res.data?.data?.[0]?.url || null;
}

/**
 * Generate an image prompt and optionally call DALL-E 3.
 * @param {string} topic
 * @param {string} style   photorealistic | cinematic | illustration | flat_design | social_post | thumbnail
 * @param {string} mood    optional mood description
 * @param {string} size    1024x1024 | 1792x1024 | 1024x1792
 */
async function generate({ topic, style = "photorealistic", mood = "", size = "1024x1024" }) {
    if (!topic) throw new Error("topic required");

    // Build enhanced prompt
    let promptData;
    try {
        const enhanced = await _enhancePrompt(topic, style);
        promptData = { prompt: enhanced.prompt, negativePrompt: enhanced.negativePrompt, mood: enhanced.mood };
    } catch {
        promptData = { prompt: _buildPrompt(topic, style, mood, ""), negativePrompt: "blurry, low quality, distorted" };
    }

    const result = {
        topic, style, size,
        ...promptData,
        recommendations: {
            dalle3:     promptData.prompt,
            midjourney: `${promptData.prompt} --ar ${size.replace("x", ":")} --q 2 --v 6`,
            stable:     `${promptData.prompt}\nNegative: ${promptData.negativePrompt}`
        },
        generated: false,
        imageUrl:  null
    };

    // Try DALL-E 3 if key is available
    if (process.env.OPENAI_API_KEY) {
        try {
            result.imageUrl  = await _callDalle3(promptData.prompt, size);
            result.generated = true;
            result.via       = "dall-e-3";
        } catch (err) {
            result.generationError = err.message;
        }
    }

    return result;
}

async function run(task) {
    const p     = task.payload || {};
    const topic = p.topic || p.subject || p.prompt || task.input || "";
    const style = p.style || "photorealistic";
    const mood  = p.mood  || "";
    const size  = p.size  || "1024x1024";

    if (!topic) return { success: false, type: "content", agent: "imageGeneratorAgent", data: { error: "topic or prompt required" } };

    try {
        const data = await generate({ topic, style, mood, size });
        return { success: true, type: "content", agent: "imageGeneratorAgent", data };
    } catch (err) {
        return { success: false, type: "content", agent: "imageGeneratorAgent", data: { error: err.message } };
    }
}

module.exports = { generate, run };
