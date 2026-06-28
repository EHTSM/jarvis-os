"use strict";
/**
 * workspaceController.cjs — POST-Ω Sprint P5 UCC
 *
 * Tracks and manages the complete UCC workspace state:
 *   - active project (editor)
 *   - active browser sessions
 *   - active terminal sessions
 *   - current task / workflow
 *   - automation coverage
 *   - founder time saved
 *
 * Provides the computerExecutionEngine with a single unified context object.
 * Does NOT re-implement workspaceService — reads from it and adds UCC context.
 *
 * Storage: data/ucc-workspace.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT   = path.join(__dirname, "../..");
const DATA   = path.join(ROOT, "data", "ucc-workspace.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _ec   = () => _try(() => require("./editorController.cjs"));
const _bc   = () => _try(() => require("./browserController.cjs"));
const _tc   = () => _try(() => require("./terminalController.cjs"));
const _dc   = () => _try(() => require("./desktopController.cjs"));
const _aee  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _ws   = () => _try(() => require("./workspaceService.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      activeProject:   null,
      activeBrowser:   null,
      activeTerminal:  null,
      activeEditor:    null,
      currentTask:     null,
      currentWorkflow: null,
      taskHistory:     [],
      stats: { tasksCompleted: 0, workflowsRun: 0, minutesSaved: 0, automationCoverage: 0 },
      updatedAt: null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── State setters ─────────────────────────────────────────────────────────────

function setActiveProject(projectPath, projectName = null) {
  const d = _load();
  d.activeProject = { path: projectPath, name: projectName || require("path").basename(projectPath), setAt: _ts() };
  _save(d);
  return { ok: true, activeProject: d.activeProject };
}

function setActiveBrowser(tabId, url = null) {
  const d = _load();
  d.activeBrowser = { tabId, url, setAt: _ts() };
  _save(d);
  return { ok: true, activeBrowser: d.activeBrowser };
}

function setActiveTerminal(cmdId, cmd = null) {
  const d = _load();
  d.activeTerminal = { cmdId, cmd, setAt: _ts() };
  _save(d);
  return { ok: true, activeTerminal: d.activeTerminal };
}

function setCurrentTask(task, workflow = null) {
  const d = _load();
  d.currentTask     = { task, startedAt: _ts() };
  d.currentWorkflow = workflow ? { name: workflow, startedAt: _ts() } : null;
  _save(d);
  return { ok: true, currentTask: d.currentTask };
}

function completeTask(taskId, outcome = "success", minutesSaved = 0) {
  const d = _load();
  const task = d.currentTask;
  if (task) {
    d.taskHistory.push({ ...task, completedAt: _ts(), outcome, minutesSaved });
    if (d.taskHistory.length > 100) d.taskHistory = d.taskHistory.slice(-100);
  }
  if (outcome === "success") {
    d.stats.tasksCompleted++;
    d.stats.minutesSaved += minutesSaved;
  }
  d.currentTask     = null;
  d.currentWorkflow = null;
  _save(d);
  return { ok: true, outcome, minutesSaved };
}

// ── getContext ────────────────────────────────────────────────────────────────
// Returns the full unified context for the computerExecutionEngine.

function getContext() {
  const d   = _load();
  const ec  = _ec()?.getStats?.()  || {};
  const bc  = _bc()?.getStats?.()  || {};
  const tc  = _tc()?.getStats?.()  || {};
  const dc  = _dc()?.readDesktopState?.()?.state || {};

  // Automation coverage from founderWorkRegistry
  const reg = _fwr()?.getRegistry?.();
  const automatedCount = reg ? (reg.workflows || []).filter(w => w.automated).length : 0;
  const totalWorkflows = reg ? (reg.workflows || []).length : 1;
  const coverage = Math.round(automatedCount / totalWorkflows * 100);

  // Active AEE runs
  const activeRuns = _aee()?.listRuns?.().filter(r => r.status === "running").length || 0;

  return {
    ok: true,
    activeProject:    d.activeProject,
    activeBrowser:    d.activeBrowser,
    activeTerminal:   d.activeTerminal,
    activeEditor:     ec.openProjects || [],
    currentTask:      d.currentTask,
    currentWorkflow:  d.currentWorkflow,
    stats:            {
      ...d.stats,
      automationCoverage: coverage,
      automatedWorkflows: automatedCount,
      totalWorkflows,
    },
    subsystems: {
      editor:     { stats: ec },
      browser:    { openTabs: bc.openTabs || 0, stats: bc },
      terminal:   { stats: tc },
      desktop:    { platform: dc.platform, activeApp: dc.activeApp },
    },
    activeEngineRuns: activeRuns,
    taskHistory:      d.taskHistory.slice(-5),
    updatedAt:        d.updatedAt,
    generatedAt:      _ts(),
  };
}

// ── snapshot ─────────────────────────────────────────────────────────────────

function snapshot() {
  return getContext();
}

// ── reset ────────────────────────────────────────────────────────────────────

function reset() {
  const d = _load();
  d.activeProject   = null;
  d.activeBrowser   = null;
  d.activeTerminal  = null;
  d.activeEditor    = null;
  d.currentTask     = null;
  d.currentWorkflow = null;
  _save(d);
  return { ok: true, message: "Workspace state reset" };
}

// ── getStats ─────────────────────────────────────────────────────────────────

function getStats() {
  const d = _load();
  return { ...d.stats, taskHistory: d.taskHistory.slice(-10) };
}

module.exports = {
  setActiveProject, setActiveBrowser, setActiveTerminal, setCurrentTask,
  completeTask, getContext, snapshot, reset, getStats,
};
