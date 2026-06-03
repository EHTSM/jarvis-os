"use strict";
/**
 * auditLog — append-only execution audit trail.
 *
 * Records operator actions with attribution: who triggered what, when, and why.
 * Entries are immutable once written — no update or delete paths exist.
 * File: data/logs/audit.ndjson (rotates at 20 MB, retains 30 days).
 *
 * Entry types:
 *   dispatch   — task submitted (new execution)
 *   retry      — task resubmitted after failure
 *   cancel     — task cancelled by operator or timeout
 *   replay     — task replayed from history
 *   emergency  — emergency stop / resume
 *   auth       — login / logout / session expired
 */

const fs   = require("fs");
const path = require("path");

const LOG_DIR  = path.join(__dirname, "../../data/logs");
const LOG_FILE = path.join(LOG_DIR, "audit.ndjson");
const MAX_BYTES  = 20 * 1024 * 1024;  // 20 MB
const RETAIN_MS  = 30 * 24 * 3600_000; // 30 days

let _stream    = null;
let _streamErr = false;
let _seq       = 0;

function _ensureStream() {
  if (_stream && !_streamErr) return _stream;
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    _stream    = fs.createWriteStream(LOG_FILE, { flags: "a", encoding: "utf8" });
    _streamErr = false;
    _stream.on("error", () => { _streamErr = true; _stream = null; });
  } catch {
    _streamErr = true;
    _stream    = null;
  }
  return _stream;
}

function _maybeRotate() {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_BYTES) {
      const rotated = LOG_FILE.replace(".ndjson", `.${Date.now()}.ndjson`);
      fs.renameSync(LOG_FILE, rotated);
      if (_stream) { _stream.end(); _stream = null; _streamErr = false; }
      _pruneOld();
    }
  } catch { /* file may not exist yet */ }
}

function _pruneOld() {
  try {
    const cutoff = Date.now() - RETAIN_MS;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!f.startsWith("audit.") || !f.endsWith(".ndjson") || f === "audit.ndjson") continue;
      const full = path.join(LOG_DIR, f);
      if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch { /* non-critical */ }
}

setInterval(_maybeRotate, 60_000).unref();

/**
 * Write one audit entry. Internal — all public helpers call this.
 */
function _write(type, fields) {
  const s = _ensureStream();
  if (!s) return;
  try {
    const entry = {
      seq:       ++_seq,
      ts:        new Date().toISOString(),
      type,
      ...fields,
    };
    s.write(JSON.stringify(entry) + "\n");
  } catch { /* non-critical */ }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Record a new task dispatch.
 * @param {{ taskId, input, agentId, taskType, operator }} opts
 */
function recordDispatch({ taskId, input, agentId, taskType, operator } = {}) {
  _write("dispatch", {
    taskId,
    agentId:   agentId  || "unknown",
    taskType:  taskType || "unknown",
    operator:  _sanitizeOperator(operator),
    input:     (input || "").slice(0, 200),
  });
}

/**
 * Record a task retry (operator-initiated or automatic).
 * @param {{ taskId, originalTaskId, reason, operator, attempt }} opts
 */
function recordRetry({ taskId, originalTaskId, reason, operator, attempt } = {}) {
  _write("retry", {
    taskId,
    originalTaskId: originalTaskId || null,
    attempt:        attempt || 1,
    reason:         (reason || "").slice(0, 200),
    operator:       _sanitizeOperator(operator),
  });
}

/**
 * Record a task cancellation.
 * @param {{ taskId, reason, operator, source }} opts
 */
function recordCancel({ taskId, reason, operator, source } = {}) {
  _write("cancel", {
    taskId,
    source:   source || "operator",   // "operator" | "timeout" | "emergency"
    reason:   (reason || "").slice(0, 200),
    operator: _sanitizeOperator(operator),
  });
}

/**
 * Record a task replay from history.
 * @param {{ taskId, sourceTaskId, input, operator }} opts
 */
function recordReplay({ taskId, sourceTaskId, input, operator } = {}) {
  _write("replay", {
    taskId,
    sourceTaskId: sourceTaskId || null,
    operator:     _sanitizeOperator(operator),
    input:        (input || "").slice(0, 200),
  });
}

/**
 * Record an emergency stop or resume.
 * @param {{ action, reason, operator, emergencyId }} opts
 */
function recordEmergency({ action, reason, operator, emergencyId } = {}) {
  _write("emergency", {
    action:      action || "stop",   // "stop" | "resume"
    emergencyId: emergencyId || null,
    reason:      (reason || "").slice(0, 200),
    operator:    _sanitizeOperator(operator),
  });
}

/**
 * Record an auth event.
 * @param {{ action, operator, method }} opts
 */
function recordAuth({ action, operator, method } = {}) {
  _write("auth", {
    action:   action || "login",   // "login" | "logout" | "expired"
    operator: _sanitizeOperator(operator),
    method:   method || "password",
  });
}

/**
 * Read last N audit entries (newest first). Diagnostic use only.
 */
function tail(n = 100) {
  if (n <= 0) return [];
  try {
    const text  = fs.readFileSync(LOG_FILE, "utf8");
    const lines = text.split("\n").filter(Boolean);
    return lines
      .slice(-Math.min(n, 500))
      .reverse()
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

/**
 * Return audit entries for a specific taskId (across all types).
 */
function byTask(taskId) {
  if (!taskId) return [];
  try {
    const text  = fs.readFileSync(LOG_FILE, "utf8");
    const lines = text.split("\n").filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && (e.taskId === taskId || e.originalTaskId === taskId || e.sourceTaskId === taskId))
      .reverse();
  } catch { return []; }
}

/** @returns {{ sizeBytes, path, exists, seq }} */
function info() {
  try {
    const stat = fs.statSync(LOG_FILE);
    return { sizeBytes: stat.size, path: LOG_FILE, exists: true, seq: _seq };
  } catch {
    return { sizeBytes: 0, path: LOG_FILE, exists: false, seq: _seq };
  }
}

function _sanitizeOperator(op) {
  if (!op) return "system";
  if (typeof op === "object") return (op.sub || op.id || op.email || "system").slice(0, 64);
  return String(op).slice(0, 64);
}

module.exports = {
  recordDispatch, recordRetry, recordCancel, recordReplay,
  recordEmergency, recordAuth,
  tail, byTask, info,
};
