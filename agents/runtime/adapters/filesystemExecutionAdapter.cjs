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
const MAX_RECEIPTS = 1000;
function _addReceipt(r) {
  _receipts.set(r.receiptId, r);
  if (_receipts.size > MAX_RECEIPTS) _receipts.delete(_receipts.keys().next().value);
}
let _sandboxRoot  = null;    // must be configured before use
let _writeAllowed = false;

// Rollback manifest — tracks every write+backup pair so callers can undo a session
// Map<sessionId, [{resolved, backupPath, op}]>
const _rollbackManifests = new Map();
const MAX_MANIFESTS = 50;

function beginRollbackSession() {
  const sessionId = `rbs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  _rollbackManifests.set(sessionId, []);
  if (_rollbackManifests.size > MAX_MANIFESTS) {
    _rollbackManifests.delete(_rollbackManifests.keys().next().value);
  }
  return sessionId;
}

function _recordRollbackEntry(sessionId, entry) {
  if (!sessionId || !_rollbackManifests.has(sessionId)) return;
  _rollbackManifests.get(sessionId).push(entry);
}

function rollbackSession(sessionId) {
  const entries = _rollbackManifests.get(sessionId);
  if (!entries) return { rolled: 0, reason: "session_not_found" };
  const results = [];
  // Reverse order — undo most recent first
  for (const e of [...entries].reverse()) {
    if (e.op === "write" && e.backupPath && fs.existsSync(e.backupPath)) {
      try {
        fs.copyFileSync(e.backupPath, e.resolved);
        fs.unlinkSync(e.backupPath);
        results.push({ ok: true, path: e.resolved });
      } catch (err) {
        results.push({ ok: false, path: e.resolved, reason: err.message });
      }
    } else if (e.op === "create" && fs.existsSync(e.resolved)) {
      try { fs.unlinkSync(e.resolved); results.push({ ok: true, path: e.resolved, deleted: true }); }
      catch (err) { results.push({ ok: false, path: e.resolved, reason: err.message }); }
    }
  }
  _rollbackManifests.delete(sessionId);
  return { rolled: results.length, results };
}

// Filesystem Execution Adapter Sandbox Security Audit (2026-08-21): the
// lexical startsWith() check below correctly blocks textual traversal
// ("../"), but path.resolve() never follows symlinks — a symlink placed
// INSIDE the sandbox pointing outside it (or a symlinked ancestor
// directory, for a target that doesn't exist yet) passes this lexical
// check while the real fs.*Sync() call underneath follows the link to
// wherever it truly points. Live-reproduced: a symlink at
// sandbox/link.txt -> /outside/secret.txt let readFile('link.txt') return
// the outside file's real content; a symlinked directory
// sandbox/linked-dir -> /outside let writeFile('linked-dir/new.txt', ...)
// land the write at /outside/new.txt. Not currently exploitable in this
// live repo (no attacker-reachable symlink exists anywhere in the
// sandboxed project tree, and this adapter exposes no primitive to create
// one), but fixed as real defense-in-depth per the same realpath-
// containment principle this mission calls for, since a symlink could be
// introduced by any other legitimate process without this adapter's
// knowledge. Walks up from the target to the nearest EXISTING ancestor
// (fs.realpathSync throws ENOENT for a path that doesn't exist yet, so a
// brand-new file's own path can't be realpath-checked directly — its
// nearest real ancestor directory is what actually determines where the
// write lands) and verifies that ancestor's real, symlink-resolved
// location is still inside the sandbox root's own real location.
function _nearestExistingAncestor(p) {
  let cur = p;
  while (true) {
    try { fs.realpathSync(cur); return cur; } catch { /* keep walking up */ }
    const parent = path.dirname(cur);
    if (parent === cur) return null; // reached filesystem root without finding anything real
    cur = parent;
  }
}

// Resolve and validate a path against the sandbox root
function _sandboxResolve(filePath) {
  if (!_sandboxRoot) return { safe: false, reason: "sandbox_not_configured" };
  if (!filePath)     return { safe: false, reason: "missing_path" };

  const resolved = path.resolve(_sandboxRoot, filePath);
  if (!resolved.startsWith(_sandboxRoot + path.sep) && resolved !== _sandboxRoot) {
    return { safe: false, reason: "path_traversal_detected", resolved };
  }

  const ancestor = _nearestExistingAncestor(resolved);
  if (ancestor) {
    const realAncestor = fs.realpathSync(ancestor);
    const realRoot = fs.realpathSync(_sandboxRoot);
    if (!realAncestor.startsWith(realRoot + path.sep) && realAncestor !== realRoot) {
      return { safe: false, reason: "symlink_escape_detected", resolved };
    }
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
  _addReceipt(r);
  return r;
}

// ── Phase 79: Protected directory rules ──────────────────────────────────────
// Filesystem Execution Adapter Sandbox Security Audit (2026-08-21): this
// list was previously only ever consulted by writeFile/deleteFile/makeDir —
// readFile/readDir/fileExists/statFile applied ZERO protected-path check at
// all. Since bootstrapRuntime.cjs configures this adapter's sandbox root as
// the entire project directory (writeAllowed:true) and this adapter is
// reachable by ANY ordinary, authenticated customer via a plain chat
// message ("read file .env") through toolAgent.cjs's read_file case —
// live-reproduced: readFile('.env') returned the real, live production
// .env file's full content (real secrets/keys/tokens), and readFile() on
// data/local-accounts.json and data/vault.json returned the real account
// password-hash store and the real encrypted credential vault in full.
// Fixed two ways: (1) _isProtectedPath() is now checked by every read
// operation too, not just writes — the existing mechanism, applied
// consistently instead of selectively; (2) the whole data/ directory is
// now protected (superseding the previous single-file
// "data/deploy_meta.json" entry), since it holds ~20 real credential/
// session/token/account-adjacent stores and no real caller of this chat
// tool has any legitimate reason to read from it.
const PROTECTED_DIRS = [
  "node_modules",
  ".git",
  ".env",
  "backend/utils",
  "agents/runtime/control",
  "data",
];

function _isProtectedPath(resolved) {
  if (!_sandboxRoot) return false;
  const rel = resolved.slice(_sandboxRoot.length + 1).replace(/\\/g, "/");
  return PROTECTED_DIRS.some(p => rel === p || rel.startsWith(p + "/") || rel.startsWith(p + path.sep));
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
  if (_isProtectedPath(check.resolved)) return _receipt("read", filePath, { success: false, reason: "protected_path" });

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

function writeFile(filePath, content, { encoding = "utf8", createDirs = false, sessionId = null } = {}) {
  if (!_writeAllowed) return _receipt("write", filePath, { success: false, reason: "write_not_allowed" });

  const check = _sandboxResolve(filePath);
  if (!check.safe) return _receipt("write", filePath, { success: false, reason: check.reason });
  if (_isProtectedPath(check.resolved)) return _receipt("write", filePath, { success: false, reason: "protected_path" });

  const byteLen = Buffer.byteLength(content, encoding);
  if (byteLen > MAX_WRITE_BYTES)
    return _receipt("write", filePath, { success: false, reason: `content_too_large: ${byteLen}` });

  try {
    if (createDirs) fs.mkdirSync(path.dirname(check.resolved), { recursive: true });
    // Backup existing file before overwrite so callers can roll back
    let backupPath = null;
    const isCreate = !fs.existsSync(check.resolved);
    if (!isCreate) {
      backupPath = check.resolved + ".bak." + Date.now();
      fs.copyFileSync(check.resolved, backupPath);
    }
    // Atomic write: tmp → rename
    const tmp = check.resolved + ".tmp";
    fs.writeFileSync(tmp, content, encoding);
    fs.renameSync(tmp, check.resolved);
    // Record rollback entry if a session is active
    _recordRollbackEntry(sessionId, {
      resolved: check.resolved,
      backupPath,
      op: isCreate ? "create" : "write",
    });
    return { ...(_receipt("write", filePath, { success: true })), bytesWritten: byteLen, backupPath };
  } catch (err) {
    return _receipt("write", filePath, { success: false, reason: err.code ?? err.message });
  }
}

function readDir(dirPath, { recursive = false } = {}) {
  const check = _sandboxResolve(dirPath);
  if (!check.safe) return _receipt("list", dirPath, { success: false, reason: check.reason });
  if (_isProtectedPath(check.resolved)) return _receipt("list", dirPath, { success: false, reason: "protected_path" });

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
  if (_isProtectedPath(check.resolved)) return { exists: false, reason: "protected_path" };
  return { exists: fs.existsSync(check.resolved), path: check.resolved };
}

function statFile(filePath) {
  const check = _sandboxResolve(filePath);
  if (!check.safe) return _receipt("stat", filePath, { success: false, reason: check.reason });
  if (_isProtectedPath(check.resolved)) return _receipt("stat", filePath, { success: false, reason: "protected_path" });

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
  if (_isProtectedPath(check.resolved)) return _receipt("delete", filePath, { success: false, reason: "protected_path" });

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
  if (_isProtectedPath(check.resolved)) return _receipt("mkdir", dirPath, { success: false, reason: "protected_path" });

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
  beginRollbackSession, rollbackSession,
  MAX_READ_BYTES, MAX_WRITE_BYTES,
};
