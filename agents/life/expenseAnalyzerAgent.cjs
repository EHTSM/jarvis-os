/**
 * Expense Analyzer Agent — categorize and analyze spending patterns.
 */

const groq = require("../core/groqClient.cjs");
const { load, uid, NOW, logToMemory, ok, fail, FINANCE_DISCLAIMER } = require("./_lifeStore.cjs");

const SYSTEM = `You are a financial analyst. Analyze spending patterns and give practical advice.
Respond ONLY with valid JSON.`;

// reuse financeManager's store
const STORE = "finance-log";

const RULE_50_30_20 = { needs: 0.50, wants: 0.30, savings: 0.20 };

const NEED_CATEGORIES   = ["housing", "food", "utilities", "transport", "health", "debt"];
const WANT_CATEGORIES   = ["entertainment", "clothing", "education", "other"];

function _classify(category) {
    if (NEED_CATEGORIES.includes(category)) return "needs";
    if (WANT_CATEGORIES.includes(category)) return "wants";
    return "savings";
}

async function analyze(userId = "default", days = 30) {
    const since = Date.now() - days * 86_400_000;
    const all   = load(STORE, {});
    const txs   = (all[userId] || []).filter(t => t.type === "expense" && new Date(t.loggedAt).getTime() >= since);

    if (!txs.length) return { userId, message: "No expense data.", empty: true };

    const totalExpenses = txs.reduce((s, t) => s + t.amount, 0);
    const income        = (all[userId] || []).filter(t => t.type === "income" && new Date(t.loggedAt).getTime() >= since).reduce((s, t) => s + t.amount, 0);

    const grouped = {};
    for (const t of txs) {
        const bucket = _classify(t.category);
        if (!grouped[bucket]) grouped[bucket] = { amount: 0, items: [] };
        grouped[bucket].amount += t.amount;
        grouped[bucket].items.push(t.category);
    }

    const buckets = Object.entries(grouped).map(([bucket, d]) => ({
        bucket,
        amount:  +d.amount.toFixed(2),
        pct:     totalExpenses > 0 ? +((d.amount / totalExpenses) * 100).toFixed(0) + "%" : "—",
        ideal:   (RULE_50_30_20[bucket] * 100) + "%",
        status:  income > 0 ? (d.amount / income <= RULE_50_30_20[bucket] ? "on_track" : "over_budget") : "unknown"
    }));

    const topSpend = Object.entries(
        txs.reduce((m, t) => { m[t.category] = (m[t.category] || 0) + t.amount; return m; }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([cat, amt]) => ({ category: cat, amount: +amt.toFixed(2) }));

    let aiAdvice = null;
    try {
        const prompt = `User spent ₹${totalExpenses.toFixed(0)} in ${days} days. Top categories: ${topSpend.map(s => `${s.category}:₹${s.amount}`).join(", ")}.
Income: ₹${income.toFixed(0)}.
JSON: { "diagnosis": "...", "quickWins": ["..."], "monthlyChallenge": "...", "savingsPotential": "₹..." }`;
        const raw  = await groq.chat(SYSTEM, prompt, { maxTokens: 300 });
        aiAdvice   = groq.parseJson(raw);
    } catch { /* template only */ }

    logToMemory("expenseAnalyzerAgent", `${userId}:analyze`, { totalExpenses, days });

    return {
        userId,
        period:       `${days} days`,
        totalExpenses: +totalExpenses.toFixed(2),
        income:        +income.toFixed(2),
        buckets,
        topSpend,
        aiAdvice,
        rule_50_30_20: RULE_50_30_20,
        disclaimer:    FINANCE_DISCLAIMER
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        const data = await analyze(p.userId || "default", p.days || 30);
        return ok("expenseAnalyzerAgent", data, ["Cut 1 subscription today", "Small leaks sink big ships"]);
    } catch (err) { return fail("expenseAnalyzerAgent", err.message); }
}

module.exports = { analyze, run };
