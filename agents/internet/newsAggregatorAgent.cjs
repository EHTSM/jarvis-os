/**
 * News Aggregator Agent — fetches latest news via RSS feeds.
 * No API key required. Uses curated public RSS feeds per topic.
 * Falls back to gnews.io (free tier) if GNEWS_API_KEY env is set.
 */

const RSSParser   = require("rss-parser");
const axios       = require("axios");
const rateLimiter = require("./_rateLimiter.cjs");

const parser = new RSSParser({ timeout: 8000, headers: { "User-Agent": "Mozilla/5.0 (compatible; JarvisBot/1.0)" } });

// Curated public RSS feeds per category (no login required)
const RSS_FEEDS = {
    tech:       "https://feeds.feedburner.com/TechCrunch",
    business:   "https://feeds.a.dj.com/rss/RSSBusinessNews.xml",
    startup:    "https://techcrunch.com/category/startups/feed/",
    ai:         "https://news.mit.edu/rss/topic/artificial-intelligence2",
    india:      "https://feeds.feedburner.com/ndtvnews-top-stories",
    world:      "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    finance:    "https://feeds.a.dj.com/rss/WSJcomUSBusiness.xml",
    general:    "https://feeds.bbci.co.uk/news/rss.xml"
};

// Category keywords for auto-detection
const CATEGORY_MAP = [
    { keywords: ["ai","machine learning","gpt","llm","openai","artificial"],        category: "ai" },
    { keywords: ["startup","venture","vc","funding","seed","series a"],             category: "startup" },
    { keywords: ["tech","software","developer","coding","app","cloud"],             category: "tech" },
    { keywords: ["india","delhi","mumbai","bangalore","rupee","inr","modi"],        category: "india" },
    { keywords: ["finance","stock","market","trading","investment","crypto","btc"], category: "finance" },
    { keywords: ["business","revenue","profit","sales","company","ceo"],            category: "business" },
    { keywords: ["world","global","international","war","politics"],                category: "world" }
];

function _detectCategory(query) {
    const q = (query || "").toLowerCase();
    for (const { keywords, category } of CATEGORY_MAP) {
        if (keywords.some(kw => q.includes(kw))) return category;
    }
    return "general";
}

async function _fetchRSS(feedUrl, limit = 8) {
    return rateLimiter.gate(feedUrl, async () => {
        const feed  = await parser.parseURL(feedUrl);
        return (feed.items || []).slice(0, limit).map(item => ({
            title:       item.title?.trim() || "",
            description: (item.contentSnippet || item.summary || "").slice(0, 200).trim(),
            link:        item.link || "",
            published:   item.pubDate || item.isoDate || "",
            source:      feed.title || ""
        }));
    });
}

async function _fetchGNews(query, limit = 8) {
    const key = process.env.GNEWS_API_KEY;
    if (!key) return null;
    const url = `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=en&max=${limit}&apikey=${key}`;
    const res = await rateLimiter.gate("gnews.io", () => axios.get(url, { timeout: 8000 }));
    return (res.data?.articles || []).map(a => ({
        title:       a.title,
        description: (a.description || "").slice(0, 200),
        link:        a.url,
        published:   a.publishedAt,
        source:      a.source?.name || "GNews"
    }));
}

/**
 * Fetch news articles for a topic or category.
 * @param {string} query  Topic / keywords
 * @param {number} limit  Max articles
 */
async function fetchNews(query = "technology", limit = 8) {
    // Try GNews API first (keyword-specific)
    try {
        const gnews = await _fetchGNews(query, limit);
        if (gnews?.length) return { articles: gnews, source: "gnews", query };
    } catch { /* fall through to RSS */ }

    // RSS fallback
    const category = _detectCategory(query);
    const feedUrl  = RSS_FEEDS[category] || RSS_FEEDS.general;
    const articles = await _fetchRSS(feedUrl, limit);
    return { articles, source: "rss", category, feedUrl, query };
}

async function run(task) {
    const p     = task.payload || {};
    const query = p.query || p.topic || p.keyword || task.input || "technology";
    const limit = Math.min(p.limit || 8, 15);

    try {
        const data = await fetchNews(query, limit);
        return { success: true, source: "internet", type: "newsAggregatorAgent", data };
    } catch (err) {
        return { success: false, source: "internet", type: "newsAggregatorAgent", data: { error: err.message, rateLimited: !!err.rateLimited } };
    }
}

module.exports = { fetchNews, run };
