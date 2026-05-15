"use strict";
/**
 * logAnalyzer — parse and analyze runtime log lines.
 *
 * parseLogLine(line)       → { level, message, ts?, module? }
 * extractErrors(lines[])   → [{ message, type, count, firstSeen, lastSeen }]
 * analyzeLogs(lines[])     → { errors[], warnings[], patterns[], errorRate, severity }
 * summarize(lines[], n)    → top N most frequent issues
 */

const LOG_LEVEL_RX = /^\[?(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\]?/i;
const TIMESTAMP_RX = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)/;
const MODULE_RX    = /\[([A-Za-z0-9_:.\-/]+)\]/;

const ERROR_PATTERNS = [
    { name: "syntax_error",     rx: /SyntaxError:/i          },
    { name: "type_error",       rx: /TypeError:/i            },
    { name: "reference_error",  rx: /ReferenceError:/i       },
    { name: "range_error",      rx: /RangeError:/i           },
    { name: "unhandled_reject",  rx: /unhandledRejection/i   },
    { name: "uncaught_except",  rx: /uncaughtException/i     },
    { name: "oom",              rx: /out of memory|heap/i    },
    { name: "module_not_found", rx: /Cannot find module/i    },
    { name: "econnrefused",     rx: /ECONNREFUSED/i          },
    { name: "enoent",           rx: /ENOENT/i                },
    { name: "timeout",          rx: /timed? ?out|ETIMEDOUT/i },
    { name: "assertion",        rx: /AssertionError:/i       },
];

function parseLogLine(line) {
    if (typeof line !== "string") return { level: "unknown", message: line };

    let rest    = line.trim();
    let ts      = null;
    let level   = "info";
    let module  = null;

    // Extract timestamp
    const tsMatch = TIMESTAMP_RX.exec(rest);
    if (tsMatch) { ts = tsMatch[1]; rest = rest.slice(tsMatch[0].length).trim(); }

    // Extract level
    const lvMatch = LOG_LEVEL_RX.exec(rest);
    if (lvMatch) { level = lvMatch[1].toLowerCase(); rest = rest.slice(lvMatch[0].length).trim(); }

    // Extract module
    const modMatch = MODULE_RX.exec(rest);
    if (modMatch) { module = modMatch[1]; }

    return { level, message: rest, ts, module };
}

function extractErrors(lines) {
    const counts = new Map();   // normalized message → { message, type, count, firstSeen, lastSeen }

    for (const raw of lines) {
        const parsed = parseLogLine(raw);
        if (!["error", "fatal", "critical"].includes(parsed.level)) {
            if (!ERROR_PATTERNS.some(p => p.rx.test(parsed.message))) continue;
        }

        const type = _detectErrorType(parsed.message);
        // Normalize: strip variable parts (numbers, hashes, paths)
        const key  = parsed.message
            .replace(/0x[0-9a-f]+/gi, "0x…")
            .replace(/\d+/g, "N")
            .replace(/['"][^'"]{0,80}['"]/g, "'…'")
            .slice(0, 120);

        if (counts.has(key)) {
            const entry = counts.get(key);
            entry.count++;
            entry.lastSeen = parsed.ts || new Date().toISOString();
        } else {
            counts.set(key, {
                message:   parsed.message,
                type,
                count:     1,
                firstSeen: parsed.ts || new Date().toISOString(),
                lastSeen:  parsed.ts || new Date().toISOString(),
            });
        }
    }

    return [...counts.values()].sort((a, b) => b.count - a.count);
}

function _detectErrorType(msg) {
    for (const { name, rx } of ERROR_PATTERNS) {
        if (rx.test(msg)) return name;
    }
    return "generic_error";
}

function analyzeLogs(lines) {
    const parsed   = lines.map(parseLogLine);
    const errors   = extractErrors(lines);
    const warnings = parsed.filter(l => l.level === "warn" || l.level === "warning");
    const total    = lines.length;
    const errCount = parsed.filter(l => ["error", "fatal", "critical"].includes(l.level)).length;

    const patternCounts = {};
    for (const p of ERROR_PATTERNS) {
        const hits = lines.filter(l => p.rx.test(l)).length;
        if (hits > 0) patternCounts[p.name] = hits;
    }

    const errorRate = total > 0 ? parseFloat((errCount / total).toFixed(3)) : 0;
    const severity  = errors.some(e => ["oom", "uncaught_except", "unhandled_reject"].includes(e.type))
        ? "critical"
        : errCount > 0 ? "error"
        : warnings.length > 0 ? "warning"
        : "ok";

    return {
        errors,
        warnings: warnings.map(w => w.message),
        patterns: Object.entries(patternCounts).map(([name, count]) => ({ name, count })),
        errorRate,
        severity,
        totalLines: total,
        errorCount: errCount,
    };
}

function summarize(lines, n = 5) {
    const { errors, severity, errorRate } = analyzeLogs(lines);
    return {
        topIssues: errors.slice(0, n),
        severity,
        errorRate,
    };
}

module.exports = { parseLogLine, extractErrors, analyzeLogs, summarize, ERROR_PATTERNS };
