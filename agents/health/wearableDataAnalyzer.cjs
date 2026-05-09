"use strict";
const { load, flush, uid, NOW, ok, fail, accessLog } = require("./_healthStore.cjs");

const AGENT = "wearableDataAnalyzer";

const NORMAL_RANGES = {
    heartRateResting: { min: 60, max: 100, unit: "bpm", note: "Athletes may have 40-60 bpm naturally" },
    heartRateMax:     { min: null, max: null, unit: "bpm", formula: "220 - age" },
    spo2:             { min: 95, max: 100, unit: "%",  note: "Below 90% = emergency" },
    steps:            { min: 7000, max: null, unit: "steps/day", note: "10,000 is a popular but arbitrary goal; 7000+ linked to mortality benefit" },
    sleepTotal:       { min: 7, max: 9, unit: "hours", note: "Adults. Children need more." },
    sleepDeep:        { min: 1, max: 2, unit: "hours" },
    sleepREM:         { min: 1.5, max: 2.5, unit: "hours" },
    caloriesActive:   { min: 300, max: null, unit: "kcal", note: "Active calorie burn target" },
    bloodPressureSys: { min: 90, max: 120, unit: "mmHg" },
    bloodPressureDia: { min: 60, max: 80, unit: "mmHg" }
};

function analyzeData({ userId, data = {}, deviceType, date }) {
    if (!userId)         return fail(AGENT, "userId required");
    if (!Object.keys(data).length) return fail(AGENT, "data object required (e.g. { heartRateResting: 72, steps: 8000 })");

    accessLog(userId, AGENT, "wearable_data_analyzed", { deviceType });

    const insights   = [];
    const alerts     = [];
    const normal     = [];

    for (const [metric, value] of Object.entries(data)) {
        const range = NORMAL_RANGES[metric];
        if (!range) continue;

        const numVal = Number(value);
        if (isNaN(numVal)) continue;

        if (metric === "spo2" && numVal < 90) {
            alerts.push({ metric, value: numVal, severity: "HIGH", message: "⚠️ SpO2 below 90% — seek immediate medical attention" });
        } else if (metric === "spo2" && numVal < 95) {
            alerts.push({ metric, value: numVal, severity: "MEDIUM", message: "SpO2 below normal range — consult a doctor" });
        } else if (range.min !== null && numVal < range.min) {
            insights.push({ metric, value: numVal, status: "below_normal", normal: `${range.min}-${range.max || '∞'} ${range.unit}`, note: range.note || "" });
        } else if (range.max !== null && numVal > range.max) {
            insights.push({ metric, value: numVal, status: "above_normal", normal: `${range.min || '0'}-${range.max} ${range.unit}`, note: range.note || "" });
        } else {
            normal.push({ metric, value: numVal, status: "normal", unit: range.unit });
        }
    }

    const entry = {
        id:         uid("wd"),
        userId,
        deviceType: deviceType || "unknown",
        date:       date || NOW().slice(0, 10),
        data,
        insights, alerts, normal,
        analyzedAt: NOW()
    };

    const log = load(userId, "wearable_log", []);
    log.push(entry);
    flush(userId, "wearable_log", log.slice(-2000));

    return ok(AGENT, {
        summary:       { normal: normal.length, insights: insights.length, alerts: alerts.length },
        alerts,
        insights,
        normalMetrics: normal,
        normalRanges:  NORMAL_RANGES,
        tip:           "Wearable data complements — but does not replace — clinical measurements. Always verify concerning readings with a healthcare professional."
    }, { riskLevel: alerts.some(a => a.severity === "HIGH") ? "HIGH" : alerts.length ? "MEDIUM" : "LOW" });
}

function getWearableTrends({ userId, metric, days = 7 }) {
    if (!userId || !metric) return fail(AGENT, "userId and metric required");
    accessLog(userId, AGENT, "trends_viewed", { metric });

    const log    = load(userId, "wearable_log", []);
    const since  = Date.now() - days * 86400000;
    const recent = log.filter(l => new Date(l.date).getTime() > since && l.data[metric] !== undefined);
    const values = recent.map(l => ({ date: l.date, value: Number(l.data[metric]) }));
    const avg    = values.length ? +(values.reduce((s, v) => s + v.value, 0) / values.length).toFixed(1) : null;

    return ok(AGENT, { metric, period: `${days} days`, dataPoints: values, average: avg, range: NORMAL_RANGES[metric] || null });
}

module.exports = { analyzeData, getWearableTrends };
