"use strict";
/**
 * /browser/* routes — real browser automation via Playwright.
 *
 * All routes require auth except GET /browser/status (health probe).
 *
 * POST   /browser/run                      — execute a workflow (array of steps)
 * POST   /browser/workflow                 — run a named workflow from the registry
 * POST   /browser/action                   — execute a single action on an open tab
 * POST   /browser/navigate                 — quick navigate helper
 * POST   /browser/screenshot               — capture current page screenshot
 * GET    /browser/sessions                 — list open tabs
 * GET    /browser/running                  — list active workflows
 * GET    /browser/workflows                — list available named workflows
 * GET    /browser/result/:id               — retrieve completed workflow result
 * POST   /browser/cancel                   — cancel a workflow by id
 * POST   /browser/stop                     — emergency stop ALL workflows
 * POST   /browser/close                    — close a tab
 * DELETE /browser/shutdown                 — shut down the browser process
 * GET    /browser/status                   — browser health (no auth)
 * GET    /browser/library                  — verified workflow catalogue
 * POST   /browser/library/run             — run a verified library workflow
 *
 * Templates (workflow store):
 * POST   /browser/templates                — save steps as a reusable template
 * GET    /browser/templates                — list all saved templates
 * GET    /browser/templates/:id            — get one template
 * DELETE /browser/templates/:id            — delete a template
 * POST   /browser/templates/:id/clone      — clone a template under a new name
 * GET    /browser/templates/:id/steps      — get steps with optional param substitution
 * POST   /browser/templates/:id/run        — run a saved template
 *
 * History & replay:
 * GET    /browser/history                  — list execution history
 * GET    /browser/history/:id              — get one execution record
 * POST   /browser/history/:id/replay       — replay a past execution
 * POST   /browser/history/clear            — remove old history entries
 *
 * Health:
 * GET    /browser/health/system            — overall automation health
 * GET    /browser/health/workflow/:id      — health for one template
 */

const router      = require("express").Router();
const { requireAuth } = require("../middleware/authMiddleware");
const rateLimiter     = require("../middleware/rateLimiter");

function _getSession()   { return require("../../agents/browser/browserSession.cjs"); }
function _getRunner()    { return require("../../agents/browser/browserRunner.cjs"); }
function _getEngine()    { return require("../../agents/browser/actionEngine.cjs"); }
function _getWorkflows() { return require("../../agents/browser/workflows.cjs"); }
function _getLibrary()   { return require("../../agents/browser/workflowLibrary.cjs"); }
function _getStore()     { return require("../../agents/browser/browserWorkflowStore.cjs"); }
function _getScheduler() { return require("../../agents/browser/browserScheduler.cjs"); }

// Auto-record any completed run to the workflow store.
function _autoRecord(result, meta = {}) {
  try {
    _getStore().recordExecution(result, meta);
  } catch (e) {
    // non-fatal — store failure must never break the run response
  }
}

// Auth on all /browser/* except status
router.use("/browser", (req, res, next) => {
  if (req.path === "/status") return next();
  return requireAuth(req, res, next);
});

// ── POST /browser/run ─────────────────────────────────────────────────────────
router.post("/browser/run", rateLimiter(10, 60_000), async (req, res) => {
  const {
    steps, label, headless, reusePageId,
    stopOnFailure, takeScreenshotOnDone, timeoutMs,
  } = req.body;

  if (!Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ success: false, error: "steps array required" });
  }
  if (steps.length > 50) {
    return res.status(400).json({ success: false, error: "Maximum 50 steps per workflow" });
  }

  try {
    const runner = _getRunner();
    const result = await runner.run(steps, {
      label:                label || "Browser workflow",
      headless:             headless !== false,
      reusePageId:          reusePageId || null,
      stopOnFailure:        stopOnFailure !== false,
      takeScreenshotOnDone: takeScreenshotOnDone === true,
      takeScreenshotOnFail: true,
      timeoutMs:            timeoutMs || undefined,
    });
    _autoRecord(result, { workflowName: label || "Browser workflow", triggeredBy: "api/run" });
    const { _originalSteps, ...response } = result;
    return res.json({ success: result.ok, ...response });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /browser/workflow ────────────────────────────────────────────────────
// Run a named workflow from the registry: { name, params, label?, headless?, ... }
router.post("/browser/workflow", rateLimiter(10, 60_000), async (req, res) => {
  const { name, params = {}, label, headless, stopOnFailure, takeScreenshotOnDone, timeoutMs } = req.body;

  if (!name) return res.status(400).json({ success: false, error: "workflow name required" });

  const wf = _getWorkflows();
  const steps = wf.getWorkflow(name, params);
  if (!steps) {
    return res.status(400).json({
      success: false,
      error:   `Unknown workflow: "${name}"`,
      available: wf.listWorkflows().map(w => w.name),
    });
  }

  try {
    const runner = _getRunner();
    const result = await runner.run(steps, {
      label:                label || `Workflow: ${name}`,
      headless:             headless !== false,
      stopOnFailure:        stopOnFailure !== false,
      takeScreenshotOnDone: takeScreenshotOnDone === true,
      takeScreenshotOnFail: true,
      timeoutMs:            timeoutMs || undefined,
    });
    _autoRecord(result, { workflowName: label || name, triggeredBy: "api/workflow" });
    const { _originalSteps, ...response } = result;
    return res.json({ success: result.ok, workflow: name, ...response });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /browser/action ──────────────────────────────────────────────────────
router.post("/browser/action", rateLimiter(30, 60_000), async (req, res) => {
  const { pageId, ...step } = req.body;
  if (!step.action) {
    return res.status(400).json({ success: false, error: "action required" });
  }

  try {
    const session = _getSession();
    let page, pid;

    if (pageId) {
      page = session.getPage(pageId);
      if (!page) return res.status(404).json({ success: false, error: `Page ${pageId} not found` });
      pid = pageId;
    } else {
      if (!session.isRunning()) await session.launch();
      const r = await session.newPage();
      if (!r.ok) return res.status(500).json({ success: false, error: r.error });
      pid  = r.pageId;
      page = r.page;
    }

    const engine = _getEngine();
    const result = await _dispatchSingle(engine, page, step);
    return res.json({ success: result.ok, pageId: pid, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

async function _dispatchSingle(engine, page, step) {
  switch (step.action) {
    case "navigate":          return engine.navigate(page, step.url, step);
    case "reload":
    case "reloadPage":        return engine.reloadPage(page, step);
    case "waitForContent":    return engine.waitForContent(page, step);
    case "click":             return engine.click(page, step.selector, step);
    case "type":
    case "typeText":          return engine.typeText(page, step.selector, step.text, step);
    case "fill":
    case "fillForm":          return engine.fillForm(page, step.selector, step.text ?? step.value, step);
    case "waitForElement":    return engine.waitForElement(page, step.selector, step);
    case "screenshot":        return engine.screenshot(page, step);
    case "getText":           return engine.getText(page, step.selector);
    case "getTitle":          return engine.getTitle(page);
    case "getUrl":            return engine.getUrl(page);
    case "scrollDown":        return engine.scrollDown(page, step.pixels);
    case "pressKey":          return engine.pressKey(page, step.key);
    case "selectOption":      return engine.selectOption(page, step.selector, step.value, step);
    case "evaluate":          return engine.evaluate(page, step.script, step);
    case "hover":
    case "hoverElement":      return engine.hoverElement(page, step.selector, step);
    case "getAttribute":      return engine.getAttribute(page, step.selector, step.attr);
    case "checkElement":      return engine.checkElement(page, step.selector);
    case "checkCaptcha":      return engine.checkCaptcha(page);
    case "dismissModals":     return engine.dismissModals(page, step);
    default:
      return { ok: false, action: step.action, error: `Unknown action: ${step.action}` };
  }
}

// ── POST /browser/navigate ────────────────────────────────────────────────────
router.post("/browser/navigate", rateLimiter(20, 60_000), async (req, res) => {
  const { url, pageId, headless } = req.body;
  if (!url) return res.status(400).json({ success: false, error: "url required" });

  try {
    const session = _getSession();
    let pid = pageId, page;

    if (pid) {
      page = session.getPage(pid);
      if (!page) return res.status(404).json({ success: false, error: `Page ${pid} not found` });
    } else {
      if (!session.isRunning()) await session.launch({ headless: headless !== false });
      const r = await session.newPage();
      if (!r.ok) return res.status(500).json({ success: false, error: r.error });
      pid  = r.pageId;
      page = r.page;
    }

    const result = await _getEngine().navigate(page, url);
    return res.json({ success: result.ok, pageId: pid, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /browser/screenshot ──────────────────────────────────────────────────
router.post("/browser/screenshot", rateLimiter(10, 60_000), async (req, res) => {
  const { pageId, fullPage } = req.body;
  if (!pageId) return res.status(400).json({ success: false, error: "pageId required" });

  try {
    const page = _getSession().getPage(pageId);
    if (!page) return res.status(404).json({ success: false, error: "Page not found" });

    const result = await _getEngine().screenshot(page, { fullPage: fullPage === true });
    return res.json({ success: result.ok, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/sessions ─────────────────────────────────────────────────────
router.get("/browser/sessions", (req, res) => {
  try {
    return res.json({ success: true, ..._getSession().getMetrics() });
  } catch (err) {
    return res.json({ success: false, running: false, error: err.message });
  }
});

// ── GET /browser/running ──────────────────────────────────────────────────────
router.get("/browser/running", (req, res) => {
  try {
    const runner  = _getRunner();
    const running = runner.listRunning();
    return res.json({ success: true, count: running.length, workflows: running });
  } catch (err) {
    return res.json({ success: false, workflows: [], error: err.message });
  }
});

// ── GET /browser/workflows ────────────────────────────────────────────────────
router.get("/browser/workflows", (req, res) => {
  try {
    const workflows = _getWorkflows().listWorkflows();
    return res.json({ success: true, count: workflows.length, workflows });
  } catch (err) {
    return res.json({ success: false, workflows: [], error: err.message });
  }
});

// ── GET /browser/library ──────────────────────────────────────────────────────
// Returns the verified workflow library with metadata
router.get("/browser/library", (req, res) => {
  try {
    const lib = _getLibrary();
    return res.json({ success: true, catalogue: lib.getCatalogue(), count: lib.list().length });
  } catch (err) {
    return res.json({ success: false, catalogue: [], error: err.message });
  }
});

// ── POST /browser/library/run ─────────────────────────────────────────────────
// Run a verified library workflow by name
router.post("/browser/library/run", rateLimiter(10, 60_000), async (req, res) => {
  const { name, params = {}, label, headless, stopOnFailure, takeScreenshotOnDone, timeoutMs } = req.body;

  if (!name) return res.status(400).json({ success: false, error: "name required" });

  const lib   = _getLibrary();
  const steps = lib.get(name, params);
  if (!steps) {
    return res.status(400).json({
      success:   false,
      error:     `Unknown library workflow: "${name}"`,
      available: lib.list().map(w => w.name),
    });
  }

  try {
    const runner = _getRunner();
    const result = await runner.run(steps, {
      label:                label || `Library: ${name}`,
      headless:             headless !== false,
      stopOnFailure:        stopOnFailure !== false,
      takeScreenshotOnDone: takeScreenshotOnDone === true,
      takeScreenshotOnFail: true,
      timeoutMs:            timeoutMs || undefined,
    });
    _autoRecord(result, { workflowName: label || name, triggeredBy: `library:${name}` });
    const { _originalSteps, ...response } = result;
    return res.json({ success: result.ok, library: name, ...response });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/result/:id ───────────────────────────────────────────────────
router.get("/browser/result/:id", (req, res) => {
  try {
    const result = _getRunner().getWorkflowResult(req.params.id);
    if (!result) return res.status(404).json({ success: false, error: "Result not found (may have expired)" });
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /browser/cancel ──────────────────────────────────────────────────────
router.post("/browser/cancel", (req, res) => {
  const { workflowId, reason } = req.body;
  if (!workflowId) return res.status(400).json({ success: false, error: "workflowId required" });
  try {
    const result = _getRunner().cancel(workflowId, reason);
    return res.json({ success: result.ok, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /browser/stop ────────────────────────────────────────────────────────
router.post("/browser/stop", (req, res) => {
  try {
    const result = _getRunner().emergencyStop(req.body?.reason);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /browser/close ───────────────────────────────────────────────────────
router.post("/browser/close", async (req, res) => {
  const { pageId } = req.body;
  if (!pageId) return res.status(400).json({ success: false, error: "pageId required" });
  try {
    const result = await _getSession().closePage(pageId);
    return res.json({ success: result.ok, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /browser/shutdown ──────────────────────────────────────────────────
router.delete("/browser/shutdown", async (req, res) => {
  try {
    const result = await _getSession().shutdown();
    return res.json({ success: result.ok });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/status ───────────────────────────────────────────────────────
router.get("/browser/status", (req, res) => {
  try {
    const session = _getSession();
    const runner  = _getRunner();
    return res.json({
      success: true,
      ...session.getMetrics(),
      activeWorkflows: runner.listRunning().length,
    });
  } catch (err) {
    return res.json({ success: true, running: false, playwrightInstalled: false, error: err.message });
  }
});

// ── GET /browser/health ───────────────────────────────────────────────────────
// Richer health snapshot — for operator dashboard display
router.get("/browser/health", (req, res) => {
  try {
    const session  = _getSession();
    const runner   = _getRunner();
    const metrics  = session.getMetrics();
    const running  = runner.listRunning();
    return res.json({
      success:          true,
      browserRunning:   metrics.running,
      openTabs:         metrics.openTabs,
      maxTabs:          metrics.maxTabs,
      tabsAvailable:    metrics.maxTabs - metrics.openTabs,
      crashCount:       metrics.crashCount,
      activeWorkflows:  running.length,
      workflows:        running,
      totalOpened:      metrics.totalOpened,
      totalClosed:      metrics.totalClosed,
      availableWorkflows: _getWorkflows().listWorkflows().length,
      timestamp:        new Date().toISOString(),
    });
  } catch (err) {
    return res.json({
      success:        false,
      browserRunning: false,
      error:          err.message,
      timestamp:      new Date().toISOString(),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE STORE
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /browser/templates ───────────────────────────────────────────────────
router.post("/browser/templates", rateLimiter(20, 60_000), (req, res) => {
  const { name, steps, description, category, tags, params, source } = req.body;
  if (!name || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({ success: false, error: "name and steps[] required" });
  }
  const result = _getStore().saveTemplate(name, steps, { description, category, tags, params, source });
  return result.ok
    ? res.json({ success: true, ...result })
    : res.status(400).json({ success: false, ...result });
});

// ── GET /browser/templates ────────────────────────────────────────────────────
router.get("/browser/templates", (req, res) => {
  try {
    const { category, tag, search } = req.query;
    const templates = _getStore().listTemplates({ category, tag, search });
    return res.json({ success: true, count: templates.length, templates });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/templates/:id ────────────────────────────────────────────────
router.get("/browser/templates/:id", (req, res) => {
  const tpl = _getStore().getTemplate(req.params.id);
  if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });
  return res.json({ success: true, template: tpl });
});

// ── DELETE /browser/templates/:id ─────────────────────────────────────────────
router.delete("/browser/templates/:id", (req, res) => {
  const result = _getStore().deleteTemplate(req.params.id);
  return res.json({ success: result.ok, ...result });
});

// ── POST /browser/templates/:id/clone ────────────────────────────────────────
router.post("/browser/templates/:id/clone", (req, res) => {
  const result = _getStore().cloneTemplate(req.params.id, req.body?.name);
  return result.ok
    ? res.json({ success: true, ...result })
    : res.status(400).json({ success: false, ...result });
});

// ── GET /browser/templates/:id/steps ─────────────────────────────────────────
// Returns steps with optional {{param}} substitution for previewing or direct run
router.get("/browser/templates/:id/steps", (req, res) => {
  const steps = _getStore().getTemplateSteps(req.params.id, req.query || {});
  if (!steps) return res.status(404).json({ success: false, error: "Template not found" });
  return res.json({ success: true, steps });
});

// ── POST /browser/templates/:id/run ──────────────────────────────────────────
router.post("/browser/templates/:id/run", rateLimiter(10, 60_000), async (req, res) => {
  const { params = {}, label, headless, stopOnFailure, takeScreenshotOnDone, timeoutMs, noRecord } = req.body;
  const templateId = req.params.id;

  const tpl = _getStore().getTemplate(templateId);
  if (!tpl) return res.status(404).json({ success: false, error: "Template not found" });

  const steps = _getStore().getTemplateSteps(templateId, params);
  if (!steps?.length) return res.status(400).json({ success: false, error: "Template has no steps" });

  try {
    const runner = _getRunner();
    const result = await runner.run(steps, {
      label:                label || tpl.name,
      headless:             headless !== false,
      stopOnFailure:        stopOnFailure !== false,
      takeScreenshotOnDone: takeScreenshotOnDone === true,
      takeScreenshotOnFail: true,
      timeoutMs:            timeoutMs || undefined,
    });
    // noRecord=true = test mode — skip history recording and template usage stats
    if (!noRecord) {
      _autoRecord(result, { templateId, workflowName: tpl.name, triggeredBy: noRecord ? "template/test" : "template/run" });
    }
    const { _originalSteps, ...response } = result;
    return res.json({ success: result.ok, templateId, testMode: !!noRecord, ...response });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// EXECUTION HISTORY
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /browser/history ──────────────────────────────────────────────────────
router.get("/browser/history", (req, res) => {
  try {
    const { templateId, ok, limit, offset } = req.query;
    const opts = {
      templateId: templateId || undefined,
      ok:         ok !== undefined ? ok === "true" : undefined,
      limit:      limit  ? parseInt(limit,  10) : 50,
      offset:     offset ? parseInt(offset, 10) : 0,
    };
    const history = _getStore().listHistory(opts);
    return res.json({ success: true, count: history.length, history });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/history/:id ──────────────────────────────────────────────────
router.get("/browser/history/:id", (req, res) => {
  const exec = _getStore().getExecution(req.params.id);
  if (!exec) return res.status(404).json({ success: false, error: "Execution not found" });
  return res.json({ success: true, execution: exec });
});

// ── POST /browser/history/:id/replay ─────────────────────────────────────────
router.post("/browser/history/:id/replay", rateLimiter(5, 60_000), async (req, res) => {
  const { label, headless, timeoutMs } = req.body;
  const executionId = req.params.id;

  const steps = _getStore().getReplaySteps(executionId);
  if (!steps) {
    return res.status(404).json({ success: false, error: "Execution not found or has no replayable steps" });
  }

  try {
    const exec   = _getStore().getExecution(executionId);
    const runner = _getRunner();
    const result = await runner.run(steps, {
      label:                label || `Replay: ${exec?.name || executionId}`,
      headless:             headless !== false,
      stopOnFailure:        true,
      takeScreenshotOnFail: true,
      timeoutMs:            timeoutMs || undefined,
    });
    _autoRecord(result, {
      templateId:   exec?.templateId,
      workflowName: label || exec?.name,
      triggeredBy:  `replay:${executionId}`,
    });
    const { _originalSteps, ...response } = result;
    return res.json({ success: result.ok, replayOf: executionId, ...response });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /browser/history/clear ───────────────────────────────────────────────
router.post("/browser/history/clear", (req, res) => {
  try {
    const olderThanDays = req.body?.olderThanDays ?? 30;
    const result = _getStore().clearHistory(olderThanDays);
    return res.json({ success: true, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEALTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── GET /browser/health/system ────────────────────────────────────────────────
router.get("/browser/health/system", (req, res) => {
  try {
    const report = _getStore().getSystemHealth();
    const storeStats = _getStore().stats();
    return res.json({ success: true, ...report, store: storeStats });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/health/workflow/:id ─────────────────────────────────────────
router.get("/browser/health/workflow/:id", (req, res) => {
  try {
    const report = _getStore().getWorkflowHealth(req.params.id);
    return res.json({ success: true, ...report });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/store/stats ──────────────────────────────────────────────────
router.get("/browser/store/stats", (req, res) => {
  try {
    return res.json({ success: true, ..._getStore().stats() });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULE MANAGEMENT  (server-side execution scheduler)
// ═══════════════════════════════════════════════════════════════════════════════

// GET  /browser/schedules              — list all schedules + last run data
// POST /browser/schedules/:id          — save/update a schedule for a template
// DELETE /browser/schedules/:id        — remove schedule for a template
// GET  /browser/schedules/status       — scheduler status (active, nextTick, inFlight)
// GET  /browser/schedules/runs         — all run records

// ── GET /browser/schedules/status ────────────────────────────────────────────
router.get("/browser/schedules/status", (req, res) => {
  try {
    return res.json({ success: true, ..._getScheduler().getStatus() });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/schedules/runs ───────────────────────────────────────────────
router.get("/browser/schedules/runs", (req, res) => {
  try {
    return res.json({ success: true, runs: _getScheduler().getRuns() });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /browser/schedules ────────────────────────────────────────────────────
router.get("/browser/schedules", (req, res) => {
  try {
    const schedules = _getScheduler().getSchedules();
    const runs      = _getScheduler().getRuns();
    const entries   = Object.entries(schedules).map(([templateId, sched]) => ({
      templateId,
      ...sched,
      lastRun:  runs[templateId]?.lastRun  || null,
      lastOk:   runs[templateId]?.lastOk   ?? null,
      runCount: runs[templateId]?.runCount  || 0,
    }));
    return res.json({ success: true, count: entries.length, schedules: entries });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /browser/schedules/:id ───────────────────────────────────────────────
// Body: { freq, time, day, dayOfMonth, params, enabled }
// Pass freq:"manual" or omit body to clear the schedule.
router.post("/browser/schedules/:id", rateLimiter(30, 60_000), (req, res) => {
  const templateId = req.params.id;
  const sched      = req.body;
  try {
    const result = _getScheduler().saveSchedule(templateId, sched);
    return res.json({ success: result.ok, ...result });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── DELETE /browser/schedules/:id ────────────────────────────────────────────
router.delete("/browser/schedules/:id", (req, res) => {
  try {
    const result = _getScheduler().removeSchedule(req.params.id);
    return res.json({ success: result.ok });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
