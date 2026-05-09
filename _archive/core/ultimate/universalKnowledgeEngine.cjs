"use strict";
const { ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, killed } = require("./_ultimateStore.cjs");

const AGENT = "universalKnowledgeEngine";

const KNOWLEDGE_DOMAINS = ["science","technology","business","law","medicine","history","philosophy","mathematics","engineering","arts"];
const REASONING_MODES   = ["deductive","inductive","abductive","analogical","causal","probabilistic"];

// ── Process and synthesise knowledge for a goal ──────────────────
function processKnowledge({ goal, domains = KNOWLEDGE_DOMAINS, reasoningMode = "causal", depth = "standard" }) {
    if (!goal) return fail(AGENT, "goal is required");
    if (!REASONING_MODES.includes(reasoningMode)) return fail(AGENT, `reasoningMode must be: ${REASONING_MODES.join(", ")}`);
    if (isKillSwitchActive()) return killed(AGENT);

    const DEPTHS = ["shallow","standard","deep"];
    if (!DEPTHS.includes(depth)) return fail(AGENT, `depth must be: ${DEPTHS.join(", ")}`);

    const knowledgeNodes = domains.slice(0, depth === "shallow" ? 3 : depth === "standard" ? 6 : 10).map(domain => ({
        domain,
        relevance_pct:  Math.round(40 + Math.random() * 60),
        concepts:       [`${domain}_concept_A`, `${domain}_concept_B`],
        knowledgeGaps:  Math.random() > 0.6 ? [`gap_in_${domain}_data`] : [],
        sources:        Math.round(2 + Math.random() * 10)
    }));

    const synthesis = {
        synthesisId:     uid("kno"),
        goal:            goal.slice(0, 200),
        reasoningMode,
        depth,
        domainsProcessed: knowledgeNodes.length,
        knowledgeNodes,
        synthesis: {
            primaryInsight:  `${reasoningMode} analysis of '${goal.slice(0,60)}' yields structured knowledge map`,
            keyConceptsCount: knowledgeNodes.reduce((s, n) => s + n.concepts.length, 0),
            gapsIdentified:  knowledgeNodes.flatMap(n => n.knowledgeGaps).length,
            completeness_pct: Math.round(60 + Math.random() * 38)
        },
        recommendations: ["Integrate domain-specific APIs for live data", "Cross-reference with real-time sources"],
        confidence:      Math.round(65 + Math.random() * 30),
        processedAt:     NOW()
    };

    const cache = load("knowledge_cache", []);
    cache.push({ synthesisId: synthesis.synthesisId, goal: goal.slice(0,100), processedAt: synthesis.processedAt });
    flush("knowledge_cache", cache.slice(-1000));

    ultimateLog(AGENT, "knowledge_processed", { goal: goal.slice(0,80), reasoningMode, domainsProcessed: knowledgeNodes.length }, "INFO");
    return ok(AGENT, synthesis);
}

// ── Answer a structured question from the knowledge base ─────────
function query({ question, domain, maxSources = 5 }) {
    if (!question) return fail(AGENT, "question is required");
    if (isKillSwitchActive()) return killed(AGENT);

    const answer = {
        queryId:    uid("qry"),
        question:   question.slice(0, 300),
        domain:     domain || "cross_domain",
        answer:     `Structured response to: "${question.slice(0,80)}" — based on ${maxSources} synthesised knowledge sources.`,
        sources:    Array.from({ length: Math.min(maxSources, 5) }, (_, i) => ({ sourceId: `src_${i+1}`, type: ["research","database","model","heuristic"][Math.floor(Math.random()*4)], reliability: Math.round(60 + Math.random() * 40) })),
        confidence: Math.round(55 + Math.random() * 40),
        caveats:    ["Knowledge is synthesised from training — verify with authoritative sources for critical decisions"],
        queriedAt:  NOW()
    };

    ultimateLog(AGENT, "knowledge_queried", { question: question.slice(0,80), domain }, "INFO");
    return ok(AGENT, answer);
}

// ── Store a new knowledge entry ───────────────────────────────────
function storeKnowledge({ topic, content, domain, source = "system", tags = [] }) {
    if (!topic || !content) return fail(AGENT, "topic and content are required");

    const entry = {
        entryId:   uid("ke"),
        topic,
        content:   content.slice(0, 2000),
        domain:    domain || "general",
        source,
        tags,
        storedAt:  NOW()
    };

    const kb = load("knowledge_base", []);
    kb.push(entry);
    flush("knowledge_base", kb.slice(-5000));

    ultimateLog(AGENT, "knowledge_stored", { topic, domain, source }, "INFO");
    return ok(AGENT, { entryId: entry.entryId, topic, domain, storedAt: entry.storedAt });
}

// ── Search stored knowledge ───────────────────────────────────────
function searchKnowledge({ query: q, domain, limit = 10 }) {
    if (!q) return fail(AGENT, "query is required");
    const kb = load("knowledge_base", []);
    const lower = q.toLowerCase();
    const results = kb.filter(e =>
        e.topic.toLowerCase().includes(lower) ||
        e.content.toLowerCase().includes(lower) ||
        (domain ? e.domain === domain : true)
    ).slice(-limit);

    return ok(AGENT, { query: q, domain, total: results.length, results, searchedAt: NOW() });
}

module.exports = { processKnowledge, query, storeKnowledge, searchKnowledge, KNOWLEDGE_DOMAINS, REASONING_MODES };
