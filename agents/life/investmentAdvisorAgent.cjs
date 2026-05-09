/**
 * Investment Advisor Agent — general financial education only. NOT investment advice.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail, FINANCE_DISCLAIMER } = require("./_lifeStore.cjs");

const SYSTEM = `You are a financial educator explaining general investment concepts.
Always emphasize this is educational, not personalized advice. Recommend consulting a SEBI-registered advisor.
Respond ONLY with valid JSON.`;

const INVESTMENT_TYPES = {
    equity: {
        name:        "Equity (Stocks/MFs)",
        riskLevel:   "High",
        horizon:     "5+ years",
        expectedRet: "10-15% pa (historical, not guaranteed)",
        bestFor:     "Long-term wealth building",
        options:     ["Index Funds (Nifty 50)", "Large-cap MFs", "Direct Stocks", "ELSS (tax saving)"]
    },
    debt: {
        name:        "Debt Instruments",
        riskLevel:   "Low-Medium",
        horizon:     "1-5 years",
        expectedRet: "5-8% pa",
        bestFor:     "Capital preservation + steady income",
        options:     ["FD", "PPF", "Bonds", "Liquid MFs", "NSC"]
    },
    gold: {
        name:        "Gold",
        riskLevel:   "Medium",
        horizon:     "5+ years",
        expectedRet: "7-10% pa (historical)",
        bestFor:     "Inflation hedge, portfolio diversification",
        options:     ["Sovereign Gold Bonds (SGB)", "Gold ETFs", "Digital Gold"]
    },
    real_estate: {
        name:        "Real Estate",
        riskLevel:   "Medium-High",
        horizon:     "10+ years",
        expectedRet: "6-12% pa",
        bestFor:     "Long-term capital appreciation + rental income",
        options:     ["REITs (lower capital needed)", "Property", "Land"]
    }
};

const ALLOCATION_MODELS = {
    conservative:  { equity: 20, debt: 60, gold: 15, real_estate: 5  },
    moderate:      { equity: 50, debt: 35, gold: 10, real_estate: 5  },
    aggressive:    { equity: 75, debt: 15, gold: 5,  real_estate: 5  }
};

async function educate({ riskProfile = "moderate", monthlyInvestable = 5000, goals = [], userId = "" }) {
    const allocation = ALLOCATION_MODELS[riskProfile] || ALLOCATION_MODELS.moderate;
    const breakdown  = Object.entries(allocation).map(([type, pct]) => ({
        type,
        ...INVESTMENT_TYPES[type],
        allocationPct:    pct + "%",
        monthlyAmount:    Math.round(monthlyInvestable * pct / 100),
        allocationLabel:  type.charAt(0).toUpperCase() + type.slice(1)
    }));

    let aiContent = null;
    try {
        const prompt = `Explain ${riskProfile} investment strategy for someone investing ₹${monthlyInvestable}/month with goals: ${goals.join(", ") || "wealth building"}.
JSON: { "strategyExplain": "...", "beginnerSteps": ["..."], "commonMistakes": ["..."], "timelineExpectation": "..." }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
        aiContent  = groq.parseJson(raw);
    } catch { /* template only */ }

    const plan = {
        id:               uid("inv"),
        userId,
        riskProfile,
        monthlyInvestable,
        allocation,
        breakdown,
        suggestedStart:   ["Open a Zerodha/Groww/Coin account", "Start with 1 index fund SIP", "Set up auto-debit on salary day", "Review portfolio every 6 months"],
        keyPrinciples:    ["Start early — time in market beats timing the market", "Diversify across asset classes", "Never invest borrowed money in equity", "Emergency fund first: 6 months expenses before investing"],
        aiContent,
        disclaimer:       FINANCE_DISCLAIMER,
        createdAt:        NOW()
    };

    logToMemory("investmentAdvisorAgent", `${userId}:${riskProfile}`, { monthlyInvestable });
    return plan;
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await educate({ riskProfile: p.riskProfile || p.risk || "moderate", monthlyInvestable: p.amount || p.monthly || 5000, goals: p.goals || [], userId: p.userId || "" });
        return ok("investmentAdvisorAgent", data, ["SIP > lump sum for beginners", "Time in market beats timing the market"]);
    } catch (err) { return fail("investmentAdvisorAgent", err.message); }
}

module.exports = { educate, INVESTMENT_TYPES, ALLOCATION_MODELS, run };
