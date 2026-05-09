/**
 * Commission Optimizer — analyzes affiliate performance and recommends rate adjustments.
 * Reads from affiliateAgent; applies rule-based + Groq analysis.
 */

const groq = require("../core/groqClient.cjs");
const { listAffiliates } = require("./affiliateAgent.cjs");
const { NOW } = require("./_store.cjs");

const SYSTEM = `You are a performance marketing expert analyzing affiliate commission structures.
Respond ONLY with valid JSON.`;

const RULES = [
    { id: "top_performer",  condition: a => a.totalSales >= 50 && a.commissionRate < 0.30, recommendation: "raise",  delta: +0.05, reason: "Top performer deserves higher rate to retain" },
    { id: "low_performer",  condition: a => a.totalSales < 3  && a.commissionRate > 0.15, recommendation: "lower",  delta: -0.05, reason: "Low activity — reduce rate to save margin" },
    { id: "dormant",        condition: a => a.totalSales === 0 && a.commissionRate > 0.10, recommendation: "lower",  delta: -0.05, reason: "No sales yet — set minimal rate until activation" },
    { id: "gold_push",      condition: a => a.totalSales >= 20 && a.totalSales < 30 && a.commissionRate < 0.25, recommendation: "raise", delta: +0.05, reason: "Close to Gold tier — incentivize with rate bump" }
];

function analyzeAffiliate(aff) {
    const triggers = RULES.filter(r => r.condition(aff));
    if (!triggers.length) return { affiliateId: aff.id, name: aff.name, currentRate: aff.commissionRate, recommendation: "maintain", reason: "Performance within normal range" };

    const dominant  = triggers[0];
    const newRate   = Math.min(0.40, Math.max(0.05, aff.commissionRate + dominant.delta));
    return { affiliateId: aff.id, name: aff.name, currentRate: aff.commissionRate, recommendedRate: newRate, recommendation: dominant.recommendation, reason: dominant.reason, triggers: triggers.map(t => t.id) };
}

async function optimize({ useAI = false } = {}) {
    const affiliates = listAffiliates();
    const analysis   = affiliates.map(analyzeAffiliate);
    const changes    = analysis.filter(a => a.recommendation !== "maintain");

    let aiInsights = null;
    if (useAI && affiliates.length) {
        try {
            const summary = affiliates.map(a => `${a.name}: ${a.totalSales} sales, rate=${(a.commissionRate * 100).toFixed(0)}%`).join("; ");
            const prompt  = `Affiliate data: ${summary}. Recommend commission optimization strategy.
JSON: { "strategy": "...", "topPerformerAdvice": "...", "retentionTips": ["..."], "projectedLift": "..." }`;
            const raw     = await groq.chat(SYSTEM, prompt, { maxTokens: 400 });
            aiInsights    = groq.parseJson(raw);
        } catch { /* skip */ }
    }

    return { totalAffiliates: affiliates.length, analysedAt: NOW(), recommendations: analysis, pendingChanges: changes.length, changes, aiInsights };
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await optimize({ useAI: p.useAI || false });
        return { success: true, type: "business_pro", agent: "commissionOptimizer", data };
    } catch (err) {
        return { success: false, type: "business_pro", agent: "commissionOptimizer", data: { error: err.message } };
    }
}

module.exports = { optimize, analyzeAffiliate, run };
