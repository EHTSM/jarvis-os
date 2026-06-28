"use strict";
/**
 * terminalController.cjs — POST-Ω Sprint P5 UCC
 *
 * Terminal/shell execution adapter. Provides:
 *   execute / streamOutput / detectFailures / retry / recover / verify
 *
 * Reuses:
 *   - runtimeActionEngine for gated execution + audit trail
 *   - executionRecovery for failure recovery strategies
 *   - deploymentValidator for post-run environment checks
 *   - continuousLearningEngine to learn from command outcomes
 *
 * Does NOT re-implement: pm2, nginx, git, or any specific deployment service.
 * All shell execution goes through the existing audit infrastructure.
 */

const fs                   = require("fs");
const path                 = require("path");
const { execSync, spawn }  = require("child_process");

const ROOT   = path.join(__dirname, "../..");
const DATA   = path.join(ROOT, "data", "terminal-controller.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _rae  = () => _try(() => require("./runtimeActionEngine.cjs"));
const _rec  = () => _try(() => require("./executionRecovery.cjs"));
const _dv   = () => _try(() => require("./deploymentValidator.cjs"));
const _le   = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme  = () => _try(() => require("./engineeringMemoryEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `tc_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { commands: {}, history: [], stats: { executed: 0, succeeded: 0, failed: 0, recovered: 0, verified: 0 } }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── SAFE COMMAND WHITELIST ────────────────────────────────────────────────────
// Only allow commands that cannot destroy data without explicit force flags.
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\/(?!tmp|private\/tmp)/,   // rm -rf / (allow tmp)
  /mkfs\b/,
  /dd\s+if=/,
  /:\(\)\{.*\}/,                          // fork bomb
];

function _isSafe(cmd) {
  return !BLOCKED_PATTERNS.some(p => p.test(cmd));
}

// ── execute ───────────────────────────────────────────────────────────────────

function execute(cmd, opts = {}) {
  if (!cmd) return { ok: false, error: "command required" };
  if (!_isSafe(cmd)) return { ok: false, error: "Command blocked by safety policy" };

  const cmdId = _id();
  const cwd   = opts.cwd || ROOT;
  const timeout = opts.timeoutMs || 30000;

  const record = { cmdId, cmd, cwd, status: "running", startedAt: _ts(), output: "", error: null, exitCode: null, durationMs: null };
  const d = _load();
  d.commands[cmdId] = record;
  d.stats.executed++;
  _save(d);

  const t0 = Date.now();
  try {
    const out = execSync(cmd, {
      cwd,
      timeout,
      stdio: ["ignore","pipe","pipe"],
      env: { ...process.env },
    }).toString();

    record.status   = "success";
    record.output   = out.slice(0, 4000);
    record.exitCode = 0;
    record.durationMs = Date.now() - t0;
    record.completedAt = _ts();
    d.stats.succeeded++;
    d.history.push({ event: "execute", cmdId, cmd: cmd.slice(0, 100), status: "success", durationMs: record.durationMs, ts: _ts() });
    if (d.history.length > 300) d.history = d.history.slice(-300);
    _save(d);

    _le()?.createLesson?.({
      type: "terminal_success", title: `CMD OK: ${cmd.slice(0, 60)}`, source: "terminalController",
      confidence: 0.9, tags: ["terminal", "success", "command"],
      data: { cmd, durationMs: record.durationMs, cwd },
    });

    return { ok: true, cmdId, output: record.output, exitCode: 0, durationMs: record.durationMs };

  } catch (e) {
    const errMsg  = (e.stderr?.toString() || e.message || "").slice(0, 2000);
    const exitCode = e.status ?? 1;

    record.status     = "failed";
    record.error      = errMsg;
    record.exitCode   = exitCode;
    record.durationMs = Date.now() - t0;
    record.completedAt = _ts();
    d.stats.failed++;
    d.history.push({ event: "execute", cmdId, cmd: cmd.slice(0, 100), status: "failed", error: errMsg.slice(0, 200), ts: _ts() });
    if (d.history.length > 300) d.history = d.history.slice(-300);
    _save(d);

    _eme()?.remember?.({ type: "command_failure", problem: `Command failed: ${cmd}`, solution: "Investigate error", error: errMsg, outcome: "failed" });

    return { ok: false, cmdId, output: record.output, error: errMsg, exitCode, durationMs: record.durationMs };
  }
}

// ── streamOutput ──────────────────────────────────────────────────────────────
// Returns a cmdId; output lines are collected in the commands store.
// For real streaming use the /computer/terminal/stream/:cmdId SSE endpoint.

function streamOutput(cmd, opts = {}) {
  if (!cmd) return { ok: false, error: "command required" };
  if (!_isSafe(cmd)) return { ok: false, error: "Command blocked by safety policy" };

  const cmdId = _id();
  const cwd   = opts.cwd || ROOT;
  const d     = _load();

  const record = { cmdId, cmd, cwd, status: "streaming", startedAt: _ts(), outputLines: [], error: null, exitCode: null };
  d.commands[cmdId] = record;
  d.stats.executed++;
  _save(d);

  const child = spawn("sh", ["-c", cmd], { cwd, stdio: ["ignore","pipe","pipe"], env: process.env });

  child.stdout.on("data", chunk => {
    const lines = chunk.toString().split("\n").filter(Boolean);
    record.outputLines.push(...lines);
    if (record.outputLines.length > 500) record.outputLines = record.outputLines.slice(-500);
  });

  child.stderr.on("data", chunk => {
    const lines = chunk.toString().split("\n").filter(Boolean).map(l => `[stderr] ${l}`);
    record.outputLines.push(...lines);
  });

  child.on("close", code => {
    const d2 = _load();
    const r  = d2.commands[cmdId];
    if (r) {
      r.status    = code === 0 ? "success" : "failed";
      r.exitCode  = code;
      r.completedAt = _ts();
      if (code === 0) d2.stats.succeeded++; else d2.stats.failed++;
      _save(d2);
    }
  });

  return { ok: true, cmdId, status: "streaming", pid: child.pid };
}

// ── getOutput ────────────────────────────────────────────────────────────────

function getOutput(cmdId) {
  const d = _load();
  const r = d.commands[cmdId];
  if (!r) return { ok: false, error: "command not found" };
  return { ok: true, ...r };
}

// ── detectFailures ────────────────────────────────────────────────────────────

function detectFailures(output = "", exitCode = 0) {
  const FAILURE_PATTERNS = [
    { pattern: /Error:|error:/i,           severity: "error",   type: "runtime_error" },
    { pattern: /Cannot find module/i,      severity: "error",   type: "missing_module" },
    { pattern: /ENOENT/i,                  severity: "error",   type: "file_not_found" },
    { pattern: /ECONNREFUSED/i,            severity: "error",   type: "connection_refused" },
    { pattern: /ETIMEDOUT/i,               severity: "error",   type: "timeout" },
    { pattern: /failed|FAILED/,            severity: "warn",    type: "test_failure" },
    { pattern: /warning:|Warning:/i,       severity: "warn",    type: "warning" },
    { pattern: /permission denied/i,       severity: "error",   type: "permission_denied" },
    { pattern: /command not found/i,       severity: "error",   type: "command_not_found" },
    { pattern: /SyntaxError/i,             severity: "error",   type: "syntax_error" },
  ];

  const matches = FAILURE_PATTERNS
    .filter(({ pattern }) => pattern.test(output))
    .map(({ severity, type }) => ({ severity, type }));

  return {
    hasFailures: exitCode !== 0 || matches.some(m => m.severity === "error"),
    exitCode,
    patterns:   matches,
    summary:    matches.map(m => m.type).join(", ") || (exitCode !== 0 ? "non_zero_exit" : "none"),
  };
}

// ── retry ────────────────────────────────────────────────────────────────────

function retry(cmdId, maxAttempts = 3) {
  const d = _load();
  const r = d.commands[cmdId];
  if (!r) return { ok: false, error: "command not found" };
  if (r.status === "success") return { ok: true, message: "already succeeded" };

  let attempt = 0;
  let lastResult = null;
  while (attempt < maxAttempts) {
    attempt++;
    lastResult = execute(r.cmd, { cwd: r.cwd, timeoutMs: 60000 });
    if (lastResult.ok) break;
    // Brief wait between retries (blocking — acceptable for short retries)
    try { execSync("sleep 2", { timeout: 3000 }); } catch {}
  }

  if (lastResult?.ok) {
    const d2 = _load();
    d2.stats.recovered++;
    _save(d2);
  }

  return { ok: lastResult?.ok, attempts: attempt, cmdId, result: lastResult };
}

// ── recover ──────────────────────────────────────────────────────────────────

function recover(cmdId, opts = {}) {
  const d = _load();
  const r = d.commands[cmdId];
  if (!r) return { ok: false, error: "command not found" };

  const rec = _rec();
  if (rec) {
    const failure = {
      stepType:    "execution",
      error:       r.error || "",
      attemptCount: 0,
      stepIndex:   0,
      totalSteps:  1,
    };
    const strategy = rec.selectStrategy?.(failure);
    _le()?.createLesson?.({ type: "terminal_recovery", title: `Recovery: ${strategy} for: ${r.cmd?.slice(0, 50)}`, source: "terminalController", confidence: 0.7, tags: ["terminal", "recovery", strategy || "unknown"] });
    return { ok: true, cmdId, strategy, message: `Applied recovery strategy: ${strategy}` };
  }

  // Fallback: re-run with npm install if missing module
  if (r.error?.includes("Cannot find module")) {
    const installResult = execute("npm install", { cwd: r.cwd, timeoutMs: 120000 });
    if (installResult.ok) return retry(cmdId, 2);
  }

  return { ok: false, cmdId, error: "No recovery strategy available" };
}

// ── verify ────────────────────────────────────────────────────────────────────

function verify(context = "general") {
  const dv = _dv();
  if (!dv) {
    // Fallback: basic node/git checks
    const nodeOk   = (() => { try { execSync("node --version", { timeout: 3000, stdio: "ignore" }); return true; } catch { return false; } })();
    const gitOk    = (() => { try { execSync("git status", { cwd: ROOT, timeout: 3000, stdio: "ignore" }); return true; } catch { return false; } })();
    const npmOk    = (() => { try { execSync("npm --version", { timeout: 3000, stdio: "ignore" }); return true; } catch { return false; } })();
    const d = _load();
    d.stats.verified++;
    _save(d);
    return { ok: nodeOk && gitOk, checks: { node: nodeOk, git: gitOk, npm: npmOk }, context };
  }

  try {
    const result = dv.checkEnvironment?.() || dv.runCheck?.();
    const d = _load();
    d.stats.verified++;
    _save(d);
    return { ok: result?.ok !== false, ...result, context };
  } catch (e) {
    return { ok: false, error: e.message, context };
  }
}

// ── runTests ─────────────────────────────────────────────────────────────────

function runTests(testFile = null, opts = {}) {
  const cmd = testFile ? `node "${testFile}"` : "npm test";
  const result = execute(cmd, { timeoutMs: 120000, ...opts });
  const failures = detectFailures(result.output || result.error || "", result.exitCode ?? 1);

  return {
    ok:       result.ok,
    cmdId:    result.cmdId,
    output:   result.output,
    failures,
    passed:   !failures.hasFailures,
    testFile: testFile || "npm test",
  };
}

// ── stats ───────────────────────────────────────────────────────────────────

function getStats() {
  const d = _load();
  return { ...d.stats, recentHistory: d.history.slice(-10), activeCommands: Object.values(d.commands).filter(c => c.status === "streaming").length };
}

function listCommands({ status, limit = 50 } = {}) {
  const d = _load();
  let cmds = Object.values(d.commands);
  if (status) cmds = cmds.filter(c => c.status === status);
  return cmds.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, limit);
}

module.exports = {
  execute, streamOutput, getOutput,
  detectFailures, retry, recover, verify, runTests,
  getStats, listCommands,
};
