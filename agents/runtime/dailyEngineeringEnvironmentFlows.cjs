"use strict";
/**
 * Phase 699 — Daily Engineering Environment Flows
 *
 * Startup environment restoration, deployment preparation orchestration,
 * debugging environment setup, runtime-health sequencing, dependency verification.
 * Replayable. Interruption-safe. Operator-controlled.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/daily-eng-env-flows.json");
const MAX_FLOWS  = 30;
const TTL_MS     = 24 * 60 * 60 * 1000;

const ENV_FLOW_CATALOG = {
    "startup-env-restore": {
        description: "Restore all environments on startup",
        steps: [
            { step: "health-check-all-envs",       autonomous: true,  critical: true  },
            { step: "restore-vscode-context",       autonomous: true,  critical: false },
            { step: "restore-terminal-sessions",    autonomous: true,  critical: false },
            { step: "check-browser-sessions",       autonomous: true,  critical: false },
            { step: "review-deployment-state",      autonomous: true,  critical: false },
            { step: "triage-cross-env-priorities",  autonomous: true,  critical: false },
        ],
    },
    "deployment-prep-env": {
        description: "Prepare all environments for deployment",
        steps: [
            { step: "validate-all-envs",        autonomous: true,  critical: true  },
            { step: "check-dep-readiness",       autonomous: true,  critical: true  },
            { step: "sequence-by-runtime-health", autonomous: true,  critical: true  },
            { step: "persist-deployment-context", autonomous: true,  critical: false },
            { step: "operator-approval",         autonomous: false, critical: true, requiresApproval: true },
        ],
    },
    "debug-env-setup": {
        description: "Set up debugging environment across all tools",
        steps: [
            { step: "identify-error-pattern",    autonomous: true,  critical: true  },
            { step: "check-vscode-context",      autonomous: true,  critical: false },
            { step: "validate-terminal-state",   autonomous: true,  critical: false },
            { step: "correlate-cross-env-ctx",   autonomous: true,  critical: false },
            { step: "build-debug-plan",          autonomous: true,  critical: false },
            { step: "operator-confirm",          autonomous: false, critical: true, requiresApproval: true },
        ],
    },
    "runtime-health-seq": {
        description: "Full runtime health sequencing across environments",
        steps: [
            { step: "execution-state-check",     autonomous: true,  critical: true  },
            { step: "platform-resilience",       autonomous: true,  critical: true  },
            { step: "deployment-env-check",      autonomous: true,  critical: false },
            { step: "browser-session-check",     autonomous: true,  critical: false },
            { step: "cross-env-stability",       autonomous: true,  critical: false },
        ],
    },
    "dep-verification-env": {
        description: "Verify dependencies across all environments",
        steps: [
            { step: "load-dep-graphs",           autonomous: true,  critical: true  },
            { step: "check-service-health",      autonomous: true,  critical: true  },
            { step: "validate-service-restart-order", autonomous: true, critical: false },
            { step: "confirm-env-readiness",     autonomous: true,  critical: false },
        ],
    },
};

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { flows: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.flows = (db.flows || []).filter(f => f.ts > cutoff).slice(0, MAX_FLOWS);
}

function startEnvFlow(flowType = "startup-env-restore") {
    const catalog = ENV_FLOW_CATALOG[flowType];
    if (!catalog) return { ok: false, error: `Unknown flow: ${flowType}`, available: Object.keys(ENV_FLOW_CATALOG) };

    const flowId = crypto.randomUUID();
    const db     = _load(); _prune(db);

    const flow = {
        flowId,
        flowType,
        description: catalog.description,
        steps: catalog.steps.map((s, i) => ({ ...s, index: i, status: "pending", completedAt: null })),
        currentStep: 0,
        status:      "running",
        ts:          Date.now(),
        updatedAt:   Date.now(),
    };

    db.flows.unshift(flow);
    _save(db);
    return { ok: true, flowId, flowType, description: catalog.description, stepCount: flow.steps.length, firstStep: flow.steps[0] };
}

function advanceEnvFlowStep(flowId, { operatorApproved = false, result = null } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.flows.findIndex(f => f.flowId === flowId);
    if (idx === -1) return { ok: false, error: "Flow not found" };

    const flow = db.flows[idx];
    const step = flow.steps[flow.currentStep];
    if (!step) return { ok: false, error: "No current step" };
    if (!step.autonomous && !operatorApproved) return { ok: false, requiresApproval: true, step: step.step };

    step.status = "completed"; step.completedAt = Date.now(); step.result = result;
    flow.currentStep++; flow.updatedAt = Date.now();
    if (flow.currentStep >= flow.steps.length) flow.status = "completed";

    db.flows[idx] = flow; _save(db);
    const nextStep = flow.steps[flow.currentStep] || null;
    return { ok: true, flowId, completedStep: step.step, nextStep: nextStep?.step || null, status: flow.status };
}

function interruptEnvFlow(flowId) {
    const db = _load(); _prune(db);
    const idx = db.flows.findIndex(f => f.flowId === flowId);
    if (idx === -1) return { ok: false, error: "Flow not found" };
    db.flows[idx].status = "interrupted"; db.flows[idx].updatedAt = Date.now();
    _save(db);
    return { ok: true, flowId, resumeFromStep: db.flows[idx].currentStep };
}

function resumeEnvFlow(flowId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    const db  = _load(); _prune(db);
    const idx = db.flows.findIndex(f => f.flowId === flowId);
    if (idx === -1) return { ok: false, error: "Flow not found" };
    if (db.flows[idx].status !== "interrupted") return { ok: false, error: "Flow is not interrupted" };
    db.flows[idx].status = "running"; db.flows[idx].updatedAt = Date.now();
    _save(db);
    const currentStep = db.flows[idx].steps[db.flows[idx].currentStep];
    return { ok: true, flowId, resumingFrom: currentStep?.step || null };
}

function listEnvFlows({ status = null, limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.flows.filter(f => !status || f.status === status).slice(0, limit)
        .map(f => ({ flowId: f.flowId, flowType: f.flowType, status: f.status, currentStep: f.currentStep, stepCount: f.steps.length }));
}

function runStartupEnvOrchestration() {
    const results = [];

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee) { try { const r = cee.crossEnvSummary(); results.push({ step: "cross-env-summary", ok: true, detail: r.summary }); } catch {} }

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) { try { const r = dec.validateDeploymentEnvironment("production", []); results.push({ step: "deploy-env-validation", ok: r.valid !== false, detail: `env=${r.valid}` }); } catch {} }

    const ewr = _tryRequire("./engineeringWorkspaceRestoration.cjs");
    if (ewr) { try { const r = ewr.workspaceRestorationSummary(); results.push({ step: "workspace-restoration", ok: true, detail: r.summary }); } catch {} }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) { try { const r = odc.detectUnstableCoordinationStates(); results.push({ step: "coordination-stability", ok: r.stable, detail: r.recommendation }); } catch {} }

    const allOk = results.every(r => r.ok !== false);
    return { ok: allOk, results, summary: `Startup env: ${results.filter(r => r.ok !== false).length}/${results.length} checks passed` };
}

function catalogEnvFlows() {
    return Object.entries(ENV_FLOW_CATALOG).map(([type, cfg]) => ({
        type, description: cfg.description, stepCount: cfg.steps.length,
        requiresApproval: cfg.steps.some(s => !s.autonomous),
        steps: cfg.steps.map(s => s.step),
    }));
}

module.exports = { startEnvFlow, advanceEnvFlowStep, interruptEnvFlow, resumeEnvFlow, listEnvFlows, runStartupEnvOrchestration, catalogEnvFlows };
