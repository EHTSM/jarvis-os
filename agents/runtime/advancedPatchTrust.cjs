"use strict";
/**
 * Phase 632 — Advanced Patch Trust System
 *
 * Tracks patch success rates, rollback frequency, validation quality,
 * dependency safety, replay-linked survivability.
 * Generates patch trust tiers, rollback-risk indicators, execution confidence.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/advanced-patch-trust.json");
const MAX_RECORDS = 200;
const TTL_MS      = 30 * 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { records: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.records   = (db.records || []).filter(r => r.ts > cutoff).slice(0, MAX_RECORDS);
}

// ── Record patch outcome ──────────────────────────────────────────────────────

function recordPatchOutcome(opts = {}) {
    const {
        patchId       = null,
        filePath      = "",
        success       = true,
        rolledBack    = false,
        validationPassed = true,
        depSafe       = true,
        replayId      = null,
        sessionId     = null,
        linesChanged  = 0,
    } = opts;

    const db = _load(); _prune(db);
    db.records.unshift({
        patchId,
        filePath:  (filePath || "").slice(0, 200),
        success,
        rolledBack,
        validationPassed,
        depSafe,
        replayId,
        sessionId,
        linesChanged,
        ts: Date.now(),
    });
    _save(db);

    // Record trust signal
    const tl = _tryRequire("./operationalTrustLayer.cjs");
    if (tl) {
        if (success && !rolledBack) tl.recordSignal("patch-applied",   { detail: filePath });
        else                        tl.recordSignal("patch-rejected",  { detail: filePath });
    }

    return { ok: true };
}

// ── Trust tiers ───────────────────────────────────────────────────────────────

const TRUST_TIERS = [
    { tier: "platinum", minScore: 85, label: "Platinum — highly reliable, low rollback risk" },
    { tier: "gold",     minScore: 70, label: "Gold — reliable, occasional validation failures" },
    { tier: "silver",   minScore: 55, label: "Silver — moderate reliability, some rollbacks" },
    { tier: "bronze",   minScore: 40, label: "Bronze — unreliable, high rollback risk" },
    { tier: "blocked",  minScore: 0,  label: "Blocked — too many rollbacks or failures" },
];

function computePatchTrustScore(records = []) {
    if (records.length === 0) return 65; // default

    const success    = records.filter(r => r.success && !r.rolledBack).length;
    const rollbacks  = records.filter(r => r.rolledBack).length;
    const valFailed  = records.filter(r => !r.validationPassed).length;
    const depUnsafe  = records.filter(r => !r.depSafe).length;
    const n          = records.length;

    const successRate = success / n;
    const rollbackPenalty = (rollbacks / n) * 30;
    const valPenalty      = (valFailed / n) * 15;
    const depPenalty      = (depUnsafe / n) * 10;

    return Math.max(5, Math.min(95, Math.round(successRate * 100 - rollbackPenalty - valPenalty - depPenalty)));
}

function patchTrustTier(filePath = null, { windowDays = 30 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const records = db.records.filter(r => r.ts > cutoff && (!filePath || r.filePath === filePath));

    const score = computePatchTrustScore(records);
    const tier  = TRUST_TIERS.find(t => score >= t.minScore) || TRUST_TIERS[TRUST_TIERS.length - 1];

    const rollbackRate  = records.length > 0 ? Math.round(records.filter(r => r.rolledBack).length / records.length * 100) : 0;
    const rollbackRisk  = rollbackRate >= 30 ? "high" : rollbackRate >= 15 ? "medium" : "low";

    return {
        ok:          true,
        filePath,
        score,
        tier:        tier.tier,
        label:       tier.label,
        rollbackRate: rollbackRate + "%",
        rollbackRisk,
        recordCount: records.length,
        summary:     `Patch trust: ${tier.tier} (${score}) | Rollback risk: ${rollbackRisk}`,
    };
}

// ── Rollback risk indicators ──────────────────────────────────────────────────

function rollbackRiskIndicators({ windowDays = 7 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const recent = db.records.filter(r => r.ts > cutoff);

    const total      = recent.length;
    const rollbacks  = recent.filter(r => r.rolledBack).length;
    const valFailed  = recent.filter(r => !r.validationPassed).length;
    const depUnsafe  = recent.filter(r => !r.depSafe).length;

    const indicators = [];
    if (total === 0) return { ok: true, indicators: [], risk: "unknown", total };

    if (rollbacks / total >= 0.3)   indicators.push({ signal: "high-rollback-rate",  value: Math.round(rollbacks / total * 100) + "%", severity: "high" });
    if (valFailed / total >= 0.2)   indicators.push({ signal: "validation-failures",  value: Math.round(valFailed / total * 100) + "%", severity: "medium" });
    if (depUnsafe / total >= 0.1)   indicators.push({ signal: "dep-safety-issues",    value: Math.round(depUnsafe / total * 100) + "%", severity: "medium" });

    const risk = indicators.some(i => i.severity === "high") ? "high" : indicators.length > 0 ? "medium" : "low";

    return { ok: true, total, rollbacks, valFailed, depUnsafe, indicators, risk };
}

// ── Execution confidence summary ──────────────────────────────────────────────

function executionConfidenceSummary({ windowDays = 30 } = {}) {
    const trust   = patchTrustTier(null, { windowDays });
    const risks   = rollbackRiskIndicators({ windowDays });

    // Pull from execution confidence module if available
    const ec = _tryRequire("./executionConfidence.cjs");
    let baseConf = null;
    if (ec) try { baseConf = ec.patchConfidence({ linesChanged: 50, filesSafe: true, replayDedup: true }); } catch {}

    return {
        ok:              true,
        patchTrust:      trust,
        rollbackRisk:    risks.risk,
        indicators:      risks.indicators,
        baseConfidence:  baseConf,
        recommendation:  trust.tier === "platinum" || trust.tier === "gold"
            ? "Patch execution safe to proceed"
            : trust.tier === "silver"
            ? "Review patch carefully before applying — moderate rollback risk"
            : "High rollback risk — request operator review before applying",
    };
}

module.exports = { recordPatchOutcome, patchTrustTier, rollbackRiskIndicators, executionConfidenceSummary, TRUST_TIERS };
