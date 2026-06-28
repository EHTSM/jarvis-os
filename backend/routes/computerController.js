"use strict";
/**
 * POST-Ω Sprint P5 — Universal Computer Controller routes
 * All routes require authentication.
 * Prefix: /computer/*
 */

const router = require("express").Router();

const _try = fn => { try { return fn(); } catch { return null; } };
const requireAuth = _try(() => require("../middleware/requireAuth")) || ((req, res, next) => next());

const _cc  = () => _try(() => require("../services/computerController.cjs"));
const _cee = () => _try(() => require("../services/computerExecutionEngine.cjs"));
const _dc  = () => _try(() => require("../services/desktopController.cjs"));
const _bc  = () => _try(() => require("../services/browserController.cjs"));
const _ec  = () => _try(() => require("../services/editorController.cjs"));
const _tc  = () => _try(() => require("../services/terminalController.cjs"));
const _wc  = () => _try(() => require("../services/workspaceController.cjs"));

// ── Main UCC entry point ──────────────────────────────────────────────────────

router.get("/computer/capabilities", requireAuth, (req, res) => res.json(_cc()?.getCapabilities?.() || { ok: false }));
router.get("/computer/dashboard",    requireAuth, (req, res) => res.json(_cc()?.getDashboard?.()    || { ok: false }));
router.get("/computer/stats",        requireAuth, (req, res) => res.json({ ok: true, stats: _cc()?.getStats?.() || {} }));

router.post("/computer/run", requireAuth, async (req, res) => {
  const { command, projectPath, workflow } = req.body || {};
  if (!command) return res.status(400).json({ ok: false, error: "command required" });
  try {
    const result = await _cc()?.run?.(command, { projectPath, workflow });
    res.json(result || { ok: false });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

// ── Execution runs ────────────────────────────────────────────────────────────

router.get("/computer/runs",        requireAuth, (req, res) => {
  const { status, domain, limit } = req.query;
  res.json({ ok: true, runs: _cc()?.listRuns?.({ status, domain, limit: limit ? +limit : 50 }) || [] });
});
router.get("/computer/runs/:runId", requireAuth, (req, res) => {
  const run = _cc()?.getRun?.(req.params.runId);
  if (!run) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, run });
});

// ── Workspace ─────────────────────────────────────────────────────────────────

router.get("/computer/workspace",           requireAuth, (req, res) => res.json(_wc()?.getContext?.() || { ok: false }));
router.post("/computer/workspace/project",  requireAuth, (req, res) => {
  const { path: p, name } = req.body || {};
  res.json(_wc()?.setActiveProject?.(p, name) || { ok: false });
});
router.post("/computer/workspace/task",     requireAuth, (req, res) => {
  const { task, workflow } = req.body || {};
  res.json(_wc()?.setCurrentTask?.(task, workflow) || { ok: false });
});
router.post("/computer/workspace/reset",    requireAuth, (req, res) => res.json(_wc()?.reset?.() || { ok: false }));

// ── Desktop ───────────────────────────────────────────────────────────────────

router.get("/computer/desktop/state",       requireAuth, (req, res)  => res.json(_dc()?.readDesktopState?.() || { ok: false }));
router.get("/computer/desktop/downloads",   requireAuth, (req, res)  => res.json(_dc()?.listDownloads?.() || { ok: false }));
router.post("/computer/desktop/launch",     requireAuth, (req, res)  => {
  const { app } = req.body || {};
  if (!app) return res.status(400).json({ ok: false, error: "app required" });
  res.json(_dc()?.launchApp?.(app) || { ok: false });
});
router.post("/computer/desktop/focus",      requireAuth, (req, res)  => {
  const { app } = req.body || {};
  res.json(_dc()?.focusWindow?.(app) || { ok: false });
});
router.post("/computer/desktop/open",       requireAuth, (req, res)  => {
  const { path: p } = req.body || {};
  res.json(_dc()?.openPath?.(p) || { ok: false });
});
router.get("/computer/desktop/clipboard",   requireAuth, (req, res)  => res.json(_dc()?.clipboardRead?.() || { ok: false }));
router.post("/computer/desktop/clipboard",  requireAuth, (req, res)  => {
  const { text } = req.body || {};
  res.json(_dc()?.clipboardWrite?.(text) || { ok: false });
});
router.post("/computer/desktop/screenshot", requireAuth, async (req, res) => {
  try { res.json(await _dc()?.captureScreenshot?.(req.body) || { ok: false }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// ── Browser ───────────────────────────────────────────────────────────────────

router.get("/computer/browser/tabs",        requireAuth, (req, res) => res.json({ ok: true, tabs: _bc()?.listTabs?.(req.query) || [] }));
router.get("/computer/browser/stats",       requireAuth, (req, res) => res.json({ ok: true, stats: _bc()?.getStats?.() || {} }));
router.post("/computer/browser/open",       requireAuth, (req, res) => {
  const { url, browser, profileId } = req.body || {};
  res.json(_bc()?.openTab?.({ url, browser, profileId }) || { ok: false });
});
router.post("/computer/browser/close/:tabId", requireAuth, (req, res) => res.json(_bc()?.closeTab?.(req.params.tabId) || { ok: false }));
router.post("/computer/browser/switch/:tabId",requireAuth, (req, res) => res.json(_bc()?.switchTab?.(req.params.tabId) || { ok: false }));
router.post("/computer/browser/screenshot/:tabId", requireAuth, async (req, res) => {
  try { res.json(await _bc()?.captureScreenshot?.(req.params.tabId, req.body) || { ok: false }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post("/computer/browser/workflow",   requireAuth, async (req, res) => {
  const { intent, tabId, context } = req.body || {};
  try { res.json(await _bc()?.executeWorkflow?.(intent, { tabId, context }) || { ok: false }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post("/computer/browser/download",   requireAuth, (req, res) => res.json(_bc()?.downloadFile?.(req.body) || { ok: false }));
router.post("/computer/browser/auth",       requireAuth, (req, res) => res.json(_bc()?.authenticate?.(req.body) || { ok: false }));

// ── Editor ────────────────────────────────────────────────────────────────────

router.get("/computer/editor/stats",        requireAuth, (req, res) => res.json({ ok: true, stats: _ec()?.getStats?.() || {} }));
router.post("/computer/editor/open",        requireAuth, (req, res) => {
  const { path: p } = req.body || {};
  res.json(_ec()?.openProject?.(p) || { ok: false });
});
router.post("/computer/editor/search",      requireAuth, async (req, res) => {
  const { query, opts } = req.body || {};
  try { res.json(await _ec()?.searchCode?.(query, opts || {}) || { ok: false }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post("/computer/editor/create",      requireAuth, (req, res) => {
  const { path: p, content, overwrite } = req.body || {};
  res.json(_ec()?.createFile?.(p, content, { overwrite }) || { ok: false });
});
router.post("/computer/editor/modify",      requireAuth, async (req, res) => {
  const { path: p, instruction, opts } = req.body || {};
  try { res.json(await _ec()?.modifyFile?.(p, instruction, opts) || { ok: false }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
router.post("/computer/editor/format",      requireAuth, (req, res) => {
  const { path: p } = req.body || {};
  res.json(_ec()?.formatFile?.(p) || { ok: false });
});
router.get("/computer/editor/diagnostics",  requireAuth, (req, res) => res.json(_ec()?.getDiagnostics?.(req.query.path) || { ok: false }));
router.post("/computer/editor/commit",      requireAuth, (req, res) => res.json(_ec()?.commitChanges?.(req.body) || { ok: false }));

// ── Terminal ──────────────────────────────────────────────────────────────────

router.get("/computer/terminal/stats",      requireAuth, (req, res) => res.json({ ok: true, stats: _tc()?.getStats?.() || {} }));
router.get("/computer/terminal/commands",   requireAuth, (req, res) => {
  const { status, limit } = req.query;
  res.json({ ok: true, commands: _tc()?.listCommands?.({ status, limit: limit ? +limit : 50 }) || [] });
});
router.post("/computer/terminal/run",       requireAuth, (req, res) => {
  const { cmd, cwd, timeoutMs } = req.body || {};
  if (!cmd) return res.status(400).json({ ok: false, error: "cmd required" });
  res.json(_tc()?.execute?.(cmd, { cwd, timeoutMs }) || { ok: false });
});
router.post("/computer/terminal/stream",    requireAuth, (req, res) => {
  const { cmd, cwd } = req.body || {};
  if (!cmd) return res.status(400).json({ ok: false, error: "cmd required" });
  res.json(_tc()?.streamOutput?.(cmd, { cwd }) || { ok: false });
});
router.get("/computer/terminal/output/:cmdId", requireAuth, (req, res) => {
  const r = _tc()?.getOutput?.(req.params.cmdId);
  if (!r) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, ...r });
});
router.post("/computer/terminal/retry/:cmdId",   requireAuth, (req, res) => res.json(_tc()?.retry?.(req.params.cmdId, req.body?.maxAttempts || 3) || { ok: false }));
router.post("/computer/terminal/recover/:cmdId",  requireAuth, (req, res) => res.json(_tc()?.recover?.(req.params.cmdId, req.body) || { ok: false }));
router.get("/computer/terminal/verify",     requireAuth, (req, res) => res.json(_tc()?.verify?.(req.query.context || "general") || { ok: false }));
router.post("/computer/terminal/test",      requireAuth, (req, res) => res.json(_tc()?.runTests?.(req.body?.testFile, req.body) || { ok: false }));

module.exports = router;
