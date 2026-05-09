/**
 * Time Optimizer Agent — analyze time usage and suggest improvements.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail } = require("./_lifeStore.cjs");

const STORE = "time-log";

const CATEGORIES = ["deep-work", "shallow-work", "meetings", "breaks", "personal", "exercise", "learning", "admin", "social-media", "entertainment"];

const WASTERS = ["social-media", "entertainment"];
const HIGHVALUE = ["deep-work", "learning", "exercise"];

function logTime({ userId = "default", category, minutes, notes = "", date }) {
    if (!CATEGORIES.includes(category)) throw new Error(`Invalid category. Use: ${CATEGORIES.join(", ")}`);
    if (!minutes || minutes <= 0) throw new Error("minutes must be > 0");

    const all = load(STORE, {});
    if (!all[userId]) all[userId] = [];

    const entry = { id: uid("time"), userId, category, minutes, notes, date: date || new Date().toDateString(), loggedAt: NOW() };
    all[userId].push(entry);
    flush(STORE, all.slice ? all : all);
    flush(STORE, all);
    logToMemory("timeOptimizerAgent", `${userId}:${category}`, { minutes });
    return entry;
}

function analyze(userId = "default", days = 7) {
    const since   = Date.now() - days * 86_400_000;
    const all     = load(STORE, {});
    const entries = (all[userId] || []).filter(e => new Date(e.loggedAt).getTime() >= since);

    if (!entries.length) return { userId, message: "No time data. Start logging your hours.", empty: true };

    const totals = {};
    for (const e of entries) {
        totals[e.category] = (totals[e.category] || 0) + e.minutes;
    }

    const totalMin     = Object.values(totals).reduce((s, v) => s + v, 0);
    const breakdown    = Object.entries(totals).map(([cat, min]) => ({
        category: cat,
        minutes:  min,
        hours:    +(min / 60).toFixed(1),
        pct:      +((min / totalMin) * 100).toFixed(0) + "%",
        isWaster: WASTERS.includes(cat),
        isHighValue: HIGHVALUE.includes(cat)
    })).sort((a, b) => b.minutes - a.minutes);

    const wastedMin    = breakdown.filter(b => b.isWaster).reduce((s, b) => s + b.minutes, 0);
    const productiveMin= breakdown.filter(b => b.isHighValue).reduce((s, b) => s + b.minutes, 0);

    const suggestions = [];
    if (wastedMin / totalMin > 0.2) suggestions.push(`⚠️ ${Math.round(wastedMin / 60)}h on low-value activities. Try time-boxing social media to 30min/day.`);
    if (productiveMin / totalMin < 0.3) suggestions.push("📈 Less than 30% on high-value work. Schedule deep work first thing each morning.");
    if (!totals["exercise"]) suggestions.push("🏃 No exercise logged. Even 20 min/day improves focus by 20%.");
    if (!totals["learning"]) suggestions.push("📚 No learning logged. 30 min/day compounds into massive skill gains.");
    suggestions.push("⏱️ Track every hour this week — awareness alone reduces waste by 15-20%.");

    return { userId, period: `${days} days`, totalHours: +(totalMin / 60).toFixed(1), breakdown, productivity: +((productiveMin / totalMin) * 100).toFixed(0) + "%", wasteRatio: +((wastedMin / totalMin) * 100).toFixed(0) + "%", suggestions };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "time_report") {
            data = analyze(p.userId || "default", p.days || 7);
        } else {
            data = logTime({ userId: p.userId || "default", category: p.category || "deep-work", minutes: p.minutes, notes: p.notes || "", date: p.date });
        }
        return ok("timeOptimizerAgent", data, ["What gets measured gets managed", "Protect deep work hours like meetings"]);
    } catch (err) { return fail("timeOptimizerAgent", err.message); }
}

module.exports = { logTime, analyze, CATEGORIES, run };
