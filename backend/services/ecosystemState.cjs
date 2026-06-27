"use strict";
/**
 * Ecosystem Layer — State (LEVEL 8)
 *
 * Makes Ooplix a multi-tenant AI Ecosystem Platform.
 * Sits above Enterprise (L7) → Executive (L6) → Orgs (L1-5).
 *
 * What this layer adds that L1-7 does NOT have:
 *   - Ecosystem-level tenant registry (orgs as deployable packages)
 *   - Unified marketplace registry (capability, agent, integration, API, plugin)
 *   - Cross-org routing table + permission matrix
 *   - Cross-org mission exchange (tasks flowing between tenants)
 *   - Shared knowledge exchange
 *   - Developer platform registry (public APIs, SDK versions, webhooks)
 *   - Trust + reputation scoring
 *   - Ecosystem health + KPIs
 *
 * Reuses: pluginSDK (capability/plugin), marketplaceService (catalog),
 *          extensionRuntime (extension lifecycle), pluginManagerService,
 *          aiRegistry (AI providers), runtimeEventBus, missionMemory,
 *          enterpriseState (company/product/customer), executiveState (goals)
 *
 * Storage: data/ecosystem/ (10 JSON files — all owned by this layer)
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/ecosystem");
const FILES = {
  state:     path.join(DATA_DIR, "state.json"),     // tenants, orgs, routing, permissions
  market:    path.join(DATA_DIR, "market.json"),    // marketplace listings: cap/agent/integration/api/plugin
  exchange:  path.join(DATA_DIR, "exchange.json"),  // cross-org missions + knowledge exchange items
  developer: path.join(DATA_DIR, "developer.json"), // public APIs, SDK versions, webhooks, dev apps
  trust:     path.join(DATA_DIR, "trust.json"),     // trust scores, reputation events
  kpis:      path.join(DATA_DIR, "kpis.json"),      // per-domain KPIs
  memory:    path.join(DATA_DIR, "memory.json"),    // ecosystem memory
  reports:   path.join(DATA_DIR, "reports.json"),   // ecosystem reports
  packages:  path.join(DATA_DIR, "packages.json"),  // org deployment packages
  context:   path.join(DATA_DIR, "context.json"),   // global ecosystem context
};

// ── Lazy accessors — delegate reads, never duplicate storage ─────────────────
function _entSt() { try { return require("./enterpriseState.cjs");    } catch { return null; } }
function _entWf() { try { return require("./enterpriseWorkflow.cjs"); } catch { return null; } }
function _eosSt() { try { return require("./executiveState.cjs");     } catch { return null; } }
function _eosWf() { try { return require("./executiveWorkflow.cjs");  } catch { return null; } }
function _plgSdk(){ try { return require("./pluginSDK.cjs");          } catch { return null; } }
function _plgMgr(){ try { return require("./pluginManagerService.cjs"); } catch { return null; } }
function _mktSvc(){ try { return require("./marketplaceService.cjs"); } catch { return null; } }
function _extRt() { try { return require("./extensionRuntime.cjs");   } catch { return null; } }
function _aiReg() { try { return require("./aiRegistry.cjs");         } catch { return null; } }
function _mdlMkt(){ try { return require("./modelMarketplace.cjs");   } catch { return null; } }
function _mm()    { try { return require("./missionMemory.cjs");      } catch { return null; } }
function _le()    { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _bus()   { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _sup()   { try { return require("./agentRuntimeSupervisor.cjs"); } catch { return null; } }

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  state: {
    tenants: [], orgs: [], routing: [], permissions: [],
  },
  market: {
    listings: [],          // unified listing across all marketplace types
  },
  exchange: {
    missionExchange: [],   // cross-org mission requests
    knowledgeItems: [],    // shared knowledge items
    workflowTemplates: [], // shared workflow templates
    promptLibrary: [],     // shared prompts
    designSystems: [],     // shared design systems
    automationTemplates:[], // shared automation
  },
  developer: {
    apps: [], apis: [], webhooks: [], sdkVersions: [],
  },
  trust: {
    scores: {},            // { [entityId]: { score, events: [] } }
  },
  kpis:    {},
  memory:  [],
  reports: [],
  packages: [],
  context: { totalTenants: 0, totalListings: 0, ecosystemHealth: 100, lastSync: null },
};

const _cache = {};
function _load(key) {
  if (!_cache[key]) {
    try { _cache[key] = JSON.parse(fs.readFileSync(FILES[key], "utf8")); }
    catch { _cache[key] = JSON.parse(JSON.stringify(DEFAULTS[key])); }
  }
  return _cache[key];
}
function _save(key) {
  try { fs.writeFileSync(FILES[key], JSON.stringify(_cache[key], null, 2)); } catch {}
}

const _s  = () => _load("state");
const _mk = () => _load("market");
const _ex = () => _load("exchange");
const _dv = () => _load("developer");
const _tr = () => _load("trust");
const _k  = () => _load("kpis");
const _m  = () => _load("memory");
const _r  = () => _load("reports");
const _pk = () => _load("packages");
const _cx = () => _load("context");

const _id = pfx => `${pfx}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

// ── Domain IDs ────────────────────────────────────────────────────────────────
const DOMAIN_IDS = [
  "eco_registry","eco_org_registry","eco_company_registry","eco_workspace_registry",
  "eco_marketplace","eco_cap_market","eco_agent_market","eco_integration_market",
  "eco_api_market","eco_plugin_runtime","eco_extension_sdk","eco_developer",
  "eco_public_api","eco_event_exchange","eco_cross_org_comm","eco_mission_exchange",
  "eco_knowledge_exchange","eco_trust","eco_analytics","eco_director",
];

function _kpi(domainId) {
  const k = _k();
  if (!k[domainId]) {
    k[domainId] = { domainId, tenantsOnboarded: 0, listingsPublished: 0, missionsExchanged: 0, knowledgeShared: 0, trustEvents: 0, reportsGenerated: 0, lastTickAt: null, tickCount: 0 };
    _save("kpis");
  }
  return k[domainId];
}

// ═══════════════════════════════════════════════════════════════════════════════
// TENANTS (multi-tenant registry — one entry per deployed org/company/product)
// ═══════════════════════════════════════════════════════════════════════════════

const TENANT_TYPES = ["organization","enterprise","startup","product","agent","developer","partner"];

function registerTenant({ name, type = "organization", ownerId, companyId, plan = "free", region = "global", capabilities = [], metadata = {} } = {}) {
  if (!name) return { ok: false, error: "name required" };
  const s = _s();
  if (s.tenants.some(t => t.name === name && t.status === "active"))
    return { ok: false, error: "Duplicate active tenant" };
  const tenant = {
    id: _id("etnt"), name, type, ownerId, companyId, plan, region, capabilities, metadata,
    status: "active", tier: plan === "enterprise" ? "enterprise" : plan === "pro" ? "pro" : "standard",
    trustScore: 70, joinedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  s.tenants.push(tenant);
  _kpi("eco_registry").tenantsOnboarded++;
  _save("state"); _save("kpis");
  try { _bus()?.emit("ecosystem:tenant:registered", { id: tenant.id, name, type }); } catch {}
  return { ok: true, tenant };
}

function listTenants({ type, plan, region, status, limit = 100 } = {}) {
  let list = _s().tenants;
  if (type)   list = list.filter(t => t.type === type);
  if (plan)   list = list.filter(t => t.plan === plan);
  if (region) list = list.filter(t => t.region === region);
  if (status) list = list.filter(t => t.status === status);
  return list.slice(-limit).reverse();
}

function getTenant(id) { return _s().tenants.find(t => t.id === id) || null; }
function updateTenant(id, patch) {
  const t = _s().tenants.find(x => x.id === id);
  if (!t) return { ok: false, error: "Not found" };
  Object.assign(t, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, tenant: t };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORG REGISTRY (deployable org packages — Engineering, Marketing, CS, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

function registerOrg({ tenantId, name, type, packageId, version = "1.0.0", capabilities = [], config = {}, deployedAt } = {}) {
  if (!tenantId || !name) return { ok: false, error: "tenantId and name required" };
  const org = {
    id: _id("eorg"), tenantId, name, type: type || name.toLowerCase().replace(/\s+/g,"_"),
    packageId, version, capabilities, config,
    status: "active", instanceCount: 1,
    deployedAt: deployedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  _s().orgs.push(org);
  _kpi("eco_org_registry").tenantsOnboarded++;
  _save("state"); _save("kpis");
  try { _bus()?.emit("ecosystem:org:registered", { id: org.id, tenantId, name }); } catch {}
  return { ok: true, org };
}

function listOrgs({ tenantId, type, status } = {}) {
  let list = _s().orgs;
  if (tenantId) list = list.filter(o => o.tenantId === tenantId);
  if (type)     list = list.filter(o => o.type === type);
  if (status)   list = list.filter(o => o.status === status);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORG PACKAGES (deployable bundles: "Deploy Engineering Org", "Deploy Startup")
// ═══════════════════════════════════════════════════════════════════════════════

const BUILTIN_PACKAGES = [
  { id: "pkg_engineering",   name: "Engineering Organization",  type: "org", version: "1.0.0", orgs: ["engineering_org"],   description: "Full engineering org: 20 departments, CI/CD, code review, sprint planning",    capabilities: ["code","ci","review","deploy"],       tags: ["engineering","tech"] },
  { id: "pkg_marketing",     name: "Marketing Organization",    type: "org", version: "1.0.0", orgs: ["business_org"],       description: "Marketing + content + distribution org integrated with CRM",                   capabilities: ["marketing","content","seo","ads"],   tags: ["marketing","growth"] },
  { id: "pkg_customer_success",name:"Customer Success Org",     type: "org", version: "1.0.0", orgs: ["business_org"],       description: "CS org with onboarding, retention, health scoring, NPS",                       capabilities: ["cs","onboarding","nps","retention"], tags: ["customer","success"] },
  { id: "pkg_finance",       name: "Finance Organization",      type: "org", version: "1.0.0", orgs: ["enterprise_div"],     description: "Finance division: budgets, forecasts, P&L, billing",                           capabilities: ["finance","billing","forecasting"],   tags: ["finance","ops"] },
  { id: "pkg_legal",         name: "Legal Organization",        type: "org", version: "1.0.0", orgs: ["enterprise_div"],     description: "Legal division: contracts, compliance, IP management",                         capabilities: ["legal","contracts","compliance"],    tags: ["legal","compliance"] },
  { id: "pkg_knowledge",     name: "Knowledge Organization",    type: "org", version: "1.0.0", orgs: ["knowledge_org"],      description: "Knowledge capture, validation, graph, and learning org",                       capabilities: ["knowledge","search","graph","learn"],tags: ["knowledge","ai"] },
  { id: "pkg_design",        name: "Design Organization",       type: "org", version: "1.0.0", orgs: ["odi_org"],            description: "ODI: screenshot, component gen, design system, vision QA",                     capabilities: ["design","ui","ux","components"],     tags: ["design","ux"] },
  { id: "pkg_startup",       name: "Complete Startup",          type: "bundle", version: "1.0.0", orgs: ["engineering_org","business_org","knowledge_org"], description: "Full startup: engineering + business + knowledge orgs with executive layer", capabilities: ["code","sales","marketing","knowledge","executive"], tags: ["startup","bundle"] },
  { id: "pkg_enterprise",    name: "Complete Enterprise",       type: "bundle", version: "1.0.0", orgs: ["all_orgs","enterprise_layer"], description: "Full AI enterprise: all 5 orgs + executive + enterprise layer",             capabilities: ["all"],                              tags: ["enterprise","bundle"] },
  { id: "pkg_artificial_org",name: "Artificial Organization",   type: "ai_org", version: "1.0.0", orgs: ["ai_agents"],      description: "Pure AI org: 20 autonomous agents with no human counterparts",                  capabilities: ["autonomous","ai","agents","adapt"],  tags: ["ai","autonomous"] },
];

function listPackages({ type, tags } = {}) {
  let list = [...BUILTIN_PACKAGES, ..._pk().filter(p => p.source === "custom")];
  if (type) list = list.filter(p => p.type === type);
  if (tags) { const t = Array.isArray(tags) ? tags : [tags]; list = list.filter(p => t.some(tag => (p.tags||[]).includes(tag))); }
  return list;
}

function getPackage(id) {
  return BUILTIN_PACKAGES.find(p => p.id === id) || _pk().find(p => p.id === id) || null;
}

function publishPackage({ name, type, version = "1.0.0", description = "", capabilities = [], tags = [], orgs = [], config = {}, authorTenantId } = {}) {
  if (!name || !authorTenantId) return { ok: false, error: "name and authorTenantId required" };
  const pkg = {
    id: _id("epkg"), name, type: type || "org", version, description, capabilities, tags,
    orgs, config, authorTenantId, source: "custom",
    publishedAt: new Date().toISOString(), downloads: 0, rating: 0, reviews: 0,
  };
  _pk().push(pkg);
  _save("packages");
  _kpi("eco_marketplace").listingsPublished++;
  _save("kpis");
  return { ok: true, package: pkg };
}

function deployPackage(packageId, { tenantId, targetName, config = {} } = {}) {
  if (!tenantId || !packageId) return { ok: false, error: "tenantId and packageId required" };
  const pkg = getPackage(packageId);
  if (!pkg) return { ok: false, error: "Package not found" };
  const deployment = {
    id: _id("edep"), packageId, tenantId, targetName: targetName || pkg.name,
    config, status: "active",
    deployedAt: new Date().toISOString(),
  };
  // Register org for tenant
  const orgResult = registerOrg({ tenantId, name: targetName || pkg.name, type: pkg.type, packageId, version: pkg.version, capabilities: pkg.capabilities, config });
  // Increment download count for custom packages
  const customPkg = _pk().find(p => p.id === packageId);
  if (customPkg) { customPkg.downloads = (customPkg.downloads || 0) + 1; _save("packages"); }
  try { _bus()?.emit("ecosystem:package:deployed", { packageId, tenantId, name: targetName || pkg.name }); } catch {}
  return { ok: true, deployment, org: orgResult.org };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MARKETPLACE REGISTRY (unified: capability/agent/integration/api/plugin)
// ═══════════════════════════════════════════════════════════════════════════════

const LISTING_TYPES = ["capability","agent","integration","api","plugin","model","workflow","prompt","design_system","template","automation"];

function publishListing({ tenantId, name, type, description = "", category = "general", price = 0, pricingModel = "free", capabilities = [], tags = [], config = {}, version = "1.0.0" } = {}) {
  if (!name || !type) return { ok: false, error: "name and type required" };
  if (!LISTING_TYPES.includes(type)) return { ok: false, error: `type must be one of: ${LISTING_TYPES.join(",")}` };
  const existing = _mk().listings.find(l => l.tenantId === tenantId && l.name === name && l.type === type && l.status === "active");
  if (existing) return { ok: false, error: "Duplicate active listing" };
  const listing = {
    id: _id("emkt"), tenantId, name, type, description, category, price, pricingModel,
    capabilities, tags, config, version,
    status: "active", installs: 0, rating: 0, reviews: 0,
    publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _mk().listings.push(listing);
  _kpi("eco_marketplace").listingsPublished++;
  _save("market"); _save("kpis");
  try { _bus()?.emit("ecosystem:listing:published", { id: listing.id, name, type, tenantId }); } catch {}
  return { ok: true, listing };
}

function listListings({ type, category, tenantId, pricingModel, tags, search, limit = 50 } = {}) {
  let list = _mk().listings.filter(l => l.status === "active");
  if (type)         list = list.filter(l => l.type === type);
  if (category)     list = list.filter(l => l.category === category);
  if (tenantId)     list = list.filter(l => l.tenantId === tenantId);
  if (pricingModel) list = list.filter(l => l.pricingModel === pricingModel);
  if (tags)         { const t = Array.isArray(tags)?tags:[tags]; list = list.filter(l => t.some(tag => (l.tags||[]).includes(tag))); }
  if (search)       { const q = search.toLowerCase(); list = list.filter(l => l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)); }
  return list.slice(-limit).reverse();
}

function getListing(id) { return _mk().listings.find(l => l.id === id) || null; }

function installListing(listingId, { tenantId } = {}) {
  const listing = getListing(listingId);
  if (!listing) return { ok: false, error: "Listing not found" };
  listing.installs = (listing.installs || 0) + 1;
  listing.updatedAt = new Date().toISOString();
  _save("market");
  try { _bus()?.emit("ecosystem:listing:installed", { listingId, tenantId, name: listing.name }); } catch {}
  return { ok: true, listing };
}

function rateListing(listingId, { tenantId, rating, review = "" } = {}) {
  if (!rating || rating < 1 || rating > 5) return { ok: false, error: "rating must be 1-5" };
  const listing = getListing(listingId);
  if (!listing) return { ok: false, error: "Listing not found" };
  const totalRating = (listing.rating * listing.reviews) + rating;
  listing.reviews++;
  listing.rating = Math.round((totalRating / listing.reviews) * 10) / 10;
  listing.updatedAt = new Date().toISOString();
  _save("market");
  return { ok: true, listing };
}

// Aggregate: pull from existing pluginSDK + aiRegistry into ecosystem view
function getEcosystemMarketSummary() {
  const listings = _mk().listings;
  const byType = {};
  for (const l of listings) { byType[l.type] = (byType[l.type]||0) + 1; }

  // Pull from existing registries
  let pluginCount = 0, capabilityCount = 0, modelCount = 0;
  try { const r = _plgSdk()?.listPlugins?.({}); pluginCount = r?.total || 0; } catch {}
  try { const r = _plgSdk()?.listCapabilities?.({}); capabilityCount = r?.total || 0; } catch {}
  try { const r = _mdlMkt()?.getStats?.(); modelCount = r?.totalModels || 0; } catch {}

  return { total: listings.length, byType, externalPlugins: pluginCount, externalCapabilities: capabilityCount, externalModels: modelCount };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-ORG ROUTING + PERMISSIONS
// ═══════════════════════════════════════════════════════════════════════════════

function addRoute({ fromTenantId, toTenantId, resourceType = "mission", permissions = ["read","write"], conditions = [] } = {}) {
  if (!fromTenantId || !toTenantId) return { ok: false, error: "fromTenantId and toTenantId required" };
  const existing = _s().routing.find(r => r.fromTenantId === fromTenantId && r.toTenantId === toTenantId && r.resourceType === resourceType);
  if (existing) { Object.assign(existing, { permissions, conditions, updatedAt: new Date().toISOString() }); _save("state"); return { ok: true, route: existing, updated: true }; }
  const route = { id: _id("ert"), fromTenantId, toTenantId, resourceType, permissions, conditions, status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  _s().routing.push(route);
  _save("state");
  return { ok: true, route };
}

function listRoutes({ fromTenantId, toTenantId, resourceType } = {}) {
  let list = _s().routing;
  if (fromTenantId)  list = list.filter(r => r.fromTenantId === fromTenantId);
  if (toTenantId)    list = list.filter(r => r.toTenantId === toTenantId);
  if (resourceType)  list = list.filter(r => r.resourceType === resourceType);
  return list;
}

function checkPermission(fromTenantId, toTenantId, resourceType, action) {
  const route = _s().routing.find(r => r.fromTenantId === fromTenantId && r.toTenantId === toTenantId && r.resourceType === resourceType && r.status === "active");
  if (!route) return { allowed: false, reason: "No route defined" };
  const allowed = route.permissions.includes(action) || route.permissions.includes("*");
  return { allowed, route, action };
}

function grantPermission({ grantorId, granteeTenantId, resource, actions = ["read"], scope = "tenant", expiresAt = null } = {}) {
  if (!grantorId || !granteeTenantId) return { ok: false, error: "grantorId and granteeTenantId required" };
  const perm = { id: _id("eperm"), grantorId, granteeTenantId, resource, actions, scope, expiresAt, status: "active", grantedAt: new Date().toISOString() };
  _s().permissions.push(perm);
  _save("state");
  return { ok: true, permission: perm };
}

function listPermissions({ granteeTenantId, grantorId, resource } = {}) {
  let list = _s().permissions;
  if (granteeTenantId) list = list.filter(p => p.granteeTenantId === granteeTenantId);
  if (grantorId)       list = list.filter(p => p.grantorId === grantorId);
  if (resource)        list = list.filter(p => p.resource === resource);
  return list.filter(p => p.status === "active" && (!p.expiresAt || new Date(p.expiresAt) > new Date()));
}

// ═══════════════════════════════════════════════════════════════════════════════
// CROSS-ORG MISSION EXCHANGE
// ═══════════════════════════════════════════════════════════════════════════════

function publishMissionExchange({ fromTenantId, title, description = "", requiredCapabilities = [], reward = 0, deadline = null, priority = "medium", tags = [] } = {}) {
  if (!fromTenantId || !title) return { ok: false, error: "fromTenantId and title required" };
  const item = {
    id: _id("emex"), fromTenantId, title, description, requiredCapabilities,
    reward, deadline, priority, tags,
    status: "open", bids: [], assignedToTenantId: null,
    publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _ex().missionExchange.push(item);
  _kpi("eco_mission_exchange").missionsExchanged++;
  _save("exchange"); _save("kpis");
  try { _bus()?.emit("ecosystem:mission:published", { id: item.id, fromTenantId, title }); } catch {}
  return { ok: true, missionExchange: item };
}

function bidMissionExchange(exchangeId, { bidderTenantId, proposal = "", estimatedHours = 0 } = {}) {
  const item = _ex().missionExchange.find(m => m.id === exchangeId);
  if (!item) return { ok: false, error: "Not found" };
  if (item.status !== "open") return { ok: false, error: "Not open for bids" };
  const bid = { id: _id("ebid"), bidderTenantId, proposal, estimatedHours, at: new Date().toISOString() };
  item.bids.push(bid);
  item.updatedAt = new Date().toISOString();
  _save("exchange");
  return { ok: true, bid };
}

function assignMissionExchange(exchangeId, { toTenantId } = {}) {
  const item = _ex().missionExchange.find(m => m.id === exchangeId);
  if (!item) return { ok: false, error: "Not found" };
  item.assignedToTenantId = toTenantId;
  item.status = "assigned";
  item.updatedAt = new Date().toISOString();
  _save("exchange");
  // Also create an EOS exec mission for tracking
  try {
    _eosSt()?.createExecMission?.({ title: item.title, description: item.description, orgTargets: ["engineering","business"], priority: item.priority });
  } catch {}
  try { _bus()?.emit("ecosystem:mission:assigned", { id: exchangeId, toTenantId }); } catch {}
  return { ok: true, missionExchange: item };
}

function listMissionExchange({ fromTenantId, status, priority } = {}) {
  let list = _ex().missionExchange;
  if (fromTenantId) list = list.filter(m => m.fromTenantId === fromTenantId);
  if (status)       list = list.filter(m => m.status === status);
  if (priority)     list = list.filter(m => m.priority === priority);
  return list.slice(-50).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED KNOWLEDGE EXCHANGE
// ═══════════════════════════════════════════════════════════════════════════════

function shareKnowledge({ fromTenantId, title, content = "", type = "article", category = "general", tags = [], visibility = "public", license = "open" } = {}) {
  if (!fromTenantId || !title) return { ok: false, error: "fromTenantId and title required" };
  const item = {
    id: _id("ekn"), fromTenantId, title, content, type, category, tags, visibility, license,
    views: 0, downloads: 0, forks: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  _ex().knowledgeItems.push(item);
  _kpi("eco_knowledge_exchange").knowledgeShared++;
  _save("exchange"); _save("kpis");
  return { ok: true, knowledge: item };
}

function listKnowledge({ fromTenantId, type, category, visibility, search, limit = 50 } = {}) {
  let list = _ex().knowledgeItems;
  if (fromTenantId) list = list.filter(k => k.fromTenantId === fromTenantId);
  if (type)         list = list.filter(k => k.type === type);
  if (category)     list = list.filter(k => k.category === category);
  if (visibility)   list = list.filter(k => k.visibility === visibility);
  if (search)       { const q = search.toLowerCase(); list = list.filter(k => k.title.toLowerCase().includes(q) || (k.content||"").toLowerCase().includes(q)); }
  return list.slice(-limit).reverse();
}

// Shared workflow templates
function publishWorkflowTemplate({ fromTenantId, name, description = "", steps = [], tags = [], category = "general" } = {}) {
  if (!fromTenantId || !name) return { ok: false, error: "fromTenantId and name required" };
  const tmpl = { id: _id("ewft"), fromTenantId, name, description, steps, tags, category, uses: 0, createdAt: new Date().toISOString() };
  _ex().workflowTemplates.push(tmpl);
  _save("exchange");
  return { ok: true, template: tmpl };
}
function listWorkflowTemplates({ category, fromTenantId } = {}) {
  let list = _ex().workflowTemplates;
  if (category)     list = list.filter(t => t.category === category);
  if (fromTenantId) list = list.filter(t => t.fromTenantId === fromTenantId);
  return list;
}

// Shared prompt library
function publishPrompt({ fromTenantId, name, prompt, description = "", category = "general", tags = [], variables = [] } = {}) {
  if (!fromTenantId || !name || !prompt) return { ok: false, error: "fromTenantId, name, prompt required" };
  const p = { id: _id("epmt"), fromTenantId, name, prompt, description, category, tags, variables, uses: 0, rating: 0, createdAt: new Date().toISOString() };
  _ex().promptLibrary.push(p);
  _save("exchange");
  return { ok: true, prompt: p };
}
function listPrompts({ category, fromTenantId, search } = {}) {
  let list = _ex().promptLibrary;
  if (fromTenantId) list = list.filter(p => p.fromTenantId === fromTenantId);
  if (category)     list = list.filter(p => p.category === category);
  if (search)       { const q = search.toLowerCase(); list = list.filter(p => p.name.toLowerCase().includes(q)); }
  return list;
}

// Shared design systems
function publishDesignSystem({ fromTenantId, name, description = "", tokens = {}, components = [], figmaUrl = "", tags = [] } = {}) {
  if (!fromTenantId || !name) return { ok: false, error: "fromTenantId and name required" };
  const ds = { id: _id("eds"), fromTenantId, name, description, tokens, components, figmaUrl, tags, forks: 0, uses: 0, createdAt: new Date().toISOString() };
  _ex().designSystems.push(ds);
  _save("exchange");
  return { ok: true, designSystem: ds };
}
function listDesignSystems({ fromTenantId } = {}) {
  let list = _ex().designSystems;
  if (fromTenantId) list = list.filter(d => d.fromTenantId === fromTenantId);
  return list;
}

// Shared automation templates
function publishAutomation({ fromTenantId, name, description = "", trigger, steps = [], category = "general", tags = [] } = {}) {
  if (!fromTenantId || !name) return { ok: false, error: "fromTenantId and name required" };
  const at = { id: _id("eat"), fromTenantId, name, description, trigger, steps, category, tags, uses: 0, createdAt: new Date().toISOString() };
  _ex().automationTemplates.push(at);
  _save("exchange");
  return { ok: true, automation: at };
}
function listAutomations({ category, fromTenantId } = {}) {
  let list = _ex().automationTemplates;
  if (category)     list = list.filter(a => a.category === category);
  if (fromTenantId) list = list.filter(a => a.fromTenantId === fromTenantId);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEVELOPER PLATFORM (public APIs, SDK versions, webhooks, dev apps)
// ═══════════════════════════════════════════════════════════════════════════════

function registerDeveloperApp({ tenantId, name, description = "", scopes = [], callbackUrl = "", type = "integration" } = {}) {
  if (!tenantId || !name) return { ok: false, error: "tenantId and name required" };
  const app = {
    id: _id("eapp"), tenantId, name, description, scopes, callbackUrl, type,
    clientId: _id("cid").replace("cid_",""), clientSecret: _id("cs").replace("cs_",""),
    status: "active", requestsToday: 0, requestsTotal: 0,
    createdAt: new Date().toISOString(),
  };
  _dv().apps.push(app);
  _kpi("eco_developer").tenantsOnboarded++;
  _save("developer"); _save("kpis");
  return { ok: true, app: { ...app, clientSecret: `${app.clientSecret}***` } }; // mask secret
}

function listDeveloperApps({ tenantId, status } = {}) {
  let list = _dv().apps;
  if (tenantId) list = list.filter(a => a.tenantId === tenantId);
  if (status)   list = list.filter(a => a.status === status);
  return list.map(a => ({ ...a, clientSecret: "***" }));
}

function registerPublicAPI({ name, path: apiPath, method = "GET", description = "", category = "general", auth = "bearer", rateLimit = 1000, version = "v1" } = {}) {
  if (!name || !apiPath) return { ok: false, error: "name and path required" };
  const existing = _dv().apis.find(a => a.path === apiPath && a.method === method && a.version === version);
  if (existing) return { ok: false, error: "Duplicate API endpoint" };
  const api = { id: _id("eapi"), name, path: apiPath, method, description, category, auth, rateLimit, version, status: "active", calls: 0, registeredAt: new Date().toISOString() };
  _dv().apis.push(api);
  _kpi("eco_public_api").listingsPublished++;
  _save("developer"); _save("kpis");
  return { ok: true, api };
}

function listPublicAPIs({ category, version, method } = {}) {
  let list = _dv().apis;
  if (category) list = list.filter(a => a.category === category);
  if (version)  list = list.filter(a => a.version === version);
  if (method)   list = list.filter(a => a.method === method);
  return list;
}

function registerWebhook({ tenantId, name, event, url, secret = "", active = true } = {}) {
  if (!tenantId || !event || !url) return { ok: false, error: "tenantId, event, url required" };
  const wh = { id: _id("ewh"), tenantId, name: name || event, event, url, secret: secret ? "***" : "", active, deliveries: 0, lastDeliveredAt: null, createdAt: new Date().toISOString() };
  _dv().webhooks.push(wh);
  _save("developer");
  return { ok: true, webhook: wh };
}

function listWebhooks({ tenantId, event } = {}) {
  let list = _dv().webhooks;
  if (tenantId) list = list.filter(w => w.tenantId === tenantId);
  if (event)    list = list.filter(w => w.event === event);
  return list;
}

function registerSDKVersion({ name, version, language, releaseNotes = "", downloadUrl = "", stable = true } = {}) {
  if (!name || !version) return { ok: false, error: "name and version required" };
  const sdk = { id: _id("esdk"), name, version, language: language || "javascript", releaseNotes, downloadUrl, stable, downloads: 0, releasedAt: new Date().toISOString() };
  _dv().sdkVersions.push(sdk);
  _save("developer");
  return { ok: true, sdk };
}

function listSDKVersions({ language, stable } = {}) {
  let list = _dv().sdkVersions;
  if (language !== undefined) list = list.filter(s => s.language === language);
  if (stable !== undefined)   list = list.filter(s => s.stable === stable);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRUST + REPUTATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function recordTrustEvent({ entityId, entityType = "tenant", eventType, score, detail = "", fromTenantId } = {}) {
  if (!entityId || !eventType) return { ok: false, error: "entityId and eventType required" };
  const tr = _tr();
  if (!tr.scores[entityId]) tr.scores[entityId] = { score: 70, events: [] };
  const evt = { id: _id("etrv"), eventType, score: score || 0, detail, fromTenantId, at: new Date().toISOString() };
  tr.scores[entityId].events.push(evt);
  if (tr.scores[entityId].events.length > 100) tr.scores[entityId].events.splice(0, tr.scores[entityId].events.length - 100);
  // Adjust score
  if (score) { tr.scores[entityId].score = Math.min(100, Math.max(0, tr.scores[entityId].score + score)); }
  _save("trust");
  _kpi("eco_trust").trustEvents++;
  _save("kpis");
  return { ok: true, trust: tr.scores[entityId] };
}

function getTrustScore(entityId) {
  return _tr().scores[entityId] || { score: 70, events: [] };
}

function listTrustScores({ minScore, maxScore } = {}) {
  const scores = Object.entries(_tr().scores).map(([id, s]) => ({ entityId: id, ...s }));
  let list = scores;
  if (minScore !== undefined) list = list.filter(s => s.score >= minScore);
  if (maxScore !== undefined) list = list.filter(s => s.score <= maxScore);
  return list.sort((a,b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ECOSYSTEM HEALTH (aggregates all layers)
// ═══════════════════════════════════════════════════════════════════════════════

function getEcosystemHealth() {
  const health = { score: 100, layers: {}, alerts: [] };

  // L7 — Enterprise
  try { const h = _entSt()?.getEnterpriseHealth?.(); health.layers.enterprise = { score: h?.score || 50, companies: h?.dimensions?.companies?.active }; } catch { health.layers.enterprise = { score: 50 }; }

  // L6 — Executive
  try { const h = _eosSt()?.getGlobalHealth?.(); health.layers.executive = { score: h?.score || 50 }; } catch { health.layers.executive = { score: 50 }; }

  // Tenants
  const activeTenants = _s().tenants.filter(t => t.status === "active").length;
  health.layers.tenants = { total: _s().tenants.length, active: activeTenants, score: activeTenants > 0 ? 100 : 80 };

  // Marketplace
  const activeListings = _mk().listings.filter(l => l.status === "active").length;
  health.layers.marketplace = { total: activeListings, score: activeListings > 0 ? 100 : 80 };

  // Exchange
  const openMissions = _ex().missionExchange.filter(m => m.status === "open").length;
  const knowledgeItems = _ex().knowledgeItems.length;
  health.layers.exchange = { openMissions, knowledgeItems, score: 90 };

  // Trust — average trust score
  const scores = Object.values(_tr().scores).map(s => s.score);
  health.layers.trust = { avgScore: scores.length > 0 ? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length) : 70, entries: scores.length, score: scores.length > 0 ? Math.min(100, Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)) : 70 };

  // Agents via supervisor
  try { const agents = _sup()?.listAgents?.() || []; const running = agents.filter(a => a.status === "running").length; health.layers.agents = { total: agents.length, running, score: agents.length > 0 ? Math.round((running/agents.length)*100) : 100 }; } catch { health.layers.agents = { score: 50 }; }

  const layerScores = Object.values(health.layers).map(l => l.score || 50);
  health.score = Math.min(100, Math.max(0, Math.round(layerScores.reduce((a,b)=>a+b,0)/layerScores.length)));

  const cx = _cx();
  cx.ecosystemHealth = health.score;
  cx.totalTenants = activeTenants;
  cx.totalListings = activeListings;
  cx.lastSync = new Date().toISOString();
  _save("context");

  return health;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ECOSYSTEM DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function getEcosystemDashboard() {
  const health = getEcosystemHealth();
  const market = getEcosystemMarketSummary();
  const tenants = _s().tenants;
  const ex = _ex();
  const dv = _dv();
  const entDb = (() => { try { return _entSt()?.getEnterpriseDashboard?.() || {}; } catch { return {}; } })();

  return {
    ecosystem: {
      tenants:    { total: tenants.length, active: tenants.filter(t => t.status === "active").length },
      orgs:       { total: _s().orgs.length, active: _s().orgs.filter(o => o.status === "active").length },
      packages:   { builtin: BUILTIN_PACKAGES.length, custom: _pk().length },
      routes:     { total: _s().routing.length },
    },
    marketplace: market,
    exchange: {
      missions:    { total: ex.missionExchange.length, open: ex.missionExchange.filter(m => m.status === "open").length, assigned: ex.missionExchange.filter(m => m.status === "assigned").length },
      knowledge:   { total: ex.knowledgeItems.length },
      workflows:   { total: ex.workflowTemplates.length },
      prompts:     { total: ex.promptLibrary.length },
      designSystems:{ total: ex.designSystems.length },
      automations: { total: ex.automationTemplates.length },
    },
    developer: {
      apps:        dv.apps.length,
      publicApis:  dv.apis.length,
      webhooks:    dv.webhooks.length,
      sdkVersions: dv.sdkVersions.length,
    },
    trust: {
      entries: Object.keys(_tr().scores).length,
      avgScore: (() => { const s = Object.values(_tr().scores).map(x=>x.score); return s.length > 0 ? Math.round(s.reduce((a,b)=>a+b,0)/s.length) : 70; })(),
    },
    health,
    enterprise: entDb,
    reports: { total: _r().length },
    lastSync: _cx().lastSync,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ECOSYSTEM-WIDE SEARCH (extends enterprise search)
// ═══════════════════════════════════════════════════════════════════════════════

function ecosystemSearch(query, { types, limit = 30 } = {}) {
  if (!query) return { ok: false, error: "query required" };
  const q = query.toLowerCase();
  const all = types ? (Array.isArray(types) ? types : [types]) : ["tenant","org","listing","knowledge","prompt","workflow","package"];
  const results = [];

  if (all.includes("tenant"))   _s().tenants.forEach(t => { if (t.name.toLowerCase().includes(q)) results.push({ type:"tenant",    id:t.id, name:t.name, tenantType:t.type }); });
  if (all.includes("org"))      _s().orgs.forEach(o =>    { if (o.name.toLowerCase().includes(q)) results.push({ type:"org",       id:o.id, name:o.name, tenantId:o.tenantId }); });
  if (all.includes("listing"))  _mk().listings.filter(l=>l.status==="active").forEach(l => { if (l.name.toLowerCase().includes(q) || l.description.toLowerCase().includes(q)) results.push({ type:"listing", id:l.id, name:l.name, listingType:l.type }); });
  if (all.includes("knowledge"))_ex().knowledgeItems.forEach(k => { if (k.title.toLowerCase().includes(q)) results.push({ type:"knowledge", id:k.id, name:k.title, category:k.category }); });
  if (all.includes("prompt"))   _ex().promptLibrary.forEach(p => { if (p.name.toLowerCase().includes(q)) results.push({ type:"prompt", id:p.id, name:p.name }); });
  if (all.includes("workflow")) _ex().workflowTemplates.forEach(w => { if (w.name.toLowerCase().includes(q)) results.push({ type:"workflow", id:w.id, name:w.name }); });
  if (all.includes("package"))  listPackages().forEach(p => { if (p.name.toLowerCase().includes(q)) results.push({ type:"package", id:p.id, name:p.name, pkgType:p.type }); });

  // Also hit enterprise search
  try {
    const entR = _entSt()?.enterpriseSearch?.(query, { limit: 20 });
    if (entR?.ok) entR.results.forEach(r => results.push({ ...r, source: "enterprise" }));
  } catch {}

  return { ok: true, results: results.slice(0, limit), total: results.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY + REPORTS + KPIs
// ═══════════════════════════════════════════════════════════════════════════════

function addEcosystemMemory({ domainId, type = "signal", title, detail = "", tags = [] } = {}) {
  if (!domainId || !title) return { ok: false, error: "domainId and title required" };
  const entry = { id: _id("emem"), domainId, type, title, detail, tags, at: new Date().toISOString() };
  _m().push(entry);
  if (_m().length > 2000) _m().splice(0, _m().length - 2000);
  _save("memory");
  return { ok: true, entry };
}

function listEcosystemMemory({ domainId, type, limit = 50 } = {}) {
  let list = _m();
  if (domainId) list = list.filter(x => x.domainId === domainId);
  if (type)     list = list.filter(x => x.type === type);
  return list.slice(-limit).reverse();
}

function createEcosystemReport({ title, domainId = "eco_analytics", type = "ecosystem", data = {}, summary = "" } = {}) {
  if (!title || !domainId) return { ok: false, error: "title and domainId required" };
  const report = { id: _id("erpt"), title, domainId, type, data, summary, createdAt: new Date().toISOString() };
  _r().push(report);
  if (_r().length > 500) _r().splice(0, _r().length - 500);
  _kpi(domainId).reportsGenerated = (_kpi(domainId).reportsGenerated || 0) + 1;
  _save("reports"); _save("kpis");
  return { ok: true, report };
}

function listEcosystemReports({ domainId, type, limit = 20 } = {}) {
  let list = _r();
  if (domainId) list = list.filter(r => r.domainId === domainId);
  if (type)     list = list.filter(r => r.type === type);
  return list.slice(-limit).reverse();
}

function getEcosystemKpi(domainId)  { return _kpi(domainId); }
function getAllEcosystemKpis()       { return Object.values(_k()); }
function updateEcosystemKpi(domainId, patch) { Object.assign(_kpi(domainId), patch); _save("kpis"); }

function getEcosystemContext()          { return _cx(); }
function updateEcosystemContext(patch)  { Object.assign(_cx(), patch, { lastSync: new Date().toISOString() }); _save("context"); return _cx(); }

module.exports = {
  // Tenants
  registerTenant, listTenants, getTenant, updateTenant, TENANT_TYPES,
  // Org registry
  registerOrg, listOrgs,
  // Packages
  listPackages, getPackage, publishPackage, deployPackage, BUILTIN_PACKAGES,
  // Marketplace
  publishListing, listListings, getListing, installListing, rateListing,
  getEcosystemMarketSummary, LISTING_TYPES,
  // Routing + permissions
  addRoute, listRoutes, checkPermission, grantPermission, listPermissions,
  // Mission exchange
  publishMissionExchange, bidMissionExchange, assignMissionExchange, listMissionExchange,
  // Knowledge exchange
  shareKnowledge, listKnowledge,
  publishWorkflowTemplate, listWorkflowTemplates,
  publishPrompt, listPrompts,
  publishDesignSystem, listDesignSystems,
  publishAutomation, listAutomations,
  // Developer platform
  registerDeveloperApp, listDeveloperApps,
  registerPublicAPI, listPublicAPIs,
  registerWebhook, listWebhooks,
  registerSDKVersion, listSDKVersions,
  // Trust
  recordTrustEvent, getTrustScore, listTrustScores,
  // Health + dashboard + search
  getEcosystemHealth, getEcosystemDashboard, ecosystemSearch,
  // Memory + reports + KPIs
  addEcosystemMemory, listEcosystemMemory,
  createEcosystemReport, listEcosystemReports,
  getEcosystemKpi, getAllEcosystemKpis, updateEcosystemKpi,
  getEcosystemContext, updateEcosystemContext,
  DOMAIN_IDS,
};
