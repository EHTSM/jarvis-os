"use strict";
/**
 * POST-Ω Sprint P4 — Approval & Human-in-the-Loop routes
 * All routes require authentication.
 * Prefix: /approval/*
 */

const router = require("express").Router();

const _try = fn => { try { return fn(); } catch { return null; } };
const requireAuth = _try(() => require("../middleware/requireAuth")) || ((req, res, next) => next());

const _ae  = () => _try(() => require("../services/approvalEngine.cjs"));
const _aq  = () => _try(() => require("../services/approvalQueue.cjs"));
const _aev = () => _try(() => require("../services/approvalEvidence.cjs"));
const _aa  = () => _try(() => require("../services/approvalAnalytics.cjs"));
const _ad  = () => _try(() => require("../services/approvalDashboard.cjs"));
const _pol = () => _try(() => require("../services/approvalPolicy.cjs"));

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get("/approval/dashboard",        requireAuth, (req, res) => res.json(_ad()?.getDashboard?.() || { ok: false }));
router.get("/approval/pending/founder",  requireAuth, (req, res) => res.json({ ok: true, items: _ad()?.getPendingForFounder?.() || [] }));

// ── Approval Engine — request + approve + reject ──────────────────────────────

router.post("/approval/request", requireAuth, (req, res) => {
  const { workflowId, confidence = 0.85, context = {} } = req.body || {};
  if (!workflowId) return res.status(400).json({ ok: false, error: "workflowId required" });
  res.json(_ae()?.requestApproval?.(workflowId, { confidence, context }) || { ok: false });
});

router.get("/approval/package/:workflowId", requireAuth, (req, res) => {
  res.json(_ae()?.generateApprovalPackage?.(req.params.workflowId) || { ok: false });
});

router.post("/approval/approve/:reqId", requireAuth, async (req, res) => {
  const { approvedBy = "founder", note = "" } = req.body || {};
  try {
    const result = await _ae()?.approveAndResume?.(req.params.reqId, { approvedBy, note });
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

router.post("/approval/reject/:reqId", requireAuth, (req, res) => {
  const { reason = "founder_rejected", rejectedBy = "founder" } = req.body || {};
  res.json(_ae()?.rejectApproval?.(req.params.reqId, { reason, rejectedBy }) || { ok: false });
});

// ── Queue ─────────────────────────────────────────────────────────────────────

router.get("/approval/queue",             requireAuth, (req, res) => res.json({ ok: true, items: _aq()?.listPending?.() || [] }));
router.get("/approval/queue/all",         requireAuth, (req, res) => {
  const { status, workflowId, approvalType, limit } = req.query;
  res.json({ ok: true, items: _aq()?.listAll?.({ status, workflowId, approvalType, limit: limit ? +limit : 100 }) || [] });
});
router.get("/approval/queue/stats",       requireAuth, (req, res) => res.json({ ok: true, stats: _aq()?.getStats?.() || {} }));
router.get("/approval/queue/:reqId",      requireAuth, (req, res) => {
  const r = _aq()?.getRequest?.(req.params.reqId);
  if (!r) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, request: r });
});
router.post("/approval/queue/expire",     requireAuth, (req, res) => res.json({ ok: true, ..._aq()?.expireStale?.() }));

// ── Evidence ──────────────────────────────────────────────────────────────────

router.get("/approval/evidence",          requireAuth, (req, res) => {
  const { workflowId, event, approvalType, limit } = req.query;
  res.json({ ok: true, items: _aev()?.listEvidence?.({ workflowId, event, approvalType, limit: limit ? +limit : 50 }) || [] });
});
router.get("/approval/evidence/summary",  requireAuth, (req, res) => res.json({ ok: true, summary: _aev()?.getSummary?.() || {} }));
router.get("/approval/evidence/:id",      requireAuth, (req, res) => {
  const e = _aev()?.getEvidence?.(req.params.id);
  if (!e) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, evidence: e });
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get("/approval/analytics",          requireAuth, (req, res) => res.json(_aa()?.getApprovalBlockageReport?.() || { ok: false }));
router.get("/approval/analytics/blocked",  requireAuth, (req, res) => res.json(_aa()?.getBlockedMinutes?.() || { ok: false }));
router.get("/approval/analytics/saved",    requireAuth, (req, res) => res.json({ ok: true, ..._aa()?.getMinutesSaved?.() }));
router.get("/approval/analytics/trend",    requireAuth, (req, res) => res.json({ ok: true, trend: _aa()?.getTrend?.() || [] }));
router.get("/approval/analytics/candidates", requireAuth, (req, res) => res.json({ ok: true, candidates: _aa()?.getAutoApproveCandidates?.() || [] }));

// ── Policy ────────────────────────────────────────────────────────────────────

router.get("/approval/policy",             requireAuth, (req, res) => res.json({ ok: true, policies: _pol()?.listPolicies?.() || [] }));
router.get("/approval/policy/:workflowId", requireAuth, (req, res) => res.json({ ok: true, policy: _pol()?.getPolicy?.(req.params.workflowId) || {} }));

// ── Engine sessions ───────────────────────────────────────────────────────────

router.get("/approval/sessions",           requireAuth, (req, res) => {
  const { status, limit } = req.query;
  res.json({ ok: true, sessions: _ae()?.listSessions?.({ status, limit: limit ? +limit : 50 }) || [] });
});
router.get("/approval/stats",              requireAuth, (req, res) => res.json({ ok: true, stats: _ae()?.getStats?.() || {} }));

// ── Auto-approve batch ────────────────────────────────────────────────────────

router.post("/approval/auto/process",      requireAuth, async (req, res) => {
  try {
    const r = await _ae()?.processAutoApprovals?.();
    res.json(r || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

module.exports = router;
