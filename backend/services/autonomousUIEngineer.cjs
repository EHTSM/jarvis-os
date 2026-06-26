"use strict";
/**
 * ODI-10 Autonomous UI Engineer V1
 *
 * Full pipeline:
 *   Open page → Capture screenshot → Read DOM → Analyze layout →
 *   Detect bugs → Generate patch → Run tests → Commit → Deploy signal
 *
 * Orchestrates all ODI-1 through ODI-9 services.
 * State stored in data/odi/runs/
 */

const fs   = require("fs");
const path = require("path");

const RUNS_DIR = path.join(__dirname, "../../data/odi/runs");

function _ensureDir() {
  if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });
}

// Lazy-load to avoid circular deps
function _capture()   { return require("./visualCaptureService.cjs"); }
function _dom()       { return require("./domAnalyzerService.cjs"); }
function _layout()    { return require("./layoutGraphService.cjs"); }
function _components(){ return require("./componentGraphService.cjs"); }
function _analyzer()  { return require("./screenshotAnalyzerService.cjs"); }
function _tokens()    { return require("./designTokenEngine.cjs"); }
function _a11y()      { return require("./accessibilityAuditor.cjs"); }
function _responsive(){ return require("./responsiveSimulator.cjs"); }
function _patcher()   { return require("./uiPatchGenerator.cjs"); }

// ── Stage executor with error capture ────────────────────────────────────────

async function _stage(run, name, fn) {
  const stageStart = Date.now();
  run.stages[name] = { status: "running", startedAt: new Date().toISOString() };
  _saveRun(run);
  try {
    const result = await fn();
    run.stages[name] = { status: "done", durationMs: Date.now() - stageStart, result };
    _saveRun(run);
    return { ok: true, ...result };
  } catch (e) {
    run.stages[name] = { status: "error", error: e.message, durationMs: Date.now() - stageStart };
    _saveRun(run);
    return { ok: false, error: e.message };
  }
}

function _saveRun(run) {
  _ensureDir();
  fs.writeFileSync(path.join(RUNS_DIR, `${run.runId}.json`), JSON.stringify(run, null, 2));
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function run({ url, targetFile, autoCommit = false, runLabel } = {}) {
  if (!url) return { ok: false, error: "url required" };

  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const run   = {
    runId,
    url,
    targetFile:  targetFile || null,
    autoCommit,
    label:       runLabel || url,
    status:      "running",
    startedAt:   new Date().toISOString(),
    stages:      {},
    findings:    [],
    patches:     [],
    report:      null,
  };
  _saveRun(run);

  // ── Stage 1: Screenshot ────────────────────────────────────────────────────
  const captureResult = await _stage(run, "screenshot", async () => {
    return _capture().captureViewport({ url, width: 1440, height: 900, fullPage: false });
  });
  const screenshotFilename = captureResult.filename;

  // ── Stage 2: DOM Analysis ──────────────────────────────────────────────────
  const domResult = await _stage(run, "dom", async () => {
    return _dom().analyzePage({ url });
  });
  const domFilename = domResult.filename;

  // ── Stage 3: Layout Graph ──────────────────────────────────────────────────
  const layoutResult = await _stage(run, "layout", async () => {
    if (!domFilename) throw new Error("DOM snapshot unavailable — skipping layout");
    return _layout().analyzeLayout({ domFilename });
  });

  // ── Stage 4: Component Graph ───────────────────────────────────────────────
  await _stage(run, "components", async () => {
    if (!domFilename) throw new Error("DOM snapshot unavailable — skipping component graph");
    return _components().analyzeComponents({ domFilename });
  });

  // ── Stage 5: Accessibility Audit ───────────────────────────────────────────
  const a11yResult = await _stage(run, "accessibility", async () => {
    return _a11y().auditPage({ url });
  });

  // ── Stage 6: Design Tokens ─────────────────────────────────────────────────
  await _stage(run, "tokens", async () => {
    if (!domFilename) throw new Error("DOM snapshot unavailable — skipping tokens");
    return _tokens().generateTokens({ domFilename });
  });

  // ── Stage 7: Screenshot AI Analysis ───────────────────────────────────────
  const analysisResult = await _stage(run, "analysis", async () => {
    if (!domFilename) throw new Error("DOM snapshot unavailable — skipping AI analysis");
    return _analyzer().analyzeScreenshot({ screenshotFilename, domFilename });
  });

  // ── Stage 8: Collect all findings ─────────────────────────────────────────
  const allFindings = [];
  if (layoutResult.ok && Array.isArray(layoutResult.findings)) {
    allFindings.push(...layoutResult.findings.map(f => ({ source: "layout", ...f })));
  }
  if (a11yResult.ok && Array.isArray(a11yResult.findings)) {
    allFindings.push(...a11yResult.findings.map(f => ({ source: "accessibility", ...f })));
  }
  if (analysisResult.ok && Array.isArray(analysisResult.analysis?.findings)) {
    allFindings.push(...analysisResult.analysis.findings.map(f => ({ source: "ai_vision", ...f })));
  }

  run.findings = allFindings;
  _saveRun(run);

  // ── Stage 9: Patch generation (if targetFile provided) ────────────────────
  const patchResults = [];
  if (targetFile) {
    const actionableFindings = allFindings
      .filter(f => f.severity === "error" || f.severity === "warning")
      .slice(0, 5); // Generate max 5 patches per run

    for (const finding of actionableFindings) {
      try {
        const patch = await _patcher().generatePatch({ finding, targetFile });
        if (patch.ok && patch.specs.length > 0) {
          patchResults.push(patch);
        }
      } catch { /* non-fatal — continue */ }
    }
  }
  run.patches = patchResults.map(p => p.patchId).filter(Boolean);
  _saveRun(run);

  // ── Stage 10: Auto-apply + commit (if autoCommit) ─────────────────────────
  const committedPatches = [];
  if (autoCommit && targetFile && patchResults.length > 0) {
    await _stage(run, "autoCommit", async () => {
      for (const patch of patchResults) {
        const applied = _patcher().applyPatch(patch.patchId);
        if (applied.ok && applied.appliedCount > 0) {
          const committed = _patcher().commitPatch(patch.patchId);
          if (committed.ok) committedPatches.push(patch.patchId);
        }
      }
      return { committed: committedPatches.length, patches: committedPatches };
    });
  }

  // ── Final report ───────────────────────────────────────────────────────────
  run.report = {
    url,
    runId,
    stagesRun:       Object.keys(run.stages).length,
    stagesFailed:    Object.values(run.stages).filter(s => s.status === "error").length,
    totalFindings:   allFindings.length,
    errors:          allFindings.filter(f => f.severity === "error").length,
    warnings:        allFindings.filter(f => f.severity === "warning").length,
    patchesGenerated: patchResults.length,
    patchesCommitted: committedPatches.length,
    aiScore:          analysisResult.ok ? analysisResult.analysis?.score : null,
    screenshotPath:   captureResult.path,
    domPath:          domResult.path,
    completedAt:      new Date().toISOString(),
  };
  run.status = "completed";
  _saveRun(run);

  return { ok: true, runId, report: run.report, findings: allFindings.slice(0, 20), patches: run.patches };
}

// ── List / get runs ───────────────────────────────────────────────────────────

function listRuns({ limit = 20 } = {}) {
  _ensureDir();
  return fs.readdirSync(RUNS_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
        return { runId: d.runId, url: d.url, status: d.status, report: d.report, startedAt: d.startedAt };
      } catch { return null; }
    }).filter(Boolean);
}

function getRun(runId) {
  const fp = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, "utf8"));
}

module.exports = { run, listRuns, getRun };
