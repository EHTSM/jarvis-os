/**
 * Memory Indexer — TF-IDF sparse vector engine.
 * No external dependencies. Pure JS cosine-similarity vector search.
 *
 * Index persisted to data/memory-index.json
 * Each document stored as { id, vector: { term: tfidfScore } }
 */

const fs   = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "../../data/memory-index.json");

const STOPWORDS = new Set([
    "a","an","the","is","it","in","on","at","to","of","and","or","but","for",
    "with","from","by","as","be","was","are","were","has","have","had","do",
    "does","did","will","would","can","could","may","might","shall","should",
    "not","no","so","if","then","than","that","this","these","those","what",
    "which","who","how","when","where","why","i","you","we","they","he","she",
    "my","your","our","their","its","me","him","her","us","them"
]);

// In-memory index: { entries: [{id, vector}], df: {term: count}, docCount: N }
let _idx = null;

function _load() {
    try {
        if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch { /* start fresh */ }
    return { entries: [], df: {}, docCount: 0 };
}

function _flush() {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(FILE, JSON.stringify(_idx));
    } catch (err) {
        console.error("[memoryIndexer] flush error:", err.message);
    }
}

function _index() {
    if (!_idx) _idx = _load();
    return _idx;
}

function _tokenize(text) {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function _tf(tokens) {
    const freq = {};
    for (const t of tokens) freq[t] = (freq[t] || 0) + 1;
    const max = Math.max(...Object.values(freq), 1);
    const tf = {};
    for (const [t, c] of Object.entries(freq)) tf[t] = c / max;
    return tf;
}

function _buildVector(tokens) {
    const idx = _index();
    const tf  = _tf(tokens);
    const N   = idx.docCount + 1;
    const vec = {};
    for (const [term, tfScore] of Object.entries(tf)) {
        const df  = idx.df[term] || 0;
        const idf = Math.log(1 + N / (df + 1));
        vec[term] = tfScore * idf;
    }
    return vec;
}

/**
 * Compute query vector without modifying the index (for search).
 */
function vectorize(text) {
    return _buildVector(_tokenize(text));
}

/**
 * Add a document to the index.
 * @param {string} id   Unique ID (memory entry id)
 * @param {string} text Text to index (input + response)
 */
function add(id, text) {
    const idx    = _index();
    const tokens = _tokenize(text);
    if (tokens.length === 0) return;

    // Update DF for new terms
    const unique = [...new Set(tokens)];
    for (const t of unique) idx.df[t] = (idx.df[t] || 0) + 1;
    idx.docCount++;

    // Build vector with updated DF
    const vec = _buildVector(tokens);
    idx.entries.push({ id, vector: vec });

    // Keep index size in sync with memoryStore limit
    if (idx.entries.length > 500) {
        const removed = idx.entries.shift();
        // Decrement DF for removed document's terms
        for (const term of Object.keys(removed.vector)) {
            if (idx.df[term]) idx.df[term] = Math.max(0, idx.df[term] - 1);
        }
        idx.docCount = Math.max(0, idx.docCount - 1);
    }

    _flush();
}

/**
 * Cosine similarity between two sparse vectors.
 */
function cosineSim(v1, v2) {
    let dot = 0, n1 = 0, n2 = 0;
    for (const [term, w] of Object.entries(v1)) {
        n1 += w * w;
        if (v2[term]) dot += w * v2[term];
    }
    for (const w of Object.values(v2)) n2 += w * w;
    if (!n1 || !n2) return 0;
    return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

/**
 * Search for top-K most similar entries.
 * @returns {Array<{id, score}>}
 */
function search(queryText, topK = 5) {
    const idx    = _index();
    const qVec   = vectorize(queryText);
    const scored = idx.entries.map(e => ({ id: e.id, score: cosineSim(qVec, e.vector) }));
    return scored
        .filter(e => e.score > 0.05)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

function stats() {
    const idx = _index();
    return { docCount: idx.docCount, uniqueTerms: Object.keys(idx.df).length, indexedEntries: idx.entries.length };
}

module.exports = { add, vectorize, cosineSim, search, stats };
