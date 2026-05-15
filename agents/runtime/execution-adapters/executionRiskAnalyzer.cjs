"use strict";
/**
 * executionRiskAnalyzer — rule-based risk scoring for commands, filesystem
 * operations, and workflows.
 *
 * analyzeCommandRisk(spec)     → { riskScore, riskClass, factors }
 * analyzeFilesystemRisk(spec)  → { riskScore, riskClass, factors }
 * analyzeWorkflowRisk(spec)    → { riskScore, riskClass, factors }
 * computeCompositeRisk(spec)   → { compositeScore, riskClass, breakdown }
 * getRiskMetrics()             → RiskMetrics
 * reset()
 *
 * Risk classes:
 *   safe       0.00 – 0.30
 *   guarded    0.30 – 0.50
 *   elevated   0.50 – 0.70
 *   critical   0.70 – 0.85
 *   restricted 0.85 – 1.00
 */

const RISK_CLASS_THRESHOLDS = [
    { class: "restricted", min: 0.85 },
    { class: "critical",   min: 0.70 },
    { class: "elevated",   min: 0.50 },
    { class: "guarded",    min: 0.30 },
    { class: "safe",       min: 0.00 },
];

// Base risk per command family (matched by prefix)
const COMMAND_BASE_RISK = {
    "echo":              0.02,
    "pwd":               0.02,
    "date":              0.02,
    "whoami":            0.02,
    "uname":             0.03,
    "env":               0.10,
    "ls":                0.05,
    "cat":               0.10,
    "head":              0.08,
    "tail":              0.08,
    "grep":              0.10,
    "find":              0.20,
    "git status":        0.05,
    "git diff":          0.10,
    "git log":           0.08,
    "git branch":        0.08,
    "git show":          0.10,
    "node --version":    0.03,
    "npm --version":     0.03,
    "npm list":          0.10,
    "docker ps":         0.15,
    "docker inspect":    0.15,
    "docker logs":       0.12,
};

// High-risk argument patterns
const RISKY_ARG_PATTERNS = [
    { pattern: /\*/, factor: 0.10, label: "wildcard_expansion" },
    { pattern: /^\//, factor: 0.15, label: "absolute_path_argument" },
    { pattern: /\.\./,  factor: 0.25, label: "path_traversal_in_arg" },
    { pattern: /[!@#%^&]/, factor: 0.05, label: "special_char_in_arg" },
    { pattern: /password|secret|key|token/i, factor: 0.30, label: "sensitive_keyword_in_arg" },
];

// Filesystem risk modifiers
const FS_OPERATION_RISK = { read: 0.05, list: 0.05, write: 0.25, delete: 0.50 };
const FS_PATH_DEPTH_SAFE_MINIMUM = 3;   // paths with ≥3 segments get lower risk

let _analysisCount = 0;
let _riskHistory   = [];

function _classify(score) {
    for (const { class: cls, min } of RISK_CLASS_THRESHOLDS) {
        if (score >= min) return cls;
    }
    return "safe";
}

function _clamp(v) { return Math.min(1.0, Math.max(0.0, v)); }

// ── analyzeCommandRisk ────────────────────────────────────────────────

function analyzeCommandRisk(spec = {}) {
    const { command = null } = spec;
    if (!command) return { riskScore: 1.0, riskClass: "restricted", factors: ["command_missing"] };

    const trimmed = command.trim();
    const factors  = [];
    let   score    = 0.5;   // default for unknown commands

    // Base risk from command family
    let baseRisk = null;
    for (const [prefix, risk] of Object.entries(COMMAND_BASE_RISK)) {
        if (trimmed === prefix || trimmed.startsWith(prefix + " ")) {
            baseRisk = risk;
            break;
        }
    }

    if (baseRisk !== null) {
        score = baseRisk;
        factors.push(`base_risk:${baseRisk}`);
    } else {
        factors.push("unknown_command_base_risk:0.5");
    }

    // Argument analysis
    const parts = trimmed.split(/\s+/);
    const args  = parts.slice(1);

    // Argument count penalty
    if (args.length > 5) {
        const penalty = Math.min(0.15, (args.length - 5) * 0.02);
        score += penalty;
        factors.push(`arg_count_penalty:${penalty.toFixed(2)}`);
    }

    // Risky arg pattern detection
    for (const arg of args) {
        for (const { pattern, factor, label } of RISKY_ARG_PATTERNS) {
            if (pattern.test(arg)) {
                score += factor;
                factors.push(label);
                break;
            }
        }
    }

    const riskScore = _clamp(score);
    _analysisCount++;
    _riskHistory.push({ type: "command", riskScore, command: trimmed });

    return { riskScore: Math.round(riskScore * 1000) / 1000, riskClass: _classify(riskScore), factors };
}

// ── analyzeFilesystemRisk ─────────────────────────────────────────────

function analyzeFilesystemRisk(spec = {}) {
    const { path = null, operation = "read" } = spec;
    if (!path) return { riskScore: 1.0, riskClass: "restricted", factors: ["path_missing"] };

    const factors = [];
    let   score   = FS_OPERATION_RISK[operation] ?? 0.20;
    factors.push(`operation_base:${score}`);

    // Path depth — deeper paths are generally safer
    const segments = path.split("/").filter(s => s.length > 0);
    if (segments.length < FS_PATH_DEPTH_SAFE_MINIMUM) {
        const penalty = (FS_PATH_DEPTH_SAFE_MINIMUM - segments.length) * 0.10;
        score += penalty;
        factors.push(`shallow_path_penalty:${penalty.toFixed(2)}`);
    }

    // Sensitive filename patterns
    if (/config|settings|\.json$/i.test(path)) {
        score += 0.05;
        factors.push("config_file_bonus");
    }
    if (/\.env|\.pem|\.key|secret|password|credential/i.test(path)) {
        score += 0.40;
        factors.push("sensitive_path_detected");
    }
    if (path.includes("../")) {
        score += 0.40;
        factors.push("path_traversal_detected");
    }

    const riskScore = _clamp(score);
    _analysisCount++;
    _riskHistory.push({ type: "filesystem", riskScore, path, operation });

    return { riskScore: Math.round(riskScore * 1000) / 1000, riskClass: _classify(riskScore), factors };
}

// ── analyzeWorkflowRisk ───────────────────────────────────────────────

function analyzeWorkflowRisk(spec = {}) {
    const {
        workflowId       = null,
        trustScore       = 1.0,
        recoveryMode     = false,
        cascadeDepth     = 0,
        failureRate      = 0,
    } = spec;

    const factors = [];
    let   score   = 1.0 - trustScore;   // base: inverse of trust
    factors.push(`trust_inversion:${score.toFixed(2)}`);

    if (recoveryMode) { score += 0.15; factors.push("recovery_mode_penalty:0.15"); }
    if (cascadeDepth > 0) {
        const d = Math.min(0.20, cascadeDepth * 0.05);
        score += d;
        factors.push(`cascade_depth_penalty:${d.toFixed(2)}`);
    }
    if (failureRate > 0.3) {
        const p = Math.min(0.30, failureRate);
        score += p;
        factors.push(`failure_rate_penalty:${p.toFixed(2)}`);
    }

    const riskScore = _clamp(score);
    _analysisCount++;
    _riskHistory.push({ type: "workflow", riskScore, workflowId });

    return { riskScore: Math.round(riskScore * 1000) / 1000, riskClass: _classify(riskScore), factors };
}

// ── computeCompositeRisk ──────────────────────────────────────────────

function computeCompositeRisk(spec = {}) {
    const {
        commandScore    = 0,
        filesystemScore = 0,
        workflowScore   = 0,
        authorityLevel  = "operator",
    } = spec;

    // Weighted composite: command 40%, filesystem 35%, workflow 25%
    const composite = commandScore * 0.40 + filesystemScore * 0.35 + workflowScore * 0.25;

    // Authority bonus: higher authority → slight risk reduction
    const { AUTHORITY_RANK } = require("./adapterPermissionBridge.cjs");
    const rank   = AUTHORITY_RANK[authorityLevel] ?? 1;
    const bonus  = Math.min(0.10, rank * 0.02);
    const final  = _clamp(composite - bonus);

    return {
        compositeScore: Math.round(final * 1000) / 1000,
        riskClass: _classify(final),
        breakdown: {
            commandScore, filesystemScore, workflowScore,
            authorityBonus: -bonus,
        },
    };
}

// ── getRiskMetrics ────────────────────────────────────────────────────

function getRiskMetrics() {
    const byType = {};
    for (const r of _riskHistory) byType[r.type] = (byType[r.type] ?? 0) + 1;
    const scores = _riskHistory.map(r => r.riskScore);
    const avgScore = scores.length > 0 ? scores.reduce((s, v) => s + v, 0) / scores.length : 0;

    return {
        totalAnalyses: _analysisCount,
        byType,
        avgRiskScore:  Math.round(avgScore * 1000) / 1000,
        maxRiskScore:  scores.length > 0 ? Math.max(...scores) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _analysisCount = 0;
    _riskHistory   = [];
}

module.exports = {
    RISK_CLASS_THRESHOLDS, COMMAND_BASE_RISK,
    analyzeCommandRisk, analyzeFilesystemRisk,
    analyzeWorkflowRisk, computeCompositeRisk,
    getRiskMetrics, reset,
};
