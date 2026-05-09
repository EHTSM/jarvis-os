/**
 * Social Scheduler Pro — multi-platform scheduling layer on top of contentScheduler.
 * EXTENDS contentScheduler (does NOT reimplement it).
 * Adds: multi-platform batching, optimal time selection, cross-platform series.
 */

const contentScheduler = require("../content/contentScheduler.cjs");
const { canPost, recordPost, CAPS, NOW } = require("./_socialStore.cjs");
const { BEST_TIMES } = require("./engagementBoosterAgent.cjs");

const PLATFORMS = ["instagram", "twitter", "linkedin", "youtube", "facebook", "tiktok"];

function _nextOptimalTime(platform, offsetDays = 0) {
    const times   = BEST_TIMES[platform.toLowerCase()]?.weekdays || ["12:00pm"];
    const timeStr = times[Math.floor(Math.random() * times.length)];
    const [hRaw, period] = timeStr.split(":");
    let hour = parseInt(hRaw, 10);
    const min  = parseInt((period || "0").replace(/[^0-9]/g, "") || "0", 10);
    if (/pm/i.test(timeStr) && hour !== 12) hour += 12;
    if (/am/i.test(timeStr) && hour === 12) hour = 0;

    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    d.setHours(hour, min, 0, 0);
    if (d <= new Date()) d.setDate(d.getDate() + 1);
    return d.toISOString();
}

/**
 * Schedule the same content across multiple platforms at optimal times.
 */
async function crossPost({ content, caption, hashtags = [], platforms = ["instagram"], imagePrompt, meta = {} }) {
    const results = [];
    let dayOffset  = 0;

    for (const platform of platforms) {
        if (!PLATFORMS.includes(platform.toLowerCase())) {
            results.push({ platform, skipped: true, reason: "Unsupported platform" });
            continue;
        }
        if (!canPost(platform)) {
            results.push({ platform, skipped: true, reason: `Daily cap reached (${CAPS.maxPostsPerDayPerPlatform}/day)` });
            continue;
        }
        const scheduledAt = _nextOptimalTime(platform, dayOffset);
        try {
            const saved = contentScheduler.add({ platform, content: content || caption, caption: caption || content, hashtags, imagePrompt, scheduledAt, meta: { ...meta, crossPosted: true, scheduledBy: "socialSchedulerPro" } });
            recordPost(platform);
            results.push({ platform, postId: saved.id, scheduledAt, success: true });
        } catch (err) {
            results.push({ platform, error: err.message, success: false });
        }
        dayOffset++; // Stagger across days to avoid burst
    }

    return { crossPost: true, platforms: platforms.length, scheduled: results.filter(r => r.success).length, skipped: results.filter(r => r.skipped).length, results };
}

/**
 * Build a content series (e.g. 7-day series across one platform).
 */
async function scheduleSeries({ platform = "instagram", contentItems = [], startDate = null, daysBetween = 1, meta = {} }) {
    if (!contentItems.length) throw new Error("contentItems array required");
    const results = [];
    const start   = startDate ? new Date(startDate) : new Date();

    for (let i = 0; i < contentItems.length; i++) {
        const item = contentItems[i];
        if (!canPost(platform)) {
            results.push({ index: i, skipped: true, reason: "Daily cap reached" });
            continue;
        }
        const d = new Date(start);
        d.setDate(d.getDate() + i * daysBetween);
        const [h, period] = (_nextOptimalTime(platform, 0).split("T")[1] || "12:00:00").split(":");
        d.setHours(parseInt(h, 10), parseInt(period || "0", 10), 0, 0);

        try {
            const saved = contentScheduler.add({ platform, content: item.content || item.caption || item, caption: item.caption || item.content || String(item), hashtags: item.hashtags || [], scheduledAt: d.toISOString(), meta: { ...meta, seriesIndex: i, scheduledBy: "socialSchedulerPro" } });
            recordPost(platform);
            results.push({ index: i, postId: saved.id, scheduledAt: d.toISOString(), success: true });
        } catch (err) {
            results.push({ index: i, error: err.message, success: false });
        }
    }

    return { series: true, platform, total: contentItems.length, scheduled: results.filter(r => r.success).length, results };
}

function getQueue(platform = null) {
    const all = contentScheduler.list({ status: "pending" });
    if (platform) return all.filter(p => p.platform === platform.toLowerCase());
    return all;
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        switch (task.type) {
            case "cross_post":       data = await crossPost(p); break;
            case "schedule_series":  data = await scheduleSeries(p); break;
            case "social_queue":     data = { queue: getQueue(p.platform) }; break;
            case "social_stats":     data = contentScheduler.stats(); break;
            default:                 data = p.platforms ? await crossPost(p) : await scheduleSeries(p);
        }
        return { success: true, type: "social", agent: "socialSchedulerPro", data };
    } catch (err) {
        return { success: false, type: "social", agent: "socialSchedulerPro", data: { error: err.message } };
    }
}

module.exports = { crossPost, scheduleSeries, getQueue, run };
