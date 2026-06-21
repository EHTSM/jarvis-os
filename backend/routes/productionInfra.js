"use strict";
/**
 * CO1 Production Infrastructure Routes
 * Prefix: /ops/infra/*
 * All routes require auth (operator-only).
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const {
  auditGitHubReadiness,
  auditVPSReadiness,
  auditEnvironment,
  auditDatabase,
  auditMonitoring,
  runSecurityAudit,
  getSecurityAuditHistory,
  auditDeploymentPipeline,
  logDeployment,
  getDeploymentHistory,
  auditDocumentation,
  getLaunchChecklist,
  updateLaunchItem,
  resetLaunchChecklist,
  runBenchmark,
  getLoadTests,
  LAUNCH_ITEMS,
  DEPLOY_SCRIPTS,
  SECURITY_CHECKS,
} = require("../services/productionInfra.cjs");

const _ok  = (res, data)    => res.json({ ok: true,  ...data });
const _err = (res, e, code = 500) => res.status(code).json({ ok: false, error: e?.message || String(e) });

// ── M1: Production GitHub ─────────────────────────────────────────────────────
router.get("/ops/infra/github", requireAuth, (req, res) => {
  try { _ok(res, auditGitHubReadiness()); } catch (e) { _err(res, e); }
});

// ── M2: Production VPS ────────────────────────────────────────────────────────
router.get("/ops/infra/vps", requireAuth, (req, res) => {
  try { _ok(res, auditVPSReadiness()); } catch (e) { _err(res, e); }
});
router.post("/ops/infra/vps/update", requireAuth, (req, res) => {
  try { _ok(res, auditVPSReadiness(req.body || {})); } catch (e) { _err(res, e); }
});

// ── M3: Production Environment ────────────────────────────────────────────────
router.get("/ops/infra/environment", requireAuth, (req, res) => {
  try {
    const r = auditEnvironment();
    // Mask actual values before returning to client
    r.checks = r.checks.map(c => ({ ...c, value: undefined }));
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

// ── M4: Production Database ───────────────────────────────────────────────────
router.get("/ops/infra/database", requireAuth, (req, res) => {
  try { _ok(res, auditDatabase()); } catch (e) { _err(res, e); }
});

// ── M5: Monitoring ────────────────────────────────────────────────────────────
router.get("/ops/infra/monitoring", requireAuth, (req, res) => {
  try { _ok(res, auditMonitoring()); } catch (e) { _err(res, e); }
});

// ── M6: Security Audit ────────────────────────────────────────────────────────
router.get("/ops/infra/security/run",     requireAuth, (req, res) => {
  try { _ok(res, runSecurityAudit()); } catch (e) { _err(res, e); }
});
router.get("/ops/infra/security/history", requireAuth, (req, res) => {
  try { _ok(res, { history: getSecurityAuditHistory() }); } catch (e) { _err(res, e); }
});
router.get("/ops/infra/security/checks",  requireAuth, (req, res) => {
  _ok(res, { checks: SECURITY_CHECKS });
});

// ── M7: Deployment Pipeline ───────────────────────────────────────────────────
router.get("/ops/infra/deployment",        requireAuth, (req, res) => {
  try { _ok(res, auditDeploymentPipeline()); } catch (e) { _err(res, e); }
});
router.post("/ops/infra/deployment/log",   requireAuth, (req, res) => {
  try { _ok(res, logDeployment(req.body || {})); } catch (e) { _err(res, e); }
});
router.get("/ops/infra/deployment/history",requireAuth, (req, res) => {
  try { _ok(res, { history: getDeploymentHistory(Number(req.query.limit) || 20) }); } catch (e) { _err(res, e); }
});
router.get("/ops/infra/deployment/scripts",requireAuth, (req, res) => {
  _ok(res, { scripts: DEPLOY_SCRIPTS });
});

// ── M8: Documentation ─────────────────────────────────────────────────────────
router.get("/ops/infra/docs", requireAuth, (req, res) => {
  try { _ok(res, auditDocumentation()); } catch (e) { _err(res, e); }
});

// ── M9: Launch Checklist ──────────────────────────────────────────────────────
router.get("/ops/infra/launch",                  requireAuth, (req, res) => {
  try { _ok(res, getLaunchChecklist()); } catch (e) { _err(res, e); }
});
router.post("/ops/infra/launch/:itemId/done",    requireAuth, (req, res) => {
  try {
    const { note = "" } = req.body || {};
    _ok(res, updateLaunchItem(req.params.itemId, true, note));
  } catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.post("/ops/infra/launch/:itemId/undone",  requireAuth, (req, res) => {
  try {
    const { note = "" } = req.body || {};
    _ok(res, updateLaunchItem(req.params.itemId, false, note));
  } catch (e) { _err(res, e, e.message?.includes("not found") ? 404 : 500); }
});
router.post("/ops/infra/launch/reset",           requireAuth, (req, res) => {
  try { _ok(res, resetLaunchChecklist()); } catch (e) { _err(res, e); }
});
router.get("/ops/infra/launch/items",            requireAuth, (req, res) => {
  _ok(res, { items: LAUNCH_ITEMS });
});

// ── M10: Benchmark ────────────────────────────────────────────────────────────
router.get("/ops/infra/benchmark",     requireAuth, (req, res) => {
  try { _ok(res, runBenchmark()); } catch (e) { _err(res, e); }
});
router.get("/ops/infra/load-tests",    requireAuth, (req, res) => {
  try { _ok(res, { tests: getLoadTests(Number(req.query.limit) || 10) }); } catch (e) { _err(res, e); }
});

// ── Executive summary (all modules in one call) ───────────────────────────────
router.get("/ops/infra/executive", requireAuth, (req, res) => {
  try {
    const github     = auditGitHubReadiness();
    const env        = (() => { const r = auditEnvironment(); return { score: r.score, ready: r.ready, requiredPassing: r.requiredPassing, requiredTotal: r.requiredTotal }; })();
    const database   = (() => { const r = auditDatabase(); return { integrityScore: r.integrityScore, backupScore: r.backupScore, backupCount: r.backupCount, ready: r.ready }; })();
    const monitoring = (() => { const r = auditMonitoring(); return { score: r.score, ready: r.ready }; })();
    const security   = (() => { const r = runSecurityAudit(); return { score: r.score, grade: r.grade, ready: r.ready }; })();
    const deploy     = (() => { const r = auditDeploymentPipeline(); return { score: r.score, rollback: r.rollback, ready: r.ready }; })();
    const docs       = (() => { const r = auditDocumentation(); return { score: r.score, present: r.present, requiredTotal: r.requiredTotal, ready: r.ready }; })();
    const launch     = (() => { const r = getLaunchChecklist(); return { score: r.score, critScore: r.critScore, goLive: r.goLive, critDone: r.critDone, critTotal: r.critTotal }; })();

    const scores = [github.score, env.score, database.integrityScore, monitoring.score, security.score, deploy.score, docs.score, launch.score];
    const overall = Math.round(scores.reduce((s, v) => s + (v || 0), 0) / scores.length);

    _ok(res, {
      overall,
      modules: { github, env, database, monitoring, security, deploy, docs, launch },
      checkedAt: new Date().toISOString(),
    });
  } catch (e) { _err(res, e); }
});

module.exports = router;
