/**
 * Semantic Search Agent — keyword + intent scoring over stored memory.
 * Complements vector search; excels at exact phrase and task-type matching.
 */

const memoryStore = require("./memoryStore.cjs");

// Intent → keywords mapping for boosting domain-relevant results
const INTENT_BOOSTS = [
    { intent: "code",     keywords: ["code","function","class","api","bug","error","fix","build","deploy","git"] },
    { intent: "payment",  keywords: ["payment","pay","invoice","razorpay","upi","subscription","plan","price"] },
    { intent: "leads",    keywords: ["lead","crm","contact","prospect","client","sales","pipeline","follow"] },
    { intent: "content",  keywords: ["post","content","write","blog","reel","caption","marketing","seo"] },
    { intent: "schedule", keywords: ["remind","schedule","tomorrow","cron","daily","weekly","at","pm","am"] },
    { intent: "browser",  keywords: ["open","search","google","youtube","website","url","browse"] },
    { intent: "voice",    keywords: ["speak","say","voice","tell","announce"] },
    { intent: "system",   keywords: ["time","date","memory","clear","health","status","monitor"] },
    { intent: "growth",   keywords: ["grow","revenue","analytics","campaign","conversion","funnel"] }
];

function _tokenSet(text) {
    return new Set(
        (text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2)
    );
}

function _score(entry, queryTokens, queryText) {
    const inputTokens    = _tokenSet(entry.input);
    const responseTokens = _tokenSet(entry.response);

    // Token overlap score
    let overlap = 0;
    for (const t of queryTokens) {
        if (inputTokens.has(t))    overlap += 1.5;  // input match weighted higher
        if (responseTokens.has(t)) overlap += 0.5;
    }

    // Intent boost
    const qLow = queryText.toLowerCase();
    let boost = 0;
    for (const { keywords } of INTENT_BOOSTS) {
        const hits = keywords.filter(kw => qLow.includes(kw) && entry.input.toLowerCase().includes(kw));
        boost += hits.length * 0.3;
    }

    // Task-type exact match bonus
    const qType = queryText.match(/\b(code|payment|lead|content|schedule|voice|system|growth)\b/i);
    if (qType && entry.taskType?.toLowerCase().includes(qType[1].toLowerCase())) boost += 1;

    // Recency boost (newer entries slightly preferred)
    const ageDays = (Date.now() - new Date(entry.timestamp).getTime()) / 86_400_000;
    const recency  = Math.max(0, 1 - ageDays / 30);  // linearly decays over 30 days

    const raw = overlap + boost + recency * 0.5;
    return raw / Math.max(queryTokens.size, 1);
}

/**
 * Semantic search over stored memory.
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{entry, score, source}>}
 */
function search(query, limit = 5) {
    if (!query || query.trim().length < 3) return [];

    const queryTokens = _tokenSet(query);
    const entries     = memoryStore.all();

    return entries
        .map(entry => ({ entry, score: _score(entry, queryTokens, query), source: "semantic" }))
        .filter(r => r.score > 0.1)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

module.exports = { search };
