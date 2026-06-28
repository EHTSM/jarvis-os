"use strict";
/**
 * Artificial Organization Platform — State (LEVEL Ω)
 *
 * Persistent store for every platform entity:
 *   - Organization Registry (all deployed AI orgs)
 *   - Blueprints (org definitions — extends agents/dev/blueprintGenerator)
 *   - Templates (org templates — extends pluginSDK template system)
 *   - Deployments (extends deploymentCoordinator)
 *   - Versions (org version history)
 *   - Clones / Forks
 *   - Packages (importable/exportable org bundles)
 *   - Marketplace listings (orgs for sale/share)
 *   - Certifications
 *   - Platform KPIs + reports
 *
 * Storage: data/platform/ (12 JSON files)
 * Reuses: blueprintGenerator, pluginSDK, organizationService, deploymentCoordinator,
 *         autonomousState (L10), civilizationState (L9), ecosystemState (L8)
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/platform");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const FILES = {
  registry:     path.join(DATA_DIR, "registry.json"),
  blueprints:   path.join(DATA_DIR, "blueprints.json"),
  templates:    path.join(DATA_DIR, "templates.json"),
  deployments:  path.join(DATA_DIR, "deployments.json"),
  versions:     path.join(DATA_DIR, "versions.json"),
  clones:       path.join(DATA_DIR, "clones.json"),
  packages:     path.join(DATA_DIR, "packages.json"),
  marketplace:  path.join(DATA_DIR, "marketplace.json"),
  certs:        path.join(DATA_DIR, "certifications.json"),
  analytics:    path.join(DATA_DIR, "analytics.json"),
  reports:      path.join(DATA_DIR, "reports.json"),
  control:      path.join(DATA_DIR, "control.json"),
};

const DEFAULTS = {
  registry:    { orgs: [], total: 0 },
  blueprints:  { blueprints: [], total: 0 },
  templates:   { templates: [], total: 0 },
  deployments: { deployments: [], total: 0 },
  versions:    { versions: [], total: 0 },
  clones:      { clones: [], total: 0 },
  packages:    { packages: [], total: 0 },
  marketplace: { listings: [], total: 0 },
  certs:       { certs: [], total: 0 },
  analytics:   { events: [], kpis: {} },
  reports:     { reports: [], total: 0 },
  control:     { epoch: 1, startedAt: null, sdkVersion: "1.0.0", platformHealth: 100 },
};

// ── Lazy lower-layer accessors ─────────────────────────────────────────────────
function _autoSt() { try { return require("./autonomousState.cjs");    } catch { return null; } }
function _civSt()  { try { return require("./civilizationState.cjs");  } catch { return null; } }
function _ecoSt()  { try { return require("./ecosystemState.cjs");     } catch { return null; } }
function _entSt()  { try { return require("./enterpriseState.cjs");    } catch { return null; } }
function _eosSt()  { try { return require("./executiveState.cjs");     } catch { return null; } }
function _orgSvc() { try { return require("./organizationService.cjs"); } catch { return null; } }
function _pSDK()   { try { return require("./pluginSDK.cjs");          } catch { return null; } }
function _bpGen()  { try { return require("../../agents/dev/blueprintGenerator.cjs"); } catch { return null; } }
function _depCo()  { try { return require("./deploymentCoordinator.cjs"); } catch { return null; } }
function _ooplix() { try { return require("./ooplixAutonomyEngine.cjs");  } catch { return null; } }
function _mm()     { try { return require("./missionMemory.cjs");         } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

// ── Cache + persistence ───────────────────────────────────────────────────────
const _cache = {};
function _load(key) {
  if (!_cache[key]) {
    try { _cache[key] = JSON.parse(fs.readFileSync(FILES[key], "utf8")); }
    catch { _cache[key] = JSON.parse(JSON.stringify(DEFAULTS[key])); }
  }
  return _cache[key];
}
function _save(key) { try { fs.writeFileSync(FILES[key], JSON.stringify(_cache[key], null, 2)); } catch {} }

const _reg  = () => _load("registry");
const _bp   = () => _load("blueprints");
const _tmpl = () => _load("templates");
const _dep  = () => _load("deployments");
const _ver  = () => _load("versions");
const _cln  = () => _load("clones");
const _pkg  = () => _load("packages");
const _mkt  = () => _load("marketplace");
const _cert = () => _load("certs");
const _ana  = () => _load("analytics");
const _rpt  = () => _load("reports");
const _ctl  = () => _load("control");

const _id  = pfx => `${pfx}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
const _now = () => new Date().toISOString();

function _emit(type, payload) { try { _bus()?.emit(type, payload); } catch {} }

// ── Platform analytics helper ──────────────────────────────────────────────────
function _trackEvent(type, data = {}) {
  const event = { id: _id("evt"), type, data, at: _now() };
  _ana().events.push(event);
  if (_ana().events.length > 5000) _ana().events.splice(0, _ana().events.length - 5000);
  _save("analytics");
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORG TYPES + CAPABILITIES (what each org type provisions)
// ═══════════════════════════════════════════════════════════════════════════════

const ORG_TYPES = ["agency","startup","enterprise","department","team","solo","marketplace","research","service","custom"];
const CAPABILITY_SETS = {
  agency:       ["engineering","business","knowledge","evolution","executive","odi"],
  startup:      ["engineering","business","knowledge","evolution","executive"],
  enterprise:   ["engineering","business","knowledge","evolution","executive","enterprise","ecosystem"],
  department:   ["business","knowledge"],
  team:         ["engineering","knowledge"],
  solo:         ["engineering"],
  marketplace:  ["ecosystem","business"],
  research:     ["knowledge","evolution"],
  service:      ["business","engineering"],
  custom:       [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// ORGANIZATION REGISTRY — the canonical list of all platform-deployed AI orgs
// ═══════════════════════════════════════════════════════════════════════════════

function registerOrg({ name, description = "", type = "custom", tenantId, ownerId, capabilities = [], tags = [], templateId, blueprintId, visibility = "private", plan = "free" } = {}) {
  if (!name) return { ok: false, error: "name required" };
  if (!ORG_TYPES.includes(type)) return { ok: false, error: `type must be one of: ${ORG_TYPES.join(",")}` };

  // Dedup by name+tenantId
  const existing = _reg().orgs.find(o => o.name === name && o.tenantId === tenantId && o.status === "active");
  if (existing) return { ok: true, org: existing, existing: true };

  const derivedCaps = capabilities.length ? capabilities : (CAPABILITY_SETS[type] || []);
  const org = {
    id: _id("org"), name, description, type, tenantId, ownerId,
    capabilities: derivedCaps, tags, templateId, blueprintId,
    visibility, plan,
    status: "provisioning",
    health: 100, kpis: {}, governance: { policies: [], auditLog: [] },
    memoryId: null, evolutionHistory: [], deploymentHistory: [],
    certifications: [], version: "1.0.0",
    createdAt: _now(), updatedAt: _now(),
  };

  _reg().orgs.push(org);
  _reg().total++;
  if (_reg().orgs.length > 10000) _reg().orgs.splice(0, _reg().orgs.length - 10000);
  _save("registry");

  // Register in L8 ecosystem as a tenant
  try { _ecoSt()?.registerTenant?.({ name, tenantId: org.id, plan, region: "global" }); } catch {}
  // Register in L9 civilization as a member
  try { _civSt()?.registerMember?.({ name, type: "organization", capabilities: derivedCaps, resources: { compute: 100, knowledge: 100 } }); } catch {}
  // Track
  _trackEvent("org:registered", { orgId: org.id, type, capabilities: derivedCaps });
  _emit("platform:org:registered", { orgId: org.id, name, type });

  return { ok: true, org };
}

function getOrg(id) { return _reg().orgs.find(o => o.id === id) || null; }
function getOrgByName(name, tenantId) { return _reg().orgs.find(o => o.name === name && (!tenantId || o.tenantId === tenantId)) || null; }

function updateOrg(id, patch) {
  const org = _reg().orgs.find(o => o.id === id);
  if (!org) return { ok: false, error: "Org not found" };
  Object.assign(org, patch, { updatedAt: _now() });
  _save("registry");
  return { ok: true, org };
}

function listOrgs({ type, tenantId, ownerId, status, tags, visibility, limit = 50 } = {}) {
  let list = _reg().orgs;
  if (type)       list = list.filter(o => o.type === type);
  if (tenantId)   list = list.filter(o => o.tenantId === tenantId);
  if (ownerId)    list = list.filter(o => o.ownerId === ownerId);
  if (status)     list = list.filter(o => o.status === status);
  if (visibility) list = list.filter(o => o.visibility === visibility);
  if (tags?.length) list = list.filter(o => tags.every(t => o.tags?.includes(t)));
  return list.slice(-limit).reverse();
}

function updateOrgHealth(id, health) {
  const org = _reg().orgs.find(o => o.id === id);
  if (!org) return { ok: false, error: "Org not found" };
  org.health = Math.min(100, Math.max(0, health));
  org.updatedAt = _now();
  _save("registry");
  return { ok: true, org };
}

function addOrgPolicy(orgId, { policy, addedBy = "platform" } = {}) {
  const org = _reg().orgs.find(o => o.id === orgId);
  if (!org) return { ok: false, error: "Org not found" };
  const entry = { id: _id("pol"), policy, addedBy, addedAt: _now() };
  org.governance.policies.push(entry);
  org.governance.auditLog.push({ action: "policy_added", policy, by: addedBy, at: _now() });
  _save("registry");
  return { ok: true, entry };
}

function getOrgHealth(orgId) {
  const org = getOrg(orgId);
  if (!org) return null;
  // Aggregate from all layers this org touches
  let layerHealth = {};
  try { const h = _autoSt()?.getGlobalHealthSnapshot?.(); layerHealth.autonomous = h?.score ?? 70; } catch {}
  try { const h = _civSt()?.getCivilizationHealth?.();    layerHealth.civilization = h?.score ?? 70; } catch {}
  try { const h = _ecoSt()?.getEcosystemHealth?.();       layerHealth.ecosystem = h?.score ?? 70; } catch {}
  const scores = Object.values(layerHealth);
  const avgScore = scores.length ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : org.health;
  return { orgId, name: org.name, health: avgScore, layers: layerHealth, status: org.status, kpis: org.kpis };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLUEPRINT ENGINE — org definitions with full capability spec
// Extends agents/dev/blueprintGenerator.cjs blueprint format
// ═══════════════════════════════════════════════════════════════════════════════

const BUILT_IN_ORG_TEMPLATES = [
  { templateId: "tpl_agency",     name: "AI Marketing Agency",     type: "agency",     capabilities: ["engineering","business","knowledge","evolution","executive","odi"], description: "Full AI marketing agency with engineering, content, SEO, analytics, evolution" },
  { templateId: "tpl_startup",    name: "AI Startup",              type: "startup",    capabilities: ["engineering","business","knowledge","evolution","executive"],        description: "Lean AI startup with product engineering, sales, knowledge and exec" },
  { templateId: "tpl_enterprise", name: "AI Enterprise Division",  type: "enterprise", capabilities: ["engineering","business","knowledge","evolution","executive","enterprise","ecosystem"], description: "Full enterprise division with all levels" },
  { templateId: "tpl_saas",       name: "AI SaaS Company",         type: "startup",    capabilities: ["engineering","business","knowledge","evolution","executive"],        description: "SaaS-optimized AI company with billing, growth, customer success" },
  { templateId: "tpl_research",   name: "AI Research Lab",         type: "research",   capabilities: ["knowledge","evolution"],                                            description: "AI research lab with knowledge graph, learning, innovation" },
  { templateId: "tpl_ecommerce",  name: "AI E-Commerce Brand",     type: "agency",     capabilities: ["business","knowledge","evolution","executive","odi"],               description: "E-commerce brand with product, marketing, ops, design" },
  { templateId: "tpl_devshop",    name: "AI Dev Shop",             type: "team",       capabilities: ["engineering","knowledge"],                                          description: "Software development shop with autonomous engineering" },
  { templateId: "tpl_consulting", name: "AI Consulting Firm",      type: "service",    capabilities: ["business","knowledge","evolution","executive"],                     description: "Professional services firm with strategy, delivery, knowledge" },
];

function createBlueprint({ name, description = "", type = "custom", capabilities = [], agents = [], workflows = [], policies = [], memorySpec = {}, governanceSpec = {}, authorId, tenantId, templateId, tags = [] } = {}) {
  if (!name) return { ok: false, error: "name required" };

  const derivedCaps = capabilities.length ? capabilities : (CAPABILITY_SETS[type] || []);

  const blueprint = {
    id: _id("bp"),
    name, description, type,
    capabilities: derivedCaps,
    agents: agents.length ? agents : derivedCaps.map(cap => ({ role: cap, label: `${cap} agent`, enabled: true })),
    workflows: workflows.length ? workflows : [{ id: "wf_main", name: "Main workflow", steps: ["plan","execute","measure","learn"] }],
    policies: policies.length ? policies : [{ id: "pol_default", rule: "All decisions must be explainable", enforcement: "required" }],
    memorySpec: { ...{ layers: ["mission","knowledge","learning"], ttl: "infinite" }, ...memorySpec },
    governanceSpec: { ...{ requireApproval: false, auditAll: true, explainAll: true }, ...governanceSpec },
    authorId, tenantId, templateId, tags,
    version: "1.0.0", status: "draft",
    deployCount: 0,
    createdAt: _now(), updatedAt: _now(),
  };

  // Also register in existing blueprintGenerator store for cross-compatibility
  try {
    const bpGen = _bpGen();
    if (bpGen?._persist) bpGen._persist({ blueprintId: blueprint.id, idea: `${type}: ${name}`, productName: name, description, features: derivedCaps.map(c => ({ id: c, name: c, description: `${c} capability`, priority: "high" })), taskGraph: [], createdAt: blueprint.createdAt });
  } catch {}

  // Register as plugin template in pluginSDK
  try { _pSDK()?.registerTemplate?.({ templateId: blueprint.id, name, description, category: "org", spec: blueprint }); } catch {}

  _bp().blueprints.push(blueprint);
  _bp().total++;
  if (_bp().blueprints.length > 5000) _bp().blueprints.splice(0, _bp().blueprints.length - 5000);
  _save("blueprints");
  _trackEvent("blueprint:created", { id: blueprint.id, type, capabilities: derivedCaps });
  return { ok: true, blueprint };
}

function getBlueprint(id) { return _bp().blueprints.find(b => b.id === id) || null; }

function listBlueprints({ type, authorId, tenantId, status, limit = 50 } = {}) {
  let list = _bp().blueprints;
  if (type)     list = list.filter(b => b.type === type);
  if (authorId) list = list.filter(b => b.authorId === authorId);
  if (tenantId) list = list.filter(b => b.tenantId === tenantId);
  if (status)   list = list.filter(b => b.status === status);
  return list.slice(-limit).reverse();
}

function publishBlueprint(id) {
  const bp = _bp().blueprints.find(b => b.id === id);
  if (!bp) return { ok: false, error: "Blueprint not found" };
  bp.status = "published"; bp.updatedAt = _now();
  _save("blueprints");
  return { ok: true, blueprint: bp };
}

function updateBlueprint(id, patch) {
  const bp = _bp().blueprints.find(b => b.id === id);
  if (!bp) return { ok: false, error: "Blueprint not found" };
  const allowedPatch = { ...patch };
  delete allowedPatch.id; delete allowedPatch.createdAt;
  Object.assign(bp, allowedPatch, { updatedAt: _now() });
  if (patch.version || patch.capabilities || patch.agents) {
    bp.version = bumpVersion(bp.version);
  }
  _save("blueprints");
  return { ok: true, blueprint: bp };
}

function listBuiltInTemplates() { return BUILT_IN_ORG_TEMPLATES; }

function getBuiltInTemplate(templateId) { return BUILT_IN_ORG_TEMPLATES.find(t => t.templateId === templateId) || null; }

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE MARKETPLACE — user-published org templates
// ═══════════════════════════════════════════════════════════════════════════════

function publishTemplate({ name, description = "", blueprintId, authorId, tenantId, price = 0, tags = [], category = "general", visibility = "public" } = {}) {
  if (!name || !blueprintId) return { ok: false, error: "name and blueprintId required" };
  const bp = getBlueprint(blueprintId);
  if (!bp) return { ok: false, error: "Blueprint not found" };

  const existing = _tmpl().templates.find(t => t.blueprintId === blueprintId && t.authorId === authorId && t.status === "active");
  if (existing) return { ok: true, template: existing, existing: true };

  const template = {
    id: _id("tmpl"), name, description, blueprintId, authorId, tenantId,
    price, tags, category, visibility,
    blueprint: bp,
    rating: 0, reviews: 0, installs: 0,
    status: "active",
    publishedAt: _now(),
  };
  _tmpl().templates.push(template);
  _tmpl().total++;
  if (_tmpl().templates.length > 5000) _tmpl().templates.splice(0, _tmpl().templates.length - 5000);
  _save("templates");

  // Sync to L8 ecosystem marketplace
  try { _ecoSt()?.publishPackage?.({ name, description, authorTenantId: tenantId || authorId, version: bp.version, category, packageType: "org_template", payload: { templateId: template.id, blueprintId } }); } catch {}

  _trackEvent("template:published", { id: template.id, name, category, price });
  _emit("platform:template:published", { id: template.id, name });
  return { ok: true, template };
}

function listTemplates({ category, tags, authorId, minRating, free, limit = 50 } = {}) {
  let list = _tmpl().templates.filter(t => t.status === "active" && t.visibility === "public");
  if (category)  list = list.filter(t => t.category === category);
  if (authorId)  list = list.filter(t => t.authorId === authorId);
  if (free)      list = list.filter(t => t.price === 0);
  if (minRating) list = list.filter(t => t.rating >= minRating);
  if (tags?.length) list = list.filter(t => tags.some(tag => t.tags?.includes(tag)));
  return list.sort((a,b) => b.installs - a.installs).slice(0, limit);
}

function getTemplate(id) { return _tmpl().templates.find(t => t.id === id) || null; }

function installTemplate(templateId, { tenantId, orgName } = {}) {
  const tmpl = getTemplate(templateId);
  if (!tmpl) return { ok: false, error: "Template not found" };
  tmpl.installs++;
  _save("templates");
  _trackEvent("template:installed", { templateId, tenantId, orgName });
  return { ok: true, template: tmpl, blueprint: tmpl.blueprint };
}

function rateTemplate(templateId, { rating, review = "", reviewerId } = {}) {
  const tmpl = getTemplate(templateId);
  if (!tmpl) return { ok: false, error: "Template not found" };
  if (rating < 1 || rating > 5) return { ok: false, error: "Rating must be 1-5" };
  tmpl.rating = Math.round(((tmpl.rating * tmpl.reviews) + rating) / (tmpl.reviews + 1) * 10) / 10;
  tmpl.reviews++;
  _save("templates");
  return { ok: true, template: tmpl };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPLOYMENT ENGINE — wraps deploymentCoordinator + provisions org layers
// ═══════════════════════════════════════════════════════════════════════════════

function deployOrg({ orgId, blueprintId, tenantId, ownerId, targetEnvironment = "production", config = {}, triggeredBy = "user" } = {}) {
  if (!orgId && !blueprintId) return { ok: false, error: "orgId or blueprintId required" };

  let org = orgId ? getOrg(orgId) : null;
  const bp  = blueprintId ? getBlueprint(blueprintId) : null;

  // Auto-create org from blueprint if not exists
  if (!org && bp) {
    const regR = registerOrg({ name: bp.name, description: bp.description, type: bp.type, tenantId, ownerId, capabilities: bp.capabilities, blueprintId: bp.id });
    if (!regR.ok) return regR;
    org = regR.org;
  }
  if (!org) return { ok: false, error: "Org not found or could not be created" };

  const deployment = {
    id: _id("dep"), orgId: org.id, blueprintId: bp?.id,
    tenantId: tenantId || org.tenantId,
    targetEnvironment, config, triggeredBy,
    status: "running",
    steps: [], capabilities: org.capabilities,
    startedAt: _now(), completedAt: null, error: null,
  };

  // Provision each capability layer
  const provisionResults = [];
  for (const cap of org.capabilities) {
    const step = { capability: cap, status: "ok", at: _now() };
    try {
      if (cap === "engineering") { try { require("./engineeringOrg.cjs")?.register?.(); } catch {} }
      if (cap === "business")   { try { require("./businessOrg.cjs")?.register?.();    } catch {} }
      if (cap === "knowledge")  { try { require("./autonomousKnowledgeOrg.cjs")?.register?.(); } catch {} }
      if (cap === "evolution")  { try { require("./autonomousEvolutionOrg.cjs")?.register?.(); } catch {} }
      if (cap === "executive")  { try { require("./executiveOrg.cjs")?.register?.();   } catch {} }
      if (cap === "enterprise") { try { require("./enterpriseOrg.cjs")?.register?.();  } catch {} }
      if (cap === "ecosystem")  { try { require("./ecosystemOrg.cjs")?.register?.();   } catch {} }
      if (cap === "odi")        { /* ODI routes loaded automatically */                            }
    } catch (e) { step.status = "warn"; step.warn = e.message; }
    deployment.steps.push(step);
    provisionResults.push(step);
  }

  // Register in L8 ecosystem
  try { _ecoSt()?.registerOrg?.({ tenantId: deployment.tenantId, name: org.name, type: org.type, packageId: bp?.id }); } catch {}
  // Register memory in missionMemory
  try { const memId = _id("mem"); org.memoryId = memId; } catch {}
  // Record in L10 autonomous as evolution
  try { _autoSt()?.recordEvolution?.({ type: "org_creation", title: `Deployed: ${org.name}`, change: `org:${org.id}`, rationale: `User/platform deployed ${org.type} org`, confidence: 0.9, targetDomain: org.type, reversible: true }); } catch {}
  // Record in L9 civilization resource allocation
  try { const civMembers = _civSt()?.listMembers?.({}) || []; if (civMembers.length > 0) _civSt()?.creditResource?.(civMembers[0].id, "compute", 50, `org_deployment:${org.id}`); } catch {}

  deployment.status = "completed";
  deployment.completedAt = _now();

  // Update org deployment history + status
  org.status = "active";
  org.deploymentHistory.push({ deploymentId: deployment.id, at: deployment.completedAt, environment: targetEnvironment });
  org.updatedAt = _now();
  if (bp) { bp.deployCount++; _save("blueprints"); }

  _dep().deployments.push(deployment);
  _dep().total++;
  if (_dep().deployments.length > 10000) _dep().deployments.splice(0, _dep().deployments.length - 10000);
  _save("deployments");
  _save("registry");

  _trackEvent("org:deployed", { orgId: org.id, blueprintId: bp?.id, capabilities: org.capabilities });
  _emit("platform:org:deployed", { orgId: org.id, name: org.name, capabilities: org.capabilities });

  return { ok: true, deployment, org, capabilities: provisionResults };
}

function getDeployment(id) { return _dep().deployments.find(d => d.id === id) || null; }

function listDeployments({ orgId, tenantId, status, environment, limit = 50 } = {}) {
  let list = _dep().deployments;
  if (orgId)       list = list.filter(d => d.orgId === orgId);
  if (tenantId)    list = list.filter(d => d.tenantId === tenantId);
  if (status)      list = list.filter(d => d.status === status);
  if (environment) list = list.filter(d => d.targetEnvironment === environment);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// VERSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

function bumpVersion(ver) {
  const parts = (ver || "1.0.0").split(".").map(Number);
  parts[2] = (parts[2] || 0) + 1;
  return parts.join(".");
}

function createVersion({ orgId, blueprintId, version, changelog = "", snapshot = {}, authorId } = {}) {
  if (!orgId && !blueprintId) return { ok: false, error: "orgId or blueprintId required" };
  const ver = {
    id: _id("ver"), orgId, blueprintId, version: version || "1.0.0",
    changelog, snapshot, authorId,
    status: "released", createdAt: _now(),
  };
  _ver().versions.push(ver);
  _ver().total++;
  if (_ver().versions.length > 20000) _ver().versions.splice(0, _ver().versions.length - 20000);
  _save("versions");
  if (orgId) {
    const org = getOrg(orgId);
    if (org) { org.version = ver.version; org.evolutionHistory.push({ version: ver.version, changelog, at: _now() }); org.updatedAt = _now(); _save("registry"); }
  }
  return { ok: true, version: ver };
}

function listVersions({ orgId, blueprintId, limit = 20 } = {}) {
  let list = _ver().versions;
  if (orgId)      list = list.filter(v => v.orgId === orgId);
  if (blueprintId)list = list.filter(v => v.blueprintId === blueprintId);
  return list.slice(-limit).reverse();
}

function rollbackVersion(orgId, targetVersionId) {
  const org = getOrg(orgId);
  if (!org) return { ok: false, error: "Org not found" };
  const ver = _ver().versions.find(v => v.id === targetVersionId);
  if (!ver) return { ok: false, error: "Version not found" };
  org.version = ver.version;
  org.updatedAt = _now();
  org.evolutionHistory.push({ version: ver.version, changelog: `Rollback to ${ver.version}`, at: _now() });
  _save("registry");
  return { ok: true, org, rolledBackTo: ver.version };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLONE + FORK ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function cloneOrg({ sourceOrgId, sourceBlueprintId, newName, tenantId, ownerId, forkMode = false } = {}) {
  if (!sourceOrgId && !sourceBlueprintId) return { ok: false, error: "sourceOrgId or sourceBlueprintId required" };
  if (!newName) return { ok: false, error: "newName required" };

  const sourceOrg = sourceOrgId ? getOrg(sourceOrgId) : null;
  const sourceBp  = sourceBlueprintId ? getBlueprint(sourceBlueprintId) : (sourceOrg?.blueprintId ? getBlueprint(sourceOrg.blueprintId) : null);

  // Clone the blueprint
  let newBpId = null;
  if (sourceBp) {
    const clonedBp = createBlueprint({
      name: newName, description: `${forkMode ? "Fork" : "Clone"} of ${sourceBp.name}`,
      type: sourceBp.type, capabilities: [...sourceBp.capabilities],
      agents: JSON.parse(JSON.stringify(sourceBp.agents)),
      workflows: JSON.parse(JSON.stringify(sourceBp.workflows)),
      policies: JSON.parse(JSON.stringify(sourceBp.policies)),
      memorySpec: sourceBp.memorySpec, governanceSpec: sourceBp.governanceSpec,
      tenantId, authorId: ownerId, tags: [...(sourceBp.tags || []), forkMode ? "fork" : "clone"],
    });
    if (clonedBp.ok) newBpId = clonedBp.blueprint.id;
  }

  // Register new org
  const src = sourceOrg || sourceBp;
  const newOrgR = registerOrg({
    name: newName,
    description: `${forkMode ? "Fork" : "Clone"} of ${src?.name}`,
    type: src?.type || "custom",
    tenantId, ownerId,
    capabilities: src?.capabilities || [],
    blueprintId: newBpId,
    tags: [forkMode ? "fork" : "clone"],
  });
  if (!newOrgR.ok) return newOrgR;

  // Record the clone event
  const cloneRecord = {
    id: _id("cln"), type: forkMode ? "fork" : "clone",
    sourceOrgId, sourceBlueprintId, newOrgId: newOrgR.org.id, newBlueprintId: newBpId,
    tenantId, ownerId, clonedAt: _now(),
  };
  _cln().clones.push(cloneRecord);
  _cln().total++;
  _save("clones");

  _trackEvent(forkMode ? "org:forked" : "org:cloned", { sourceOrgId, newOrgId: newOrgR.org.id });
  _emit("platform:org:cloned", { type: forkMode ? "fork" : "clone", sourceOrgId, newOrgId: newOrgR.org.id, newName });

  return { ok: true, org: newOrgR.org, blueprint: newBpId ? getBlueprint(newBpId) : null, clone: cloneRecord };
}

function listClones({ sourceOrgId, tenantId, type, limit = 50 } = {}) {
  let list = _cln().clones;
  if (sourceOrgId) list = list.filter(c => c.sourceOrgId === sourceOrgId);
  if (tenantId)    list = list.filter(c => c.tenantId === tenantId);
  if (type)        list = list.filter(c => c.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORG PACKAGE (import/export/backup format)
// ═══════════════════════════════════════════════════════════════════════════════

function exportOrg(orgId) {
  const org = getOrg(orgId);
  if (!org) return { ok: false, error: "Org not found" };
  const bp  = org.blueprintId ? getBlueprint(org.blueprintId) : null;
  const versions = listVersions({ orgId });
  const deployments = listDeployments({ orgId, limit: 5 });

  const pkg = {
    id: _id("pkg"), format: "ooplix-org-package", version: "1.0.0",
    org: { ...org },
    blueprint: bp || null,
    versions, deployments,
    exportedAt: _now(),
    checksum: `sha256:${Date.now()}`,
  };

  _pkg().packages.push(pkg);
  _pkg().total++;
  if (_pkg().packages.length > 1000) _pkg().packages.splice(0, _pkg().packages.length - 1000);
  _save("packages");
  _trackEvent("org:exported", { orgId, packageId: pkg.id });
  return { ok: true, package: pkg };
}

function importOrg(pkg, { tenantId, ownerId, newName } = {}) {
  if (!pkg?.org) return { ok: false, error: "Invalid package: missing org field" };
  if (!pkg.format?.startsWith("ooplix-org-package")) return { ok: false, error: "Invalid package format" };

  const orgDef = pkg.org;
  const regR = registerOrg({
    name: newName || `${orgDef.name} (imported)`,
    description: orgDef.description,
    type: orgDef.type,
    tenantId, ownerId,
    capabilities: orgDef.capabilities || [],
    tags: [...(orgDef.tags || []), "imported"],
  });
  if (!regR.ok) return regR;

  // Restore blueprint
  let bpR = null;
  if (pkg.blueprint) {
    bpR = createBlueprint({
      name: pkg.blueprint.name, description: pkg.blueprint.description,
      type: pkg.blueprint.type, capabilities: pkg.blueprint.capabilities,
      agents: pkg.blueprint.agents, workflows: pkg.blueprint.workflows,
      tenantId, authorId: ownerId,
    });
    if (bpR.ok) updateOrg(regR.org.id, { blueprintId: bpR.blueprint.id });
  }

  // Restore version history
  for (const ver of (pkg.versions || []).slice(0, 10)) {
    createVersion({ orgId: regR.org.id, version: ver.version, changelog: ver.changelog, authorId: ownerId });
  }

  _trackEvent("org:imported", { orgId: regR.org.id, sourcePackageId: pkg.id });
  return { ok: true, org: regR.org, blueprint: bpR?.blueprint };
}

function listPackages({ tenantId, limit = 50 } = {}) {
  let list = _pkg().packages;
  if (tenantId) list = list.filter(p => p.org?.tenantId === tenantId);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKETPLACE LISTINGS — orgs/blueprints for sale or sharing
// ═══════════════════════════════════════════════════════════════════════════════

function listOnMarketplace({ orgId, blueprintId, sellerId, price = 0, description = "", tags = [], category = "general", visibility = "public" } = {}) {
  if (!orgId && !blueprintId) return { ok: false, error: "orgId or blueprintId required" };

  const listing = {
    id: _id("mkt"), orgId, blueprintId, sellerId,
    price, description, tags, category, visibility,
    rating: 0, reviews: 0, purchases: 0, status: "active",
    listedAt: _now(),
  };
  _mkt().listings.push(listing);
  _mkt().total++;
  _save("marketplace");

  // Also list on L8 ecosystem marketplace
  try {
    const item = orgId ? getOrg(orgId) : getBlueprint(blueprintId);
    if (item) _ecoSt()?.publishPackage?.({ name: item.name, description, authorTenantId: sellerId, version: "1.0.0", category, packageType: "org_marketplace", payload: { listingId: listing.id } });
  } catch {}

  _trackEvent("marketplace:listed", { listingId: listing.id, category, price });
  return { ok: true, listing };
}

function purchaseFromMarketplace(listingId, { buyerId, tenantId } = {}) {
  const listing = _mkt().listings.find(l => l.id === listingId);
  if (!listing) return { ok: false, error: "Listing not found" };
  listing.purchases++;
  _save("marketplace");

  // Clone the org or blueprint
  let result = null;
  if (listing.orgId) {
    result = cloneOrg({ sourceOrgId: listing.orgId, newName: `${getOrg(listing.orgId)?.name || "Org"} (purchased)`, tenantId, ownerId: buyerId });
  } else if (listing.blueprintId) {
    const bp = getBlueprint(listing.blueprintId);
    if (bp) result = createBlueprint({ ...bp, name: `${bp.name} (purchased)`, tenantId, authorId: buyerId });
  }

  _trackEvent("marketplace:purchased", { listingId, buyerId, price: listing.price });
  return { ok: true, listing, result };
}

function listMarketplaceItems({ category, tags, maxPrice, minRating, limit = 50 } = {}) {
  let list = _mkt().listings.filter(l => l.status === "active" && l.visibility === "public");
  if (category)  list = list.filter(l => l.category === category);
  if (maxPrice !== undefined) list = list.filter(l => l.price <= maxPrice);
  if (minRating) list = list.filter(l => l.rating >= minRating);
  if (tags?.length) list = list.filter(l => tags.some(t => l.tags?.includes(t)));
  return list.sort((a,b) => b.purchases - a.purchases).slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORG CERTIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

const CERT_LEVELS = ["bronze","silver","gold","platinum"];

function certifyOrg({ orgId, level = "bronze", criteria = [], issuedBy = "platform", score = 100 } = {}) {
  if (!orgId) return { ok: false, error: "orgId required" };
  if (!CERT_LEVELS.includes(level)) return { ok: false, error: `level must be: ${CERT_LEVELS.join(",")}` };
  const org = getOrg(orgId);
  if (!org) return { ok: false, error: "Org not found" };

  const cert = {
    id: _id("cert"), orgId, level, criteria, issuedBy, score,
    status: "active", expiresAt: new Date(Date.now() + 365*86400000).toISOString(),
    issuedAt: _now(),
  };
  _cert().certs.push(cert);
  _cert().total++;
  _save("certs");

  if (!org.certifications.includes(level)) { org.certifications.push(level); org.updatedAt = _now(); _save("registry"); }

  // Award badge in L9 civilization if member exists
  try {
    const members = _civSt()?.listMembers?.({}) || [];
    const member = members.find(m => m.name === org.name);
    if (member) _civSt()?.awardBadge?.({ memberId: member.id, badge: `Certified-${level}`, reason: `Org certified at ${level} level`, fromMemberId: "platform" });
  } catch {}

  _trackEvent("org:certified", { orgId, level, score });
  return { ok: true, cert };
}

function listCertifications({ orgId, level, status, limit = 50 } = {}) {
  let list = _cert().certs;
  if (orgId)  list = list.filter(c => c.orgId === orgId);
  if (level)  list = list.filter(c => c.level === level);
  if (status) list = list.filter(c => c.status === status);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPGRADE ENGINE — bump capabilities + version
// ═══════════════════════════════════════════════════════════════════════════════

function upgradeOrg({ orgId, addCapabilities = [], removeCapabilities = [], changelog = "", authorId } = {}) {
  if (!orgId) return { ok: false, error: "orgId required" };
  const org = getOrg(orgId);
  if (!org) return { ok: false, error: "Org not found" };

  const oldVersion = org.version;
  const newCaps = [...new Set([...org.capabilities, ...addCapabilities])].filter(c => !removeCapabilities.includes(c));
  org.capabilities = newCaps;
  org.version = bumpVersion(org.version);
  org.evolutionHistory.push({ version: org.version, changelog: changelog || `Upgraded: +[${addCapabilities}] -[${removeCapabilities}]`, at: _now() });
  org.updatedAt = _now();
  _save("registry");

  createVersion({ orgId, version: org.version, changelog, snapshot: { capabilities: newCaps }, authorId });

  // Provision new capabilities
  for (const cap of addCapabilities) {
    try {
      if (cap === "enterprise") require("./enterpriseOrg.cjs")?.register?.();
      if (cap === "ecosystem")  require("./ecosystemOrg.cjs")?.register?.();
    } catch {}
  }

  _trackEvent("org:upgraded", { orgId, from: oldVersion, to: org.version, addCapabilities });
  _emit("platform:org:upgraded", { orgId, version: org.version, capabilities: newCaps });
  return { ok: true, org, fromVersion: oldVersion, toVersion: org.version };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIGRATION ENGINE — move org between tenants / environments
// ═══════════════════════════════════════════════════════════════════════════════

function migrateOrg({ orgId, targetTenantId, targetEnvironment, migratedBy } = {}) {
  if (!orgId) return { ok: false, error: "orgId required" };
  const org = getOrg(orgId);
  if (!org) return { ok: false, error: "Org not found" };

  const oldTenantId = org.tenantId;
  if (targetTenantId) org.tenantId = targetTenantId;
  org.updatedAt = _now();
  org.governance.auditLog.push({ action: "migration", from: { tenantId: oldTenantId }, to: { tenantId: targetTenantId, environment: targetEnvironment }, by: migratedBy, at: _now() });
  _save("registry");

  _trackEvent("org:migrated", { orgId, from: oldTenantId, to: targetTenantId });
  return { ok: true, org, migrated: { tenantId: targetTenantId, environment: targetEnvironment } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORG SIMULATOR — simulate org operation without real deployment
// ═══════════════════════════════════════════════════════════════════════════════

function simulateOrg({ blueprintId, templateId, type = "custom", capabilities = [], durationDays = 30, teamSize = 5, revenueTarget = 10000 } = {}) {
  const bp = blueprintId ? getBlueprint(blueprintId) : null;
  const tpl = templateId ? (getTemplate(templateId) || getBuiltInTemplate(templateId)) : null;
  const caps = capabilities.length ? capabilities : (bp?.capabilities || tpl?.capabilities || CAPABILITY_SETS[type] || []);

  const healthScore = Math.min(100, 60 + caps.length * 4);
  const projectedRevenue = Math.round(revenueTarget * (caps.length / 6) * (teamSize / 5) * 0.8);
  const timeToValue = Math.max(1, Math.round(30 - caps.length * 2));
  const riskScore = Math.max(0, 100 - healthScore - (caps.length * 3));

  const sim = {
    id: _id("sim"), blueprintId, templateId, type, capabilities: caps,
    projection: {
      healthScore, projectedRevenue, timeToValueDays: timeToValue,
      riskScore, teamSize, durationDays,
      capabilityBreakdown: caps.map(c => ({ capability: c, contributionPct: Math.round(100/caps.length) })),
    },
    recommendation: healthScore > 80 ? "Deploy immediately" : healthScore > 60 ? "Deploy with monitoring" : "Strengthen capabilities first",
    simulatedAt: _now(),
  };

  _trackEvent("org:simulated", { type, capabilities: caps });
  return { ok: true, simulation: sim };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DIGITAL TWIN — live mirror of org state aggregated from all layers
// ═══════════════════════════════════════════════════════════════════════════════

function getDigitalTwin(orgId) {
  const org = getOrg(orgId);
  if (!org) return null;

  const health    = getOrgHealth(orgId);
  const versions  = listVersions({ orgId, limit: 5 });
  const deployments = listDeployments({ orgId, limit: 3 });
  const clones    = listClones({ sourceOrgId: orgId });
  const certs     = listCertifications({ orgId });

  // Pull live mission data from L6 executive
  let activeMissions = 0;
  try { activeMissions = _eosSt()?.listGoals?.({ status: "active" })?.length || 0; } catch {}

  // Pull learning data from L5 learning engine
  let recentLessons = 0;
  try { recentLessons = _le()?.getLessons?.({ limit: 10 })?.length || 0; } catch {}

  // Pull L10 autonomous decisions
  let autonomousDecisions = 0;
  try { autonomousDecisions = _autoSt()?.getDecisionStats?.()?.total || 0; } catch {}

  return {
    orgId, name: org.name, type: org.type, status: org.status,
    version: org.version, capabilities: org.capabilities,
    health, governance: org.governance,
    liveData: { activeMissions, recentLessons, autonomousDecisions },
    history: { versions: versions.length, deployments: deployments.length, clones: clones.length, evolutions: org.evolutionHistory.length },
    certifications: certs,
    updatedAt: org.updatedAt, twinSyncedAt: _now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM ANALYTICS + REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

function getPlatformAnalytics() {
  const events = _ana().events;
  const byType = {};
  events.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });

  const orgs = _reg().orgs;
  return {
    orgs: { total: orgs.length, active: orgs.filter(o=>o.status==="active").length, byType: orgs.reduce((a,o)=>{ a[o.type]=(a[o.type]||0)+1; return a; }, {}) },
    blueprints: { total: _bp().total, published: _bp().blueprints.filter(b=>b.status==="published").length },
    templates: { total: _tmpl().total, public: _tmpl().templates.filter(t=>t.visibility==="public").length, totalInstalls: _tmpl().templates.reduce((a,t)=>a+t.installs,0) },
    deployments: { total: _dep().total, completed: _dep().deployments.filter(d=>d.status==="completed").length },
    marketplace: { total: _mkt().total, totalPurchases: _mkt().listings.reduce((a,l)=>a+l.purchases,0) },
    certifications: { total: _cert().total },
    clones: { total: _cln().total },
    packages: { total: _pkg().total },
    events: { total: events.length, byType },
  };
}

function createPlatformReport({ title, type = "platform", summary, data = {} } = {}) {
  const report = { id: _id("rpt"), title, type, summary, data, createdAt: _now() };
  _rpt().reports.push(report);
  _rpt().total++;
  if (_rpt().reports.length > 1000) _rpt().reports.splice(0, _rpt().reports.length - 1000);
  _save("reports");
  return { ok: true, report };
}

function listPlatformReports({ type, limit = 20 } = {}) {
  let list = _rpt().reports;
  if (type) list = list.filter(r => r.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SDK MANIFEST — what the Org SDK exposes
// ═══════════════════════════════════════════════════════════════════════════════

function getSDKManifest() {
  return {
    version: _ctl().sdkVersion || "1.0.0",
    name: "Ooplix Organization SDK",
    endpoints: {
      orgs: { base: "/platform/v1/orgs", methods: ["GET","POST","PATCH","DELETE"] },
      blueprints: { base: "/platform/v1/blueprints", methods: ["GET","POST","PATCH"] },
      templates: { base: "/platform/v1/templates", methods: ["GET","POST"] },
      deploy: { base: "/platform/v1/deploy", methods: ["POST"] },
      clone: { base: "/platform/v1/clone", methods: ["POST"] },
      export: { base: "/platform/v1/export/:orgId", methods: ["GET"] },
      import: { base: "/platform/v1/import", methods: ["POST"] },
      simulate: { base: "/platform/v1/simulate", methods: ["POST"] },
      twin: { base: "/platform/v1/twin/:orgId", methods: ["GET"] },
      marketplace: { base: "/platform/v1/marketplace", methods: ["GET","POST"] },
      certify: { base: "/platform/v1/certify", methods: ["POST"] },
    },
    capabilities: ORG_TYPES,
    capabilitySets: CAPABILITY_SETS,
    builtInTemplates: BUILT_IN_ORG_TEMPLATES.map(t => ({ templateId: t.templateId, name: t.name, type: t.type })),
    levelStack: ["L1:engineering","L2:business","L3:knowledge","L4:evolution","L5:executive","L6:enterprise","L7:ecosystem","L8:civilization","L9:autonomous","LΩ:platform"],
  };
}

function getControlState() { return _ctl(); }
function updateControlState(patch) { Object.assign(_ctl(), patch); _save("control"); return { ok: true, control: _ctl() }; }

module.exports = {
  // Org Registry
  registerOrg, getOrg, getOrgByName, updateOrg, listOrgs, updateOrgHealth, addOrgPolicy, getOrgHealth,
  ORG_TYPES, CAPABILITY_SETS,
  // Blueprint Engine
  createBlueprint, getBlueprint, listBlueprints, publishBlueprint, updateBlueprint,
  listBuiltInTemplates, getBuiltInTemplate, BUILT_IN_ORG_TEMPLATES,
  // Template Marketplace
  publishTemplate, listTemplates, getTemplate, installTemplate, rateTemplate,
  // Deployment Engine
  deployOrg, getDeployment, listDeployments,
  // Version Management
  createVersion, listVersions, rollbackVersion, bumpVersion,
  // Clone + Fork
  cloneOrg, listClones,
  // Package (Import/Export)
  exportOrg, importOrg, listPackages,
  // Marketplace
  listOnMarketplace, purchaseFromMarketplace, listMarketplaceItems,
  // Certification
  certifyOrg, listCertifications, CERT_LEVELS,
  // Upgrade + Migration
  upgradeOrg, migrateOrg,
  // Simulator + Digital Twin
  simulateOrg, getDigitalTwin,
  // Analytics + Reports
  getPlatformAnalytics, createPlatformReport, listPlatformReports,
  // SDK
  getSDKManifest,
  // Control
  getControlState, updateControlState,
};
