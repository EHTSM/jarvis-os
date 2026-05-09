/**
 * Ad Copy Agent — generates platform-specific ad creatives (text only).
 * Formats: facebook | google | linkedin | whatsapp | instagram
 */

const groq = require("../core/groqClient.cjs");

const SYSTEM = `You are a performance marketing copywriter who writes high-converting ad copy.
Follow platform best practices. Be specific, benefit-focused, and include a strong CTA.
Respond ONLY with valid JSON.`;

const FORMATS = {
    facebook: {
        headline:  { max: 40,  tip: "Curiosity or benefit-driven" },
        body:      { max: 125, tip: "Problem → agitation → solution" },
        cta:       { options: ["Learn More","Shop Now","Sign Up","Get Offer","Book Now"] }
    },
    google: {
        headline1: { max: 30 },
        headline2: { max: 30 },
        description: { max: 90 }
    },
    linkedin: {
        headline:  { max: 70,  tip: "Professional, thought-leadership angle" },
        body:      { max: 600, tip: "Story → insight → CTA" },
        cta:       { options: ["Learn More","Register","Apply Now","Download","Request Demo"] }
    },
    whatsapp: {
        message:   { max: 200, tip: "Conversational, personal, emoji-light" }
    },
    instagram: {
        caption:   { max: 150, tip: "Hook in first line, emoji, CTA" },
        cta:       { options: ["Link in bio","DM us","Swipe up","Click below"] }
    }
};

const TEMPLATES = {
    facebook: (product, benefit, cta) => ({
        headline:    `${benefit} — Without The Guesswork`,
        body:        `Struggling to [problem]?\n\nMost people waste [time/money] on [common solution].\n\n${product} gives you [specific result] in [timeframe].\n\n✅ [Benefit 1]\n✅ [Benefit 2]\n✅ [Benefit 3]\n\n${benefit} guaranteed — or your money back.`,
        cta:         cta || "Learn More",
        format:      "facebook"
    }),
    google: (product, benefit) => ({
        headline1:   `${product.slice(0, 28)} | Try Free`,
        headline2:   benefit.slice(0, 30),
        description: `${benefit}. No contracts. Start in 5 minutes. Trusted by [X]+ businesses. Get started today.`,
        format:      "google"
    }),
    linkedin: (product, benefit, audience) => ({
        headline:    `How ${audience || "Founders"} Are Using ${product} to ${benefit}`,
        body:        `I've spent [X] years watching [audience] struggle with [problem].\n\nMost try [common approach]. It doesn't work because [reason].\n\nHere's what actually works:\n\n1. [Step 1]\n2. [Step 2]\n3. [Step 3]\n\nWe built ${product} to automate this.\n\n[Social proof]. [Result].\n\nDM me if you want to try it free this week.`,
        cta:         "Learn More",
        format:      "linkedin"
    }),
    whatsapp: (product, offer) => ({
        message:     `Hey! 👋\n\nQuick question — are you struggling with [problem]?\n\n${product} can help.\n\n${offer || "Try it FREE for 7 days — no card needed."}\n\nReply YES and I'll send you access right now.`,
        format:      "whatsapp"
    }),
    instagram: (product, hook) => ({
        caption:     `${hook || "This changed everything for me 👇"}\n\n[Main insight about ${product}]\n\n[Secondary benefit]\n\nLink in bio to get started 🔗`,
        cta:         "Link in bio",
        format:      "instagram"
    })
};

async function generate({ product, benefit, platform = "facebook", audience = "", offer = "", tone = "direct" }) {
    if (!product) throw new Error("product required");

    try {
        const fmt    = FORMATS[platform] || FORMATS.facebook;
        const prompt = `Write a ${tone} ${platform} ad for "${product}". Benefit: "${benefit}". Audience: "${audience || "small business owners"}".
Format specs: ${JSON.stringify(fmt)}.
Return JSON with all required fields for ${platform} format.`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 600 });
        const parsed = groq.parseJson(raw);
        return { platform, product, ...parsed };
    } catch {
        const tmpl = TEMPLATES[platform] || TEMPLATES.facebook;
        return tmpl(product, benefit, offer || audience);
    }
}

/** Generate ad copy for multiple platforms at once. */
async function generateMulti(product, benefit, platforms = ["facebook", "google", "whatsapp"]) {
    return Promise.all(platforms.map(p => generate({ product, benefit, platform: p })));
}

async function run(task) {
    const p        = task.payload || {};
    const product  = p.product  || p.name   || task.input || "";
    const benefit  = p.benefit  || p.tagline || "";
    const platform = p.platform || "facebook";
    const multi    = p.platforms || null;

    if (!product) return { success: false, type: "business_pro", agent: "adCopyAgent", data: { error: "product required" } };

    try {
        const data = multi
            ? { copies: await generateMulti(product, benefit, multi) }
            : await generate({ product, benefit, platform, audience: p.audience, offer: p.offer, tone: p.tone });
        return { success: true, type: "business_pro", agent: "adCopyAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "adCopyAgent", data: { error: err.message } };
    }
}

module.exports = { generate, generateMulti, run };
