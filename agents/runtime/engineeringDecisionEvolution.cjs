"use strict";
/**
 * Phase 651 — Engineering Decision Evolution
 *
 * Ranks recovery strategies, compares deployment options, prioritizes debugging paths,
 * detects unstable workflows, suggests stabilization sequences.
 * Explainable. Trust-aware. Bounded autonomy.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/eng-decision-evolution.json");
const MAX_HISTORY = 150;
const TTL_MS     = 48 * 60 * 60 * 1000;

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

// ── Recovery strategy ranking ─────────────────────────────────────────────────

const RECOVERY_CATALOG = [
    { id: "env-restore",          label: "Environment restore",        score: 60, safe: true,  autonomousOk: true,  conditions: ["session-start", "reconnect"] },
    { id: "dep-verify",           label: "Dependency verification",    score: 65, safe: true,  autonomousOk: true,  conditions: ["enoent", "module-missing"] },
    { id: "runtime-stabilize",    label: "Runtime stabilization",      score: 70, safe: true,  autonomousOk: true,  conditions: ["econnrefused", "crash"] },
    { id: "debug-startup",        label: "Debug session startup",      score: 55, safe: true,  autonomousOk: true,  conditions: ["failure", "unknown-error"] },
    { id: "deploy-prep",          label: "Deployment preparation",     score: 50, safe: false, autonomousOk: false, conditions: ["pre-deploy"] },
    { id: "rollback",             label: "Deployment rollback",        score: 80, safe: false, autonomousOk: false, conditions: ["deploy-fail", "regression"] },
    { id: "health-scan",          label: "Health scan",                score: 45, safe: true,  autonomousOk: true,  conditions: ["general", "monitoring"] },
    { id: "patch-apply",          label: "Apply patch",                score: 55, safe: false, autonomousOk: false, conditions: ["code-fix", "dep-fix"] },
];

function rankRecoveryStrategies(errorContext = "", { trustScore = 65 } = {}) {
    const text = errorContext.toLowerCase();

    const ranked = RECOVERY_CATALOG.map(s => {
        let relevance = 0;
        s.conditions.forEach(c => { if (text.includes(c)) relevance += 20; });
        const trustAdjust = (!s.autonomousOk && trustScore < 55) ? -15 : 0;
        return { ...s, relevance, adjustedScore: s.score + relevance + trustAdjust };
    }).sort((a, b) => b.adjustedScore - a.adjustedScore);

    const primary = ranked[0];
    const alts    = ranked.slice(1, 3);

    _record("recovery-ranking", { primary: primary.id, trust: trustScore, errorContext: errorContext.slice(0, 100) });

    return {
        ok:       true,
        primary,
        alternatives: alts,
        trustScore,
        explainer: `Ranked ${ranked.length} strategies — top: '${primary.label}' (score ${primary.adjustedScore})`,
    };
}

// ── Deployment option comparison ──────────────────────────────────────────────

function compareDeploymentOptions(options = []) {
    if (!options.length) return { ok: false, error: "No options provided" };

    const scored = options.map(opt => {
        let score = 50;
        const factors = [];

        if (opt.hasTests)           { score += 15; factors.push("has tests +15"); }
        if (opt.recentlyValidated)  { score += 10; factors.push("recently validated +10"); }
        if (opt.hasRollbackPlan)    { score += 12; factors.push("rollback plan +12"); }
        if (opt.dependencyChanges)  { score -= 10; factors.push("dep changes -10"); }
        if (opt.largeChange)        { score -= 8;  factors.push("large change -8"); }
        if (opt.recentFails > 0)    { score -= opt.recentFails * 8; factors.push(`recent fails -${opt.recentFails * 8}`); }

        return { ...opt, score: Math.max(0, Math.min(100, score)), factors };
    }).sort((a, b) => b.score - a.score);

    _record("deployment-comparison", { topOption: scored[0]?.id, count: scored.length });

    return {
        ok:         true,
        ranked:     scored,
        recommended: scored[0],
        explainer:  `Best option: '${scored[0]?.id || "unknown"}' with score ${scored[0]?.score}`,
    };
}

// ── Debug path prioritization ─────────────────────────────────────────────────

function prioritizeDebugPaths(failureContext = {}) {
    const { errorText = "", sessionActive = false, recentDeployment = false, environmentIssues = false } = failureContext;

    const paths = [
        { id: "check-dashboard",   priority: 100, reason: "Always check runtime state first",             autonomous: true },
        { id: "check-env",         priority: environmentIssues ? 95 : 70, reason: "Environment scan",   autonomous: true },
        { id: "check-recent-deploy", priority: recentDeployment ? 90 : 50, reason: "Post-deploy check", autonomous: true },
        { id: "analyze-error",     priority: errorText ? 85 : 30, reason: "Pattern-match the error",     autonomous: true },
        { id: "run-recovery",      priority: 60, reason: "Execute matched recovery path",                 autonomous: false },
        { id: "validate-recovery", priority: 40, reason: "Confirm resolution",                            autonomous: true },
    ].sort((a, b) => b.priority - a.priority);

    // Use smart debug intelligence if available
    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    let debugPlan = null;
    if (sdi && errorText) { try { debugPlan = sdi.buildDebugPlan(errorText); } catch {} }

    _record("debug-path-prioritization", { errorText: errorText.slice(0, 100), pathCount: paths.length });

    return { ok: true, paths, debugPlan, topPath: paths[0] };
}

// ── Unstable workflow detection ───────────────────────────────────────────────

function detectUnstableWorkflows() {
    const signals = [];

    const ws = _tryRequire("./workflowSurvivability.cjs");
    if (ws) {
        try {
            const stale = ws.detectStaleWorkflows();
            if (stale.staleCount > 0) signals.push({ type: "stale-workflows", count: stale.staleCount, severity: stale.staleCount > 3 ? "high" : "medium" });
        } catch {}
    }

    const awc = _tryRequire("./adaptiveWorkflowChains.cjs");
    if (awc) {
        try {
            const chains = awc.listChains({ status: "running" });
            const deep   = chains.filter(c => c.depth >= 6);
            if (deep.length > 0) signals.push({ type: "deep-chains", count: deep.length, severity: "medium" });
        } catch {}
    }

    const unstable = signals.some(s => s.severity === "high");
    _record("unstable-workflow-detection", { unstable, signals });
    return { ok: true, unstable, signals, summary: unstable ? "Unstable workflows detected" : "Workflows stable" };
}

// ── Stabilization sequence suggestion ────────────────────────────────────────

function suggestStabilization(context = {}) {
    const { pressureLevel = "nominal", unstableWorkflows = false, trustLow = false } = context;

    const steps = [{ order: 0, action: "run-health-scan",     autonomous: true, label: "Run full health scan first" }];

    if (pressureLevel === "critical" || pressureLevel === "stressed") {
        steps.push({ order: 1, action: "reduce-concurrent-operations", autonomous: true,  label: "Reduce concurrent workflows" });
        steps.push({ order: 2, action: "interrupt-non-critical",       autonomous: false, label: "Interrupt non-critical chains", requiresApproval: true });
    }
    if (unstableWorkflows) {
        steps.push({ order: 3, action: "resolve-stale-workflows",  autonomous: true, label: "Resolve stale workflows" });
    }
    if (trustLow) {
        steps.push({ order: 4, action: "pause-deployments",         autonomous: false, label: "Pause deployments until trust recovers", requiresApproval: true });
    }
    steps.push({ order: 99, action: "validate-stability",           autonomous: true, label: "Validate platform stable" });
    steps.sort((a, b) => a.order - b.order);

    return { ok: true, steps, approvalRequired: steps.some(s => s.requiresApproval) };
}

// ── Decision history ──────────────────────────────────────────────────────────

function decisionHistory({ type = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.history.filter(h => !type || h.type === type).slice(0, limit);
}

module.exports = { rankRecoveryStrategies, compareDeploymentOptions, prioritizeDebugPaths, detectUnstableWorkflows, suggestStabilization, decisionHistory };
