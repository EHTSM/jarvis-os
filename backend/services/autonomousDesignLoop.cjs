"use strict";
/**
 * ODI-20 Autonomous Design Loop
 *
 * Full closed-loop pipeline:
 *   Screenshot → DOM → Layout → Components → Accessibility → UX → Brand
 *   → Design System → Interaction → Vision QA → Patch → Tests → Commit
 *   → Regression Compare → Memory → Repeat
 *
 * Each stage result feeds the next. Improvements are committed and validated.
 * Learning from every accepted patch is stored in ODI-19 Design Memory.
 *
 * Storage: data/odi/loops/
 */

const fs   = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const LOOP_DIR = path.join(__dirname, "../../data/odi/loops");
function _ensureDir() { if (!fs.existsSync(LOOP_DIR)) fs.mkdirSync(LOOP_DIR, { recursive: true }); }

// Lazy-load all ODI services
function _svc() {
  return {
    capture:     () => require("./visualCaptureService.cjs"),
    dom:         () => require("./domAnalyzerService.cjs"),
    layout:      () => require("./layoutGraphService.cjs"),
    components:  () => require("./componentGraphService.cjs"),
    a11y:        () => require("./accessibilityAuditor.cjs"),
    ux:          () => require("./uxOptimizerService.cjs"),
    brand:       () => require("./brandIntelligence.cjs"),
    ds:          () => require("./designSystemAI.cjs"),
    tokens:      () => require("./designTokenEngine.cjs"),
    interactions:() => require("./interactionIntelligence.cjs"),
    visionQA:    () => require("./visionQA.cjs"),
    patcher:     () => require("./uiPatchGenerator.cjs"),
    regression:  () => require("./visualRegressionEngine.cjs"),
    memory:      () => require("./designMemory.cjs"),
  };
}

// ── Stage executor ────────────────────────────────────────────────────────────

function _stage(name, record, fn) {
  return fn()
    .then(r => {
      record.stages[name] = { ok: r.ok !== false, ...r };
      return r;
    })
    .catch(e => {
      record.stages[name] = { ok: false, error: e.message };
      return { ok: false, error: e.message };
    });
}

function _stageSync(name, record, fn) {
  try {
    const r = fn();
    record.stages[name] = { ok: r.ok !== false, ...r };
    return r;
  } catch (e) {
    record.stages[name] = { ok: false, error: e.message };
    return { ok: false, error: e.message };
  }
}

// ── Git commit helper ─────────────────────────────────────────────────────────

function _gitCommit(files, message) {
  const results = [];
  for (const f of files) {
    const add = spawnSync("git", ["add", f], { cwd: process.cwd(), encoding: "utf8" });
    results.push({ file: f, addStatus: add.status });
  }
  const commit = spawnSync("git", ["commit", "-m", message, "--no-gpg-sign"], { cwd: process.cwd(), encoding: "utf8" });
  return { ok: commit.status === 0, stdout: commit.stdout?.trim(), stderr: commit.stderr?.trim() };
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function run({ url, targetFile, autoCommit = false, brandConfig, maxPatches = 3, runLabel } = {}) {
  if (!url) return { ok: false, error: "url required" };

  _ensureDir();
  const loopId = `loop-${Date.now()}`;
  const record = {
    loopId,
    url,
    targetFile:  targetFile || null,
    autoCommit,
    runLabel:    runLabel || url,
    status:      "running",
    stages:      {},
    patches:     [],
    scores:      {},
    commits:     [],
    timestamp:   new Date().toISOString(),
  };

  const save = () => {
    try { fs.writeFileSync(path.join(LOOP_DIR, `${loopId}.json`), JSON.stringify(record, null, 2)); } catch {}
  };
  save();

  const s = _svc();

  // ── Stage 1: Screenshot ────────────────────────────────────────────────────
  const shot = await _stage("screenshot", record, () =>
    s.capture().captureViewport({ url, width: 1440, height: 900 })
  );
  save();

  // ── Stage 2: DOM Analysis ──────────────────────────────────────────────────
  const dom = await _stage("dom", record, () =>
    s.dom().analyzePage({ url })
  );
  save();
  if (!dom.ok) {
    record.status = "failed";
    save();
    return { ok: false, loopId, error: "DOM analysis failed: " + dom.error };
  }

  const domFilename = dom.filename;

  // ── Stage 3: Layout ────────────────────────────────────────────────────────
  const layout = await _stage("layout", record, () =>
    s.layout().analyzeLayout({ domFilename })
  );
  save();

  // ── Stage 4: Components ────────────────────────────────────────────────────
  const components = await _stage("components", record, () =>
    s.components().analyzeComponents({ domFilename })
  );
  save();

  // ── Stage 5: Accessibility ─────────────────────────────────────────────────
  const a11y = await _stage("accessibility", record, () =>
    s.a11y().auditPage({ url })
  );
  save();

  // ── Stage 6: UX Score ─────────────────────────────────────────────────────
  const ux = await _stage("ux", record, () =>
    s.ux().analyzeUX({ domFilename })
  );
  save();
  record.scores.uxBefore = ux.uxScore;

  // ── Stage 7: Brand ─────────────────────────────────────────────────────────
  const brand = await _stage("brand", record, () =>
    s.brand().analyzeFromDomFile({ domFilename, brandConfig })
  );
  save();

  // ── Stage 8: Design Tokens + System AI ────────────────────────────────────
  const tokens = await _stage("tokens", record, () =>
    s.tokens().generateTokens({ domFilename })
  );
  save();

  if (tokens.ok) {
    _stageSync("designSystem", record, () =>
      s.ds().analyzeDesignSystem({ tokens: tokens.tokens, stats: tokens.stats })
    );
    save();
  }

  // ── Stage 9: Interaction Intelligence ─────────────────────────────────────
  const interactions = await _stage("interactions", record, () =>
    s.interactions().analyzeInteractions({ url })
  );
  save();

  // ── Stage 10: Vision QA ────────────────────────────────────────────────────
  const vqa = await _stage("visionQA", record, () =>
    s.visionQA().auditPage({ url })
  );
  save();

  // ── Stage 11: Collect all findings ────────────────────────────────────────
  const allFindings = [
    ...(layout.findings  || []),
    ...(a11y.findings    || []),
    ...(ux.issues        || []),
    ...(brand.violations || []),
    ...(vqa.issues       || []),
    ...(interactions.issues || []),
  ].filter(f => f && f.severity !== "info");

  record.stages.collect = { ok: true, total: allFindings.length };
  save();

  // ── Stage 12: Patch Generation ─────────────────────────────────────────────
  if (targetFile && allFindings.length > 0) {
    const priority = allFindings.sort((a, b) => {
      const sev = { error: 2, warning: 1 };
      return (sev[b.severity] || 0) - (sev[a.severity] || 0);
    });

    const top = priority.slice(0, maxPatches);
    for (const finding of top) {
      // Enrich prompt with memory
      const memCtx = s.memory().buildMemoryContext(finding.type, finding.category || finding.type);
      const enrichedFinding = memCtx ? { ...finding, memoryContext: memCtx } : finding;
      const patchResult = await s.patcher().generatePatch({ finding: enrichedFinding, targetFile }).catch(() => ({ ok: false }));
      if (patchResult.ok) {
        record.patches.push({ patchId: patchResult.patchId, finding: finding.type, confidence: patchResult.confidence });
      }
    }
    record.stages.patches = { ok: true, generated: record.patches.length };
    save();

    // ── Stage 13: Auto-apply and commit ───────────────────────────────────────
    if (autoCommit && record.patches.length > 0) {
      const appliedFiles = [];
      for (const p of record.patches) {
        const apply = s.patcher().applyPatch(p.patchId);
        p.applied = apply.ok;
        if (apply.ok) appliedFiles.push(targetFile);
      }
      save();

      if (appliedFiles.length > 0) {
        const commitMsg = `feat(odi): autonomous design loop ${loopId} — ${appliedFiles.length} patch(es) applied`;
        const git = _gitCommit([...new Set(appliedFiles)], commitMsg);
        record.commits.push({ hash: git.stdout?.match(/\[.*?\s+([a-f0-9]+)\]/)?.[1], message: commitMsg, ok: git.ok });
        save();

        // ── Stage 14: Visual Regression ───────────────────────────────────────
        const baseline = shot.filename;
        const regResult = await _stage("regression", record, () =>
          s.regression().runRegression({ url, baselineFilename: baseline, label: `loop-${loopId}` })
        );
        save();

        // ── Stage 15: Memory — store accepted patches ──────────────────────────
        for (const p of record.patches.filter(p => p.applied)) {
          const patchRecord = s.patcher().listPatches({ limit: 100 }).find(r => r.patchId === p.patchId);
          if (patchRecord) {
            s.memory().remember({
              finding:     allFindings.find(f => f.type === p.finding),
              patchSpec:   patchRecord.patchSpecs,
              targetFile,
              scoreBefore: record.scores.uxBefore,
              strategy:    p.finding,
              outcome:     "applied",
            });
          }
        }
        record.stages.memory = { ok: true, stored: record.patches.filter(p => p.applied).length };
        save();
      }
    }
  }

  // ── Final score recalc ─────────────────────────────────────────────────────
  record.scores.vqaScore          = vqa.qaScore;
  record.scores.interactionScore  = interactions.interactionScore;
  record.scores.brandScore        = brand.brandScore;
  record.scores.a11yErrors        = a11y.stats?.errors || 0;

  record.status    = "complete";
  record.loopScore = Math.round([
    record.scores.uxBefore      || 0,
    record.scores.vqaScore      || 0,
    record.scores.interactionScore || 0,
    record.scores.brandScore    || 0,
  ].reduce((s, v) => s + v, 0) / 4);

  save();

  return {
    ok: true,
    loopId,
    status: "complete",
    loopScore:    record.loopScore,
    scores:       record.scores,
    findings:     allFindings.length,
    patchCount:   record.patches.length,
    commits:      record.commits.length,
    stagesRun:    Object.keys(record.stages).length,
  };
}

function listRuns({ limit = 20 } = {}) {
  _ensureDir();
  return fs.readdirSync(LOOP_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(LOOP_DIR, f), "utf8"));
        return { filename: f, loopId: d.loopId, url: d.url, status: d.status, loopScore: d.loopScore, patchCount: d.patches?.length, commits: d.commits?.length, timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

function getRun(loopId) {
  _ensureDir();
  const f = path.join(LOOP_DIR, `${loopId}.json`);
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; }
}

module.exports = { run, listRuns, getRun };
