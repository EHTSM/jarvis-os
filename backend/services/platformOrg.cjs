"use strict";
/**
 * Artificial Organization Platform — Org (LEVEL Ω)
 *
 * 20 platform domain agents registered via agentRuntimeSupervisor.
 * Extends existing org infrastructure — never duplicates it.
 */

const _st  = () => require("./platformState.cjs");
const _lp  = () => require("./autonomousLoop.cjs");   // reuse L10 loop
const _ast = () => require("./autonomousState.cjs");  // reuse L10 state
const _bus = () => { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
const _sup = () => { try { return require("./agentRuntimeSupervisor.cjs");              } catch { return null; } }

let _registered = false;

const PLATFORM_ORG = [
  { id:"plt_builder",      role:"builder",       label:"Org Builder",               desc:"Registers orgs from blueprints + templates"         },
  { id:"plt_blueprint",    role:"blueprint",     label:"Blueprint Engine",           desc:"Creates + manages org blueprint definitions"        },
  { id:"plt_templates",    role:"templates",     label:"Template Marketplace",       desc:"Manages org template catalog + installs"            },
  { id:"plt_deploy",       role:"deployer",      label:"Deployment Engine",          desc:"Deploys orgs across all platform layers"            },
  { id:"plt_lifecycle",    role:"lifecycle",     label:"Lifecycle Manager",          desc:"Manages org status: active/paused/retired"          },
  { id:"plt_clone",        role:"cloner",        label:"Clone Engine",               desc:"Clones and forks orgs + blueprints"                 },
  { id:"plt_upgrade",      role:"upgrader",      label:"Upgrade Engine",             desc:"Bumps capabilities and versions of deployed orgs"   },
  { id:"plt_migration",    role:"migrator",      label:"Migration Engine",           desc:"Migrates orgs between tenants + environments"       },
  { id:"plt_backup",       role:"backup",        label:"Backup & Restore",           desc:"Exports and imports org packages"                   },
  { id:"plt_versioning",   role:"versioner",     label:"Version Manager",            desc:"Tracks and manages org version history"             },
  { id:"plt_simulator",    role:"simulator",     label:"Org Simulator",              desc:"Simulates org operation before deployment"          },
  { id:"plt_twin",         role:"twin",          label:"Digital Twin",               desc:"Maintains live digital twin of every deployed org"  },
  { id:"plt_governance",   role:"governance",    label:"Org Governance",             desc:"Enforces org policies + audit trails"               },
  { id:"plt_memory",       role:"memory",        label:"Memory Engine",              desc:"Manages org memory export/import + persistence"     },
  { id:"plt_sdk",          role:"sdk",           label:"Platform SDK",               desc:"Exposes Org SDK manifest + API surface"             },
  { id:"plt_api",          role:"api",           label:"Public API Layer",           desc:"Manages public API registration + versioning"       },
  { id:"plt_plugins",      role:"plugins",       label:"Plugin Runtime",             desc:"Runs per-org plugin sandboxes"                      },
  { id:"plt_certification",role:"certification", label:"Org Certification",          desc:"Issues + verifies org certifications"               },
  { id:"plt_analytics",    role:"analytics",     label:"Platform Analytics",         desc:"Tracks platform-wide KPIs + reports"               },
  { id:"plt_director",     role:"director",      label:"Platform Director",          desc:"Orchestrates all 19 platform domains"               },
];

const TICKS = {
  plt_builder: () => {
    try {
      // Ensure all built-in templates have corresponding blueprints
      const builtIn = _st().listBuiltInTemplates();
      for (const tpl of builtIn.slice(0, 2)) {
        const existing = _st().listBlueprints({ limit: 100 }).find(b => b.name === tpl.name);
        if (!existing) {
          _st().createBlueprint({ name: tpl.name, description: tpl.description, type: tpl.type, capabilities: tpl.capabilities, authorId: "platform", tags: ["built-in"] });
        }
      }
    } catch {}
  },

  plt_blueprint: () => {
    try {
      // Publish any drafted blueprints older than 1 minute
      const drafts = _st().listBlueprints({ status: "draft" });
      for (const bp of drafts.slice(0, 3)) {
        if (Date.now() - new Date(bp.createdAt).getTime() > 60000) {
          _st().publishBlueprint(bp.id);
        }
      }
    } catch {}
  },

  plt_templates: () => {
    try {
      // Sync built-in templates to marketplace if not listed
      const listed = _st().listTemplates({});
      const builtIn = _st().listBuiltInTemplates();
      for (const tpl of builtIn.slice(0, 2)) {
        if (!listed.find(l => l.name === tpl.name)) {
          const bps = _st().listBlueprints({ limit: 100 });
          const bp = bps.find(b => b.name === tpl.name);
          if (bp) _st().publishTemplate({ name: tpl.name, description: tpl.description, blueprintId: bp.id, authorId: "platform", price: 0, visibility: "public", category: tpl.type, tags: ["built-in","official"] });
        }
      }
    } catch {}
  },

  plt_deploy: () => {
    try {
      // Check for provisioning orgs stuck > 5 min and force complete
      const provisioning = _st().listOrgs({ status: "provisioning" });
      for (const org of provisioning.slice(0, 2)) {
        if (Date.now() - new Date(org.createdAt).getTime() > 300000) {
          _st().updateOrg(org.id, { status: "active" });
        }
      }
    } catch {}
  },

  plt_lifecycle: () => {
    try {
      // Update health of active orgs
      const active = _st().listOrgs({ status: "active" });
      for (const org of active.slice(0, 5)) {
        const h = _st().getOrgHealth(org.id);
        if (h) _st().updateOrgHealth(org.id, h.health);
      }
    } catch {}
  },

  plt_clone: () => {
    try {
      // Nothing to do autonomously — clone on demand
      // Check for stale clone requests (placeholder for async clone queue)
    } catch {}
  },

  plt_upgrade: () => {
    try {
      // Check org evolution history and propose upgrades
      const orgs = _st().listOrgs({ status: "active" });
      for (const org of orgs.slice(0, 2)) {
        if (org.evolutionHistory.length > 5 && !org.capabilities.includes("ecosystem")) {
          _ast()?.discoverOpportunity?.({ title: `Upgrade ${org.name} to ecosystem tier`, source: "plt_upgrade", domain: "platform", layer: "platform", estimatedValue: 300, confidence: 0.7 });
        }
      }
    } catch {}
  },

  plt_migration: () => {
    // Migration is on-demand only — tick is a no-op health check
    try { _st().getControlState(); } catch {}
  },

  plt_backup: () => {
    try {
      // Auto-export orgs that haven't been exported in 24h
      const orgs = _st().listOrgs({ status: "active" });
      const packages = _st().listPackages({ limit: 100 });
      for (const org of orgs.slice(0, 2)) {
        const hasRecent = packages.some(p => p.org?.id === org.id && Date.now() - new Date(p.exportedAt).getTime() < 86400000);
        if (!hasRecent) _st().exportOrg(org.id);
      }
    } catch {}
  },

  plt_versioning: () => {
    try {
      // Auto-create version snapshot for orgs that have no version yet
      const orgs = _st().listOrgs({ status: "active" });
      for (const org of orgs.slice(0, 3)) {
        const versions = _st().listVersions({ orgId: org.id, limit: 1 });
        if (versions.length === 0) {
          _st().createVersion({ orgId: org.id, version: org.version, changelog: "Initial version", authorId: "platform" });
        }
      }
    } catch {}
  },

  plt_simulator: () => {
    // Simulator is on-demand — tick tracks analytics
    try {
      const analytics = _st().getPlatformAnalytics();
      _st().updateControlState({ lastAnalytics: analytics, lastTickAt: new Date().toISOString() });
    } catch {}
  },

  plt_twin: () => {
    try {
      // Refresh digital twins for active orgs
      const orgs = _st().listOrgs({ status: "active" });
      for (const org of orgs.slice(0, 3)) {
        _st().getDigitalTwin(org.id); // This also updates health
      }
    } catch {}
  },

  plt_governance: () => {
    try {
      // Ensure all active orgs have a default policy
      const orgs = _st().listOrgs({ status: "active" });
      for (const org of orgs.slice(0, 3)) {
        if (org.governance.policies.length === 0) {
          _st().addOrgPolicy(org.id, { policy: "All org decisions must be explainable and traceable", addedBy: "platform_governance" });
        }
      }
    } catch {}
  },

  plt_memory: () => {
    try {
      // Track memory health via L5 learning engine
      const le = require("./continuousLearningEngine.cjs");
      le?.addLesson?.({ type: "platform_tick", title: "Platform memory tick", source: "plt_memory", confidence: 0.6, tags: ["platform","omega"] });
    } catch {}
  },

  plt_sdk: () => {
    try {
      // Sync SDK manifest to control state
      const manifest = _st().getSDKManifest();
      _st().updateControlState({ sdkManifest: manifest });
    } catch {}
  },

  plt_api: () => {
    try {
      // Register platform APIs in pluginSDK API manifest
      const pSDK = require("./pluginSDK.cjs");
      pSDK?.registerCapability?.({ id: "platform:org:deploy", name: "Deploy Org", description: "Deploy an AI Organization from blueprint", handler: "platformState.deployOrg", version: "1.0" });
      pSDK?.registerCapability?.({ id: "platform:org:clone", name: "Clone Org", description: "Clone an AI Organization", handler: "platformState.cloneOrg", version: "1.0" });
    } catch {}
  },

  plt_plugins: () => {
    // Plugin runtime — uses existing pluginSDK
    try {
      const pSDK = require("./pluginSDK.cjs");
      const templates = pSDK?.listTemplates?.("org") || [];
      _st().updateControlState({ registeredOrgPlugins: templates.length });
    } catch {}
  },

  plt_certification: () => {
    try {
      // Auto-certify orgs with health > 90 at bronze if not certified
      const orgs = _st().listOrgs({ status: "active" });
      for (const org of orgs.slice(0, 3)) {
        const h = _st().getOrgHealth(org.id);
        if (h && h.health > 90 && !org.certifications?.includes("bronze")) {
          _st().certifyOrg({ orgId: org.id, level: "bronze", criteria: ["health>90","active","deployed"], issuedBy: "platform_auto", score: h.health });
        }
      }
    } catch {}
  },

  plt_analytics: () => {
    try {
      const analytics = _st().getPlatformAnalytics();
      _st().createPlatformReport({
        title: `Platform Analytics Tick — ${new Date().toISOString()}`,
        type: "analytics",
        summary: `${analytics.orgs.total} orgs, ${analytics.blueprints.total} blueprints, ${analytics.deployments.total} deployments`,
        data: analytics,
      });
    } catch {}
  },

  plt_director: async () => {
    try {
      const analytics = _st().getPlatformAnalytics();
      // Record as autonomous opportunity if platform has no orgs
      if (analytics.orgs.total === 0) {
        _ast()?.discoverOpportunity?.({ title: "Platform has no deployed orgs — deploy founding org", source: "plt_director", domain: "platform", layer: "platform", estimatedValue: 10000, confidence: 0.95 });
      }
      // Run L10 autonomous cycle to keep all layers healthy
      await _lp().runCycle();
    } catch {}
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: PLATFORM_ORG.length, registered: PLATFORM_ORG.length };

  const sup = _sup();
  if (!sup) return { ok: false, error: "agentRuntimeSupervisor unavailable" };

  // Bootstrap platform on first registration
  try {
    const ctl = _st().getControlState();
    if (!ctl.startedAt) {
      _st().updateControlState({ startedAt: new Date().toISOString(), epoch: 1, sdkVersion: "1.0.0" });
    }
    // Seed built-in blueprints
    for (const tpl of _st().listBuiltInTemplates()) {
      const existing = _st().listBlueprints({ limit: 200 }).find(b => b.name === tpl.name);
      if (!existing) {
        const r = _st().createBlueprint({ name: tpl.name, description: tpl.description, type: tpl.type, capabilities: tpl.capabilities, authorId: "platform", tags: ["built-in","official"] });
        if (r.ok) _st().publishBlueprint(r.blueprint.id);
      }
    }
  } catch {}

  // Ensure supervisor is started
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}

  let count = 0;
  for (const domain of PLATFORM_ORG) {
    try {
      sup.registerAgent({
        id:          domain.id,
        role:        domain.role,
        label:       domain.label,
        description: domain.desc,
        intervalMs:  domain.id === "plt_director" ? 300000 : 60000,
        enabled:     true,
        tickFn:      TICKS[domain.id],
      });
      count++;
    } catch {}
  }

  _registered = true;

  // Subscribe to platform events
  try {
    const bus = _bus();
    if (bus) {
      bus.subscribe("plt_org_health_watch", (evt) => {
        if (evt.type === "platform:org:deployed") {
          // Auto-certify after deployment
          setTimeout(() => {
            try { _st().certifyOrg({ orgId: evt.payload?.orgId, level: "bronze", issuedBy: "platform_auto" }); } catch {}
          }, 1000);
        }
      });
    }
  } catch {}

  return { ok: true, count: PLATFORM_ORG.length, registered: count };
}

function getOrgStatus() {
  const sup = _sup();
  return PLATFORM_ORG.map(domain => {
    const agent = sup?.listAgents?.()?.find(a => a.id === domain.id);
    return { id: domain.id, role: domain.role, label: domain.label, status: agent?.status || "registered", lastTick: agent?.lastTick || null };
  });
}

function getOrgSummary() {
  const st = _st();
  const analytics = st.getPlatformAnalytics();
  return {
    total: PLATFORM_ORG.length,
    analytics,
    dashboard: { orgs: analytics.orgs, blueprints: analytics.blueprints, templates: analytics.templates, deployments: analytics.deployments },
    control: st.getControlState(),
  };
}

module.exports = { register, getOrgStatus, getOrgSummary, PLATFORM_ORG };
