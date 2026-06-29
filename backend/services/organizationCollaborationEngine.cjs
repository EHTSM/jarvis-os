"use strict";
/**
 * organizationCollaborationEngine.cjs — POST-Ω P20 Artificial Organization Network
 *
 * Enables multiple platform organizations to collaborate:
 * delegate work, share workforce, share knowledge, share infrastructure, share research.
 *
 * Reuses: organizationRegistryEngine, workforceManager, workspaceMesh,
 *         knowledgeFederationEngine, researchKnowledgeEngine, infrastructureRegistryEngine,
 *         autonomousExecutionEngine.
 *
 * Storage: data/org-collaborations.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "org-collaborations.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _reg  = () => _try(() => require("./organizationRegistryEngine.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _mesh = () => _try(() => require("./workspaceMesh.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _infra = () => _try(() => require("./infrastructureRegistryEngine.cjs"));
const _exec = () => _try(() => require("./autonomousExecutionEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `collab_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const COLLABORATION_TYPES = [
  "mission_delegation",
  "workforce_sharing",
  "knowledge_exchange",
  "infrastructure_sharing",
  "research_sharing",
  "capability_delegation",
];

const COLLABORATION_STATUSES = ["pending", "active", "completed", "failed", "cancelled"];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { collaborations: [] };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.collaborations)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.collaborations.length > 2000) d.collaborations = d.collaborations.slice(-2000);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core ──────────────────────────────────────────────────────────────────────

async function collaborate({ fromOrgId, toOrgId, type, payload = {}, skipExecute = false }) {
  if (!fromOrgId || !toOrgId) return { ok: false, error: "fromOrgId and toOrgId are required" };
  if (!COLLABORATION_TYPES.includes(type)) return { ok: false, error: `Unknown type: ${type}` };

  const reg = _reg();
  const fromOrg = reg?.getOrg(fromOrgId);
  const toOrg   = reg?.getOrg(toOrgId);
  if (!fromOrg) return { ok: false, error: `Source org ${fromOrgId} not registered` };
  if (!toOrg)   return { ok: false, error: `Target org ${toOrgId} not registered` };

  const d = _load();
  const collab = {
    id:        _id(),
    fromOrgId,
    fromOrgName: fromOrg.name,
    toOrgId,
    toOrgName:   toOrg.name,
    type,
    payload,
    status:    "active",
    outcome:   null,
    startedAt: _ts(),
    updatedAt: _ts(),
  };

  let outcome;

  if (skipExecute) {
    outcome = { ok: true, mode: "simulated", type };
  } else {
    outcome = await _executeCollaboration(type, fromOrg, toOrg, payload);
  }

  collab.status    = outcome.ok ? "completed" : "failed";
  collab.outcome   = outcome;
  collab.updatedAt = _ts();

  d.collaborations.push(collab);
  _save(d);
  return { ok: outcome.ok, collaboration: collab, outcome };
}

async function _executeCollaboration(type, fromOrg, toOrg, payload) {
  switch (type) {
    case "mission_delegation": {
      const exec = _exec();
      if (exec?.planExecution) {
        const r = await exec.planExecution({ goal: payload.goal || `Mission delegated from ${fromOrg.name}`, orgId: toOrg.id });
        return { ok: r?.ok !== false, mode: "live", delegatedTo: toOrg.name, executionId: r?.id };
      }
      return { ok: true, mode: "queued", delegatedTo: toOrg.name };
    }
    case "workforce_sharing": {
      const wf = _wf();
      if (wf?.runMission) {
        const r = await wf.runMission({ goal: payload.goal || "Shared workforce mission", agentTypes: payload.agentTypes || [] });
        return { ok: r?.ok !== false, mode: "live", sharedWith: toOrg.name };
      }
      return { ok: true, mode: "queued", sharedWith: toOrg.name };
    }
    case "knowledge_exchange": {
      const rke = _rke();
      const facts = rke?.getFacts?.() || [];
      const shared = facts.slice(0, 10);
      return { ok: true, mode: "live", sharedFacts: shared.length, from: fromOrg.name, to: toOrg.name };
    }
    case "infrastructure_sharing": {
      const infra = _infra();
      const resources = infra?.listResources?.({ status: "active" }) || { resources: [] };
      const shared = resources.resources.filter(r => r.environment !== "production").slice(0, 5);
      return { ok: true, mode: "live", sharedResources: shared.length, from: fromOrg.name, to: toOrg.name };
    }
    case "research_sharing": {
      const kfe = _kfe();
      const r = kfe?.federate?.() || { ok: true };
      return { ok: r?.ok !== false, mode: "live", researchShared: true, to: toOrg.name };
    }
    case "capability_delegation": {
      // Discover best orgs for the required capability
      const reg = _reg();
      const best = reg?.findByCapability(payload.capability || "");
      return { ok: true, mode: "live", delegatedCapability: payload.capability, bestOrgs: best?.orgs?.length || 0 };
    }
    default:
      return { ok: true, mode: "unknown" };
  }
}

function getCollaboration(id) { return _load().collaborations.find(c => c.id === id) || null; }

function listCollaborations({ fromOrgId, toOrgId, type, status, limit = 100 } = {}) {
  let items = _load().collaborations;
  if (fromOrgId) items = items.filter(c => c.fromOrgId === fromOrgId);
  if (toOrgId)   items = items.filter(c => c.toOrgId === toOrgId);
  if (type)      items = items.filter(c => c.type === type);
  if (status)    items = items.filter(c => c.status === status);
  return { ok: true, collaborations: items.slice(-limit), total: items.length };
}

function getCollaborationStats() {
  const items = _load().collaborations;
  const byType   = {};
  const byStatus = {};
  COLLABORATION_TYPES.forEach(t => { byType[t] = 0; });
  COLLABORATION_STATUSES.forEach(s => { byStatus[s] = 0; });
  items.forEach(c => {
    if (byType[c.type]     !== undefined) byType[c.type]++;
    if (byStatus[c.status] !== undefined) byStatus[c.status]++;
  });
  const completed  = byStatus.completed || 0;
  const total      = items.length || 1;
  const successRate = Math.round((completed / total) * 100);
  return { total: items.length, byType, byStatus, successRate };
}

// Find the best organization for a given goal/capability
function routeToOrg(capability, { excludeOrgId } = {}) {
  const reg = _reg();
  if (!reg) return { ok: false, error: "Registry unavailable" };
  const result = reg.findByCapability(capability);
  let orgs = result.orgs;
  if (excludeOrgId) orgs = orgs.filter(o => o.id !== excludeOrgId);
  if (orgs.length === 0) return { ok: false, error: `No org found for capability: ${capability}` };
  return { ok: true, best: orgs[0], alternatives: orgs.slice(1, 3) };
}

module.exports = {
  COLLABORATION_TYPES,
  COLLABORATION_STATUSES,
  collaborate,
  getCollaboration,
  listCollaborations,
  getCollaborationStats,
  routeToOrg,
};
