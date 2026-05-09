/**
 * Health Tracker Agent — tracks basic health metrics from manual input.
 * NO medical diagnosis. General wellness tracking only.
 */

const { load, flush, uid, NOW, logToMemory, ok, fail, HEALTH_DISCLAIMER } = require("./_lifeStore.cjs");

const STORE = "health-log";

const METRIC_RANGES = {
    weight:      { unit: "kg",    healthy: [50, 100],  label: "Weight" },
    steps:       { unit: "steps", healthy: [7000, 15000], label: "Daily Steps" },
    water:       { unit: "L",     healthy: [2, 3.5],   label: "Water Intake" },
    sleep:       { unit: "hrs",   healthy: [7, 9],     label: "Sleep Hours" },
    heartRate:   { unit: "bpm",   healthy: [60, 100],  label: "Resting Heart Rate" },
    calories:    { unit: "kcal",  healthy: [1500, 2500], label: "Calories" }
};

function _status(metric, value) {
    const range = METRIC_RANGES[metric];
    if (!range) return "recorded";
    return value < range.healthy[0] ? "below_target" : value > range.healthy[1] ? "above_target" : "on_track";
}

function logMetrics({ userId = "default", date, metrics = {} }) {
    const entry = {
        id:       uid("health"),
        userId,
        date:     date || new Date().toDateString(),
        metrics:  Object.entries(metrics).reduce((acc, [k, v]) => {
            acc[k] = { value: v, unit: METRIC_RANGES[k]?.unit || "", status: _status(k, v) };
            return acc;
        }, {}),
        loggedAt: NOW()
    };

    const all = load(STORE, []);
    all.push(entry);
    flush(STORE, all.slice(-500));
    logToMemory("healthTrackerAgent", `metrics:${userId}`, entry.metrics);
    return entry;
}

function getReport(userId = "default", days = 7) {
    const since   = Date.now() - days * 86_400_000;
    const entries = load(STORE, []).filter(e => e.userId === userId && new Date(e.loggedAt).getTime() >= since);

    if (!entries.length) return { userId, message: "No data yet. Log your first metrics.", empty: true };

    const summary = {};
    for (const entry of entries) {
        for (const [k, v] of Object.entries(entry.metrics)) {
            if (!summary[k]) summary[k] = { values: [], label: METRIC_RANGES[k]?.label || k, unit: v.unit };
            summary[k].values.push(v.value);
        }
    }

    const averages = Object.entries(summary).map(([k, v]) => ({
        metric:  k,
        label:   v.label,
        avg:     +(v.values.reduce((s, n) => s + n, 0) / v.values.length).toFixed(1),
        unit:    v.unit,
        status:  _status(k, v.values.reduce((s, n) => s + n, 0) / v.values.length),
        trend:   v.values.length >= 2 ? (v.values.at(-1) > v.values.at(-2) ? "↑" : "↓") : "—"
    }));

    return { userId, period: `${days} days`, entries: entries.length, averages, disclaimer: HEALTH_DISCLAIMER };
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "health_report") {
            data = getReport(p.userId || "default", p.days || 7);
        } else {
            data = logMetrics({ userId: p.userId || "default", date: p.date, metrics: p.metrics || { steps: p.steps, water: p.water, sleep: p.sleep, weight: p.weight, heartRate: p.heartRate, calories: p.calories } });
        }
        data.disclaimer = HEALTH_DISCLAIMER;
        return ok("healthTrackerAgent", data, ["Log daily for better insights", "Aim for all metrics in the healthy range"]);
    } catch (err) { return fail("healthTrackerAgent", err.message); }
}

module.exports = { logMetrics, getReport, METRIC_RANGES, run };
