"use strict";
/**
 * Phase 658 — Operator Trust Evolution
 *
 * Tracks successful autonomous flows, rollback effectiveness, debugging recovery quality,
 * deployment survivability, workflow trust progression.
 * Generates trust summaries, autonomy maturity scoring, operational confidence evolution.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/operator-trust-evolution.json");
const MAX_EVENTS = 500;
const TTL_MS     = 30 * 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { events: [], snapshots: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.events    = (db.events    || []).filter(e => e.ts > cutoff).slice(0, MAX_EVENTS);
    db.snapshots = (db.snapshots || []).slice(-90);
}

// ── Trust signal events ───────────────────────────────────────────────────────

const TRUST_IMPACTS = {
    "autonomous-flow-completed":  { impact: +3, domain: "autonomy",    description: "Autonomous flow succeeded" },
    "autonomous-flow-failed":     { impact: -2, domain: "autonomy",    description: "Autonomous flow failed" },
    "rollback-successful":        { impact: +4, domain: "deployment",  description: "Rollback succeeded" },
    "rollback-failed":            { impact: -4, domain: "deployment",  description: "Rollback failed" },
    "debug-recovery-succeeded":   { impact: +3, domain: "debugging",   description: "Debug recovery succeeded" },
    "debug-recovery-failed":      { impact: -2, domain: "debugging",   description: "Debug recovery failed" },
    "deploy-survived":            { impact: +3, domain: "deployment",  description: "Deployment survived health check" },
    "deploy-failed":              { impact: -3, domain: "deployment",  description: "Deployment failed post-deploy" },
    "patch-applied-cleanly":      { impact: +2, domain: "patch",       description: "Patch applied without issues" },
    "patch-rolled-back":          { impact: -3, domain: "patch",       description: "Patch required rollback" },
    "approval-discipline-kept":   { impact: +1, domain: "autonomy",    description: "Approval discipline maintained" },
    "approval-bypassed":          { impact: -8, domain: "autonomy",    description: "Approval bypassed (violation)" },
    "workflow-trust-validated":   { impact: +2, domain: "workflow",    description: "Workflow validated successfully" },
    "workflow-corrupted":         { impact: -5, domain: "workflow",    description: "Workflow state corrupted" },
};

function recordTrustEvent(type, { detail = "", sessionId = null } = {}) {
    const def = TRUST_IMPACTS[type];
    if (!def) return { ok: false, error: `Unknown trust event: ${type}` };
    const db = _load(); _prune(db);
    db.events.unshift({ type, domain: def.domain, impact: def.impact, detail: (detail || "").slice(0, 200), sessionId, ts: Date.now() });
    _save(db);
    return { ok: true, type, impact: def.impact };
}

// ── Trust progression ─────────────────────────────────────────────────────────

function trustProgression({ windowDays = 7 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 86400000;
    const events = db.events.filter(e => e.ts > cutoff);

    const BASE = 60;
    const totalImpact = events.reduce((sum, e) => {
        const ageDays = (Date.now() - e.ts) / 86400000;
        const weight  = Math.max(0.3, 1 - ageDays / windowDays);
        return sum + e.impact * weight;
    }, 0);

    const score = Math.max(5, Math.min(95, BASE + totalImpact));
    const level = score >= 80 ? "high" : score >= 60 ? "moderate" : score >= 40 ? "low" : "critical";

    // By domain
    const domains = ["autonomy", "deployment", "debugging", "patch", "workflow"];
    const byDomain = {};
    domains.forEach(d => {
        const dEvents = events.filter(e => e.domain === d);
        const dImpact = dEvents.reduce((s, e) => s + e.impact, 0);
        byDomain[d] = { events: dEvents.length, netImpact: dImpact, positive: dEvents.filter(e => e.impact > 0).length };
    });

    return {
        ok:        true,
        score:     Math.round(score),
        level,
        windowDays,
        eventCount: events.length,
        byDomain,
        trend:     totalImpact >= 0 ? "improving" : "declining",
    };
}

// ── Autonomy maturity scoring ─────────────────────────────────────────────────

function autonomyMaturityScore({ windowDays = 14 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowDays * 86400000;
    const events = db.events.filter(e => e.ts > cutoff && e.domain === "autonomy");

    const completions = events.filter(e => e.type === "autonomous-flow-completed").length;
    const failures    = events.filter(e => e.type === "autonomous-flow-failed").length;
    const violations  = events.filter(e => e.type === "approval-bypassed").length;
    const total       = completions + failures;

    const successRate = total > 0 ? Math.round(completions / total * 100) : null;
    const maturity    = violations > 0 ? "compromised" : successRate === null ? "no-data" : successRate >= 80 ? "mature" : successRate >= 60 ? "developing" : "early";

    // Cross-check with executionTrustEvolution if available
    const ete = _tryRequire("./executionTrustEvolution.cjs");
    let eteSafety = null;
    if (ete) { try { eteSafety = ete.autonomySafetyScore(); } catch {} }

    return {
        ok:           true,
        maturity,
        successRate:  successRate !== null ? `${successRate}%` : "no data",
        completions,
        failures,
        violations,
        eteSafetyScore: eteSafety?.score || null,
        summary:      `Autonomy maturity: ${maturity} (${successRate ?? "?"}% success, ${violations} violations)`,
    };
}

// ── Operational confidence evolution ──────────────────────────────────────────

function operationalConfidenceEvolution({ windowDays = 14 } = {}) {
    const progression = trustProgression({ windowDays });
    const maturity    = autonomyMaturityScore({ windowDays });

    const confScore = Math.round((progression.score * 0.6) + (maturity.successRate !== "no data" ? parseInt(maturity.successRate) * 0.4 : 0));
    const level     = confScore >= 75 ? "high" : confScore >= 55 ? "moderate" : "low";

    return {
        ok:           true,
        windowDays,
        score:        confScore,
        level,
        trustScore:   progression.score,
        trustLevel:   progression.level,
        maturity:     maturity.maturity,
        trend:        progression.trend,
        summary:      `Operational confidence: ${level} (${confScore}/100) — trust=${progression.level} maturity=${maturity.maturity}`,
    };
}

// ── Trust summary ─────────────────────────────────────────────────────────────

function trustSummary({ windowDays = 7 } = {}) {
    const progression = trustProgression({ windowDays });
    const maturity    = autonomyMaturityScore({ windowDays });
    const confidence  = operationalConfidenceEvolution({ windowDays });

    // Daily snapshot
    const db = _load();
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const todayCount = db.events.filter(e => e.ts > cutoff).length;
    db.snapshots.push({ date: today, score: progression.score, level: progression.level, events: todayCount, ts: Date.now() });
    db.snapshots = db.snapshots.slice(-90);
    _save(db);

    return {
        ok:         true,
        windowDays,
        trust:      progression,
        maturity,
        confidence,
        todayEvents: todayCount,
        summary:    `Trust evolution: score=${progression.score} maturity=${maturity.maturity} confidence=${confidence.level}`,
    };
}

module.exports = { recordTrustEvent, trustProgression, autonomyMaturityScore, operationalConfidenceEvolution, trustSummary, TRUST_IMPACTS };
