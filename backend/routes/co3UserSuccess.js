"use strict";
/**
 * CO3 — First User Success Program routes
 * All routes under /co3/* with requireAuth.
 */
const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const svc = require("../services/co3UserSuccess.cjs");

router.use("/co3", requireAuth);

function _ok(res, data)    { res.json({ ok: true, ...data }); }
function _err(res, e, c)   { res.status(c || 500).json({ ok: false, error: e?.message || String(e) }); }

// ── Executive ──────────────────────────────────────────────────────────────────
router.get("/co3/executive", (req, res) => {
  try {
    const invite  = svc.getInviteDashboard();
    const fb      = svc.getFeedbackDashboard();
    const cs      = svc.getCSInbox();
    const kb      = svc.getKBDashboard();
    const crash   = svc.getCrashIntelligence();
    const usage   = svc.getUsageInsights();
    const beta    = svc.getBetaOperationsCenter();
    const release = svc.getReleaseManagement();

    const overallModuleScores = [
      Math.min(100, invite.totalCodes > 0 ? 80 + invite.totalActivations * 5 : 0),
      fb.total >= 0 ? 100 : 0,
      usage.snapshots.length >= 0 ? 100 : 0,
      cs.total >= 0 ? 100 : 0,
      Math.min(100, kb.published * 12),
      release.current ? 100 : 40,
      crash.total >= 0 ? 100 : 0,
      usage.snapshots.length >= 0 ? 100 : 0,
      beta.total >= 0 ? 100 : 0,
      100, // benchmark always available
    ];
    const overall = Math.round(overallModuleScores.reduce((s, v) => s + v, 0) / overallModuleScores.length);

    _ok(res, {
      overall,
      invite:  { totalCodes: invite.totalCodes, totalActivations: invite.totalActivations, waitlistTotal: invite.waitlistTotal },
      feedback:{ total: fb.total, open: fb.open },
      cs:      { total: cs.total, open: cs.open, slaBreach: cs.slaBreach },
      kb:      { published: kb.published, videoCount: kb.videoCount },
      crash:   { total: crash.total, critical: crash.critical, regressions: crash.regressions },
      usage:   { latest: usage.latest },
      beta:    { total: beta.total, active: beta.active, onboarded: beta.onboarded },
      release: { version: release.current?.version },
      checkedAt: new Date().toISOString(),
    });
  } catch (e) { _err(res, e); }
});

// ── M1: Invitations ────────────────────────────────────────────────────────────
router.get("/co3/invites", (req, res) => {
  try { _ok(res, svc.getInviteDashboard()); } catch (e) { _err(res, e); }
});

router.post("/co3/invites/create", (req, res) => {
  try {
    const invite = svc.createInviteCode(req.body);
    _ok(res, { invite });
  } catch (e) { _err(res, e); }
});

router.post("/co3/invites/bulk", (req, res) => {
  try {
    const { count = 10, ...opts } = req.body;
    const codes = svc.bulkCreateInviteCodes(Number(count), opts);
    _ok(res, { codes, count: codes.length });
  } catch (e) { _err(res, e); }
});

router.post("/co3/invites/validate", (req, res) => {
  try {
    const result = svc.validateInviteCode(req.body.code || "");
    _ok(res, result);
  } catch (e) { _err(res, e); }
});

router.post("/co3/invites/:code/use", (req, res) => {
  try {
    const invite = svc.useInviteCode(req.params.code, req.body.accountId);
    _ok(res, { invite });
  } catch (e) { _err(res, e, 400); }
});

router.post("/co3/waitlist", (req, res) => {
  try {
    const entry = svc.addToWaitlist(req.body);
    _ok(res, { entry });
  } catch (e) { _err(res, e); }
});

router.patch("/co3/waitlist/:id", (req, res) => {
  try {
    const entry = svc.updateWaitlistEntry(req.params.id, req.body);
    _ok(res, { entry });
  } catch (e) { _err(res, e, 404); }
});

// ── M2: Feedback ───────────────────────────────────────────────────────────────
router.get("/co3/feedback", (req, res) => {
  try { _ok(res, svc.getFeedbackDashboard()); } catch (e) { _err(res, e); }
});

router.post("/co3/feedback", (req, res) => {
  try {
    const item = svc.submitFeedback(req.body);
    _ok(res, { item });
  } catch (e) { _err(res, e); }
});

router.patch("/co3/feedback/:id", (req, res) => {
  try {
    const item = svc.updateFeedback(req.params.id, req.body);
    _ok(res, { item });
  } catch (e) { _err(res, e, 404); }
});

// ── M3: Analytics ──────────────────────────────────────────────────────────────
router.get("/co3/analytics", (req, res) => {
  try { _ok(res, svc.getAnalyticsDashboard()); } catch (e) { _err(res, e); }
});

router.get("/co3/analytics/funnel", (req, res) => {
  try { _ok(res, svc.getFunnelAnalytics()); } catch (e) { _err(res, e); }
});

router.get("/co3/analytics/features", (req, res) => {
  try { _ok(res, { adoption: svc.getFeatureAdoption(), FEATURE_LIST: svc.FEATURE_LIST }); } catch (e) { _err(res, e); }
});

router.get("/co3/analytics/replays", (req, res) => {
  try { _ok(res, svc.getSessionReplayHooks()); } catch (e) { _err(res, e); }
});

router.post("/co3/analytics/event", (req, res) => {
  try {
    const event = svc.trackEvent({ ...req.body, accountId: req.body.accountId || req.user?.id });
    _ok(res, { event });
  } catch (e) { _err(res, e); }
});

// ── M4: Customer Success Inbox ─────────────────────────────────────────────────
router.get("/co3/cs", (req, res) => {
  try { _ok(res, svc.getCSInbox(req.query)); } catch (e) { _err(res, e); }
});

router.post("/co3/cs", (req, res) => {
  try {
    const ticket = svc.createCSTicket(req.body);
    _ok(res, { ticket });
  } catch (e) { _err(res, e); }
});

router.post("/co3/cs/:id/reply", (req, res) => {
  try {
    const ticket = svc.replyToTicket(req.params.id, req.body);
    _ok(res, { ticket });
  } catch (e) { _err(res, e, 404); }
});

router.patch("/co3/cs/:id", (req, res) => {
  try {
    const ticket = svc.updateTicket(req.params.id, req.body);
    _ok(res, { ticket });
  } catch (e) { _err(res, e, 404); }
});

// ── M5: Knowledge Base ─────────────────────────────────────────────────────────
router.get("/co3/kb", (req, res) => {
  try { _ok(res, svc.getKBDashboard()); } catch (e) { _err(res, e); }
});

router.get("/co3/kb/search", (req, res) => {
  try {
    const results = svc.searchKB(req.query.q || "");
    _ok(res, { results, count: results.length });
  } catch (e) { _err(res, e); }
});

router.post("/co3/kb", (req, res) => {
  try {
    const article = svc.createKBArticle(req.body);
    _ok(res, { article });
  } catch (e) { _err(res, e); }
});

router.patch("/co3/kb/:id", (req, res) => {
  try {
    const article = svc.updateKBArticle(req.params.id, req.body);
    _ok(res, { article });
  } catch (e) { _err(res, e, 404); }
});

router.post("/co3/kb/:id/rate", (req, res) => {
  try {
    const result = svc.rateKBArticle(req.params.id, req.body.helpful !== false);
    _ok(res, result);
  } catch (e) { _err(res, e, 404); }
});

// ── M6: Release Management ─────────────────────────────────────────────────────
router.get("/co3/releases", (req, res) => {
  try { _ok(res, svc.getReleaseManagement()); } catch (e) { _err(res, e); }
});

router.post("/co3/releases/bump", (req, res) => {
  try {
    const record = svc.bumpRelease(req.body.strategy || "patch", req.body);
    _ok(res, { record });
  } catch (e) { _err(res, e, 400); }
});

router.post("/co3/releases", (req, res) => {
  try {
    const release = svc.createRelease(req.body);
    _ok(res, { release });
  } catch (e) { _err(res, e); }
});

// ── M7: Crash Intelligence ─────────────────────────────────────────────────────
router.get("/co3/crashes", (req, res) => {
  try { _ok(res, svc.getCrashIntelligence()); } catch (e) { _err(res, e); }
});

router.post("/co3/crashes", (req, res) => {
  try {
    const result = svc.reportCrash(req.body);
    _ok(res, result);
  } catch (e) { _err(res, e); }
});

router.patch("/co3/crashes/:fingerprint", (req, res) => {
  try {
    const group = svc.updateCrashGroup(req.params.fingerprint, req.body);
    _ok(res, { group });
  } catch (e) { _err(res, e, 404); }
});

// ── M8: Usage Insights ─────────────────────────────────────────────────────────
router.get("/co3/usage", (req, res) => {
  try { _ok(res, svc.getUsageInsights()); } catch (e) { _err(res, e); }
});

router.post("/co3/usage/snapshot", (req, res) => {
  try {
    const snap = svc.takeUsageSnapshot();
    _ok(res, { snap });
  } catch (e) { _err(res, e); }
});

// ── M9: Beta Operations Center ─────────────────────────────────────────────────
router.get("/co3/beta", (req, res) => {
  try { _ok(res, svc.getBetaOperationsCenter()); } catch (e) { _err(res, e); }
});

router.post("/co3/beta/users", (req, res) => {
  try {
    const user = svc.addBetaUser(req.body);
    _ok(res, { user });
  } catch (e) { _err(res, e); }
});

router.patch("/co3/beta/users/:id", (req, res) => {
  try {
    const user = svc.updateBetaUser(req.params.id, req.body);
    _ok(res, { user });
  } catch (e) { _err(res, e, 404); }
});

// ── M10: Launch Benchmark ──────────────────────────────────────────────────────
router.get("/co3/launch-benchmark", (req, res) => {
  try { _ok(res, svc.runLaunchBenchmark()); } catch (e) { _err(res, e); }
});

// ── Overall CO3 Benchmark ──────────────────────────────────────────────────────
router.get("/co3/benchmark", (req, res) => {
  try { _ok(res, svc.runBenchmark()); } catch (e) { _err(res, e); }
});

module.exports = router;
