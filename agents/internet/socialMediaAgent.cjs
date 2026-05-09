/**
 * Social Media Agent — fetches public social data safely.
 * Only accesses public, unauthenticated endpoints.
 * Returns mock/structured data where APIs are restricted.
 *
 * Real sources used:
 *   - Reddit public JSON API (no key needed)
 *   - Hacker News public API (no key needed)
 *   - Twitter/Instagram: mock (official APIs require OAuth — not safe to bypass)
 */

const axios       = require("axios");
const rateLimiter = require("./_rateLimiter.cjs");

const TIMEOUT_MS = 8000;
const UA         = "Mozilla/5.0 (compatible; JarvisBot/1.0)";

// ── Reddit ───────────────────────────────────────────────────────
async function _redditSearch(query, limit = 8) {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=hot&limit=${limit}`;
    const res = await rateLimiter.gate("reddit.com", () =>
        axios.get(url, { timeout: TIMEOUT_MS, headers: { "User-Agent": UA } })
    );
    return (res.data?.data?.children || []).map(c => ({
        platform:  "reddit",
        title:     c.data.title,
        score:     c.data.score,
        comments:  c.data.num_comments,
        subreddit: c.data.subreddit_name_prefixed,
        url:       `https://reddit.com${c.data.permalink}`,
        created:   new Date(c.data.created_utc * 1000).toISOString()
    }));
}

async function _redditSubreddit(subreddit, limit = 8) {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;
    const res = await rateLimiter.gate("reddit.com", () =>
        axios.get(url, { timeout: TIMEOUT_MS, headers: { "User-Agent": UA } })
    );
    return (res.data?.data?.children || []).map(c => ({
        platform:  "reddit",
        title:     c.data.title,
        score:     c.data.score,
        comments:  c.data.num_comments,
        url:       `https://reddit.com${c.data.permalink}`
    }));
}

// ── Hacker News ──────────────────────────────────────────────────
async function _hackerNewsTop(limit = 8) {
    const ids  = await rateLimiter.gate("hacker-news.firebaseio.com", () =>
        axios.get("https://hacker-news.firebaseio.com/v0/topstories.json", { timeout: TIMEOUT_MS })
    );
    const top  = ids.data.slice(0, limit);
    const items = await Promise.all(
        top.map(id =>
            axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: TIMEOUT_MS })
                 .then(r => r.data)
                 .catch(() => null)
        )
    );
    return items.filter(Boolean).map(i => ({
        platform: "hackernews",
        title:    i.title,
        score:    i.score,
        comments: i.descendants || 0,
        url:      i.url || `https://news.ycombinator.com/item?id=${i.id}`,
        created:  new Date(i.time * 1000).toISOString()
    }));
}

// ── Mock for restricted platforms ────────────────────────────────
function _mockSocial(platform, query) {
    return [{
        platform,
        note: `${platform} requires OAuth authentication. To enable: add ${platform.toUpperCase()}_BEARER_TOKEN to .env`,
        mockData: true,
        query,
        suggestion: `Search "${query}" on ${platform} manually or use their official API with credentials.`
    }];
}

/**
 * Fetch social data from a platform.
 * @param {string} platform   "reddit" | "hackernews" | "twitter" | "instagram"
 * @param {string} query      Search keyword or subreddit name
 * @param {number} limit
 */
async function fetch(platform, query = "ai automation", limit = 8) {
    switch (platform.toLowerCase()) {
        case "reddit":
            return query.startsWith("r/")
                ? _redditSubreddit(query.slice(2), limit)
                : _redditSearch(query, limit);
        case "hackernews":
        case "hn":
            return _hackerNewsTop(limit);
        case "twitter":
        case "instagram":
        case "linkedin":
            return _mockSocial(platform, query);
        default:
            return _redditSearch(query, limit);  // default to Reddit
    }
}

async function run(task) {
    const p        = task.payload || {};
    const platform = p.platform || "reddit";
    const query    = p.query || p.topic || task.input || "AI automation";
    const limit    = Math.min(p.limit || 8, 15);

    try {
        const posts = await fetch(platform, query, limit);
        return { success: true, source: "internet", type: "socialMediaAgent", data: { platform, query, posts } };
    } catch (err) {
        return { success: false, source: "internet", type: "socialMediaAgent", data: { error: err.message } };
    }
}

module.exports = { fetch, run };
