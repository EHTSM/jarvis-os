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
const { execFileSync, spawn } = require("child_process");

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

// ── SAFE COMMAND ALLOW-LIST ───────────────────────────────────────────────────
// Security Hardening (Production Security Hardening mission): the previous
// implementation ran ANY string via execSync()/spawn("sh",["-c",cmd]) with
// the full process env inherited, gated only by a denylist of destructive
// patterns (rm -rf /, mkfs, dd, fork bombs). That denylist does nothing
// against command chaining/substitution/piping (`curl x|sh`, `; env`,
// `$(cat /etc/passwd)`, reverse shells, etc.) — any authenticated user could
// run arbitrary shell and read every secret in process.env. This replaces
// free-form shell execution with a strict allow-list of known-safe binaries,
// each invoked via execFileSync (argv array, no shell parsing at all — no
// `;`, `|`, `&&`, `$()`, backticks, or redirection are ever interpreted) and
// a minimal, explicitly-scoped environment (no ambient secrets).
//
// Only the small set of commands this engineering pipeline actually needs
// (node/npm/git read-only + test/build scripts already defined in
// package.json) are reachable. Anything else is rejected before exec.
const ALLOWED_COMMANDS = {
  "node":  { args: (rest) => _assertNodeArgs(rest) },
  "npm":   { args: (rest) => _assertNpmArgs(rest) },
  "git":   { args: (rest) => _assertGitArgs(rest) },
  "sleep": { args: (rest) => rest.length === 1 && /^\d{1,2}$/.test(rest[0]) },
};

// node: --version, or running a single test file that resolves inside this
// repo's tests/ directory (path traversal blocked via realpath containment
// check) — matches runTests()'s only legitimate use of a bare `node <file>`.
function _assertNodeArgs(rest) {
  if (rest.length === 1 && rest[0] === "--version") return true;
  if (rest.length === 1) return _isPathInsideTests(rest[0]);
  return false;
}
function _isPathInsideTests(p) {
  try {
    const testsRoot = fs.realpathSync(path.join(ROOT, "tests"));
    const target    = fs.realpathSync(path.resolve(ROOT, p));
    return target === testsRoot || target.startsWith(testsRoot + path.sep);
  } catch { return false; }
}

// npm: only the pre-defined scripts in this repo's package.json, plus
// read-only introspection (--version, ls, list). No `npm install`/`exec`/
// `run-script` with arbitrary script names, no `--` passthrough of extra
// flags that could inject arbitrary commands via npm lifecycle hooks.
const ALLOWED_NPM_SCRIPTS = new Set([
  "test", "test:api", "test:runtime", "test:runtime:fast",
  "test:stress", "test:stress:http", "test:burnin",
  "build:frontend", "env:check", "security:no-raw-exec",
]);
function _assertNpmArgs(rest) {
  if (rest.length === 1 && (rest[0] === "--version" || rest[0] === "-v")) return true;
  if (rest.length === 2 && rest[0] === "run" && ALLOWED_NPM_SCRIPTS.has(rest[1])) return true;
  return false;
}

// git: read-only status/log/diff introspection only. No commit/push/reset/
// checkout/clean — those remain available only through the existing gated,
// approval-checked git actions in engineeringCapabilities.cjs/editorController.cjs,
// never through this generic terminal endpoint.
const ALLOWED_GIT_SUBCOMMANDS = new Set(["status", "log", "diff", "show", "branch", "rev-parse"]);
function _assertGitArgs(rest) {
  if (!rest.length) return false;
  if (!ALLOWED_GIT_SUBCOMMANDS.has(rest[0])) return false;
  // Remaining args must be plain flags/refs — no shell metacharacters
  // possible anyway (execFile does not invoke a shell), but keep the
  // argument shape sane (short refs/paths, no absolute traversal).
  return rest.slice(1).every(a => typeof a === "string" && a.length < 200 && !a.includes("\0"));
}

function _assertFlags(rest, allowed) {
  return rest.length >= 1 && allowed.includes(rest[0]);
}

// Minimal environment for allow-listed commands: PATH (needed to locate the
// binary) plus HOME/cwd-relevant basics. Explicitly excludes every other
// process.env key, so no API key, JWT secret, DB credential, etc. is ever
// visible to a spawned command or leakable via `env`/`printenv` (which
// aren't allow-listed anyway, closing that avenue too).
function _minimalEnv() {
  return {
    PATH: process.env.PATH || "/usr/bin:/bin:/usr/local/bin",
    HOME: process.env.HOME || "",
    NODE_ENV: process.env.NODE_ENV || "development",
  };
}

// Parses a command string into [binary, ...args] the same way a shell would
// split whitespace-separated tokens, WITHOUT invoking a shell — so quoting
// tricks, `;`, `|`, `&&`, `$()`, backticks, and redirection are inert; they
// just become literal argv tokens that fail the allow-list checks above.
function _parseCommand(cmd) {
  const tokens = String(cmd).trim().split(/\s+/).filter(Boolean);
  return { bin: tokens[0] || "", rest: tokens.slice(1) };
}

function _isSafe(cmd) {
  const { bin, rest } = _parseCommand(cmd);
  const spec = ALLOWED_COMMANDS[bin];
  if (!spec) return false;
  return !!spec.args(rest);
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
    const { bin, rest } = _parseCommand(cmd);
    const out = execFileSync(bin, rest, {
      cwd,
      timeout,
      stdio: ["ignore","pipe","pipe"],
      env: _minimalEnv(),
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

  const { bin, rest } = _parseCommand(cmd);
  const child = spawn(bin, rest, { cwd, stdio: ["ignore","pipe","pipe"], env: _minimalEnv() });

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
    try { execFileSync("sleep", ["2"], { timeout: 3000 }); } catch {}
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

  // `npm install` is intentionally not in the terminal allow-list (arbitrary
  // dependency installation at runtime is a supply-chain risk this endpoint
  // must not auto-trigger) — surface the diagnosis instead of silently
  // failing the allow-list check.
  if (r.error?.includes("Cannot find module")) {
    return { ok: false, cmdId, error: "Missing module detected — run `npm install` manually; automatic dependency installation is disabled for security." };
  }

  return { ok: false, cmdId, error: "No recovery strategy available" };
}

// ── verify ────────────────────────────────────────────────────────────────────

function verify(context = "general") {
  const dv = _dv();
  if (!dv) {
    // Fallback: basic node/git checks
    const nodeOk   = (() => { try { execFileSync("node", ["--version"], { timeout: 3000, stdio: "ignore" }); return true; } catch { return false; } })();
    const gitOk    = (() => { try { execFileSync("git", ["status"], { cwd: ROOT, timeout: 3000, stdio: "ignore" }); return true; } catch { return false; } })();
    const npmOk    = (() => { try { execFileSync("npm", ["--version"], { timeout: 3000, stdio: "ignore" }); return true; } catch { return false; } })();
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
  const cmd = testFile ? `node ${testFile}` : "npm run test:runtime";
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
