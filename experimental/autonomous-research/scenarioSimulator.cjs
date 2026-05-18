/**
 * Scenario Simulator — simulates best/base/worst outcomes before execution.
 * No real execution — purely analytical simulation.
 */

const groq = require("../core/groqClient.cjs");
const { uid, NOW, logToMemory, ok, fail } = require("./_autoStore.cjs");

const SYSTEM = `You are a strategic scenario planner. Simulate realistic business outcomes.
Use real-world probabilities. Respond ONLY with valid JSON.`;

function _calcROI(investment, revenue, months) {
    if (!investment || investment === 0) return "∞ (no capital required)";
    const roi = ((revenue * months - investment) / investment * 100).toFixed(0);
    return `${roi}%`;
}

function simulate(opportunity = {}) {
    const title    = opportunity.title       || "Business Idea";
    const capital  = opportunity.capitalNeeded === "None" ? 0 : opportunity.capitalNeeded === "Very Low" ? 500 : opportunity.capitalNeeded === "Low" ? 2000 : 10000;
    const timeline = parseInt(opportunity.timeline) || 3;

    const scenarios = {
        best: {
            label:          "Best Case (20% probability)",
            probability:    0.20,
            timeToRevenue:  `${Math.ceil(timeline * 0.6)} months`,
            monthlyRevenue: `₹${(80000).toLocaleString()}+`,
            customers:      50,
            roi:            _calcROI(capital, 80000, timeline),
            assumptions:    ["Strong product-market fit from day 1", "Viral word-of-mouth", "Low competition response"],
            risks:          ["Overconfidence", "Scaling too fast", "Underprepared infrastructure"]
        },
        base: {
            label:          "Base Case (60% probability)",
            probability:    0.60,
            timeToRevenue:  `${timeline} months`,
            monthlyRevenue: `₹${(25000).toLocaleString()}-₹${(50000).toLocaleString()}`,
            customers:      15,
            roi:            _calcROI(capital, 35000, timeline),
            assumptions:    ["Steady organic growth", "Normal market conditions", "2-3 iterations to product-market fit"],
            risks:          ["Slower-than-expected adoption", "Competitor response", "Pricing adjustments needed"]
        },
        worst: {
            label:          "Worst Case (20% probability)",
            probability:    0.20,
            timeToRevenue:  `${timeline + 3} months`,
            monthlyRevenue: "₹0-₹8,000",
            customers:      2,
            roi:            capital > 0 ? "-60%" : "0%",
            assumptions:    ["No product-market fit", "Strong incumbent competition", "Marketing fails to gain traction"],
            risks:          ["Capital loss", "Time sunk cost", "Team burnout"]
        }
    };

    const expectedValue = (
        80000 * 0.20 +
        35000 * 0.60 +
        2000  * 0.20
    ).toFixed(0);

    return {
        id:             uid("sim"),
        opportunity:    title,
        capitalRequired: `₹${capital.toLocaleString()}`,
        scenarios,
        expectedMonthlyRevenue: `₹${parseInt(expectedValue).toLocaleString()}`,
        recommendation: parseInt(expectedValue) > capital * 2 ? "PROCEED — positive expected value" : "RECONSIDER — expected value below 2× capital",
        simulatedAt:    NOW()
    };
}

async function simulateWithAI(opportunity = {}) {
    const baseResult = simulate(opportunity);

    let aiScenario = null;
    try {
        const prompt = `Simulate 3 scenarios (best/base/worst) for: "${opportunity.title || "business idea"}".
Timeline: ${opportunity.timeline || "3 months"}. Capital: ${opportunity.capitalNeeded || "Low"}.
JSON: { "keySuccessFactor": "...", "biggestThreat": "...", "pivotStrategy": "...", "monthsToBreakEven": "..." }`;
        const raw     = await groq.chat(SYSTEM, prompt, { maxTokens: 300 });
        aiScenario    = groq.parseJson(raw);
    } catch { /* base only */ }

    logToMemory("scenarioSimulator", opportunity.title, { expectedValue: baseResult.expectedMonthlyRevenue });
    return { ...baseResult, aiInsights: aiScenario };
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await simulateWithAI(p.opportunity || { title: p.goal || task.input || "SaaS business" });
        return ok("scenarioSimulator", data, ["Focus on base-case assumptions", "Plan for worst-case survival"]);
    } catch (err) { return fail("scenarioSimulator", err.message); }
}

module.exports = { simulate, simulateWithAI, run };
