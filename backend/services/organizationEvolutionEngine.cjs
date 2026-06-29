"use strict";
/**
 * organizationEvolutionEngine.cjs — POST-Ω P20 Artificial Organization Network
 *
 * Continuously improves collaboration quality across the network.
 * Tracks improvement cycles, generates recommendations, and learns from outcomes.
 *
 * Reuses: organizationRegistryEngine, organizationCollaborationEngine,
 *         organizationCapabilityExchangeEngine, organizationGovernanceEngine,
 *         selfImprovementEngine, autonomousEvolutionOrg, innovationEngine,
 *         researchKnowledgeEngine.
 *
 * Storage: data/org-network-evolution.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "org-network-evolution.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _reg    = () => _try(() => require("./organizationRegistryEngine.cjs"));
const _collab = () => _try(() => require("./organizationCollaborationEngine.cjs"));
const _cap    = () => _try(() => require("./organizationCapabilityExchangeEngine.cjs"));
const _gov    = () => _try(() => require("./organizationGovernanceEngine.cjs"));
const _sie    = () => _try(() => require("./selfImprovementEngine.cjs"));
const _aeo    = () => _try(() => require("./autonomousEvolutionOrg.cjs"));
const _inn    = () => _try(() => require("./innovationEngine.cjs"));
const _rke    = () => _try(() => require("./researchKnowledgeEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `nevo_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const EVOLUTION_TYPES = [
  "network_optimization",
  "trust_improvement",
  "capability_expansion",
  "collaboration_quality",
  "conflict_resolution",
];

const EVOLUTION_STATUSES = ["pending", "applied", "deferred", "rejected"];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { evolutions: [], cycles: 0 };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.evolutions)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.evolutions.length > 2000) d.evolutions = d.evolutions.slice(-2000);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Evolution Engine ──────────────────────────────────────────────────────────

function evolve() {
  const d       = _load();
  const reg     = _reg();
  const allOrgs = reg?.listOrgs({ status: "active" }).orgs || [];
  const stats   = reg?.getStats() || {};
  const collabStats = _collab()?.getCollaborationStats() || {};
  const govStats    = _gov()?.getStats() || {};
  const capInfo     = _cap()?.getAllCapabilities() || {};

  const evolutions = [];

  // 1. Network Optimization — low trust score
  if ((stats.trustScore || 0) < 75) {
    evolutions.push({
      id:       _id(),
      type:     "network_optimization",
      priority: "high",
      title:    "Improve network trust score",
      rationale: `Current trust score ${stats.trustScore || 0}% is below 75% threshold`,
      actions:  ["increase certified orgs", "resolve violations", "create SLA agreements"],
      status:   "pending",
      createdAt: _ts(),
    });
  }

  // 2. Trust Improvement — violations present
  if ((govStats.totalViolations || 0) > 0) {
    evolutions.push({
      id:       _id(),
      type:     "trust_improvement",
      priority: "high",
      title:    "Resolve governance violations",
      rationale: `${govStats.totalViolations} violations detected across the network`,
      actions:  ["mediate affected agreements", "escalate critical violations", "update compliance rules"],
      status:   "pending",
      createdAt: _ts(),
    });
  }

  // 3. Capability Expansion — gaps detected
  if ((capInfo.gapsDetected || 0) > 0) {
    evolutions.push({
      id:       _id(),
      type:     "capability_expansion",
      priority: "medium",
      title:    "Fill capability gaps in network",
      rationale: `${capInfo.gapsDetected} capability gaps detected`,
      actions:  ["register specialized orgs", "delegate missing capabilities", "train existing orgs"],
      status:   "pending",
      createdAt: _ts(),
    });
  }

  // 4. Collaboration Quality — low success rate
  if ((collabStats.successRate || 100) < 80 && (collabStats.total || 0) > 0) {
    evolutions.push({
      id:       _id(),
      type:     "collaboration_quality",
      priority: "medium",
      title:    "Improve collaboration success rate",
      rationale: `Collaboration success rate ${collabStats.successRate}% is below 80%`,
      actions:  ["review failed collaborations", "improve routing accuracy", "add retry logic"],
      status:   "pending",
      createdAt: _ts(),
    });
  }

  // 5. SIE-driven evolution signals
  const siePatterns = _sie()?.getPatterns?.() || [];
  const promotedPatterns = siePatterns.filter(p => p.promoted);
  if (promotedPatterns.length > 0) {
    evolutions.push({
      id:       _id(),
      type:     "network_optimization",
      priority: "low",
      title:    `Apply ${promotedPatterns.length} SIE-promoted patterns to network`,
      rationale: "Self-improvement engine has promoted new patterns applicable to org collaboration",
      actions:  promotedPatterns.slice(0, 3).map(p => `Apply pattern: ${p.name || p.id}`),
      status:   "pending",
      createdAt: _ts(),
    });
  }

  // 6. AEO-driven evolution
  const aeoStatus = _aeo()?.getOrgStatus?.() || null;
  if (aeoStatus?.activeDepts > 0) {
    evolutions.push({
      id:       _id(),
      type:     "capability_expansion",
      priority: "low",
      title:    "Integrate AEO evolution signals into network",
      rationale: `${aeoStatus.activeDepts} evolution departments active`,
      actions:  ["sync AEO capabilities to network registry", "propagate learnings to all orgs"],
      status:   "pending",
      createdAt: _ts(),
    });
  }

  // De-duplicate by title
  const titleSet = new Set(d.evolutions.map(e => e.title));
  const newEvolutions = evolutions.filter(e => !titleSet.has(e.title));

  // Index insights in RKE
  if (newEvolutions.length > 0) {
    _rke()?.indexFinding?.({ title: `Network evolution cycle: ${newEvolutions.length} new improvements`, category: "network_evolution" });
  }

  // Record in innovation engine
  if (newEvolutions.some(e => e.priority === "high")) {
    _inn()?.recordInnovation?.({ type: "platform_innovation", title: "High-priority network evolution detected", description: "Trust/capability/compliance gaps found in org network" });
  }

  d.evolutions.push(...newEvolutions);
  d.cycles = (d.cycles || 0) + 1;
  _save(d);

  return {
    ok:       true,
    found:    newEvolutions.length,
    total:    d.evolutions.length,
    cycles:   d.cycles,
    evolutions: newEvolutions,
  };
}

function applyEvolution(id) {
  const d = _load();
  const e = d.evolutions.find(x => x.id === id);
  if (!e) return { ok: false, error: `Evolution ${id} not found` };
  e.status    = "applied";
  e.appliedAt = _ts();
  _save(d);
  return { ok: true, evolution: e };
}

function getEvolution(id) { return _load().evolutions.find(e => e.id === id) || null; }

function listEvolutions({ type, status, priority, limit = 100 } = {}) {
  let items = _load().evolutions;
  if (type)     items = items.filter(e => e.type === type);
  if (status)   items = items.filter(e => e.status === status);
  if (priority) items = items.filter(e => e.priority === priority);
  return { ok: true, evolutions: items.slice(-limit), total: items.length };
}

function getStats() {
  const d = _load();
  const byType   = {};
  const byStatus = {};
  EVOLUTION_TYPES.forEach(t => { byType[t] = 0; });
  EVOLUTION_STATUSES.forEach(s => { byStatus[s] = 0; });
  d.evolutions.forEach(e => {
    if (byType[e.type]     !== undefined) byType[e.type]++;
    if (byStatus[e.status] !== undefined) byStatus[e.status]++;
  });
  return {
    total: d.evolutions.length,
    applied: byStatus.applied || 0,
    cycles:  d.cycles || 0,
    byType,
    byStatus,
    EVOLUTION_TYPES,
  };
}

module.exports = {
  EVOLUTION_TYPES,
  EVOLUTION_STATUSES,
  evolve,
  applyEvolution,
  getEvolution,
  listEvolutions,
  getStats,
};
