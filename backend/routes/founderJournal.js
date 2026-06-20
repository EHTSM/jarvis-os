"use strict";
/**
 * FOP-1 — Founder Operating Program routes
 * All 10 deliverables under /fop/*
 */

const router      = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const j           = require("../services/founderJournal.cjs");

router.use(requireAuth);

function _today() { return new Date().toISOString().slice(0, 10); }

// ── 1. Daily Journal ──────────────────────────────────────────────────────────

// GET  /fop/journal         → today's journal
// GET  /fop/journal/:date   → specific day
router.get("/fop/journal", (req, res) => {
  try { res.json({ ok: true, day: j.getDay(_today()) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get("/fop/journal/:date", (req, res) => {
  try { res.json({ ok: true, day: j.getDay(req.params.date) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /fop/journal        → update today's narrative, mood, goals, blockers, notes
router.patch("/fop/journal", (req, res) => {
  try {
    const { date, ...fields } = req.body || {};
    const day = j.updateNarrative(date || _today(), fields);
    res.json({ ok: true, day });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /fop/journal/seal    → seal the day
router.post("/fop/journal/seal", (req, res) => {
  try {
    const day = j.sealDay((req.body || {}).date || _today());
    res.json({ ok: true, day });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fop/journal/list     → all logged days (summary)
router.get("/fop/journal/list", (req, res) => {
  try { res.json({ ok: true, days: j.listDays() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 2. Escape Log ─────────────────────────────────────────────────────────────

// POST /fop/escape          → log an escape
router.post("/fop/escape", (req, res) => {
  try {
    const { tool, reason, feature, duration, date } = req.body || {};
    if (!tool || !reason) return res.status(400).json({ error: "tool and reason required" });
    const entry = j.logEscape({ tool, reason, feature, duration, date });
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fop/escape           → get escapes (optional ?date=)
router.get("/fop/escape", (req, res) => {
  try {
    const list = j.getEscapes({ date: req.query.date });
    res.json({ ok: true, escapes: list, count: list.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 3. Crash Log ──────────────────────────────────────────────────────────────

// POST /fop/crash           → log a crash
router.post("/fop/crash", (req, res) => {
  try {
    const { title, description, stackTrace, feature, severity, date } = req.body || {};
    if (!title) return res.status(400).json({ error: "title required" });
    const entry = j.logCrash({ title, description, stackTrace, feature, severity, date });
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /fop/crash/:id/resolve  → mark crash resolved
router.patch("/fop/crash/:id/resolve", (req, res) => {
  try {
    const entry = j.resolveCrash(req.params.id, (req.body || {}).resolution || "");
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fop/crash            → list crashes (optional ?date=&resolved=)
router.get("/fop/crash", (req, res) => {
  try {
    const resolved = req.query.resolved !== undefined ? req.query.resolved === "true" : undefined;
    const list = j.getCrashes({ date: req.query.date, resolved });
    res.json({ ok: true, crashes: list, count: list.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 4. Performance Log ────────────────────────────────────────────────────────

// POST /fop/perf            → log a performance sample
router.post("/fop/perf", (req, res) => {
  try {
    const { action, ms, acceptable, feature, date } = req.body || {};
    if (!action || ms === undefined) return res.status(400).json({ error: "action and ms required" });
    const entry = j.logPerf({ action, ms, acceptable, feature, date });
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fop/perf             → get today's perf log (optional ?date=)
router.get("/fop/perf", (req, res) => {
  try {
    const list = j.getPerfLog(req.query.date);
    res.json({ ok: true, perf: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 5. AI Usage ───────────────────────────────────────────────────────────────

// POST /fop/ai              → log an AI interaction
router.post("/fop/ai", (req, res) => {
  try {
    const { feature, model, promptTokens, completionTokens, latencyMs, helpful, date } = req.body || {};
    if (!feature) return res.status(400).json({ error: "feature required" });
    const entry = j.logAIUsage({ feature, model, promptTokens, completionTokens, latencyMs, helpful, date });
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fop/ai/report        → today's AI usage report (optional ?date=)
router.get("/fop/ai/report", (req, res) => {
  try {
    const report = j.getAIReport(req.query.date || _today());
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 6. Credit Usage ───────────────────────────────────────────────────────────

// POST /fop/credits         → log credit consumption
router.post("/fop/credits", (req, res) => {
  try {
    const { feature, credits, purpose, date } = req.body || {};
    if (!feature || credits === undefined) return res.status(400).json({ error: "feature and credits required" });
    const entry = j.logCreditUsage({ feature, credits, purpose, date });
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fop/credits/report   → today's credit report (optional ?date=)
router.get("/fop/credits/report", (req, res) => {
  try {
    const report = j.getCreditReport(req.query.date || _today());
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 7. Top 20 Frictions ───────────────────────────────────────────────────────

// POST /fop/friction        → log a friction item
router.post("/fop/friction", (req, res) => {
  try {
    const { text, score, feature, workaround, date } = req.body || {};
    if (!text) return res.status(400).json({ error: "text required" });
    const entry = j.logFriction({ text, score, feature, workaround, date });
    res.json({ ok: true, entry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /fop/friction/top     → top 20 frictions today (optional ?date=)
router.get("/fop/friction/top", (req, res) => {
  try {
    const list = j.getTop20Frictions(req.query.date);
    res.json({ ok: true, frictions: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 8. Weekly Product Score ───────────────────────────────────────────────────

// GET /fop/score/weekly     → composite weekly score
router.get("/fop/score/weekly", (req, res) => {
  try {
    const result = j.getWeeklyScore(req.query.from);
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 9 & 10. Launch Confidence + Ship Recommendation ──────────────────────────

// GET /fop/launch           → confidence + ship recommendation
router.get("/fop/launch", (req, res) => {
  try {
    const result = j.getLaunchConfidence();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Full Report (all 10 deliverables in one call) ─────────────────────────────

// GET /fop/report           → all 10 deliverables for today (optional ?date=)
router.get("/fop/report", (req, res) => {
  try {
    const report = j.getFullReport(req.query.date);
    res.json({ ok: true, report });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
