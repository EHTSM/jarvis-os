"use strict";
/**
 * auditLog — append-only audit trail.
 *
 * log(event, actor, detail)    → entry  — record an audit event
 * query({ event, actor, since, limit }) → entry[]
 * exportLast(n)                → last n entries
 * reset()                      — clear in-memory buffer (file is preserved)
 */

const fs   = require("fs");
const path = require("path");

const AUDIT_FILE = path.join(__dirname, "../../../data/audit.log");
const MAX_BUFFER = 1_000;

let _buffer = [];
let _seq    = 0;

function log(event, actor = "system", detail = {}) {
    const entry = {
        seq:   ++_seq,
        ts:    new Date().toISOString(),
        event,
        actor,
        detail,
    };
    _buffer.push(entry);
    if (_buffer.length > MAX_BUFFER) _buffer.shift();
    _persist(entry);
    return entry;
}

function _persist(entry) {
    try {
        const dir = path.dirname(AUDIT_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(AUDIT_FILE, JSON.stringify(entry) + "\n", "utf8");
    } catch { /* non-fatal — in-memory buffer is always intact */ }
}

function query({ event, actor, since, limit = 100 } = {}) {
    let results = [..._buffer];
    if (event) results = results.filter(e => e.event === event);
    if (actor) results = results.filter(e => e.actor === actor);
    if (since) {
        const sinceTs = new Date(since).getTime();
        results = results.filter(e => new Date(e.ts).getTime() >= sinceTs);
    }
    return results.slice(-limit);
}

function exportLast(n = 50) {
    return _buffer.slice(-n);
}

function reset() { _buffer = []; _seq = 0; }

module.exports = { log, query, exportLast, reset };
