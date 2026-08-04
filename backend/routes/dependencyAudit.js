"use strict";
/**
 * V6 Phase 5: Autonomous DevOps — Dependency Audit routes
 * Prefix: /devops/dependencies/*
 *
 * Read routes: requireAuth. Update route (real npm update + regression +
 * possible git checkout revert): requireAuth + operatorOnly — real
 * repository mutation, matching the gate already applied to
 * /deployment/*, /dop2/vps/run, and revenueOS.js's billing routes.
 */
const router = require("express").Router();
const { requireAuth, operatorOnly } = require("../middleware/authMiddleware");

function _svc() { return require("../services/dependencyAuditEngine.cjs"); }
function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

router.post("/devops/dependencies/scan", requireAuth, (req, res) => {
    try { _ok(res, _svc().scanVulnerabilities()); }
    catch (e) { _err(res, e); }
});

router.get("/devops/dependencies/scan/last", requireAuth, (req, res) => {
    const last = _svc().getLastScan();
    if (!last) return _err(res, new Error("No scan yet — POST /devops/dependencies/scan"), 404);
    _ok(res, { scan: last });
});

router.get("/devops/dependencies/scans", requireAuth, (req, res) => {
    const { limit } = req.query;
    _ok(res, { scans: _svc().listScans({ limit: limit ? +limit : 20 }) });
});

router.get("/devops/dependencies/outdated", requireAuth, (req, res) => {
    try { _ok(res, _svc().listOutdated()); }
    catch (e) { _err(res, e); }
});

router.post("/devops/dependencies/update", requireAuth, operatorOnly, async (req, res) => {
    try {
        const { packageName, runRegression } = req.body || {};
        if (!packageName) return _err(res, new Error("packageName required"), 400);
        _ok(res, await _svc().applySafeUpdate(packageName, { runRegression: runRegression !== false }));
    } catch (e) { _err(res, e); }
});

router.get("/devops/dependencies/updates", requireAuth, (req, res) => {
    const { limit } = req.query;
    _ok(res, { updates: _svc().listUpdates({ limit: limit ? +limit : 50 }) });
});

router.get("/devops/dependencies/stats", requireAuth, (req, res) => {
    _ok(res, { stats: _svc().getStats() });
});

module.exports = router;
