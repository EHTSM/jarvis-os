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

router.get("/company-factory/companies", requireAuth, (req, res) => {
  const { stage, templateId, limit } = req.query;
  res.json(_cle_e()?.listCompanies?.({ stage, templateId, limit: limit ? +limit : 50 }) || { ok: false });
});

router.get("/company-factory/companies/:id", requireAuth, (req, res) => {
  const c = _cle_e()?.getCompany?.(req.params.id);
  if (!c) return res.status(404).json({ ok: false, error: "company not found" });
  res.json({ ok: true, company: c });
});

router.get("/company-factory/companies/:id/detail", requireAuth, (req, res) =>
  res.json(_cd()?.getCompanyDetail?.(req.params.id) || { ok: false }));

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

module.exports = router;
