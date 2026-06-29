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
 */

const router = require("express").Router();

const _try  = fn => { try { return fn(); } catch (e) { return null; } };
const ppe   = () => require("../services/productPlannerEngine.cjs");
const pae   = () => require("../services/productArchitectureEngine.cjs");
const pasm  = () => require("../services/productAssemblyEngine.cjs");
const pve   = () => require("../services/productValidationEngine.cjs");
const pre   = () => require("../services/productReleaseEngine.cjs");
const pfd   = () => require("../services/productFactoryDashboard.cjs");

function ok(res, data)  { res.json({ ok: true,  ...data }); }
function err(res, msg, code = 400) { res.status(code).json({ ok: false, error: msg }); }

// ── Planner ───────────────────────────────────────────────────────────────────

router.post("/product-factory/plan", async (req, res) => {
  const { objective, context, skipResearch } = req.body || {};
  if (!objective) return err(res, "objective required");
  const r = ppe().createPlan({ objective, context, skipResearch });
  if (!r.ok) return err(res, r.error);
  ok(res, { plan: r.plan });
});

router.get("/product-factory/plan/stats", (req, res) => {
  ok(res, ppe().getStats());
});

router.get("/product-factory/plan/:id", (req, res) => {
  const p = ppe().getPlan(req.params.id);
  if (!p) return err(res, "plan not found", 404);
  ok(res, { plan: p });
});

router.get("/product-factory/plans", (req, res) => {
  const { status, limit } = req.query;
  ok(res, ppe().listPlans({ status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Architecture ──────────────────────────────────────────────────────────────

router.post("/product-factory/arch/:planId", async (req, res) => {
  const { skipReasoning } = req.body || {};
  const r = pae().design(req.params.planId, { skipReasoning });
  if (!r.ok) return err(res, r.error);
  ok(res, { architecture: r.architecture });
});

router.get("/product-factory/arch/stats", (req, res) => {
  ok(res, pae().getStats());
});

router.get("/product-factory/arch/plan/:planId", (req, res) => {
  const a = pae().getArchitectureForPlan(req.params.planId);
  if (!a) return err(res, "architecture not found", 404);
  ok(res, { architecture: a });
});

router.get("/product-factory/arch/:id", (req, res) => {
  const a = pae().getArchitecture(req.params.id);
  if (!a) return err(res, "architecture not found", 404);
  ok(res, { architecture: a });
});

router.get("/product-factory/archs", (req, res) => {
  const { limit } = req.query;
  ok(res, pae().listArchitectures({ limit: limit ? parseInt(limit) : 50 }));
});

// ── Assembly ──────────────────────────────────────────────────────────────────

router.post("/product-factory/assemble/:planId", async (req, res) => {
  const { archId, skipExecute } = req.body || {};
  const r = await pasm().assemble(req.params.planId, archId, { skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, { assembly: r.assembly });
});

router.get("/product-factory/assembly/stats", (req, res) => {
  ok(res, pasm().getStats());
});

router.get("/product-factory/assembly/plan/:planId", (req, res) => {
  const a = pasm().getAssemblyForPlan(req.params.planId);
  if (!a) return err(res, "assembly not found", 404);
  ok(res, { assembly: a });
});

router.get("/product-factory/assembly/:id", (req, res) => {
  const a = pasm().getAssembly(req.params.id);
  if (!a) return err(res, "assembly not found", 404);
  ok(res, { assembly: a });
});

router.get("/product-factory/assemblies", (req, res) => {
  const { status, limit } = req.query;
  ok(res, pasm().listAssemblies({ status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Validation ────────────────────────────────────────────────────────────────

router.post("/product-factory/validate/:planId", async (req, res) => {
  const { skipExecute } = req.body || {};
  const r = await pve().validate(req.params.planId, { skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, { validation: r.validation });
});

router.get("/product-factory/validation/stats", (req, res) => {
  ok(res, pve().getStats());
});

router.get("/product-factory/validation/plan/:planId", (req, res) => {
  const v = pve().getValidationForPlan(req.params.planId);
  if (!v) return err(res, "validation not found", 404);
  ok(res, { validation: v });
});

router.get("/product-factory/validation/:id", (req, res) => {
  const v = pve().getValidation(req.params.id);
  if (!v) return err(res, "validation not found", 404);
  ok(res, { validation: v });
});

router.get("/product-factory/validations", (req, res) => {
  const { status, limit } = req.query;
  ok(res, pve().listValidations({ status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Release ───────────────────────────────────────────────────────────────────

router.post("/product-factory/release/:planId", async (req, res) => {
  const { skipExecute } = req.body || {};
  const r = await pre().prepare(req.params.planId, { skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, { release: r.release });
});

router.get("/product-factory/release/stats", (req, res) => {
  ok(res, pre().getStats());
});

router.get("/product-factory/release/plan/:planId", (req, res) => {
  const r = pre().getReleaseForPlan(req.params.planId);
  if (!r) return err(res, "release not found", 404);
  ok(res, { release: r });
});

router.get("/product-factory/release/:id", (req, res) => {
  const r = pre().getRelease(req.params.id);
  if (!r) return err(res, "release not found", 404);
  ok(res, { release: r });
});

router.get("/product-factory/releases", (req, res) => {
  const { status, limit } = req.query;
  ok(res, pre().listReleases({ status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/product-factory/dashboard", (req, res) => {
  ok(res, pfd().getDashboard());
});

router.get("/product-factory/dashboard/product/:planId", (req, res) => {
  const r = pfd().getProductView(req.params.planId);
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

  const results = {};

  // 1. Plan
  const planResult = ppe().createPlan({ objective, context, skipResearch: skipExecute });
  if (!planResult.ok) return err(res, `planning failed: ${planResult.error}`);
  results.plan = planResult.plan;

  // 2. Architecture
  const archResult = pae().design(planResult.plan.id, { skipReasoning: skipExecute });
  if (!archResult.ok) return err(res, `architecture failed: ${archResult.error}`);
  results.architecture = archResult.architecture;

  // 3. Assembly
  const asmResult = await pasm().assemble(planResult.plan.id, archResult.architecture.id, { skipExecute });
  if (!asmResult.ok) return err(res, `assembly failed: ${asmResult.error}`);
  results.assembly = asmResult.assembly;

  // 4. Validation
  const valResult = await pve().validate(planResult.plan.id, { skipExecute });
  if (!valResult.ok) return err(res, `validation failed: ${valResult.error}`);
  results.validation = valResult.validation;

  // 5. Release
  const relResult = await pre().prepare(planResult.plan.id, { skipExecute: true });
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
