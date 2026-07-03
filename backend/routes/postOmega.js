"use strict";
/**
 * POST-Ω Routes — Sprint P1
 *
 * Self-review, consolidation audit, and production health
 * under /pomega/* namespace.
 *
 * GET  /pomega/status              — sprint P1 health check
 * POST /pomega/review              — run weekly self-review now
 * GET  /pomega/review/latest       — latest review
 * GET  /pomega/review/trend        — trend across last 8 reviews
 * GET  /pomega/reviews             — list reviews
 * GET  /pomega/reviews/:id         — get review by id
 * POST /pomega/audit               — run consolidation audit now
 * GET  /pomega/audit/latest        — latest audit
 * GET  /pomena/audit/plan         — consolidation plan for next sprint
 * GET  /pomena/audits              — list audits
 * PATCH /pomena/audit/resolve/:id — mark duplicate resolved
 * GET  /pomena/dashboard          — combined self-review + audit dashboard
 */

const router = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");

const _sre = () => require("../services/selfReviewEngine.cjs");
const _ca  = () => require("../services/consolidationAudit.cjs");

router.use("/pomena", requireAuth);

// ── Status ────────────────────────────────────────────────────────────────────
router.get("/pomena/status", (req, res) => {
  try {
    const latest  = _sre().getLatestReview();
    const audit   = _ca().getLatestAudit();
    res.json({
      ok:              true,
      sprint:          "P1",
      program:         "POST-Ω",
      description:     "Continuous improvement — optimize instead of expand",
      lastReviewAt:    latest?.createdAt || null,
      lastAuditAt:     audit?.createdAt  || null,
      overallScore:    latest?.overall   || null,
      consolidationScore: audit?.consolidationScore || null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Self Review ───────────────────────────────────────────────────────────────
router.post("/pomena/review", async (req, res) => {
  try {
    const result = _sre().runReview();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/pomena/review/latest", (req, res) => {
  try {
    const review = _sre().getLatestReview();
    if (!review) return res.json({ ok: false, reason: "no_reviews_yet", hint: "POST /pomena/review to generate first review" });
    res.json({ ok: true, review });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/pomena/review/trend", (req, res) => {
  try {
    res.json(_sre().getTrend());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/pomena/reviews", (req, res) => {
  try {
    const limit = Math.min(52, parseInt(req.query.limit) || 10);
    res.json({ ok: true, reviews: _sre().listReviews({ limit }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/pomena/reviews/:id", (req, res) => {
  try {
    const review = _sre().getReview(req.params.id);
    if (!review) return res.status(404).json({ error: "review not found" });
    res.json({ ok: true, review });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Consolidation Audit ───────────────────────────────────────────────────────
router.post("/pomena/audit", (req, res) => {
  try {
    res.json(_ca().runAudit());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/pomena/audit/latest", (req, res) => {
  try {
    const audit = _ca().getLatestAudit();
    if (!audit) return res.json({ ok: false, reason: "no_audits_yet", hint: "POST /pomena/audit to generate first audit" });
    res.json({ ok: true, audit });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/pomena/audit/plan", (req, res) => {
  try {
    res.json({ ok: true, plan: _ca().getConsolidationPlan() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/pomena/audits", (req, res) => {
  try {
    const limit = Math.min(52, parseInt(req.query.limit) || 10);
    res.json({ ok: true, audits: _ca().listAudits({ limit }) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch("/pomena/audit/resolve/:id", (req, res) => {
  try {
    res.json(_ca().markResolved(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Combined dashboard ────────────────────────────────────────────────────────
router.get("/pomena/dashboard", (req, res) => {
  try {
    const review = _sre().getLatestReview();
    const audit  = _ca().getLatestAudit();
    const trend  = _sre().getTrend();
    const plan   = _ca().getConsolidationPlan();

    res.json({
      ok:      true,
      program: "POST-Ω",
      sprint:  "P1",
      review:  review  ? { overall: review.overall, scores: review.scores, createdAt: review.createdAt } : null,
      audit:   audit   ? { consolidationScore: audit.consolidationScore, summary: audit.summary, createdAt: audit.createdAt } : null,
      trend:   trend.ok ? trend.trend : null,
      plan:    plan.nextSprint,
      recommendations: review?.recommendations?.slice(0, 5) || [],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
