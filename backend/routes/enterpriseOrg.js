"use strict";
/**
 * Enterprise Operating System — Routes (LEVEL 7)
 * Base: /ent/* management + /ent/v7/* CRUD + workflow triggers
 */
const router = require("express").Router();

function _org() { return require("../services/enterpriseOrg.cjs"); }
function _st()  { return require("../services/enterpriseState.cjs"); }
function _wf()  { return require("../services/enterpriseWorkflow.cjs"); }

// ── Management ────────────────────────────────────────────────────────────────
router.get("/ent/status",     (req, res) => res.json(_org().getOrgStatus()));
router.get("/ent/summary",    (req, res) => res.json(_org().getOrgSummary()));
router.get("/ent/agents/:id", (req, res) => {
  const a = _org().getOrgStatus().find(x => x.id === req.params.id);
  return a ? res.json(a) : res.status(404).json({ error: "Division not found" });
});

// ── Dashboard + Health ────────────────────────────────────────────────────────
router.get("/ent/v7/dashboard", (req, res) => res.json(_st().getEnterpriseDashboard()));
router.get("/ent/v7/health",    (req, res) => res.json(_st().getEnterpriseHealth()));
router.get("/ent/v7/context",   (req, res) => res.json(_st().getEnterpriseContext()));
router.patch("/ent/v7/context", (req, res) => res.json(_st().updateEnterpriseContext(req.body)));

// ── Enterprise-wide Search ────────────────────────────────────────────────────
router.get("/ent/v7/search", (req, res) => {
  const { q, types, limit } = req.query;
  if (!q) return res.status(400).json({ error: "q required" });
  return res.json(_st().enterpriseSearch(q, { types: types?.split(","), limit: parseInt(limit)||20 }));
});

// ── Companies ─────────────────────────────────────────────────────────────────
router.get("/ent/v7/companies",     (req, res) => res.json(_st().listCompanies(req.query)));
router.post("/ent/v7/companies",    (req, res) => { const r = _st().createCompany(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/ent/v7/companies/:id", (req, res) => { const c = _st().getCompany(req.params.id); return c ? res.json(c) : res.status(404).json({ error: "Not found" }); });
router.patch("/ent/v7/companies/:id", (req, res) => res.json(_st().updateCompany(req.params.id, req.body)));

// ── Workspaces ────────────────────────────────────────────────────────────────
router.get("/ent/v7/workspaces",     (req, res) => res.json(_st().listWorkspaces(req.query)));
router.post("/ent/v7/workspaces",    (req, res) => { const r = _st().createWorkspace(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/ent/v7/workspaces/:id", (req, res) => { const w = _st().getWorkspace(req.params.id); return w ? res.json(w) : res.status(404).json({ error: "Not found" }); });
router.patch("/ent/v7/workspaces/:id", (req, res) => res.json(_st().updateWorkspace(req.params.id, req.body)));

// ── Products ──────────────────────────────────────────────────────────────────
router.get("/ent/v7/products",               (req, res) => res.json(_st().listProducts(req.query)));
router.post("/ent/v7/products",              (req, res) => { const r = _st().createProduct(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/ent/v7/products/:id",           (req, res) => { const p = _st().getProduct(req.params.id); return p ? res.json(p) : res.status(404).json({ error: "Not found" }); });
router.patch("/ent/v7/products/:id",         (req, res) => res.json(_st().updateProduct(req.params.id, req.body)));
router.post("/ent/v7/products/:id/advance",  (req, res) => res.json(_st().advanceProductStage(req.params.id, req.body.stage)));

// ── Customers ─────────────────────────────────────────────────────────────────
router.get("/ent/v7/customers",     (req, res) => res.json(_st().listCustomers(req.query)));
router.post("/ent/v7/customers",    (req, res) => { const r = _st().createCustomer(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/ent/v7/customers/:id", (req, res) => { const c = _st().getCustomer(req.params.id); return c ? res.json(c) : res.status(404).json({ error: "Not found" }); });
router.patch("/ent/v7/customers/:id", (req, res) => res.json(_st().updateCustomer(req.params.id, req.body)));

// ── Partners ──────────────────────────────────────────────────────────────────
router.get("/ent/v7/partners",  (req, res) => res.json(_st().listPartners(req.query)));
router.post("/ent/v7/partners", (req, res) => { const r = _st().createPartner(req.body); return res.status(r.ok?201:400).json(r); });

// ── Vendors ───────────────────────────────────────────────────────────────────
router.get("/ent/v7/vendors",  (req, res) => res.json(_st().listVendors(req.query)));
router.post("/ent/v7/vendors", (req, res) => { const r = _st().createVendor(req.body); return res.status(r.ok?201:400).json(r); });

// ── Contracts ─────────────────────────────────────────────────────────────────
router.get("/ent/v7/contracts",  (req, res) => res.json(_st().listContracts(req.query)));
router.post("/ent/v7/contracts", (req, res) => { const r = _st().createContract(req.body); return res.status(r.ok?201:400).json(r); });

// ── Portfolio ─────────────────────────────────────────────────────────────────
router.get("/ent/v7/portfolios",  (req, res) => res.json(_st().listPortfolios(req.query)));
router.post("/ent/v7/portfolios", (req, res) => { const r = _st().createPortfolio(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/ent/v7/initiatives",     (req, res) => res.json(_st().listInitiatives(req.query)));
router.post("/ent/v7/initiatives",    (req, res) => { const r = _st().createInitiative(req.body); return res.status(r.ok?201:400).json(r); });
router.patch("/ent/v7/initiatives/:id", (req, res) => res.json(_st().updateInitiative(req.params.id, req.body)));

router.get("/ent/v7/programs",  (req, res) => res.json(_st().listPrograms(req.query)));
router.post("/ent/v7/programs", (req, res) => { const r = _st().createProgram(req.body); return res.status(r.ok?201:400).json(r); });

// ── Finance ───────────────────────────────────────────────────────────────────
router.get("/ent/v7/budgets",                  (req, res) => res.json(_st().listEnterpriseBudgets(req.query)));
router.post("/ent/v7/budgets",                 (req, res) => { const r = _st().createEnterpriseBudget(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/ent/v7/budgets/:id/allocate",    (req, res) => res.json(_st().allocateEnterpriseBudget(req.params.id, req.body)));
router.get("/ent/v7/forecasts",                (req, res) => res.json(_st().listForecasts(req.query)));
router.post("/ent/v7/forecasts",               (req, res) => { const r = _st().createForecast(req.body); return res.status(r.ok?201:400).json(r); });

// ── Governance ────────────────────────────────────────────────────────────────
router.get("/ent/v7/policies",            (req, res) => res.json(_st().listEnterprisePolicies(req.query)));
router.post("/ent/v7/policies",           (req, res) => { const r = _st().createEnterprisePolicy(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/ent/v7/policies/evaluate",  (req, res) => res.json(_st().evaluateEnterprisePolicy(req.body)));

router.get("/ent/v7/approvals",                 (req, res) => res.json(_st().listEnterpriseApprovals(req.query)));
router.post("/ent/v7/approvals",                (req, res) => { const r = _st().createEnterpriseApproval(req.body); return res.status(r.ok?201:400).json(r); });
router.post("/ent/v7/approvals/:id/resolve",    (req, res) => res.json(_st().resolveEnterpriseApproval(req.params.id, req.body)));

router.get("/ent/v7/controls",  (req, res) => res.json(_st().listControls(req.query)));
router.post("/ent/v7/controls", (req, res) => { const r = _st().createControl(req.body); return res.status(r.ok?201:400).json(r); });

router.get("/ent/v7/audit",        (req, res) => res.json(_st().getAuditTrail(req.query)));
router.post("/ent/v7/audit/entry", (req, res) => { const e = _st().addAuditEntry(req.body); return res.status(201).json({ ok: true, entry: e }); });

// ── HR ────────────────────────────────────────────────────────────────────────
router.get("/ent/v7/headcount",  (req, res) => res.json(_st().listHeadcount(req.query)));
router.post("/ent/v7/headcount", (req, res) => { const r = _st().addHeadcount(req.body); return res.status(r.ok?201:400).json(r); });

// ── KPIs ──────────────────────────────────────────────────────────────────────
router.get("/ent/v7/kpis",         (req, res) => res.json(_st().getAllEnterpriseKpis()));
router.get("/ent/v7/kpis/:divId",  (req, res) => res.json(_st().getEnterpriseKpi(req.params.divId)));

// ── Memory + Reports ──────────────────────────────────────────────────────────
router.get("/ent/v7/memory",   (req, res) => res.json(_st().listEnterpriseMemory(req.query)));
router.post("/ent/v7/memory",  (req, res) => { const r = _st().addEnterpriseMemory(req.body); return res.status(r.ok?201:400).json(r); });
router.get("/ent/v7/reports",  (req, res) => res.json(_st().listEnterpriseReports(req.query)));
router.post("/ent/v7/reports", (req, res) => { const r = _st().createEnterpriseReport(req.body); return res.status(r.ok?201:400).json(r); });

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow triggers
// ═══════════════════════════════════════════════════════════════════════════════

// POST /ent/v7/command — full enterprise pipeline
router.post("/ent/v7/command", async (req, res) => {
  const { command, companyId, portfolioId, priority, amountUsd, autoApprove } = req.body || {};
  if (!command) return res.status(400).json({ error: "command required" });
  const r = await _wf().runEnterprisePipeline(command, { companyId, portfolioId, priority, amountUsd, autoApprove });
  return res.status(r.ok ? 200 : 400).json(r);
});

// POST /ent/v7/workflow/intake
router.post("/ent/v7/workflow/intake", (req, res) => {
  const r = _wf().intakeEnterpriseGoal(req.body.command, req.body);
  return res.status(r.ok?201:400).json(r);
});

// POST /ent/v7/workflow/governance { eosGoalId, companyId, spendUsd, autoApprove }
router.post("/ent/v7/workflow/governance", (req, res) => res.json(_wf().governanceGate(req.body.eosGoalId, req.body)));

// POST /ent/v7/workflow/audit { eosGoalId, companyId, healthScore }
router.post("/ent/v7/workflow/audit", (req, res) => res.json(_wf().runEnterpriseAudit(req.body.eosGoalId, req.body)));

// POST /ent/v7/workflow/compliance { companyId, framework }
router.post("/ent/v7/workflow/compliance", (req, res) => res.json(_wf().runComplianceScan(req.body)));

// POST /ent/v7/workflow/risk { companyId }
router.post("/ent/v7/workflow/risk", (req, res) => res.json(_wf().scoreEnterpriseRisk(req.body)));

// POST /ent/v7/workflow/portfolio-sync { portfolioId }
router.post("/ent/v7/workflow/portfolio-sync", (req, res) => res.json(_wf().syncPortfolio(req.body.portfolioId)));

// GET /ent/v7/workflow/missions { companyId, limit }
router.get("/ent/v7/workflow/missions", (req, res) => res.json(_wf().getCrossOrgMissionStatus(req.query)));

// POST /ent/v7/workflow/report { eosGoalId, companyId, healthScore }
router.post("/ent/v7/workflow/report", (req, res) => res.json(_wf().generateEnterpriseReport(req.body.eosGoalId, req.body)));

module.exports = router;
