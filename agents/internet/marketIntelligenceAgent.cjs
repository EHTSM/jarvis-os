/**
 * Market Intelligence Agent — orchestrates news + trends + competitor signals
 * into a consolidated market insight report.
 */

const newsAggregator    = require("./newsAggregatorAgent.cjs");
const trendAnalyzer     = require("./trendAnalyzerAgent.cjs");
const competitorTracker = require("./competitorTrackerAgent.cjs");

/**
 * Generate a market intelligence report for a niche/topic.
 * @param {string}   topic           Market topic (e.g. "AI automation SaaS")
 * @param {string[]} competitorUrls  Optional competitor URLs to track
 */
async function analyze(topic, competitorUrls = []) {
    const startTime = Date.now();
    const sections  = [];
    const errors    = [];

    // 1. News
    let newsData = null;
    try {
        const n = await newsAggregator.fetchNews(topic, 8);
        newsData = n;
        sections.push("news");
    } catch (err) { errors.push({ section: "news", error: err.message }); }

    // 2. Trends (Reddit + HN)
    let trendData = null;
    try {
        const t = await trendAnalyzer.analyzeTopic(topic, 12);
        trendData = t;
        sections.push("trends");
    } catch (err) { errors.push({ section: "trends", error: err.message }); }

    // 3. Competitors (if URLs provided)
    let competitorData = null;
    if (competitorUrls.length > 0) {
        try {
            competitorData = await competitorTracker.trackMany(competitorUrls.slice(0, 3));
            sections.push("competitors");
        } catch (err) { errors.push({ section: "competitors", error: err.message }); }
    }

    // 4. Build insights
    const insights = _buildInsights(topic, newsData, trendData, competitorData);

    return {
        topic,
        generatedAt:  new Date().toISOString(),
        durationMs:   Date.now() - startTime,
        sectionsReady: sections,
        errors,
        news:         newsData,
        trends:       trendData,
        competitors:  competitorData,
        insights
    };
}

function _buildInsights(topic, news, trends, competitors) {
    const bullets = [];

    if (trends) {
        const signal = trends.signal || "unknown";
        const score  = trends.trendScore || 0;
        bullets.push(`📈 Trend signal for "${topic}": ${signal.toUpperCase()} (score: ${score}/100)`);
        if (trends.keywords?.length) {
            bullets.push(`🔑 Top keywords: ${trends.keywords.slice(0, 5).map(k => k.term).join(", ")}`);
        }
        if (trends.bigrams?.length) {
            bullets.push(`💬 Key phrases: ${trends.bigrams.slice(0, 3).map(b => b.phrase).join(" | ")}`);
        }
    }

    if (news?.articles?.length) {
        bullets.push(`📰 Latest news: "${news.articles[0]?.title}" (${news.source})`);
        bullets.push(`📊 ${news.articles.length} news articles found in the last 24–48 hours`);
    }

    if (competitors) {
        if (competitors.withChanges > 0) {
            bullets.push(`🔄 ${competitors.withChanges} competitor(s) updated recently — check for new features/pricing`);
        } else {
            bullets.push(`✅ No competitor changes detected since last scan`);
        }
    }

    if (bullets.length === 0) bullets.push(`No significant market signals detected for "${topic}" at this time`);

    return {
        bullets,
        summary: bullets.join("\n"),
        opportunityScore: _opportunityScore(trends, news)
    };
}

function _opportunityScore(trends, news) {
    let score = 50;
    if (trends?.trendScore)       score += Math.round((trends.trendScore - 50) * 0.4);
    if (news?.articles?.length)   score += Math.min(10, news.articles.length);
    return Math.min(100, Math.max(0, score));
}

async function run(task) {
    const p              = task.payload || {};
    const topic          = p.topic || p.query || task.input || "AI SaaS";
    const competitorUrls = p.competitors || p.urls || [];

    try {
        const data = await analyze(topic, competitorUrls);
        return { success: true, source: "internet", type: "marketIntelligenceAgent", data };
    } catch (err) {
        return { success: false, source: "internet", type: "marketIntelligenceAgent", data: { error: err.message } };
    }
}

module.exports = { analyze, run };
