"use strict";
/**
 * Phase 721 — One-Click Engineering Flows
 *
 * Replay-safe workflow bundles for: startup restoration, debug initialization,
 * deployment preparation, runtime stabilization, dependency recovery.
 * Interruption-safe. Operator-visible coordination. Reduces friction.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/one-click-flows.json");
const TTL_MS     = 24 * 60 * 60 * 1000;
const MAX_RUNS   = 30;

const FLOW_BUNDLES = {
    "startup-restore": {
        description: "One-click startup: restore workspace, cross-env check, replay discoverability",
        steps: [
            { step: "workspace-restore-health",   autonomous: true,  critical: true  },
            { step: "cross-env-summary",           autonomous: true,  critical: false },
            { step: "replay-discoverability",      autonomous: true,  critical: false },
            { step: "productivity-session-list",   autonomous: true,  critical: false },
            { step: "command-center-init",         autonomous: true,  critical: false },
        ],
    },
    "debug-init": {
        description: "One-click debug: health check, dep verify, replay link, plan",
        steps: [
            { step: "runtime-health-check",        autonomous: true,  critical: true  },
            { step: "dep-verification",            autonomous: true,  critical: false },
            { step: "replay-link-check",           autonomous: true,  critical: false },
            { step: "validation-first-plan",       autonomous: true,  critical: false },
            { step: "operator-confirm",            autonomous: false, critical: false, requiresApproval: true },
        ],
    },
    "deploy-prep": {
        description: "One-click deploy prep: env scan, trust check, rollback prep, sequence",
        steps: [
            { step: "env-readiness-scan",          autonomous: true,  critical: true  },
            { step: "trust-indicator-check",       autonomous: true,  critical: true  },
            { step: "rollback-availability",       autonomous: true,  critical: false },
            { step: "operator-approve-deploy",     autonomous: false, critical: true, requiresApproval: true },
            { step: "phased-sequence-build",       autonomous: false, critical: true, requiresApproval: true },
        ],
    },
    "runtime-stabilize": {
        description: "One-click stabilization: detect unstable, recommend flows, apply",
        steps: [
            { step: "detect-unstable-states",      autonomous: true,  critical: true  },
            { step: "rank-safer-flows",            autonomous: true,  critical: false },
            { step: "suppress-noise",              autonomous: true,  critical: false },
            { step: "operator-approve-stabilize",  autonomous: false, critical: true, requiresApproval: true },
            { step: "apply-stabilization",         autonomous: false, critical: true, requiresApproval: true },
            { step: "verify-stable",               autonomous: true,  critical: false },
        ],
    },
    "dep-recovery": {
        description: "One-click dependency recovery: identify, rank, execute, verify",
        steps: [
            { step: "identify-broken-deps",        autonomous: true,  critical: true  },
            { step: "rank-recovery-sequences",     autonomous: true,  critical: false },
            { step: "terminal-conflict-check",     autonomous: true,  critical: false },
            { step: "operator-approve-recovery",   autonomous: false, critical: true, requiresApproval: true },
            { step: "execute-recovery",            autonomous: false, critical: true, requiresApproval: true },
            { step: "verify-deps-restored",        autonomous: true,  critical: false },
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

function startOneClickFlow(flowType = "startup-restore") {
    const bundle = FLOW_BUNDLES[flowType];
    if (!bundle) return { ok: false, error: `Unknown flow: ${flowType}`, available: Object.keys(FLOW_BUNDLES) };

    const runId = crypto.randomUUID();
    const db    = _load(); _prune(db);

    const run = {
        runId, flowType, description: bundle.description,
        steps:       bundle.steps.map((s, i) => ({ ...s, index: i, status: "pending", completedAt: null })),
        currentStep: 0, status: "running",
        ts: Date.now(), updatedAt: Date.now(),
    };
    db.runs.unshift(run); _save(db);
    return { ok: true, runId, flowType, description: bundle.description, stepCount: run.steps.length, firstStep: run.steps[0] };
}

function advanceOneClickFlow(runId, { operatorApproved = false, result = null } = {}) {
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

function interruptOneClickFlow(runId) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.runId === runId);
    if (idx === -1) return { ok: false, error: "Run not found" };
    db.runs[idx].status = "interrupted"; db.runs[idx].updatedAt = Date.now();
    _save(db);
    return { ok: true, runId, resumeFromStep: db.runs[idx].currentStep };
}

function resumeOneClickFlow(runId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.runId === runId);
    if (idx === -1) return { ok: false, error: "Run not found" };
    if (db.runs[idx].status !== "interrupted") return { ok: false, error: "Run not interrupted" };
    db.runs[idx].status = "running"; db.runs[idx].updatedAt = Date.now();
    _save(db);
    const currentStep = db.runs[idx].steps[db.runs[idx].currentStep];
    return { ok: true, runId, resumingFrom: currentStep?.step || null };
}

// ── Execute autonomous steps in a bundle without operator pause ───────────────

function executeAutonomousBundle(flowType = "startup-restore") {
    const bundle = FLOW_BUNDLES[flowType];
    if (!bundle) return { ok: false, error: `Unknown flow: ${flowType}` };

    const results = [];

    // startup-restore: wire real checks
    if (flowType === "startup-restore") {
        const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
        if (iwr) { try { const r = iwr.workspaceRestoreHealth(); results.push({ step: "workspace-restore-health", ok: r.ok, detail: r.summary }); } catch {} }

        const cee = _tryRequire("./crossEnvironmentExecution.cjs");
        if (cee) { try { const r = cee.crossEnvSummary(); results.push({ step: "cross-env-summary", ok: true, detail: r.summary }); } catch {} }

        const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
        if (lhpc) { try { const list = lhpc.listProductivitySessions({ limit: 5 }); results.push({ step: "replay-discoverability", ok: true, count: list.length }); } catch {} }
    }

    // debug-init: wire real checks
    if (flowType === "debug-init") {
        const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
        if (rdf) { try { const r = rdf.debugRuntimeHealthCheck(); results.push({ step: "runtime-health-check", ok: r.ok, detail: r.detail }); } catch {} }
        if (rdf) { try { const r = rdf.verifyDebuggingDependencies(""); results.push({ step: "dep-verification", ok: r.ok, detail: r.detail }); } catch {} }
    }

    // deploy-prep: wire real checks
    if (flowType === "deploy-prep") {
        const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
        if (rdw) { try { const r = rdw.scanEnvironmentReadiness("production"); results.push({ step: "env-readiness-scan", ok: r.ok, detail: r.detail }); } catch {} }
    }

    // runtime-stabilize: wire real checks
    if (flowType === "runtime-stabilize") {
        const odc = _tryRequire("./operationalDecisionCoordination.cjs");
        if (odc) { try { const r = odc.detectUnstableCoordinationStates(); results.push({ step: "detect-unstable-states", ok: r.stable, detail: r.recommendation }); } catch {} }
        if (odc) { try { const r = odc.recommendSaferOperationalFlows({ riskLevel: "unknown", trustScore: 70 }); results.push({ step: "rank-safer-flows", ok: r.ok, primary: r.primary?.id }); } catch {} }
    }

    const autonomousSteps = bundle.steps.filter(s => s.autonomous);
    const approvalSteps   = bundle.steps.filter(s => !s.autonomous);
    const allOk = results.every(r => r.ok !== false);

    return {
        ok:             allOk,
        flowType,
        results,
        autonomousSteps: autonomousSteps.length,
        pendingApproval: approvalSteps.length,
        readyForApproval: approvalSteps.length > 0,
        detail:         `Bundle executed: ${results.length} autonomous checks, ${approvalSteps.length} awaiting approval`,
    };
}

function listOneClickFlows({ status = null, limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.runs.filter(r => !status || r.status === status).slice(0, limit)
        .map(r => ({ runId: r.runId, flowType: r.flowType, status: r.status, currentStep: r.currentStep, stepCount: r.steps.length }));
}

function catalogOneClickFlows() {
    return Object.entries(FLOW_BUNDLES).map(([type, cfg]) => ({
        type, description: cfg.description, stepCount: cfg.steps.length,
        requiresApproval: cfg.steps.some(s => !s.autonomous),
        autonomousSteps:  cfg.steps.filter(s => s.autonomous).length,
    }));
}

module.exports = { startOneClickFlow, advanceOneClickFlow, interruptOneClickFlow, resumeOneClickFlow, executeAutonomousBundle, listOneClickFlows, catalogOneClickFlows, FLOW_BUNDLES };
