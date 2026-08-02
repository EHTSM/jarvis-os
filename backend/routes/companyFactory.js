"use strict";
/**
 * POST-Ω Sprint P8 — Autonomous Company Factory routes
 * Prefix: /company-factory/*
 */

const router = require("express").Router();

const { requireAuth } = require("../middleware/authMiddleware");

const _try  = fn => { try { return fn(); } catch { return null; } };

const _cf   = () => _try(() => require("../services/companyFactory.cjs"));
const _cbe  = () => _try(() => require("../services/companyBlueprintEngine.cjs"));
const _cwb  = () => _try(() => require("../services/companyWorkspaceBuilder.cjs"));
const _cle_e = () => _try(() => require("../services/companyLifecycleEngine.cjs"));
const _cd   = () => _try(() => require("../services/companyDashboard.cjs"));
const _bte  = () => _try(() => require("../services/businessTemplateEngine.cjs"));
const _org  = () => _try(() => require("../services/organizationService.cjs"));
const _bs   = () => _try(() => require("../services/brandStudio.cjs"));
const _cal  = () => _try(() => require("../services/creativeAssetLibrary.cjs"));
const _store = () => _try(() => require("../services/storageService.cjs"));
const _bds  = () => _try(() => require("../services/businessDataService.cjs"));
const _aiOrch = () => _try(() => require("../services/aiOrchestrator.cjs"));
const _mem  = () => _try(() => require("../services/semanticMemorySearch.cjs"));
const _budgets = () => _try(() => require("../services/orgBudgets.cjs"));
const _vault = () => _try(() => require("../services/secretVault.cjs"));
const _usage = () => _try(() => require("../services/usageMetering.cjs"));

// Resolves company → its backing orgId, and asserts the requesting account has
// the given permission (default update_org) on that org — every company-scoped
// read/write (branding, assets, etc.) is gated through the org's own RBAC,
// not a new permission model. Reads use "view_members" (any org member/viewer/
// grant), writes use "update_org" (org_owner/org_admin only).
function _requireCompanyOrgPermission(req, res, action = "update_org") {
  const company = _cle_e()?.getCompany?.(req.params.id);
  if (!company) { res.status(404).json({ ok: false, error: "company not found" }); return null; }
  if (!company.orgId) { res.status(409).json({ ok: false, error: "company has no linked organization" }); return null; }
  const accountId = req.user?.sub;
  if (!_org()?.hasPermission?.(company.orgId, accountId, action)) {
    res.status(403).json({ ok: false, error: `Forbidden — requires permission: ${action}` });
    return null;
  }
  return company;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/company-factory/dashboard", requireAuth, (req, res) =>
  res.json(_cd()?.getDashboard?.() || { ok: false }));

router.get("/company-factory/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _cf()?.getStats?.() || {} }));

// ── Shared Founder Dashboard (composes M1–M6 across every org the requester
// belongs to or has been granted access to) ───────────────────────────────────
// organizationService.listOrgs(accountId) already returns exactly that set
// (own memberships + cross-org grants + full visibility for enterprise_admin)
// — no new membership/grant model. Every org maps to at most one company
// (1:1 since M1), so this is pure read-side composition, no new storage.

router.get("/company-factory/founder/dashboard", requireAuth, (req, res) => {
  const accountId = req.user.sub;
  const { orgs } = _org()?.listOrgs?.(accountId) || { orgs: [] };

  const portfolio = orgs.map(o => {
    const company = _cle_e()?.listCompanies?.({ orgId: o.id, limit: 1 })?.companies?.[0] || null;
    if (!company) return null;
    const aiUsage = _usage()?.summary?.({ orgId: o.id, fromLedger: true }) || null;
    const crm     = _bds()?.getDashboard?.(o.id) || null;
    return {
      orgId:        o.id,
      companyId:    company.id,
      name:         company.name,
      templateId:   company.templateId,
      stage:        company.stage,
      readiness:    company.readinessScore,
      riskScore:    (company.risks || []).filter(r => r.severity === "critical").length * 40
                  + (company.risks || []).filter(r => r.severity === "high").length * 20
                  + (company.risks || []).filter(r => r.severity === "medium").length * 10,
      pipelineValue: crm?.opportunities?.pipelineValue || 0,
      aiCostUsd:     aiUsage?.totalCostUsd || 0,
      createdAt:     company.createdAt,
      launchedAt:    company.launchedAt,
    };
  }).filter(Boolean);

  const byStage = {};
  for (const p of portfolio) byStage[p.stage] = (byStage[p.stage] || 0) + 1;

  const crossCompanyInsights = [];
  const stuckInPlanning = portfolio.filter(p => p.stage === "planning");
  if (stuckInPlanning.length >= 2) {
    crossCompanyInsights.push({
      type: "stage_bottleneck",
      severity: "medium",
      message: `${stuckInPlanning.length} companies are still in the planning stage`,
      companyIds: stuckInPlanning.map(p => p.companyId),
    });
  }
  const highRisk = portfolio.filter(p => p.riskScore >= 60);
  if (highRisk.length > 0) {
    crossCompanyInsights.push({
      type: "high_risk_concentration",
      severity: "high",
      message: `${highRisk.length} companies have a risk score of 60 or above`,
      companyIds: highRisk.map(p => p.companyId),
    });
  }

  res.json({
    ok: true,
    portfolio: {
      totalCompanies:   portfolio.length,
      totalPipelineValue: portfolio.reduce((s, p) => s + p.pipelineValue, 0),
      totalAiCostUsd:     parseFloat(portfolio.reduce((s, p) => s + p.aiCostUsd, 0).toFixed(6)),
      byStage,
      companies: portfolio.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    },
    crossCompanyInsights,
    generatedAt: new Date().toISOString(),
  });
});

// ── Company Factory — Core pipeline ──────────────────────────────────────────

router.post("/company-factory/create", requireAuth, async (req, res) => {
  const { idea, name, templateId, founder, skipApproval } = req.body || {};
  if (!idea && !name) return res.status(400).json({ ok: false, error: "idea or name required" });
  try {
    const result = await _cf()?.createCompany?.({ idea, name, templateId, founder, skipApproval, creatorAccountId: req.user.sub });
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Clone reuses the source company's templateId to run the exact same
// creation pipeline again — a fully real, independent company/org/blueprint/
// workspace, not a copy of records. Requester must be able to see the source
// company's org (view_members) before it can be used as a clone seed.
router.post("/company-factory/companies/:id/clone", requireAuth, async (req, res) => {
  const source = _requireCompanyOrgPermission(req, res, "view_members");
  if (!source) return;
  const { name, skipApproval } = req.body || {};
  try {
    const result = await _cf()?.cloneCompany?.({ sourceCompanyId: source.id, name, creatorAccountId: req.user.sub, skipApproval });
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/company-factory/runs", requireAuth, (req, res) => {
  const { templateId, limit } = req.query;
  res.json(_cf()?.listRuns?.({ templateId, limit: limit ? +limit : 50 }) || { ok: false });
});

router.get("/company-factory/runs/:id", requireAuth, (req, res) => {
  const run = _cf()?.getRun?.(req.params.id);
  if (!run) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, run });
});

// ── Business templates ────────────────────────────────────────────────────────

router.get("/company-factory/templates", requireAuth, (req, res) =>
  res.json({ ok: true, templates: _bte()?.listTemplates?.() || [] }));

router.get("/company-factory/templates/:id", requireAuth, (req, res) => {
  const tpl = _bte()?.getTemplate?.(req.params.id);
  if (!tpl) return res.status(404).json({ ok: false, error: "template not found" });
  res.json({ ok: true, template: tpl });
});

router.post("/company-factory/templates/infer", requireAuth, (req, res) => {
  const { description } = req.body || {};
  if (!description) return res.status(400).json({ ok: false, error: "description required" });
  res.json({ ok: true, template: _bte()?.inferTemplate?.(description) || null });
});

// ── Blueprints ────────────────────────────────────────────────────────────────

router.post("/company-factory/blueprints", requireAuth, (req, res) => {
  const { name, description, templateId, domain, founder } = req.body || {};
  if (!name) return res.status(400).json({ ok: false, error: "name required" });
  res.json(_cbe()?.generateBlueprint?.({ name, description, templateId, domain, founder }) || { ok: false });
});

router.get("/company-factory/blueprints", requireAuth, (req, res) => {
  const { templateId, status, limit } = req.query;
  res.json(_cbe()?.listBlueprints?.({ templateId, status, limit: limit ? +limit : 50 }) || { ok: false });
});

router.get("/company-factory/blueprints/:id", requireAuth, (req, res) => {
  const bp = _cbe()?.getBlueprint?.(req.params.id);
  if (!bp) return res.status(404).json({ ok: false, error: "blueprint not found" });
  res.json({ ok: true, blueprint: bp });
});

router.patch("/company-factory/blueprints/:id/status", requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ ok: false, error: "status required" });
  res.json(_cbe()?.updateBlueprintStatus?.(req.params.id, status) || { ok: false });
});

router.get("/company-factory/blueprints/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _cbe()?.getStats?.() || {} }));

// Enterprise Capability Expansion mission — real blueprint file export/import.
// Confirmed genuinely absent before this: GET /company-factory/blueprints/:id
// only ever returned JSON inline, and there was no way to bring a blueprint
// back in. Export persists the exact same object getBlueprint() already
// returns as a real downloadable file via the shared exportFileService;
// import calls the new companyBlueprintEngine.importBlueprint() (added
// alongside this route, same persistence store as generateBlueprint()).
router.get("/company-factory/blueprints/:id/export", requireAuth, async (req, res) => {
  const bp = _cbe()?.getBlueprint?.(req.params.id);
  if (!bp) return res.status(404).json({ ok: false, error: "blueprint not found" });
  try {
    const buffer = Buffer.from(JSON.stringify(bp, null, 2), "utf8");
    const exportFiles = require("../services/exportFileService.cjs");
    const result = await exportFiles.persist(buffer, {
      filename: `blueprint-${bp.id}.json`,
      mimeType: "application/json",
      orgId: null,
      accountId: req.user?.sub || req.user?.id || null,
      capability: "blueprint_export",
      tags: ["company-factory", "blueprint", "export"],
    });
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

router.post("/company-factory/blueprints/import", requireAuth, (req, res) => {
  const { blueprint } = req.body || {};
  if (!blueprint) return res.status(400).json({ ok: false, error: "blueprint object required in body" });
  const result = _cbe()?.importBlueprint?.(blueprint);
  if (!result) return res.status(503).json({ ok: false, error: "blueprint engine unavailable" });
  res.status(result.ok ? 200 : 400).json(result);
});

// ── Workspaces ────────────────────────────────────────────────────────────────

router.post("/company-factory/workspaces", requireAuth, async (req, res) => {
  const { blueprintId } = req.body || {};
  if (!blueprintId) return res.status(400).json({ ok: false, error: "blueprintId required" });
  try {
    const result = await _cwb()?.buildWorkspace?.(blueprintId);
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get("/company-factory/workspaces", requireAuth, (req, res) => {
  const { limit } = req.query;
  res.json(_cwb()?.listWorkspaces?.({ limit: limit ? +limit : 50 }) || { ok: false });
});

router.get("/company-factory/workspaces/:id", requireAuth, (req, res) => {
  const ws = _cwb()?.getWorkspace?.(req.params.id);
  if (!ws) return res.status(404).json({ ok: false, error: "workspace not found" });
  res.json({ ok: true, workspace: ws });
});

router.get("/company-factory/workspaces/blueprint/:blueprintId", requireAuth, (req, res) => {
  const ws = _cwb()?.getWorkspaceForBlueprint?.(req.params.blueprintId);
  if (!ws) return res.status(404).json({ ok: false, error: "workspace not found" });
  res.json({ ok: true, workspace: ws });
});

// ── Lifecycle ─────────────────────────────────────────────────────────────────

// Universal Composition Engine — Completion Gaps Phase 5 (Frontend
// org/company scoping). Both routes below previously had NO
// authorization at all: listCompanies() returned every company across
// EVERY org regardless of caller, and getCompany(id)/getCompanyDetail(id)
// were pure id-lookups with no ownership check — a real cross-tenant
// IDOR (any authenticated account could view any other org's company
// by id, or the full company list, by guessing/enumerating). Fixed by
// resolving the caller's own authorized org set SERVER-SIDE (via
// organizationService.listOrgs(accountId) — the same real function
// already used correctly by /company-factory/founder/dashboard above)
// and never trusting a frontend-supplied orgId/companyId without that
// check.
router.get("/company-factory/companies", requireAuth, (req, res) => {
  const { stage, templateId, limit } = req.query;
  const accountId = req.user.sub;
  const { orgs } = _org()?.listOrgs?.(accountId) || { orgs: [] };
  const authorizedOrgIds = new Set(orgs.map(o => o.id));
  const all = _cle_e()?.listCompanies?.({ stage, templateId, limit: limit ? +limit * 10 : 500 })?.companies || [];
  const scoped = all.filter(c => c.orgId && authorizedOrgIds.has(c.orgId)).slice(-(limit ? +limit : 50));
  res.json({ ok: true, companies: scoped });
});

router.get("/company-factory/companies/:id", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_members");
  if (!company) return;
  res.json({ ok: true, company });
});

router.get("/company-factory/companies/:id/detail", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_members");
  if (!company) return;
  res.json(_cd()?.getCompanyDetail?.(company.id) || { ok: false });
});

// Composition Inspector (Universal Composition Engine — Completion Gaps
// Phase 6): real backend-driven view of a company's full composition —
// departments, skills, tools/connectors, credential readiness, approval
// policies, capability gaps. Same org-scoped authorization as every
// other company-detail route above (Phase 5's fix) — never trusts a
// frontend-supplied id without the real permission check.
router.get("/company-factory/companies/:id/composition", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_members");
  if (!company) return;
  res.json(_cd()?.getCompanyComposition?.(company.id) || { ok: false });
});

router.post("/company-factory/companies/:id/advance", requireAuth, async (req, res) => {
  const { force } = req.body || {};
  try {
    const r = await _cle_e()?.advanceStage?.(req.params.id, { force });
    res.json(r || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/company-factory/companies/:id/gate", requireAuth, (req, res) => {
  const { gate, evidence } = req.body || {};
  if (!gate) return res.status(400).json({ ok: false, error: "gate required" });
  res.json(_cle_e()?.passGate?.(req.params.id, gate, { evidence }) || { ok: false });
});

router.get("/company-factory/companies/:id/readiness/:stage", requireAuth, (req, res) =>
  res.json(_cle_e()?.getReadinessForStage?.(req.params.id, req.params.stage) || { ok: false }));

router.patch("/company-factory/companies/:id/kpis", requireAuth, (req, res) =>
  res.json(_cle_e()?.updateKPIs?.(req.params.id, req.body || {}) || { ok: false }));

router.get("/company-factory/lifecycle/stages", requireAuth, (req, res) =>
  res.json({ ok: true, stages: _cle_e()?.STAGES || [], gates: _cle_e()?.STAGE_GATES || {} }));

router.get("/company-factory/lifecycle/stats", requireAuth, (req, res) =>
  res.json({ ok: true, stats: _cle_e()?.getStats?.() || {} }));

// ── Company Branding (org-scoped via brandStudio.cjs) ─────────────────────────

router.get("/company-factory/companies/:id/branding", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_members");
  if (!company) return;
  const kit = _bs()?.getKitForOrg?.(company.orgId);
  res.json({ ok: true, orgId: company.orgId, brandKit: kit });
});

router.put("/company-factory/companies/:id/branding", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res);
  if (!company) return;
  try {
    const existing = _bs()?.getKitForOrg?.(company.orgId);
    const { name, colors, fonts, brandVoice, description, industry, website } = req.body || {};
    const kit = existing
      ? _bs()?.updateKit?.(existing.id, { name, colors, fonts, brandVoice, description, industry, website })
      : _bs()?.createKit?.({ name: name || company.name, orgId: company.orgId, colors, fonts, brandVoice, description, industry, website });
    res.json({ ok: true, orgId: company.orgId, brandKit: kit });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post("/company-factory/companies/:id/branding/logo", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res);
  if (!company) return;
  const { assetId, variant } = req.body || {};
  if (!assetId) return res.status(400).json({ ok: false, error: "assetId required" });
  const asset = _cal()?.getAsset?.(assetId);
  if (!asset || asset.orgId !== company.orgId) {
    return res.status(404).json({ ok: false, error: "asset not found for this company's organization" });
  }
  try {
    const existing = _bs()?.getKitForOrg?.(company.orgId);
    const kit = existing || _bs()?.createKit?.({ name: company.name, orgId: company.orgId });
    const updated = _bs()?.attachLogo?.(kit.id, assetId, variant || "primary");
    res.json({ ok: true, orgId: company.orgId, brandKit: updated });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Company Assets (org-scoped via creativeAssetLibrary.cjs + storageService.cjs) ─

router.get("/company-factory/companies/:id/assets", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_members");
  if (!company) return;
  const { type, folder, tag, favorite, search, limit } = req.query;
  const assets = _cal()?.listAssets?.({ orgId: company.orgId, type, folder, tag, favorite: favorite === "true", search, limit: limit ? +limit : 100 }) || [];
  res.json({ ok: true, orgId: company.orgId, assets });
});

router.post("/company-factory/companies/:id/assets", requireAuth, async (req, res) => {
  const company = _requireCompanyOrgPermission(req, res);
  if (!company) return;
  const { type, prompt, tags, folder, url, dataUrl, mimeType, base64, key, contentType } = req.body || {};

  try {
    let finalUrl = url || null;

    // If raw bytes are supplied (base64) and a real storage provider is
    // configured, upload to it and use the resulting URL. Otherwise fall back
    // to whatever URL/dataUrl the caller already has — creativeAssetLibrary
    // stores pointers either way, it never requires storageService.
    if (base64 && key) {
      const provider = _store()?.detectProvider?.();
      if (!provider?.configured) {
        return res.status(503).json({ ok: false, error: "No storage provider configured — set S3_* or R2_* env vars, or pass a url/dataUrl instead of base64" });
      }
      const scopedKey = `org/${company.orgId}/assets/${key}`;
      const uploadResult = await _store()?.upload?.(scopedKey, Buffer.from(base64, "base64"), contentType || "application/octet-stream");
      if (!uploadResult?.ok) return res.status(502).json({ ok: false, error: "upload failed: " + uploadResult?.error });
      finalUrl = uploadResult.url;
    }

    const asset = _cal()?.storeAsset?.({
      type: type || "image", prompt: prompt || "", tags: tags || [],
      folder: folder || "uncategorized", orgId: company.orgId,
      url: finalUrl, dataUrl: dataUrl || null, mimeType: mimeType || "image/png",
      metadata: { companyId: company.id },
    });
    res.json({ ok: true, orgId: company.orgId, asset });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.delete("/company-factory/companies/:id/assets/:assetId", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res);
  if (!company) return;
  const asset = _cal()?.getAsset?.(req.params.assetId);
  if (!asset || asset.orgId !== company.orgId) {
    return res.status(404).json({ ok: false, error: "asset not found for this company's organization" });
  }
  const deleted = _cal()?.deleteAsset?.(req.params.assetId);
  res.json({ ok: !!deleted });
});

// ── Company CRM + Marketing (org-scoped via businessDataService.cjs) ─────────
// Thin convenience proxy — every entity already lives in businessDataService.cjs
// fully orgId-scoped (see /business/* routes); these routes just resolve
// company.orgId and gate through the org's own RBAC so callers don't need to
// know/attach an X-Org-Id header themselves. No new CRM storage or logic.

router.get("/company-factory/companies/:id/crm/dashboard", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_missions");
  if (!company) return;
  res.json({ ok: true, orgId: company.orgId, dashboard: _bds()?.getDashboard?.(company.orgId) || null });
});

router.get("/company-factory/companies/:id/crm/leads", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_missions");
  if (!company) return;
  const { status, source, assignee, minScore, limit } = req.query;
  res.json({ ok: true, orgId: company.orgId, ...(_bds()?.listLeads?.({ status, source, assignee, minScore, limit: limit ? +limit : 50, orgId: company.orgId }) || {}) });
});

router.post("/company-factory/companies/:id/crm/leads", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "create_mission");
  if (!company) return;
  try {
    const lead = _bds()?.createLead?.({ ...req.body, orgId: company.orgId });
    res.json({ ok: true, orgId: company.orgId, lead });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/company-factory/companies/:id/crm/opportunities", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_missions");
  if (!company) return;
  const { stage, assignee, minValue, limit } = req.query;
  res.json({ ok: true, orgId: company.orgId, ...(_bds()?.listOpportunities?.({ stage, assignee, minValue, limit: limit ? +limit : 50, orgId: company.orgId }) || {}) });
});

router.post("/company-factory/companies/:id/crm/opportunities", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "create_mission");
  if (!company) return;
  try {
    const opp = _bds()?.createOpportunity?.({ ...req.body, orgId: company.orgId });
    res.json({ ok: true, orgId: company.orgId, opportunity: opp });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/company-factory/companies/:id/marketing/campaigns", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_missions");
  if (!company) return;
  const { status, channel, limit } = req.query;
  res.json({ ok: true, orgId: company.orgId, ...(_bds()?.listCampaigns?.({ status, channel, limit: limit ? +limit : 20, orgId: company.orgId }) || {}) });
});

router.post("/company-factory/companies/:id/marketing/campaigns", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "create_mission");
  if (!company) return;
  try {
    const campaign = _bds()?.createCampaign?.({ ...req.body, orgId: company.orgId });
    res.json({ ok: true, orgId: company.orgId, campaign });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/company-factory/companies/:id/crm/revenue/stats", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_missions");
  if (!company) return;
  const { dateFrom, dateTo, currency } = req.query;
  res.json({ ok: true, orgId: company.orgId, stats: _bds()?.getRevenueStats?.({ dateFrom, dateTo, currency, orgId: company.orgId }) || null });
});

// ── Company AI (org-scoped via aiOrchestrator.cjs) ────────────────────────────
// aiOrchestrator.execute/executeStream already accept orgId for budget
// enforcement (orgBudgets.cjs) and usage attribution (usageMetering.cjs) — no
// new AI routing, provider, or billing logic is introduced here.

router.post("/company-factory/companies/:id/ai/execute", requireAuth, async (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "create_mission");
  if (!company) return;
  const { messages, capability, intent, userPref, model, maxTokens, temperature, tools, noCache } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ ok: false, error: "messages (array) required" });
  }
  try {
    const result = await _aiOrch()?.execute?.(messages, {
      capability, intent, userPref, model, maxTokens, temperature, tools, noCache,
      accountId: req.user.sub, orgId: company.orgId,
    });
    res.json({ ok: true, orgId: company.orgId, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code });
  }
});

router.get("/company-factory/companies/:id/ai/health", requireAuth, async (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_missions");
  if (!company) return;
  const { provider } = req.query;
  res.json({ ok: true, orgId: company.orgId, health: await _aiOrch()?.getProviderHealth?.(provider) || null });
});

// ── Company Memory (org-scoped via semanticMemorySearch.cjs) ─────────────────
// semanticMemorySearch.cjs already supports partitioned recall via a
// projectId tag ("project:<id>") + filtered semanticSearch/crossProjectSearch
// — company.orgId is used as that partition key so each company gets its own
// memory slice without any new storage or a parallel tagging scheme.

router.post("/company-factory/companies/:id/memory", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "create_mission");
  if (!company) return;
  const { type, data, key, importance, confidence, tags } = req.body || {};
  if (!type || !data) return res.status(400).json({ ok: false, error: "type and data required" });
  try {
    const result = _mem()?.saveTypedMemory?.(type, data, { key, importance, confidence, tags, projectId: company.orgId });
    res.json({ ok: true, orgId: company.orgId, memory: result });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/company-factory/companies/:id/memory/search", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_missions");
  if (!company) return;
  const { q, type, minScore, limit } = req.query;
  if (!q) return res.status(400).json({ ok: false, error: "q (query) required" });
  const result = _mem()?.semanticSearch?.(q, { type, minScore: minScore ? +minScore : undefined, limit: limit ? +limit : undefined, projectId: company.orgId });
  res.json({ ok: true, orgId: company.orgId, ...result });
});

// ── Company Billing (org-scoped via orgBudgets.cjs + organizationService.cjs) ─
// AI spend caps already live in orgBudgets.cjs keyed by orgId; per-seat
// subscription overview already lives in organizationService.getOrgBillingOverview
// (which self-gates on "manage_billing"). No new billing storage or logic.

router.get("/company-factory/companies/:id/billing/budget", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_analytics");
  if (!company) return;
  res.json({ ok: true, orgId: company.orgId, budget: _budgets()?.getOrgBudget?.(company.orgId) || null });
});

router.patch("/company-factory/companies/:id/billing/budget", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "manage_billing");
  if (!company) return;
  const { monthlyCapUsd, monthlyRequestCap, alertThresholdPct } = req.body || {};
  try {
    const budget = _budgets()?.setOrgBudget?.(company.orgId, { monthlyCapUsd, monthlyRequestCap, alertThresholdPct });
    res.json({ ok: true, orgId: company.orgId, budget });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get("/company-factory/companies/:id/billing/overview", requireAuth, (req, res) => {
  const company = _cle_e()?.getCompany?.(req.params.id);
  if (!company) return res.status(404).json({ ok: false, error: "company not found" });
  if (!company.orgId) return res.status(409).json({ ok: false, error: "company has no linked organization" });
  try {
    const overview = _org()?.getOrgBillingOverview?.(company.orgId, req.user.sub);
    res.json({ ok: true, orgId: company.orgId, overview });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ── Company Connectors (org-scoped via secretVault.cjs) ───────────────────────
// secretVault.cjs already supports full per-org credential storage/rotation/
// validation for all 57 production connectors — no new credential storage,
// and secret VALUES are never returned over this API (listSecrets/
// validateSecret already redact them at the service layer).

router.get("/company-factory/companies/:id/connectors", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_analytics");
  if (!company) return;
  const { connectorId, type, phase } = req.query;
  const secrets = _vault()?.listSecrets?.({ connectorId, type, phase, orgId: company.orgId, requestingAccountId: req.user.sub }) || [];
  res.json({ ok: true, orgId: company.orgId, connectors: secrets });
});

router.post("/company-factory/companies/:id/connectors/:connectorId/:type", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "manage_billing");
  if (!company) return;
  const { value, meta } = req.body || {};
  if (!value) return res.status(400).json({ ok: false, error: "value required" });
  try {
    // Enterprise Module 4: connector-restriction policy (allow/deny list by
    // connectorId, e.g. "msg:slack") — checked before the secret is stored.
    // Deliberately NOT wrapped in _try — a policy violation must reach the
    // catch block below and reject the request, not be silently swallowed.
    require("../services/policyService.cjs").assertConnectorAllowed(company.orgId, req.params.connectorId);
    const record = _vault()?.storeSecret?.(req.params.connectorId, req.params.type, value, meta || {}, company.orgId, req.user.sub);
    res.json({ ok: true, orgId: company.orgId, connector: record });
  } catch (e) {
    res.status(e.status || 400).json({ ok: false, error: e.message });
  }
});

router.post("/company-factory/companies/:id/connectors/:connectorId/:type/validate", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_analytics");
  if (!company) return;
  const result = _vault()?.validateSecret?.(req.params.connectorId, req.params.type, company.orgId, req.user.sub);
  res.json({ ok: true, orgId: company.orgId, validation: result });
});

router.delete("/company-factory/companies/:id/connectors/:connectorId/:type", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "manage_billing");
  if (!company) return;
  const deleted = _vault()?.deleteSecret?.(req.params.connectorId, req.params.type, company.orgId, req.user.sub);
  res.json({ ok: !!deleted });
});

// ── Company Analytics (composes M1–M5's orgId-scoped systems) ────────────────
// Pure aggregation, no new storage — pulls lifecycle/blueprint/workspace data
// from companyDashboard.cjs (existing) and CRM/AI-cost/budget/connector-health
// from the systems wired in M3/M4/M5, all keyed by the company's orgId.

router.get("/company-factory/companies/:id/analytics", requireAuth, (req, res) => {
  const company = _requireCompanyOrgPermission(req, res, "view_analytics");
  if (!company) return;

  const detail   = _cd()?.getCompanyDetail?.(company.id) || null;
  const crm      = _bds()?.getDashboard?.(company.orgId) || null;
  const aiUsage  = _usage()?.summary?.({ orgId: company.orgId, fromLedger: true }) || null;
  const budget   = _budgets()?.getOrgBudget?.(company.orgId) || null;
  const connectors = _vault()?.listSecrets?.({ orgId: company.orgId, requestingAccountId: req.user.sub }) || [];

  res.json({
    ok: true,
    orgId: company.orgId,
    lifecycle: detail,
    crm,
    ai: { usage: aiUsage, budget },
    connectors: {
      total: connectors.length,
      configured: connectors.map(c => ({ connectorId: c.connectorId, type: c.type, rotationDueAt: c.rotationDueAt })),
    },
    generatedAt: new Date().toISOString(),
  });
});

module.exports = router;
