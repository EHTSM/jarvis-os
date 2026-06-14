"use strict";
/**
 * SemanticMemorySearch — typed memory taxonomy + TF-IDF semantic search.
 *
 * Builds on memoryPersistenceLayer (save/list/update) to add:
 *   - Four typed memory schemas: failure | success | decision | knowledge
 *   - TF-IDF cosine-similarity search across all active memory nodes
 *   - Type-scoped convenience searches
 *   - Cross-project search with results grouped by projectId
 *   - Knowledge-graph construction (nodes + similarity edges)
 *   - Knowledge evolution (upgrades low-confidence but high-recurrence nodes)
 *
 * Public API:
 *   saveTypedMemory(type, data, opts)     → { nodeId, saved, type }
 *   semanticSearch(query, opts)           → { results[], query, total }
 *   searchFailures(pattern, opts)         → { results[], total }
 *   searchSuccesses(pattern, opts)        → { results[], total }
 *   searchDecisions(context, opts)        → { results[], total }
 *   crossProjectSearch(query, opts)       → { byProject: { [projectId]: results[] }, total }
 *   getKnowledgeGraph(opts)               → { nodes[], edges[], edgeCount }
 *   evolveKnowledge(opts)                 → { evolved[], count }
 */

const logger = require("../utils/logger");

// Lazy-require to avoid circular-require issues at load time
function _mpl() { return require("./memoryPersistenceLayer.cjs"); }

// ────────────────────────────────────────────────────────────────────────────
// SECTION 1 — Memory Taxonomy Schemas
// ────────────────────────────────────────────────────────────────────────────

/**
 * Required fields and defaults per typed memory category.
 * Each entry describes:
 *   required   — field names that MUST be present in `data`
 *   defaults   — fallback values for optional taxonomy fields
 *   tag        — auto-applied tag when saving
 *   valueShape — function(data) → the object stored in node.value
 */
const TAXONOMY = {
  failure: {
    required: ["errorType", "context", "resolution"],
    tag: "failure",
    defaults: { recurrenceCount: 1 },
    valueShape(data) {
      return {
        errorType:       data.errorType,
        context:         data.context,
        resolution:      data.resolution,
        recurrenceCount: data.recurrenceCount ?? 1,
      };
    },
  },

  success: {
    required: ["pattern", "appliedTo", "outcome"],
    tag: "success",
    defaults: { reusabilityScore: 50 },
    valueShape(data) {
      return {
        pattern:          data.pattern,
        appliedTo:        data.appliedTo,
        outcome:          data.outcome,
        reusabilityScore: data.reusabilityScore ?? 50,
      };
    },
  },

  decision: {
    required: ["decision", "rationale", "outcome"],
    tag: "decision",
    defaults: { alternatives: [], confidence: 70 },
    valueShape(data) {
      return {
        decision:     data.decision,
        rationale:    data.rationale,
        alternatives: Array.isArray(data.alternatives) ? data.alternatives : [],
        outcome:      data.outcome,
        confidence:   data.confidence ?? 70,
      };
    },
  },

  knowledge: {
    required: ["insight"],
    tag: "knowledge",
    defaults: {},
    valueShape(data) {
      return {
        insight:    data.insight,
        sourceType: data.sourceType || "cross-project",
        learnedAt:  data.learnedAt  || new Date().toISOString(),
        ...(data.extra ? { extra: data.extra } : {}),
      };
    },
  },
};

// ────────────────────────────────────────────────────────────────────────────
// SECTION 2 — TF-IDF Engine (pure JS, no external deps)
// ────────────────────────────────────────────────────────────────────────────

// Common English stop-words filtered during tokenisation
const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","is","are","was","were","be","been","being","have","has",
  "had","do","does","did","will","would","could","should","may","might",
  "shall","can","this","that","these","those","it","its","i","we","you",
  "he","she","they","them","their","what","which","who","whom","not","no",
  "as","if","so","then","than","into","about","up","out","over","under",
  "more","less","just","also","only","very","too","how","all","any","each",
]);

/**
 * Tokenise a string into clean lowercase terms.
 * Splits on non-alphanumeric boundaries, discards short tokens and stop-words.
 */
function _tokenise(text) {
  if (!text) return [];
  const raw = typeof text === "string" ? text : JSON.stringify(text);
  return raw
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

/**
 * Extract a flat text blob from a memory node (key + value fields).
 * The value may be a plain object; we stringify it.
 */
function _nodeText(node) {
  const parts = [node.key || ""];
  if (node.value) {
    if (typeof node.value === "string") {
      parts.push(node.value);
    } else {
      // Flatten object values — iterate one level deep for legibility
      const v = node.value;
      for (const k of Object.keys(v)) {
        const fv = v[k];
        if (typeof fv === "string" || typeof fv === "number") {
          parts.push(String(fv));
        } else if (Array.isArray(fv)) {
          parts.push(fv.join(" "));
        }
      }
    }
  }
  if (Array.isArray(node.tags)) parts.push(...node.tags);
  return parts.join(" ");
}

/**
 * Build term-frequency vector for a token list.
 * Returns Map<term, tf> where tf = count / total (relative).
 */
function _tf(tokens) {
  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
  const total = tokens.length || 1;
  for (const [t, c] of freq) freq.set(t, c / total);
  return freq;
}

/**
 * Build inverse-document-frequency map from a corpus of token arrays.
 * idf(t) = log(N / (df(t) + 1)) + 1   (smoothed)
 */
function _idf(corpus) {
  const N  = corpus.length || 1;
  const df = new Map();
  for (const tokens of corpus) {
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const idfMap = new Map();
  for (const [t, docFreq] of df) {
    idfMap.set(t, Math.log(N / (docFreq + 1)) + 1);
  }
  return idfMap;
}

/**
 * Compute TF-IDF vector for a set of tokens given a pre-built IDF map.
 * Returns Map<term, tfidf_weight>
 */
function _tfidfVector(tokens, idfMap) {
  const tfMap = _tf(tokens);
  const vec   = new Map();
  for (const [t, tf] of tfMap) {
    const idfVal = idfMap.get(t) || (Math.log(1) + 1); // unknown term → low idf
    vec.set(t, tf * idfVal);
  }
  return vec;
}

/**
 * Cosine similarity between two Map<term, weight> vectors.
 * Returns value in [0, 1].
 */
function _cosine(vecA, vecB) {
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (const [t, wa] of vecA) {
    dot  += wa * (vecB.get(t) || 0);
    magA += wa * wa;
  }
  for (const [, wb] of vecB) {
    magB += wb * wb;
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Run TF-IDF semantic search against a node array.
 * Returns nodes sorted by cosine score descending, filtered by minScore.
 */
function _tfidfSearch(query, nodes, { minScore = 0.1, limit = 20 } = {}) {
  if (!nodes.length) return [];

  // Build corpus: each node contributes one document
  const corpus = nodes.map(n => _tokenise(_nodeText(n)));
  const queryTokens = _tokenise(query);

  if (!queryTokens.length) return [];

  // Build IDF from corpus including query as a ghost document
  const idfMap = _idf([...corpus, queryTokens]);

  // Query vector
  const queryVec = _tfidfVector(queryTokens, idfMap);

  // Score each node
  const scored = nodes.map((node, idx) => {
    const docVec = _tfidfVector(corpus[idx], idfMap);
    const score  = _cosine(queryVec, docVec);
    return { node, score };
  });

  return scored
    .filter(s => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => ({ ...s.node, _semanticScore: parseFloat(s.score.toFixed(4)) }));
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 3 — saveTypedMemory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Save a typed memory node with taxonomy validation and auto-tagging.
 *
 * @param {string} type  "failure" | "success" | "decision" | "knowledge"
 * @param {object} data  Fields required by the type's schema (see TAXONOMY)
 * @param {object} opts  Optional overrides: key, importance, confidence, agentIds, projectId, tags
 * @returns {{ nodeId, saved, type }}
 */
function saveTypedMemory(type, data, opts = {}) {
  const schema = TAXONOMY[type];
  if (!schema) {
    throw new Error(
      `Unknown memory type "${type}". Valid types: ${Object.keys(TAXONOMY).join(", ")}`
    );
  }

  // Validate required fields
  const missing = schema.required.filter(f => data[f] === undefined || data[f] === null || data[f] === "");
  if (missing.length) {
    throw new Error(
      `saveTypedMemory("${type}") missing required fields: ${missing.join(", ")}`
    );
  }

  const mpl = _mpl();

  // Build auto key from type + primary identifier field
  const primaryField = schema.required[0];
  const autoKey = opts.key
    || `${type}:${String(data[primaryField]).slice(0, 80)}`;

  // Merge caller tags with the type tag
  const baseTags = Array.isArray(opts.tags) ? opts.tags : [];
  const typeTags = [schema.tag, type];
  if (opts.projectId) typeTags.push(`project:${opts.projectId}`);
  const tags = Array.from(new Set([...baseTags, ...typeTags]));

  const node = {
    key:        autoKey,
    value:      schema.valueShape(data),
    type:       "insight",              // persistence-layer type stays "insight"
    tags,
    importance: opts.importance  ?? 60,
    confidence: opts.confidence  ?? 75,
    agentIds:   opts.agentIds    || [],
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
  };

  const result = mpl.save(node);
  logger.info(`[SemanticMem] saveTypedMemory type=${type} nodeId=${result.nodeId}`);
  return { ...result, type };
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 4 — semanticSearch (core)
// ────────────────────────────────────────────────────────────────────────────

/**
 * TF-IDF cosine-similarity search across all (or filtered) memory nodes.
 *
 * @param {string} query  Natural-language query string
 * @param {object} opts
 *   type      — restrict to nodes with this tag (e.g. "failure")
 *   minScore  — minimum cosine similarity (default 0.1)
 *   limit     — max results (default 20)
 *   projectId — restrict to this projectId tag
 * @returns {{ results[], query, total }}
 */
function semanticSearch(query, opts = {}) {
  const { type, minScore = 0.1, limit = 20, projectId } = opts;
  const mpl = _mpl();

  // Fetch nodes — use tag filter if type given
  const fetchOpts = { limit: 5000 };
  if (type) fetchOpts.tag = type;

  let { nodes } = mpl.list(fetchOpts);

  // Secondary filter by projectId (stored as tag "project:<id>")
  if (projectId) {
    const ptag = `project:${projectId}`;
    nodes = nodes.filter(n => (n.tags || []).includes(ptag) || n.projectId === projectId);
  }

  const results = _tfidfSearch(query, nodes, { minScore, limit });

  return {
    results,
    query,
    total: results.length,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 5 — Type-Scoped Search Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Semantic search restricted to "failure" typed memories.
 *
 * @param {string} pattern   Query / error pattern to search
 * @param {object} opts      { minScore, limit, projectId }
 */
function searchFailures(pattern, opts = {}) {
  return semanticSearch(pattern, { ...opts, type: "failure" });
}

/**
 * Semantic search restricted to "success" typed memories.
 *
 * @param {string} pattern   Query / pattern to search
 * @param {object} opts      { minScore, limit, projectId }
 */
function searchSuccesses(pattern, opts = {}) {
  return semanticSearch(pattern, { ...opts, type: "success" });
}

/**
 * Semantic search restricted to "decision" typed memories.
 *
 * @param {string} context   Decision context to search
 * @param {object} opts      { minScore, limit, projectId }
 */
function searchDecisions(context, opts = {}) {
  return semanticSearch(context, { ...opts, type: "decision" });
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 6 — Cross-Project Search
// ────────────────────────────────────────────────────────────────────────────

/**
 * Search across ALL projectIds and return results grouped by project.
 *
 * Nodes without a projectId tag are grouped under the key "__global__".
 *
 * @param {string} query
 * @param {object} opts  { type, minScore, limit }
 * @returns {{ byProject: { [projectId]: results[] }, total }}
 */
function crossProjectSearch(query, opts = {}) {
  const { type, minScore = 0.1, limit = 20 } = opts;
  const mpl = _mpl();

  const fetchOpts = { limit: 5000 };
  if (type) fetchOpts.tag = type;
  const { nodes } = mpl.list(fetchOpts);

  // Run one global TF-IDF pass across everything
  const allResults = _tfidfSearch(query, nodes, { minScore, limit: nodes.length });

  // Group by projectId
  const byProject = {};
  for (const node of allResults) {
    // Determine projectId: check node.projectId first, then look for "project:<id>" tag
    let pid = node.projectId || null;
    if (!pid) {
      const ptag = (node.tags || []).find(t => t.startsWith("project:"));
      pid = ptag ? ptag.replace("project:", "") : "__global__";
    }
    if (!byProject[pid]) byProject[pid] = [];
    byProject[pid].push(node);
  }

  // Enforce per-project limit
  for (const pid of Object.keys(byProject)) {
    byProject[pid] = byProject[pid].slice(0, limit);
  }

  const total = allResults.length;
  logger.info(`[SemanticMem] crossProjectSearch query="${query}" total=${total} projects=${Object.keys(byProject).length}`);
  return { byProject, total };
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 7 — Knowledge Graph
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a semantic knowledge graph.
 *
 * Nodes = memory nodes (id, key, type tags, importance).
 * Edges = pairs with cosine similarity > edgeThreshold.
 *
 * This is O(n²) over corpus — use maxNodes to cap expensive stores.
 *
 * @param {object} opts
 *   edgeThreshold  — min cosine similarity for an edge (default 0.3)
 *   maxNodes       — corpus size cap (default 500)
 *   type           — optional type tag filter
 *   projectId      — optional project filter
 * @returns {{ nodes[], edges[], edgeCount }}
 */
function getKnowledgeGraph(opts = {}) {
  const { edgeThreshold = 0.3, maxNodes = 500, type, projectId } = opts;
  const mpl = _mpl();

  const fetchOpts = { limit: maxNodes };
  if (type) fetchOpts.tag = type;

  let { nodes } = mpl.list(fetchOpts);

  if (projectId) {
    const ptag = `project:${projectId}`;
    nodes = nodes.filter(n => (n.tags || []).includes(ptag) || n.projectId === projectId);
  }

  // Build TF-IDF vectors for all nodes
  const corpus   = nodes.map(n => _tokenise(_nodeText(n)));
  const idfMap   = _idf(corpus);
  const vectors  = corpus.map(tokens => _tfidfVector(tokens, idfMap));

  // Build graph nodes (lightweight projection)
  const graphNodes = nodes.map(n => ({
    nodeId:     n.nodeId,
    key:        n.key,
    tags:       n.tags || [],
    importance: n.importance || 50,
    confidence: n.confidence || 80,
    ...(n.projectId ? { projectId: n.projectId } : {}),
  }));

  // Build edges — pairwise cosine
  const edges = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const sim = _cosine(vectors[i], vectors[j]);
      if (sim >= edgeThreshold) {
        edges.push({
          source:     nodes[i].nodeId,
          target:     nodes[j].nodeId,
          similarity: parseFloat(sim.toFixed(4)),
          weight:     parseFloat(sim.toFixed(4)),
        });
      }
    }
  }

  // Sort edges by similarity desc
  edges.sort((a, b) => b.similarity - a.similarity);

  logger.info(`[SemanticMem] getKnowledgeGraph nodes=${graphNodes.length} edges=${edges.length}`);
  return { nodes: graphNodes, edges, edgeCount: edges.length };
}

// ────────────────────────────────────────────────────────────────────────────
// SECTION 8 — Knowledge Evolution
// ────────────────────────────────────────────────────────────────────────────

/**
 * Evolve knowledge: find nodes with LOW confidence but HIGH recurrenceCount
 * (i.e. patterns that keep appearing but aren't yet trusted) and upgrade their
 * importance so they surface more prominently.
 *
 * "recurrenceCount" lives inside node.value for failure/success nodes.
 * For other node types, usageCount is used as a proxy for recurrence.
 *
 * Upgrade logic:
 *   - If recurrenceCount >= recurrenceThreshold AND confidence < confidenceCap:
 *       importance += importanceBoost  (capped at 100)
 *       confidence += confidenceBoost  (capped at confidenceCap)
 *
 * @param {object} opts
 *   recurrenceThreshold — minimum recurrenceCount / usageCount (default 3)
 *   confidenceCap       — max confidence for eligibility (default 60)
 *   importanceBoost     — importance delta applied (default 15)
 *   confidenceBoost     — confidence delta applied (default 10)
 *   dryRun              — if true, return candidates without writing (default false)
 *   limit               — max nodes to evolve in one call (default 100)
 * @returns {{ evolved[], count }}
 */
function evolveKnowledge(opts = {}) {
  const {
    recurrenceThreshold = 3,
    confidenceCap       = 60,
    importanceBoost     = 15,
    confidenceBoost     = 10,
    dryRun              = false,
    limit               = 100,
  } = opts;

  const mpl = _mpl();
  const { nodes } = mpl.list({ limit: 5000 });

  const evolved = [];

  for (const node of nodes) {
    if (evolved.length >= limit) break;

    // Skip if confidence already high
    if ((node.confidence || 80) >= confidenceCap) continue;

    // Determine effective recurrence count
    let recurrence = node.usageCount || 0;
    if (node.value && typeof node.value === "object") {
      const rc = node.value.recurrenceCount;
      if (typeof rc === "number" && rc > recurrence) recurrence = rc;
    }

    if (recurrence < recurrenceThreshold) continue;

    // This node qualifies for evolution
    const newImportance = Math.min(100, (node.importance || 50) + importanceBoost);
    const newConfidence = Math.min(100, (node.confidence || 50) + confidenceBoost);

    const evolvedEntry = {
      nodeId:          node.nodeId,
      key:             node.key,
      recurrence,
      oldImportance:   node.importance,
      newImportance,
      oldConfidence:   node.confidence,
      newConfidence,
      dryRun,
    };

    if (!dryRun) {
      try {
        mpl.update(node.nodeId, { importance: newImportance, confidence: newConfidence });
        evolvedEntry.updated = true;
      } catch (err) {
        evolvedEntry.updated = false;
        evolvedEntry.error   = err.message;
        logger.warn(`[SemanticMem] evolveKnowledge update failed for ${node.nodeId}: ${err.message}`);
      }
    }

    evolved.push(evolvedEntry);
  }

  logger.info(`[SemanticMem] evolveKnowledge evolved=${evolved.length}${dryRun ? " (dry-run)" : ""}`);
  return { evolved, count: evolved.length };
}

// ────────────────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Taxonomy save
  saveTypedMemory,

  // Core search
  semanticSearch,

  // Type-scoped helpers
  searchFailures,
  searchSuccesses,
  searchDecisions,

  // Cross-project
  crossProjectSearch,

  // Graph + evolution
  getKnowledgeGraph,
  evolveKnowledge,

  // Exposed internals (useful for testing / advanced callers)
  _tokenise,
  _tfidfSearch,
  _cosine,
};
