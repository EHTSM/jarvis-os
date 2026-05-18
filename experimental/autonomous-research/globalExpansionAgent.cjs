/**
 * Global Expansion Agent — generates market-entry strategies for international expansion.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are an international expansion strategist. Create specific, actionable market-entry plans.
Respond ONLY with valid JSON.`;

const MARKET_PROFILES = {
    india:          { currency: "INR", internetUsers: "900M+", paymentMethods: ["UPI", "Cards", "Wallets"], languages: ["Hindi", "English", "Regional"], regulations: "RBI compliant", priceIndex: 0.3 },
    usa:            { currency: "USD", internetUsers: "330M",  paymentMethods: ["Cards", "PayPal", "ACH"], languages: ["English"],                      regulations: "SOC2, CCPA",   priceIndex: 1.0 },
    southeast_asia: { currency: "Mixed", internetUsers: "400M+", paymentMethods: ["Local wallets", "Cards"], languages: ["English + regional"],          regulations: "Varies",       priceIndex: 0.4 },
    europe:         { currency: "EUR", internetUsers: "500M+", paymentMethods: ["SEPA", "Cards", "BNPL"],  languages: ["Multiple"],                     regulations: "GDPR strict",  priceIndex: 0.8 },
    middle_east:    { currency: "Mixed", internetUsers: "180M", paymentMethods: ["Cards", "Cash on delivery"], languages: ["Arabic", "English"],         regulations: "Varies",       priceIndex: 0.7 }
};

const ENTRY_STRATEGIES = {
    digital_first: { description: "Launch digital product with localized pricing", investment: "Low",    timeline: "1-3 months",  risk: "Low"    },
    partnership:   { description: "Partner with local distributor/reseller",       investment: "Medium", timeline: "3-6 months",  risk: "Medium" },
    direct:        { description: "Set up local entity, hire team",               investment: "High",   timeline: "6-12 months", risk: "High"   }
};

async function plan({ product = "", targetMarkets = ["india"], strategy = "digital_first", currentRevenue = 0, userId = "" }) {
    const markets  = targetMarkets.map(m => ({ market: m, ...(MARKET_PROFILES[m.toLowerCase().replace(" ", "_")] || {}) }));
    const entryPlan = ENTRY_STRATEGIES[strategy] || ENTRY_STRATEGIES.digital_first;

    let aiExpansion = null;
    try {
        const prompt = `Expansion plan for "${product}" into ${targetMarkets.join(", ")}. Strategy: ${strategy}. Current revenue: $${currentRevenue}.
JSON: { "priorityMarket": "...", "localizedPricing": "...", "culturalAdaptations": ["..."], "regulatoryChecklist": ["..."], "timelineMonths": 3 }`;
        const raw      = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiExpansion    = groq.parseJson(raw);
    } catch { /* template */ }

    const plan = {
        id:             uid("global"),
        userId,
        product,
        targetMarkets:  markets,
        entryStrategy:  entryPlan,
        pricingLocalization: markets.map(m => ({
            market:       m.market,
            priceMultiplier: m.priceIndex || 0.5,
            suggestedPrice: `${m.currency || "local"} ${Math.round((currentRevenue || 999) * (m.priceIndex || 0.5))}/mo`
        })),
        expansionChecklist: [
            "Localize language and currency",
            "Set up local payment method",
            "Comply with local data regulations",
            "Create local support channel",
            "Run geo-targeted ads for validation",
            "Track market-specific KPIs separately"
        ],
        aiExpansion,
        warning: "GDPR and local financial regulations must be reviewed by a legal expert before launch.",
        createdAt: NOW()
    };

    logToMemory("globalExpansionAgent", `${product}:${targetMarkets.join(",")}`, { markets: markets.length });
    return plan;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await plan({ product: p.product || p.name || "", targetMarkets: p.markets || p.targetMarkets || ["india"], strategy: p.strategy || "digital_first", currentRevenue: p.revenue || 0, userId: p.userId || "" });
        return ok("globalExpansionAgent", data, ["Validate in 1 market before 10", "Localization is more than translation"]);
    } catch (err) { return fail("globalExpansionAgent", err.message); }
}

module.exports = { plan, MARKET_PROFILES, ENTRY_STRATEGIES, run };
