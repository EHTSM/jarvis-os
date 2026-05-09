/**
 * Retrieval Agent — fetches the most relevant knowledge base entries for a query.
 * Used by ragAgent to inject factual grounding into prompts.
 */

const knowledgeBase = require("./knowledgeBase.cjs");

/**
 * Search the knowledge base for entries relevant to the query.
 * @param {string} query
 * @param {number} limit
 * @returns {Array<{key, content, category, score}>}
 */
function search(query, limit = 3) {
    if (!query || query.trim().length < 3) return [];
    return knowledgeBase.search(query, limit);
}

/**
 * Fetch a specific fact by exact key.
 */
function get(key) {
    return knowledgeBase.get(key);
}

/**
 * List all entries in a category.
 */
function listCategory(category) {
    return knowledgeBase.list(category);
}

/**
 * run(task) — agent-style interface for executorAgent integration.
 */
async function run(task) {
    const p     = task.payload || {};
    const query = p.query || p.question || task.input || "";
    const key   = p.key || null;

    if (key) {
        const entry = get(key);
        return entry
            ? { success: true, type: "retrievalAgent", data: { entry } }
            : { success: false, type: "retrievalAgent", data: { error: `Key "${key}" not found` } };
    }

    const results = search(query, p.limit || 5);
    return { success: true, type: "retrievalAgent", data: { results, count: results.length } };
}

module.exports = { search, get, listCategory, run };
