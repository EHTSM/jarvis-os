/**
 * Auto Posting Agent — wraps contentScheduler for safe multi-platform scheduling.
 * Enforces MAX 5 posts/day/platform. Does NOT reimplement scheduler logic.
 */

const contentScheduler = require("../content/contentScheduler.cjs");
const { canPost, recordPost, NOW, CAPS } = require("./_socialStore.cjs");

const PLATFORMS = ["instagram", "twitter", "linkedin", "youtube", "facebook", "tiktok"];

// Spread posts across the day to avoid burst patterns
function _nextSafeSlot(platform, offsetMinutes = 0) {
    const hour = new Date().getHours();
    // Prefer posting windows: 8-10am, 12-1pm, 5-7pm
    const windows = [{ h: 8 }, { h: 12 }, { h: 17 }, { h: 20 }];
    const upcoming = windows.find(w => w.h > hour) || { h: 8 }; // tomorrow 8am
    const base = new Date();
    if (upcoming.h <= hour) base.setDate(base.getDate() + 1);
    base.setHours(upcoming.h, offsetMinutes % 60, 0, 0);
    return base.toISOString();
}

async function schedulePost({ platform = "instagram", content, caption, hashtags = [], imagePrompt, scheduledAt, meta = {} }) {
    if (!PLATFORMS.includes(platform.toLowerCase())) throw new Error(`Unsupported platform: ${platform}`);
    if (!content && !caption) throw new Error("content or caption required");

    if (!canPost(platform)) {
        return {
            skipped: true,
            reason:  `Daily cap reached for ${platform} (max ${CAPS.maxPostsPerDayPerPlatform}/day)`,
            platform
        };
    }

    const slot   = scheduledAt || _nextSafeSlot(platform);
    const saved  = contentScheduler.add({ platform, content: content || caption, caption: caption || content, hashtags, imagePrompt, scheduledAt: slot, meta: { ...meta, scheduledBy: "autoPostingAgent" } });

    recordPost(platform);
    return { scheduled: true, platform, postId: saved.id, scheduledAt: slot, content: (content || caption).slice(0, 80) };
}

async function scheduleBatch(posts = []) {
    const results = [];
    for (let i = 0; i < posts.length; i++) {
        const offsetMin = i * 30; // 30 min apart per post in batch
        const p = posts[i];
        const result = await schedulePost({ ...p, scheduledAt: p.scheduledAt || _nextSafeSlot(p.platform || "instagram", offsetMin) });
        results.push(result);
    }
    const scheduled = results.filter(r => r.scheduled).length;
    const skipped   = results.filter(r => r.skipped).length;
    return { total: posts.length, scheduled, skipped, results };
}

function queueStatus() {
    return contentScheduler.stats();
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "auto_batch_post" && Array.isArray(p.posts)) {
            data = await scheduleBatch(p.posts);
        } else if (task.type === "auto_post_status") {
            data = queueStatus();
        } else {
            data = await schedulePost({ platform: p.platform || "instagram", content: p.content || p.caption || "", caption: p.caption, hashtags: p.hashtags || [], imagePrompt: p.imagePrompt, scheduledAt: p.scheduledAt, meta: p.meta || {} });
        }
        return { success: true, type: "social", agent: "autoPostingAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "autoPostingAgent", data: { error: err.message } };
    }
}

module.exports = { schedulePost, scheduleBatch, queueStatus, run };
