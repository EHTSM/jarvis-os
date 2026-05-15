"use strict";
/**
 * deadLetterQueue — persistent store for tasks that exhausted all retries.
 *
 * Appends to data/dead-letter.json (JSON array, atomic write via tmp+rename).
 * Capped at 1000 entries — oldest evicted when cap is exceeded.
 * Exposed read-only via GET /runtime/dead-letter.
 */

const fs   = require("fs");
const path = require("path");

const DLQ_FILE = path.join(__dirname, "../../data/dead-letter.json");
const DLQ_CAP  = 1000;

function _read() {
    try { return JSON.parse(fs.readFileSync(DLQ_FILE, "utf8")); }
    catch { return []; }
}

function _write(arr) {
    try {
        const tmp = DLQ_FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify(arr, null, 2));
        fs.renameSync(tmp, DLQ_FILE);
    } catch { /* non-critical */ }
}

/**
 * Record a dead task.
 * @param {object} p
 *   taskId   {string}
 *   taskType {string}
 *   input    {string}
 *   error    {string}
 *   attempts {number}
 *   agentId  {string|null}
 */
function push(p) {
    const current = _read();
    current.push({
        taskId:    p.taskId   || `t-${Date.now().toString(36)}`,
        taskType:  p.taskType || "unknown",
        input:     (p.input   || "").slice(0, 200),
        error:     (p.error   || "unknown"),
        attempts:  p.attempts || 0,
        agentId:   p.agentId  || null,
        deadAt:    new Date().toISOString(),
    });
    // Evict oldest if over cap
    const trimmed = current.length > DLQ_CAP ? current.slice(-DLQ_CAP) : current;
    _write(trimmed);
}

/** @returns {object[]} all DLQ entries (most recent first) */
function list() {
    return _read().slice().reverse();
}

/** @returns {number} DLQ entry count */
function size() {
    return _read().length;
}

/**
 * Remove a specific entry by taskId (for manual requeue/cleanup).
 * @returns {boolean} true if removed
 */
function remove(taskId) {
    const current = _read();
    const filtered = current.filter(e => e.taskId !== taskId);
    if (filtered.length === current.length) return false;
    _write(filtered);
    return true;
}

module.exports = { push, list, size, remove };
