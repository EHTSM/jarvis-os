"use strict";

// Git operations adapter with strict read/write separation.
// Read-only subcommands work by default; write subcommands require explicit writeAllowed flag.

const { spawn } = require("child_process");
const sandboxPolicy = require("./adapterSandboxPolicyEngine.cjs");

const ADAPTER_TYPE    = "git";
const DEFAULT_TIMEOUT = 20000;

const READ_SUBCOMMANDS = new Set([
  "status", "log", "diff", "branch", "show", "remote", "rev-parse",
  "ls-files", "describe", "shortlog", "stash", "tag", "config",
  "cat-file", "show-ref", "for-each-ref", "blame",
]);

const WRITE_SUBCOMMANDS = new Set([
  "add", "commit", "checkout", "switch", "merge", "pull", "push",
  "reset", "restore", "rebase", "cherry-pick", "revert",
  "fetch", "init", "clone",
]);

// Args that are globally blocked even for allowed subcommands
const BLOCKED_ARGS = new Set(["--exec", "--upload-pack", "--receive-pack"]);

let _counter  = 0;
let _receipts = new Map();

function _spawnGit(args, { repoPath = process.cwd(), timeoutMs = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "";
    let settled = false;

    const child = spawn("git", args, {
      cwd:   repoPath,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGTERM"); } catch (_) {}
      resolve({ ok: false, stdout, stderr, exitCode: null, timedOut: true });
    }, timeoutMs);

    child.stdout.on("data", d => { stdout += d.toString(); });
    child.stderr.on("data", d => { stderr += d.toString(); });

    child.on("error", err => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr + err.message, exitCode: 1, timedOut: false });
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code, timedOut: false });
    });
  });
}

function _receipt(subcommand, args, result, meta = {}) {
  const r = Object.freeze({
    receiptId:   `gitr-${++_counter}`,
    adapterType: ADAPTER_TYPE,
    subcommand, args: [...args],
    status:   result.ok ? "completed" : result.blocked ? "blocked" : result.timedOut ? "timeout" : "failed",
    stdout:   result.stdout ?? "",
    stderr:   result.stderr ?? "",
    exitCode: result.exitCode ?? null,
    timedOut: result.timedOut ?? false,
    blocked:  result.blocked ?? false,
    reason:   result.reason ?? null,
    timestamp: new Date().toISOString(),
    ...meta,
  });
  _receipts.set(r.receiptId, r);
  return r;
}

// Validate a git subcommand + args before execution
function validateOperation(subcommand, args = [], { writeAllowed = false } = {}) {
  if (!subcommand) return { valid: false, reason: "missing_subcommand" };

  const isRead  = READ_SUBCOMMANDS.has(subcommand);
  const isWrite = WRITE_SUBCOMMANDS.has(subcommand);

  if (!isRead && !isWrite) return { valid: false, reason: `unknown_subcommand: ${subcommand}` };
  if (isWrite && !writeAllowed) return { valid: false, reason: "write_subcommand_requires_write_allowed" };

  // Check blocked args
  for (const arg of args) {
    if (BLOCKED_ARGS.has(arg)) return { valid: false, reason: `blocked_arg: ${arg}` };
  }

  return { valid: true, subcommand, isWrite };
}

async function execute({
  subcommand,
  args        = [],
  repoPath    = process.cwd(),
  timeoutMs   = DEFAULT_TIMEOUT,
  writeAllowed = false,
  executionId = null,
} = {}) {
  executionId = executionId ?? `git-${_counter + 1}`;

  const validation = validateOperation(subcommand, args, { writeAllowed });
  if (!validation.valid) {
    return _receipt(subcommand, args, { ok: false, blocked: true, reason: validation.reason,
      stdout: "", stderr: "", exitCode: null });
  }

  const result = await _spawnGit([subcommand, ...args], { repoPath, timeoutMs });
  return _receipt(subcommand, args, result, { executionId });
}

// Convenience read-only wrappers
function status(repoPath = process.cwd()) {
  return execute({ subcommand: "status", args: ["--short"], repoPath });
}

function log(repoPath = process.cwd(), { n = 10, format = "--oneline" } = {}) {
  return execute({ subcommand: "log", args: [`-${n}`, format], repoPath });
}

function diff(repoPath = process.cwd(), args = []) {
  return execute({ subcommand: "diff", args, repoPath });
}

function currentBranch(repoPath = process.cwd()) {
  return execute({ subcommand: "rev-parse", args: ["--abbrev-ref", "HEAD"], repoPath });
}

function getReceipt(receiptId) {
  const r = _receipts.get(receiptId);
  return r ? { found: true, ...r } : { found: false };
}

function getAdapterMetrics() {
  const statusCount = {};
  for (const [, r] of _receipts) statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
  return {
    adapterType:    ADAPTER_TYPE,
    totalOps:       _receipts.size,
    statusDistribution: statusCount,
    readSubcommands:  READ_SUBCOMMANDS.size,
    writeSubcommands: WRITE_SUBCOMMANDS.size,
  };
}

function reset() {
  _counter  = 0;
  _receipts = new Map();
}

module.exports = {
  validateOperation, execute, status, log, diff, currentBranch,
  getReceipt, getAdapterMetrics, reset,
  READ_SUBCOMMANDS:  Array.from(READ_SUBCOMMANDS),
  WRITE_SUBCOMMANDS: Array.from(WRITE_SUBCOMMANDS),
  ADAPTER_TYPE, DEFAULT_TIMEOUT,
};
