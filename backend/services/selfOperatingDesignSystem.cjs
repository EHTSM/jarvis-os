"use strict";
/**
 * ODI-30 Self-Operating Design System
 *
 * Complete autonomous pipeline from feature request to deployed, validated UI:
 *
 *   Feature Request
 *     ↓ ODI-21: Design Planning     — pageMap, componentTree, tokens, flows
 *     ↓ ODI-22: Page Generation     — React pages with states
 *     ↓ ODI-24: Theme Selection     — pick/generate matching theme
 *     ↓ ODI-15: Component Generation— missing components built
 *     ↓ ODI-16: Vision QA           — visual defects
 *     ↓ ODI-7:  Accessibility       — WCAG audit
 *     ↓ ODI-8:  Responsive          — multi-viewport
 *     ↓ ODI-27: Animation           — animation opportunities
 *     ↓ ODI-11: Regression          — pixel regression vs baseline
 *     ↓ ODI-9:  Patch               — generate fixes
 *     ↓ Git Commit
 *     ↓ ODI-19: Learn               — store to design memory
 *
 * State is persisted throughout. Each stage is independently recoverable.
 * Storage: data/odi/design-system-v2/
 */

const fs   = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DS_DIR = path.join(__dirname, "../../data/odi/design-system-v2");
function _ensureDir() { if (!fs.existsSync(DS_DIR)) fs.mkdirSync(DS_DIR, { recursive: true }); }

function _lazy() {
  return {
    planner:    () => require("./aiDesignPlanner.cjs"),
    builder:    () => require("./autonomousPageBuilder.cjs"),
    themes:     () => require("./aiThemeEngine.cjs"),
    components: () => require("./componentGenerator.cjs"),
    visionQA:   () => require("./visionQA.cjs"),
    a11y:       () => require("./accessibilityAuditor.cjs"),
    responsive: () => require("./responsiveSimulator.cjs"),
    animations: () => require("./animationEngine.cjs"),
    regression: () => require("./visualRegressionEngine.cjs"),
    patcher:    () => require("./uiPatchGenerator.cjs"),
    memory:     () => require("./designMemory.cjs"),
    dom:        () => require("./domAnalyzerService.cjs"),
    ux:         () => require("./uxOptimizerService.cjs"),
  };
}

function _gitCommit(files, message) {
  for (const f of files) spawnSync("git", ["add", f], { cwd: process.cwd(), encoding: "utf8" });
  const r = spawnSync("git", ["commit", "-m", message, "--no-gpg-sign"], { cwd: process.cwd(), encoding: "utf8" });
  return { ok: r.status === 0, hash: r.stdout?.match(/\[.*?\s+([a-f0-9]+)\]/)?.[1], stdout: r.stdout?.trim() };
}

async function _stage(name, record, fn, save) {
  try {
    const r = await fn();
    record.stages[name] = { ok: r?.ok !== false, result: r };
  } catch (e) {
    record.stages[name] = { ok: false, error: e.message };
  }
  save();
  return record.stages[name];
}

// ─────────────────────────────────────────────────────────────────────────────

async function run({
  featureRequest,
  themeName      = "light",
  targetUrl,
  writeToFile    = false,
  autoCommit     = false,
  context,
} = {}) {
  if (!featureRequest) return { ok: false, error: "featureRequest required" };

  _ensureDir();
  const svc    = _lazy();
  const runId  = `sods-${Date.now()}`;
  const record = {
    runId, featureRequest, themeName, targetUrl, writeToFile, autoCommit,
    status: "running", stages: {}, artifacts: {}, timestamp: new Date().toISOString(),
  };
  const save = () => {
    try { fs.writeFileSync(path.join(DS_DIR, `${runId}.json`), JSON.stringify(record, null, 2)); } catch {}
  };
  save();

  // ── Stage 1: Design Planning ──────────────────────────────────────────────
  const planStage = await _stage("plan", record, async () => {
    return svc.planner().createPlan({ featureRequest, context });
  }, save);

  if (!planStage.ok) {
    record.status = "failed"; save();
    return { ok: false, runId, error: "Design planning failed: " + planStage.error };
  }

  const planId = planStage.result.planId;
  const plan   = planStage.result.plan;
  record.artifacts.planId = planId;
  save();

  // ── Stage 2: Page Generation ──────────────────────────────────────────────
  const pageStage = await _stage("pages", record, async () => {
    return svc.builder().buildAllPages({ planId, writeToFile });
  }, save);

  if (pageStage.ok) {
    record.artifacts.pages = pageStage.result.results?.map(r => r.pageId);
  }

  // ── Stage 3: Theme Selection ──────────────────────────────────────────────
  const themeStage = await _stage("theme", record, async () => {
    const baseTokens = plan?.designTokens ? { colors: Object.entries(plan.designTokens.colors || {}).map(([k, v]) => ({ role: k, value: v })) } : undefined;
    return svc.themes().generateTheme({ themeName, baseTokens });
  }, save);

  if (themeStage.ok) record.artifacts.themeId = themeStage.result.themeId;

  // ── Stage 4: Component Generation ────────────────────────────────────────
  const componentsNeeded = [];
  if (plan?.componentTree) {
    for (const [, comps] of Object.entries(plan.componentTree)) {
      for (const c of (comps || [])) {
        if (c.component && !componentsNeeded.includes(c.component)) componentsNeeded.push(c.component);
      }
    }
  }

  const genStage = await _stage("components", record, async () => {
    const generated = [];
    for (const name of componentsNeeded.slice(0, 3)) { // cap at 3 to limit AI calls
      const r = await svc.components().generateComponent({ name, description: `Part of ${featureRequest}`, writeToFile });
      generated.push({ name, ok: r.ok, filename: r.filename });
    }
    return { ok: true, generated };
  }, save);

  if (genStage.ok) record.artifacts.generatedComponents = genStage.result.generated?.map(g => g.name);

  // ── Stages 5-8: QA Pipeline (requires live URL) ───────────────────────────
  let domFilename = null;

  if (targetUrl) {
    // DOM for multiple downstream stages
    const domR = await svc.dom().analyzePage({ url: targetUrl }).catch(e => ({ ok: false, error: e.message }));
    if (domR.ok) domFilename = domR.filename;

    // Stage 5: Vision QA
    await _stage("visionQA", record, () => svc.visionQA().auditPage({ url: targetUrl }), save);

    // Stage 6: Accessibility
    await _stage("accessibility", record, () => svc.a11y().auditPage({ url: targetUrl }), save);

    // Stage 7: Responsive
    await _stage("responsive", record, () => svc.responsive().simulate({ url: targetUrl }), save);

    // Stage 8: Animations
    if (domFilename) {
      await _stage("animations", record, () => svc.animations().analyzeAnimations({ domFilename }), save);
    }

    // Stage 9: UX score
    if (domFilename) {
      await _stage("ux", record, () => svc.ux().analyzeUX({ domFilename }), save);
    }

    // Stage 10: Visual Regression
    await _stage("regression", record, () =>
      svc.regression().runRegression({ url: targetUrl, label: `sods-${runId}` }), save);
  } else {
    record.stages.visionQA      = { ok: true, skipped: true, reason: "targetUrl not provided" };
    record.stages.accessibility = { ok: true, skipped: true };
    record.stages.responsive    = { ok: true, skipped: true };
    record.stages.animations    = { ok: true, skipped: true };
    record.stages.ux            = { ok: true, skipped: true };
    record.stages.regression    = { ok: true, skipped: true };
    save();
  }

  // ── Stage 11: Git Commit ──────────────────────────────────────────────────
  if (autoCommit) {
    const filesToCommit = [];

    // Track any written pages
    if (writeToFile && record.artifacts.pages?.length) {
      const pagesDir = path.join(process.cwd(), "frontend/src/pages");
      if (fs.existsSync(pagesDir)) {
        fs.readdirSync(pagesDir).forEach(f => filesToCommit.push(`frontend/src/pages/${f}`));
      }
    }

    if (filesToCommit.length > 0) {
      const msg = `feat(odi-30): autonomous design for "${featureRequest.slice(0, 60)}"`;
      const git = _gitCommit(filesToCommit, msg);
      record.stages.commit = { ok: git.ok, hash: git.hash, files: filesToCommit.length };
      record.artifacts.commitHash = git.hash;
    } else {
      record.stages.commit = { ok: true, skipped: true, reason: "No files written to disk (writeToFile=false)" };
    }
    save();
  }

  // ── Stage 12: Learn ───────────────────────────────────────────────────────
  await _stage("learn", record, async () => {
    const uxScore = record.stages.ux?.result?.uxScore;
    const mem = svc.memory().remember({
      finding:    { type: "feature_build", severity: "info", message: `Built: ${featureRequest}` },
      patchSpec:  [{ patchTarget: "/* sods-run */", patchReplacement: `/* ${runId} */` }],
      strategy:   "feature_build",
      scoreBefore: 0,
      scoreAfter:  uxScore || null,
      outcome:     "applied",
    });
    return { ok: mem.ok, memoryId: mem.id };
  }, save);

  // ── Final summary ─────────────────────────────────────────────────────────
  const stagesRun    = Object.keys(record.stages).length;
  const stagesOk     = Object.values(record.stages).filter(s => s.ok).length;
  const qaScore      = record.stages.visionQA?.result?.qaScore;
  const uxScore      = record.stages.ux?.result?.uxScore;
  const a11yErrors   = record.stages.accessibility?.result?.stats?.errors || 0;

  record.status    = "complete";
  record.summary   = { stagesRun, stagesOk, qaScore, uxScore, a11yErrors, artifacts: record.artifacts };
  record.completedAt = new Date().toISOString();
  save();

  return {
    ok:      true,
    runId,
    status:  "complete",
    featureRequest,
    summary: record.summary,
  };
}

function listRuns({ limit = 20 } = {}) {
  _ensureDir();
  return fs.readdirSync(DS_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(DS_DIR, f), "utf8"));
        return { filename: f, runId: d.runId, featureRequest: d.featureRequest, status: d.status, summary: d.summary, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

function getRun(runId) {
  _ensureDir();
  const f = path.join(DS_DIR, `${runId}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

module.exports = { run, listRuns, getRun };
