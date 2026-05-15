"use strict";

// Sandboxed filesystem operations. All paths are validated against the configured
// sandbox root — path traversal is blocked before any I/O.

const fs   = require("fs");
const path = require("path");

const MAX_READ_BYTES  = 2 * 1024 * 1024;  // 2 MB read limit
const MAX_WRITE_BYTES = 1 * 1024 * 1024;  // 1 MB write limit
const MAX_LIST_ENTRIES = 1000;

let _counter     = 0;
let _receipts    = new Map();
let _sandboxRoot = null;    // must be configured before use
let _writeAllowed = false;

// Resolve and validate a path against the sandbox root
function _sandboxResolve(filePath) {
  if (!_sandboxRoot) return { safe: false, reason: "sandbox_not_configured" };
  if (!filePath)     return { safe: false, reason: "missing_path" };

  const resolved = path.resolve(_sandboxRoot, filePath);
  if (!resolved.startsWith(_sandboxRoot + path.sep) && resolved !== _sandboxRoot) {
    return { safe: false, reason: "path_traversal_detected", resolved };
  }
  return { safe: true, resolved };
}

function _receipt(op, filePath, result) {
  const r = Object.freeze({
    receiptId: `fsr-${++_counter}`,
    adapterType: "filesystem",
    operation: op, path: filePath,
    success:  result.success,
    reason:   result.reason ?? null,
    timestamp: new Date().toISOString(),
  });
  _receipts.set(r.receiptId, r);
  return r;
}

// Configure the sandbox root (must be called before any I/O)
function configure(sandboxRoot, { writeAllowed = false } = {}) {
  if (!sandboxRoot) return { configured: false, reason: "missing_sandbox_root" };
  const resolved = path.resolve(sandboxRoot);
  // Root must exist
  if (!fs.existsSync(resolved)) return { configured: false, reason: "sandbox_root_does_not_exist" };
  _sandboxRoot  = resolved;
  _writeAllowed = writeAllowed;
  return { configured: true, sandboxRoot: _sandboxRoot, writeAllowed };
}

function getSandboxRoot() {
  return { sandboxRoot: _sandboxRoot, writeAllowed: _writeAllowed };
}

function readFile(filePath, { encoding = "utf8" } = {}) {
  const check = _sandboxResolve(filePath);
  if (!check.safe) return _receipt("read", filePath, { success: false, reason: check.reason });

  try {
    const stat = fs.statSync(check.resolved);
    if (!stat.isFile()) return _receipt("read", filePath, { success: false, reason: "not_a_file" });
    if (stat.size > MAX_READ_BYTES)
      return _receipt("read", filePath, { success: false, reason: `file_too_large: ${stat.size}` });

    const content = fs.readFileSync(check.resolved, encoding);
    return { ...(_receipt("read", filePath, { success: true })), content, size: stat.size };
  } catch (err) {
    return _receipt("read", filePath, { success: false, reason: err.code ?? err.message });
  }
}

function writeFile(filePath, content, { encoding = "utf8", createDirs = false } = {}) {
  if (!_writeAllowed) return _receipt("write", filePath, { success: false, reason: "write_not_allowed" });

  const check = _sandboxResolve(filePath);
  if (!check.safe) return _receipt("write", filePath, { success: false, reason: check.reason });

  const byteLen = Buffer.byteLength(content, encoding);
  if (byteLen > MAX_WRITE_BYTES)
    return _receipt("write", filePath, { success: false, reason: `content_too_large: ${byteLen}` });

  try {
    if (createDirs) fs.mkdirSync(path.dirname(check.resolved), { recursive: true });
    fs.writeFileSync(check.resolved, content, encoding);
    return { ...(_receipt("write", filePath, { success: true })), bytesWritten: byteLen };
  } catch (err) {
    return _receipt("write", filePath, { success: false, reason: err.code ?? err.message });
  }
}

function readDir(dirPath, { recursive = false } = {}) {
  const check = _sandboxResolve(dirPath);
  if (!check.safe) return _receipt("list", dirPath, { success: false, reason: check.reason });

  try {
    const stat = fs.statSync(check.resolved);
    if (!stat.isDirectory()) return _receipt("list", dirPath, { success: false, reason: "not_a_directory" });

    const opts = recursive ? { recursive: true, withFileTypes: false } : { withFileTypes: false };
    const entries = fs.readdirSync(check.resolved, opts)
      .slice(0, MAX_LIST_ENTRIES)
      .map(e => typeof e === "string" ? e : e.name);

    return { ...(_receipt("list", dirPath, { success: true })), entries, count: entries.length };
  } catch (err) {
    return _receipt("list", dirPath, { success: false, reason: err.code ?? err.message });
  }
}

function fileExists(filePath) {
  const check = _sandboxResolve(filePath);
  if (!check.safe) return { exists: false, reason: check.reason };
  return { exists: fs.existsSync(check.resolved), path: check.resolved };
}

function statFile(filePath) {
  const check = _sandboxResolve(filePath);
  if (!check.safe) return _receipt("stat", filePath, { success: false, reason: check.reason });

  try {
    const s = fs.statSync(check.resolved);
    return { ...(_receipt("stat", filePath, { success: true })),
      size: s.size, isFile: s.isFile(), isDirectory: s.isDirectory(),
      mtime: s.mtime.toISOString(), ctime: s.ctime.toISOString() };
  } catch (err) {
    return _receipt("stat", filePath, { success: false, reason: err.code ?? err.message });
  }
}

function deleteFile(filePath) {
  if (!_writeAllowed) return _receipt("delete", filePath, { success: false, reason: "write_not_allowed" });
  const check = _sandboxResolve(filePath);
  if (!check.safe) return _receipt("delete", filePath, { success: false, reason: check.reason });

  try {
    const stat = fs.statSync(check.resolved);
    if (stat.isDirectory()) return _receipt("delete", filePath, { success: false, reason: "use_rmdir_for_directories" });
    fs.unlinkSync(check.resolved);
    return _receipt("delete", filePath, { success: true });
  } catch (err) {
    return _receipt("delete", filePath, { success: false, reason: err.code ?? err.message });
  }
}

function makeDir(dirPath) {
  if (!_writeAllowed) return _receipt("mkdir", dirPath, { success: false, reason: "write_not_allowed" });
  const check = _sandboxResolve(dirPath);
  if (!check.safe) return _receipt("mkdir", dirPath, { success: false, reason: check.reason });

  try {
    fs.mkdirSync(check.resolved, { recursive: true });
    return _receipt("mkdir", dirPath, { success: true });
  } catch (err) {
    return _receipt("mkdir", dirPath, { success: false, reason: err.code ?? err.message });
  }
}

function getAdapterMetrics() {
  const ops = {};
  for (const [, r] of _receipts) ops[r.operation] = (ops[r.operation] ?? 0) + 1;
  return {
    adapterType:   "filesystem",
    sandboxRoot:   _sandboxRoot,
    writeAllowed:  _writeAllowed,
    totalOps:      _receipts.size,
    opDistribution: ops,
  };
}

function reset() {
  _counter     = 0;
  _receipts    = new Map();
  _sandboxRoot = null;
  _writeAllowed = false;
}

module.exports = {
  configure, getSandboxRoot,
  readFile, writeFile, readDir, fileExists, statFile, deleteFile, makeDir,
  getAdapterMetrics, reset,
  MAX_READ_BYTES, MAX_WRITE_BYTES,
};
