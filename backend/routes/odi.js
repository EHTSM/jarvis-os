"use strict";
/**
 * ODI — Ooplix Design Intelligence routes (ODI-1 through ODI-20)
 *
 * ODI-1  Screenshots:       GET /odi/screenshots        POST /odi/capture
 * ODI-2  DOM Analysis:      GET /odi/dom                POST /odi/dom/analyze
 * ODI-3  Layout Graph:      GET /odi/layout             POST /odi/layout/analyze
 * ODI-4  Component Graph:   GET /odi/components         POST /odi/components/analyze
 * ODI-5  AI Analysis:       GET /odi/analyses           POST /odi/analyze
 * ODI-6  Design Tokens:     GET /odi/tokens             POST /odi/tokens/generate
 * ODI-7  Accessibility:     GET /odi/accessibility      POST /odi/accessibility/audit
 * ODI-8  Responsive:        GET /odi/responsive         POST /odi/responsive/simulate
 * ODI-9  Patches:           GET /odi/patches            POST /odi/patches/generate
 *                           GET /odi/patches/:id/preview POST /odi/patches/:id/apply
 *                           POST /odi/patches/:id/rollback POST /odi/patches/:id/commit
 * ODI-10 Autonomous Run:    GET /odi/runs               POST /odi/run
 *                           GET /odi/runs/:id
 * ODI-11 Visual Regression: GET /odi/regressions        POST /odi/regressions/run
 * ODI-12 UX Optimizer:      GET /odi/ux                 POST /odi/ux/analyze
 * ODI-13 Design System AI:  GET /odi/design-system      POST /odi/design-system/analyze
 * ODI-14 Self-Healing:      GET /odi/heals              POST /odi/heal
 * ODI-15 Component Gen:     GET /odi/components-gen     POST /odi/components-gen/generate
 * ODI-16 Vision QA:         GET /odi/vision-qa          POST /odi/vision-qa/audit
 * ODI-17 Interactions:      GET /odi/interactions       POST /odi/interactions/analyze
 * ODI-18 Brand Intelligence:GET /odi/brand              POST /odi/brand/analyze
 * ODI-19 Design Memory:     GET /odi/memory             POST /odi/memory/remember
 *                           DELETE /odi/memory/:id
 * ODI-20 Design Loop:       GET /odi/loops              POST /odi/loop
 *                           GET /odi/loops/:id
 */

const router      = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter     = require("../middleware/rateLimiter");

// Lazy-load all services
const svc = {
  capture:     () => require("../services/visualCaptureService.cjs"),
  dom:         () => require("../services/domAnalyzerService.cjs"),
  layout:      () => require("../services/layoutGraphService.cjs"),
  components:  () => require("../services/componentGraphService.cjs"),
  analyzer:    () => require("../services/screenshotAnalyzerService.cjs"),
  tokens:      () => require("../services/designTokenEngine.cjs"),
  a11y:        () => require("../services/accessibilityAuditor.cjs"),
  responsive:  () => require("../services/responsiveSimulator.cjs"),
  patcher:     () => require("../services/uiPatchGenerator.cjs"),
  autonomy:    () => require("../services/autonomousUIEngineer.cjs"),
  // ODI V2
  regression:  () => require("../services/visualRegressionEngine.cjs"),
  ux:          () => require("../services/uxOptimizerService.cjs"),
  ds:          () => require("../services/designSystemAI.cjs"),
  healing:     () => require("../services/selfHealingFrontend.cjs"),
  generator:   () => require("../services/componentGenerator.cjs"),
  visionQA:    () => require("../services/visionQA.cjs"),
  interactions:() => require("../services/interactionIntelligence.cjs"),
  brand:       () => require("../services/brandIntelligence.cjs"),
  memory:      () => require("../services/designMemory.cjs"),
  loop:        () => require("../services/autonomousDesignLoop.cjs"),
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

router.get("/odi/analyses", (req, res) => {
  try {
    const list = svc.analyzer().listAnalyses({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, analyses: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

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

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-11 — Visual Regression Engine
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/regressions", (req, res) => {
  try {
    const list = svc.regression().listRegressions({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, regressions: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/regressions/run", rateLimiter(5, 60_000), async (req, res) => {
  const { url, baselineFilename, label } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "url required" });
  try {
    const result = await svc.regression().runRegression({ url, baselineFilename, label });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-12 — Autonomous UX Optimizer
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/ux", (req, res) => {
  try {
    const list = svc.ux().listUXReports({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, reports: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/ux/analyze", rateLimiter(5, 60_000), async (req, res) => {
  const { domFilename } = req.body || {};
  if (!domFilename) return res.status(400).json({ success: false, error: "domFilename required" });
  try {
    const result = await svc.ux().analyzeUX({ domFilename });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-13 — Design System AI
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/design-system", (req, res) => {
  try {
    const list = svc.ds().listReports({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, reports: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/design-system/analyze", rateLimiter(5, 60_000), async (req, res) => {
  const { tokenFilename } = req.body || {};
  if (!tokenFilename) return res.status(400).json({ success: false, error: "tokenFilename required" });
  try {
    const result = await svc.ds().analyzeFromTokenFile({ tokenFilename });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-14 — Self-Healing Frontend
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/heals", (req, res) => {
  try {
    const list = svc.healing().listHeals({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, heals: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/heal", rateLimiter(3, 120_000), async (req, res) => {
  const { url, targetFile, autoApply } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "url required" });
  try {
    const result = await svc.healing().heal({ url, targetFile, autoApply: !!autoApply });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-15 — Autonomous Component Generator
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/components-gen", (req, res) => {
  try {
    const list = svc.generator().listGenerated({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, components: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/components-gen/generate", rateLimiter(5, 60_000), async (req, res) => {
  const { name, description, props, type, writeToFile } = req.body || {};
  if (!name) return res.status(400).json({ success: false, error: "name required" });
  try {
    const result = await svc.generator().generateComponent({ name, description, props, type, writeToFile: !!writeToFile });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-16 — Vision QA
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/vision-qa", (req, res) => {
  try {
    const list = svc.visionQA().listReports({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, reports: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/vision-qa/audit", rateLimiter(5, 60_000), async (req, res) => {
  const { url, urls } = req.body || {};
  if (!url && !urls) return res.status(400).json({ success: false, error: "url or urls required" });
  try {
    const result = urls
      ? await svc.visionQA().auditPages({ urls })
      : await svc.visionQA().auditPage({ url });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-17 — Interaction Intelligence
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/interactions", (req, res) => {
  try {
    const list = svc.interactions().listReports({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, reports: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/interactions/analyze", rateLimiter(5, 60_000), async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "url required" });
  try {
    const result = await svc.interactions().analyzeInteractions({ url });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-18 — Brand Intelligence
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/brand", (req, res) => {
  try {
    const list = svc.brand().listReports({ limit: parseInt(req.query.limit) || 50 });
    return res.json({ success: true, count: list.length, reports: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/brand/analyze", rateLimiter(5, 60_000), async (req, res) => {
  const { domFilename, brandConfig } = req.body || {};
  if (!domFilename) return res.status(400).json({ success: false, error: "domFilename required" });
  try {
    const result = await svc.brand().analyzeFromDomFile({ domFilename, brandConfig });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-19 — Design Memory
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/memory", (req, res) => {
  try {
    const { limit, strategy } = req.query;
    const list = svc.memory().listMemories({ limit: parseInt(limit) || 50, strategy });
    const st   = svc.memory().stats();
    return res.json({ success: true, count: list.length, memories: list, stats: st });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/memory/remember", (req, res) => {
  const { finding, patchSpec, targetFile, scoreBefore, scoreAfter, strategy } = req.body || {};
  if (!finding || !patchSpec) return res.status(400).json({ success: false, error: "finding and patchSpec required" });
  try {
    const result = svc.memory().remember({ finding, patchSpec, targetFile, scoreBefore, scoreAfter, strategy });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.delete("/odi/memory/:id", (req, res) => {
  try {
    const result = svc.memory().deleteMemory(req.params.id);
    if (!result.ok) return res.status(404).json({ success: false, error: result.error });
    return res.json({ success: true });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ODI-20 — Autonomous Design Loop
// ═══════════════════════════════════════════════════════════════════════════════

router.get("/odi/loops", (req, res) => {
  try {
    const list = svc.loop().listRuns({ limit: parseInt(req.query.limit) || 20 });
    return res.json({ success: true, count: list.length, loops: list });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.get("/odi/loops/:id", (req, res) => {
  try {
    const loop = svc.loop().getRun(req.params.id);
    if (!loop) return res.status(404).json({ success: false, error: "Loop not found" });
    return res.json({ success: true, ...loop });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

router.post("/odi/loop", rateLimiter(2, 120_000), async (req, res) => {
  const { url, targetFile, autoCommit, brandConfig, maxPatches, runLabel } = req.body || {};
  if (!url) return res.status(400).json({ success: false, error: "url required" });
  try {
    const result = await svc.loop().run({ url, targetFile, autoCommit: !!autoCommit, brandConfig, maxPatches, runLabel });
    if (!result.ok) return res.status(422).json({ success: false, error: result.error });
    return res.json({ success: true, ...result });
  } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
