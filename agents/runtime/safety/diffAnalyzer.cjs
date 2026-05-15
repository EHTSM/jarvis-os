"use strict";
/**
 * diffAnalyzer — risk-score a code diff before applying it.
 *
 * analyzeDiff(diffText)      → { riskScore, linesAdded, linesRemoved, filesChanged,
 *                                highRiskFiles, riskFactors }
 * detectHighRiskFiles(files) → [{ path, reason }]
 * riskLevel(score)           → "low" | "medium" | "high" | "critical"
 */

const path = require("path");

const HIGH_RISK_PATTERNS = [
    { reason: "database_migration", rx: /migrat/i },
    { reason: "package_manifest",   rx: /(package\.json|yarn\.lock|package-lock\.json)$/ },
    { reason: "environment_config", rx: /\.(env|config|cfg|ini)$/i },
    { reason: "auth_module",        rx: /(auth|password|token|secret|credential)/i },
    { reason: "entry_point",        rx: /(index|main|server|app)\.[cm]?[jt]s$/i },
    { reason: "ci_pipeline",        rx: /\.(github|gitlab|circleci)\//i },
    { reason: "infrastructure",     rx: /(terraform|ansible|helm|k8s|kubernetes)/i },
    { reason: "lock_file",          rx: /\.lock$/i },
    { reason: "schema_definition",  rx: /(schema|model|entity)\.[cm]?[jt]s$/i },
    { reason: "test_config",        rx: /(jest|vitest|mocha)\.config\.[cm]?[jt]s$/i },
];

const FILE_RX  = /^diff --git a\/(.+?) b\//m;
const ADD_RX   = /^\+[^+]/gm;
const DEL_RX   = /^-[^-]/gm;

function parseDiff(diffText) {
    const files   = [];
    const chunks  = diffText.split(/^diff --git /m).filter(Boolean);

    for (const chunk of chunks) {
        const match = /^a\/(.+?) b\//.exec(chunk);
        if (!match) continue;
        const filePath   = match[1];
        const linesAdded   = (chunk.match(ADD_RX) || []).length;
        const linesRemoved = (chunk.match(DEL_RX) || []).length;
        files.push({ path: filePath, linesAdded, linesRemoved });
    }
    return files;
}

function detectHighRiskFiles(files) {
    const results = [];
    for (const f of files) {
        const fp = typeof f === "string" ? f : f.path;
        for (const { reason, rx } of HIGH_RISK_PATTERNS) {
            if (rx.test(fp)) {
                results.push({ path: fp, reason });
                break;
            }
        }
    }
    return results;
}

function analyzeDiff(diffText) {
    if (typeof diffText !== "string" || diffText.trim() === "") {
        return { riskScore: 0, linesAdded: 0, linesRemoved: 0, filesChanged: 0,
                 highRiskFiles: [], riskFactors: [] };
    }

    const files        = parseDiff(diffText);
    const linesAdded   = files.reduce((s, f) => s + f.linesAdded,   0);
    const linesRemoved = files.reduce((s, f) => s + f.linesRemoved, 0);
    const highRiskFiles = detectHighRiskFiles(files);
    const riskFactors   = [];

    let score = 0;

    // Volume factors
    if (linesAdded + linesRemoved > 500) { score += 25; riskFactors.push("large_diff_volume"); }
    else if (linesAdded + linesRemoved > 100) { score += 10; riskFactors.push("medium_diff_volume"); }

    if (files.length > 20) { score += 20; riskFactors.push("many_files_changed"); }
    else if (files.length > 10) { score += 8; riskFactors.push("multiple_files_changed"); }

    // High-risk file factors
    for (const { reason } of highRiskFiles) {
        score += 15;
        if (!riskFactors.includes(reason)) riskFactors.push(reason);
    }

    // Deletion-heavy changes
    const totalLines = linesAdded + linesRemoved;
    if (totalLines > 0 && linesRemoved / totalLines > 0.7) {
        score += 15;
        riskFactors.push("deletion_heavy");
    }

    score = Math.min(100, score);

    return {
        riskScore:    score,
        linesAdded,
        linesRemoved,
        filesChanged: files.length,
        highRiskFiles,
        riskFactors,
    };
}

function riskLevel(score) {
    if (score >= 75) return "critical";
    if (score >= 50) return "high";
    if (score >= 25) return "medium";
    return "low";
}

module.exports = { analyzeDiff, detectHighRiskFiles, riskLevel, HIGH_RISK_PATTERNS };
