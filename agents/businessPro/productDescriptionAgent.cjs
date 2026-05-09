/**
 * Product Description Agent — generates SEO-rich product descriptions.
 * Groq-powered with template fallback.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are an expert product copywriter for e-commerce.
Write descriptions that sell, rank on Google, and convert browsers into buyers.
Respond ONLY with valid JSON.`;

const FORMATS = {
    short:  { words: "50-80",   purpose: "listing snippet" },
    medium: { words: "150-200", purpose: "product page" },
    long:   { words: "300-400", purpose: "full SEO page" },
    bullet: { words: "5 bullets", purpose: "Amazon/Flipkart style" }
};

function _template(name, category, benefits, format) {
    const b = benefits?.length ? benefits : [`[Key benefit of ${name}]`, "[Who it's for]", "[What makes it unique]"];

    if (format === "bullet") {
        return {
            format,
            bullets: [
                `✅ ${b[0] || `Professional-grade ${name} for maximum results`}`,
                `✅ ${b[1] || "Designed for small business owners and entrepreneurs"}`,
                `✅ ${b[2] || "Save 5+ hours per week with smart automation"}`,
                `✅ Easy setup — get started in under 10 minutes`,
                `✅ 7-day money-back guarantee — zero risk`
            ]
        };
    }

    const lengths = { short: 2, medium: 4, long: 7 };
    const paras   = lengths[format] || 2;

    const paragraphs = [
        `Introducing ${name} — the ultimate solution for anyone serious about [goal].`,
        `${b[0]} Unlike generic alternatives, ${name} delivers [specific result] without [common frustration].`,
        `${b[1]} Whether you're a [target user 1] or [target user 2], ${name} adapts to your workflow.`,
        `${b[2]} Hundreds of users have already achieved [result] in just [timeframe].`,
        `Setup takes under 10 minutes. No technical skills required.`,
        `Your [goal] is too important to leave to chance. ${name} makes it reliable, repeatable, and scalable.`,
        `Start today — backed by our 7-day no-questions-asked refund policy.`
    ].slice(0, paras);

    return { format, description: paragraphs.join("\n\n") };
}

async function generate({ name, category = "", benefits = [], format = "medium", tone = "professional" }) {
    if (!name) throw new Error("name required");
    const fmt = FORMATS[format] || FORMATS.medium;

    try {
        const prompt = `Write a ${fmt.words} word product description for "${name}" (${category}).
Format: ${format} (${fmt.purpose}). Tone: ${tone}. Key benefits: ${benefits.join(", ") || "not specified"}.
JSON: { "format": "${format}", ${format === "bullet" ? '"bullets": ["✅ ...","✅ ..."]' : '"description": "full text"'}, "seoTitle": "...", "metaDescription": "max 160 chars" }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 800 });
        return { name, category, ...groq.parseJson(raw) };
    } catch {
        return { name, category, ..._template(name, category, benefits, format) };
    }
}

async function run(task) {
    const p = task.payload || {};
    if (!p.name) return { success: false, type: "business_pro", agent: "productDescriptionAgent", data: { error: "name required" } };

    try {
        const data = await generate({ name: p.name, category: p.category, benefits: p.benefits || [], format: p.format || "medium", tone: p.tone });
        return { success: true, type: "business_pro", agent: "productDescriptionAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "productDescriptionAgent", data: { error: err.message } };
    }
}

module.exports = { generate, run };
