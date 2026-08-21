"use strict";
/**
 * productFactory.js — POST-Ω P12 Autonomous Product Factory
 * Routes: /product-factory/*
 *
 * Planner:      POST /product-factory/plan, GET /product-factory/plan/:id, GET /product-factory/plans, GET /product-factory/plan/stats
 * Architecture: POST /product-factory/arch/:planId, GET /product-factory/arch/:id, GET /product-factory/arch/plan/:planId, GET /product-factory/archs, GET /product-factory/arch/stats
 * Assembly:     POST /product-factory/assemble/:planId, GET /product-factory/assembly/:id, GET /product-factory/assembly/plan/:planId, GET /product-factory/assemblies, GET /product-factory/assembly/stats
 * Validation:   POST /product-factory/validate/:planId, GET /product-factory/validation/:id, GET /product-factory/validation/plan/:planId, GET /product-factory/validations, GET /product-factory/validation/stats
 * Release:      POST /product-factory/release/:planId, GET /product-factory/release/:id, GET /product-factory/release/plan/:planId, GET /product-factory/releases, GET /product-factory/release/stats
 * Dashboard:    GET /product-factory/dashboard, GET /product-factory/dashboard/product/:planId, GET /product-factory/health
 * Pipeline:     POST /product-factory/pipeline  (full plan→arch→assemble→validate→release in one call)
 *
 * ECOSYSTEM OS RECOVERY (2026-08-15): the Product OS pass (2026-08-15,
 * earlier the same day) found and live-reproduced a real cross-tenant
 * exposure here — any authenticated user of any org could list every plan
 * on the platform, read any plan by direct id in full, and genuinely WRITE
 * to another tenant's plan via this file's own /arch/:planId endpoint. That
 * pass classified it as requiring "broad architecture" and left it
 * documented, not fixed. This recovery pass re-investigated per its own
 * mandate not to accept that verdict without checking the actual blast
 * radius: confirmed via grep that zero other services call into the 5 P12
 * engines' data functions (only this route file and its frontend,
 * ProductOSCenter.jsx, do) — so real org-scoping was safely retrofittable
 * with zero risk to other systems. Fixed identically to the already-proven
 * /dev/* pattern (developerOS.cjs, C10-003): requireAuth + attachOrg, a
 * real 403 for no resolvable org context, and orgId threaded as the first
 * argument into every service call. Aggregate-only endpoints (the 5
 * *_/stats routes and the whole-platform GET /product-factory/dashboard)
 * are intentionally left unscoped — they return counts, never individual
 * record content, matching the precedent already established for
 * /graph/stats in the Knowledge OS pass.
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const { attachOrg, requireOrgMember } = require("../middleware/orgMiddleware.cjs");

// Module Loader & Dynamic Module Resolution Security Sweep (2026-08-21):
// these were unguarded hardcoded-path requires — a broken/missing module
// would surface Node's raw "Cannot find module" + require stack to any
// requireAuth-only customer via the nearest catch block. Wired into the
// _try helper already defined on this line (previously unused for these
// accessors) — same idiom already certified elsewhere in this codebase.
const _try  = fn => { try { return fn(); } catch (e) { return null; } };
const ppe   = () => _try(() => require("../services/productPlannerEngine.cjs"));
const pae   = () => _try(() => require("../services/productArchitectureEngine.cjs"));
const pasm  = () => _try(() => require("../services/productAssemblyEngine.cjs"));
const pve   = () => _try(() => require("../services/productValidationEngine.cjs"));
const pre   = () => _try(() => require("../services/productReleaseEngine.cjs"));
const pfd   = () => _try(() => require("../services/productFactoryDashboard.cjs"));

function ok(res, data)  { res.json({ ok: true,  ...data }); }
function err(res, msg, code = 400) { res.status(code).json({ ok: false, error: msg }); }

// Ecosystem OS recovery (2026-08-15): attachOrg alone resolves req.org from
// a caller-supplied X-Org-Id header/query/body with NO membership check —
// it is explicitly documented as non-blocking in orgMiddleware.cjs's own
// header. A bare `!req.org?.id` check (this route's first version this
// pass) only verifies SOME real org was resolved, not that the caller
// belongs to it — live-reproduced: account B, forging X-Org-Id to account
// A's real org, received account A's real product plan in a 200. The same
// vector was also reproduced against /dev/* (developerOS.cjs, C10-003),
// which this route's first version had copied as its precedent — that
// route has the identical gap; not fixed here (out of this pass's direct
// scope, but see reports/OS-ECOSYSTEM-SECURITY.md for the escalation).
// requireOrgMember verifies real membership (or a cross-org grant / real
// enterprise_admin role) before any handler below runs — the same gate
// business.js already uses for its own CRM data routes.
router.use((req, res, next) => requireAuth(req, res, () => attachOrg(req, res, next)));
router.use("/product-factory", requireOrgMember);

// ── Planner ───────────────────────────────────────────────────────────────────

router.post("/product-factory/plan", async (req, res) => {
  const { objective, context, skipResearch } = req.body || {};
  if (!objective) return err(res, "objective required");
  const r = ppe().createPlan({ objective, orgId: req.org.id, context, skipResearch });
  if (!r.ok) return err(res, r.error);
  ok(res, { plan: r.plan });
});

router.get("/product-factory/plan/stats", (req, res) => {
  ok(res, ppe().getStats());
});

router.get("/product-factory/plan/:id", (req, res) => {
  const p = ppe().getPlan(req.org.id, req.params.id);
  if (!p) return err(res, "plan not found", 404);
  ok(res, { plan: p });
});

router.get("/product-factory/plans", (req, res) => {
  const { status, limit } = req.query;
  ok(res, ppe().listPlans(req.org.id, { status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Architecture ──────────────────────────────────────────────────────────────

router.post("/product-factory/arch/:planId", async (req, res) => {
  const { skipReasoning } = req.body || {};
  const r = pae().design(req.org.id, req.params.planId, { skipReasoning });
  if (!r.ok) return err(res, r.error);
  ok(res, { architecture: r.architecture });
});

router.get("/product-factory/arch/stats", (req, res) => {
  ok(res, pae().getStats());
});

router.get("/product-factory/arch/plan/:planId", (req, res) => {
  const a = pae().getArchitectureForPlan(req.org.id, req.params.planId);
  if (!a) return err(res, "architecture not found", 404);
  ok(res, { architecture: a });
});

router.get("/product-factory/arch/:id", (req, res) => {
  const a = pae().getArchitecture(req.org.id, req.params.id);
  if (!a) return err(res, "architecture not found", 404);
  ok(res, { architecture: a });
});

router.get("/product-factory/archs", (req, res) => {
  const { limit } = req.query;
  ok(res, pae().listArchitectures(req.org.id, { limit: limit ? parseInt(limit) : 50 }));
});

// ── Assembly ──────────────────────────────────────────────────────────────────

router.post("/product-factory/assemble/:planId", async (req, res) => {
  const { archId, skipExecute } = req.body || {};
  const r = await pasm().assemble(req.org.id, req.params.planId, archId, { skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, { assembly: r.assembly });
});

router.get("/product-factory/assembly/stats", (req, res) => {
  ok(res, pasm().getStats());
});

router.get("/product-factory/assembly/plan/:planId", (req, res) => {
  const a = pasm().getAssemblyForPlan(req.org.id, req.params.planId);
  if (!a) return err(res, "assembly not found", 404);
  ok(res, { assembly: a });
});

router.get("/product-factory/assembly/:id", (req, res) => {
  const a = pasm().getAssembly(req.org.id, req.params.id);
  if (!a) return err(res, "assembly not found", 404);
  ok(res, { assembly: a });
});

router.get("/product-factory/assemblies", (req, res) => {
  const { status, limit } = req.query;
  ok(res, pasm().listAssemblies(req.org.id, { status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Validation ────────────────────────────────────────────────────────────────

router.post("/product-factory/validate/:planId", async (req, res) => {
  const { skipExecute } = req.body || {};
  const r = await pve().validate(req.org.id, req.params.planId, { skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, { validation: r.validation });
});

router.get("/product-factory/validation/stats", (req, res) => {
  ok(res, pve().getStats());
});

router.get("/product-factory/validation/plan/:planId", (req, res) => {
  const v = pve().getValidationForPlan(req.org.id, req.params.planId);
  if (!v) return err(res, "validation not found", 404);
  ok(res, { validation: v });
});

router.get("/product-factory/validation/:id", (req, res) => {
  const v = pve().getValidation(req.org.id, req.params.id);
  if (!v) return err(res, "validation not found", 404);
  ok(res, { validation: v });
});

router.get("/product-factory/validations", (req, res) => {
  const { status, limit } = req.query;
  ok(res, pve().listValidations(req.org.id, { status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Release ───────────────────────────────────────────────────────────────────

router.post("/product-factory/release/:planId", async (req, res) => {
  const { skipExecute } = req.body || {};
  const r = await pre().prepare(req.org.id, req.params.planId, { skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, { release: r.release });
});

router.get("/product-factory/release/stats", (req, res) => {
  ok(res, pre().getStats());
});

router.get("/product-factory/release/plan/:planId", (req, res) => {
  const r = pre().getReleaseForPlan(req.org.id, req.params.planId);
  if (!r) return err(res, "release not found", 404);
  ok(res, { release: r });
});

router.get("/product-factory/release/:id", (req, res) => {
  const r = pre().getRelease(req.org.id, req.params.id);
  if (!r) return err(res, "release not found", 404);
  ok(res, { release: r });
});

router.get("/product-factory/releases", (req, res) => {
  const { status, limit } = req.query;
  ok(res, pre().listReleases(req.org.id, { status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/product-factory/dashboard", (req, res) => {
  ok(res, pfd().getDashboard());
});

router.get("/product-factory/dashboard/product/:planId", (req, res) => {
  const r = pfd().getProductView(req.org.id, req.params.planId);
  if (!r.ok) return err(res, r.error, 404);
  res.json(r);
});

router.get("/product-factory/health", (req, res) => {
  ok(res, pfd().getProductFactoryHealth());
});

// ── Full pipeline (one-shot: plan → arch → assemble → validate → release) ────

router.post("/product-factory/pipeline", async (req, res) => {
  const { objective, context, skipExecute = false } = req.body || {};
  if (!objective) return err(res, "objective required");
  const orgId = req.org.id;

  const results = {};

  // 1. Plan
  const planResult = ppe().createPlan({ objective, orgId, context, skipResearch: skipExecute });
  if (!planResult.ok) return err(res, `planning failed: ${planResult.error}`);
  results.plan = planResult.plan;

  // 2. Architecture
  const archResult = pae().design(orgId, planResult.plan.id, { skipReasoning: skipExecute });
  if (!archResult.ok) return err(res, `architecture failed: ${archResult.error}`);
  results.architecture = archResult.architecture;

  // 3. Assembly
  const asmResult = await pasm().assemble(orgId, planResult.plan.id, archResult.architecture.id, { skipExecute });
  if (!asmResult.ok) return err(res, `assembly failed: ${asmResult.error}`);
  results.assembly = asmResult.assembly;

  // 4. Validation
  const valResult = await pve().validate(orgId, planResult.plan.id, { skipExecute });
  if (!valResult.ok) return err(res, `validation failed: ${valResult.error}`);
  results.validation = valResult.validation;

  // 5. Release
  const relResult = await pre().prepare(orgId, planResult.plan.id, { skipExecute: true });
  if (!relResult.ok) return err(res, `release failed: ${relResult.error}`);
  results.release = relResult.release;

  const minutesSaved = (results.plan.minutesSaved || 0)
    + (results.assembly.minutesSaved || 0)
    + (results.release.minutesSaved || 0);

  ok(res, {
    pipeline:     "complete",
    planId:       results.plan.id,
    version:      results.release.version,
    reuseRatio:   results.architecture.reuseRatio,
    validationScore: results.validation.overallScore,
    productionReady: results.validation.productionReady,
    minutesSaved,
    results,
  });
});

module.exports = router;
