"use strict";
/**
 * planningRules — deterministic constants and pure rule functions.
 * Same inputs always produce same outputs (no randomness, no I/O).
 */

const UNSAFE_PATTERNS = [
    { pattern: /rm\s+-[a-z]*r[a-z]*f\s+\//i,   label: "destructive_rm_root",  severity: "critical" },
    { pattern: />\s*\/dev\/sd/,                  label: "disk_overwrite",        severity: "critical" },
    { pattern: /curl[^|]+\|\s*bash/,             label: "curl_pipe_bash",        severity: "high" },
    { pattern: /wget[^|]+\|\s*sh/,               label: "wget_pipe_sh",          severity: "high" },
    { pattern: /sudo\s+rm/,                      label: "sudo_rm",               severity: "high" },
    { pattern: /chmod\s+777/,                    label: "insecure_chmod",        severity: "medium" },
    { pattern: /\beval\s*\(/,                    label: "eval_call",             severity: "medium" },
    { pattern: /process\.exit/,                  label: "forced_exit",           severity: "low" },
    { pattern: /DROP\s+TABLE/i,                  label: "sql_drop_table",        severity: "high" },
    { pattern: /TRUNCATE\s+TABLE/i,              label: "sql_truncate",          severity: "medium" },
];

const RISK_WEIGHTS = {
    critical: 40,
    high:     20,
    medium:   10,
    low:       5,
    unknown:   3,
};

const COMPLEXITY_WEIGHTS = {
    per_step:         5,
    per_dependency:   3,
    per_risk_factor: 10,
};

const THRESHOLDS = {
    MAX_RISK_SCORE:    100,
    BLOCK_CONFIDENCE:   40,
    BLOCK_RISK:         70,
    SANDBOX_CONFIDENCE: 60,
    STAGED_CONFIDENCE:  80,
    MAX_STEPS_PER_PLAN: 50,
};

// ── assessCommandRisk ─────────────────────────────────────────────────

function assessCommandRisk(command = "") {
    const matched = [];
    for (const { pattern, label, severity } of UNSAFE_PATTERNS) {
        if (pattern.test(command)) {
            matched.push({ label, severity, risk: RISK_WEIGHTS[severity] ?? RISK_WEIGHTS.unknown });
        }
    }
    return {
        command,
        risk:     Math.min(100, matched.reduce((s, m) => s + m.risk, 0)),
        patterns: matched,
        safe:     matched.length === 0,
    };
}

// ── normalizeStepOrder ────────────────────────────────────────────────
// Fewer deps first, then alphabetical by id — fully deterministic.

function normalizeStepOrder(steps = []) {
    return [...steps].sort((a, b) => {
        const depDiff = (a.dependsOn?.length ?? 0) - (b.dependsOn?.length ?? 0);
        return depDiff !== 0 ? depDiff : (a.id ?? "").localeCompare(b.id ?? "");
    });
}

// ── validateTaskStructure ─────────────────────────────────────────────

function validateTaskStructure(task = {}) {
    const errors = [];
    if (!task.id)   errors.push("task.id is required");
    if (!task.name) errors.push("task.name is required");
    if (!Array.isArray(task.steps) || task.steps.length === 0) {
        errors.push("task.steps must be a non-empty array");
    } else {
        const ids = new Set(task.steps.map(s => s.id));
        for (const step of task.steps) {
            if (!step.id)   errors.push(`step missing id`);
            if (!step.name) errors.push(`step ${step.id ?? "?"} missing name`);
            for (const dep of (step.dependsOn ?? [])) {
                if (!ids.has(dep)) errors.push(`step "${step.id}" depends on unknown step: "${dep}"`);
            }
        }
    }
    return { valid: errors.length === 0, errors };
}

// ── estimateComplexity ────────────────────────────────────────────────

function estimateComplexity(steps = []) {
    const depCount  = steps.reduce((s, st) => s + (st.dependsOn?.length ?? 0), 0);
    const riskCount = steps.filter(s => (s.riskLevel ?? "low") !== "low").length;
    return (
        steps.length * COMPLEXITY_WEIGHTS.per_step +
        depCount     * COMPLEXITY_WEIGHTS.per_dependency +
        riskCount    * COMPLEXITY_WEIGHTS.per_risk_factor
    );
}

module.exports = {
    UNSAFE_PATTERNS,
    RISK_WEIGHTS,
    COMPLEXITY_WEIGHTS,
    THRESHOLDS,
    assessCommandRisk,
    normalizeStepOrder,
    validateTaskStructure,
    estimateComplexity,
};
