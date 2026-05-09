/**
 * Opportunity Finder — scans goals and surfaces actionable market opportunities.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are a market opportunity analyst. Given a goal, identify the top 3 business opportunities.
Be specific, realistic, and data-driven. Respond ONLY with valid JSON.`;

const OPPORTUNITY_TEMPLATES = {
    saas:      { type: "SaaS",         model: "Subscription", timeline: "3-6 months", capitalNeeded: "Low",    scalability: "Very High" },
    content:   { type: "Content/Media", model: "Ad + Affiliate", timeline: "2-4 months", capitalNeeded: "Very Low", scalability: "High" },
    service:   { type: "Service",       model: "Fee-for-service", timeline: "1-2 months", capitalNeeded: "Low",    scalability: "Medium" },
    ecommerce: { type: "E-commerce",    model: "Product margin",  timeline: "2-3 months", capitalNeeded: "Medium", scalability: "High" },
    ai_tool:   { type: "AI Tool",       model: "Freemium/API",    timeline: "2-4 months", capitalNeeded: "Low",    scalability: "Very High" }
};

const MARKET_SIGNALS = [
    { keyword: "ai",        type: "ai_tool",   demand: "Explosive" },
    { keyword: "automate",  type: "saas",      demand: "Very High" },
    { keyword: "content",   type: "content",   demand: "High" },
    { keyword: "sell",      type: "ecommerce", demand: "High" },
    { keyword: "service",   type: "service",   demand: "Steady" },
    { keyword: "software",  type: "saas",      demand: "Very High" },
    { keyword: "app",       type: "saas",      demand: "Very High" },
    { keyword: "teach",     type: "content",   demand: "High" },
    { keyword: "dropship",  type: "ecommerce", demand: "Medium" }
];

function _detectType(goal = "") {
    const lower = goal.toLowerCase();
    const match = MARKET_SIGNALS.find(s => lower.includes(s.keyword));
    return match ? { type: match.type, demand: match.demand } : { type: "saas", demand: "High" };
}

async function find(goal = "") {
    const detected   = _detectType(goal);
    const template   = OPPORTUNITY_TEMPLATES[detected.type] || OPPORTUNITY_TEMPLATES.saas;

    const opportunities = [
        {
            rank:         1,
            title:        `Core opportunity: ${goal}`,
            ...template,
            demand:       detected.demand,
            painPoint:    "Users need faster, cheaper, more automated solutions",
            targetMarket: "Small to mid-size businesses / solopreneurs",
            revenueModel: template.model,
            confidence:   85
        },
        {
            rank:         2,
            title:        `Adjacent: ${goal} + automation`,
            type:         "SaaS",
            model:        "Subscription",
            timeline:     "4-6 months",
            capitalNeeded:"Low",
            scalability:  "Very High",
            demand:       "Very High",
            painPoint:    "Manual processes eating time and money",
            targetMarket: "Tech-forward SMBs",
            revenueModel: "Monthly recurring",
            confidence:   72
        },
        {
            rank:         3,
            title:        `Niche: ${goal} consulting/productized service`,
            type:         "Service",
            model:        "Retainer + Productized",
            timeline:     "1 month",
            capitalNeeded:"None",
            scalability:  "Medium",
            demand:       "Steady",
            painPoint:    "No trusted expert for this niche",
            targetMarket: "Startups, growing teams",
            revenueModel: "Monthly retainer",
            confidence:   65
        }
    ];

    let aiEnrichment = null;
    try {
        const prompt = `Goal: "${goal}". Identify 3 specific market opportunities with estimated market size, competition level, and differentiation angle.
JSON: { "topOpportunity": "...", "marketSize": "...", "competition": "Low|Medium|High", "uniqueAngle": "...", "whyNow": "..." }`;
        const raw     = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiEnrichment  = groq.parseJson(raw);
    } catch { /* template only */ }

    const result = {
        id:            uid("opp"),
        goal,
        opportunities,
        recommended:   opportunities[0],
        aiEnrichment,
        scoredAt:      NOW()
    };

    logToMemory("opportunityFinder", goal, { recommended: opportunities[0].title });
    return result;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await find(p.goal || task.input || "build a profitable business");
        return ok("opportunityFinder", data, ["Research opportunity", "Validate with 5 real customers first"]);
    } catch (err) { return fail("opportunityFinder", err.message); }
}

module.exports = { find, run };
