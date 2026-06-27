"use strict";
/**
 * ODI-29 Continuous Design Observer
 *
 * Watches the frontend source tree for file changes (using fs.watch).
 * When a JSX/TSX/CSS file changes:
 *   1. Screenshot the current page (if running)
 *   2. Re-run DOM analysis
 *   3. Re-run Layout analysis
 *   4. Run Visual Regression against baseline
 *   5. Run UX Audit
 *   6. Run Accessibility audit
 *   7. Collect patch suggestions
 *
 * Observer state: running/stopped, cycle count, last results.
 * Storage: data/odi/observer/ — one record per cycle.
 */

const fs   = require("fs");
const path = require("path");

const OBS_DIR     = path.join(__dirname, "../../data/odi/observer");
const FRONTEND_SRC = path.join(process.cwd(), "frontend/src");

function _ensureDir() { if (!fs.existsSync(OBS_DIR)) fs.mkdirSync(OBS_DIR, { recursive: true }); }

// ── Global state (in-process singleton) ──────────────────────────────────────
let _watcher     = null;
let _state       = { running: false, cycleCount: 0, lastCycle: null, url: null, baseline: null, startedAt: null };
let _pendingRun  = false;
let _debounceTimer = null;

const DEBOUNCE_MS = 2000; // wait 2s after last change before running

// ── Cycle runner ──────────────────────────────────────────────────────────────

async function _runCycle(changedFile) {
  if (_pendingRun) return;
  _pendingRun = true;

  _ensureDir();
  const cycleId = `cycle-${Date.now()}`;
  const record  = { cycleId, changedFile, url: _state.url, stages: {}, timestamp: new Date().toISOString() };
  const save    = () => { try { fs.writeFileSync(path.join(OBS_DIR, `${cycleId}.json`), JSON.stringify(record, null, 2)); } catch {} };
  save();

  try {
    // 1. Screenshot
    let screenshot = null;
    if (_state.url) {
      try {
        const capSvc = require("./visualCaptureService.cjs");
        const shotR  = await capSvc.captureViewport({ url: _state.url, width: 1440, height: 900 });
        record.stages.screenshot = { ok: shotR.ok, filename: shotR.filename };
        screenshot = shotR.filename;
      } catch (e) { record.stages.screenshot = { ok: false, error: e.message }; }
    }
    save();

    // 2. DOM analysis
    let domFilename = null;
    if (_state.url) {
      try {
        const domSvc = require("./domAnalyzerService.cjs");
        const domR   = await domSvc.analyzePage({ url: _state.url });
        record.stages.dom = { ok: domR.ok, nodeCount: domR.nodeCount, filename: domR.filename };
        domFilename = domR.filename;
      } catch (e) { record.stages.dom = { ok: false, error: e.message }; }
    }
    save();

    // 3. Layout analysis
    if (domFilename) {
      try {
        const layoutSvc = require("./layoutGraphService.cjs");
        const layR      = await layoutSvc.analyzeLayout({ domFilename });
        record.stages.layout = { ok: layR.ok, findings: layR.findings?.length };
      } catch (e) { record.stages.layout = { ok: false, error: e.message }; }
      save();
    }

    // 4. Visual regression
    if (_state.url) {
      try {
        const regSvc = require("./visualRegressionEngine.cjs");
        const regR   = await regSvc.runRegression({ url: _state.url, baselineFilename: _state.baseline, label: `observer-${cycleId}` });
        record.stages.regression = { ok: regR.ok, passed: regR.diff?.passed, changedPct: regR.diff?.changedPct };
        // First run: save as baseline
        if (!_state.baseline && regR.ok) _state.baseline = regR.afterFilename;
      } catch (e) { record.stages.regression = { ok: false, error: e.message }; }
      save();
    }

    // 5. UX audit
    if (domFilename) {
      try {
        const uxSvc = require("./uxOptimizerService.cjs");
        const uxR   = await uxSvc.analyzeUX({ domFilename });
        record.stages.ux = { ok: uxR.ok, uxScore: uxR.uxScore, issues: uxR.issues?.length };
      } catch (e) { record.stages.ux = { ok: false, error: e.message }; }
      save();
    }

    // 6. Accessibility
    if (_state.url) {
      try {
        const a11ySvc = require("./accessibilityAuditor.cjs");
        const a11yR   = await a11ySvc.auditPage({ url: _state.url });
        record.stages.accessibility = { ok: a11yR.ok, errors: a11yR.stats?.errors, warnings: a11yR.stats?.warnings };
      } catch (e) { record.stages.accessibility = { ok: false, error: e.message }; }
      save();
    }

    // 7. Patch suggestions (from layout findings)
    const layoutFindings = record.stages.layout?.findings || 0;
    record.stages.suggestions = {
      ok:    true,
      count: layoutFindings,
      note:  layoutFindings > 0 ? `${layoutFindings} layout issues found — run POST /odi/patches/generate to create patches` : "No layout issues",
    };

  } catch (e) {
    record.error = e.message;
  }

  record.completedAt = new Date().toISOString();
  _state.cycleCount++;
  _state.lastCycle = record;
  save();
  _pendingRun = false;
  return record;
}

// ── Watcher ───────────────────────────────────────────────────────────────────

function start({ url, watchDir } = {}) {
  if (_watcher) return { ok: false, error: "Observer already running" };

  const dir = watchDir || FRONTEND_SRC;
  if (!fs.existsSync(dir)) return { ok: false, error: `Watch directory not found: ${dir}` };

  _state = { running: true, cycleCount: 0, lastCycle: null, url, baseline: null, startedAt: new Date().toISOString() };

  _watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    const ext = path.extname(filename);
    if (![".jsx", ".tsx", ".js", ".ts", ".css"].includes(ext)) return;

    // Debounce: wait for file writes to settle
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      _runCycle(filename).catch(() => {});
    }, DEBOUNCE_MS);
  });

  _watcher.on("error", (e) => { _state.error = e.message; });

  return { ok: true, message: `Observer started — watching ${dir}`, url, watchDir: dir };
}

function stop() {
  if (!_watcher) return { ok: false, error: "Observer not running" };
  _watcher.close();
  _watcher = null;
  clearTimeout(_debounceTimer);
  _state.running = false;
  _state.stoppedAt = new Date().toISOString();
  return { ok: true, message: "Observer stopped", cycles: _state.cycleCount };
}

function getStatus() {
  return {
    ok:         true,
    running:    _state.running,
    cycleCount: _state.cycleCount,
    url:        _state.url,
    startedAt:  _state.startedAt,
    lastCycle:  _state.lastCycle ? { cycleId: _state.lastCycle.cycleId, timestamp: _state.lastCycle.timestamp, stages: Object.keys(_state.lastCycle.stages) } : null,
  };
}

async function runManualCycle({ url } = {}) {
  const targetUrl = url || _state.url;
  if (!targetUrl) return { ok: false, error: "url required (observer not watching a URL)" };
  const savedUrl = _state.url;
  _state.url = targetUrl;
  const result = await _runCycle("manual");
  if (!savedUrl) _state.url = null;
  return { ok: true, ...result };
}

function listCycles({ limit = 20 } = {}) {
  _ensureDir();
  return fs.readdirSync(OBS_DIR)
    .filter(f => f.endsWith(".json")).sort().reverse().slice(0, limit)
    .map(f => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(OBS_DIR, f), "utf8"));
        return { filename: f, cycleId: d.cycleId, changedFile: d.changedFile, stages: Object.keys(d.stages || {}), timestamp: d.timestamp };
      } catch { return null; }
    }).filter(Boolean);
}

module.exports = { start, stop, getStatus, runManualCycle, listCycles };
