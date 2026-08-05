"use strict";
/**
 * Artificial Organization Platform Routes (LEVEL Ω)
 * Base: /platform/* and /platform/v1/*
 *
 * Exposes all 20 platform capabilities as REST APIs:
 *   - Organization Studio       /platform/v1/orgs
 *   - Blueprint Designer        /platform/v1/blueprints
 *   - Template Marketplace      /platform/v1/templates
 *   - Deployment Center         /platform/v1/deploy
 *   - Lifecycle Dashboard       /platform/v1/lifecycle
 *   - Organization Registry     /platform/v1/registry
 *   - Simulator                 /platform/v1/simulate
 *   - Digital Twin              /platform/v1/twin/:orgId
 *   - Import/Export             /platform/v1/export, /platform/v1/import
 *   - Marketplace               /platform/v1/marketplace
 *   - Clone / Fork              /platform/v1/clone
 *   - Versioning                /platform/v1/versions
 *   - Certification             /platform/v1/certify
 *   - SDK                       /platform/v1/sdk
 *   - Analytics                 /platform/v1/analytics
 *   - CLI endpoints             /platform/v1/cli
 */

const router = require("express").Router();
const _st  = () => require("../services/platformState.cjs");
const _org = () => require("../services/platformOrg.cjs");
const _orgSvc = () => require("../services/organizationService.cjs");

const ok  = (res, data)     => res.json({ ok: true,  ...data });
const err = (res, msg, code)=> res.status(code || 400).json({ ok: false, error: msg });

// Security Hardening (Zero-Trust Competitor Remediation, Phase 1): this
// entire router previously resolved platform-orgs (the "Artificial
// Organization Platform" / Level Ω model — distinct from the tenant
// Org/Dept/Team RBAC model in organizationService.cjs) purely by client-
// supplied :orgId, with zero ownership check anywhere in the file — gated
// only by the barrel-level `router.use("/platform", requireAuth)` in
// routes/index.js, which authenticates but never authorizes. Any
// authenticated user could read, export, roll back, clone, or retire any
// other account's private platform-org by ID. Reproduced live against a
// running server with two real accounts (created via the app's own
// /accounts/register + /auth/login, not mocked) before this fix: the
// attacker account could GET another account's private org, export its
// full data package, view its digital twin, and PATCH its lifecycle status
// to "retired" — a destructive mutation, not just a read.
//
// Fix: `ownerId` is now always derived server-side from req.user.sub on
// every creation path (never trusted from the request body — the old code
// accepted an arbitrary client-supplied ownerId/tenantId with no binding to
// the authenticated session at all). `_requireOrgOwner` below resolves the
// org by :orgId (or an explicit orgId in the body) and rejects with 404
// unless the requester is the recorded owner or a global enterprise_admin
// (reusing organizationService.isEnterpriseAdmin — the same admin-escape
// hatch requireOrgMember already uses elsewhere, not a new privilege tier).
// Legacy orgs created before this fix (ownerId === null/undefined) are
// treated as unowned/orphaned and are only reachable by an enterprise_admin
// — never by an arbitrary authenticated user — since there is no legitimate
// owner account on file to match against.
function _requireOrgOwner(resolveOrgId) {
  return (req, res, next) => {
    const orgId = resolveOrgId(req);
    if (!orgId) return err(res, "orgId required", 400);
    const org = _st().getOrg(orgId);
    if (!org) return err(res, "Org not found", 404);
    const accountId = req.user?.sub;
    if (accountId && org.ownerId && org.ownerId === accountId) return next();
    if (accountId && _orgSvc().isEnterpriseAdmin(accountId)) return next();
    // 404, not 403 — do not confirm existence of an org the requester
    // cannot access (matches the IDOR-hardened convention already used by
    // requireOrgMember in orgMiddleware.cjs).
    return err(res, "Org not found", 404);
  };
}
const _ownerOfParam = (param) => (req) => req.params[param];
const _ownerOfBodyOrgId = (req) => req.body?.orgId;

// ── Status / Summary ──────────────────────────────────────────────────────────
router.get("/platform/status",  (req, res) => ok(res, { agents: _org().getOrgStatus() }));
router.get("/platform/summary", (req, res) => ok(res, _org().getOrgSummary()));
router.get("/platform/agents/:id", (req, res) => {
  const agent = _org().getOrgStatus().find(a => a.id === req.params.id);
  return agent ? ok(res, agent) : err(res, "Agent not found", 404);
});

// ── PLATFORM CONTROL ──────────────────────────────────────────────────────────
router.get("/platform/v1/control",   (req, res) => ok(res, { control: _st().getControlState() }));
router.patch("/platform/v1/control", (req, res) => ok(res, _st().updateControlState(req.body)));

// ── ORGANIZATION STUDIO (Registry) ───────────────────────────────────────────
// list is scoped to the caller's own orgs by default — a caller cannot pass
// an arbitrary ownerId query param to enumerate someone else's orgs; only an
// enterprise_admin may pass an explicit ownerId/tenantId override.
router.get("/platform/v1/orgs",      (req, res) => {
  const accountId = req.user?.sub;
  const isAdmin = accountId && _orgSvc().isEnterpriseAdmin(accountId);
  const ownerId = isAdmin && req.query.ownerId ? req.query.ownerId : accountId;
  return ok(res, { orgs: _st().listOrgs({ type: req.query.type, tenantId: isAdmin ? req.query.tenantId : undefined, ownerId, status: req.query.status, visibility: req.query.visibility, limit: parseInt(req.query.limit) || 50 }) });
});
router.get("/platform/v1/orgs/:id",  _requireOrgOwner(_ownerOfParam("id")), (req, res) => {
  const org = _st().getOrg(req.params.id);
  return org ? ok(res, { org }) : err(res, "Org not found", 404);
});
router.post("/platform/v1/orgs",     (req, res) => {
  // ownerId is always the authenticated caller — never trusted from the
  // request body (previously `req.body.ownerId` was accepted verbatim,
  // meaning ownership itself was spoofable, not just unchecked on read).
  const r = _st().registerOrg({ ...req.body, ownerId: req.user?.sub, tenantId: req.body?.tenantId });
  return r.ok ? ok(res, { org: r.org, existing: r.existing }) : err(res, r.error);
});
router.patch("/platform/v1/orgs/:id", _requireOrgOwner(_ownerOfParam("id")), (req, res) => {
  const { ownerId, ...patch } = req.body || {}; // ownership is not reassignable via a patch body
  const r = _st().updateOrg(req.params.id, patch);
  return r.ok ? ok(res, { org: r.org }) : err(res, r.error);
});
router.get("/platform/v1/orgs/:id/health", _requireOrgOwner(_ownerOfParam("id")), (req, res) => {
  const h = _st().getOrgHealth(req.params.id);
  return h ? ok(res, h) : err(res, "Org not found", 404);
});
router.post("/platform/v1/orgs/:id/policy", _requireOrgOwner(_ownerOfParam("id")), (req, res) => {
  const r = _st().addOrgPolicy(req.params.id, req.body);
  return r.ok ? ok(res, { entry: r.entry }) : err(res, r.error);
});

// ── BLUEPRINT DESIGNER ────────────────────────────────────────────────────────
router.get("/platform/v1/blueprints",         (req, res) => ok(res, { blueprints: _st().listBlueprints({ type: req.query.type, status: req.query.status, tenantId: req.query.tenantId, limit: parseInt(req.query.limit)||50 }) }));
router.get("/platform/v1/blueprints/built-in",(req, res) => ok(res, { templates: _st().listBuiltInTemplates() }));
router.get("/platform/v1/blueprints/:id",     (req, res) => {
  const bp = _st().getBlueprint(req.params.id) || _st().getBuiltInTemplate(req.params.id);
  return bp ? ok(res, { blueprint: bp }) : err(res, "Blueprint not found", 404);
});
router.post("/platform/v1/blueprints",        (req, res) => {
  const r = _st().createBlueprint(req.body);
  return r.ok ? ok(res, { blueprint: r.blueprint }) : err(res, r.error);
});
router.patch("/platform/v1/blueprints/:id",   (req, res) => {
  const r = _st().updateBlueprint(req.params.id, req.body);
  return r.ok ? ok(res, { blueprint: r.blueprint }) : err(res, r.error);
});
router.post("/platform/v1/blueprints/:id/publish", (req, res) => {
  const r = _st().publishBlueprint(req.params.id);
  return r.ok ? ok(res, { blueprint: r.blueprint }) : err(res, r.error);
});

// ── TEMPLATE MARKETPLACE ──────────────────────────────────────────────────────
router.get("/platform/v1/templates",           (req, res) => ok(res, { templates: _st().listTemplates({ category: req.query.category, authorId: req.query.authorId, free: req.query.free === "true", minRating: req.query.minRating ? parseFloat(req.query.minRating) : undefined, limit: parseInt(req.query.limit)||50 }) }));
router.get("/platform/v1/templates/:id",       (req, res) => {
  const t = _st().getTemplate(req.params.id);
  return t ? ok(res, { template: t }) : err(res, "Template not found", 404);
});
router.post("/platform/v1/templates",          (req, res) => {
  const r = _st().publishTemplate(req.body);
  return r.ok ? ok(res, { template: r.template, existing: r.existing }) : err(res, r.error);
});
router.post("/platform/v1/templates/:id/install", (req, res) => {
  const r = _st().installTemplate(req.params.id, req.body);
  return r.ok ? ok(res, { template: r.template, blueprint: r.blueprint }) : err(res, r.error);
});
router.post("/platform/v1/templates/:id/rate", (req, res) => {
  const r = _st().rateTemplate(req.params.id, req.body);
  return r.ok ? ok(res, { template: r.template }) : err(res, r.error);
});

// ── DEPLOYMENT CENTER ─────────────────────────────────────────────────────────
router.post("/platform/v1/deploy",          (req, res) => {
  const r = _st().deployOrg({ ...req.body, ownerId: req.user?.sub });
  return r.ok ? ok(res, { deployment: r.deployment, org: r.org, capabilities: r.capabilities }) : err(res, r.error);
});
router.get("/platform/v1/deployments",      (req, res) => {
  const accountId = req.user?.sub;
  const isAdmin = accountId && _orgSvc().isEnterpriseAdmin(accountId);
  // Deployments aren't owner-tagged directly — scope via the caller's own orgs
  // unless they're an admin, so this can't be used to enumerate other accounts'
  // deployment history by guessing/incrementing an unrelated orgId.
  const myOrgIds = isAdmin ? null : new Set(_st().listOrgs({ ownerId: accountId, limit: 10000 }).map(o => o.id));
  let deployments = _st().listDeployments({ orgId: req.query.orgId, tenantId: isAdmin ? req.query.tenantId : undefined, status: req.query.status, limit: parseInt(req.query.limit)||50 });
  if (!isAdmin) deployments = deployments.filter(d => myOrgIds.has(d.orgId));
  return ok(res, { deployments });
});
router.get("/platform/v1/deployments/:id",  (req, res) => {
  const d = _st().getDeployment(req.params.id);
  if (!d) return err(res, "Deployment not found", 404);
  const accountId = req.user?.sub;
  const org = d.orgId ? _st().getOrg(d.orgId) : null;
  const isOwner = accountId && org && org.ownerId === accountId;
  const isAdmin = accountId && _orgSvc().isEnterpriseAdmin(accountId);
  if (!isOwner && !isAdmin) return err(res, "Deployment not found", 404);
  return ok(res, { deployment: d });
});

// ── QUICK DEPLOY (one-step: name + type → deployed org) ──────────────────────
router.post("/platform/v1/deploy/quick", (req, res) => {
  const { name, type = "custom", capabilities, tenantId, templateId } = req.body;
  const ownerId = req.user?.sub; // never trust a client-supplied ownerId
  if (!name) return err(res, "name required");

  let bpId = null;
  // Use built-in template if given
  if (templateId) {
    const tpl = _st().getBuiltInTemplate(templateId);
    if (tpl) {
      const bps = _st().listBlueprints({ limit: 200 });
      const existing = bps.find(b => b.name === tpl.name);
      const bp = existing || (() => { const r = _st().createBlueprint({ name: tpl.name, description: tpl.description, type: tpl.type, capabilities: tpl.capabilities, authorId: ownerId || "user", tenantId }); return r.ok ? (_st().publishBlueprint(r.blueprint.id), r.blueprint) : null; })();
      if (bp) bpId = bp.id;
    }
  } else {
    // Create blueprint from name+type
    const r = _st().createBlueprint({ name, type, capabilities: capabilities || [], tenantId, authorId: ownerId || "user" });
    if (r.ok) { _st().publishBlueprint(r.blueprint.id); bpId = r.blueprint.id; }
  }

  const r = _st().deployOrg({ blueprintId: bpId, tenantId, ownerId, triggeredBy: "quick_deploy", config: { name, type } });
  return r.ok ? ok(res, { deployment: r.deployment, org: r.org, capabilities: r.capabilities }) : err(res, r.error);
});

// ── LIFECYCLE DASHBOARD ───────────────────────────────────────────────────────
router.get("/platform/v1/lifecycle",         (req, res) => {
  const accountId = req.user?.sub;
  const isAdmin = accountId && _orgSvc().isEnterpriseAdmin(accountId);
  const orgs = _st().listOrgs({ status: req.query.status, tenantId: isAdmin ? req.query.tenantId : undefined, ownerId: isAdmin ? undefined : accountId });
  const summary = { active: 0, provisioning: 0, paused: 0, retired: 0 };
  orgs.forEach(o => { summary[o.status] = (summary[o.status] || 0) + 1; });
  return ok(res, { lifecycle: summary, orgs });
});
router.patch("/platform/v1/lifecycle/:orgId", _requireOrgOwner(_ownerOfParam("orgId")), (req, res) => {
  const { status } = req.body;
  if (!["active","paused","retired"].includes(status)) return err(res, "status must be active/paused/retired");
  const r = _st().updateOrg(req.params.orgId, { status });
  return r.ok ? ok(res, { org: r.org }) : err(res, r.error);
});

// ── CLONE / FORK ──────────────────────────────────────────────────────────────
// Cloning reads from a source org (sourceOrgId) and always writes the clone
// under the caller's own ownership — both ends need to be locked down:
// the source must belong to the caller (or be admin-accessible), and the
// resulting clone's ownerId is never taken from the request body.
router.post("/platform/v1/clone",  _requireOrgOwner((req) => req.body?.sourceOrgId), (req, res) => {
  const r = _st().cloneOrg({ ...req.body, ownerId: req.user?.sub, forkMode: false });
  return r.ok ? ok(res, { org: r.org, blueprint: r.blueprint, clone: r.clone }) : err(res, r.error);
});
router.post("/platform/v1/fork",   _requireOrgOwner((req) => req.body?.sourceOrgId), (req, res) => {
  const r = _st().cloneOrg({ ...req.body, ownerId: req.user?.sub, forkMode: true });
  return r.ok ? ok(res, { org: r.org, blueprint: r.blueprint, clone: r.clone }) : err(res, r.error);
});
router.get("/platform/v1/clones",  (req, res) => {
  const accountId = req.user?.sub;
  const isAdmin = accountId && _orgSvc().isEnterpriseAdmin(accountId);
  const clones = _st().listClones({ sourceOrgId: req.query.sourceOrgId, tenantId: isAdmin ? req.query.tenantId : undefined, type: req.query.type });
  const filtered = isAdmin ? clones : clones.filter(c => c.ownerId === accountId);
  return ok(res, { clones: filtered });
});

// ── VERSIONING ────────────────────────────────────────────────────────────────
router.get("/platform/v1/versions",            _requireOrgOwner((req) => req.query.orgId), (req, res) => {
  return ok(res, { versions: _st().listVersions({ orgId: req.query.orgId, blueprintId: req.query.blueprintId, limit: parseInt(req.query.limit)||20 }) });
});
router.post("/platform/v1/versions",           _requireOrgOwner((req) => req.body?.orgId), (req, res) => {
  const r = _st().createVersion(req.body);
  return r.ok ? ok(res, { version: r.version }) : err(res, r.error);
});
router.post("/platform/v1/versions/rollback",  _requireOrgOwner(_ownerOfBodyOrgId), (req, res) => {
  const { orgId, versionId } = req.body;
  if (!orgId || !versionId) return err(res, "orgId and versionId required");
  const r = _st().rollbackVersion(orgId, versionId);
  return r.ok ? ok(res, { org: r.org, rolledBackTo: r.rolledBackTo }) : err(res, r.error);
});

// ── UPGRADE ENGINE ────────────────────────────────────────────────────────────
router.post("/platform/v1/upgrade", _requireOrgOwner((req) => req.body?.orgId), (req, res) => {
  const r = _st().upgradeOrg(req.body);
  return r.ok ? ok(res, { org: r.org, fromVersion: r.fromVersion, toVersion: r.toVersion }) : err(res, r.error);
});

// ── MIGRATION ENGINE ──────────────────────────────────────────────────────────
router.post("/platform/v1/migrate", _requireOrgOwner((req) => req.body?.orgId), (req, res) => {
  const r = _st().migrateOrg(req.body);
  return r.ok ? ok(res, { org: r.org, migrated: r.migrated }) : err(res, r.error);
});

// ── EXPORT / IMPORT (Backup & Restore) ───────────────────────────────────────
router.get("/platform/v1/export/:orgId",  _requireOrgOwner(_ownerOfParam("orgId")), (req, res) => {
  const r = _st().exportOrg(req.params.orgId);
  return r.ok ? ok(res, { package: r.package }) : err(res, r.error);
});
router.post("/platform/v1/import",        (req, res) => {
  // Imported orgs are always owned by the importing caller — never by
  // whatever ownerId happens to be embedded in the uploaded package.
  const r = _st().importOrg(req.body.package, { ...req.body, ownerId: req.user?.sub });
  return r.ok ? ok(res, { org: r.org, blueprint: r.blueprint }) : err(res, r.error);
});
router.get("/platform/v1/packages",       (req, res) => {
  const accountId = req.user?.sub;
  const isAdmin = accountId && _orgSvc().isEnterpriseAdmin(accountId);
  const packages = _st().listPackages({ tenantId: isAdmin ? req.query.tenantId : undefined, limit: parseInt(req.query.limit)||50 });
  const filtered = isAdmin ? packages : packages.filter(p => p.org?.ownerId === accountId);
  return ok(res, { packages: filtered });
});

// ── SIMULATOR ─────────────────────────────────────────────────────────────────
router.post("/platform/v1/simulate", (req, res) => {
  const r = _st().simulateOrg(req.body);
  return r.ok ? ok(res, { simulation: r.simulation }) : err(res, r.error);
});

// ── DIGITAL TWIN ──────────────────────────────────────────────────────────────
router.get("/platform/v1/twin/:orgId", _requireOrgOwner(_ownerOfParam("orgId")), (req, res) => {
  const twin = _st().getDigitalTwin(req.params.orgId);
  return twin ? ok(res, { twin }) : err(res, "Org not found", 404);
});

// ── MARKETPLACE ───────────────────────────────────────────────────────────────
router.get("/platform/v1/marketplace",              (req, res) => ok(res, { listings: _st().listMarketplaceItems({ category: req.query.category, maxPrice: req.query.maxPrice !== undefined ? parseFloat(req.query.maxPrice) : undefined, limit: parseInt(req.query.limit)||50 }) }));
router.post("/platform/v1/marketplace",             (req, res) => {
  const r = _st().listOnMarketplace(req.body);
  return r.ok ? ok(res, { listing: r.listing }) : err(res, r.error);
});
router.post("/platform/v1/marketplace/:id/purchase",(req, res) => {
  const r = _st().purchaseFromMarketplace(req.params.id, req.body);
  return r.ok ? ok(res, { listing: r.listing, result: r.result }) : err(res, r.error);
});

// ── CERTIFICATION ─────────────────────────────────────────────────────────────
// orgId is optional here (omitted = "certifications across all of the
// caller's own orgs"), so this always scopes to the caller's own org set —
// an admin may pass an explicit orgId/no filter to see across all orgs.
router.get("/platform/v1/certifications",      (req, res) => {
  const accountId = req.user?.sub;
  const isAdmin = accountId && _orgSvc().isEnterpriseAdmin(accountId);
  if (req.query.orgId && !isAdmin) {
    const org = _st().getOrg(req.query.orgId);
    if (!org || org.ownerId !== accountId) return err(res, "Org not found", 404);
  }
  const myOrgIds = isAdmin ? null : new Set(_st().listOrgs({ ownerId: accountId, limit: 10000 }).map(o => o.id));
  let certs = _st().listCertifications({ orgId: req.query.orgId, level: req.query.level, status: req.query.status, limit: parseInt(req.query.limit)||50 });
  if (!isAdmin) certs = certs.filter(c => myOrgIds.has(c.orgId));
  return ok(res, { certifications: certs });
});
router.post("/platform/v1/certify",            _requireOrgOwner((req) => req.body?.orgId), (req, res) => {
  const r = _st().certifyOrg(req.body);
  return r.ok ? ok(res, { cert: r.cert }) : err(res, r.error);
});

// ── SDK ───────────────────────────────────────────────────────────────────────
router.get("/platform/v1/sdk",          (req, res) => ok(res, { sdk: _st().getSDKManifest() }));
router.get("/platform/v1/sdk/manifest", (req, res) => ok(res, { manifest: _st().getSDKManifest() }));
router.get("/platform/v1/sdk/types",    (req, res) => ok(res, { orgTypes: _st().ORG_TYPES, capabilitySets: _st().CAPABILITY_SETS }));

// ── ANALYTICS + REPORTS ───────────────────────────────────────────────────────
router.get("/platform/v1/analytics",  (req, res) => ok(res, { analytics: _st().getPlatformAnalytics() }));
router.get("/platform/v1/reports",    (req, res) => ok(res, { reports: _st().listPlatformReports({ type: req.query.type, limit: parseInt(req.query.limit)||20 }) }));
router.post("/platform/v1/reports",   (req, res) => {
  const r = _st().createPlatformReport(req.body);
  return r.ok ? ok(res, { report: r.report }) : err(res, r.error);
});

// ── CLI ENDPOINTS (machine-friendly) ─────────────────────────────────────────
router.post("/platform/v1/cli/deploy",    (req, res) => {
  // CLI: platform deploy --name "AI Agency" --type agency
  const { name, type = "custom", templateId, tenantId } = req.body;
  const ownerId = req.user?.sub; // never trust a client-supplied ownerId
  if (!name) return err(res, "name required");
  let bpId = null;
  if (templateId) {
    const tpl = _st().getBuiltInTemplate(templateId);
    if (tpl) {
      const bps = _st().listBlueprints({ limit: 200 });
      const existing = bps.find(b => b.name === tpl.name);
      if (existing) { bpId = existing.id; }
      else { const r = _st().createBlueprint({ name: tpl.name, description: tpl.description, type: tpl.type, capabilities: tpl.capabilities, authorId: ownerId || "cli", tenantId }); if (r.ok) { _st().publishBlueprint(r.blueprint.id); bpId = r.blueprint.id; } }
    }
  } else {
    const r = _st().createBlueprint({ name, type, tenantId, authorId: ownerId || "cli" });
    if (r.ok) { _st().publishBlueprint(r.blueprint.id); bpId = r.blueprint.id; }
  }
  const r = _st().deployOrg({ blueprintId: bpId, tenantId, ownerId, triggeredBy: "cli" });
  return r.ok ? ok(res, { org: r.org, message: `✓ Deployed: ${r.org?.name}`, deploymentId: r.deployment?.id }) : err(res, r.error);
});

router.get("/platform/v1/cli/status",     (req, res) => {
  const analytics = _st().getPlatformAnalytics();
  return ok(res, { platform: "Ooplix Artificial Organization Platform", version: _st().getSDKManifest().version, orgs: analytics.orgs.total, activeOrgs: analytics.orgs.active, blueprints: analytics.blueprints.total, deployments: analytics.deployments.total });
});

router.post("/platform/v1/cli/clone",     _requireOrgOwner((req) => req.body?.sourceOrgId), (req, res) => {
  const r = _st().cloneOrg({ ...req.body, ownerId: req.user?.sub });
  return r.ok ? ok(res, { org: r.org, message: `✓ Cloned: ${r.org?.name}` }) : err(res, r.error);
});

router.get("/platform/v1/cli/templates",  (req, res) => ok(res, { templates: _st().listBuiltInTemplates().map(t => ({ id: t.templateId, name: t.name, type: t.type, capabilities: t.capabilities })) }));

// ── PUBLIC ORGANIZATION API ───────────────────────────────────────────────────
router.get("/platform/v1/registry",       (req, res) => ok(res, { orgs: _st().listOrgs({ visibility: "public", status: "active", limit: parseInt(req.query.limit)||50 }), total: _st().listOrgs({ visibility: "public" }).length }));
router.get("/platform/v1/registry/:id",   (req, res) => {
  const org = _st().getOrg(req.params.id);
  return org ? ok(res, { org }) : err(res, "Org not found", 404);
});

module.exports = router;
