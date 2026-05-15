"use strict";
/**
 * execLog — persistent NDJSON execution log writer.
 *
 * Appends one JSON line per execution to data/logs/execution.ndjson.
 * Rotates when the file exceeds MAX_BYTES (10 MB).
 * Non-blocking: uses a write-stream queue so the event loop is never stalled.
 * Safe: if the log directory or disk is unavailable, execution continues.
 */

const fs   = require("fs");
const path = require("path");

const LOG_DIR   = path.join(__dirname, "../../data/logs");
const LOG_FILE  = path.join(LOG_DIR, "execution.ndjson");
const MAX_BYTES = 10 * 1024 * 1024;  // 10 MB

let _stream    = null;
let _streamErr = false;

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
            // Delete rotated files older than 7 days
            _pruneOldLogs();
        }
    } catch { /* file may not exist yet — that's fine */ }
}

function _pruneOldLogs() {
    try {
        const cutoff = Date.now() - 7 * 24 * 3600_000;
        for (const f of fs.readdirSync(LOG_DIR)) {
            if (!f.startsWith("execution.") || !f.endsWith(".ndjson")) continue;
            const full = path.join(LOG_DIR, f);
            if (fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
        }
    } catch { /* non-critical */ }
}

// Check rotation every minute
setInterval(_maybeRotate, 60_000).unref();

/**
 * Append one execution record to the persistent log.
 * @param {object} entry — same shape as executionHistory.record() input
 */
function append(entry) {
    const s = _ensureStream();
    if (!s) return;
    try {
        const line = JSON.stringify({
            ts:        new Date().toISOString(),
            agentId:   entry.agentId   || "unknown",
            taskType:  entry.taskType  || "unknown",
            taskId:    entry.taskId    || "",
            success:   entry.success   !== false,
            durationMs: entry.durationMs || 0,
            error:     entry.error     || null,
            input:     (entry.input    || "").slice(0, 120),
            output:    (entry.output   || "").slice(0, 120),
        }) + "\n";
        s.write(line);
    } catch { /* non-critical */ }
}

/**
 * Read the last N lines from the log file (newest first).
 * Synchronous — for diagnostic endpoints only, not hot paths.
 * @param {number} n
 * @returns {object[]}
 */
function tail(n = 100) {
    if (n <= 0) return [];
    try {
        const text  = fs.readFileSync(LOG_FILE, "utf8");
        const lines = text.split("\n").filter(Boolean);
        return lines
            .slice(-n)
            .reverse()
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(Boolean);
    } catch { return []; }
}

/** @returns {{ sizeBytes, lineCount, path, exists }} */
function info() {
    try {
        const stat = fs.statSync(LOG_FILE);
        return { sizeBytes: stat.size, path: LOG_FILE, exists: true };
    } catch {
        return { sizeBytes: 0, path: LOG_FILE, exists: false };
    }
}

module.exports = { append, tail, info };
