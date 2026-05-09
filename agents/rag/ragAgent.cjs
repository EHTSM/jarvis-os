/**
 * RAG Agent — Retrieval-Augmented Generation.
 *
 * Flow:
 *   input → contextRetriever (memory) + retrievalAgent (knowledge)
 *         → build enrichedInput string
 *         → return { enrichedInput, context, knowledgeHits, raw: input }
 *
 * enrichedInput is then passed into the planner/AI instead of raw input.
 */

const contextRetriever = require("../memory/contextRetriever.cjs");
const retrievalAgent   = require("../knowledge/retrievalAgent.cjs");

const MAX_CONTEXT_CHARS = 1200;  // keep enrichment concise so it doesn't bloat the prompt

/**
 * Retrieve context + knowledge and build an enriched input string.
 * @param {string} input  Raw user input
 * @returns {{ enrichedInput: string, context: Array, knowledgeHits: Array, raw: string }}
 */
async function process(input) {
    if (!input || input.trim().length === 0) {
        return { enrichedInput: input, context: [], knowledgeHits: [], raw: input };
    }

    // Parallel retrieval: memory + knowledge base
    const [contextHits, kbHits] = await Promise.all([
        Promise.resolve(contextRetriever.retrieve(input, { limit: 4 })),
        Promise.resolve(retrievalAgent.search(input, 3))
    ]);

    const parts = [];

    // Inject knowledge base hits first (factual grounding)
    if (kbHits.length > 0) {
        const kbLines = kbHits.map(h => `[FACT] ${h.key}: ${h.content}`).join("\n");
        parts.push(`--- Knowledge Base ---\n${kbLines}`);
    }

    // Inject relevant past memory
    const contextStr = contextRetriever.toPromptString(contextHits);
    if (contextStr) parts.push(contextStr);

    // Build enriched input
    let enrichedInput = input;
    if (parts.length > 0) {
        const prefix = parts.join("\n\n").slice(0, MAX_CONTEXT_CHARS);
        enrichedInput = `${prefix}\n\nCurrent request: ${input}`;
    }

    return {
        enrichedInput,
        context:       contextHits.map(h => h.entry),
        knowledgeHits: kbHits,
        raw:           input
    };
}

module.exports = { process };
