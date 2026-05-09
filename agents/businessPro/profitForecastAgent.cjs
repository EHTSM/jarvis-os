/**
 * Profit Forecast Agent — revenue - costs = profit estimate + 30/60/90 day forecast.
 * Reads from ecommerceManager for historical data.
 */

const groq = require("../core/groqClient.cjs");
const { listOrders, listProducts, stats } = require("./ecommerceManager.cjs");
const { NOW } = require("./_store.cjs");

const SYSTEM = `You are a financial analyst. Generate profit forecasts with realistic assumptions.
Respond ONLY with valid JSON.`;

const COST_RATIO  = 0.45; // default COGS = 45% of revenue
const OPEX_RATIO  = 0.20; // default opex = 20% of revenue
const GROWTH_RATE = 0.08; // 8% monthly growth assumption

function _revenueLast30() {
    const since  = Date.now() - 30 * 86_400_000;
    const orders = listOrders({ limit: 500 }).filter(o => new Date(o.createdAt).getTime() >= since && o.paymentStatus === "paid");
    return orders.reduce((s, o) => s + o.total, 0);
}

function _buildForecast(revenue30, cogsPct, opexPct, growthRate) {
    const costs30   = revenue30 * cogsPct;
    const opex30    = revenue30 * opexPct;
    const profit30  = revenue30 - costs30 - opex30;
    const margin30  = revenue30 > 0 ? ((profit30 / revenue30) * 100).toFixed(1) : "0.0";

    const r60 = revenue30 * (1 + growthRate);
    const r90 = r60       * (1 + growthRate);

    return {
        actual: {
            period: "last 30 days",
            revenue: Math.round(revenue30),
            cogs:    Math.round(costs30),
            opex:    Math.round(opex30),
            profit:  Math.round(profit30),
            margin:  `${margin30}%`
        },
        forecast: [
            { period: "next 30 days", revenue: Math.round(r60), profit: Math.round(r60 * (1 - cogsPct - opexPct)), growthRate: `${(growthRate * 100).toFixed(0)}%` },
            { period: "next 60 days", revenue: Math.round(r90), profit: Math.round(r90 * (1 - cogsPct - opexPct)), growthRate: `${(growthRate * 100).toFixed(0)}%` },
            { period: "next 90 days", revenue: Math.round(r90 * (1 + growthRate)), profit: Math.round(r90 * (1 + growthRate) * (1 - cogsPct - opexPct)), growthRate: `${(growthRate * 100).toFixed(0)}%` }
        ]
    };
}

async function forecast({ cogsPct = COST_RATIO, opexPct = OPEX_RATIO, growthRate = GROWTH_RATE, useAI = false } = {}) {
    const revenue30 = _revenueLast30();
    const base      = _buildForecast(revenue30, cogsPct, opexPct, growthRate);
    const eStats    = stats();

    let aiAnalysis = null;
    if (useAI && revenue30 > 0) {
        try {
            const prompt = `Revenue last 30 days: ₹${revenue30}. Products: ${eStats.products.total}. Orders: ${eStats.orders.total}.
COGS ratio: ${cogsPct}, OPEX ratio: ${opexPct}, growth: ${growthRate}.
Provide profit forecast analysis.
JSON: { "outlook": "positive|neutral|negative", "keyRisks": ["..."], "growthLevers": ["..."], "breakEvenRevenue": N, "recommendation": "..." }`;
            const raw    = await groq.chat(SYSTEM, prompt, { maxTokens: 500 });
            aiAnalysis   = groq.parseJson(raw);
        } catch { /* skip */ }
    }

    return {
        ...base,
        inputs: { cogsPct, opexPct, growthRate },
        storeStats: eStats,
        aiAnalysis,
        generatedAt: NOW()
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await forecast({ cogsPct: p.cogsPct || COST_RATIO, opexPct: p.opexPct || OPEX_RATIO, growthRate: p.growthRate || GROWTH_RATE, useAI: p.useAI || false });
        return { success: true, type: "business_pro", agent: "profitForecastAgent", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "profitForecastAgent", data: { error: err.message } };
    }
}

module.exports = { forecast, run };
