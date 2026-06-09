"use strict";
/**
 * Phase 647 — Execution Risk Intelligence
 *
 * Tracks deployment risk, patch instability, replay corruption, dependency volatility,
 * workflow fragility. Generates risk summaries, rollback recommendations, trust warnings.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/execution-risk-intel.json");
const MAX_EVENTS = 200;
const TTL_MS     = 14 * 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { signals: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.signals = (db.signals || []).filter(s => s.ts > cutoff).slice(0, MAX_EVENTS);
}

// ── Signal types ──────────────────────────────────────────────────────────────

const RISK_SIGNAL_WEIGHTS = {
    "deploy-fail":          { domain: "deployment",   weight: 35, description: "Deployment failed" },
    "deploy-rollback":      { domain: "deployment",   weight: 25, description: "Rollback triggered" },
    "deploy-success":       { domain: "deployment",   weight: -15, description: "Successful deploy" },
    "patch-rejected":       { domain: "patch",        weight: 20, description: "Patch rejected" },
    "patch-rollback":       { domain: "patch",        weight: 30, description: "Patch rolled back" },
    "patch-applied":        { domain: "patch",        weight: -8, description: "Patch applied cleanly" },
    "replay-corrupt":       { domain: "replay",       weight: 40, description: "Replay corruption detected" },
    "replay-dedup-hit":     { domain: "replay",       weight: 5,  description: "Duplicate replay blocked" },
    "replay-success":       { domain: "replay",       weight: -5, description: "Replay completed" },
    "dep-missing":          { domain: "dependency",   weight: 25, description: "Missing dependency" },
    "dep-version-conflict": { domain: "dependency",   weight: 20, description: "Dependency version conflict" },
    "dep-install-ok":       { domain: "dependency",   weight: -10, description: "Dependency installed" },
    "workflow-interrupted": { domain: "workflow",     weight: 15, description: "Workflow interrupted" },
    "workflow-stale":       { domain: "workflow",     weight: 20, description: "Stale workflow detected" },
    "workflow-completed":   { domain: "workflow",     weight: -10, description: "Workflow completed" },
};

function recordSignal(type, { detail = "", domain = null } = {}) {
    const def = RISK_SIGNAL_WEIGHTS[type];
    if (!def) return { ok: false, error: `Unknown signal type: ${type}` };
    const db = _load(); _prune(db);
    db.signals.unshift({ type, domain: domain || def.domain, weight: def.weight, detail: (detail || "").slice(0, 200), ts: Date.now() });
    _save(db);
    return { ok: true, type, domain: def.domain };
}

// ── Domain risk scoring ───────────────────────────────────────────────────────

function domainRiskScore(domain, { windowMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    const db     = _load(); _prune(db);
    const cutoff = Date.now() - windowMs;
    const sigs   = db.signals.filter(s => s.ts > cutoff && s.domain === domain);

    const raw    = sigs.reduce((sum, s) => sum + s.weight, 0);
    const score  = Math.max(0, Math.min(100, raw));
    const level  = score >= 70 ? "critical" : score >= 45 ? "elevated" : score >= 20 ? "moderate" : "low";

    return { ok: true, domain, score, level, signalCount: sigs.length, windowMs };
}

// ── Full risk summary ─────────────────────────────────────────────────────────

function riskSummary({ windowMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    const domains  = ["deployment", "patch", "replay", "dependency", "workflow"];
    const scores   = domains.map(d => domainRiskScore(d, { windowMs }));
    const maxScore = Math.max(...scores.map(s => s.score));
    const dominant = scores.find(s => s.score === maxScore) || scores[0];
    const overall  = maxScore >= 60 ? "high" : maxScore >= 35 ? "moderate" : "low";

    // Pull in patch trust data
    const apt = _tryRequire("./advancedPatchTrust.cjs");
    let patchTrust = null;
    if (apt) { try { patchTrust = apt.executionConfidenceSummary(); } catch {} }

    return {
        ok:          true,
        overall,
        maxScore,
        dominant:    dominant.domain,
        domains:     scores,
        patchTrust:  patchTrust ? { tier: patchTrust.tier, autonomousOk: patchTrust.autonomousOk } : null,
        summary:     `Execution risk: ${overall} — highest in ${dominant.domain} (${dominant.score}/100)`,
    };
}

// ── Deployment risk assessment ────────────────────────────────────────────────

function deploymentRiskAssessment(ctx = {}) {
    const { recentFails = 0, timeSinceLastDeploy = 0, pendingPatches = 0, trustScore = 65 } = ctx;
    const risk = [];

    if (recentFails >= 2)            risk.push({ factor: "recent-failures",     weight: recentFails * 15, detail: `${recentFails} recent deploy failures` });
    if (trustScore < 55)             risk.push({ factor: "low-trust",           weight: 30,               detail: `Trust score ${trustScore}` });
    if (pendingPatches > 3)          risk.push({ factor: "patch-backlog",        weight: 15,               detail: `${pendingPatches} pending patches` });
    if (timeSinceLastDeploy > 7 * 24 * 60 * 60 * 1000) risk.push({ factor: "stale-deploy", weight: 10, detail: "No deploy in 7+ days" });

    // Check domain signal
    const deploy = domainRiskScore("deployment");
    if (deploy.score > 40) risk.push({ factor: "signal-history", weight: deploy.score, detail: `Historical risk: ${deploy.level}` });

    const totalWeight = risk.reduce((s, r) => s + r.weight, 0);
    const level = totalWeight >= 60 ? "high" : totalWeight >= 30 ? "moderate" : "low";
    const proceed = level !== "high";

    return {
        ok:        true,
        level,
        proceed,
        factors:   risk,
        totalWeight,
        recommendation: proceed ? "Deployment can proceed with standard validation" : "Delay deployment — resolve risk factors first",
        approvalRequired: level !== "low",
    };
}

// ── Rollback recommendation ───────────────────────────────────────────────────

function rollbackRecommendation(ctx = {}) {
    const { deploymentFailed = false, errorRatePct = 0, healthCheckFailed = false, timeSinceDeployMs = 0 } = ctx;
    const triggers = [];

    if (deploymentFailed)                                          triggers.push({ signal: "deploy-failed",      weight: 50 });
    if (errorRatePct > 15)                                         triggers.push({ signal: "high-error-rate",    weight: 35 });
    if (healthCheckFailed)                                         triggers.push({ signal: "health-check-fail",  weight: 40 });
    if (timeSinceDeployMs < 600_000 && errorRatePct > 5)           triggers.push({ signal: "early-regression",   weight: 25 });

    const totalWeight = triggers.reduce((s, t) => s + t.weight, 0);
    const recommend   = totalWeight >= 45;

    return {
        ok:       true,
        recommend,
        confidence: Math.min(95, totalWeight),
        triggers: triggers.map(t => t.signal),
        action:   recommend ? "Trigger rollback — requires operator approval" : "Continue monitoring",
        approvalRequired: recommend,
        explainer: triggers.length > 0 ? `Rollback triggers: ${triggers.map(t => t.signal).join(", ")}` : "No triggers met",
    };
}

// ── Trust-aware warnings ──────────────────────────────────────────────────────

function trustAwareWarnings() {
    const warnings = [];

    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (otl) {
        try {
            const gate = otl.gateOperation("deploy");
            if (!gate.allowed) warnings.push({ type: "trust-gate-blocked", severity: "critical", detail: `Deploy blocked — trust score ${gate.score}` });
            else if (gate.score < 60) warnings.push({ type: "trust-low", severity: "warning", detail: `Trust score ${gate.score} — monitor closely` });
        } catch {}
    }

    const risk = riskSummary({ windowMs: 24 * 60 * 60 * 1000 });
    if (risk.overall === "high") warnings.push({ type: "high-execution-risk", severity: "critical", detail: risk.summary });
    else if (risk.overall === "moderate") warnings.push({ type: "moderate-risk", severity: "warning", detail: risk.summary });

    return { ok: true, warnings, count: warnings.length, safe: warnings.filter(w => w.severity === "critical").length === 0 };
}

module.exports = { recordSignal, domainRiskScore, riskSummary, deploymentRiskAssessment, rollbackRecommendation, trustAwareWarnings };
