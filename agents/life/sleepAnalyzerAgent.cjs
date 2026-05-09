/**
 * Sleep Analyzer Agent — analyze sleep patterns and give improvement tips.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER } = require("./_lifeStore.cjs");

const STORE = "sleep-log";

const SLEEP_STAGES = { light: 0.50, deep: 0.25, rem: 0.25 };

function _quality(hours, consistency) {
    if (hours >= 7 && hours <= 9 && consistency >= 0.8) return { score: 90, label: "Excellent" };
    if (hours >= 6 && hours <= 9 && consistency >= 0.6) return { score: 70, label: "Good" };
    if (hours >= 5 && consistency >= 0.4)                return { score: 50, label: "Fair" };
    return { score: 30, label: "Poor" };
}

function logSleep({ userId = "default", bedtime, wakeTime, quality = 3, notes = "" }) {
    if (!bedtime || !wakeTime) throw new Error("bedtime and wakeTime required");

    const [bh, bm] = bedtime.split(":").map(Number);
    const [wh, wm] = wakeTime.split(":").map(Number);
    let hours = (wh + wm / 60) - (bh + bm / 60);
    if (hours < 0) hours += 24;

    const entry = {
        id: uid("sleep"), userId, bedtime, wakeTime,
        duration: +hours.toFixed(1),
        quality, notes,
        estimated: {
            lightSleep: +(hours * SLEEP_STAGES.light).toFixed(1),
            deepSleep:  +(hours * SLEEP_STAGES.deep).toFixed(1),
            remSleep:   +(hours * SLEEP_STAGES.rem).toFixed(1)
        },
        loggedAt: NOW()
    };

    const all = load(STORE, []);
    all.push(entry);
    flush(STORE, all.slice(-200));
    logToMemory("sleepAnalyzerAgent", `sleep:${userId}`, { hours, quality });
    return entry;
}

function analyze(userId = "default", days = 14) {
    const since   = Date.now() - days * 86_400_000;
    const entries = load(STORE, []).filter(e => e.userId === userId && new Date(e.loggedAt).getTime() >= since);
    if (!entries.length) return { userId, message: "No sleep data yet.", empty: true };

    const avgHours   = +(entries.reduce((s, e) => s + e.duration, 0) / entries.length).toFixed(1);
    const avgQuality = +(entries.reduce((s, e) => s + e.quality, 0) / entries.length).toFixed(1);
    const bedtimes   = entries.map(e => parseInt(e.bedtime.split(":")[0]));
    const consistency = 1 - (Math.max(...bedtimes) - Math.min(...bedtimes)) / 24;
    const quality    = _quality(avgHours, consistency);

    return {
        userId, period: `${days} days`, nights: entries.length,
        avgHours, avgQuality, consistency: +(consistency * 100).toFixed(0) + "%",
        qualityScore: quality.score, qualityLabel: quality.label,
        recommendations: [
            avgHours < 7 ? "🛏️ You need more sleep. Try going to bed 30 min earlier." : "✅ Sleep duration looks good.",
            consistency < 0.7 ? "⏰ Inconsistent bedtime detected. Set a fixed sleep schedule." : "✅ Good bedtime consistency.",
            avgQuality < 3 ? "💡 Poor sleep quality. Reduce screen time 1hr before bed." : "✅ Sleep quality is acceptable.",
            "🌡️ Keep room temperature 18-21°C for best sleep.",
            "☕ Avoid caffeine after 2pm."
        ],
        disclaimer: HEALTH_DISCLAIMER
    };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "sleep_report") {
            data = analyze(p.userId || "default", p.days || 14);
        } else {
            data = logSleep({ userId: p.userId || "default", bedtime: p.bedtime || "22:00", wakeTime: p.wakeTime || "06:30", quality: p.quality || 3, notes: p.notes || "" });
        }
        return ok("sleepAnalyzerAgent", data, ["Consistent sleep time is the #1 sleep hack", "No screens 1hr before bed"]);
    } catch (err) { return fail("sleepAnalyzerAgent", err.message); }
}

module.exports = { logSleep, analyze, run };
