"use strict";
/**
 * Error Aggregation Service — E4 Observability
 * Reads structured.ndjson, groups errors by normalised fingerprint,
 * persists groups to data/error-groups.json.
 */

const fs   = require("fs");
const path = require("path");

const LOG_PATH    = path.join(__dirname, "../../data/logs/structured.ndjson");
const GROUPS_PATH = path.join(__dirname, "../../data/error-groups.json");
const MAX_LINES   = 5000;
const MAX_OCC     = 20;

// ── In-memory group cache ─────────────────────────────────────────
let _groups = {};   // fingerprint → group object

// ── Helpers ───────────────────────────────────────────────────────

/**
 * Normalise a log message to produce a stable fingerprint.
 * Strips hex addresses, UUIDs, and long numbers.
 */
function _normalise(msg) {
    return String(msg || "")
        .replace(/0x[0-9a-f]+/gi,                                         "0xADDR")
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "UUID")
        .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g,   "TIMESTAMP")
        .replace(/\b\d{3,}\b/g,                                            "N");
}

/** Read last N lines of a file synchronously. */
function _tailLines(filePath, n) {
    let content;
    try {
        content = fs.readFileSync(filePath, "utf8");
    } catch {
        return [];
    }
    const lines = content.split("\n").filter(l => l.trim());
    return lines.slice(-n);
}

/** Parse NDJSON lines → array of objects (skip bad lines). */
function _parseLines(lines) {
    const out = [];
    for (const line of lines) {
        try { out.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return out;
}

/** Atomic write via .tmp rename. */
function _persist(data) {
    const tmp = GROUPS_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(tmp, GROUPS_PATH);
}

/** Load persisted groups from disk into _groups. */
function _loadGroups() {
    try {
        const raw = fs.readFileSync(GROUPS_PATH, "utf8");
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
            _groups = {};
            for (const g of arr) {
                if (g && g.fingerprint) _groups[g.fingerprint] = g;
            }
        }
    } catch {
        _groups = {};
    }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * aggregate(opts) → { groups[], total, errorRate }
 * Reads last 5000 lines of structured.ndjson, groups by fingerprint,
 * saves to data/error-groups.json, returns summary.
 */
function aggregate(opts) {
    const lines   = _tailLines(LOG_PATH, MAX_LINES);
    const entries = _parseLines(lines);
    const errors  = entries.filter(e => e && e.level === "error");

    // Build groups from scratch on each call (merge with persisted acknowledgements)
    _loadGroups();
    const prevAck = {};
    for (const [fp, g] of Object.entries(_groups)) {
        if (g.acknowledged) prevAck[fp] = true;
    }

    const fresh = {};   // fingerprint → group
    for (const entry of errors) {
        const norm        = _normalise(entry.msg);
        const fingerprint = norm.slice(0, 80);
        const ts          = entry.ts || new Date().toISOString();
        const service     = (entry.ctx && entry.ctx.service) || entry.service || "unknown";

        if (!fresh[fingerprint]) {
            fresh[fingerprint] = {
                fingerprint,
                message:     entry.msg || "",
                count:       0,
                firstSeen:   ts,
                lastSeen:    ts,
                services:    [],
                occurrences: [],
                acknowledged: prevAck[fingerprint] || false,
            };
        }

        const g = fresh[fingerprint];
        g.count++;
        if (ts < g.firstSeen) g.firstSeen = ts;
        if (ts > g.lastSeen)  g.lastSeen  = ts;
        if (!g.services.includes(service)) g.services.push(service);
        if (g.occurrences.length < MAX_OCC) g.occurrences.push({ ts, ctx: entry.ctx || {} });
    }

    // Keep only the MAX_OCC most recent occurrences (entries are chronological)
    for (const g of Object.values(fresh)) {
        if (g.occurrences.length > MAX_OCC) {
            g.occurrences = g.occurrences.slice(-MAX_OCC);
        }
    }

    _groups = fresh;
    const groupArr = Object.values(_groups);
    _persist(groupArr);

    const now     = Date.now();
    const window5 = 5 * 60 * 1000;
    const recent  = errors.filter(e => e.ts && (now - new Date(e.ts).getTime()) <= window5);
    const errorRate = recent.length / 5;   // errors per minute over 5-min window

    return { groups: groupArr, total: errors.length, errorRate };
}

/**
 * getTopErrors(n) → top N groups by count.
 * Re-aggregates if _groups is empty.
 */
function getTopErrors(n = 10) {
    if (Object.keys(_groups).length === 0) {
        try { aggregate(); } catch { /* silent */ }
    }
    return Object.values(_groups)
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
}

/**
 * getErrorRate(windowMs) → errors per minute in that window.
 */
function getErrorRate(windowMs = 300000) {
    const lines   = _tailLines(LOG_PATH, MAX_LINES);
    const entries = _parseLines(lines);
    const now     = Date.now();
    const errors  = entries.filter(e =>
        e && e.level === "error" &&
        e.ts && (now - new Date(e.ts).getTime()) <= windowMs
    );
    const windowMins = windowMs / 60000;
    return windowMins > 0 ? errors.length / windowMins : 0;
}

/**
 * getErrorTrend(hours) → { buckets[] } — one per hour.
 */
function getErrorTrend(hours = 24) {
    const lines   = _tailLines(LOG_PATH, MAX_LINES);
    const entries = _parseLines(lines);
    const now     = Date.now();

    // Build hour buckets
    const buckets = [];
    for (let i = hours - 1; i >= 0; i--) {
        const start = now - (i + 1) * 3600000;
        const end   = now - i * 3600000;
        const d     = new Date(start);
        d.setMinutes(0, 0, 0);
        const count = entries.filter(e => {
            if (!e || e.level !== "error" || !e.ts) return false;
            const t = new Date(e.ts).getTime();
            return t >= start && t < end;
        }).length;
        buckets.push({ hour: d.toISOString(), count });
    }
    return { buckets };
}

/**
 * resolveError(fingerprint) → marks group acknowledged:true and persists.
 */
function resolveError(fingerprint) {
    _loadGroups();
    if (_groups[fingerprint]) {
        _groups[fingerprint].acknowledged = true;
        _persist(Object.values(_groups));
    }
}

/**
 * getUnresolved() → groups where acknowledged !== true.
 */
function getUnresolved() {
    if (Object.keys(_groups).length === 0) {
        try { aggregate(); } catch { /* silent */ }
    }
    return Object.values(_groups).filter(g => g.acknowledged !== true);
}

// ── Auto-aggregate on require ─────────────────────────────────────
try { aggregate(); } catch { /* log file missing — silent */ }

module.exports = {
    aggregate,
    getTopErrors,
    getErrorRate,
    getErrorTrend,
    resolveError,
    getUnresolved,
};
