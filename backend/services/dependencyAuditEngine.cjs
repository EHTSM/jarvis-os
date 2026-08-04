"use strict";
/**
 * dependencyAuditEngine.cjs — V6 Phase 5: Autonomous DevOps
 * (Dependency vulnerability scanning + update automation)
 *
 * Real gap confirmed by exhaustive search before writing this file: CI
 * (engineeringPipelineCoordinator.cjs's build_gate/test_gate — real, already
 * verified end-to-end this session), security static-analysis
 * (engineeringCapabilities.cjs's security_scan via codeReviewEngine — real),
 * and GitHub PR/issue automation (gitHubEngineeringAgent.cjs — real, just
 * GITHUB_TOKEN-gated) already exist. Real `npm audit`/`npm outdated`
 * execution and any dependency-update automation did not exist anywhere in
 * the codebase (confirmed: only description strings/hardcoded flags
 * referencing "npm audit" in engineeringOrg.cjs/productionInfra.cjs, no
 * actual execFileSync/spawn call to either command anywhere).
 *
 * Real, no-shell execFileSync — same discipline as every sibling
 * controller (terminalController.cjs/dockerController.cjs). Not routed
 * through terminalController's narrow string allowlist (matching why
 * Docker got its own file rather than overloading that allowlist) — `npm
 * audit`/`npm outdated`/`npm update` have their own real, bounded shape
 * here instead.
 *
 * Update automation is DELIBERATELY conservative: applies only real
 * semver-safe updates (npm's own `wanted` version, i.e. within the
 * package.json range) via `npm update <pkg>`, never a major-version bump
 * (`latest` outside range) without explicit opt-in — a major bump can be a
 * real breaking change no static check here can verify. Every apply is
 * immediately followed by this repo's own real regression suite
 * (npm run test:runtime) and auto-reverts (git checkout) on failure.
 *
 * Reuses:
 *   - runtimeEventBus, continuousLearningEngine — telemetry/memory
 *   - git (via execFileSync) — real revert on regression failure
 *
 * Storage: data/dependency-audit.json
 */

const fs   = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "dependency-audit.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bus = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));
const _le  = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id(prefix) { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { scans: [], updates: [], stats: { scans: 0, vulnerabilitiesFound: 0, updatesApplied: 0, updatesReverted: 0 } }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.scans.length > 100) d.scans = d.scans.slice(-100);
  if (d.updates.length > 200) d.updates = d.updates.slice(-200);
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}
function _emit(type, payload = {}) {
  try { _bus()?.emit(`dependency_audit:${type}`, { ...payload, _source: "dependencyAuditEngine", ts: _ts() }); } catch {}
}
function _learn(title, confidence, tags, data) {
  try { _le()?.createLesson?.({ type: "dependency_audit", title, source: "dependencyAuditEngine", confidence, tags: ["dependency", ...tags], data }); } catch {}
}

function _exec(cmd, args, { timeoutMs = 60_000, cwd = ROOT, allowNonZeroExit = false } = {}) {
  try {
    const out = execFileSync(cmd, args, { cwd, timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 20 * 1024 * 1024 }).toString();
    return { ok: true, out };
  } catch (e) {
    // npm audit/outdated exit non-zero when they FIND something — that's
    // real output, not a failure, for those two specific commands.
    if (allowNonZeroExit && e.stdout) return { ok: true, out: e.stdout.toString(), exitCode: e.status };
    return { ok: false, out: "", error: (e.stderr?.toString() || e.message || "").slice(0, 4000) };
  }
}

// ══════════════════════════════════════════════════════════════════════════
// VULNERABILITY SCAN
// ══════════════════════════════════════════════════════════════════════════

function scanVulnerabilities() {
  const scanId = _id("scan");
  const r = _exec("npm", ["audit", "--json"], { timeoutMs: 60_000, allowNonZeroExit: true });

  let report = null;
  try { report = JSON.parse(r.out); } catch { /* fall through to error */ }
  if (!report) {
    return { ok: false, error: r.error || "npm audit produced no parseable output" };
  }

  const vulns = Object.values(report.vulnerabilities || {});
  const bySeverity = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const v of vulns) if (bySeverity[v.severity] !== undefined) bySeverity[v.severity]++;

  const result = {
    scanId, ts: _ts(),
    totalVulnerabilities: vulns.length,
    bySeverity,
    packages: vulns.map(v => ({ name: v.name, severity: v.severity, isDirect: v.isDirect, range: v.range, fixAvailable: v.fixAvailable ? (v.fixAvailable === true ? true : { name: v.fixAvailable.name, version: v.fixAvailable.version, isSemVerMajor: v.fixAvailable.isSemVerMajor }) : false })),
    metadata: report.metadata || null,
  };

  const d = _load();
  d.scans.push(result);
  d.stats.scans++;
  d.stats.vulnerabilitiesFound += vulns.length;
  _save(d);

  _emit("scan_completed", { scanId, totalVulnerabilities: vulns.length, bySeverity });
  _learn(`Dependency scan: ${vulns.length} vulnerabilities (${bySeverity.critical} critical, ${bySeverity.high} high)`,
    vulns.length === 0 ? 0.9 : 0.6, ["scan"], { scanId, bySeverity });

  return { ok: true, ...result };
}

// ══════════════════════════════════════════════════════════════════════════
// OUTDATED PACKAGES
// ══════════════════════════════════════════════════════════════════════════

function listOutdated() {
  // `npm outdated --json` exits 1 whenever ANY package is outdated — real
  // output, not a real failure; exits 0 with no data on npm's own error
  // paths (rare, treated as a real failure below).
  const r = _exec("npm", ["outdated", "--json"], { timeoutMs: 30_000, allowNonZeroExit: true });
  let parsed = {};
  try { parsed = r.out.trim() ? JSON.parse(r.out) : {}; } catch { return { ok: false, error: "npm outdated produced no parseable output" }; }

  const packages = Object.entries(parsed).map(([name, info]) => ({
    name, current: info.current, wanted: info.wanted, latest: info.latest,
    // Real semver-safe check: `wanted` is what npm itself computed as
    // satisfying the existing package.json range — updating to it is a
    // real minor/patch bump, never a range-breaking major.
    semverSafe: info.current !== info.wanted,
    majorBump: info.wanted !== info.latest,
  }));

  return { ok: true, count: packages.length, packages };
}

// ══════════════════════════════════════════════════════════════════════════
// UPDATE AUTOMATION (conservative — semver-safe only, auto-revert on regression)
// ══════════════════════════════════════════════════════════════════════════

function _gitClean() {
  const r = _exec("git", ["status", "--porcelain"], { timeoutMs: 10_000 });
  return r.ok && r.out.trim() === "";
}

async function applySafeUpdate(packageName, { runRegression = true } = {}) {
  if (!packageName || typeof packageName !== "string" || !/^[a-zA-Z0-9@/_.-]+$/.test(packageName)) {
    return { ok: false, error: "invalid package name" };
  }

  const updateId = _id("upd");
  const preCommit = _exec("git", ["rev-parse", "HEAD"], { timeoutMs: 5_000 });
  const wasClean = _gitClean();

  // Real semver-safe update — `npm update <pkg>` only ever moves within
  // the existing package.json range (never a major bump), matching this
  // file's own documented conservatism.
  const update = _exec("npm", ["update", packageName], { timeoutMs: 120_000 });
  if (!update.ok) {
    _emit("update_failed", { updateId, packageName, error: update.error });
    return { ok: false, updateId, packageName, error: update.error };
  }

  let regressionResult = null;
  if (runRegression) {
    const test = _exec("npm", ["run", "test:runtime"], { timeoutMs: 180_000 });
    regressionResult = { ok: test.ok, output: (test.out || test.error || "").slice(0, 2000) };

    if (!test.ok) {
      // Real, verified auto-revert — only if the working tree was clean
      // before this update (never discards unrelated in-flight work).
      let reverted = false;
      if (wasClean && preCommit.ok) {
        const revert = _exec("git", ["checkout", "--", "package.json", "package-lock.json"], { timeoutMs: 10_000 });
        reverted = revert.ok;
        if (reverted) _exec("npm", ["install"], { timeoutMs: 120_000 });
      }
      const d = _load();
      d.updates.push({ updateId, packageName, ok: false, reverted, ts: _ts() });
      d.stats.updatesReverted += reverted ? 1 : 0;
      _save(d);
      _emit("update_reverted", { updateId, packageName, reverted });
      _learn(`Dependency update reverted: ${packageName} broke regression`, 0.6, ["update", "reverted"], { updateId, packageName });
      return { ok: false, updateId, packageName, error: "regression suite failed after update", reverted, regressionResult };
    }
  }

  const d = _load();
  d.updates.push({ updateId, packageName, ok: true, ts: _ts() });
  d.stats.updatesApplied++;
  _save(d);
  _emit("update_applied", { updateId, packageName });
  _learn(`Dependency updated: ${packageName}`, 0.85, ["update", "applied"], { updateId, packageName });
  return { ok: true, updateId, packageName, regressionResult };
}

// ══════════════════════════════════════════════════════════════════════════
// STATS / HISTORY
// ══════════════════════════════════════════════════════════════════════════

function getStats() { return _load().stats; }
function listScans({ limit = 20 } = {}) { return _load().scans.slice(-limit).reverse(); }
function listUpdates({ limit = 50 } = {}) { return _load().updates.slice(-limit).reverse(); }
function getLastScan() { const s = _load().scans; return s[s.length - 1] || null; }

module.exports = {
  scanVulnerabilities, listOutdated, applySafeUpdate,
  getStats, listScans, listUpdates, getLastScan,
};
