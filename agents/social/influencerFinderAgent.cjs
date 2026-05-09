/**
 * Influencer Finder Agent — finds relevant influencers for collaboration.
 * Mock database (API-ready for Modash, Hypeauditor, etc).
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW } = require("./_socialStore.cjs");

const SYSTEM = `You are an influencer marketing expert. Suggest ideal influencer profiles for collaborations.
Respond ONLY with valid JSON.`;

const STORE = "influencer-outreach";

// Mock influencer database (realistic)
const MOCK_INFLUENCERS = [
    { handle: "@techwithtara",    niche: "tech",      followers: 45000,  engRate: 4.2, platform: "instagram", tier: "micro",  contact: "collab@techwithtara.com" },
    { handle: "@fitlifearjun",    niche: "fitness",   followers: 120000, engRate: 3.8, platform: "instagram", tier: "mid",    contact: "DM only" },
    { handle: "@businessbySofia", niche: "business",  followers: 28000,  engRate: 6.1, platform: "instagram", tier: "micro",  contact: "sofiabiz@gmail.com" },
    { handle: "@digitalpriya",    niche: "education", followers: 85000,  engRate: 5.0, platform: "youtube",   tier: "mid",    contact: "priya.collab@email.com" },
    { handle: "@ecomkaran",       niche: "ecommerce", followers: 22000,  engRate: 7.2, platform: "instagram", tier: "nano",   contact: "DM only" },
    { handle: "@lifestylelena",   niche: "lifestyle", followers: 210000, engRate: 2.9, platform: "instagram", tier: "macro",  contact: "agency@lenabrand.com" },
    { handle: "@startupsid",      niche: "business",  followers: 54000,  engRate: 4.8, platform: "linkedin",  tier: "micro",  contact: "sid@startupbuilder.in" },
    { handle: "@foodiefarida",    niche: "food",      followers: 33000,  engRate: 5.5, platform: "instagram", tier: "micro",  contact: "DM only" },
    { handle: "@techreviewrohit", niche: "tech",      followers: 95000,  engRate: 3.3, platform: "youtube",   tier: "mid",    contact: "rohit.reviews@email.com" },
    { handle: "@wellnesswithneha",niche: "fitness",   followers: 18000,  engRate: 8.1, platform: "instagram", tier: "nano",   contact: "DM only" }
];

const TIERS = { nano: [1000, 10000], micro: [10000, 100000], mid: [100000, 500000], macro: [500000, 1000000], mega: [1000000, Infinity] };

function search({ niche, platform, tier, minEngRate = 3.0 }) {
    return MOCK_INFLUENCERS.filter(inf => {
        const nicheMatch     = !niche    || inf.niche.includes(niche.toLowerCase()) || niche.toLowerCase().includes(inf.niche);
        const platformMatch  = !platform || inf.platform === platform.toLowerCase();
        const tierMatch      = !tier     || inf.tier === tier.toLowerCase();
        const engMatch       = inf.engRate >= minEngRate;
        return nicheMatch && platformMatch && tierMatch && engMatch;
    });
}

function _outreachTemplate(inf, brandName) {
    return `Hi ${inf.handle}! 👋\n\nI'm reaching out from ${brandName || "our brand"} — your ${inf.niche} content is genuinely great.\n\nWe think there's an awesome collab opportunity here. Interested in:\n• Sponsored post / Reel\n• Story feature + link\n• Joint live / co-creation\n\nLet me know if you'd like to hear more! 🙌`;
}

async function find({ niche = "", platform = "", tier = "", minEngRate = 3.0, brandName = "" }) {
    const results = search({ niche, platform, tier, minEngRate });

    let aiSuggestions = null;
    if (!results.length) {
        try {
            const prompt = `Suggest 3 influencer profiles for a ${niche} brand on ${platform || "Instagram"}.
JSON: { "profiles": [{ "handle": "...", "niche": "...", "followers": N, "engRate": N, "why": "..." }], "searchTips": "..." }`;
            const raw    = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
            aiSuggestions = groq.parseJson(raw);
        } catch { /* mock only */ }
    }

    const enriched = results.map(inf => ({ ...inf, outreachTemplate: _outreachTemplate(inf, brandName) }));

    return {
        query: { niche, platform, tier, minEngRate },
        found: enriched.length,
        influencers: enriched,
        aiSuggestions,
        tips: [
            "Micro-influencers (10k-100k) typically have 3× better engagement than mega influencers",
            "Always check story views vs. follower count — a 10% story view rate is healthy",
            "Offer creative freedom — influencers know their audience best",
            "Track results with a unique discount code or UTM link"
        ]
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await find({ niche: p.niche || "", platform: p.platform || "", tier: p.tier || "", minEngRate: p.minEngRate || 3.0, brandName: p.brandName || "" });
        return { success: true, type: "social", agent: "influencerFinderAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "influencerFinderAgent", data: { error: err.message } };
    }
}

module.exports = { find, search, run };
