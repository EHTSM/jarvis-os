"use strict";
/**
 * marketplaceCatalogEngine.cjs — POST-Ω P13 Autonomous Marketplace
 *
 * Discovers, indexes and serves every reusable asset produced anywhere
 * in Ooplix. Does NOT duplicate /marketplace/catalog (plugin catalog).
 * Extends it with 13 asset types: agents, workflows, blueprints,
 * product templates, company templates, plugins, SDK packages,
 * automation packs, design systems, UI components, knowledge packs,
 * prompt packs, deployment recipes.
 *
 * Discovery sources:
 *   companyBlueprintEngine  → blueprints + company templates
 *   productPlannerEngine    → product templates (plan objectives)
 *   productionBibleEngine   → workflows + automation packs + deployment recipes
 *   pluginSDK               → plugins + SDK packages
 *   marketplaceService      → existing plugin catalog entries
 *   founderWorkRegistry     → automation packs
 *   knowledgeReasoningEngine → knowledge packs
 *   workforceManager        → AI agents
 *   continuousLearningEngine → prompt packs (lessons/recommendations)
 *   designSystemAI          → design systems + UI components (ODI X)
 *
 * Storage: data/marketplace-catalog.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "auto-marketplace-catalog.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _bp  = () => _try(() => require("./companyBlueprintEngine.cjs"));
const _ppe = () => _try(() => require("./productPlannerEngine.cjs"));
const _pb  = () => _try(() => require("./productionBibleEngine.cjs"));
const _sdk = () => _try(() => require("./pluginSDK.cjs"));
const _ms  = () => _try(() => require("./marketplaceService.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));
const _okb = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _wfm = () => _try(() => require("./workforceManager.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _oai = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _obi = () => _try(() => require("./businessReasoningEngine.cjs"));
const _bt  = () => _try(() => require("./businessTemplateEngine.cjs"));
const _cf  = () => _try(() => require("./companyFactory.cjs"));

function _ts() { return new Date().toISOString(); }
function _id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Asset types ───────────────────────────────────────────────────────────────

const ASSET_TYPES = [
  "agent", "workflow", "blueprint", "product_template", "company_template",
  "plugin", "sdk_package", "automation_pack", "design_system", "ui_component",
  "knowledge_pack", "prompt_pack", "deployment_recipe",
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { assets: [], stats: { total: 0, byType: {}, discovered: 0, published: 0 }, lastDiscovery: null, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.assets)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.assets.length > 2000) d.assets = d.assets.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

function _computeStats(assets) {
  const byType = {};
  ASSET_TYPES.forEach(t => { byType[t] = 0; });
  assets.forEach(a => { if (byType[a.type] !== undefined) byType[a.type]++; });
  return {
    total:      assets.length,
    byType,
    published:  assets.filter(a => a.status === "published").length,
    discovered: assets.filter(a => a.status === "discovered").length,
  };
}

// ── Discovery per source ──────────────────────────────────────────────────────

function _discoverBlueprints(existing) {
  const existingIds = new Set(existing.map(a => a.sourceId));
  const assets      = [];
  try {
    const bps = _bp()?.listBlueprints?.({ limit: 500 }) || {};
    (bps.blueprints || []).forEach(bp => {
      if (existingIds.has(bp.id)) return;
      assets.push({
        id:       _id("mca"),
        type:     "blueprint",
        name:     bp.name,
        desc:     bp.description || `Blueprint: ${bp.templateId}`,
        sourceId: bp.id,
        source:   "companyBlueprintEngine",
        tags:     [bp.templateId, bp.domain, "blueprint"].filter(Boolean),
        templateId: bp.templateId,
        status:   "published",
        version:  "1.0.0",
        downloads: 0,
        rating:    0,
        createdAt: bp.createdAt || _ts(),
        discoveredAt: _ts(),
      });
    });
  } catch {}
  return assets;
}

function _discoverCompanyTemplates(existing) {
  const existingIds = new Set(existing.map(a => a.sourceId));
  const assets = [];
  try {
    const runs = _cf()?.listRuns?.({ limit: 200 });
    const seen = new Set();
    (runs?.runs || []).forEach(r => {
      const tid = r.templateId;
      if (!tid || seen.has(tid) || existingIds.has(`template_${tid}`)) return;
      seen.add(tid);
      assets.push({
        id:       _id("mca"),
        type:     "company_template",
        name:     `${tid} Company Template`,
        desc:     `Production-tested company template: ${tid}`,
        sourceId: `template_${tid}`,
        source:   "companyFactory",
        tags:     [tid, "company", "template"],
        templateId: tid,
        status:   "published",
        version:  "1.0.0",
        downloads: 0,
        rating:    0,
        createdAt: _ts(),
        discoveredAt: _ts(),
      });
    });
  } catch {}
  return assets;
}

function _discoverProductTemplates(existing) {
  const existingIds = new Set(existing.map(a => a.sourceId));
  const assets = [];
  try {
    const plans = _ppe()?.listPlans?.({ limit: 200 });
    (plans?.plans || []).forEach(p => {
      if (existingIds.has(p.id)) return;
      assets.push({
        id:       _id("mca"),
        type:     "product_template",
        name:     p.objective.slice(0, 60),
        desc:     p.objective,
        sourceId: p.id,
        source:   "productPlannerEngine",
        tags:     ["product", "template", p.complexity?.level].filter(Boolean),
        complexity: p.complexity?.level,
        status:   "published",
        version:  "1.0.0",
        downloads: 0,
        rating:    0,
        createdAt: p.createdAt,
        discoveredAt: _ts(),
      });
    });
  } catch {}
  return assets;
}

function _discoverWorkflowsAndRecipes(existing) {
  const existingIds = new Set(existing.map(a => a.sourceId));
  const assets = [];
  try {
    const bible = _pb()?.getBible?.();
    (bible?.workflows || []).forEach(wf => {
      if (existingIds.has(wf.id)) return;
      const type = ["deployment","launch"].includes(wf.category) ? "deployment_recipe"
        : wf.category === "self_improvement" ? "automation_pack"
        : "workflow";
      assets.push({
        id:       _id("mca"),
        type,
        name:     wf.title,
        desc:     wf.description || wf.title,
        sourceId: wf.id,
        source:   "productionBibleEngine",
        tags:     [wf.category, type, "automated"].filter(Boolean),
        category: wf.category,
        automated: wf.automated !== false,
        status:   "published",
        version:  "1.0.0",
        downloads: 0,
        rating:    0,
        createdAt: _ts(),
        discoveredAt: _ts(),
      });
    });
  } catch {}
  return assets;
}

function _discoverAutomationPacks(existing) {
  const existingIds = new Set(existing.map(a => a.sourceId));
  const assets = [];
  try {
    const reg = _fwr()?.getRegistry?.();
    (reg?.workflows || []).forEach(wf => {
      const sid = `fwr_${wf.id || wf.name}`;
      if (existingIds.has(sid)) return;
      assets.push({
        id:       _id("mca"),
        type:     "automation_pack",
        name:     wf.name || wf.title,
        desc:     wf.description || `Automation: ${wf.name}`,
        sourceId: sid,
        source:   "founderWorkRegistry",
        tags:     [wf.class, "automation", "founder"].filter(Boolean),
        automationClass: wf.class,
        minutesSaved: wf.minutesPerWeek || 0,
        status:   "published",
        version:  "1.0.0",
        downloads: 0,
        rating:    0,
        createdAt: _ts(),
        discoveredAt: _ts(),
      });
    });
  } catch {}
  return assets;
}

function _discoverPluginsAndSDK(existing) {
  const existingIds = new Set(existing.map(a => a.sourceId));
  const assets = [];
  try {
    const list = _sdk()?.listPlugins?.() || {};
    (list.plugins || []).forEach(p => {
      if (existingIds.has(p.id)) return;
      assets.push({
        id:       _id("mca"),
        type:     "plugin",
        name:     p.name || p.id,
        desc:     p.description || `Plugin: ${p.id}`,
        sourceId: p.id,
        source:   "pluginSDK",
        tags:     ["plugin", "sdk"].concat(p.capabilities || []),
        status:   "published",
        version:  p.version || "1.0.0",
        downloads: 0,
        rating:    0,
        createdAt: _ts(),
        discoveredAt: _ts(),
      });
    });
  } catch {}
  // SDK packages — seed from platform layer capabilities
  const sdkPackages = [
    { id: "sdk_mission_orchestrator",  name: "Mission Orchestrator SDK",  desc: "Orchestrate autonomous missions" },
    { id: "sdk_workforce_os",          name: "Workforce OS SDK",           desc: "Build and manage agent teams" },
    { id: "sdk_workspace_mesh",        name: "Workspace Mesh SDK",         desc: "Route commands across workspaces" },
    { id: "sdk_knowledge_graph",       name: "Knowledge Graph SDK",        desc: "Query and update the knowledge graph" },
    { id: "sdk_evolution_engine",      name: "Evolution Engine SDK",       desc: "Integrate self-evolution loops" },
  ];
  sdkPackages.forEach(pkg => {
    if (existingIds.has(pkg.id)) return;
    assets.push({
      id: _id("mca"), type: "sdk_package", name: pkg.name, desc: pkg.desc,
      sourceId: pkg.id, source: "platformSDK",
      tags: ["sdk", "package", "developer"],
      status: "published", version: "1.0.0", downloads: 0, rating: 0,
      createdAt: _ts(), discoveredAt: _ts(),
    });
  });
  return assets;
}

function _discoverKnowledgePacks(existing) {
  const existingIds = new Set(existing.map(a => a.sourceId));
  const assets = [];
  try {
    const stats = _okb()?.getStats?.() || {};
    if (stats.total > 0) {
      const sid = "knowledge_pack_okb_v1";
      if (!existingIds.has(sid)) {
        assets.push({
          id: _id("mca"), type: "knowledge_pack",
          name: "OKB X Knowledge Intelligence Pack",
          desc: "Knowledge reasoning, quality scoring, benchmarks and predictions from OKB X V1",
          sourceId: sid, source: "knowledgeReasoningEngine",
          tags: ["knowledge", "ai", "intelligence", "okb"],
          status: "published", version: "1.0.0", downloads: 0, rating: 0,
          createdAt: _ts(), discoveredAt: _ts(),
        });
      }
    }
  } catch {}
  // Prompt packs from CLE lessons
  try {
    const raw  = _cle()?.getRecommendations?.() || {};
    const recs = Array.isArray(raw) ? raw : (raw.recommendations || []);
    const open = recs.filter(r => r.status === "open");
    if (open.length > 0) {
      const sid = "prompt_pack_cle_recommendations";
      if (!existingIds.has(sid)) {
        assets.push({
          id: _id("mca"), type: "prompt_pack",
          name: "CLE Recommendation Prompt Pack",
          desc: `${open.length} curated AI prompts derived from continuous learning recommendations`,
          sourceId: sid, source: "continuousLearningEngine",
          tags: ["prompts", "ai", "recommendations", "cle"],
          promptCount: open.length,
          status: "published", version: "1.0.0", downloads: 0, rating: 0,
          createdAt: _ts(), discoveredAt: _ts(),
        });
      }
    }
  } catch {}
  return assets;
}

function _discoverAgents(existing) {
  const existingIds = new Set(existing.map(a => a.sourceId));
  const assets = [];
  // Discover agent types from workforce missions
  try {
    const missions = _wfm()?.listMissions?.({ limit: 100 });
    const domains  = [...new Set((missions?.missions || []).map(m => m.domain).filter(Boolean))];
    domains.forEach(domain => {
      const sid = `agent_domain_${domain}`;
      if (existingIds.has(sid)) return;
      assets.push({
        id: _id("mca"), type: "agent",
        name: `${domain} Autonomous Agent`,
        desc: `Specialized autonomous agent for ${domain} tasks`,
        sourceId: sid, source: "workforceManager",
        tags: ["agent", "autonomous", domain],
        domain,
        status: "published", version: "1.0.0", downloads: 0, rating: 0,
        createdAt: _ts(), discoveredAt: _ts(),
      });
    });
  } catch {}
  return assets;
}

// ── Core: discover ────────────────────────────────────────────────────────────

function discover() {
  const d       = _load();
  const existing = d.assets;

  const newAssets = [
    ..._discoverBlueprints(existing),
    ..._discoverCompanyTemplates(existing),
    ..._discoverProductTemplates(existing),
    ..._discoverWorkflowsAndRecipes(existing),
    ..._discoverAutomationPacks(existing),
    ..._discoverPluginsAndSDK(existing),
    ..._discoverKnowledgePacks(existing),
    ..._discoverAgents(existing),
  ];

  d.assets      = [...existing, ...newAssets];
  d.stats       = _computeStats(d.assets);
  d.lastDiscovery = _ts();
  _save(d);

  return {
    ok:        true,
    discovered: newAssets.length,
    total:     d.assets.length,
    byType:    d.stats.byType,
  };
}

// ── Query functions ───────────────────────────────────────────────────────────

function listAssets({ type, status, tag, limit = 50, offset = 0 } = {}) {
  let list = _load().assets;
  if (type)   list = list.filter(a => a.type   === type);
  if (status) list = list.filter(a => a.status === status);
  if (tag)    list = list.filter(a => (a.tags || []).includes(tag));
  const total = list.length;
  return { ok: true, assets: list.slice(offset, offset + limit), total, limit, offset };
}

function getAsset(id) { return _load().assets.find(a => a.id === id) || null; }

function searchAssets(query, { type, limit = 20 } = {}) {
  if (!query?.trim()) return listAssets({ type, limit });
  const q    = query.toLowerCase();
  let   list = _load().assets.filter(a =>
    a.name?.toLowerCase().includes(q) ||
    a.desc?.toLowerCase().includes(q) ||
    (a.tags || []).some(t => t?.toLowerCase().includes(q))
  );
  if (type) list = list.filter(a => a.type === type);
  return { ok: true, assets: list.slice(0, limit), total: list.length };
}

function publishAsset({ type, name, desc, tags = [], source, version = "1.0.0", metadata = {} }) {
  if (!type || !name) return { ok: false, error: "type and name required" };
  if (!ASSET_TYPES.includes(type)) return { ok: false, error: `unknown type: ${type}` };
  const asset = {
    id: _id("mca"), type, name, desc: desc || name,
    sourceId: _id("src"), source: source || "manual",
    tags, status: "published", version,
    downloads: 0, rating: 0,
    metadata,
    createdAt: _ts(), discoveredAt: _ts(),
  };
  const d = _load();
  d.assets.push(asset);
  d.stats = _computeStats(d.assets);
  _save(d);
  return { ok: true, asset };
}

function recordDownload(assetId) {
  const d = _load();
  const a = d.assets.find(x => x.id === assetId);
  if (!a) return { ok: false, error: "asset not found" };
  a.downloads = (a.downloads || 0) + 1;
  a.lastDownloadedAt = _ts();
  _save(d);
  return { ok: true, downloads: a.downloads };
}

function getStats() {
  const d = _load();
  return { ...d.stats, ASSET_TYPES, lastDiscovery: d.lastDiscovery, updatedAt: d.updatedAt };
}

module.exports = {
  ASSET_TYPES, discover, listAssets, getAsset, searchAssets,
  publishAsset, recordDownload, getStats,
};
