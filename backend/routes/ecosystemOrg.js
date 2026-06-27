"use strict";
/**
 * Ecosystem Platform — Routes (LEVEL 8)
 * /eco/* management + /eco/v8/* full API surface
 */
const router = require("express").Router();

const _org = () => require("../services/ecosystemOrg.cjs");
const _st  = () => require("../services/ecosystemState.cjs");
const _wf  = () => require("../services/ecosystemWorkflow.cjs");

// ── Management ────────────────────────────────────────────────────────────────
router.get("/eco/status",     (req, res) => res.json(_org().getOrgStatus()));
router.get("/eco/summary",    (req, res) => res.json(_org().getOrgSummary()));
router.get("/eco/agents/:id", (req, res) => {
  const a = _org().getOrgStatus().find(x => x.id === req.params.id);
  return a ? res.json(a) : res.status(404).json({ error: "Domain not found" });
});

// ── Dashboard + Health ────────────────────────────────────────────────────────
router.get("/eco/v8/dashboard", (req, res) => res.json(_st().getEcosystemDashboard()));
router.get("/eco/v8/health",    (req, res) => res.json(_st().getEcosystemHealth()));
router.get("/eco/v8/context",   (req, res) => res.json(_st().getEcosystemContext()));
router.patch("/eco/v8/context", (req, res) => res.json(_st().updateEcosystemContext(req.body)));

// ── Search ────────────────────────────────────────────────────────────────────
router.get("/eco/v8/search", (req, res) => {
  const { q, types, limit } = req.query;
  if (!q) return res.status(400).json({ error: "q required" });
  return res.json(_st().ecosystemSearch(q, { types: types?.split(","), limit: parseInt(limit)||30 }));
});

// ── Tenants ───────────────────────────────────────────────────────────────────
router.get("/eco/v8/tenants",     (req, res) => res.json(_st().listTenants(req.query)));
router.post("/eco/v8/tenants",    (req, res) => { const r = _st().registerTenant(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/eco/v8/tenants/:id", (req, res) => { const t = _st().getTenant(req.params.id); return t ? res.json(t) : res.status(404).json({ error: "Not found" }); });
router.patch("/eco/v8/tenants/:id", (req, res) => res.json(_st().updateTenant(req.params.id, req.body)));

// ── Org Registry ──────────────────────────────────────────────────────────────
router.get("/eco/v8/orgs",  (req, res) => res.json(_st().listOrgs(req.query)));
router.post("/eco/v8/orgs", (req, res) => { const r = _st().registerOrg(req.body); return res.status(r.ok?201:400).json(r); });

// ── Packages (deployable org bundles) ─────────────────────────────────────────
router.get("/eco/v8/packages",             (req, res) => res.json(_st().listPackages(req.query)));
router.get("/eco/v8/packages/:id",         (req, res) => { const p = _st().getPackage(req.params.id); return p ? res.json(p) : res.status(404).json({ error: "Not found" }); });
router.post("/eco/v8/packages",            (req, res) => { const r = _st().publishPackage(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/eco/v8/packages/:id/deploy", (req, res) => res.json(_st().deployPackage(req.params.id, req.body)));

// ── Marketplace ───────────────────────────────────────────────────────────────
router.get("/eco/v8/marketplace",           (req, res) => res.json(_st().listListings(req.query)));
router.post("/eco/v8/marketplace",          (req, res) => { const r = _st().publishListing(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/eco/v8/marketplace/summary",   (req, res) => res.json(_st().getEcosystemMarketSummary()));
router.get("/eco/v8/marketplace/:id",       (req, res) => { const l = _st().getListing(req.params.id); return l ? res.json(l) : res.status(404).json({ error: "Not found" }); });
router.post("/eco/v8/marketplace/:id/install", (req, res) => res.json(_st().installListing(req.params.id, req.body)));
router.post("/eco/v8/marketplace/:id/rate",    (req, res) => res.json(_st().rateListing(req.params.id, req.body)));

// ── Routing + Permissions ─────────────────────────────────────────────────────
router.get("/eco/v8/routes",       (req, res) => res.json(_st().listRoutes(req.query)));
router.post("/eco/v8/routes",      (req, res) => res.json(_st().addRoute(req.body)));
router.post("/eco/v8/routes/check",(req, res) => { const { fromTenantId, toTenantId, resourceType, action } = req.body; return res.json(_st().checkPermission(fromTenantId, toTenantId, resourceType, action)); });

router.get("/eco/v8/permissions",          (req, res) => res.json(_st().listPermissions(req.query)));
router.post("/eco/v8/permissions",         (req, res) => { const r = _st().grantPermission(req.body); return res.status(r.ok?201:400).json(r); });

// ── Mission Exchange ──────────────────────────────────────────────────────────
router.get("/eco/v8/exchange/missions",                       (req, res) => res.json(_st().listMissionExchange(req.query)));
router.post("/eco/v8/exchange/missions",                      (req, res) => { const r = _st().publishMissionExchange(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/eco/v8/exchange/missions/:id/bid",              (req, res) => res.json(_st().bidMissionExchange(req.params.id, req.body)));
router.post("/eco/v8/exchange/missions/:id/assign",           (req, res) => res.json(_st().assignMissionExchange(req.params.id, req.body)));

// ── Knowledge Exchange ────────────────────────────────────────────────────────
router.get("/eco/v8/exchange/knowledge",   (req, res) => res.json(_st().listKnowledge(req.query)));
router.post("/eco/v8/exchange/knowledge",  (req, res) => { const r = _st().shareKnowledge(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/eco/v8/exchange/workflows",   (req, res) => res.json(_st().listWorkflowTemplates(req.query)));
router.post("/eco/v8/exchange/workflows",  (req, res) => { const r = _st().publishWorkflowTemplate(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/eco/v8/exchange/prompts",     (req, res) => res.json(_st().listPrompts(req.query)));
router.post("/eco/v8/exchange/prompts",    (req, res) => { const r = _st().publishPrompt(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/eco/v8/exchange/design-systems",  (req, res) => res.json(_st().listDesignSystems(req.query)));
router.post("/eco/v8/exchange/design-systems", (req, res) => { const r = _st().publishDesignSystem(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/eco/v8/exchange/automations",  (req, res) => res.json(_st().listAutomations(req.query)));
router.post("/eco/v8/exchange/automations", (req, res) => { const r = _st().publishAutomation(req.body); return res.status(r.ok?201:400).json(r); });

// ── Developer Platform ────────────────────────────────────────────────────────
router.get("/eco/v8/developer/apps",   (req, res) => res.json(_st().listDeveloperApps(req.query)));
router.post("/eco/v8/developer/apps",  (req, res) => { const r = _st().registerDeveloperApp(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/eco/v8/developer/apis",   (req, res) => res.json(_st().listPublicAPIs(req.query)));
router.post("/eco/v8/developer/apis",  (req, res) => { const r = _st().registerPublicAPI(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/eco/v8/developer/webhooks",  (req, res) => res.json(_st().listWebhooks(req.query)));
router.post("/eco/v8/developer/webhooks", (req, res) => { const r = _st().registerWebhook(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/eco/v8/developer/sdks",   (req, res) => res.json(_st().listSDKVersions(req.query)));
router.post("/eco/v8/developer/sdks",  (req, res) => { const r = _st().registerSDKVersion(req.body); return res.status(r.ok?201:400).json(r); });

// ── Trust Engine ──────────────────────────────────────────────────────────────
router.get("/eco/v8/trust",          (req, res) => res.json(_st().listTrustScores(req.query)));
router.get("/eco/v8/trust/:id",      (req, res) => res.json(_st().getTrustScore(req.params.id)));
router.post("/eco/v8/trust/event",   (req, res) => res.json(_st().recordTrustEvent(req.body)));

// ── KPIs + Memory + Reports ───────────────────────────────────────────────────
router.get("/eco/v8/kpis",            (req, res) => res.json(_st().getAllEcosystemKpis()));
router.get("/eco/v8/kpis/:domainId",  (req, res) => res.json(_st().getEcosystemKpi(req.params.domainId)));

router.get("/eco/v8/memory",   (req, res) => res.json(_st().listEcosystemMemory(req.query)));
router.post("/eco/v8/memory",  (req, res) => { const r = _st().addEcosystemMemory(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/eco/v8/reports",  (req, res) => res.json(_st().listEcosystemReports(req.query)));
router.post("/eco/v8/reports", (req, res) => { const r = _st().createEcosystemReport(req.body); return res.status(r.ok?201:400).json(r); });

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow triggers
// ═══════════════════════════════════════════════════════════════════════════════

// POST /eco/v8/command — full 5-step ecosystem pipeline
router.post("/eco/v8/command", async (req, res) => {
  const { command, tenantId, companyId, portfolioId, priority, amountUsd } = req.body || {};
  if (!command) return res.status(400).json({ error: "command required" });
  const r = await _wf().runEcosystemPipeline(command, { tenantId, companyId, portfolioId, priority, amountUsd });
  return res.status(r.ok ? 200 : 400).json(r);
});

// POST /eco/v8/workflow/governance { eosGoalId, tenantId }
router.post("/eco/v8/workflow/governance", (req, res) => res.json(_wf().ecosystemGovernance(req.body.eosGoalId, req.body)));

// POST /eco/v8/workflow/audit { eosGoalId, tenantId, healthScore }
router.post("/eco/v8/workflow/audit", (req, res) => res.json(_wf().ecosystemAudit(req.body.eosGoalId, req.body)));

// POST /eco/v8/workflow/message { fromTenantId, toTenantId, subject, body }
router.post("/eco/v8/workflow/message", (req, res) => res.json(_wf().sendCrossOrgMessage(req.body)));

module.exports = router;
