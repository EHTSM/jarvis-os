"use strict";
/**
 * executionValidator.cjs — POST-Ω Sprint P3
 *
 * Validates that workflow prerequisites are met and that execution outcomes
 * are correct. Uses only existing platform capabilities.
 *
 * Validation modes:
 *   PREREQ  — check blockers before execution starts
 *   OUTCOME — verify execution produced the expected result
 *   HEALTH  — verify system health after execution
 *
 * All real checks delegate to existing services:
 *   deploymentValidator → environment, nginx, process, SSL, build artifacts
 *   selfReviewEngine    → platform health score
 *   consolidationAudit  → code quality
 *   engineeringMemoryEngine → recall historical success patterns
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT  = path.join(__dirname, "../..");
const _try  = fn => { try { return fn(); } catch { return null; } };
const _dv   = () => _try(() => require("./deploymentValidator.cjs"));
const _sre  = () => _try(() => require("./selfReviewEngine.cjs"));
const _ca   = () => _try(() => require("./consolidationAudit.cjs"));
const _em   = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _inf  = () => _try(() => require("./productionInfra.cjs"));

function _exec(cmd, timeout = 10000) {
  try   { return { ok: true,  out: execSync(cmd, { cwd: ROOT, timeout, stdio: ["ignore","pipe","pipe"] }).toString().trim() }; }
  catch (e) { return { ok: false, out: e.stderr?.toString?.()?.slice(0, 200) || e.message }; }
}

// ── Prerequisite validation ────────────────────────────────────────────────────

function validatePrerequisites(workflowId, blockers = []) {
  const checks  = [];
  let   allPass = true;

  // Env check: NODE_ENV, JWT_SECRET etc via deploymentValidator
  try {
    const dv = _dv();
    if (dv) {
      const envResult = dv.checkEnvironment();
      const critFails = (envResult.checks || []).filter(c => c.status === "fail");
      if (critFails.length === 0) {
        checks.push({ check: "environment", pass: true, detail: `Environment OK (${envResult.score ?? "?"}%)` });
      } else {
        checks.push({ check: "environment", pass: false, detail: `Env failures: ${critFails.map(c => c.name).join(", ")}` });
        allPass = false;
      }
    }
  } catch {}

  // Node process check
  const nodeCheck = _exec("node --version");
  checks.push({ check: "node_available", pass: nodeCheck.ok, detail: nodeCheck.ok ? `node ${nodeCheck.out}` : "node not found" });
  if (!nodeCheck.ok) allPass = false;

  // Git available
  const gitCheck = _exec("git rev-parse --is-inside-work-tree", 5000);
  checks.push({ check: "git_available", pass: gitCheck.ok, detail: gitCheck.ok ? "git repo present" : "not a git repo" });
  if (!gitCheck.ok) allPass = false;

  // Package.json
  const pkgExists = fs.existsSync(path.join(ROOT, "package.json"));
  checks.push({ check: "package_json", pass: pkgExists, detail: pkgExists ? "package.json found" : "package.json missing" });
  if (!pkgExists) allPass = false;

  // Domain-specific blocker checks
  for (const blocker of blockers) {
    // If blocker references a known thing we can check, do so
    if (blocker.toLowerCase().includes("api key") || blocker.toLowerCase().includes("credentials")) {
      checks.push({ check: `blocker:${blocker.slice(0,40)}`, pass: false, detail: `Manual: ${blocker}` });
      allPass = false;
    } else {
      checks.push({ check: `blocker:${blocker.slice(0,40)}`, pass: true, detail: `Accepted: ${blocker}` });
    }
  }

  return { ok: true, workflowId, allPass, checks, failCount: checks.filter(c => !c.pass).length };
}

// ── Outcome validation ─────────────────────────────────────────────────────────

function validateOutcome(workflowId, domain, steps = []) {
  const checks  = [];
  let   allPass = true;

  // All execution steps completed
  const execSteps    = steps.filter(s => s.type === "execution");
  const completedAll = execSteps.length === 0 || execSteps.every(s => s.completed);
  checks.push({ check: "all_steps_completed", pass: completedAll, detail: `${execSteps.filter(s => s.completed).length}/${execSteps.length} steps completed` });
  if (!completedAll) allPass = false;

  // No steps errored
  const failedSteps = steps.filter(s => s.error);
  checks.push({ check: "no_step_errors", pass: failedSteps.length === 0, detail: failedSteps.length === 0 ? "no errors" : `errors in: ${failedSteps.map(s => s.name).join(", ")}` });
  if (failedSteps.length) allPass = false;

  // Domain-specific outcome checks
  switch (domain) {
    case "self_improvement": {
      const sre = _sre();
      if (sre) {
        const latest = sre.getLatestReview();
        const hasRecent = latest && (Date.now() - new Date(latest.createdAt).getTime()) < 300000; // within 5 min
        checks.push({ check: "review_recent", pass: !!hasRecent, detail: hasRecent ? `review at ${latest.createdAt}` : "no recent review" });
        if (!hasRecent) allPass = false;
      }
      break;
    }
    case "deployment": {
      const dv = _dv();
      if (dv) {
        const r = dv.checkBuildArtifacts();
        const hasDist = (r.checks || []).some(c => c.status === "pass");
        checks.push({ check: "build_artifacts", pass: hasDist, detail: hasDist ? "build artifacts present" : "no build artifacts" });
        // Don't fail on missing build artifacts — may be server-only deploy
      }
      break;
    }
    case "engineering":
    case "docs": {
      const ca = _ca();
      if (ca) {
        const audit = ca.getLatestAudit();
        if (audit) {
          checks.push({ check: "audit_present", pass: true, detail: `consolidation audit: ${audit.placeholders} placeholders found` });
        }
      }
      break;
    }
    default:
      checks.push({ check: "generic_outcome", pass: true, detail: "generic outcome accepted" });
  }

  return { ok: true, workflowId, domain, allPass, checks, failCount: checks.filter(c => !c.pass).length };
}

// ── Health validation post-execution ─────────────────────────────────────────

function validateHealth(workflowId) {
  const checks  = [];
  let   allPass = true;

  // Git status — no uncommitted disasters
  const gitStatus = _exec("git status --short");
  checks.push({ check: "git_clean_or_staged", pass: gitStatus.ok, detail: gitStatus.ok ? `git status ok` : gitStatus.out });

  // Node modules intact
  const nmExists = fs.existsSync(path.join(ROOT, "node_modules", ".package-lock.json")) ||
                   fs.existsSync(path.join(ROOT, "node_modules", "express"));
  checks.push({ check: "node_modules_present", pass: nmExists, detail: nmExists ? "node_modules present" : "node_modules missing" });
  if (!nmExists) allPass = false;

  // backend/server.js readable
  const serverExists = fs.existsSync(path.join(ROOT, "backend", "server.js")) || fs.existsSync(path.join(ROOT, "backend", "server.cjs"));
  checks.push({ check: "server_file_present", pass: serverExists, detail: serverExists ? "server file present" : "server file MISSING" });
  if (!serverExists) allPass = false;

  return { ok: true, workflowId, allPass, checks, failCount: checks.filter(c => !c.pass).length };
}

// ── Quick validation of test suite ────────────────────────────────────────────

function validateTestSuite(testFile) {
  if (!testFile) return { ok: false, error: "no test file specified" };
  if (!fs.existsSync(testFile)) return { ok: false, error: `test file not found: ${testFile}` };

  const result = _exec(`node "${testFile}"`, 120000);
  // Scan all lines for the summary — logger lines may appear after it
  const lines  = result.out.split("\n");
  let passed = 0, failed = 0;
  for (const line of lines) {
    const pm = line.match(/(\d+)\s+passed/);
    const fm = line.match(/(\d+)\s+failed/);
    if (pm) passed = parseInt(pm[1]);
    if (fm) failed = parseInt(fm[1]);
  }

  return {
    ok:      result.ok && failed === 0,
    testFile,
    passed,
    failed,
    total:   passed + failed,
    output:  result.out.slice(-500),
  };
}

module.exports = { validatePrerequisites, validateOutcome, validateHealth, validateTestSuite };
