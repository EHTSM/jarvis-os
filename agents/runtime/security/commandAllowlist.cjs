"use strict";
/**
 * commandAllowlist — terminal command safety scanner.
 *
 * check(command)         → { allowed, reason, risk }
 * scanForDangerous(cmd)  → { name, risk } | null
 * addAllow(regex)        — whitelist a pattern (bypasses built-in deny)
 * addDeny(regex)         — additional deny patterns
 * reset()                — clear custom patterns (does NOT touch built-ins)
 */

const DANGEROUS_PATTERNS = [
    { name: "fork-bomb",       pattern: /:\(\)\s*\{[^}]*\}\s*;?\s*:/,        risk: "critical" },
    { name: "rm-rf-root",      pattern: /rm\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\s+\/(\s|$)/, risk: "critical" },
    { name: "rm-rf",           pattern: /rm\s+(-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*)\s/i, risk: "high" },
    { name: "dd-device",       pattern: /\bdd\b.*\bif=\/dev\//,              risk: "critical" },
    { name: "chmod-777-root",  pattern: /chmod\s+(-R\s+)?777\s+\//,          risk: "high" },
    { name: "curl-pipe-sh",    pattern: /curl\b.*\|\s*(ba)?sh/,              risk: "high" },
    { name: "wget-pipe-sh",    pattern: /wget\b.*-O\s*-.*\|\s*(ba)?sh/,      risk: "high" },
    { name: "mkfs",            pattern: /\bmkfs\b/,                          risk: "critical" },
    { name: "shred",           pattern: /\bshred\b/,                         risk: "high" },
    { name: "history-clear",   pattern: /history\s+-c|rm\s+.*bash_history/,  risk: "medium" },
    { name: "sudo-su",         pattern: /\bsudo\s+su\b|\bsudo\s+-[si]\b/,    risk: "high" },
    { name: "python-exec-net", pattern: /python.*-c.*import\s+(os|subprocess|socket)/, risk: "medium" },
];

const _allowPatterns = [];
const _denyPatterns  = [];

function check(command) {
    if (typeof command !== "string" || command.trim() === "") {
        return { allowed: true, reason: "empty_command", risk: "none" };
    }

    for (const dp of _denyPatterns) {
        if (dp.test(command)) return { allowed: false, reason: "user_deny_pattern", risk: "denied" };
    }

    for (const ap of _allowPatterns) {
        if (ap.test(command)) return { allowed: true, reason: "explicit_allow", risk: "low" };
    }

    const match = scanForDangerous(command);
    if (match) return { allowed: false, reason: match.name, risk: match.risk };

    return { allowed: true, reason: "no_violations", risk: "low" };
}

function scanForDangerous(command) {
    for (const { name, pattern, risk } of DANGEROUS_PATTERNS) {
        if (pattern.test(command)) return { name, risk };
    }
    return null;
}

function addAllow(regex) {
    _allowPatterns.push(regex instanceof RegExp ? regex : new RegExp(regex));
}

function addDeny(regex) {
    _denyPatterns.push(regex instanceof RegExp ? regex : new RegExp(regex));
}

function reset() {
    _allowPatterns.length = 0;
    _denyPatterns.length  = 0;
}

module.exports = { check, scanForDangerous, addAllow, addDeny, reset, DANGEROUS_PATTERNS };
