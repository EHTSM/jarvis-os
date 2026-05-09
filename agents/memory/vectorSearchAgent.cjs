/**
 * Vector Search Agent — finds semantically similar memories using TF-IDF cosine similarity.
 */

const memoryIndexer = require("./memoryIndexer.cjs");
const memoryStore   = require("./memoryStore.cjs");

/**
 * Search memory for entries similar to the query.
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{entry, score, source}>}
 */
function search(query, limit = 5) {
    if (!query || query.trim().length < 3) return [];

    const hits    = memoryIndexer.search(query, limit * 2);
    if (!hits.length) return [];

    // Fetch full entry objects from memoryStore
    const allEntries = memoryStore.all();
    const byId       = new Map(allEntries.map(e => [e.id, e]));

    return hits
        .map(h => ({ entry: byId.get(h.id), score: h.score, source: "vector" }))
        .filter(h => h.entry)
        .slice(0, limit);
}

/**
 * Index a new memory entry immediately after saving.
 */
function index(entry) {
    const text = `${entry.input || ""} ${entry.response || ""}`.trim();
    if (text) memoryIndexer.add(entry.id, text);
}

module.exports = { search, index };
