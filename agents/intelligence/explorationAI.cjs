"use strict";
const { load, flush, uid, NOW, ok, fail, MAX_DEPTH, MAX_IDEAS } = require("./_intelligenceStore.cjs");
const AGENT = "explorationAI";

const ASSOCIATION_CHAINS = {
    technology: ["data → insight → decision → outcome → feedback → learning → improvement"],
    biology:    ["stimulus → perception → response → adaptation → evolution → emergence"],
    economics:  ["scarcity → incentive → behaviour → market → price → allocation → equilibrium"],
    physics:    ["energy → force → motion → work → transformation → conservation → entropy"],
    psychology: ["experience → emotion → cognition → belief → action → consequence → meaning"]
};

const EXPLORATION_STRATEGIES = [
    { name:"BFS (Breadth First)", desc:"Explore all immediate neighbours before going deeper — good for mapping a landscape" },
    { name:"DFS (Depth First)",   desc:"Follow one thread as deep as possible — good for finding root causes" },
    { name:"Random Walk",         desc:"Jump between concepts unpredictably — good for serendipitous discoveries" }
];

function _buildConceptGraph(concept, depth, maxDepth) {
    if (depth >= maxDepth) return { concept, children: [], depth };
    const associations = [
        `${concept} → causes → [downstream effect]`,
        `${concept} → enables → [new capability]`,
        `${concept} → conflicts with → [opposing force]`
    ].slice(0, MAX_IDEAS - depth);

    return {
        concept,
        depth,
        associations,
        children: depth < maxDepth - 1 ? [{
            concept:      `Deep exploration of "${concept}"`,
            depth:        depth + 1,
            associations: [`Core mechanism → amplified feedback → emergent property`],
            children:     []
        }] : []
    };
}

function explore({ userId, concept, strategy = "BFS", maxDepth = 2, domain = "technology" }) {
    if (!userId || !concept) return fail(AGENT, "userId and concept required");

    const safeDepth    = Math.min(maxDepth, MAX_DEPTH);
    const chain        = ASSOCIATION_CHAINS[domain] || ASSOCIATION_CHAINS.technology;
    const graph        = _buildConceptGraph(concept, 0, safeDepth);

    const discoveries  = [];
    let   depthReached = 0;

    function traverse(node) {
        if (node.depth >= safeDepth) return;
        depthReached = Math.max(depthReached, node.depth);
        discoveries.push({
            id:           uid("exp"),
            concept:      node.concept,
            depth:        node.depth,
            associations: node.associations,
            chainHint:    chain[0]
        });
        if (discoveries.length < MAX_IDEAS && node.children) {
            node.children.forEach(child => traverse(child));
        }
    }

    traverse(graph);

    const sessionId = uid("ea");
    const log = load(userId, "exploration_log", []);
    log.push({ sessionId, concept, domain, strategy, depth: depthReached, discoveries: discoveries.length, createdAt: NOW() });
    flush(userId, "exploration_log", log.slice(-500));

    return ok(AGENT, {
        sessionId, concept, domain, strategy,
        depthReached,
        discoveriesCount: discoveries.length,
        discoveries,
        associationChain: chain[0],
        safetyNote: `Exploration stopped at depth ${safeDepth} (max: ${MAX_DEPTH})`
    });
}

function getExplorationStrategies() {
    return ok(AGENT, {
        strategies:  EXPLORATION_STRATEGIES,
        domains:     Object.keys(ASSOCIATION_CHAINS),
        maxDepth:    MAX_DEPTH,
        maxIdeas:    MAX_IDEAS
    });
}

module.exports = { explore, getExplorationStrategies };
