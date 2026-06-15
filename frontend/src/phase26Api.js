import { _fetch } from "./_client";

// ── Graph ─────────────────────────────────────────────────────────────
export async function createGraph(payload)       { return _fetch("/p26/graph", { method: "POST", body: JSON.stringify(payload) }); }
export async function executeGraph(id)           { return _fetch(`/p26/graph/${id}/execute`, { method: "POST" }); }
export async function getGraphList()             { return _fetch("/p26/graph"); }
export async function getGraph(id)               { return _fetch(`/p26/graph/${id}`); }
export async function deleteGraph(id)            { return _fetch(`/p26/graph/${id}`, { method: "DELETE" }); }
export async function getGraphStats()            { return _fetch("/p26/graph/stats"); }

// ── Memory ────────────────────────────────────────────────────────────
export async function searchMemory(payload)      { return _fetch("/p26/memory/search", { method: "POST", body: JSON.stringify(payload) }); }
export async function storeMemory(payload)       { return _fetch("/p26/memory/typed", { method: "POST", body: JSON.stringify(payload) }); }
export async function getMemoryFailures()        { return _fetch("/p26/memory/failures"); }
export async function getMemorySuccesses()       { return _fetch("/p26/memory/successes"); }
export async function getMemoryDecisions()       { return _fetch("/p26/memory/decisions"); }
export async function getKnowledgeGraph()        { return _fetch("/p26/memory/knowledge-graph"); }

// ── Reason ────────────────────────────────────────────────────────────
export async function calcRisk(payload)          { return _fetch("/p26/reason/risk", { method: "POST", body: JSON.stringify(payload) }); }
export async function calcConfidence(payload)    { return _fetch("/p26/reason/confidence", { method: "POST", body: JSON.stringify(payload) }); }
export async function getRollbackPlan(payload)   { return _fetch("/p26/reason/rollback", { method: "POST", body: JSON.stringify(payload) }); }
export async function getRootCause(payload)      { return _fetch("/p26/reason/root-cause", { method: "POST", body: JSON.stringify(payload) }); }

// ── Observer ──────────────────────────────────────────────────────────
export async function getObserverStatus()        { return _fetch("/p26/observer/status"); }
export async function getObserverRecs()          { return _fetch("/p26/observer/recommendations"); }
export async function triggerObserver(name)      { return _fetch(`/p26/observer/trigger/${name}`, { method: "POST" }); }

// ── Plugins ───────────────────────────────────────────────────────────
export async function getPlugins()               { return _fetch("/p26/plugins"); }
export async function getPlugin(id)              { return _fetch(`/p26/plugins/${id}`); }
export async function registerPlugin(payload)    { return _fetch("/p26/plugins", { method: "POST", body: JSON.stringify(payload) }); }
export async function deletePlugin(id)           { return _fetch(`/p26/plugins/${id}`, { method: "DELETE" }); }
export async function callPluginHook(payload)    { return _fetch("/p26/plugins/hook", { method: "POST", body: JSON.stringify(payload) }); }

// ── Capabilities ──────────────────────────────────────────────────────
export async function getCapabilities()          { return _fetch("/p26/capabilities"); }
export async function getCapabilityMap()         { return _fetch("/p26/capabilities/map"); }
export async function findCapability(params)     {
  const q = new URLSearchParams(params).toString();
  return _fetch(`/p26/capabilities/find?${q}`);
}
export async function registerCapability(payload){ return _fetch("/p26/capabilities", { method: "POST", body: JSON.stringify(payload) }); }

// ── Manifest ──────────────────────────────────────────────────────────
export async function getManifest()              { return _fetch("/p26/manifest"); }
export async function searchManifest(query)      { return _fetch(`/p26/manifest/search?q=${encodeURIComponent(query)}`); }

// ── Templates ─────────────────────────────────────────────────────────
export async function getTemplates()             { return _fetch("/p26/templates"); }
export async function createTemplate(payload)    { return _fetch("/p26/templates", { method: "POST", body: JSON.stringify(payload) }); }
export async function instantiateTemplate(id, payload) {
  return _fetch(`/p26/templates/${id}/instantiate`, { method: "POST", body: JSON.stringify(payload) });
}
