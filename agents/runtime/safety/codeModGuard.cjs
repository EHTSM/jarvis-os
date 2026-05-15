"use strict";
/**
 * codeModGuard — orchestrate safety checks before any code modification.
 *
 * checkBefore(filePath, newContent, opts?)
 *   → { safe, blockers[], warnings[], riskScore }
 *   Runs: syntaxValidator + diffAnalyzer + filesystemGuard
 *   Blockers prevent write; warnings are informational.
 *
 * guardedWrite(filePath, newContent, opts?)
 *   → { written, blockers[], warnings[], riskScore, rolledBack? }
 *   Writes only if checkBefore passes; auto-restores backup on post-write failure.
 */

const fs   = require("fs");
const path = require("path");

const sv  = require("./syntaxValidator.cjs");
const da  = require("./diffAnalyzer.cjs");
const fg  = require("../security/filesystemGuard.cjs");

const RISK_WRITE_THRESHOLD = 80;   // block writes above this risk score

function _buildDiff(oldContent, newContent, filePath) {
    const base = path.basename(filePath);
    const oldLines = (oldContent || "").split("\n");
    const newLines = (newContent || "").split("\n");

    const added   = newLines.filter(l => !oldLines.includes(l)).length;
    const removed = oldLines.filter(l => !newLines.includes(l)).length;

    // Minimal synthetic diff for analyzeDiff
    return [
        `diff --git a/${base} b/${base}`,
        `--- a/${base}`,
        `+++ b/${base}`,
        ...newLines.filter(l => !oldLines.includes(l)).slice(0, 50).map(l => `+${l}`),
        ...oldLines.filter(l => !newLines.includes(l)).slice(0, 50).map(l => `-${l}`),
    ].join("\n");
}

function checkBefore(filePath, newContent, opts = {}) {
    const blockers = [];
    const warnings = [];

    // 1. Filesystem guard
    const fgCheck = fg.checkPath(filePath, "write");
    if (!fgCheck.allowed) {
        blockers.push(`filesystem_guard: ${fgCheck.reason}`);
    }

    // 2. Syntax validation (JS/CJS only)
    const ext = path.extname(filePath).toLowerCase();
    if ([".js", ".cjs", ".mjs"].includes(ext)) {
        const sv_result = sv.validate(newContent, filePath);
        if (!sv_result.valid) {
            for (const e of sv_result.errors) {
                blockers.push(`syntax_error: ${e.message}`);
            }
        }
        warnings.push(...sv_result.warnings);
    }

    // 3. Diff risk analysis
    let riskScore = 0;
    try {
        const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
        const diff     = _buildDiff(existing, newContent, filePath);
        const analysis = da.analyzeDiff(diff);
        riskScore      = analysis.riskScore;

        if (analysis.highRiskFiles.length > 0) {
            warnings.push(...analysis.highRiskFiles.map(f => `high_risk_file: ${f.reason}`));
        }
        if (riskScore >= RISK_WRITE_THRESHOLD && !opts.allowHighRisk) {
            blockers.push(`risk_score_too_high: ${riskScore} >= ${RISK_WRITE_THRESHOLD}`);
        }
    } catch { /* diff analysis is best-effort */ }

    return { safe: blockers.length === 0, blockers, warnings, riskScore };
}

function guardedWrite(filePath, newContent, opts = {}) {
    const check = checkBefore(filePath, newContent, opts);

    if (!check.safe) {
        return { written: false, ...check };
    }

    // Backup existing file
    let backup = null;
    if (fs.existsSync(filePath)) {
        backup = `${filePath}.guard_bak.${Date.now()}`;
        fs.copyFileSync(filePath, backup);
    }

    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, newContent, "utf8");

        // Clean up backup on success
        if (backup) try { fs.unlinkSync(backup); } catch { /* ignore */ }

        return { written: true, ...check };
    } catch (e) {
        // Rollback
        let rolledBack = false;
        if (backup && fs.existsSync(backup)) {
            try { fs.copyFileSync(backup, filePath); fs.unlinkSync(backup); rolledBack = true; }
            catch { /* rollback failed */ }
        }
        check.blockers.push(`write_failed: ${e.message}`);
        return { written: false, rolledBack, ...check };
    }
}

module.exports = { checkBefore, guardedWrite, RISK_WRITE_THRESHOLD };
