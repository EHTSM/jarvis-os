"use strict";

// Safe terminal execution with allowlist enforcement, timeout, and cancellation.
// Uses child_process.spawn with shell:false to prevent injection.

const { spawn } = require("child_process");
const sandboxPolicy = require("./adapterSandboxPolicyEngine.cjs");
const processTracker = require("./processLifecycleAdapter.cjs");

// Strip secret-bearing env vars before passing to child processes.
// Mirrors backend/core/safe-exec.js _sanitizeEnv — kept local to avoid circular dep.
const _ENV_STRIP = [/TOKEN/i, /SECRET/i, /KEY/i, /PASSWORD/i, /HASH/i,
    /CREDENTIAL/i, /API_KEY/i, /JWT/i, /AUTH/i, /COOKIE/i];
const _ENV_KEEP  = ["PATH", "HOME", "USER", "LANG", "TERM", "TZ", "NODE_ENV"];

function _sanitizeEnv(extra = {}) {
    const safe = {};
    for (const k of _ENV_KEEP) {
        if (process.env[k] !== undefined) safe[k] = process.env[k];
    }
    for (const [k, v] of Object.entries(extra)) {
        if (!_ENV_STRIP.some(p => p.test(k))) safe[k] = String(v);
    }
    return safe;
}

const ADAPTER_ID          = "terminal-adapter-1";
const ADAPTER_TYPE        = "terminal";
const DEFAULT_TIMEOUT_MS  = 15000;
const MAX_OUTPUT_BYTES    = 512 * 1024;  // 512 KB
const MAX_CONCURRENT      = 8;           // hard cap on simultaneous terminal executions

let _counter  = 0;
let _receipts = new Map();  // executionId → receipt (in-flight or completed) — capped at MAX_RECEIPTS
let _active   = new Map();
const runtimeEventBus = require('../runtimeEventBus.cjs');

// Kill-tree helper: SIGTERM → wait 3s → SIGKILL the entire process group
function _killTree(pid) {
    if (!pid) return;
    try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch {} }
    setTimeout(() => {
        try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
    }, 3000);
}

// Runaway watchdog: scan active executions every 60s, force-kill anything
// that has been running > 2× its stated timeout (absolute maximum safety net)
setInterval(() => {
    const now = Date.now();
    for (const [execId, handle] of _active) {
        const startMs  = handle.startMs || now;
        const limitMs  = (handle.timeoutMs || DEFAULT_TIMEOUT_MS) * 2;
        if (now - startMs > limitMs) {
            console.warn(`[TerminalAdapter] runaway watchdog — force-killing ${execId} (ran ${Math.round((now - startMs)/1000)}s)`);
            try { handle.forceKill?.(); } catch {}
        }
    }
}, 60_000).unref();

const MAX_RECEIPTS = 1000;  // prevent unbounded growth over long uptime
function _addReceipt(id, receipt) {
  _receipts.set(id, receipt);
  if (_receipts.size > MAX_RECEIPTS) {
    // Evict oldest entry (Map preserves insertion order)
    _receipts.delete(_receipts.keys().next().value);
  }
}

// Parse command to [executable, ...args]
function _parseCommand(command) {
  if (Array.isArray(command)) return { ok: true, executable: command[0], args: command.slice(1) };
  if (typeof command === "string") {
    const parts = command.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return { ok: false, reason: "empty_command" };
    return { ok: true, executable: parts[0], args: parts.slice(1) };
  }
  return { ok: false, reason: "invalid_command_type" };
}

// Validate command against the base allowlist + global blocked patterns
function validateCommand(command) {
  const parsed = _parseCommand(command);
  if (!parsed.ok) return { valid: false, reason: parsed.reason };

  const check = sandboxPolicy.isCommandAllowed(ADAPTER_TYPE, parsed.executable);
  if (!check.allowed) return { valid: false, reason: `command_not_allowed: ${parsed.executable}` };

  const fullCmd = typeof command === "string" ? command : command.join(" ");
  const blocked = sandboxPolicy.checkGlobalBlocked(fullCmd);
  if (blocked.blocked) return { valid: false, reason: "blocked_pattern", pattern: blocked.pattern };

  return { valid: true, executable: parsed.executable, args: parsed.args };
}

// Execute a command and return a promise resolving to ExecutionReceipt
function execute({
  executionId    = null,
  command,
  cwd            = process.cwd(),
  env            = {},
  timeoutMs      = DEFAULT_TIMEOUT_MS,
  policyId       = null,
  dryRun         = false,
} = {}) {
  const receiptId = `rcpt-${++_counter}`;
  executionId     = executionId ?? `tex-${_counter}`;

  // Max-concurrent guard — reject early rather than queue unbounded
  if (_active.size >= MAX_CONCURRENT) {
    const receipt = Object.freeze({
      receiptId: `rcpt-${++_counter}`, executionId: executionId ?? `tex-${_counter}`,
      adapterType: ADAPTER_TYPE, status: "rejected",
      reason: `max_concurrent_executions_reached (${MAX_CONCURRENT})`,
      stdout: "", stderr: "", exitCode: null,
      duration: 0, timedOut: false, cancelled: false,
      timestamp: new Date().toISOString(),
    });
    _addReceipt(executionId ?? receipt.executionId, receipt);
    return Promise.resolve(receipt);
  }

  // Validate command
  const validation = validateCommand(command);
  if (!validation.valid) {
    const receipt = Object.freeze({
      receiptId, executionId, adapterType: ADAPTER_TYPE,
      status: "blocked", reason: validation.reason,
      stdout: "", stderr: "", exitCode: null,
      duration: 0, timedOut: false, cancelled: false,
      timestamp: new Date().toISOString(),
    });
    _addReceipt(executionId, receipt);
    return Promise.resolve(receipt);
  }

  // Policy check if policy specified
  if (policyId) {
    const policyResult = sandboxPolicy.evaluateExecution(policyId, {
      command: validation.executable,
      timeoutMs,
    });
    if (!policyResult.allowed) {
      const receipt = Object.freeze({
        receiptId, executionId, adapterType: ADAPTER_TYPE,
        status: "blocked", reason: policyResult.reason,
        stdout: "", stderr: "", exitCode: null,
        duration: 0, timedOut: false, cancelled: false,
        timestamp: new Date().toISOString(),
      });
      _addReceipt(executionId, receipt);
      return Promise.resolve(receipt);
    }
    timeoutMs = Math.min(timeoutMs, policyResult.effectiveTimeoutMs);
  }

  // Dry run: validate only, don't spawn
  if (dryRun) {
    const receipt = Object.freeze({
      receiptId, executionId, adapterType: ADAPTER_TYPE,
      status: "dry_run", command: validation.executable, args: validation.args,
      stdout: "", stderr: "", exitCode: null,
      duration: 0, timedOut: false, cancelled: false,
      timestamp: new Date().toISOString(),
    });
    _addReceipt(executionId, receipt);
    return Promise.resolve(receipt);
  }

  const startMs = Date.now();
  return new Promise((resolve) => {
    let stdout  = "";
    let stderr  = "";
    let settled = false;
    let timedOut  = false;
    let cancelled = false;

    const mergedEnv = _sanitizeEnv(env);
    const child = spawn(validation.executable, validation.args, {
      cwd,
      env:   mergedEnv,
      shell: false,  // no shell — prevents injection
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Register in process tracker
    let regId = null;
    if (child.pid) {
      const reg = processTracker.registerProcess(child.pid, { executionId, adapterType: ADAPTER_TYPE,
        command: validation.executable, ttlMs: timeoutMs + 5000 });
      regId = reg.registrationId ?? null;
    }

    child.stdout.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT_BYTES) stdout = stdout.slice(-MAX_OUTPUT_BYTES);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT_BYTES) stderr = stderr.slice(-MAX_OUTPUT_BYTES);
    });

    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      _killTree(child.pid);
      settle(null);
    }, timeoutMs);

    function settle(code) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _active.delete(executionId);
      if (regId) processTracker.deregisterProcess(regId, { exitCode: code });

      const duration = Date.now() - startMs;
      const status   = cancelled ? "cancelled" : timedOut ? "timeout"
                      : code === 0  ? "completed" : "failed";

      const receipt = Object.freeze({
        receiptId, executionId, adapterType: ADAPTER_TYPE,
        status, exitCode: code, stdout: stdout.trim(), stderr: stderr.trim(),
        duration, timedOut, cancelled,
        command: validation.executable, args: validation.args,
        timestamp: new Date().toISOString(),
      });
      _addReceipt(executionId, receipt);
      resolve(receipt);
    }

    child.on("error", (err) => {
      stderr += `\nspawn error: ${err.message}`;
      settle(1);
    });
    child.on("close", (code) => settle(code ?? 1));

    // Store cancel + forceKill handles for watchdog and external cancellation
    _active.set(executionId, {
      startMs:   startMs,
      timeoutMs: timeoutMs,
      cancel: () => {
        if (settled) return;
        cancelled = true;
        _killTree(child.pid);
      },
      forceKill: () => {
        if (settled) return;
        cancelled = true;
        try { process.kill(child.pid, "SIGKILL"); } catch {}
        settle(null);
      },
    });
  });
}

// Cancel an in-flight execution
function cancel(executionId) {
  const handle = _active.get(executionId);
  if (!handle) return { cancelled: false, reason: "execution_not_active" };
  handle.cancel();
  return { cancelled: true, executionId };
}

function getReceipt(executionId) {
  const r = _receipts.get(executionId);
  if (!r) return { found: false };
  return { found: true, ...r };
}

function getActiveExecutions() {
  return Array.from(_active.keys());
}

function getAdapterMetrics() {
  const statusCount = {};
  for (const [, r] of _receipts) statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
  return {
    adapterId:    ADAPTER_ID,
    adapterType:  ADAPTER_TYPE,
    totalExecutions: _receipts.size,
    activeCount:  _active.size,
    statusDistribution: statusCount,
  };
}

function reset() {
  // Cancel active executions
  for (const [, handle] of _active) { try { handle.cancel(); } catch (_) {} }
  _counter  = 0;
  _receipts = new Map();
  _active   = new Map();
}

module.exports = {
  validateCommand, execute, cancel, getReceipt,
  getActiveExecutions, getAdapterMetrics, reset,
  ADAPTER_ID, ADAPTER_TYPE, DEFAULT_TIMEOUT_MS,
};
