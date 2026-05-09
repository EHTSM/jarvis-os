/**
 * Multi-Language Expansion — generates localization plans and content adaptation guides.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are a localization expert. Generate practical language expansion strategies for software products.
Respond ONLY with valid JSON.`;

const LANGUAGE_PROFILES = {
    hindi:      { speakers: "600M+", region: "India",         rtl: false, priority: "High",   complexity: "Medium" },
    spanish:    { speakers: "500M+", region: "LatAm + Spain", rtl: false, priority: "High",   complexity: "Low"    },
    arabic:     { speakers: "370M+", region: "Middle East",   rtl: true,  priority: "High",   complexity: "High"   },
    portuguese: { speakers: "260M+", region: "Brazil + PT",   rtl: false, priority: "High",   complexity: "Low"    },
    french:     { speakers: "280M+", region: "EU + Africa",   rtl: false, priority: "Medium", complexity: "Low"    },
    german:     { speakers: "100M+", region: "DACH",          rtl: false, priority: "Medium", complexity: "Medium" },
    japanese:   { speakers: "125M+", region: "Japan",         rtl: false, priority: "Medium", complexity: "High"   },
    indonesian: { speakers: "200M+", region: "SE Asia",       rtl: false, priority: "High",   complexity: "Low"    }
};

const LOCALIZATION_LAYERS = [
    { layer: "UI strings",        effort: "Low",    tool: "i18next / react-i18n",          description: "Translate all visible text" },
    { layer: "Date/time formats", effort: "Low",    tool: "Intl API / date-fns",            description: "Locale-aware date formatting" },
    { layer: "Currency",          effort: "Low",    tool: "Intl.NumberFormat",              description: "Local currency display" },
    { layer: "RTL layout",        effort: "Medium", tool: "CSS logical properties",         description: "Mirror layout for Arabic/Hebrew" },
    { layer: "Payment methods",   effort: "High",   tool: "Razorpay/Stripe localization",   description: "Local payment gateway integration" },
    { layer: "Legal/compliance",  effort: "High",   tool: "Legal counsel",                  description: "GDPR, local data laws" }
];

async function plan({ product = "", targetLanguages = ["hindi", "spanish"], priorityMarket = "", userId = "" }) {
    const profiles  = targetLanguages.map(l => ({ language: l, ...(LANGUAGE_PROFILES[l.toLowerCase()] || { complexity: "Medium" }) }));
    const hasRTL    = profiles.some(p => p.rtl);

    let aiPlan = null;
    try {
        const prompt = `Localization plan for "${product}" targeting languages: ${targetLanguages.join(", ")}. Priority market: ${priorityMarket}.
JSON: { "quickWins": ["..."], "contentAdaptations": ["..."], "culturalConsiderations": ["..."], "estimatedTime": "..." }`;
        const raw   = await groq.chat(SYSTEM, prompt, { maxTokens: 300 });
        aiPlan      = groq.parseJson(raw);
    } catch { /* template */ }

    const result = {
        id:             uid("lang"),
        userId,
        product,
        targetLanguages: profiles,
        localizationLayers: LOCALIZATION_LAYERS,
        rtlRequired:    hasRTL,
        implementationOrder: [
            "1. Set up i18n framework (react-i18next / next-intl)",
            "2. Extract all hardcoded strings to translation files",
            "3. Translate UI strings (highest priority language first)",
            "4. Implement RTL layout if needed",
            "5. Localize date, currency, number formats",
            "6. Test with native speakers",
            "7. Launch in 1 market, measure, expand"
        ],
        estimatedEffort: {
            "1 language (no RTL)": "1-2 weeks",
            "3 languages (no RTL)": "3-4 weeks",
            "Arabic/RTL included":  "Add 2 extra weeks"
        },
        aiPlan,
        createdAt: NOW()
    };

    logToMemory("multiLanguageExpansion", product, { languages: targetLanguages.length, hasRTL });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await plan({ product: p.product || p.name || "", targetLanguages: p.languages || p.targetLanguages || ["hindi", "spanish"], priorityMarket: p.market || "", userId: p.userId || "" });
        return ok("multiLanguageExpansion", data, ["i18n from day 1 costs 10% — retrofitting costs 90%", "Always test with native speakers"]);
    } catch (err) { return fail("multiLanguageExpansion", err.message); }
}

module.exports = { plan, LANGUAGE_PROFILES, LOCALIZATION_LAYERS, run };
