/**
 * Competitor AI — maps competitive landscape and identifies strategic gaps.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are a competitive intelligence analyst. Map competitors and find gaps to exploit.
Be specific with competitor names, weaknesses, and differentiation strategies. Respond ONLY with valid JSON.`;

const COMPETITIVE_DIMENSIONS = [
    "Pricing",
    "Target market (SMB vs Enterprise vs Individual)",
    "Core feature set",
    "UX/design quality",
    "Customer support",
    "Integration ecosystem",
    "Geographic focus",
    "Go-to-market (PLG vs Sales-led)"
];

function _positioningMatrix(competitors = []) {
    return competitors.map(c => ({
        name:         c.name,
        price:        c.price || "Unknown",
        targetMarket: c.market || "Unknown",
        weakness:     c.weakness || "Unknown",
        gap:          c.weakness ? `Build what ${c.name} lacks: ${c.weakness}` : "Research needed"
    }));
}

async function analyze({ product = "", market = "", knownCompetitors = [], userId = "" }) {
    const matrix = _positioningMatrix(knownCompetitors);

    let aiAnalysis = null;
    try {
        const prompt = `Competitive analysis for "${product}" in "${market}" market. Known competitors: ${knownCompetitors.map(c => c.name).join(", ") || "unknown"}.
JSON: {
  "topCompetitors": [{ "name": "...", "weakness": "...", "pricing": "...", "marketPosition": "..." }],
  "marketGaps": ["..."],
  "differentiationAngles": ["..."],
  "positioningStatement": "...",
  "competitiveMoats": ["..."]
}`;
        const raw    = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
        aiAnalysis   = groq.parseJson(raw);
    } catch { /* template */ }

    const report = {
        id:                  uid("comp"),
        userId,
        product,
        market,
        positioningMatrix:   matrix,
        dimensions:          COMPETITIVE_DIMENSIONS,
        aiAnalysis,
        strategicOptions: [
            "Be the cheapest (cost leadership) — risky, races to bottom",
            "Be the best for a specific niche (focus strategy) — recommended for startups",
            "Offer more features at same price (differentiation)",
            "Target underserved segment competitors ignore"
        ],
        redFlags: [
            "If market has 3+ funded VC-backed players, validate harder before entering",
            "If top competitor is free, your monetization must be clearly superior",
            "If no competitors exist, validate that demand is real — not just absent"
        ],
        analyzedAt: NOW()
    };

    logToMemory("competitorAI", `${product}:${market}`, { competitors: knownCompetitors.length });
    return report;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await analyze({ product: p.product || p.name || "", market: p.market || p.niche || "", knownCompetitors: p.competitors || [], userId: p.userId || "" });
        return ok("competitorAI", data, ["Compete where incumbents are weak", "Copy what works — differentiate what doesn't"]);
    } catch (err) { return fail("competitorAI", err.message); }
}

module.exports = { analyze, COMPETITIVE_DIMENSIONS, run };
