"use strict";
/**
 * scientificDiscovery.js — POST-Ω P18 Scientific Discovery Engine
 * Routes: /science/*
 *
 * Discovery Plans:    POST /science/plan
 *                     GET  /science/plans, /science/plans/:id
 *                     GET  /science/plan/stats
 *
 * Hypotheses:         POST /science/hypotheses/generate
 *                     PUT  /science/hypotheses/:id/status
 *                     GET  /science/hypotheses, /science/hypotheses/:id
 *                     GET  /science/hypothesis/stats
 *
 * Experiments:        POST /science/experiments/:hypothesisId/run
 *                     GET  /science/experiments, /science/experiments/:id
 *                     GET  /science/experiment/stats
 *
 * Publications:       POST /science/publications/:experimentId/publish
 *                     POST /science/publications/queue/:experimentId
 *                     POST /science/publications/process-queue
 *                     GET  /science/publications, /science/publications/:id
 *                     GET  /science/publication/stats
 *
 * Innovations:        POST /science/innovations/scan
 *                     POST /science/innovations
 *                     PUT  /science/innovations/:id/apply
 *                     GET  /science/innovations, /science/innovations/:id
 *                     GET  /science/innovation/stats
 *
 * Dashboard:          GET  /science/dashboard
 *                     GET  /science/pipeline
 *                     GET  /science/health-system
 *
 * Full Pipeline:      POST /science/pipeline/run
 */

const router = require("express").Router();

const dpe = () => require("../services/discoveryPlannerEngine.cjs");
const hyp = () => require("../services/hypothesisEngine.cjs");
const eoe = () => require("../services/experimentOrchestratorEngine.cjs");
const pub = () => require("../services/publicationEngine.cjs");
const inn = () => require("../services/innovationEngine.cjs");
const sdb = () => require("../services/scientificDiscoveryDashboard.cjs");

function ok(res, data)           { res.json({ ok: true, ...data }); }
function err(res, msg, code=400) { res.status(code).json({ ok: false, error: msg }); }

// ── Discovery Plans ───────────────────────────────────────────────────────────

router.post("/science/plan", (req, res) => {
  ok(res, dpe().plan());
});

router.get("/science/plan/stats", (req, res) => {
  ok(res, dpe().getStats());
});

router.get("/science/plans/:id", (req, res) => {
  const p = dpe().getPlan(req.params.id);
  if (!p) return err(res, "plan not found", 404);
  ok(res, { plan: p });
});

router.get("/science/plans", (req, res) => {
  const { domain, priority, limit } = req.query;
  ok(res, dpe().listPlans({ domain, priority, limit: limit ? parseInt(limit) : 50 }));
});

// ── Hypotheses ────────────────────────────────────────────────────────────────

router.post("/science/hypotheses/generate", (req, res) => {
  const { sources } = req.body || {};
  ok(res, hyp().generate({ sources }));
});

router.put("/science/hypotheses/:id/status", (req, res) => {
  const { status, experimentId, note } = req.body || {};
  if (!status) return err(res, "status is required");
  const r = hyp().updateStatus(req.params.id, status, { experimentId, note });
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/science/hypothesis/stats", (req, res) => {
  ok(res, hyp().getStats());
});

router.get("/science/hypotheses/:id", (req, res) => {
  const h = hyp().getHypothesis(req.params.id);
  if (!h) return err(res, "hypothesis not found", 404);
  ok(res, { hypothesis: h });
});

router.get("/science/hypotheses", (req, res) => {
  const { source, domain, status, limit } = req.query;
  ok(res, hyp().listHypotheses({ source, domain, status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Experiments ───────────────────────────────────────────────────────────────

router.post("/science/experiments/:hypothesisId/run", async (req, res) => {
  const { skipExecute } = req.body || {};
  const r = await eoe().orchestrate(req.params.hypothesisId, { skipExecute });
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.get("/science/experiment/stats", (req, res) => {
  ok(res, eoe().getStats());
});

router.get("/science/experiments/:id", (req, res) => {
  const e = eoe().getExperiment(req.params.id);
  if (!e) return err(res, "experiment not found", 404);
  ok(res, { experiment: e });
});

router.get("/science/experiments", (req, res) => {
  const { domain, outcome, limit } = req.query;
  ok(res, eoe().listExperiments({ domain, outcome, limit: limit ? parseInt(limit) : 50 }));
});

// ── Publications ──────────────────────────────────────────────────────────────

router.post("/science/publications/:experimentId/publish", (req, res) => {
  const { types } = req.body || {};
  const r = pub().publish(req.params.experimentId, types);
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.post("/science/publications/queue/:experimentId", (req, res) => {
  ok(res, pub().queueForPublication(req.params.experimentId));
});

router.post("/science/publications/process-queue", (req, res) => {
  ok(res, pub().processQueue());
});

router.get("/science/publication/stats", (req, res) => {
  ok(res, pub().getStats());
});

router.get("/science/publications/:id", (req, res) => {
  const p = pub().getPublication(req.params.id);
  if (!p) return err(res, "publication not found", 404);
  ok(res, { publication: p });
});

router.get("/science/publications", (req, res) => {
  const { type, domain, status, limit } = req.query;
  ok(res, pub().listPublications({ type, domain, status, limit: limit ? parseInt(limit) : 50 }));
});

// ── Innovations ───────────────────────────────────────────────────────────────

router.post("/science/innovations/scan", (req, res) => {
  ok(res, inn().scan());
});

router.post("/science/innovations", (req, res) => {
  const r = inn().recordInnovation(req.body || {});
  if (!r.ok) return err(res, r.error);
  ok(res, r);
});

router.put("/science/innovations/:id/apply", (req, res) => {
  const r = inn().markApplied(req.params.id);
  if (!r.ok) return err(res, r.error, 404);
  ok(res, r);
});

router.get("/science/innovation/stats", (req, res) => {
  ok(res, inn().getStats());
});

router.get("/science/innovations/:id", (req, res) => {
  const i = inn().getInnovation(req.params.id);
  if (!i) return err(res, "innovation not found", 404);
  ok(res, { innovation: i });
});

router.get("/science/innovations", (req, res) => {
  const { type, impact, applied, limit } = req.query;
  const appliedBool = applied !== undefined ? applied === "true" : undefined;
  ok(res, inn().listInnovations({ type, impact, applied: appliedBool, limit: limit ? parseInt(limit) : 50 }));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/science/dashboard", (req, res) => {
  ok(res, sdb().getDashboard());
});

router.get("/science/pipeline", (req, res) => {
  ok(res, sdb().getPipelineView());
});

router.get("/science/health-system", (req, res) => {
  ok(res, sdb().getScientificSystemHealth());
});

// ── Full Pipeline ─────────────────────────────────────────────────────────────

router.post("/science/pipeline/run", async (req, res) => {
  const { skipExecute } = req.body || {};
  const steps = [];

  // 1. Plan
  const planResult = dpe().plan();
  steps.push({ step: "plan", ok: planResult.ok, found: planResult.found });

  // 2. Generate hypotheses
  const hypResult = hyp().generate();
  steps.push({ step: "generate_hypotheses", ok: hypResult.ok, generated: hypResult.generated });

  // 3. Orchestrate top hypothesis
  const topHyps = (hypResult.hypotheses || []).filter(h => h.status === "draft");
  let expResult = null;
  let pubResult = null;
  if (topHyps.length > 0) {
    const top = topHyps.sort((a, b) => b.confidence - a.confidence)[0];
    expResult = await eoe().orchestrate(top.id, { skipExecute });
    steps.push({ step: "orchestrate_experiment", ok: expResult.ok, outcome: expResult.experiment?.outcome });

    // 4. Publish
    if (expResult.ok && expResult.experiment) {
      pubResult = pub().publish(expResult.experiment.id);
      steps.push({ step: "publish", ok: pubResult.ok, published: pubResult.published });
    }
  } else {
    steps.push({ step: "orchestrate_experiment", ok: false, message: "No draft hypotheses" });
  }

  // 5. Scan innovations
  const innResult = inn().scan();
  steps.push({ step: "scan_innovations", ok: innResult.ok, discovered: innResult.discovered });

  // 6. Dashboard
  const db = sdb().getDashboard();
  steps.push({ step: "dashboard", ok: db.ok, innovationScore: db.summary.innovationScore });

  ok(res, {
    pipeline:       "scientific_discovery",
    stepsCompleted: steps.filter(s => s.ok).length,
    totalSteps:     steps.length,
    steps,
    summary: db.summary,
  });
});

module.exports = router;
