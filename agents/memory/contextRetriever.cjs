/**
 * Context Retriever — fuses vector + semantic search results into a ranked context list.
 * Deduplicates by entry ID, combines scores, returns top-N.
 */

const vectorSearch   = require("./vectorSearchAgent.cjs");
const semanticSearch = require("./semanticSearchAgent.cjs");

/**
 * Retrieve most relevant past memory entries for a given query.
 * @param {string} query
 * @param {object} opts  { limit: number, minScore: number }
 * @returns {Array<{entry, score, sources}>}
 */
function retrieve(query, { limit = 5, minScore = 0.08 } = {}) {
    if (!query || query.trim().length < 3) return [];

    const vHits = vectorSearch.search(query, limit);
    const sHits = semanticSearch.search(query, limit);

    // Merge by entry ID, combine scores
    const merged = new Map();

    for (const h of vHits) {
        merged.set(h.entry.id, { entry: h.entry, vScore: h.score, sScore: 0, sources: ["vector"] });
    }
    for (const h of sHits) {
        if (merged.has(h.entry.id)) {
            const existing = merged.get(h.entry.id);
            existing.sScore = h.score;
            existing.sources.push("semantic");
        } else {
            merged.set(h.entry.id, { entry: h.entry, vScore: 0, sScore: h.score, sources: ["semantic"] });
        }
    }

    return [...merged.values()]
        .map(r => ({
            entry:   r.entry,
            score:   r.vScore * 0.6 + r.sScore * 0.4,  // vector weighted slightly higher
            sources: r.sources
        }))
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

/**
 * Format retrieved context as a prompt string for injection into Groq calls.
 */
function toPromptString(results) {
    if (!results.length) return "";
    const lines = results.map((r, i) => {
        const ts = new Date(r.entry.timestamp).toLocaleString();
        return `[Memory ${i + 1} | ${ts} | score:${r.score.toFixed(2)}]\nUser: ${r.entry.input}\nJarvis: ${(r.entry.response || "").slice(0, 200)}`;
    });
    return "--- Relevant Past Interactions ---\n" + lines.join("\n\n") + "\n--- End Memory ---";
}

module.exports = { retrieve, toPromptString };
