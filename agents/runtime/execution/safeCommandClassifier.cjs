"use strict";
/**
 * safeCommandClassifier — classify shell commands by risk and detect dangerous patterns.
 *
 * classifyCommand(cmd)          → ClassificationResult
 * getSafetyScore(cmd)           → number (0–100, higher = safer)
 * detectDangerousPatterns(cmd)  → DangerPattern[]
 * getCommandCategory(cmd)       → Category
 * reset()
 */

const CATEGORIES = ["read_only", "write_operation", "destructive", "networked", "privileged", "automation"];

// Each pattern deducts from the 100-point safety score. Score < 30 → critical risk.
const DANGEROUS_PATTERNS = [
    { id: "rm_rf",           pattern: /\brm\b[^|;&\n]*-[a-z]*r[a-z]*f/i,                       severity: "critical", deduct: 80,  description: "Recursive force delete" },
    { id: "rm_recursive",    pattern: /\brm\b[^|;&\n]*-[a-z]*r\b/i,                             severity: "high",     deduct: 50,  description: "Recursive delete without force" },
    { id: "fork_bomb",       pattern: /:\(\)\s*\{[^}]*:\s*\|[^}]*:.*&/,                         severity: "critical", deduct: 100, description: "Fork bomb" },
    { id: "pipe_to_shell",   pattern: /\|\s*(bash|sh|zsh|fish|dash)\b/i,                         severity: "critical", deduct: 90,  description: "Pipe to shell interpreter" },
    { id: "sudo",            pattern: /\bsudo\b/i,                                               severity: "high",     deduct: 40,  description: "Privileged execution via sudo" },
    { id: "chmod_world",     pattern: /\bchmod\b.*?(\b777\b|\b666\b|\ba\+[wx])/i,               severity: "high",     deduct: 40,  description: "World-writable permissions" },
    { id: "chmod_recursive", pattern: /\bchmod\b[^|;&\n]*-[rR]\b/i,                             severity: "medium",   deduct: 25,  description: "Recursive permission change" },
    { id: "killall",         pattern: /\bkillall\b/i,                                             severity: "high",     deduct: 50,  description: "Kill all matching processes" },
    { id: "kill_force",      pattern: /\bkill\b[^|;&\n]*-9\b/i,                                  severity: "medium",   deduct: 30,  description: "Force-kill via SIGKILL" },
    { id: "docker_prune",    pattern: /\bdocker\b[^|;&\n]*(system\s+)?prune\b/i,                severity: "critical", deduct: 80,  description: "Prune all Docker resources" },
    { id: "docker_rm_force", pattern: /\bdocker\b[^|;&\n]*(rm|rmi|container\s+rm)\b[^|;&\n]*-f\b/i, severity: "high", deduct: 50, description: "Force-remove Docker resource" },
    { id: "dd_wipe",         pattern: /\bdd\b[^|;&\n]*of=\/dev\//i,                             severity: "critical", deduct: 100, description: "Write directly to block device" },
    { id: "mkfs",            pattern: /\bmkfs\b/i,                                               severity: "critical", deduct: 100, description: "Format filesystem" },
    { id: "force_flag",      pattern: /\s--force\b/i,                                            severity: "low",      deduct: 15,  description: "Global --force flag" },
    { id: "output_redirect", pattern: /(?<![<>])>(?![>=])/,                                      severity: "low",      deduct: 10,  description: "Output redirect (may overwrite)" },
    { id: "curl_shell",      pattern: /\bcurl\b[^|;&\n]*\|\s*(bash|sh)\b/i,                     severity: "critical", deduct: 90,  description: "Remote code execution via curl" },
    { id: "wget_shell",      pattern: /\bwget\b[^|;&\n]*\|\s*(bash|sh)\b/i,                     severity: "critical", deduct: 90,  description: "Remote code execution via wget" },
    { id: "shred",           pattern: /\bshred\b/i,                                              severity: "high",     deduct: 60,  description: "Secure file deletion" },
    { id: "truncate",        pattern: /\btruncate\b/i,                                           severity: "medium",   deduct: 30,  description: "File truncation" },
];

function classifyCommand(cmd = "") {
    const patterns  = detectDangerousPatterns(cmd);
    const category  = getCommandCategory(cmd);
    const score     = getSafetyScore(cmd);
    const riskLevel = _scoreToRisk(score);

    return {
        command:           cmd.slice(0, 200),
        category,
        riskLevel,
        safetyScore:       score,
        dangerousPatterns: patterns,
        safe:              patterns.length === 0,
        requiresApproval:  riskLevel === "high" || riskLevel === "critical",
        ts:                new Date().toISOString(),
    };
}

function getSafetyScore(cmd = "") {
    const patterns = detectDangerousPatterns(cmd);
    let score = 100;
    for (const p of patterns) score -= p.deduct;
    return Math.max(0, score);
}

function detectDangerousPatterns(cmd = "") {
    const found = [];
    for (const dp of DANGEROUS_PATTERNS) {
        if (dp.pattern.test(cmd)) {
            found.push({ id: dp.id, severity: dp.severity, deduct: dp.deduct, description: dp.description });
        }
    }
    return found;
}

function getCommandCategory(cmd = "") {
    const c = cmd.trim();
    if (_any(c, [/\bsudo\b/i, /\bchmod\b/i, /\bchown\b/i, /\bchgrp\b/i, /\bsu\s/i, /\bmount\b/i, /\bumount\b/i]))
        return "privileged";
    if (_any(c, [/\brm\s/i, /\brmdir\b/i, /\btruncate\b/i, /\bshred\b/i, /\bmkfs\b/i, /\bwipefs\b/i]) ||
        /\bdd\b[^|;&\n]*of=/i.test(c))
        return "destructive";
    if (_any(c, [/\bcurl\b/i, /\bwget\b/i, /\bssh\s/i, /\bscp\s/i, /\bnmap\b/i, /\bping\b/i, /\btelnet\b/i, /\bnc\s/i]))
        return "networked";
    if (_any(c, [/\bcrontab\b/i, /\bnohup\b/i, /\bscreen\b/i, /\btmux\b/i]) ||
        /\.sh\b/.test(c) || /\s&\s*$/.test(c))
        return "automation";
    if (_any(c, [/\bcp\s/i, /\bmv\s/i, /\btouch\s/i, /\bmkdir\b/i, /\btee\b/i]) ||
        /\bsed\s+-i\b/i.test(c) || /(?<![<>])>(?![>=])/.test(c))
        return "write_operation";
    if (/^\s*(cat|ls|echo|grep|find|head|tail|wc|diff|stat|which|env|printenv|pwd|whoami|date|uname|ps|df|du|lsof)\b/i.test(c))
        return "read_only";
    return "write_operation";
}

function _any(cmd, patterns) {
    return patterns.some(p => p.test(cmd));
}

function _scoreToRisk(score) {
    if (score >= 80) return "low";
    if (score >= 60) return "medium";
    if (score >= 30) return "high";
    return "critical";
}

function reset() { /* stateless — no-op */ }

module.exports = {
    CATEGORIES, DANGEROUS_PATTERNS,
    classifyCommand, getSafetyScore, detectDangerousPatterns, getCommandCategory,
    reset,
};
