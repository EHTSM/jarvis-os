/**
 * Trend Analyzer Agent — keyword frequency + growth scoring.
 * Works on:
 *   1. Provided text/array of texts (offline mode)
 *   2. Live Reddit + HN posts for a topic (live mode)
 *
 * Outputs: ranked keywords, trend score, rising/falling signal.
 */

const socialMedia = require("./socialMediaAgent.cjs");

const STOPWORDS = new Set([
    "a","an","the","is","it","in","on","at","to","of","and","or","but","for","with","from","by",
    "as","be","was","are","were","has","have","had","do","does","did","will","would","can","could",
    "not","no","so","if","then","i","you","we","they","he","she","my","your","this","that","which",
    "what","how","when","where","why","just","more","also","very","get","use","make","new","all",
    "one","two","need","want","like","than","over","up","its","our","their","about","been","into"
]);

function _tokenize(text) {
    return (text || "")
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, "")   // strip URLs
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function _tfidf(corpus) {
    const N  = corpus.length;
    const df = {};
    const tfMaps = corpus.map(doc => {
        const tokens = _tokenize(doc);
        const tf = {};
        for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
        for (const t of new Set(tokens)) df[t] = (df[t] || 0) + 1;
        return tf;
    });

    // Aggregate TF-IDF scores across corpus
    const scores = {};
    for (const tf of tfMaps) {
        for (const [term, freq] of Object.entries(tf)) {
            const idf = Math.log(1 + N / (df[term] || 1));
            scores[term] = (scores[term] || 0) + freq * idf;
        }
    }
    return scores;
}

function _bigrams(text) {
    const tokens = _tokenize(text);
    const bigrams = {};
    for (let i = 0; i < tokens.length - 1; i++) {
        const bg = `${tokens[i]} ${tokens[i + 1]}`;
        bigrams[bg] = (bigrams[bg] || 0) + 1;
    }
    return bigrams;
}

/**
 * Analyze keyword trends in a corpus of texts.
 * @param {string[]} texts
 * @param {number}   topN
 */
function analyzeCorpus(texts, topN = 20) {
    if (!texts?.length) return { keywords: [], bigrams: [], insight: "No content to analyze" };

    const scores  = _tfidf(texts);
    const bgMap   = {};
    for (const t of texts) {
        for (const [bg, c] of Object.entries(_bigrams(t))) {
            bgMap[bg] = (bgMap[bg] || 0) + c;
        }
    }

    const keywords = Object.entries(scores)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([term, score]) => ({ term, score: Math.round(score * 100) / 100 }));

    const bigrams = Object.entries(bgMap)
        .filter(([, c]) => c >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([phrase, count]) => ({ phrase, count }));

    const topTerms = keywords.slice(0, 5).map(k => k.term);
    const insight  = `Top trending terms: ${topTerms.join(", ")}. ${bigrams.length ? `Key phrases: ${bigrams.slice(0, 3).map(b => b.phrase).join(", ")}.` : ""}`;

    return { keywords, bigrams, insight, docCount: texts.length };
}

/**
 * Fetch live data for a topic from Reddit + HN and analyze trends.
 */
async function analyzeTopic(topic, limit = 15) {
    const [redditPosts, hnPosts] = await Promise.allSettled([
        socialMedia.fetch("reddit", topic, limit),
        socialMedia.fetch("hackernews", topic, Math.min(limit, 10))
    ]);

    const texts = [];
    if (redditPosts.status === "fulfilled") {
        for (const p of redditPosts.value) texts.push(p.title);
    }
    if (hnPosts.status === "fulfilled") {
        for (const p of hnPosts.value) texts.push(p.title);
    }

    const analysis  = analyzeCorpus(texts);
    const postCount = texts.length;

    // Trend score: based on count and keyword density
    const trendScore = Math.min(100, Math.round((postCount / limit) * 60 + (analysis.keywords.length / 20) * 40));

    return {
        topic,
        trendScore,
        signal: trendScore >= 70 ? "hot" : trendScore >= 40 ? "moderate" : "low",
        ...analysis,
        postCount,
        sources: ["reddit", "hackernews"]
    };
}

async function run(task) {
    const p     = task.payload || {};
    const topic = p.topic || p.query || task.input || "AI automation";
    const texts = p.texts;  // optional pre-supplied corpus

    try {
        const data = texts?.length
            ? { topic, ...analyzeCorpus(texts) }
            : await analyzeTopic(topic, p.limit || 15);
        return { success: true, source: "internet", type: "trendAnalyzerAgent", data };
    } catch (err) {
        return { success: false, source: "internet", type: "trendAnalyzerAgent", data: { error: err.message } };
    }
}

module.exports = { analyzeCorpus, analyzeTopic, run };
