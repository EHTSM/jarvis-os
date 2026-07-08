/**
 * Growth Agent — suggests actions to increase revenue and engagement.
 * Reads live data from CRM, revenue, and analytics. Uses AI for custom suggestions.
 */

const { getLeads }  = require("../crm.cjs");
const revenueAgent  = require("./revenueAgent.cjs");
const analyticsAgent = require("./analyticsAgent.cjs");
const groq          = require("../core/groqClient.cjs");

const SYSTEM = `You are a business growth advisor for a SaaS/AI automation company.
Based on the business stats provided, give 5 specific, actionable growth suggestions.
Respond ONLY with JSON: { "suggestions": [{ "action": "...", "impact": "high|medium|low", "effort": "easy|medium|hard", "priority": 1-5 }] }`;

function _ruleBasedSuggestions(revenue, analytics, leads) {
    const suggestions = [];
    const rate = parseFloat(analytics.conversion_rate) || 0;
    const paid = leads.filter(l => l.status === "paid").length;
    const hot  = leads.filter(l => l.status === "hot").length;
    const newL = leads.filter(l => l.status === "new").length;

    if (rate < 5)  suggestions.push({ action: "Conversion rate is low — send personalized follow-up to hot leads via WhatsApp", impact: "high",   effort: "easy",   priority: 1 });
    if (hot > 0)   suggestions.push({ action: `${hot} hot leads haven't paid — create payment link and send now`, impact: "high",   effort: "easy",   priority: 1 });
    if (newL > 5)  suggestions.push({ action: `${newL} new leads are untouched — run a promo campaign immediately`, impact: "high",   effort: "easy",   priority: 2 });
    if (paid < 3)  suggestions.push({ action: "Fewer than 3 paid clients — focus on closing 1 client this week", impact: "high",   effort: "medium", priority: 2 });
    if (analytics.campaigns_sent === 0) suggestions.push({ action: "No campaigns sent — launch a WhatsApp campaign to re-engage leads", impact: "medium", effort: "easy",   priority: 3 });
    if (revenue.total_revenue_inr < 5000) suggestions.push({ action: "Revenue is low — offer a limited-time 30% discount to warm leads", impact: "high",   effort: "easy",   priority: 1 });

    suggestions.push({ action: "Post AI automation content on LinkedIn/Instagram daily for 7 days",  impact: "medium", effort: "medium", priority: 4 });
    suggestions.push({ action: "Add a clear pricing page to your website with Razorpay payment link", impact: "medium", effort: "medium", priority: 3 });

    return suggestions.slice(0, 5);
}

async function getSuggestions(useAI = false) {
    const [revResult, analyticsResult] = await Promise.all([
        revenueAgent.run({ type: "show_revenue", payload: {} }),
        analyticsAgent.run({ type: "analytics_stats", payload: {} })
    ]);

    const revenue   = revResult.data    || {};
    const analytics = analyticsResult.data || {};
    const leads     = getLeads();

    if (useAI) {
        const context = `Revenue: ₹${revenue.total_revenue_inr}, Monthly: ₹${revenue.monthly_revenue_inr}, Leads: ${leads.length}, Paid: ${revenue.paid_leads}, Conversion: ${analytics.conversion_rate}, Messages: ${analytics.messages_sent}`;
        try {
            const raw  = await groq.chat(SYSTEM, `Business stats: ${context}`);
            const data = groq.parseJson(raw);
            return { ...data, source: "ai", context };
        } catch {
            // Fall back to rule-based
        }
    }

    return { suggestions: _ruleBasedSuggestions(revenue, analytics, leads), source: "rules" };
}

async function run(task) {
    const p     = task.payload || {};
    const useAI = p.useAI !== false && !!process.env.GROQ_API_KEY;

    const data = await getSuggestions(useAI);
    return { success: true, type: "growthAgent", data };
}

module.exports = { run, getSuggestions };
