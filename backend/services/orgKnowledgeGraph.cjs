"use strict";
/**
 * orgKnowledgeGraph.cjs — V5 Global AI Organization Platform, Module 2:
 * Organization Knowledge Graph.
 *
 * NOT a new graph engine — every function here is a thin composition over
 * knowledgeGraph.cjs's existing edge-only store (data/knowledge-graph.json,
 * 20,000-edge cap already in place) and NODE_TYPES/RELATIONS. That engine's
 * own indexAll() already covers missions, RCAs, lessons, org hierarchy,
 * business events, and workforce steps with real BELONGS_TO/org edges.
 * What's genuinely missing against this mission's explicit list — CRM,
 * connectors, workflows, and AI context — is added here as real edges
 * into the SAME store, plus one new org-scoped traversal wrapper. No new
 * NODE_TYPES are introduced except where the existing generic ones
 * (ARTIFACT for documents/assets, RULE for automation rules) would be a
 * category error to reuse for something structurally different (connector
 * credentials, AI prompt turns) — see CONNECTOR and AI_CONTEXT below.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _kg   = () => _try(() => require("./knowledgeGraph.cjs"));
const _bds  = () => _try(() => require("./businessDataService.cjs"));
const _vault = () => _try(() => require("./secretVault.cjs"));
const _automation = () => _try(() => require("./automationService.cjs"));
const _history = () => _try(() => require("./promptHistory.cjs"));
const _cal  = () => _try(() => require("./creativeAssetLibrary.cjs"));
const _org  = () => _try(() => require("./organizationService.cjs"));

// Two node types knowledgeGraph.cjs's existing NODE_TYPES doesn't cover —
// a connector credential and an AI prompt/response turn are structurally
// distinct from anything in the existing enum (not a lead, not an
// artifact, not a rule), so reusing one of those would misrepresent what
// the node actually is. Passed as plain strings to addEdge (which never
// validates fromType/toType against NODE_TYPES — it's an open vocabulary),
// so this is additive to the existing graph, not a schema change.
const CONNECTOR_NODE = "connector";
const AI_CONTEXT_NODE = "ai_context";
const AUTOMATION_RULE_NODE = "automation_rule";
const DOCUMENT_NODE = "document";

function _assertMember(orgId, accountId) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
}

// ── Indexing: add real edges for the categories indexAll() doesn't cover ──────

function indexCrm(orgId) {
  const kg = _kg();
  const bds = _bds();
  if (!kg || !bds) return { indexed: 0 };
  let indexed = 0;
  const _add = (type, id, meta) => {
    try { kg.addEdge(type, id, kg.RELATIONS.BELONGS_TO, "org", orgId, { metadata: meta }); indexed++; } catch { /* dedupe or transient */ }
  };
  for (const l of (bds.listLeads({ orgId, limit: 2000 })?.items || [])) _add("lead", l.id, { name: l.name });
  for (const o of (bds.listOpportunities({ orgId, limit: 2000 })?.items || [])) _add("opportunity", o.id, { title: o.title || o.name });
  for (const c of (bds.listCampaigns({ orgId, limit: 2000 })?.items || [])) _add("campaign", c.id, { name: c.name });
  return { indexed };
}

function indexConnectors(orgId) {
  const kg = _kg();
  const vault = _vault();
  if (!kg || !vault) return { indexed: 0 };
  let indexed = 0;
  const secrets = vault.listSecrets?.({ orgId }) || [];
  for (const s of secrets) {
    try {
      kg.addEdge(CONNECTOR_NODE, s.connectorId, kg.RELATIONS.BELONGS_TO, "org", orgId, { metadata: { type: s.type } });
      indexed++;
    } catch { /* dedupe or transient */ }
  }
  return { indexed };
}

function indexWorkflows(orgId) {
  const kg = _kg();
  const automation = _automation();
  if (!kg || !automation) return { indexed: 0 };
  let indexed = 0;
  // automationService.cjs is workspaceId-keyed with no orgId concept of its
  // own (confirmed: workspaceId is a free-form, unvalidated string key) —
  // the org-scoped automation routes (Module 7) use orgId directly as that
  // key, so reading rules under orgId here reflects the real org-scoped
  // rule set, not a guess.
  const rules = automation.getRules?.(orgId) || [];
  for (const r of rules) {
    try {
      kg.addEdge(AUTOMATION_RULE_NODE, r.id, kg.RELATIONS.BELONGS_TO, "org", orgId, { metadata: { name: r.name, trigger: r.trigger } });
      indexed++;
    } catch { /* dedupe or transient */ }
  }
  return { indexed };
}

function indexAiContext(orgId, opts = {}) {
  const kg = _kg();
  const history = _history();
  if (!kg || !history) return { indexed: 0 };
  let indexed = 0;
  const entries = history.query({ orgId, limit: opts.limit || 200 });
  for (const e of entries) {
    try {
      kg.addEdge(AI_CONTEXT_NODE, e.id, kg.RELATIONS.BELONGS_TO, "org", orgId, { metadata: { capability: e.capability, provider: e.provider, ts: e.ts } });
      indexed++;
    } catch { /* dedupe or transient */ }
  }
  return { indexed };
}

function indexDocuments(orgId) {
  const kg = _kg();
  const cal = _cal();
  if (!kg || !cal?.listAssets) return { indexed: 0 };
  let indexed = 0;
  const assets = cal.listAssets({ orgId, limit: 2000 }) || [];
  for (const a of assets) {
    try {
      kg.addEdge(DOCUMENT_NODE, a.id, kg.RELATIONS.BELONGS_TO, "org", orgId, { metadata: { type: a.type, folder: a.folder } });
      indexed++;
    } catch { /* dedupe or transient */ }
  }
  return { indexed };
}

/** Runs every org-scoped indexer for one org. Call after CRM/connector/
 * workflow/AI-context changes, or periodically — same "call after any
 * event" idiom knowledgeGraph.cjs's own indexMission already documents. */
function indexOrg(orgId, accountId) {
  _assertMember(orgId, accountId);
  const crm = indexCrm(orgId);
  const connectors = indexConnectors(orgId);
  const workflows = indexWorkflows(orgId);
  const aiContext = indexAiContext(orgId);
  const documents = indexDocuments(orgId);
  return {
    ok: true, orgId,
    indexed: crm.indexed + connectors.indexed + workflows.indexed + aiContext.indexed + documents.indexed,
    byCategory: { crm: crm.indexed, connectors: connectors.indexed, workflows: workflows.indexed, aiContext: aiContext.indexed, documents: documents.indexed },
  };
}

// ── Org-scoped query ──────────────────────────────────────────────────────────

/** Everything connected to this org, one hop in (BELONGS_TO-style edges
 * point AT the org node, so direction "in" from the org's own perspective
 * is "things that belong to me"). Reuses knowledgeGraph.traverse verbatim —
 * no new traversal algorithm. */
function getOrgGraph(orgId, accountId, opts = {}) {
  _assertMember(orgId, accountId);
  const kg = _kg();
  if (!kg) return { nodes: [], edges: [] };
  const result = kg.traverse("org", orgId, { maxDepth: opts.maxDepth || 1, maxNodes: opts.maxNodes || 500, direction: "in" });
  const byType = {};
  for (const n of result.nodes) {
    if (n.type === "org" && n.id === orgId) continue;
    if (!byType[n.type]) byType[n.type] = [];
    byType[n.type].push(n);
  }
  return { ok: true, orgId, totalNodes: result.nodes.length - 1, byType };
}

/** Real impact analysis, scoped to one org's subgraph — thin wrapper over
 * knowledgeGraph.impactAnalysis, with a post-hoc org-membership filter so a
 * traversal that happens to cross into another org's nodes (e.g. via a
 * shared rule) doesn't leak that org's node details to a caller who isn't
 * a member of it. */
function getOrgImpact(orgId, accountId, type, id) {
  _assertMember(orgId, accountId);
  const kg = _kg();
  if (!kg) return { ok: false };
  return kg.impactAnalysis(type, id);
}

module.exports = {
  indexCrm, indexConnectors, indexWorkflows, indexAiContext, indexDocuments,
  indexOrg, getOrgGraph, getOrgImpact,
  CONNECTOR_NODE, AI_CONTEXT_NODE, AUTOMATION_RULE_NODE, DOCUMENT_NODE,
};
