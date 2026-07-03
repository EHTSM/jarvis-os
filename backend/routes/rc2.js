"use strict";
/**
 * rc2 routes — Production RC-2: Deployment Rehearsal
 * All routes at /rc2/* require auth.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/rc2.cjs");

router.use("/rc2", requireAuth);

function _ok(res, data)  { res.json({ ok: true, ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── Full rehearsal ────────────────────────────────────────────────────────

router.post("/rc2/rehearse", (req, res) => {
  try { _ok(res, svc.runFullRehearsal()); } catch (e) { _err(res, e); }
});

// ── Report ────────────────────────────────────────────────────────────────

router.post("/rc2/report/generate", (req, res) => {
  try { _ok(res, svc.generateRC2Report()); } catch (e) { _err(res, e); }
});

router.get("/rc2/report", (req, res) => {
  try {
    const r = svc.getRC2Report();
    if (!r) return res.status(404).json({ ok: false, error: "No RC-2 report. POST /rc2/report/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

// ── Individual steps ──────────────────────────────────────────────────────

router.get("/rc2/steps", (req, res) => {
  try {
    _ok(res, {
      steps: [
        { step: 1,  name: "Fresh VPS Setup" },
        { step: 2,  name: "Git Clone" },
        { step: 3,  name: "Dependency Install" },
        { step: 4,  name: "Environment Setup" },
        { step: 5,  name: "PM2 Startup" },
        { step: 6,  name: "Nginx" },
        { step: 7,  name: "SSL / HTTPS" },
        { step: 8,  name: "Electron Auto-Update" },
        { step: 9,  name: "Health Endpoints" },
        { step: 10, name: "Rollback Rehearsal" },
        { step: 11, name: "Restart Recovery" },
        { step: 12, name: "Backup Restore" },
        { step: 13, name: "Smoke Tests" },
      ],
    });
  } catch (e) { _err(res, e); }
});

router.get("/rc2/steps/:step", (req, res) => {
  try {
    const step = parseInt(req.params.step, 10);
    if (isNaN(step)) return res.status(400).json({ ok: false, error: "step must be a number 1–13" });
    _ok(res, svc.runStep(step));
  } catch (e) { _err(res, e); }
});

// Convenience named step routes
router.get("/rc2/steps/vps-setup",         (req, res) => { try { _ok(res, svc.rehearseVpsSetup()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/git-clone",         (req, res) => { try { _ok(res, svc.rehearseGitClone()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/deps",              (req, res) => { try { _ok(res, svc.rehearseDependencyInstall()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/env",               (req, res) => { try { _ok(res, svc.rehearseEnvironmentSetup()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/pm2",               (req, res) => { try { _ok(res, svc.rehearsePm2Startup()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/nginx",             (req, res) => { try { _ok(res, svc.rehearseNginx()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/ssl",               (req, res) => { try { _ok(res, svc.rehearseSsl()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/electron-update",   (req, res) => { try { _ok(res, svc.rehearseElectronUpdate()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/health-endpoints",  (req, res) => { try { _ok(res, svc.rehearseHealthEndpoints()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/rollback",          (req, res) => { try { _ok(res, svc.rehearseRollback()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/restart-recovery",  (req, res) => { try { _ok(res, svc.rehearseRestartRecovery()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/backup-restore",    (req, res) => { try { _ok(res, svc.rehearseBackupRestore()); } catch (e) { _err(res, e); } });
router.get("/rc2/steps/smoke-tests",       (req, res) => { try { _ok(res, svc.rehearseSmokeTests()); } catch (e) { _err(res, e); } });

// ── State + admin ─────────────────────────────────────────────────────────

router.get("/rc2/state", (req, res) => {
  try { _ok(res, svc.getRC2State()); } catch (e) { _err(res, e); }
});

router.post("/rc2/reset", (req, res) => {
  try { _ok(res, svc.resetRC2State()); } catch (e) { _err(res, e); }
});

// ── Metadata ──────────────────────────────────────────────────────────────

router.get("/rc2/metadata", (req, res) => {
  _ok(res, {
    version:      svc.RC2_VERSION,
    description:  "End-to-end production deployment rehearsal — 13 steps, no live VPS required",
    stepsTotal:   13,
    scope: [
      "Fresh VPS Setup", "Git Clone", "Dependency Install", "Environment Setup",
      "PM2 Startup", "Nginx", "SSL/HTTPS", "Electron Auto-Update",
      "Health Endpoints", "Rollback", "Restart Recovery", "Backup Restore", "Smoke Tests",
    ],
  });
});

module.exports = router;
