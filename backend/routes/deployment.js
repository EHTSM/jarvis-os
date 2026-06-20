"use strict";
/**
 * deployment.js — Phase I8: Autonomous Deployment routes
 *
 * I8-1  POST /deployment/run                — run a deployment spec
 * I8-2  GET  /deployment/targets             — list deployment target profiles
 * I8-2  POST /deployment/targets/register    — register user-defined target
 * I8-3  GET  /deployment/:id/health          — current health snapshot
 * I8-4  POST /deployment/:id/rollback        — manual rollback
 * I8-5  GET  /deployment/active              — active deployments (dashboard)
 * I8-5  GET  /deployment/stats               — aggregate stats
 * I8-5  GET  /deployment                     — list deployments
 * I8-5  GET  /deployment/:id                 — deployment detail with stages
 * I8-6  POST /deployment/benchmark           — run 10 production scenarios
 * I8-6  GET  /deployment/benchmark/last      — last benchmark report
 *       POST /deployment/:id/approve          — approve production gate
 *       POST /deployment/:id/cancel           — cancel running deployment
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

function _dc() { return require("../services/deploymentCoordinator.cjs"); }
let _lastBenchReport = null;

function _ok(res, data)     { res.json({ ok: true, ...data }); }
function _err(res, e, code) { res.status(code || 500).json({ ok: false, error: e?.message || String(e) }); }

router.use(requireAuth);

// ── Specific routes BEFORE /:id ──────────────────────────────────────────────

// GET /deployment/active
router.get("/deployment/active", (req, res) => {
    try { _ok(res, { deployments: _dc().getActiveDeploys() }); }
    catch (e) { _err(res, e); }
});

// GET /deployment/stats
router.get("/deployment/stats", (req, res) => {
    try { _ok(res, { stats: _dc().getStats() }); }
    catch (e) { _err(res, e); }
});

// GET /deployment/targets
router.get("/deployment/targets", (req, res) => {
    try { _ok(res, { targets: _dc().getDeploymentTargets() }); }
    catch (e) { _err(res, e); }
});

// POST /deployment/targets/register
router.post("/deployment/targets/register", (req, res) => {
    try {
        const target = _dc().registerTarget(req.body || {});
        _ok(res, { target });
    } catch (e) { _err(res, e, 400); }
});

// GET /deployment/benchmark/last
router.get("/deployment/benchmark/last", (req, res) => {
    if (!_lastBenchReport) return res.status(404).json({ ok: false, error: "No benchmark report. POST /deployment/benchmark to run." });
    _ok(res, { report: _lastBenchReport });
});

// POST /deployment/benchmark — I8-6
router.post("/deployment/benchmark", async (req, res) => {
    try {
        res.json({ ok: true, message: "I8-6 production benchmark started. GET /deployment/benchmark/last for results." });
        _dc().runProductionBenchmark(req.body || {}).then(r => { _lastBenchReport = r; }).catch(err => {
            require("../utils/logger").warn(`[DeployRoute] benchmark error: ${err.message}`);
        });
    } catch (e) { _err(res, e); }
});

// GET /deployment — list
router.get("/deployment", (req, res) => {
    try {
        const opts = {
            status: req.query.status,
            target: req.query.target,
            limit:  req.query.limit ? parseInt(req.query.limit, 10) : 50,
        };
        _ok(res, _dc().listDeployments(opts));
    } catch (e) { _err(res, e); }
});

// POST /deployment/run
router.post("/deployment/run", async (req, res) => {
    try {
        const { target, pipelineId, goal, artifact, commitHash, requireApproval, healthThreshold, rollbackOnFail } = req.body || {};
        if (!target && !pipelineId) return _err(res, new Error("target or pipelineId required"), 400);
        const spec = { target, pipelineId, goal, artifact, commitHash };
        const opts = { requireApproval, healthThreshold, rollbackOnFail };
        // Start async, return deploy ID immediately
        const depPromise = _dc().runDeployment(spec, opts);
        depPromise.catch(err => require("../utils/logger").warn(`[DeployRoute] error: ${err.message}`));
        await new Promise(r => setTimeout(r, 50));
        const active  = _dc().getActiveDeploys();
        const started = active[active.length - 1] || null;
        _ok(res, { message: "Deployment started", deployment: started });
    } catch (e) { _err(res, e); }
});

// ── Parameterised routes ─────────────────────────────────────────────────────

// GET /deployment/:id
router.get("/deployment/:id", (req, res) => {
    try {
        const d = _dc().getDeployment(req.params.id);
        if (!d) return res.status(404).json({ ok: false, error: "Deployment not found" });
        _ok(res, { deployment: d });
    } catch (e) { _err(res, e); }
});

// GET /deployment/:id/health
router.get("/deployment/:id/health", (req, res) => {
    try {
        const d = _dc().getDeployment(req.params.id);
        if (!d) return res.status(404).json({ ok: false, error: "Deployment not found" });
        _ok(res, {
            deployId:        d.deployId,
            target:          d.target,
            healthSnapshot:  d.healthSnapshot,
            preDeployHealth: d.preDeployHealth,
            postDeployHealth:d.postDeployHealth,
        });
    } catch (e) { _err(res, e); }
});

// POST /deployment/:id/approve
router.post("/deployment/:id/approve", (req, res) => {
    try { _ok(res, { deployment: _dc().approveDeployment(req.params.id) }); }
    catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 400); }
});

// POST /deployment/:id/rollback
router.post("/deployment/:id/rollback", async (req, res) => {
    try { _ok(res, { deployment: await _dc().rollbackDeployment(req.params.id) }); }
    catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 400); }
});

// POST /deployment/:id/cancel
router.post("/deployment/:id/cancel", (req, res) => {
    try { _ok(res, { deployment: _dc().cancelDeployment(req.params.id) }); }
    catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 400); }
});

// ── OP-1: Deployment Report ──────────────────────────────────────────────────
// GET /deployment/op1-report — generate OP-1 production deployment report
router.get("/deployment/op1-report", async (req, res) => {
    try {
        const { generateReport } = require("../services/deploymentReport.cjs");
        const report = await generateReport();
        res.json({ ok: true, report });
    } catch (e) { _err(res, e); }
});

module.exports = router;
