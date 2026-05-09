/**
 * Social Analytics Agent — tracks and reports social media performance.
 * Stores mock/manual metrics. Integrates with memory + learning system when available.
 */

const { load, flush, uid, NOW } = require("./_socialStore.cjs");

const STORE = "social-analytics";

const PLATFORMS = ["instagram", "twitter", "linkedin", "youtube", "facebook", "tiktok"];

function _store() { return load(STORE, { metrics: [], snapshots: [] }); }
function _save(d)  { flush(STORE, d); }

function recordMetrics({ platform, date, followers, posts, likes, comments, shares, reach, impressions, saves = 0 }) {
    if (!platform) throw new Error("platform required");
    const data = _store();
    const entry = {
        id:          uid("metric"),
        platform:    platform.toLowerCase(),
        date:        date || new Date().toDateString(),
        followers:   followers || 0,
        posts:       posts     || 0,
        likes:       likes     || 0,
        comments:    comments  || 0,
        shares:      shares    || 0,
        reach:       reach     || 0,
        impressions: impressions || 0,
        saves,
        engagementRate: followers > 0 ? (((likes + comments + shares) / followers) * 100).toFixed(2) + "%" : "0%",
        recordedAt:  NOW()
    };
    data.metrics.push(entry);
    if (data.metrics.length > 500) data.metrics.splice(0, data.metrics.length - 500);
    _save(data);
    return entry;
}

function getReport(platform = null, days = 30) {
    const data    = _store();
    const since   = Date.now() - days * 86_400_000;
    let metrics   = data.metrics.filter(m => new Date(m.recordedAt).getTime() >= since);
    if (platform) metrics = metrics.filter(m => m.platform === platform.toLowerCase());

    if (!metrics.length) return { platform, days, message: "No data yet. Record metrics first.", empty: true };

    const totalLikes    = metrics.reduce((s, m) => s + m.likes, 0);
    const totalComments = metrics.reduce((s, m) => s + m.comments, 0);
    const totalShares   = metrics.reduce((s, m) => s + m.shares, 0);
    const totalReach    = metrics.reduce((s, m) => s + m.reach, 0);
    const latest        = metrics[metrics.length - 1];
    const earliest      = metrics[0];
    const followerGrowth = latest.followers - earliest.followers;

    const platformBreakdown = {};
    for (const m of metrics) {
        if (!platformBreakdown[m.platform]) platformBreakdown[m.platform] = { posts: 0, likes: 0, comments: 0, reach: 0 };
        platformBreakdown[m.platform].posts++;
        platformBreakdown[m.platform].likes    += m.likes;
        platformBreakdown[m.platform].comments += m.comments;
        platformBreakdown[m.platform].reach    += m.reach;
    }

    return {
        platform: platform || "all",
        period:   `Last ${days} days`,
        summary: {
            totalPosts:      metrics.length,
            totalLikes,
            totalComments,
            totalShares,
            totalReach,
            followerGrowth: `+${followerGrowth}`,
            avgEngagement:  metrics.length ? (metrics.reduce((s, m) => s + parseFloat(m.engagementRate), 0) / metrics.length).toFixed(2) + "%" : "0%",
            bestDay:        metrics.sort((a, b) => (b.likes + b.comments) - (a.likes + a.comments))[0]?.date || "N/A"
        },
        platformBreakdown,
        generatedAt: NOW()
    };
}

function topPosts(limit = 5) {
    const data = _store();
    return data.metrics.sort((a, b) => (b.likes + b.comments + b.shares) - (a.likes + a.comments + a.shares)).slice(0, limit);
}

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        switch (task.type) {
            case "record_metrics":   data = recordMetrics(p); break;
            case "social_report":    data = getReport(p.platform, p.days || 30); break;
            case "top_posts":        data = { topPosts: topPosts(p.limit || 5) }; break;
            default:                 data = getReport(p.platform, 30);
        }
        return { success: true, type: "social", agent: "socialAnalyticsAgent", data };
    } catch (err) {
        return { success: false, type: "social", agent: "socialAnalyticsAgent", data: { error: err.message } };
    }
}

module.exports = { recordMetrics, getReport, topPosts, run };
