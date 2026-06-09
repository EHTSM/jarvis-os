"use strict";
/**
 * Phase 636 — Engineering Decision Intelligence
 *
 * Improved bounded decision system: prioritize recovery paths, recommend rollback,
 * identify unstable workflows, select validation order, detect unsafe runtime.
 * Explainable. Confidence-aware. Bounded autonomy only.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/engineering-decision-intel.json");
const MAX_HISTORY = 100;
const TTL_MS      = 48 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { history: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.history = (db.history || []).filter(h => h.ts > cutoff).slice(0, MAX_HISTORY);
}

function _record(type, data) {
    const db = _load(); _prune(db);
    db.history.unshift({ type, ...data, ts: Date.now() });
    _save(db);
}

// ── Recovery path prioritization ──────────────────────────────────────────────

const RECOVERY_INTELLIGENCE = [
    { trigger: /econnrefused|socket|connection refused/i,  path: "restart-server",       confidence: 80, action: "Restart backend service via PM2", approvalRequired: true },
    { trigger: /enoent|cannot find module|module not found/i, path: "dep-repair",         confidence: 85, action: "Run dep-repair-full chain",        approvalRequired: false },
    { trigger: /jwt|unauthorized|403|invalid token/i,      path: "auth-reset",           confidence: 75, action: "Verify and refresh JWT configuration", approvalRequired: true },
    { trigger: /syntax error|unexpected token|parse error/i, path: "code-fix",           confidence: 88, action: "Fix syntax in reported file",       approvalRequired: true },
    { trigger: /heap|out of memory|oom|javascript heap/i,  path: "memory-recovery",      confidence: 70, action: "Restart with --max-old-space-size", approvalRequired: true },
    { trigger: /timeout|request timed out|504/i,           path: "performance-check",    confidence: 65, action: "Profile endpoints, check DB pool",  approvalRequired: false },
    { trigger: /enospc|no space|disk full/i,               path: "disk-cleanup",         confidence: 78, action: "Clean logs and temp files",         approvalRequired: false },
    { trigger: /rollback|deployment failed|deploy fail/i,  path: "deploy-rollback",      confidence: 82, action: "Trigger deployment rollback",        approvalRequired: true },
    { trigger: /browser|puppeteer|playwright|page crash/i, path: "browser-recovery",     confidence: 72, action: "Restart browser workflow session",  approvalRequired: false },
    { trigger: /port.*in use|eaddrinuse/i,                 path: "port-conflict",        confidence: 85, action: "Kill conflicting process on port",  approvalRequired: true },
];

function prioritizeRecovery(errorContext = "") {
    const matches = RECOVERY_INTELLIGENCE.filter(r => r.trigger.test(errorContext))
        .sort((a, b) => b.confidence - a.confidence);

    const primary = matches[0] || { path: "general-debug", confidence: 50, action: "Open debug session and inspect dashboard", approvalRequired: false };
    const alts    = matches.slice(1, 3).map(m => ({ path: m.path, confidence: m.confidence, action: m.action }));

    const decision = {
        path:             primary.path,
        confidence:       primary.confidence,
        action:           primary.action,
        approvalRequired: primary.approvalRequired,
        reasoning:        matches.length > 0
            ? `Error pattern matched '${primary.path}' with ${primary.confidence}% confidence`
            : "No specific pattern matched — defaulting to general debug",
        alternatives:     alts,
    };
    _record("recovery-prioritization", decision);
    return { ok: true, ...decision };
}

// ── Rollback recommendation (enhanced) ───────────────────────────────────────

function recommendRollback(ctx = {}) {
    const { deploymentPhase = null, errorRate = 0, timeSinceDeployMs = 0, healthCheckFailed = false, monitorAlerts = 0 } = ctx;
    const triggers = [];

    if (deploymentPhase === "failed")                                triggers.push({ signal: "deploy-failed",    weight: 40 });
    if (errorRate > 0.1)                                            triggers.push({ signal: "high-error-rate",  weight: 30 });
    if (healthCheckFailed)                                          triggers.push({ signal: "health-check-fail",weight: 35 });
    if (monitorAlerts >= 3)                                         triggers.push({ signal: "monitor-alerts",   weight: 20 });
    if (timeSinceDeployMs < 10 * 60 * 1000 && errorRate > 0.05)    triggers.push({ signal: "early-regression", weight: 25 });

    const totalWeight  = triggers.reduce((s, t) => s + t.weight, 0);
    const recommend    = totalWeight >= 40;
    const confidence   = Math.min(95, totalWeight);

    const decision = {
        recommend,
        confidence,
        triggers:  triggers.map(t => t.signal),
        reasoning: triggers.length > 0 ? `Rollback triggers: ${triggers.map(t => t.signal).join(", ")}` : "No rollback triggers met",
        action:    recommend ? "Trigger rollback — requires operator approval" : "Continue monitoring",
        approvalRequired: recommend,
    };
    _record("rollback-recommendation", decision);
    return { ok: true, ...decision };
}

// ── Unstable workflow detection ───────────────────────────────────────────────

function detectUnstableWorkflows() {
    const ws  = _tryRequire("./workflowSurvivability.cjs");
    const lhc = _tryRequire("./longHorizonContinuity.cjs");

    const signals = [];

    if (ws) {
        try {
            const stale = ws.detectStaleWorkflows();
            if (stale.staleCount > 0) signals.push({ type: "stale-workflows", count: stale.staleCount, severity: stale.staleCount > 3 ? "high" : "medium" });
        } catch {}
    }

    if (lhc) {
        try {
            const health = lhc.longHorizonHealth();
            if (health.reconnectStorm) signals.push({ type: "reconnect-storm", severity: "high" });
            if (health.staleSessions > 2) signals.push({ type: "stale-sessions", count: health.staleSessions, severity: "medium" });
        } catch {}
    }

    const unstable = signals.some(s => s.severity === "high");
    _record("unstable-workflow-detection", { unstable, signals });
    return { ok: true, unstable, signals, summary: unstable ? "Unstable workflows detected" : "Workflows stable" };
}

// ── Validation order selection ────────────────────────────────────────────────

function selectValidationOrder(context = {}) {
    const { hasPendingDeploy = false, hasActiveDebug = false, environmentIssues = false, lowTrust = false } = context;
    const ordered = [];

    // Always first
    ordered.push({ order: 1, step: "runtime-health",      endpoint: "GET /api/runtime/dashboard/status",    reason: "Baseline check always first" });

    if (environmentIssues) ordered.push({ order: 2, step: "env-scan",          endpoint: "GET /api/runtime/env-health/scan",      reason: "Environment issues detected" });
    if (lowTrust)          ordered.push({ order: 3, step: "trust-score",        endpoint: "GET /api/runtime/trust/score",          reason: "Trust low — verify before proceeding" });
    if (hasPendingDeploy)  ordered.push({ order: 4, step: "deploy-preflight",   endpoint: "GET /api/runtime/deploy-workflow?status=open", reason: "Deployment pending" });
    if (hasActiveDebug)    ordered.push({ order: 5, step: "debug-status",       endpoint: "GET /api/runtime/debug-workflow/active", reason: "Active debug sessions" });

    ordered.push({ order: 99, step: "survivability",       endpoint: "GET /api/runtime/survivability/score", reason: "Always validate survivability" });
    ordered.sort((a, b) => a.order - b.order);

    _record("validation-order-selection", { ordered, context });
    return { ok: true, steps: ordered, count: ordered.length };
}

// ── Unsafe runtime detection ──────────────────────────────────────────────────

function detectUnsafeRuntime() {
    const ode  = _tryRequire("./operationalDecisionEngine.cjs");
    const ts   = _tryRequire("./autonomousTerminalSupervision.cjs");
    const lhc  = _tryRequire("./longHorizonContinuity.cjs");

    const warnings = [];
    let critical = 0;

    if (ts) {
        try {
            const stale = ts.detectStale();
            if (stale.runawayCount > 0) { warnings.push({ signal: "runaway-process", count: stale.runawayCount, severity: "critical" }); critical++; }
            if (stale.staleCount > 3)   warnings.push({ signal: "stale-processes", count: stale.staleCount, severity: "medium" });
        } catch {}
    }

    if (lhc) {
        try {
            const health = lhc.longHorizonHealth();
            if (health.reconnectStorm) { warnings.push({ signal: "reconnect-storm", severity: "critical" }); critical++; }
        } catch {}
    }

    const safe = critical === 0;
    _record("unsafe-runtime-detection", { safe, warnings, critical });
    return { ok: true, safe, warnings, critical, summary: safe ? "Runtime safe" : `${critical} critical signal(s) detected` };
}

function decisionHistory({ type = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.history
        .filter(h => !type || h.type === type)
        .slice(0, limit);
}

module.exports = { prioritizeRecovery, recommendRollback, detectUnstableWorkflows, selectValidationOrder, detectUnsafeRuntime, decisionHistory };
