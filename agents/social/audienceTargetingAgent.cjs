/**
 * Audience Targeting Agent — builds audience personas and segment definitions
 * for content and ad targeting.
 */

const groq = require("../core/groqClient.cjs");
const { uid, load, flush, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are an audience research expert. Define detailed audience personas for social media marketing.
Respond ONLY with valid JSON.`;

const STORE = "audience-segments";

const PERSONA_TEMPLATES = {
    small_business_owner: {
        ageRange: "28-45", gender: "Any", income: "₹3L-₹15L/year",
        painPoints: ["no time", "limited budget", "can't scale", "inconsistent leads"],
        desires:    ["predictable revenue", "automated systems", "more clients", "online presence"],
        platforms:  ["Instagram", "LinkedIn", "WhatsApp", "YouTube"],
        content:    ["How-to guides", "Case studies", "Quick tips", "Tools reviews"]
    },
    young_professional: {
        ageRange: "22-32", gender: "Any", income: "₹5L-₹20L/year",
        painPoints:  ["career growth", "salary plateau", "skill gaps", "side income"],
        desires:     ["promotion", "side hustle", "financial freedom", "personal branding"],
        platforms:   ["LinkedIn", "Twitter/X", "Instagram", "YouTube"],
        content:     ["Career advice", "Skill tutorials", "Success stories", "Productivity"]
    },
    entrepreneur: {
        ageRange: "25-45", gender: "Any", income: "Variable",
        painPoints:  ["funding", "hiring", "product-market fit", "scaling", "competition"],
        desires:     ["10× growth", "media presence", "investor attention", "team building"],
        platforms:   ["Twitter/X", "LinkedIn", "YouTube", "Podcasts"],
        content:     ["Building in public", "Startup lessons", "Fundraising stories", "Metrics sharing"]
    },
    student: {
        ageRange: "18-25", gender: "Any", income: "₹0-₹3L/year",
        painPoints:  ["no experience", "job market", "student debt", "unclear path"],
        desires:     ["first job", "internships", "skills", "early income"],
        platforms:   ["Instagram", "YouTube", "LinkedIn", "Twitter/X"],
        content:     ["Free resources", "Career roadmaps", "Study tips", "Scholarships"]
    }
};

function buildPersona({ niche, product = "", pricePoint = "mid" }) {
    const base     = PERSONA_TEMPLATES[niche] || PERSONA_TEMPLATES.small_business_owner;
    const segments = [
        { name: "Warm Audience",    desc: "Existing followers + email subscribers", strategy: "Nurture → upsell", ads: "Lookalike 1%", priority: 1 },
        { name: "Interest Audience", desc: `People interested in ${niche} topics`, strategy: "Value content → soft CTA", ads: "Interest targeting", priority: 2 },
        { name: "Cold Audience",    desc: "Broad demographic targeting", strategy: "Awareness → retarget", ads: "Demographic + interest mix", priority: 3 },
        { name: "Competitor Fans",  desc: "Followers of competitor accounts", strategy: "Differentiation angle", ads: "Engagement custom audience", priority: 2 }
    ];

    return {
        id:       uid("aud"),
        niche,
        product,
        persona:  { ...base, pricePoint },
        segments,
        messaging: {
            primaryHook:  `Are you a ${base.ageRange} ${niche} trying to [result]?`,
            painAddress:  `Tired of ${base.painPoints[0]}? You're not alone.`,
            desireHook:   `What if you could achieve ${base.desires[0]} in 90 days?`,
            socialProof:  "Join 10,000+ [niche] professionals who already..."
        },
        adTargeting: {
            facebook: { age: base.ageRange, interests: [niche, ...base.content.slice(0, 2)], behaviours: ["small business owner", "frequent buyer"] },
            google:   { keywords: [`${niche} tips`, `how to ${niche}`, `best ${niche} tools`] },
            instagram: { hashtags: [`#${niche}`, `#${niche}tips`, `#${niche}community`] }
        },
        createdAt: NOW()
    };
}

async function generate(params) {
    const base = buildPersona(params);
    try {
        const prompt = `Define audience persona for a ${params.niche} brand targeting ${params.pricePoint || "mid"}-market.
JSON: { "icp": "...", "buyerJourney": ["awareness","consideration","decision"], "messagingAngles": ["..."], "platformPriority": ["..."] }`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 450 });
        base.aiPersona = groq.parseJson(raw);
    } catch { /* template only */ }

    const all = load(STORE, []);
    all.push(base);
    flush(STORE, all.slice(-20));

    return base;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await generate({ niche: p.niche || "business", product: p.product || "", pricePoint: p.pricePoint || "mid" });
        return { success: true, type: "social", agent: "audienceTargetingAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "audienceTargetingAgent", data: { error: err.message } };
    }
}

module.exports = { buildPersona, generate, run };
