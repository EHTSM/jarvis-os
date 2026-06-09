"use strict";
/**
 * Phase 393 — Operator Safety Guard (backend)
 *
 * Last-line-of-defense server-side safety check before execution.
 * Catches dangerous patterns that slip through the frontend gate
 * (e.g., API calls that bypass the UI, programmatic dispatch).
 *
 * Does NOT block: does not throw, does not reject.
 * Returns: { safe: bool, warnings: string[], level: "safe"|"caution"|"critical" }
 *
 * Enforcement is caller's responsibility — this is advisory.
 */

// Filesystem destruction patterns
const CRITICAL_PATTERNS = [
    { re: /rm\s+-[a-zA-Z]*f[a-zA-Z]*\s+\//,       warn: "rm -rf on root path" },
    { re: /mkfs\b/,                                 warn: "mkfs — disk format command" },
    { re: /dd\s+if=/,                               warn: "dd — raw disk write" },
    { re: />\s*(\/dev\/sd|\/dev\/nvme|\/dev\/hd)/,  warn: "writing directly to block device" },
    { re: /drop\s+(table|database|schema)\s+\S+/i,  warn: "destructive SQL DDL" },
    { re: /shutdown\s+-[hrf]/i,                     warn: "system shutdown/reboot" },
    { re: /\bformat\s+[a-z]:/i,                     warn: "Windows disk format" },
    { re: /truncate\s+--size=0\s+\//,               warn: "zero-truncate system file" },
];

// Elevated-risk patterns — caution
const CAUTION_PATTERNS = [
    { re: /git\s+push\s+(--force|-f)\b/,            warn: "force push — overwrites remote history" },
    { re: /git\s+reset\s+--hard/,                   warn: "hard reset — discards uncommitted work" },
    { re: /chmod\s+[0-7]*7[0-7][0-7]\s+\//,        warn: "world-writable permissions on system path" },
    { re: /pkill\s+-9\b|kill\s+-9\b|killall\s+-9/,  warn: "SIGKILL — force terminates without cleanup" },
    { re: /npm\s+install\s+--global\s/,             warn: "global npm install — affects system node" },
];

// Execution throttle state — per-input rate tracking
const _execTimes = new Map(); // inputKey → timestamp[]
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_MAX       = 10;    // max same-input dispatches per minute

function _inputKey(input) {
    return input.trim().toLowerCase().slice(0, 80);
}

/**
 * Check a command for safety concerns.
 * @param {string} cmd
 * @returns {{ safe: bool, level: "safe"|"caution"|"critical", warnings: string[] }}
 */
function check(cmd) {
    if (!cmd) return { safe: true, level: "safe", warnings: [] };
    const trimmed = cmd.trim();
    const warnings = [];
    let level = "safe";

    for (const { re, warn } of CRITICAL_PATTERNS) {
        if (re.test(trimmed)) {
            warnings.push(warn);
            level = "critical";
        }
    }

    if (level !== "critical") {
        for (const { re, warn } of CAUTION_PATTERNS) {
            if (re.test(trimmed)) {
                warnings.push(warn);
                level = "caution";
            }
        }
    }

    return { safe: level === "safe", level, warnings };
}

/**
 * Throttle check — returns false if this input has been dispatched too many times per minute.
 * Protects against runaway workflow loops.
 * @param {string} input
 * @returns {{ allowed: bool, rate: number }}
 */
function throttleCheck(input) {
    const key = _inputKey(input);
    const now = Date.now();
    const times = (_execTimes.get(key) || []).filter(t => now - t < THROTTLE_WINDOW_MS);
    times.push(now);
    _execTimes.set(key, times);

    // Evict stale entries from map periodically (once per 200 calls)
    if (Math.random() < 0.005) {
        for (const [k, v] of _execTimes) {
            const live = v.filter(t => now - t < THROTTLE_WINDOW_MS);
            if (live.length === 0) _execTimes.delete(k);
            else _execTimes.set(k, live);
        }
    }

    return { allowed: times.length <= THROTTLE_MAX, rate: times.length };
}

/**
 * Combined gate: safety check + throttle check.
 * @param {string} input
 * @param {{ bypassSafety?: bool, bypassThrottle?: bool }} options
 * @returns {{ allowed: bool, safetyResult, throttleResult }}
 */
function gate(input, options = {}) {
    const safetyResult  = options.bypassSafety  ? { safe: true, level: "safe", warnings: [] } : check(input);
    const throttleResult = options.bypassThrottle ? { allowed: true, rate: 0 }               : throttleCheck(input);
    return {
        allowed: safetyResult.level !== "critical" && throttleResult.allowed,
        safetyResult,
        throttleResult,
    };
}

module.exports = { check, throttleCheck, gate };
