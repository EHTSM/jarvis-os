"use strict";
/**
 * operationScorer — numeric danger scoring for operations (0–100).
 *
 * scoreOperation(type, detail)  → { score, level, factors[] }
 * scoreCommand(command)         → { score, level, factors[] }
 * shouldEscalate(score)         → boolean
 *
 * Levels: low (0-24), medium (25-49), high (50-74), critical (75-100)
 * Escalation threshold: score >= 60
 */

const ESCALATION_THRESHOLD = 60;

const OPERATION_BASE_SCORES = {
    file_read:       5,
    file_write:     25,
    file_delete:    55,
    dir_delete:     70,
    command_exec:   40,
    network_call:   20,
    db_read:        10,
    db_write:       35,
    db_delete:      65,
    db_drop:        90,
    process_kill:   60,
    env_mutate:     50,
    secret_access:  70,
    git_push:       45,
    git_force_push: 80,
    deploy:         55,
    rollback:       45,
};

const COMMAND_RISK_PATTERNS = [
    { factor: "rm_recursive",    score: 40, rx: /\brm\s+-[a-zA-Z]*r/i },
    { factor: "rm_force",        score: 30, rx: /\brm\s+-[a-zA-Z]*f/i },
    { factor: "sudo",            score: 25, rx: /\bsudo\b/ },
    { factor: "curl_exec",       score: 35, rx: /curl.*\|\s*(ba)?sh/i },
    { factor: "dd_device",       score: 50, rx: /\bdd\b.*\/dev\//i },
    { factor: "chmod_777",       score: 20, rx: /chmod\s+777/ },
    { factor: "pipe_to_shell",   score: 30, rx: /\|\s*(ba)?sh\b/i },
    { factor: "process_kill",    score: 25, rx: /\bkill\s+-9/ },
    { factor: "env_export",      score: 15, rx: /\bexport\s+\w+=/ },
    { factor: "git_force_push",  score: 35, rx: /git\s+push\s+.*--force/ },
    { factor: "truncate_file",   score: 20, rx: />\s*[^\s]/ },
];

function scoreOperation(type, detail = {}) {
    const base    = OPERATION_BASE_SCORES[type] ?? 30;
    const factors = [];
    let   score   = base;

    // Modifier: path-based risk
    if (detail.path) {
        if (/(\.env|secrets?|\.ssh|private|auth)/i.test(detail.path)) {
            score += 25;
            factors.push("sensitive_path");
        }
        if (/\/(etc|sys|proc|boot)\//i.test(detail.path)) {
            score += 30;
            factors.push("system_path");
        }
    }

    // Modifier: bulk operations
    if (detail.bulk || detail.recursive) {
        score += 15;
        factors.push("bulk_operation");
    }

    // Modifier: irreversible
    if (detail.irreversible) {
        score += 20;
        factors.push("irreversible");
    }

    score = Math.min(100, Math.max(0, score));
    return { score, level: _level(score), factors };
}

function scoreCommand(command) {
    if (typeof command !== "string") return { score: 0, level: "low", factors: [] };

    const factors = [];
    let   score   = 10;   // base for any command execution

    for (const { factor, score: add, rx } of COMMAND_RISK_PATTERNS) {
        if (rx.test(command)) { score += add; factors.push(factor); }
    }

    score = Math.min(100, score);
    return { score, level: _level(score), factors };
}

function shouldEscalate(score) {
    return score >= ESCALATION_THRESHOLD;
}

function _level(score) {
    if (score >= 75) return "critical";
    if (score >= 50) return "high";
    if (score >= 25) return "medium";
    return "low";
}

module.exports = {
    scoreOperation, scoreCommand, shouldEscalate,
    ESCALATION_THRESHOLD, OPERATION_BASE_SCORES,
};
