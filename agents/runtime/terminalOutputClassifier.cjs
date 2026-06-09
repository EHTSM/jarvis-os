"use strict";
/**
 * Phase 425 — Terminal Intelligence Layer
 *
 * Classifies terminal output into actionable categories.
 * Detects: fatal errors, transient failures, stalled commands, dependency issues,
 *          successful recovery signals.
 *
 * Returns: { category, severity, rootCause?, suggestion?, summary }
 *
 * Categories:
 *   "fatal"        — process crash, OOM, SIGKILL — needs recovery chain
 *   "transient"    — timeout, ECONNRESET, temp failure — retry may work
 *   "dependency"   — missing module, version conflict, lockfile issue
 *   "build-error"  — compilation/bundler failure
 *   "stalled"      — no output progress, command likely hung
 *   "permission"   — EACCES, EPERM, sudo required
 *   "success"      — command completed successfully
 *   "info"         — informational output, no action needed
 */

const CLASSIFIERS = [
    // Fatal
    { category: "fatal",      severity: "critical", pattern: /killed|oom.?killer|out.?of.?memory|segfault|signal.?9|SIGKILL|process.?exited.?code [^0]/i },
    { category: "fatal",      severity: "critical", pattern: /UnhandledPromiseRejection|uncaughtException|Cannot read prop/i },
    { category: "fatal",      severity: "critical", pattern: /npm ERR!.*code E(?!LIFE|BSYSY)/i },  // npm fatal errors
    // Transient
    { category: "transient",  severity: "warn",     pattern: /ECONNRESET|ECONNREFUSED|ETIMEDOUT|socket.?hang.?up|timeout/i },
    { category: "transient",  severity: "warn",     pattern: /temporarily unavailable|503|502|gateway/i },
    // Dependency
    { category: "dependency", severity: "error",    pattern: /cannot find module|module not found|peer dep|unmet dep/i },
    { category: "dependency", severity: "error",    pattern: /npm warn.*peer|version mismatch|lockfile/i },
    { category: "dependency", severity: "error",    pattern: /ENOENT.*node_modules/i },
    // Build
    { category: "build-error",severity: "error",    pattern: /build failed|compilation error|error ts\d+|type error/i },
    { category: "build-error",severity: "error",    pattern: /vite.*error|webpack.*error|rollup.*error/i },
    { category: "build-error",severity: "error",    pattern: /eslint.*error|lint.*failed/i },
    // Stalled
    { category: "stalled",    severity: "warn",     pattern: /waiting for.*changes|watching.*files|^>$/im },
    // Permission
    { category: "permission", severity: "error",    pattern: /EACCES|EPERM|permission denied|operation not permitted/i },
    // Success signals
    { category: "success",    severity: "info",     pattern: /successfully|done in \d|compiled.*successfully|started.*successfully|✓|✔/i },
    { category: "success",    severity: "info",     pattern: /pm2.*online|server.*listening|ready in \d/i },
    // Info
    { category: "info",       severity: "info",     pattern: /npm warn deprecat|deprecated/i },
];

const RECOVERY_SUGGESTIONS = {
    "fatal":       ["run-chain:recover-backend", "run-chain:health-check"],
    "transient":   ["retry-command", "run-chain:health-check"],
    "dependency":  ["run-chain:clean-install", "run-chain:dependency-mismatch-repair"],
    "build-error": ["run-chain:build-verification-recovery", "run-chain:recover-frontend-runtime"],
    "stalled":     ["cancel-command", "run-chain:health-check"],
    "permission":  ["check-permissions", "run-chain:health-check"],
    "success":     [],
    "info":        [],
};

const ROOT_CAUSES = {
    "fatal":       "process crash or OOM — runtime may be unstable",
    "transient":   "network or connection issue — typically self-resolving",
    "dependency":  "missing or mismatched npm dependency",
    "build-error": "compilation or type error in source code",
    "stalled":     "command is waiting for input or file changes",
    "permission":  "insufficient file system or process permissions",
    "success":     null,
    "info":        null,
};

/**
 * Classify a block of terminal output.
 * @param {string} output — raw terminal stdout/stderr text
 * @returns {{ category, severity, rootCause, suggestions, summary, matched }}
 */
function classify(output = "") {
    if (!output || !output.trim()) {
        return { category: "info", severity: "info", rootCause: null, suggestions: [], summary: "empty output" };
    }

    // Check each classifier in order (first match wins for severity priority)
    for (const cls of CLASSIFIERS) {
        if (cls.pattern.test(output)) {
            return {
                category:    cls.category,
                severity:    cls.severity,
                rootCause:   ROOT_CAUSES[cls.category] || null,
                suggestions: RECOVERY_SUGGESTIONS[cls.category] || [],
                summary:     _buildSummary(output, cls.category),
                matched:     true,
            };
        }
    }

    return {
        category:  "info",
        severity:  "info",
        rootCause: null,
        suggestions: [],
        summary:   _buildSummary(output, "info"),
        matched:   false,
    };
}

function _buildSummary(output, category) {
    // Extract first meaningful line for summary
    const lines = output.split("\n").map(l => l.trim()).filter(l => l && l.length > 3);
    const firstMeaningful = lines[0] || "";
    const truncated = firstMeaningful.slice(0, 120);
    return `[${category}] ${truncated}`;
}

/**
 * Classify multiple outputs and return an aggregated report.
 * @param {string[]} outputs
 * @returns {{ dominant: string, classifications: Array, hasFatal: boolean, hasErrors: boolean }}
 */
function classifyMany(outputs = []) {
    const results = outputs.map(classify);
    const hasFatal  = results.some(r => r.category === "fatal");
    const hasErrors = results.some(r => r.severity === "error" || r.severity === "critical");

    // Dominant = worst severity
    const ORDER = { critical: 0, error: 1, warn: 2, info: 3 };
    const dominant = results.sort((a, b) => (ORDER[a.severity] ?? 4) - (ORDER[b.severity] ?? 4))[0]?.category || "info";

    return { dominant, classifications: results, hasFatal, hasErrors };
}

module.exports = { classify, classifyMany };
