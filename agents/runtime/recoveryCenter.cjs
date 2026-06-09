"use strict";
/**
 * Phase 546 — Engineering Recovery Center
 *
 * Centralized recovery mode: runtime repair workflows, deployment rollback chains,
 * adapter restoration, dependency recovery, workflow replay recovery.
 *
 * Goal: make failures survivable and understandable.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Recovery catalog ──────────────────────────────────────────────────────────

const RECOVERY_CATALOG = [
    {
        id:          "runtime-repair",
        name:        "Runtime Repair",
        description: "Fix Node.js runtime pressure, stale sessions, and adapter degradation",
        category:    "runtime",
        steps:       [
            "Check runtime pressure level",
            "Evict stale sessions",
            "Restart degraded adapters",
            "Verify stability layer",
        ],
        workflowIds: ["pressure-relief"],
        riskLevel:   "low",
    },
    {
        id:          "deployment-rollback",
        name:        "Deployment Rollback",
        description: "Rollback a failed deployment and restore prior runtime state",
        category:    "deployment",
        steps:       [
            "Identify failed deployment run",
            "Execute rollback chain",
            "Verify backend health",
            "Confirm frontend proxy",
        ],
        workflowIds: ["frontend-recovery", "backend-restore"],
        riskLevel:   "medium",
    },
    {
        id:          "adapter-restoration",
        name:        "Adapter Restoration",
        description: "Restore degraded or disconnected adapters",
        category:    "adapter",
        steps:       [
            "List degraded adapters",
            "Attempt adapter healing",
            "Verify adapter connectivity",
            "Re-run adapter health check",
        ],
        workflowIds: [],
        riskLevel:   "low",
    },
    {
        id:          "dependency-recovery",
        name:        "Dependency Recovery",
        description: "Repair missing or broken npm dependencies",
        category:    "dependency",
        steps:       [
            "Identify missing modules",
            "Run npm install",
            "Verify node_modules integrity",
            "Restart affected services",
        ],
        workflowIds: ["dependency-repair"],
        riskLevel:   "low",
    },
    {
        id:          "workflow-replay-recovery",
        name:        "Workflow Replay Recovery",
        description: "Recover from a failed workflow replay",
        category:    "workflow",
        steps:       [
            "Identify failed replay",
            "Cluster root causes",
            "Select recovery chain",
            "Re-execute from last checkpoint",
        ],
        workflowIds: [],
        riskLevel:   "medium",
    },
    {
        id:          "git-conflict-recovery",
        name:        "Git Conflict Recovery",
        description: "Safe resolution of git merge conflicts",
        category:    "git",
        steps:       [
            "Run git status",
            "Identify conflicted files",
            "Apply git safe-update workflow",
            "Verify clean working tree",
        ],
        workflowIds: ["git-safe-update"],
        riskLevel:   "medium",
    },
];

// ── Active recovery state ─────────────────────────────────────────────────────

let _activeRecovery = null;

function activateRecovery(recoveryId, opts = {}) {
    const catalog = RECOVERY_CATALOG.find(r => r.id === recoveryId);
    if (!catalog) return { ok: false, error: `unknown recovery: ${recoveryId}` };

    _activeRecovery = {
        id:          recoveryId,
        name:        catalog.name,
        sessionId:   opts.sessionId   || null,
        operatorId:  opts.operatorId  || "default",
        currentStep: 0,
        totalSteps:  catalog.steps.length,
        startedAt:   Date.now(),
        status:      "active",
    };
    return { ok: true, recovery: _activeRecovery, steps: catalog.steps };
}

function getActiveRecovery() {
    return _activeRecovery;
}

function advanceRecoveryStep() {
    if (!_activeRecovery) return { ok: false, error: "no active recovery" };
    _activeRecovery.currentStep++;
    if (_activeRecovery.currentStep >= _activeRecovery.totalSteps) {
        _activeRecovery.status      = "completed";
        _activeRecovery.completedAt = Date.now();
    }
    return { ok: true, recovery: _activeRecovery };
}

function completeRecovery(success = true) {
    if (!_activeRecovery) return { ok: false, error: "no active recovery" };
    _activeRecovery.status      = success ? "completed" : "failed";
    _activeRecovery.completedAt = Date.now();
    const result = { ok: true, recovery: _activeRecovery };
    _activeRecovery = null;
    return result;
}

// ── Failure triage ────────────────────────────────────────────────────────────

/**
 * Given an error text, suggest the best recovery procedure.
 */
function triageFailure(errorText) {
    if (!errorText) return { ok: false, error: "errorText required" };

    const intel = _tryRequire("./failureIntelligenceEngine.cjs");
    const suggestions = [];

    if (intel) {
        const clusters = intel.clusterRootCauses([errorText]);
        for (const cluster of clusters) {
            if (cluster.recovery) {
                // Map workflow ID to recovery catalog entry
                const cat = RECOVERY_CATALOG.find(r => r.workflowIds.includes(cluster.recovery));
                if (cat) suggestions.push({ recoveryId: cat.id, name: cat.name, confidence: 80, rootCause: cluster.rootCause, riskLevel: cluster.riskLevel });
            }
        }
    }

    // Fallback heuristic
    if (suggestions.length === 0) {
        if (/pressure|memory|heap/i.test(errorText))      suggestions.push({ recoveryId: "runtime-repair",        name: "Runtime Repair",        confidence: 60 });
        if (/deployment|pipeline|failed/i.test(errorText)) suggestions.push({ recoveryId: "deployment-rollback",   name: "Deployment Rollback",   confidence: 60 });
        if (/module|require|import/i.test(errorText))      suggestions.push({ recoveryId: "dependency-recovery",   name: "Dependency Recovery",   confidence: 70 });
        if (/adapter|connect|refused/i.test(errorText))    suggestions.push({ recoveryId: "adapter-restoration",   name: "Adapter Restoration",   confidence: 65 });
        if (/conflict|merge/i.test(errorText))             suggestions.push({ recoveryId: "git-conflict-recovery", name: "Git Conflict Recovery", confidence: 70 });
    }

    return {
        ok:          true,
        errorText:   errorText.slice(0, 200),
        suggestions: suggestions.slice(0, 3),
        primaryRecovery: suggestions[0] || null,
    };
}

// ── Recovery status snapshot ──────────────────────────────────────────────────

function recoverySnapshot() {
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");
    const stability = _tryRequire("./stabilityLayer.cjs");
    const pipeline  = _tryRequire("./deploymentPipeline.cjs");
    const adapters  = _tryRequire("./adapterHealth.cjs");

    const pres      = pressure  ? pressure.computePressure()  : { level: "nominal", score: 0 };
    const drift     = stability ? stability.detectDrift()      : { ok: true, issues: [] };
    const failedRuns = pipeline ? pipeline.listRuns({ limit: 10 }).filter(r => r.state === "failed" && !r.rollbackTriggered) : [];

    const urgentIssues = [];
    if (pres.level === "high" || pres.level === "critical") urgentIssues.push({ type: "pressure", detail: `Runtime pressure: ${pres.level}`, recovery: "runtime-repair" });
    if (!drift.ok) drift.issues.filter(i => i.severity === "critical").forEach(i => urgentIssues.push({ type: "drift", detail: i.message, recovery: "runtime-repair" }));
    failedRuns.forEach(r => urgentIssues.push({ type: "deployment", detail: `Failed deployment: ${r.id}`, recovery: "deployment-rollback" }));

    return {
        activeRecovery:  _activeRecovery,
        urgentIssues,
        pressureLevel:   pres.level,
        pressureScore:   pres.score,
        failedDeployments: failedRuns.length,
        driftIssues:     drift.issues ? drift.issues.length : 0,
        catalog:         RECOVERY_CATALOG.map(r => ({ id: r.id, name: r.name, category: r.category, riskLevel: r.riskLevel })),
        ts:              new Date().toISOString(),
    };
}

module.exports = {
    RECOVERY_CATALOG,
    activateRecovery, getActiveRecovery, advanceRecoveryStep, completeRecovery,
    triageFailure, recoverySnapshot,
};
