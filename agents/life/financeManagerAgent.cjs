/**
 * Finance Manager Agent — track income and expenses. General use only.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail, FINANCE_DISCLAIMER } = require("./_lifeStore.cjs");

const STORE = "finance-log";

const EXPENSE_CATEGORIES = ["food", "housing", "transport", "utilities", "entertainment", "health", "education", "clothing", "savings", "debt", "business", "other"];
const INCOME_CATEGORIES  = ["salary", "freelance", "business", "investment", "rental", "gift", "other"];

function addTransaction({ userId = "default", type, amount, category, description = "", date }) {
    if (!["income", "expense"].includes(type)) throw new Error("type must be 'income' or 'expense'");
    if (!amount || amount <= 0) throw new Error("amount must be > 0");

    const all = load(STORE, {});
    if (!all[userId]) all[userId] = [];

    const tx = { id: uid("tx"), userId, type, amount: +amount, category: category || "other", description, date: date || new Date().toDateString(), loggedAt: NOW() };
    all[userId].push(tx);
    flush(STORE, all);
    logToMemory("financeManagerAgent", `${userId}:${type}`, { amount, category });
    return tx;
}

function getSummary(userId = "default", month = null) {
    const all = load(STORE, {});
    let txs   = all[userId] || [];

    if (month) {
        txs = txs.filter(t => new Date(t.loggedAt).getMonth() + 1 === parseInt(month));
    } else {
        const since = Date.now() - 30 * 86_400_000;
        txs = txs.filter(t => new Date(t.loggedAt).getTime() >= since);
    }

    if (!txs.length) return { userId, message: "No transactions found.", empty: true };

    const income   = txs.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0);
    const expenses = txs.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
    const savings  = income - expenses;
    const rate     = income > 0 ? +((savings / income) * 100).toFixed(1) : 0;

    const byCategory = {};
    for (const t of txs.filter(t => t.type === "expense")) {
        byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
    }

    const breakdown = Object.entries(byCategory).map(([cat, amt]) => ({
        category: cat, amount: +amt.toFixed(2), pct: income > 0 ? +((amt / income) * 100).toFixed(0) + "%" : "—"
    })).sort((a, b) => b.amount - a.amount);

    const suggestions = [];
    if (rate < 0)  suggestions.push("🚨 You're spending more than earning. Cut non-essentials immediately.");
    if (rate < 20) suggestions.push("💡 Aim to save 20% of income (50/30/20 rule).");
    if ((byCategory.entertainment || 0) / income > 0.1) suggestions.push("📺 Entertainment is >10% of income — consider reducing.");
    suggestions.push("📊 Log every transaction — awareness is the first step to financial health.");

    return {
        userId,
        period:      month ? `Month ${month}` : "Last 30 days",
        income:      +income.toFixed(2),
        expenses:    +expenses.toFixed(2),
        savings:     +savings.toFixed(2),
        savingsRate: rate + "%",
        breakdown,
        transactions: txs.length,
        suggestions,
        disclaimer:   FINANCE_DISCLAIMER
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "finance_report") {
            data = getSummary(p.userId || "default", p.month || null);
        } else {
            data = addTransaction({ userId: p.userId || "default", type: p.type || "expense", amount: p.amount, category: p.category || "other", description: p.description || "", date: p.date });
        }
        return ok("financeManagerAgent", data, ["Automate savings on payday", "Track every rupee for 30 days"]);
    } catch (err) { return fail("financeManagerAgent", err.message); }
}

module.exports = { addTransaction, getSummary, EXPENSE_CATEGORIES, INCOME_CATEGORIES, run };
