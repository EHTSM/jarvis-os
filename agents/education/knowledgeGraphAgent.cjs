/**
 * Knowledge Graph Agent — connects concepts into nodes + edges JSON for visual mapping.
 * Output is standard graph format compatible with D3.js, Cytoscape.js, or vis.js.
 */

const groq = require("../core/groqClient.cjs");
const { load, flush, uid, NOW, logToMemory, saveToKnowledge, ok, fail } = require("./_eduStore.cjs");

const SYSTEM = `You are a knowledge architecture expert. Map concepts into structured knowledge graphs.
Create clear relationships between ideas. Respond ONLY with valid JSON.`;

const STORE = "knowledge-graphs";

const RELATION_TYPES = ["is-a", "has-a", "uses", "extends", "depends-on", "contrasts-with", "leads-to", "part-of", "example-of", "prerequisite-of"];

function _buildFallbackGraph(topic, relatedTopics = []) {
    const centerId = uid("node");
    const nodes    = [{ id: centerId, label: topic, type: "core", level: 0, description: `Core concept: ${topic}` }];
    const edges    = [];

    const related  = relatedTopics.length ? relatedTopics : [`${topic} basics`, `${topic} applications`, `${topic} advanced`, `${topic} tools`, `Prerequisites for ${topic}`];

    related.forEach((rel, i) => {
        const nodeId   = uid("node");
        const relType  = RELATION_TYPES[i % RELATION_TYPES.length];
        nodes.push({ id: nodeId, label: rel, type: i < 2 ? "subtopic" : i < 4 ? "application" : "prerequisite", level: 1, description: `${relType} ${topic}` });
        edges.push({ id: uid("edge"), source: relType === "prerequisite-of" ? nodeId : centerId, target: relType === "prerequisite-of" ? centerId : nodeId, relation: relType, weight: 1 });

        // Add one sub-node per main node
        const subId = uid("node");
        nodes.push({ id: subId, label: `${rel} detail`, type: "detail", level: 2, description: `Specific aspect of ${rel}` });
        edges.push({ id: uid("edge"), source: nodeId, target: subId, relation: "has-a", weight: 0.5 });
    });

    return { nodes, edges };
}

async function buildGraph({ topic, relatedTopics = [], depth = 2, userId = "" }) {
    if (!topic) throw new Error("topic required");

    let graph;
    try {
        const prompt = `Build a knowledge graph for "${topic}".
Related topics: ${relatedTopics.join(", ") || "auto-generate"}. Depth: ${depth} levels.
JSON: {
  "nodes": [{ "id": "n1", "label": "...", "type": "core|subtopic|application|prerequisite|tool", "level": 0, "description": "..." }],
  "edges": [{ "id": "e1", "source": "n1", "target": "n2", "relation": "is-a|has-a|uses|extends|depends-on", "weight": 1.0 }],
  "clusters": [{ "id": "c1", "label": "cluster name", "nodeIds": ["n1","n2"] }]
}`;
        const raw = await groq.chat(SYSTEM, prompt, { maxTokens: 1200 });
        const ai  = groq.parseJson(raw);
        graph     = { nodes: ai.nodes || [], edges: ai.edges || [], clusters: ai.clusters || [] };
    } catch {
        const fallback = _buildFallbackGraph(topic, relatedTopics);
        graph = { ...fallback, clusters: [{ id: "c1", label: topic, nodeIds: fallback.nodes.slice(0, 3).map(n => n.id) }] };
    }

    // Compute stats
    const stats = {
        totalNodes:    graph.nodes.length,
        totalEdges:    graph.edges.length,
        coreNodes:     graph.nodes.filter(n => n.type === "core").length,
        maxDepth:      Math.max(...graph.nodes.map(n => n.level || 0)),
        density:       graph.nodes.length > 1 ? (graph.edges.length / (graph.nodes.length * (graph.nodes.length - 1))).toFixed(3) : 0
    };

    const graphDoc = {
        id:             uid("kg"),
        topic,
        depth,
        userId,
        ...graph,
        stats,
        renderHint:    "Compatible with D3.js, Cytoscape.js, and vis.js",
        d3Format: {
            links: graph.edges.map(e => ({ source: e.source, target: e.target, value: e.weight || 1 })),
            nodes: graph.nodes.map(n => ({ ...n, group: n.level || 0 }))
        },
        createdAt: NOW()
    };

    const all = load(STORE, []);
    all.push(graphDoc);
    flush(STORE, all.slice(-50));
    logToMemory("knowledgeGraphAgent", topic, { nodes: graph.nodes.length, edges: graph.edges.length });
    saveToKnowledge(`graph:${topic}`, `Knowledge graph: ${graph.nodes.length} concepts, ${graph.edges.length} relations`, "education");

    return graphDoc;
}

function getGraphs(userId) { return load(STORE, []).filter(g => !userId || g.userId === userId); }

async function run(task) {
    const p = task.payload || {};
    try {
        let data;
        if (task.type === "list_graphs") {
            data = { graphs: getGraphs(p.userId || "") };
        } else {
            data = await buildGraph({ topic: p.topic || task.input || "", relatedTopics: p.relatedTopics || p.related || [], depth: p.depth || 2, userId: p.userId || "" });
        }
        return ok("knowledgeGraphAgent", data, [`Explore ${data.stats?.totalNodes || 0} concept nodes`, "Use d3Format for D3.js visualization"]);
    } catch (err) { return fail("knowledgeGraphAgent", err.message); }
}

module.exports = { buildGraph, getGraphs, run };
