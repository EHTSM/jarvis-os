"use strict";
/**
 * organizationRegistryEngine.cjs — POST-Ω P20 Artificial Organization Network
 *
 * Unified registry for every autonomous organization inside the platform.
 * Does NOT reimplement any org — only tracks federation metadata.
 *
 * Reuses: engineeringOrgWorkflow, businessOrgWorkflow, autonomousKnowledgeOrg,
 *         autonomousEvolutionOrg, executiveOrg, enterpriseOrg, ecosystemOrg,
 *         civilizationOrg, autonomousOrg, companyFactory, workforceManager,
 *         infrastructureRegistryEngine, scientificDiscoveryDashboard.
 *
 * Storage: data/org-network-registry.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "org-network-registry.json");

const _try = fn => { try { return fn(); } catch { return null; } };

// All platform orgs
const _eng  = () => _try(() => require("./engineeringOrgWorkflow.cjs"));
const _biz  = () => _try(() => require("./businessOrgWorkflow.cjs"));
const _ako  = () => _try(() => require("./autonomousKnowledgeOrg.cjs"));
const _aeo  = () => _try(() => require("./autonomousEvolutionOrg.cjs"));
const _eos  = () => _try(() => require("./executiveOrg.cjs"));
const _ent  = () => _try(() => require("./enterpriseOrg.cjs"));
const _eco  = () => _try(() => require("./ecosystemOrg.cjs"));
const _civ  = () => _try(() => require("./civilizationOrg.cjs"));
const _auto = () => _try(() => require("./autonomousOrg.cjs"));
const _cf   = () => _try(() => require("./companyFactory.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _infra = () => _try(() => require("./infrastructureRegistryEngine.cjs"));
const _sci  = () => _try(() => require("./scientificDiscoveryDashboard.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `org_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const ORG_TYPES = [
  "engineering", "business", "knowledge", "evolution",
  "executive", "enterprise", "ecosystem", "civilization",
  "autonomous", "company", "product", "customer",
  "marketplace", "research", "infrastructure",
];

const ORG_STATUSES = ["active", "inactive", "suspended", "evolving"];

const TRUST_LEVELS = ["untrusted", "provisional", "trusted", "certified"];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    orgs: [],
    stats: { total: 0, active: 0, byType: {}, byTrust: {}, trustScore: 0 },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.orgs)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.orgs.length > 500) d.orgs = d.orgs.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _recomputeStats(orgs) {
  const byType  = {};
  const byTrust = {};
  ORG_TYPES.forEach(t => { byType[t] = 0; });
  TRUST_LEVELS.forEach(l => { byTrust[l] = 0; });
  orgs.forEach(o => {
    if (byType[o.orgType]    !== undefined) byType[o.orgType]++;
    if (byTrust[o.trustLevel] !== undefined) byTrust[o.trustLevel]++;
  });
  const certified   = byTrust.certified || 0;
  const trusted     = byTrust.trusted || 0;
  const provisional = byTrust.provisional || 0;
  const total       = orgs.length || 1;
  const trustScore  = Math.round((certified * 100 + trusted * 75 + provisional * 40) / total);
  return { total: orgs.length, active: orgs.filter(o => o.status === "active").length, byType, byTrust, trustScore };
}

// ── Bootstrap: seed all known platform orgs ───────────────────────────────────

const PLATFORM_ORGS = [
  { id: "org_engineering",  orgType: "engineering",     name: "Engineering Organization",     level: 2,  trustLevel: "certified", capabilities: ["code","architecture","review","testing","deployment"] },
  { id: "org_business",     orgType: "business",        name: "Business Organization V3",     level: 3,  trustLevel: "certified", capabilities: ["crm","sales","marketing","operations","revenue"] },
  { id: "org_knowledge",    orgType: "knowledge",       name: "Knowledge Organization",       level: 4,  trustLevel: "certified", capabilities: ["research","indexing","recall","federation","learning"] },
  { id: "org_evolution",    orgType: "evolution",       name: "Evolution Organization",       level: 5,  trustLevel: "certified", capabilities: ["pattern_discovery","self_improvement","optimization","evolution"] },
  { id: "org_executive",    orgType: "executive",       name: "Executive Organization",       level: 6,  trustLevel: "certified", capabilities: ["strategy","planning","coordination","reporting","decisions"] },
  { id: "org_enterprise",   orgType: "enterprise",      name: "Enterprise Organization",      level: 7,  trustLevel: "certified", capabilities: ["governance","compliance","audit","companies","products","customers"] },
  { id: "org_ecosystem",    orgType: "ecosystem",       name: "Ecosystem Platform",           level: 8,  trustLevel: "certified", capabilities: ["marketplace","multi_tenant","developer_platform","trust"] },
  { id: "org_civilization", orgType: "civilization",    name: "AI Civilization",              level: 9,  trustLevel: "certified", capabilities: ["federation","council","diplomacy","economy","innovation"] },
  { id: "org_autonomous",   orgType: "autonomous",      name: "Autonomous Civilization",      level: 10, trustLevel: "certified", capabilities: ["ooda","control_surfaces","decision_ledger","experiment"] },
  { id: "org_platform_omega", orgType: "enterprise",   name: "Platform Omega",               level: 11, trustLevel: "certified", capabilities: ["org_registry","blueprint","deploy","clone","SDK","simulate"] },
  { id: "org_customer",     orgType: "customer",        name: "Customer Organization",        level: 11, trustLevel: "trusted",   capabilities: ["journey","health","success","support","automation"] },
  { id: "org_product",      orgType: "product",         name: "Product Factory",              level: 11, trustLevel: "trusted",   capabilities: ["planning","architecture","assembly","validation","release"] },
  { id: "org_company",      orgType: "company",         name: "Company Factory",              level: 11, trustLevel: "trusted",   capabilities: ["company_creation","workspace","lifecycle","blueprint"] },
  { id: "org_marketplace",  orgType: "marketplace",     name: "Autonomous Marketplace",       level: 11, trustLevel: "trusted",   capabilities: ["catalog","recommendation","certification","economy"] },
  { id: "org_research",     orgType: "research",        name: "Research Institute",           level: 11, trustLevel: "trusted",   capabilities: ["experiments","publications","benchmarks","knowledge"] },
  { id: "org_infrastructure", orgType: "infrastructure", name: "Infrastructure Orchestrator", level: 11, trustLevel: "trusted",   capabilities: ["registry","health","recovery","optimization","planning"] },
];

function _seed(d) {
  if (d.orgs.length >= PLATFORM_ORGS.length) return;
  const dedup = new Map(d.orgs.map(o => [o.id, o]));
  PLATFORM_ORGS.forEach(spec => {
    if (!dedup.has(spec.id)) {
      dedup.set(spec.id, {
        ...spec,
        status:       "active",
        agentCount:   spec.capabilities.length * 2,
        networkScore: 80,
        registeredAt: _ts(),
        updatedAt:    _ts(),
      });
    }
  });
  d.orgs = [...dedup.values()];
  d.stats = _recomputeStats(d.orgs);
  _save(d);
}

// ── Core: register ────────────────────────────────────────────────────────────

function registerOrg(spec) {
  if (!spec.name || !spec.orgType) return { ok: false, error: "name and orgType are required" };
  if (!ORG_TYPES.includes(spec.orgType)) return { ok: false, error: `Unknown orgType: ${spec.orgType}` };

  const d = _load();
  const id = spec.id || _id();
  const existing = d.orgs.find(o => o.id === id);
  const org = {
    ...(existing || {}),
    id,
    name:         spec.name,
    orgType:      spec.orgType,
    level:        spec.level || 1,
    status:       ORG_STATUSES.includes(spec.status) ? spec.status : "active",
    trustLevel:   TRUST_LEVELS.includes(spec.trustLevel) ? spec.trustLevel : "provisional",
    capabilities: spec.capabilities || [],
    agentCount:   spec.agentCount || 0,
    networkScore: spec.networkScore || 60,
    registeredAt: existing?.registeredAt || _ts(),
    updatedAt:    _ts(),
  };

  const dedup = new Map(d.orgs.map(o => [o.id, o]));
  dedup.set(id, org);
  d.orgs = [...dedup.values()];
  d.stats = _recomputeStats(d.orgs);
  _save(d);
  return { ok: true, org };
}

function updateOrgStatus(id, status, { trustLevel } = {}) {
  if (!ORG_STATUSES.includes(status)) return { ok: false, error: `Unknown status: ${status}` };
  const d = _load();
  const o = d.orgs.find(x => x.id === id);
  if (!o) return { ok: false, error: `Org ${id} not found` };
  o.status    = status;
  o.updatedAt = _ts();
  if (trustLevel && TRUST_LEVELS.includes(trustLevel)) o.trustLevel = trustLevel;
  d.stats = _recomputeStats(d.orgs);
  _save(d);
  return { ok: true, org: o };
}

function getOrg(id) { return _load().orgs.find(o => o.id === id) || null; }

function listOrgs({ orgType, status, trustLevel, limit = 100 } = {}) {
  let items = _load().orgs;
  if (orgType)    items = items.filter(o => o.orgType === orgType);
  if (status)     items = items.filter(o => o.status === status);
  if (trustLevel) items = items.filter(o => o.trustLevel === trustLevel);
  return { ok: true, orgs: items.slice(0, limit), total: items.length };
}

function findByCapability(capability) {
  const items = _load().orgs.filter(o =>
    o.status === "active" && o.capabilities.some(c => c.includes(capability))
  ).sort((a, b) => b.networkScore - a.networkScore);
  return { ok: true, orgs: items, total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, ORG_TYPES, ORG_STATUSES, TRUST_LEVELS, updatedAt: d.updatedAt };
}

// Seed on load
;(function() { const d = _load(); _seed(d); })();

module.exports = {
  ORG_TYPES,
  ORG_STATUSES,
  TRUST_LEVELS,
  PLATFORM_ORGS,
  registerOrg,
  updateOrgStatus,
  getOrg,
  listOrgs,
  findByCapability,
  getStats,
};
