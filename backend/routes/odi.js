"use strict";
/**
 * ODI — Ooplix Design Intelligence routes (ODI-1 through ODI-10)
 *
 * ODI-1  Screenshots:     GET /odi/screenshots        POST /odi/capture
 * ODI-2  DOM Analysis:    GET /odi/dom                POST /odi/dom/analyze
 * ODI-3  Layout Graph:    GET /odi/layout             POST /odi/layout/analyze
 * ODI-4  Component Graph: GET /odi/components         POST /odi/components/analyze
 * ODI-5  AI Analysis:     POST /odi/analyze
 * ODI-6  Design Tokens:   GET /odi/tokens             POST /odi/tokens/generate
 * ODI-7  Accessibility:   GET /odi/accessibility      POST /odi/accessibility/audit
 * ODI-8  Responsive:      GET /odi/responsive         POST /odi/responsive/simulate
 * ODI-9  Patches:         GET /odi/patches            POST /odi/patches/generate
 *                         GET /odi/patches/:id/preview POST /odi/patches/:id/apply
 *                         POST /odi/patches/:id/rollback POST /odi/patches/:id/commit
 * ODI-10 Autonomous Run:  GET /odi/runs               POST /odi/run
 *                         GET /odi/runs/:id
 */

const router      = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter     = require("../middleware/rateLimiter");

// Lazy-load all services
const svc = {
  capture:    () => require("../services/visualCaptureService.cjs"),
  dom:        () => require("../services/domAnalyzerService.cjs"),
  layout:     () => require("../services/layoutGraphService.cjs"),
  components: () => require("../services/componentGraphService.cjs"),
  analyzer:   () => require("../services/screenshotAnalyzerService.cjs"),
  tokens:     () => require("../services/designTokenEngine.cjs"),
  a11y:       () => require("../services/accessibilityAuditor.cjs"),
  responsive: () => require("../services/responsiveSimulator.cjs"),
  patcher:    () => require("../services/uiPatchGenerator.cjs"),
  autonomy:   () => require("../services/autonomousUIEngineer.cjs"),
};

router.use("/odi", requireAuth);

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-1 — Visual Capture
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/screenshots", (req, res) => {
  try {
    const shots = svc.capture().listScreenshots({ limit: parseInt(req.query.limit) || 50, source: req.query.source });
    return res.json({ success: true, count: shots.length, screenshots: shots });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/capture", rateLimiter(10, 60_000), async (req, res) => {
  const { source = "playwright", pageId, url, fullPage, label, width, height } = req.body || {};
  try {
    let result;
    if (source === "desktop") result = await svc.capture().captureDesktop({ label });
    else if (source === "viewport") {
      if (!url) return res.status(400).json({ success: false, error: "url required for viewport capture" });
      result = await svc.capture().captureViewport({ url, width, height, fullPage: !!fullPage });
    } else {
      result = await svc.capture().captureFromPage({ pageId, fullPage: !!fullPage, url });
    }
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-2 — DOM Analysis
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/dom", (req, res) => {
  try {
    const list = svc.dom().listAnalyses({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, analyses: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/dom/analyze", rateLimiter(5, 60_000), async (req, res) => {
  const { pageId, url } = req.body || {};
  try {
    const result = await svc.dom().analyzePage({ pageId, url });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/odi/dom/:filename", (req, res) => {
  try {
    const data = svc.dom().getAnalysis(req.params.filename);
    if (!data) return res.status(404).json({ success: false, error: "Analysis not found" });
    return res.json({ success: true, ...data });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-3 — Layout Graph
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/layout", (req, res) => {
  try {
    const list = svc.layout().listLayouts({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, layouts: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/layout/analyze", rateLimiter(5, 60_000), async (req, res) => {
  const { domFilename } = req.body || {};
  if (!domFilename) return res.status(400).json({ success: false, error: "domFilename required" });
  try {
    const result = await svc.layout().analyzeLayout({ domFilename });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-4 — Component Graph
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/components", (req, res) => {
  try {
    const list = svc.components().listComponentGraphs({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, graphs: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/components/analyze", rateLimiter(5, 60_000), async (req, res) => {
  const { domFilename } = req.body || {};
  if (!domFilename) return res.status(400).json({ success: false, error: "domFilename required" });
  try {
    const result = await svc.components().analyzeComponents({ domFilename });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-5 — Screenshot AI Analyzer
// ═══════════════════════════════════════════════════════════════════════════════

router.post("/odi/analyze", rateLimiter(5, 60_000), async (req, res) => {
  const { screenshotFilename, domFilename } = req.body || {};
  if (!domFilename) return res.status(400).json({ success: false, error: "domFilename required" });
  try {
    const result = await svc.analyzer().analyzeScreenshot({ screenshotFilename, domFilename });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-6 — Design Tokens
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/tokens", (req, res) => {
  try {
    const list = svc.tokens().listTokens({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, tokens: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/tokens/generate", rateLimiter(5, 60_000), async (req, res) => {
  const { domFilename } = req.body || {};
  if (!domFilename) return res.status(400).json({ success: false, error: "domFilename required" });
  try {
    const result = await svc.tokens().generateTokens({ domFilename });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-7 — Accessibility Auditor
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/accessibility", (req, res) => {
  try {
    const list = svc.a11y().listAudits({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, audits: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/accessibility/audit", rateLimiter(5, 60_000), async (req, res) => {
  const { pageId, url } = req.body || {};
  try {
    const result = await svc.a11y().auditPage({ pageId, url });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-8 — Responsive Simulator
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/responsive", (req, res) => {
  try {
    const list = svc.responsive().listReports({ limit: parseInt(req.query.limit) || 20 });
    return res.json({ success: true, count: list.length, reports: list, viewports: svc.responsive().VIEWPORTS });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/responsive/simulate", rateLimiter(3, 60_000), async (req, res) => {
  const { url, viewports } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "url required" });
  try {
    const result = await svc.responsive().simulate({ url, viewports });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-9 — Auto Patch Generator
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/patches", (req, res) => {
  try {
    const list = svc.patcher().listPatches({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, patches: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/patches/generate", rateLimiter(5, 60_000), async (req, res) => {
  const { finding, targetFile } = req.body || {};
  if (!finding || !targetFile) return res.status(400).json({ success: false, error: "finding and targetFile required" });
  try {
    const result = await svc.patcher().generatePatch({ finding, targetFile });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/odi/patches/:id/preview", (req, res) => {
  try {
    const result = svc.patcher().previewPatch(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/patches/:id/apply", (req, res) => {
  try {
    const result = svc.patcher().applyPatch(req.params.id);
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/patches/:id/rollback", (req, res) => {
  try {
    const result = svc.patcher().rollbackPatch(req.params.id);
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/patches/:id/commit", (req, res) => {
  const { message } = req.body || {};
  try {
    const result = svc.patcher().commitPatch(req.params.id, message);
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-10 — Autonomous UI Engineer
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/runs", (req, res) => {
  try {
    const runs = svc.autonomy().listRuns({ limit: parseInt(req.query.limit) || 20 });
    return res.json({ success: true, count: runs.length, runs });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/odi/runs/:id", (req, res) => {
  try {
    const run = svc.autonomy().getRun(req.params.id);
    if (!run) return res.status(404).json({ success: false, error: "Run not found" });
    return res.json({ success: true, ...run });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/run", rateLimiter(3, 120_000), async (req, res) => {
  const { url, targetFile, autoCommit, runLabel } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "url required" });
  try {
    const result = await svc.autonomy().run({ url, targetFile, autoCommit: !!autoCommit, runLabel });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
