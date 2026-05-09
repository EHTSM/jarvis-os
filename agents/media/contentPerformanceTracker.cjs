"use strict";
const { load, flush, uid, NOW, ok, fail, trackEvent } = require("./_mediaStore.cjs");
const AGENT = "contentPerformanceTracker";

const METRIC_TYPES = {
    views:        { unit:"count",   goodGrowth:"+10%/week",  alarm:"<-20%/week" },
    watch_time:   { unit:"minutes", goodGrowth:"+5%/week",   alarm:"<-15%/week" },
    ctr:          { unit:"%",       goodGrowth:">4%",        alarm:"<2%" },
    avg_view_duration:{ unit:"%",   goodGrowth:">50%",       alarm:"<30%" },
    likes:        { unit:"count",   goodGrowth:"+5%/week",   alarm:"<-10%/week" },
    comments:     { unit:"count",   goodGrowth:"+5%/week",   alarm:"<-10%/week" },
    shares:       { unit:"count",   goodGrowth:"+5%/week",   alarm:"<-10%/week" },
    followers_gained:{ unit:"count",goodGrowth:"+1%/week",   alarm:"<0" },
    revenue:      { unit:"₹/$",     goodGrowth:"+10%/week",  alarm:"<-20%/week" },
    engagement_rate:{ unit:"%",     goodGrowth:">5%",        alarm:"<1%" }
};

function logMetrics({ userId, contentId, platform, date, metrics = {} }) {
    if (!userId || !contentId) return fail(AGENT, "userId and contentId required");
    trackEvent("performance_log", { userId, platform });

    const entry = {
        id:        uid("pm"),
        userId,
        contentId,
        platform,
        date:      date || NOW().slice(0,10),
        metrics,
        loggedAt:  NOW()
    };

    const log = load(userId, `perf_${contentId}`, []);
    log.push(entry);
    flush(userId, `perf_${contentId}`, log.slice(-365));

    return ok(AGENT, { entry });
}

function analysePerformance({ userId, contentId, days = 30 }) {
    if (!userId || !contentId) return fail(AGENT, "userId and contentId required");
    const log     = load(userId, `perf_${contentId}`, []);
    const cutoff  = new Date(Date.now() - days * 86400000).toISOString().slice(0,10);
    const recent  = log.filter(e => e.date >= cutoff);

    if (!recent.length) return ok(AGENT, { contentId, message: "No data in selected period", days });

    const latest  = recent[recent.length - 1]?.metrics || {};
    const earliest= recent[0]?.metrics || {};

    const analysis = Object.entries(METRIC_TYPES).map(([metric, meta]) => {
        const curr = latest[metric], prev = earliest[metric];
        const growth = curr && prev && prev !== 0 ? Math.round((curr - prev) / prev * 100) : null;
        const status = curr === undefined ? "no_data"
            : meta.goodGrowth.startsWith(">") ? (curr >= parseFloat(meta.goodGrowth.slice(1)) ? "good" : "below_target")
            : growth !== null ? (growth >= 10 ? "growing" : growth <= -20 ? "declining" : "stable") : "no_data";

        return { metric, unit: meta.unit, current: curr, growth: growth !== null ? `${growth > 0 ? "+" : ""}${growth}%` : "N/A", status, benchmark: meta.goodGrowth, alarm: meta.alarm };
    }).filter(a => a.current !== undefined);

    return ok(AGENT, { contentId, days, dataPoints: recent.length, analysis, topWins: analysis.filter(a => a.status === "growing" || a.status === "good").slice(0,3), topIssues: analysis.filter(a => a.status === "declining" || a.status === "below_target").slice(0,3) });
}

function comparePeriods({ userId, contentId, currentDays = 7, previousDays = 7 }) {
    if (!userId || !contentId) return fail(AGENT, "userId and contentId required");
    const log   = load(userId, `perf_${contentId}`, []);
    const now   = new Date();
    const cutCurrent  = new Date(now - currentDays * 86400000).toISOString().slice(0,10);
    const cutPrevious = new Date(now - (currentDays + previousDays) * 86400000).toISOString().slice(0,10);

    const current  = log.filter(e => e.date >= cutCurrent);
    const previous = log.filter(e => e.date >= cutPrevious && e.date < cutCurrent);

    const sumMetric = (entries, metric) => entries.reduce((s, e) => s + (e.metrics[metric] || 0), 0);

    const comparison = Object.keys(METRIC_TYPES).map(metric => {
        const curr = sumMetric(current, metric), prev = sumMetric(previous, metric);
        const change = prev ? Math.round((curr - prev) / prev * 100) : null;
        return { metric, current: curr, previous: prev, change: change !== null ? `${change > 0 ? "+" : ""}${change}%` : "N/A" };
    }).filter(c => c.current > 0 || c.previous > 0);

    return ok(AGENT, { contentId, currentPeriodDays: currentDays, previousPeriodDays: previousDays, comparison });
}

module.exports = { logMetrics, analysePerformance, comparePeriods };
