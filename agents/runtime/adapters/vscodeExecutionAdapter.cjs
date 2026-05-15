"use strict";

// VS Code interaction adapter using the `code` CLI.
// Only exposes a curated set of safe VS Code operations.

const { spawn } = require("child_process");
const path = require("path");

const ADAPTER_TYPE    = "vscode";
const DEFAULT_TIMEOUT = 10000;

// Allowed VS Code CLI flags (read-only / safe)
const ALLOWED_FLAGS = new Set([
  "--version", "--list-extensions", "--status", "--help",
]);

// Allowed VS Code command IDs for --command invocation
const ALLOWED_COMMAND_IDS = new Set([
  "workbench.action.openRecent",
  "workbench.action.showAllEditors",
  "workbench.action.gotoSymbol",
  "editor.action.formatDocument",
  "workbench.view.explorer",
  "workbench.action.terminal.toggleTerminal",
]);

let _counter       = 0;
let _receipts      = new Map();
let _availability  = null;   // null = unchecked, true/false

function _spawnCode(args, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
  return new Promise((resolve) => {
    let stdout = "", stderr = "";
    let settled = false;

    const child = spawn("code", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });

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
      resolve({ ok: false, stdout, stderr: err.message, exitCode: 1, timedOut: false, spawnError: err.code });
    });
    child.on("close", code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code, timedOut: false });
    });
  });
}

function _receipt(operation, args, result, meta = {}) {
  const r = Object.freeze({
    receiptId:   `vscr-${++_counter}`,
    adapterType: ADAPTER_TYPE,
    operation, args,
    status:   result.ok ? "completed"
              : result.timedOut ? "timeout"
              : result.unavailable ? "unavailable"
              : result.blocked ? "blocked"
              : "failed",
    stdout:   result.stdout ?? "",
    stderr:   result.stderr ?? "",
    exitCode: result.exitCode ?? null,
    reason:   result.reason ?? null,
    timestamp: new Date().toISOString(),
    ...meta,
  });
  _receipts.set(r.receiptId, r);
  return r;
}

// Check if VS Code CLI is available
async function checkAvailability() {
  const result = await _spawnCode(["--version"], { timeoutMs: 5000 });
  _availability = result.ok;
  return { available: result.ok, version: result.ok ? result.stdout.split("\n")[0] : null };
}

function isAvailable() {
  return _availability === true;
}

// Validate a VS Code CLI flag operation
function validateFlag(flag) {
  if (!ALLOWED_FLAGS.has(flag)) return { valid: false, reason: `flag_not_allowed: ${flag}` };
  return { valid: true };
}

// Run `code --version` or `code --list-extensions` etc.
async function runFlag(flag) {
  const v = validateFlag(flag);
  if (!v.valid) return _receipt("flag", [flag], { ok: false, blocked: true, reason: v.reason });

  if (_availability === false) return _receipt("flag", [flag], { ok: false, unavailable: true, reason: "vscode_not_available" });

  const result = await _spawnCode([flag]);
  return _receipt("flag", [flag], result);
}

// Open a file in VS Code (fire-and-forget; VS Code opens in background)
async function openFile(filePath) {
  if (!filePath) return _receipt("open_file", [], { ok: false, blocked: true, reason: "missing_file_path" });
  if (_availability === false) return _receipt("open_file", [filePath], { ok: false, unavailable: true, reason: "vscode_not_available" });

  // Resolve to absolute path for safety
  const abs = path.resolve(filePath);
  const result = await _spawnCode([abs], { timeoutMs: 5000 });
  return _receipt("open_file", [abs], result);
}

// Open a diff between two files
async function openDiff(fileA, fileB) {
  if (!fileA || !fileB) return _receipt("diff", [], { ok: false, blocked: true, reason: "missing_file_paths" });
  if (_availability === false) return _receipt("diff", [], { ok: false, unavailable: true, reason: "vscode_not_available" });

  const absA = path.resolve(fileA);
  const absB = path.resolve(fileB);
  const result = await _spawnCode(["--diff", absA, absB], { timeoutMs: 5000 });
  return _receipt("diff", [absA, absB], result);
}

// Run an allowed VS Code command via --command
async function runCommand(commandId) {
  if (!ALLOWED_COMMAND_IDS.has(commandId))
    return _receipt("command", [commandId], { ok: false, blocked: true, reason: `command_not_allowed: ${commandId}` });
  if (_availability === false) return _receipt("command", [commandId], { ok: false, unavailable: true, reason: "vscode_not_available" });

  const result = await _spawnCode(["--command", commandId], { timeoutMs: DEFAULT_TIMEOUT });
  return _receipt("command", [commandId], result);
}

// List installed extensions (read-only introspection)
async function listExtensions() {
  return runFlag("--list-extensions");
}

function getReceipt(receiptId) {
  const r = _receipts.get(receiptId);
  return r ? { found: true, ...r } : { found: false };
}

function getAdapterMetrics() {
  const statusCount = {};
  for (const [, r] of _receipts) statusCount[r.status] = (statusCount[r.status] ?? 0) + 1;
  return {
    adapterType:   ADAPTER_TYPE,
    available:     _availability,
    totalOps:      _receipts.size,
    statusDistribution: statusCount,
  };
}

function reset() {
  _counter      = 0;
  _receipts     = new Map();
  _availability = null;
}

module.exports = {
  checkAvailability, isAvailable, validateFlag, runFlag,
  openFile, openDiff, runCommand, listExtensions,
  getReceipt, getAdapterMetrics, reset,
  ALLOWED_FLAGS:       Array.from(ALLOWED_FLAGS),
  ALLOWED_COMMAND_IDS: Array.from(ALLOWED_COMMAND_IDS),
  ADAPTER_TYPE,
};
