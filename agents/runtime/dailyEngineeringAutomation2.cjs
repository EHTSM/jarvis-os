"use strict";
/**
 * Phase 713 — Daily Engineering Automation (Productivity OS)
 *
 * Startup health scans, deployment readiness workflows, dependency verification,
 * runtime stabilization, environment restoration, operational summaries.
 * Replayable. Interruption-safe. Operator-controlled.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/daily-eng-automation2.json");
const TTL_MS      = 24 * 60 * 60 * 1000;
const MAX_RUNS    = 30;

const AUTOMATION_CATALOG = {
    "startup-health-scan": {
        description: "Full startup health scan",
        steps: [
            { step: "workspace-continuity-check", autonomous: true,  critical: true  },
            { step: "cross-env-summary",           autonomous: true,  critical: false },
            { step: "unstable-env-detection",      autonomous: true,  critical: false },
            { step: "replay-discoverability",      autonomous: true,  critical: false },
            { step: "command-center-summary",      autonomous: true,  critical: false },
        ],
    },
    "deployment-readiness": {
        description: "Deployment readiness workflow",
        steps: [
            { step: "env-readiness-scan",          autonomous: true,  critical: true  },
            { step: "trust-indicator-check",       autonomous: true,  critical: true  },
            { step: "rollback-availability",       autonomous: true,  critical: false },
            { step: "operator-approve-deploy",     autonomous: false, critical: true, requiresApproval: true },
        ],
    },
    "dep-verification": {
        description: "Dependency verification across environments",
        steps: [
            { step: "terminal-conflict-check",     autonomous: true,  critical: true  },
            { step: "vscode-stale-check",          autonomous: true,  critical: false },
            { step: "deployment-trust-check",      autonomous: true,  critical: false },
            { step: "cross-env-dep-summary",       autonomous: true,  critical: false },
        ],
    },
    "runtime-stabilization": {
        description: "Runtime stabilization sequence",
        steps: [
            { step: "detect-unstable-states",      autonomous: true,  critical: true  },
            { step: "suppress-noise",              autonomous: true,  critical: false },
            { step: "coordination-health",         autonomous: true,  critical: false },
            { step: "operator-approve-stabilize",  autonomous: false, critical: true, requiresApproval: true },
            { step: "apply-safer-flows",           autonomous: false, critical: true, requiresApproval: true },
        ],
    },
    "env-restoration": {
        description: "Environment restoration automation",
        steps: [
            { step: "snapshot-availability-check", autonomous: true,  critical: true  },
            { step: "reconnect-safety-check",      autonomous: true,  critical: true  },
            { step: "operator-approve-restore",    autonomous: false, critical: true, requiresApproval: true },
            { step: "restore-workspace",           autonomous: false, critical: true, requiresApproval: true },
            { step: "verify-restored",             autonomous: true,  critical: false },
        ],
    },
};

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { runs: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - TTL_MS;
    db.runs = (db.runs || []).filter(r => r.ts > cut).slice(0, MAX_RUNS);
}

function startAutomation2(automationType = "startup-health-scan") {
    const catalog = AUTOMATION_CATALOG[automationType];
    if (!catalog) return { ok: false, error: `Unknown automation: ${automationType}`, available: Object.keys(AUTOMATION_CATALOG) };

    const runId = crypto.randomUUID();
    const db    = _load(); _prune(db);

    const run = {
        runId, automationType,
        description: catalog.description,
        steps:       catalog.steps.map((s, i) => ({ ...s, index: i, status: "pending", completedAt: null })),
        currentStep: 0,
        status:      "running",
        ts:          Date.now(),
        updatedAt:   Date.now(),
    };

    db.runs.unshift(run);
    _save(db);
    return { ok: true, runId, automationType, description: catalog.description, stepCount: run.steps.length, firstStep: run.steps[0] };
}

function advanceAutomationStep2(runId, { operatorApproved = false, result = null } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.runId === runId);
    if (idx === -1) return { ok: false, error: "Run not found" };

    const run  = db.runs[idx];
    const step = run.steps[run.currentStep];
    if (!step) return { ok: false, error: "No current step" };
    if (!step.autonomous && !operatorApproved) return { ok: false, requiresApproval: true, step: step.step };

    step.status = "completed"; step.completedAt = Date.now(); step.result = result;
    run.currentStep++; run.updatedAt = Date.now();
    if (run.currentStep >= run.steps.length) run.status = "completed";

    db.runs[idx] = run; _save(db);
    const nextStep = run.steps[run.currentStep] || null;
    return { ok: true, runId, completedStep: step.step, nextStep: nextStep?.step || null, status: run.status };
}

function interruptAutomation2(runId) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.runId === runId);
    if (idx === -1) return { ok: false, error: "Run not found" };
    db.runs[idx].status    = "interrupted";
    db.runs[idx].updatedAt = Date.now();
    _save(db);
    return { ok: true, runId, resumeFromStep: db.runs[idx].currentStep };
}

function resumeAutomation2(runId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.runId === runId);
    if (idx === -1) return { ok: false, error: "Run not found" };
    if (db.runs[idx].status !== "interrupted") return { ok: false, error: "Run not interrupted" };
    db.runs[idx].status    = "running";
    db.runs[idx].updatedAt = Date.now();
    _save(db);
    const currentStep = db.runs[idx].steps[db.runs[idx].currentStep];
    return { ok: true, runId, resumingFrom: currentStep?.step || null };
}

function runOperationalSummary2() {
    const results = [];

    const ecc = _tryRequire("./engineeringCommandCenter.cjs");
    if (ecc) {
        try {
            const dashboard = ecc.commandCenterDashboard();
            results.push({ step: "command-center", ok: dashboard.ok, calm: dashboard.calm, criticals: dashboard.criticalCount });
        } catch {}
    }

    const mepi = _tryRequire("./multiEnvProductivityIntelligence.cjs");
    if (mepi) {
        try {
            const summary = mepi.multiEnvProductivitySummary();
            results.push({ step: "productivity-summary", ok: true, score: summary.avgScore, level: summary.level });
        } catch {}
    }

    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    if (iwr) {
        try {
            const health = iwr.workspaceRestoreHealth();
            results.push({ step: "workspace-restore-health", ok: health.ok, freshSnapshots: health.freshSnapshots });
        } catch {}
    }

    const allOk = results.every(r => r.ok !== false);
    return { ok: allOk, results, summary: `Daily automation2 summary: ${results.filter(r => r.ok !== false).length}/${results.length} checks passed` };
}

function listAutomationRuns2({ status = null, limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.runs.filter(r => !status || r.status === status).slice(0, limit)
        .map(r => ({ runId: r.runId, automationType: r.automationType, status: r.status, currentStep: r.currentStep, stepCount: r.steps.length }));
}

function catalogAutomations2() {
    return Object.entries(AUTOMATION_CATALOG).map(([type, cfg]) => ({
        type, description: cfg.description, stepCount: cfg.steps.length,
        requiresApproval: cfg.steps.some(s => !s.autonomous),
        steps: cfg.steps.map(s => s.step),
    }));
}

module.exports = { startAutomation2, advanceAutomationStep2, interruptAutomation2, resumeAutomation2, runOperationalSummary2, listAutomationRuns2, catalogAutomations2, AUTOMATION_CATALOG };
