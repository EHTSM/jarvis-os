"use strict";
/**
 * Ecosystem Organization — LEVEL 8
 * 20 ecosystem domains, all via agentRuntimeSupervisor.registerAgent()
 * No new runtimes, schedulers, or event buses.
 */

const _sup = () => require("./agentRuntimeSupervisor.cjs");
const _st  = () => require("./ecosystemState.cjs");
const _wf  = () => require("./ecosystemWorkflow.cjs");
const _bus = () => { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }

let _registered = false;

function _updateKpi(domainId, patch) {
  try { _st().updateEcosystemKpi(domainId, { ...patch, lastTickAt: new Date().toISOString(), tickCount: (_st().getEcosystemKpi(domainId).tickCount || 0) + 1 }); } catch {}
}
function _addMemory(domainId, title, detail = "") {
  try { _st().addEcosystemMemory({ domainId, type: "tick", title, detail }); } catch {}
}

const ECO_ORG = [
  // ── 1. Ecosystem Registry ────────────────────────────────────────────────
  {
    id: "eco_registry", role: "eco_registry", label: "Ecosystem Registry",
    description: "Maintains the global registry of all tenants, organizations, and ecosystem entities.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const tenants = _st().listTenants({ status: "active" });
      const orgs = _st().listOrgs({ status: "active" });
      _updateKpi("eco_registry", { tenantsOnboarded: tenants.length });
      _addMemory("eco_registry", `Registry: ${tenants.length} active tenants, ${orgs.length} active orgs`);
      try { _bus()?.emit("ecosystem:registry:ticked", { tenants: tenants.length, orgs: orgs.length }); } catch {}
    },
  },
  // ── 2. Organization Registry ──────────────────────────────────────────────
  {
    id: "eco_org_registry", role: "eco_org_registry", label: "Organization Registry",
    description: "Tracks all deployed org instances across tenants. Monitors org health and version drift.",
    intervalMs: 360_000, enabled: true,
    tickFn: () => {
      const orgs = _st().listOrgs({});
      const byType = {};
      orgs.forEach(o => { byType[o.type] = (byType[o.type]||0) + 1; });
      _updateKpi("eco_org_registry", { tenantsOnboarded: orgs.length });
      _addMemory("eco_org_registry", `Org Registry: ${orgs.length} orgs deployed`, JSON.stringify(byType));
    },
  },
  // ── 3. Company Registry ───────────────────────────────────────────────────
  {
    id: "eco_company_registry", role: "eco_company_registry", label: "Company Registry",
    description: "Cross-references tenant registry with enterprise company records. Tracks company lifecycle.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const tenants = _st().listTenants({ type: "enterprise" });
      _updateKpi("eco_company_registry", { tenantsOnboarded: tenants.length });
      _addMemory("eco_company_registry", `Company Registry: ${tenants.length} enterprise tenants`);
    },
  },
  // ── 4. Workspace Registry ─────────────────────────────────────────────────
  {
    id: "eco_workspace_registry", role: "eco_workspace_registry", label: "Workspace Registry",
    description: "Manages workspace registrations across all tenants. Tracks quotas and tier assignments.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const orgs = _st().listOrgs({ type: "workspace" });
      _updateKpi("eco_workspace_registry", { tenantsOnboarded: orgs.length });
      _addMemory("eco_workspace_registry", `Workspace Registry: ${orgs.length} workspace orgs`);
    },
  },
  // ── 5. Marketplace ────────────────────────────────────────────────────────
  {
    id: "eco_marketplace", role: "eco_marketplace", label: "Marketplace",
    description: "Operates the unified marketplace. Monitors listing health, installs, and ratings.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const summary = _st().getEcosystemMarketSummary();
      _updateKpi("eco_marketplace", { listingsPublished: summary.total });
      _addMemory("eco_marketplace", `Marketplace: ${summary.total} listings, ${summary.externalPlugins} external plugins, ${summary.externalModels} AI models`);
      try { _bus()?.emit("ecosystem:marketplace:ticked", summary); } catch {}
    },
  },
  // ── 6. Capability Marketplace ─────────────────────────────────────────────
  {
    id: "eco_cap_market", role: "eco_cap_market", label: "Capability Marketplace",
    description: "Manages capability listings. Pulls from pluginSDK capability registry for unified view.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const caps = _st().listListings({ type: "capability" });
      let sdkCaps = 0;
      try { sdkCaps = require("./pluginSDK.cjs").listCapabilities({}).total || 0; } catch {}
      _updateKpi("eco_cap_market", { listingsPublished: caps.length + sdkCaps });
      _addMemory("eco_cap_market", `Capabilities: ${caps.length} ecosystem listings + ${sdkCaps} SDK capabilities`);
    },
  },
  // ── 7. AI Agent Marketplace ───────────────────────────────────────────────
  {
    id: "eco_agent_market", role: "eco_agent_market", label: "AI Agent Marketplace",
    description: "Lists autonomous AI agents available for deployment. Tracks agent adoption and performance.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const agents = _st().listListings({ type: "agent" });
      let supervisorAgents = 0;
      try { const sup = _sup(); supervisorAgents = sup.listAgents?.()?.length || 0; } catch {}
      _updateKpi("eco_agent_market", { listingsPublished: agents.length });
      _addMemory("eco_agent_market", `Agent Marketplace: ${agents.length} published agents, ${supervisorAgents} runtime agents`);
    },
  },
  // ── 8. Integration Marketplace ────────────────────────────────────────────
  {
    id: "eco_integration_market", role: "eco_integration_market", label: "Integration Marketplace",
    description: "Catalogs integration connectors. Combines ecosystem listings with existing extension runtime.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const integrations = _st().listListings({ type: "integration" });
      _updateKpi("eco_integration_market", { listingsPublished: integrations.length });
      _addMemory("eco_integration_market", `Integrations: ${integrations.length} available`);
    },
  },
  // ── 9. API Marketplace ────────────────────────────────────────────────────
  {
    id: "eco_api_market", role: "eco_api_market", label: "API Marketplace",
    description: "Manages public API listings and developer apps. Monitors API health and usage.",
    intervalMs: 360_000, enabled: true,
    tickFn: () => {
      const apis = _st().listPublicAPIs({});
      const apps = _st().listDeveloperApps({});
      _updateKpi("eco_api_market", { listingsPublished: apis.length });
      _addMemory("eco_api_market", `APIs: ${apis.length} public endpoints, ${apps.length} developer apps`);
    },
  },
  // ── 10. Plugin Runtime ────────────────────────────────────────────────────
  {
    id: "eco_plugin_runtime", role: "eco_plugin_runtime", label: "Plugin Runtime",
    description: "Coordinates plugin lifecycle across all tenants. Bridges to existing pluginManagerService.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const plugins = _st().listListings({ type: "plugin" });
      let managed = 0;
      try { managed = require("./pluginManagerService.cjs").list?.()?.length || 0; } catch {}
      _updateKpi("eco_plugin_runtime", { listingsPublished: plugins.length + managed });
      _addMemory("eco_plugin_runtime", `Plugin Runtime: ${plugins.length} ecosystem plugins + ${managed} managed`);
    },
  },
  // ── 11. Extension SDK ─────────────────────────────────────────────────────
  {
    id: "eco_extension_sdk", role: "eco_extension_sdk", label: "Extension SDK",
    description: "Manages SDK versions and developer tooling. Tracks SDK adoption across tenants.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const sdks = _st().listSDKVersions({ stable: true });
      const packages = _st().listPackages({});
      _updateKpi("eco_extension_sdk", { listingsPublished: sdks.length });
      _addMemory("eco_extension_sdk", `SDK: ${sdks.length} stable versions, ${packages.length} deployable packages`);
    },
  },
  // ── 12. Developer Platform ────────────────────────────────────────────────
  {
    id: "eco_developer", role: "eco_developer", label: "Developer Platform",
    description: "Supports developers building on the ecosystem. Manages apps, webhooks, docs.",
    intervalMs: 480_000, enabled: true,
    tickFn: () => {
      const apps = _st().listDeveloperApps({ status: "active" });
      const webhooks = _st().listWebhooks({});
      _updateKpi("eco_developer", { tenantsOnboarded: apps.length });
      _addMemory("eco_developer", `Developer Platform: ${apps.length} apps, ${webhooks.length} webhooks`);
    },
  },
  // ── 13. Public APIs ───────────────────────────────────────────────────────
  {
    id: "eco_public_api", role: "eco_public_api", label: "Public APIs",
    description: "Maintains the public API registry. Monitors uptime, usage, and rate limits.",
    intervalMs: 240_000, enabled: true,
    tickFn: () => {
      const apis = _st().listPublicAPIs({});
      _updateKpi("eco_public_api", { listingsPublished: apis.length });
      _addMemory("eco_public_api", `Public APIs: ${apis.length} registered endpoints`);
      try { _bus()?.emit("ecosystem:api:ticked", { total: apis.length }); } catch {}
    },
  },
  // ── 14. Event Exchange ────────────────────────────────────────────────────
  {
    id: "eco_event_exchange", role: "eco_event_exchange", label: "Event Exchange",
    description: "Manages cross-tenant event routing. Pulls from runtimeEventBus for ecosystem-wide events.",
    intervalMs: 120_000, enabled: true,
    tickFn: () => {
      let recentEvents = 0;
      try { recentEvents = require("../../agents/runtime/runtimeEventBus.cjs").getRecent?.(50)?.length || 0; } catch {}
      _updateKpi("eco_event_exchange", { missionsExchanged: recentEvents });
      _addMemory("eco_event_exchange", `Event Exchange: ${recentEvents} recent events in bus`);
    },
  },
  // ── 15. Cross-Organization Communication ─────────────────────────────────
  {
    id: "eco_cross_org_comm", role: "eco_cross_org_comm", label: "Cross-Org Communication",
    description: "Routes messages between organizations. Validates permissions and trust scores.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const routes = _st().listRoutes({});
      const perms = _st().listPermissions({});
      _updateKpi("eco_cross_org_comm", { tenantsOnboarded: routes.length });
      _addMemory("eco_cross_org_comm", `Cross-Org Comm: ${routes.length} routes, ${perms.length} active permissions`);
    },
  },
  // ── 16. Cross-Organization Mission Exchange ───────────────────────────────
  {
    id: "eco_mission_exchange", role: "eco_mission_exchange", label: "Cross-Org Mission Exchange",
    description: "Manages cross-org mission marketplace. Auto-matches available tenants to open missions.",
    intervalMs: 240_000, enabled: true,
    tickFn: () => {
      const open = _st().listMissionExchange({ status: "open" });
      const assigned = _st().listMissionExchange({ status: "assigned" });
      _updateKpi("eco_mission_exchange", { missionsExchanged: open.length + assigned.length });
      _addMemory("eco_mission_exchange", `Mission Exchange: ${open.length} open, ${assigned.length} assigned`);
      if (open.length > 0) try { _bus()?.emit("ecosystem:mission_exchange:open", { count: open.length }); } catch {}
    },
  },
  // ── 17. Shared Knowledge Exchange ────────────────────────────────────────
  {
    id: "eco_knowledge_exchange", role: "eco_knowledge_exchange", label: "Shared Knowledge Exchange",
    description: "Manages cross-org knowledge sharing: articles, prompts, workflows, design systems, automations.",
    intervalMs: 360_000, enabled: true,
    tickFn: () => {
      const knowledge = _st().listKnowledge({ visibility: "public" });
      const prompts = _st().listPrompts({});
      const workflows = _st().listWorkflowTemplates({});
      const designSystems = _st().listDesignSystems({});
      const automations = _st().listAutomations({});
      _updateKpi("eco_knowledge_exchange", { knowledgeShared: knowledge.length + prompts.length + workflows.length });
      _addMemory("eco_knowledge_exchange", `Knowledge Exchange: ${knowledge.length} articles, ${prompts.length} prompts, ${workflows.length} workflows, ${designSystems.length} design systems, ${automations.length} automations`);
    },
  },
  // ── 18. Trust & Reputation Engine ────────────────────────────────────────
  {
    id: "eco_trust", role: "eco_trust", label: "Trust & Reputation Engine",
    description: "Scores and monitors trust across all tenants. Flags low-trust entities and promotes high-trust ones.",
    intervalMs: 300_000, enabled: true,
    tickFn: () => {
      const scores = _st().listTrustScores({});
      const lowTrust = scores.filter(s => s.score < 40).length;
      const highTrust = scores.filter(s => s.score >= 80).length;
      const avg = scores.length > 0 ? Math.round(scores.reduce((a,b) => a + b.score, 0) / scores.length) : 70;
      _updateKpi("eco_trust", { trustEvents: scores.length });
      _addMemory("eco_trust", `Trust: ${scores.length} entities, avg=${avg}, low=${lowTrust}, high=${highTrust}`);
      if (lowTrust > 0) try { _bus()?.emit("ecosystem:trust:alert", { lowTrust }); } catch {}
    },
  },
  // ── 19. Ecosystem Analytics ───────────────────────────────────────────────
  {
    id: "eco_analytics", role: "eco_analytics", label: "Ecosystem Analytics",
    description: "Generates ecosystem-wide analytics: tenant growth, marketplace velocity, mission throughput.",
    intervalMs: 600_000, enabled: true,
    tickFn: () => {
      const health = (() => { try { return _st().getEcosystemHealth(); } catch { return { score: 50 }; } })();
      const kpis = _st().getAllEcosystemKpis();
      _updateKpi("eco_analytics", { reportsGenerated: (_st().getEcosystemKpi("eco_analytics").reportsGenerated || 0) + 1 });
      _addMemory("eco_analytics", `Analytics: ecosystem health=${health.score}, ${kpis.length} domain KPIs`);
      try { _bus()?.emit("ecosystem:analytics:ticked", { health: health.score, kpiDomains: kpis.length }); } catch {}
    },
  },
  // ── 20. Ecosystem Director ────────────────────────────────────────────────
  {
    id: "eco_director", role: "eco_director", label: "Ecosystem Director",
    description: "Orchestrates all ecosystem domains. Coordinates with Enterprise Layer (L7) and drives cross-ecosystem alignment.",
    intervalMs: 180_000, enabled: true,
    tickFn: () => {
      const health = (() => { try { return _st().getEcosystemHealth(); } catch { return { score: 50 }; } })();
      const openMissions = _st().listMissionExchange({ status: "open" }).length;
      const lowTrust = _st().listTrustScores({ maxScore: 40 }).length;

      if (health.score < 70) {
        try { _st().createEcosystemReport({ title: `Ecosystem Health Alert — ${new Date().toISOString().slice(0,10)}`, domainId: "eco_director", type: "health_alert", summary: `Ecosystem health dropped to ${health.score}. Open missions: ${openMissions}. Low-trust tenants: ${lowTrust}`, data: { health, openMissions, lowTrust } }); } catch {}
      }
      _updateKpi("eco_director", { tenantsOnboarded: (_st().getEcosystemKpi("eco_director").tenantsOnboarded || 0) + 1 });
      _addMemory("eco_director", `Director: health=${health.score}, openMissions=${openMissions}, lowTrust=${lowTrust}`);
      try { _bus()?.emit("ecosystem:director:ticked", { health: health.score, openMissions, lowTrust }); } catch {}
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: ECO_ORG.length, registered: ECO_ORG.length };
  const sup = _sup();
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}

  const results = [];
  for (const spec of ECO_ORG) {
    try { results.push(sup.registerAgent(spec)); } catch (e) { results.push({ ok: false, error: e.message }); }
  }
  _registered = true;

  try { _wf().bootstrapEcosystem();          } catch {}
  try { _wf().subscribeEcosystemEvents();    } catch {}

  try { _bus()?.emit("ecosystem:registered", { count: ECO_ORG.length, ids: ECO_ORG.map(d => d.id) }); } catch {}
  return { ok: true, count: ECO_ORG.length, registered: results.filter(r => r.ok).length };
}

function getOrgStatus() {
  try {
    const sup = _sup();
    return ECO_ORG.map(spec => sup.getAgent(spec.id) || { id: spec.id, role: spec.role, label: spec.label, status: "not_registered" });
  } catch { return ECO_ORG.map(spec => ({ id: spec.id, role: spec.role, label: spec.label, status: "unknown" })); }
}

function getOrgSummary() {
  const status = getOrgStatus();
  const running = status.filter(a => a.status === "running").length;
  const db = (() => { try { return _st().getEcosystemDashboard(); } catch { return {}; } })();
  return { total: ECO_ORG.length, running, stopped: ECO_ORG.length - running, dashboard: db };
}

module.exports = { register, getOrgStatus, getOrgSummary, ECO_ORG };
