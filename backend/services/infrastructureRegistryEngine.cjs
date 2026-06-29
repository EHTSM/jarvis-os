"use strict";
/**
 * infrastructureRegistryEngine.cjs — POST-Ω P19 Global Infrastructure Orchestrator
 *
 * Single registry for every infrastructure resource across all environments.
 * Does NOT implement deployment — orchestrates registration metadata only.
 *
 * Supported: VPS, Docker, Kubernetes, Cloudflare, AWS, Azure, GCP, Firebase,
 *            Supabase, Nginx, PM2, Domains, DNS, SSL, CDN, Storage, Database.
 *
 * Reuses: deviceRegistryEngine (adapter pattern), analyticsService,
 *         autonomousExecutionEngine, workspaceMesh, riskAssessmentEngine,
 *         capitalAllocationEngine, engineeringBenchmarkEngine.
 *
 * Storage: data/infrastructure-registry.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "infrastructure-registry.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _risk = () => _try(() => require("./riskAssessmentEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `inf_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const RESOURCE_TYPES = [
  "vps", "docker", "kubernetes", "cloudflare",
  "aws", "azure", "gcp", "firebase", "supabase",
  "nginx", "pm2", "domain", "dns", "ssl", "cdn",
  "storage", "database",
];

const RESOURCE_STATUSES = ["active", "inactive", "degraded", "maintenance", "unknown"];

const ENVIRONMENTS = ["production", "staging", "development", "dr"];

const REGIONS = [
  "us-east-1", "us-west-2", "eu-west-1", "eu-central-1",
  "ap-south-1", "ap-southeast-1", "local",
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    resources: [],
    stats: { total: 0, byType: {}, byEnvironment: {}, byRegion: {}, byStatus: {}, active: 0 },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.resources)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.resources.length > 2000) d.resources = d.resources.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _recomputeStats(resources) {
  const byType        = {};
  const byEnvironment = {};
  const byRegion      = {};
  const byStatus      = {};
  RESOURCE_TYPES.forEach(t => { byType[t] = 0; });
  ENVIRONMENTS.forEach(e => { byEnvironment[e] = 0; });
  REGIONS.forEach(r => { byRegion[r] = 0; });
  RESOURCE_STATUSES.forEach(s => { byStatus[s] = 0; });

  resources.forEach(r => {
    if (byType[r.resourceType]        !== undefined) byType[r.resourceType]++;
    if (byEnvironment[r.environment]  !== undefined) byEnvironment[r.environment]++;
    if (byRegion[r.region]            !== undefined) byRegion[r.region]++;
    if (byStatus[r.status]            !== undefined) byStatus[r.status]++;
  });

  return {
    total:         resources.length,
    active:        byStatus.active || 0,
    byType,
    byEnvironment,
    byRegion,
    byStatus,
  };
}

// ── Bootstrap: seed from existing platform data ───────────────────────────────

function _seedFromPlatform(d) {
  if (d.resources.length > 0) return; // already seeded

  // Read existing deployment/infra data to seed registry
  const seeds = [];
  const deployDataPaths = [
    "data/production-infra.json",
    "data/deploy_meta.json",
    "data/dop1-infra-validation.json",
    "data/dop2-deployment.json",
  ];

  deployDataPaths.forEach(p => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
      // Extract server/domain info from whatever shape it has
      if (raw.server || raw.vps) {
        seeds.push({
          resourceType: "vps",
          name:         raw.server || raw.vps || "production-vps",
          environment:  "production",
          region:       raw.region || "us-east-1",
          endpoint:     raw.ip || raw.host || "127.0.0.1",
        });
      }
      if (raw.domain || raw.domains) {
        const dom = Array.isArray(raw.domains) ? raw.domains[0] : raw.domain;
        if (dom) {
          seeds.push({
            resourceType: "domain",
            name:         dom,
            environment:  "production",
            region:       "us-east-1",
            endpoint:     dom,
          });
        }
      }
    } catch {}
  });

  // Always seed with canonical platform infrastructure
  const PLATFORM_RESOURCES = [
    { resourceType: "vps",        name: "ooplix-prod-vps",    environment: "production",  region: "us-east-1",    endpoint: "vps.ooplix.com" },
    { resourceType: "nginx",      name: "ooplix-nginx",       environment: "production",  region: "us-east-1",    endpoint: "vps.ooplix.com:80" },
    { resourceType: "pm2",        name: "ooplix-pm2",         environment: "production",  region: "us-east-1",    endpoint: "vps.ooplix.com:3000" },
    { resourceType: "ssl",        name: "ooplix-ssl",         environment: "production",  region: "us-east-1",    endpoint: "ooplix.com" },
    { resourceType: "domain",     name: "ooplix.com",         environment: "production",  region: "us-east-1",    endpoint: "ooplix.com" },
    { resourceType: "cloudflare", name: "ooplix-cdn",         environment: "production",  region: "us-east-1",    endpoint: "cloudflare.com" },
    { resourceType: "database",   name: "ooplix-mongodb",     environment: "production",  region: "us-east-1",    endpoint: "mongodb://localhost:27017" },
    { resourceType: "storage",    name: "ooplix-storage",     environment: "production",  region: "us-east-1",    endpoint: "storage.ooplix.com" },
    { resourceType: "vps",        name: "ooplix-staging-vps", environment: "staging",     region: "us-east-1",    endpoint: "staging.ooplix.com" },
    { resourceType: "firebase",   name: "ooplix-firebase",    environment: "production",  region: "us-east-1",    endpoint: "firebase.google.com" },
    { resourceType: "dns",        name: "ooplix-dns",         environment: "production",  region: "us-east-1",    endpoint: "ns1.cloudflare.com" },
    { resourceType: "cdn",        name: "ooplix-cf-cdn",      environment: "production",  region: "us-east-1",    endpoint: "cdn.ooplix.com" },
  ];

  PLATFORM_RESOURCES.forEach(pr => {
    const r = register({ ...pr, status: "active" });
    // ignore ok/fail — just seed
    void r;
  });
}

// ── Core: register ────────────────────────────────────────────────────────────

function register(spec) {
  if (!spec.resourceType) return { ok: false, error: "resourceType is required" };
  if (!RESOURCE_TYPES.includes(spec.resourceType)) {
    return { ok: false, error: `Unknown resourceType: ${spec.resourceType}. Valid: ${RESOURCE_TYPES.join(", ")}` };
  }

  const d = _load();
  const id = spec.id || _id();

  const existing = d.resources.find(r => r.id === id);
  const resource = {
    ...(existing || {}),
    id,
    resourceType: spec.resourceType,
    name:         spec.name         || `${spec.resourceType}-${id.slice(-4)}`,
    environment:  ENVIRONMENTS.includes(spec.environment) ? spec.environment : "production",
    region:       REGIONS.includes(spec.region) ? spec.region : "us-east-1",
    endpoint:     spec.endpoint     || null,
    status:       RESOURCE_STATUSES.includes(spec.status) ? spec.status : "unknown",
    metadata:     spec.metadata     || {},
    tags:         spec.tags         || [],
    registeredAt: existing?.registeredAt || _ts(),
    updatedAt:    _ts(),
  };

  const dedup = new Map(d.resources.map(r => [r.id, r]));
  dedup.set(id, resource);
  d.resources = [...dedup.values()];
  d.stats = _recomputeStats(d.resources);
  _save(d);
  return { ok: true, resource };
}

function updateStatus(id, status, { note } = {}) {
  if (!RESOURCE_STATUSES.includes(status)) return { ok: false, error: `Unknown status: ${status}` };
  const d = _load();
  const r = d.resources.find(x => x.id === id);
  if (!r) return { ok: false, error: `Resource ${id} not found` };
  r.status    = status;
  r.updatedAt = _ts();
  if (note) r.lastNote = note;
  d.stats = _recomputeStats(d.resources);
  _save(d);
  return { ok: true, resource: r };
}

function deregister(id) {
  const d = _load();
  const idx = d.resources.findIndex(r => r.id === id);
  if (idx === -1) return { ok: false, error: `Resource ${id} not found` };
  d.resources.splice(idx, 1);
  d.stats = _recomputeStats(d.resources);
  _save(d);
  return { ok: true };
}

function getResource(id) {
  return _load().resources.find(r => r.id === id) || null;
}

function listResources({ resourceType, environment, region, status, limit = 100 } = {}) {
  let items = _load().resources;
  if (resourceType)  items = items.filter(r => r.resourceType === resourceType);
  if (environment)   items = items.filter(r => r.environment === environment);
  if (region)        items = items.filter(r => r.region === region);
  if (status)        items = items.filter(r => r.status === status);
  return { ok: true, resources: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, RESOURCE_TYPES, ENVIRONMENTS, REGIONS, RESOURCE_STATUSES, updatedAt: d.updatedAt };
}

// Run seed on module load
;(function() {
  const d = _load();
  _seedFromPlatform(d);
})();

module.exports = {
  RESOURCE_TYPES,
  RESOURCE_STATUSES,
  ENVIRONMENTS,
  REGIONS,
  register,
  updateStatus,
  deregister,
  getResource,
  listResources,
  getStats,
};
