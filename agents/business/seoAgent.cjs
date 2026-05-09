/**
 * SEO Agent — generates titles, meta descriptions, and keyword suggestions.
 * Uses Groq for AI-powered generation.
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are an expert SEO specialist. Generate optimized content.
Respond ONLY with JSON. No explanation or markdown fences.`;

async function generateMeta(topic, targetAudience = "business owners") {
    const prompt = `Generate SEO metadata for: "${topic}"
Target audience: ${targetAudience}
Respond as JSON:
{
  "title": "50-60 char SEO title",
  "metaDescription": "150-160 char meta description",
  "h1": "page headline",
  "keywords": ["kw1","kw2","kw3","kw4","kw5"],
  "slug": "url-friendly-slug"
}`;
    const raw = await groq.chat(SYSTEM, prompt);
    return groq.parseJson(raw);
}

async function keywordSuggestions(niche, count = 10) {
    const prompt = `Give ${count} high-traffic, low-competition keywords for: "${niche}"
Respond as JSON: { "keywords": [{"word":"...","intent":"informational|commercial|transactional","difficulty":"low|medium|high"}] }`;
    const raw = await groq.chat(SYSTEM, prompt);
    return groq.parseJson(raw);
}

async function run(task) {
    const p = task.payload || {};

    switch (task.type) {
        case "seo_generate":
        case "seo_meta": {
            if (!p.topic) return { success: false, type: "seoAgent", data: { error: "topic required" } };
            const data = await generateMeta(p.topic, p.audience);
            return { success: true, type: "seoAgent", data };
        }

        case "seo_keywords": {
            if (!p.niche) return { success: false, type: "seoAgent", data: { error: "niche required" } };
            const data = await keywordSuggestions(p.niche, p.count || 10);
            return { success: true, type: "seoAgent", data };
        }

        default:
            if (p.topic || p.niche) {
                const data = await generateMeta(p.topic || p.niche, p.audience);
                return { success: true, type: "seoAgent", data };
            }
            return { success: false, type: "seoAgent", data: { error: `Unknown SEO task: ${task.type}` } };
    }
}

module.exports = { run, generateMeta, keywordSuggestions };
