"use strict";
/**
 * Phase 621 — Operational Decision Engine
 *
 * Bounded decision layer: chooses recovery paths, prioritizes validation,
 * recommends rollback, detects unsafe execution states, suggests stabilization.
 * All decisions are explainable. Confidence-aware. No hidden autonomy.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/operational-decisions.json");
const MAX_RECORDS = 100;
const TTL_MS      = 48 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { decisions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.decisions = (db.decisions || []).filter(d => d.ts > cutoff).slice(0, MAX_RECORDS);
}

// ── Decision recording ────────────────────────────────────────────────────────

function _record(type, decision) {
    const db = _load(); _prune(db);
    db.decisions.unshift({ type, ...decision, ts: Date.now() });
    _save(db);
}

// ── Recovery path selection ───────────────────────────────────────────────────

const RECOVERY_PATHS = [
    { trigger: /econnrefused|socket|port/i,    path: "restart-server",    action: "Restart backend service",        confidence: 75 },
    { trigger: /enoent|cannot find module/i,   path: "dep-repair",        action: "Run dependency repair chain",    confidence: 80 },
    { trigger: /jwt|unauthorized|token/i,      path: "auth-reset",        action: "Verify JWT_SECRET and refresh tokens", confidence: 70 },
    { trigger: /syntax error|unexpected token/i, path: "code-fix",        action: "Fix syntax error in reported file",  confidence: 85 },
    { trigger: /memory|heap|oom/i,             path: "memory-recovery",   action: "Restart with increased memory limit", confidence: 65 },
    { trigger: /timeout|slow|latency/i,        path: "performance-check", action: "Profile slow endpoints, check DB connections", confidence: 60 },
    { trigger: /disk|enospc|no space/i,        path: "disk-cleanup",      action: "Clear temporary files and logs", confidence: 70 },
    { trigger: /deploy|rollback|failed/i,      path: "rollback",          action: "Trigger deployment rollback",    confidence: 80 },
];

function chooseRecoveryPath(errorContext = "") {
    const matched = RECOVERY_PATHS.filter(r => r.trigger.test(errorContext));

    if (matched.length === 0) {
        const decision = {
            type:       "recovery-path",
            path:       "general-debug",
            action:     "Open debug session and inspect runtime dashboard",
            confidence: 50,
            reasoning:  "No specific error pattern matched — starting with runtime inspection",
            alternatives: [],
        };
        _record("recovery-path", decision);
        return { ok: true, ...decision };
    }

    const primary = matched.sort((a, b) => b.confidence - a.confidence)[0];
    const alts    = matched.slice(1, 3).map(a => ({ path: a.path, action: a.action, confidence: a.confidence }));

    const decision = {
        path:         primary.path,
        action:       primary.action,
        confidence:   primary.confidence,
        reasoning:    `Error pattern '${errorContext.slice(0, 100)}' matched recovery path '${primary.path}'`,
        alternatives: alts,
    };
    _record("recovery-path", decision);
    return { ok: true, ...decision };
}

// ── Validation prioritization ─────────────────────────────────────────────────

function prioritizeValidation(context = {}) {
    const { pendingDeployment = false, activeDebugSession = false, lowTrust = false, failedRecovery = false } = context;
    const steps = [];

    if (pendingDeployment) steps.push({ priority: 1, step: "pre-deploy-preflight", reason: "Deployment pending — verify readiness" });
    if (failedRecovery)    steps.push({ priority: 2, step: "runtime-health-check", reason: "Recovery failed — re-validate runtime" });
    if (lowTrust)          steps.push({ priority: 3, step: "trust-signal-review",  reason: "Trust low — review recent failure signals" });
    if (activeDebugSession) steps.push({ priority: 4, step: "debug-session-progress", reason: "Debug session active — check progress" });

    steps.push({ priority: 99, step: "baseline-health-check", reason: "Always check baseline health" });
    steps.sort((a, b) => a.priority - b.priority);

    _record("validation-prioritization", { steps, context });
    return { ok: true, steps, count: steps.length };
}

// ── Rollback recommendation ───────────────────────────────────────────────────

function recommendRollback(context = {}) {
    const { deploymentPhase = null, errorRate = 0, timeSinceDeployMs = 0, monitoringAlerts = 0 } = context;

    let recommend = false;
    const reasons = [];

    if (deploymentPhase === "failed")         { recommend = true;  reasons.push("Deployment failed"); }
    if (errorRate > 0.1)                      { recommend = true;  reasons.push(`Error rate ${Math.round(errorRate*100)}% exceeds threshold`); }
    if (monitoringAlerts >= 3)                { recommend = true;  reasons.push(`${monitoringAlerts} monitoring alerts triggered`); }
    if (timeSinceDeployMs < 10 * 60 * 1000 && errorRate > 0.05) {
        recommend = true;
        reasons.push("High error rate within 10min of deploy — early rollback recommended");
    }

    const confidence = recommend ? Math.min(95, 50 + reasons.length * 15) : 40;

    const decision = {
        recommend,
        confidence,
        reasons,
        action: recommend ? "Trigger deployment rollback with operator approval" : "Continue monitoring — no rollback needed yet",
        reasoning: reasons.length > 0 ? reasons.join("; ") : "No rollback triggers met",
    };
    _record("rollback-recommendation", decision);
    return { ok: true, ...decision };
}

// ── Unsafe execution detection ────────────────────────────────────────────────

function detectUnsafeState(context = {}) {
    const { restartCount = 0, chainDepth = 0, recoveryLoopCount = 0, browserAutoSubmit = false, replayDupCount = 0 } = context;
    const warnings = [];

    if (restartCount >= 3)         warnings.push({ signal: "restart-storm",      detail: `${restartCount} restarts detected`, severity: "high" });
    if (chainDepth > 8)            warnings.push({ signal: "deep-chain",         detail: `Chain depth ${chainDepth} exceeds safe limit`, severity: "high" });
    if (recoveryLoopCount >= 3)    warnings.push({ signal: "recovery-loop",      detail: `${recoveryLoopCount} recovery loops — possible infinite recovery`, severity: "critical" });
    if (browserAutoSubmit)         warnings.push({ signal: "auto-submit-risk",   detail: "Browser auto-submit attempted without approval", severity: "critical" });
    if (replayDupCount >= 2)       warnings.push({ signal: "replay-dup",         detail: `${replayDupCount} duplicate replay executions`, severity: "medium" });

    const critical = warnings.filter(w => w.severity === "critical").length;
    const safe     = warnings.length === 0;

    const decision = { safe, warnings, criticalCount: critical };
    _record("unsafe-state-detection", decision);
    return { ok: true, ...decision };
}

// ── Stabilization suggestions ─────────────────────────────────────────────────

function suggestStabilization(context = {}) {
    const { trustScore = 65, survivabilityScore = 70, activeIssues = [] } = context;
    const suggestions = [];

    if (trustScore < 50)          suggestions.push({ action: "run-successful-validation", reason: "Trust score low — complete a successful validation to rebuild trust", priority: "high" });
    if (survivabilityScore < 50)  suggestions.push({ action: "enable-checkpoints",        reason: "Survivability low — enable workflow checkpoints", priority: "high" });
    if (activeIssues.length > 3)  suggestions.push({ action: "triage-and-close-issues",   reason: `${activeIssues.length} active issues — triage before new work`, priority: "medium" });

    suggestions.push({ action: "daily-briefing-review", reason: "Review morning briefing for outstanding items", priority: "low" });

    _record("stabilization-suggestion", { suggestions, trustScore, survivabilityScore });
    return { ok: true, suggestions, count: suggestions.length };
}

function listDecisions({ type = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.decisions
        .filter(d => !type || d.type === type)
        .slice(0, limit);
}

module.exports = { chooseRecoveryPath, prioritizeValidation, recommendRollback, detectUnsafeState, suggestStabilization, listDecisions };
