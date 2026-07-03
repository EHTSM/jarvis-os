"use strict";
/**
 * betaReadiness routes — Production Mission 6: Closed Beta Readiness
 * All routes at /beta/* require auth.
 * 7 area routes + dashboard + report generation.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/betaReadiness.cjs");

router.use("/beta", requireAuth);

function _ok(res, data)  { res.json({ ok: true,  ...data }); }
function _err(res, e, c) { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── Dashboard ────────────────────────────────────────────────────────────────
router.get("/beta/dashboard", (req, res) => {
  try { _ok(res, svc.getBetaDashboard()); } catch (e) { _err(res, e); }
});

// ── Beta status / gate ────────────────────────────────────────────────────────
router.get("/beta/status", (req, res) => {
  try { _ok(res, svc.getBetaStatus()); } catch (e) { _err(res, e); }
});

router.post("/beta/gate/check", (req, res) => {
  try {
    const { inviteCode } = req.body || {};
    _ok(res, svc.checkBetaGate(inviteCode));
  } catch (e) { _err(res, e); }
});

// ── Area A: Onboarding ────────────────────────────────────────────────────────
router.get("/beta/onboarding", (req, res) => {
  try { _ok(res, svc.getOnboardingChecklist()); } catch (e) { _err(res, e); }
});

router.post("/beta/onboarding/record", (req, res) => {
  try {
    const { checkId, status, notes } = req.body || {};
    if (!checkId) return res.status(400).json({ ok: false, error: "checkId required" });
    if (!status)  return res.status(400).json({ ok: false, error: "status required" });
    _ok(res, svc.recordOnboardingCheck(checkId, status, notes));
  } catch (e) { _err(res, e, e.message?.includes("Unknown") ? 400 : 500); }
});

// ── Area B: Customer lifecycle ────────────────────────────────────────────────
router.get("/beta/lifecycle", (req, res) => {
  try { _ok(res, svc.getCustomerLifecycle()); } catch (e) { _err(res, e); }
});

// ── Area C: Production ops ────────────────────────────────────────────────────
router.get("/beta/ops", (req, res) => {
  try { _ok(res, svc.getProductionOpsStatus()); } catch (e) { _err(res, e); }
});

// ── Area D: Support ───────────────────────────────────────────────────────────
router.get("/beta/support", (req, res) => {
  try { _ok(res, svc.getSupportStatus()); } catch (e) { _err(res, e); }
});

router.post("/beta/support/diagnostic", (req, res) => {
  try {
    const bundle = svc.generateDiagnosticBundle({
      accountId: req.user?.sub,
      context:   req.body?.context || "support",
    });
    _ok(res, { bundle });
  } catch (e) { _err(res, e); }
});

// ── Area E: Telemetry ─────────────────────────────────────────────────────────
router.get("/beta/telemetry", (req, res) => {
  try { _ok(res, svc.getTelemetryStatus()); } catch (e) { _err(res, e); }
});

router.get("/beta/telemetry/retention", (req, res) => {
  try { _ok(res, svc.getRetentionCohorts()); } catch (e) { _err(res, e); }
});

router.post("/beta/telemetry/activity", (req, res) => {
  try {
    const { accountId, activityType } = req.body || {};
    const id = accountId || req.user?.sub;
    if (!id) return res.status(400).json({ ok: false, error: "accountId required" });
    svc.recordUserActivity(id, activityType || "session");
    _ok(res, { recorded: true });
  } catch (e) { _err(res, e); }
});

// ── Area F: Operational readiness ────────────────────────────────────────────
router.get("/beta/readiness", (req, res) => {
  try { _ok(res, svc.getOperationalReadiness()); } catch (e) { _err(res, e); }
});

// ── Interventions ─────────────────────────────────────────────────────────────
router.get("/beta/interventions", (req, res) => {
  try { _ok(res, svc.getInterventionReport()); } catch (e) { _err(res, e); }
});

router.post("/beta/interventions", (req, res) => {
  try {
    const { type, description, userId, resolvedBy, minutesTaken } = req.body || {};
    if (!type) return res.status(400).json({ ok: false, error: "type required" });
    _ok(res, { intervention: svc.recordIntervention({ type, description, userId, resolvedBy, minutesTaken }) });
  } catch (e) { _err(res, e, e.message?.includes("Unknown intervention") ? 400 : 500); }
});

// ── Area G: Report ────────────────────────────────────────────────────────────
router.get("/beta/report", (req, res) => {
  try {
    const r = svc.getBetaVerificationReport();
    if (!r) return res.status(404).json({ ok: false, error: "No report yet. POST /beta/report/generate" });
    _ok(res, r);
  } catch (e) { _err(res, e); }
});

router.post("/beta/report/generate", (req, res) => {
  try { _ok(res, svc.generateBetaVerificationReport()); } catch (e) { _err(res, e); }
});

// ── Metadata ──────────────────────────────────────────────────────────────────
router.get("/beta/metadata", (req, res) => {
  _ok(res, {
    onboardingChecklist: svc.ONBOARDING_CHECKLIST,
    interventionTypes:   svc.INTERVENTION_TYPES,
    knownRisks:          svc.KNOWN_RISKS,
    launchChecklist:     svc.LAUNCH_CHECKLIST,
    betaMaxUsers:        svc.BETA_MAX_USERS,
  });
});

// ── Admin ─────────────────────────────────────────────────────────────────────
router.post("/beta/reset", (req, res) => {
  try { _ok(res, svc.resetBetaState()); } catch (e) { _err(res, e); }
});

module.exports = router;
