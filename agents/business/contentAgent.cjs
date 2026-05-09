/**
 * Content Agent — generates posts, reel captions, blog intros, and ad copy.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a professional content creator and copywriter.
Write engaging, conversion-focused content.
Respond ONLY with JSON.`;

const FORMAT_PROMPTS = {
    post:    (topic, tone) => `Write a LinkedIn/Facebook post about "${topic}" in a ${tone} tone.
JSON: { "post": "...", "hashtags": ["#tag1","#tag2","#tag3"], "cta": "call to action text" }`,

    reel:    (topic, tone) => `Write a short Instagram Reel script + caption about "${topic}" in a ${tone} tone.
JSON: { "hook": "first 3 seconds hook", "script": "30-60 sec script", "caption": "caption text", "hashtags": ["#tag"] }`,

    blog:    (topic, tone) => `Write a blog post intro (300 words) about "${topic}" in a ${tone} tone.
JSON: { "title": "blog title", "intro": "300 word intro", "outline": ["section1","section2","section3"] }`,

    ad:      (topic, tone) => `Write a paid ad copy for "${topic}" in a ${tone} tone.
JSON: { "headline": "max 30 chars", "body": "max 90 chars", "cta": "button text" }`,

    whatsapp:(topic, tone) => `Write a WhatsApp sales message about "${topic}" in a ${tone} tone. Max 200 words.
JSON: { "message": "WhatsApp message text" }`
};

async function generate({ format = "post", topic, tone = "professional" }) {
    if (!topic) throw new Error("topic is required");
    const promptFn = FORMAT_PROMPTS[format] || FORMAT_PROMPTS.post;
    const raw = await groq.chat(SYSTEM, promptFn(topic, tone));
    return groq.parseJson(raw);
}

async function run(task) {
    const p      = task.payload || {};
    const topic  = p.topic || p.about || task.input || "";
    const format = p.format || "post";
    const tone   = p.tone   || "professional";

    if (!topic) return { success: false, type: "contentAgent", data: { error: "topic required in payload" } };

    try {
        const data = await generate({ format, topic, tone });
        return { success: true, type: "contentAgent", data: { format, topic, ...data } };
    } catch (err) {
        return { success: false, type: "contentAgent", data: { error: err.message } };
    }
}

module.exports = { run, generate };
