"use strict";
/**
 * Phase 743 — Operator Workflow Orchestration
 *
 * High-level workflow orchestration for compound operator tasks:
 * debug-to-deploy, incident-to-recovery, replay-to-validation.
 * All orchestration transitions require operator approval gates.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DATA_FILE      = path.join(__dirname, "../../data/operator-workflow-orchestration.json");
const MAX_WORKFLOWS  = 50;
const STALE_MS       = 12 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch { return { workflows: [] }; }
}
function _save(db) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}

const WORKFLOW_TYPES = {
    "debug-to-deploy": {
        steps: ["debug-init", "diagnose", "patch-propose", "operator-review", "patch-apply", "test", "deploy-prep", "operator-approve-deploy", "deploy"],
        approvalSteps: ["operator-review", "operator-approve-deploy"],
    },
    "incident-to-recovery": {
        steps: ["detect", "classify", "operator-review", "isolate", "remediate", "operator-approve-restore", "restore", "verify"],
        approvalSteps: ["operator-review", "operator-approve-restore"],
    },
    "replay-to-validation": {
        steps: ["replay-start", "context-capture", "validate", "operator-review", "promote"],
        approvalSteps: ["operator-review"],
    },
};

function startOrchestratedWorkflow(workflowId, type, context = {}) {
    if (!workflowId || !type) return { ok: false, error: "workflowId and type required" };
    if (!WORKFLOW_TYPES[type]) return { ok: false, error: `Unknown workflow type '${type}'. Valid: ${Object.keys(WORKFLOW_TYPES).join(", ")}` };

    const db = _load();
    if (db.workflows.find(w => w.workflowId === workflowId)) return { ok: false, error: `Workflow '${workflowId}' already exists` };

    const def = WORKFLOW_TYPES[type];
    const wf  = {
        workflowId,
        type,
        steps: def.steps,
        approvalSteps: def.approvalSteps,
        currentStep: 0,
        status: "active",
        context,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        history: [{ step: def.steps[0], status: "started", ts: Date.now() }],
    };

    db.workflows.push(wf);
    if (db.workflows.length > MAX_WORKFLOWS) db.workflows = db.workflows.slice(-MAX_WORKFLOWS);
    _save(db);

    return { ok: true, workflowId, type, currentStep: def.steps[0], stepIndex: 0, requiresApproval: def.approvalSteps.includes(def.steps[0]) };
}

function advanceOrchestratedWorkflow(workflowId, { operatorApproved = false } = {}) {
    if (!workflowId) return { ok: false, error: "workflowId required" };

    const db = _load();
    const wf = db.workflows.find(w => w.workflowId === workflowId);
    if (!wf) return { ok: false, error: `Workflow '${workflowId}' not found` };
    if (wf.status === "completed") return { ok: false, error: "Workflow already completed" };
    if (wf.status === "blocked") return { ok: false, error: "Workflow blocked — operator must resolve" };

    const currentStep = wf.steps[wf.currentStep];
    if (wf.approvalSteps.includes(currentStep) && !operatorApproved) {
        return { ok: false, requiresApproval: true, step: currentStep, message: `Step '${currentStep}' requires operator approval` };
    }

    wf.history.push({ step: currentStep, status: "completed", ts: Date.now() });
    wf.currentStep++;
    wf.updatedAt = Date.now();

    if (wf.currentStep >= wf.steps.length) {
        wf.status = "completed";
        _save(db);
        return { ok: true, status: "completed", workflowId };
    }

    const nextStep = wf.steps[wf.currentStep];
    wf.history.push({ step: nextStep, status: "started", ts: Date.now() });
    _save(db);

    return { ok: true, workflowId, completedStep: currentStep, nextStep, stepIndex: wf.currentStep, requiresApproval: wf.approvalSteps.includes(nextStep) };
}

function getWorkflowStatus(workflowId) {
    if (!workflowId) return { ok: false, error: "workflowId required" };
    const db = _load();
    const wf = db.workflows.find(w => w.workflowId === workflowId);
    if (!wf) return { ok: false, error: `Workflow '${workflowId}' not found` };
    return { ok: true, workflowId: wf.workflowId, type: wf.type, status: wf.status, currentStep: wf.steps[wf.currentStep] || "done", stepIndex: wf.currentStep, totalSteps: wf.steps.length };
}

function interruptWorkflow(workflowId, reason = "") {
    if (!workflowId) return { ok: false, error: "workflowId required" };
    const db = _load();
    const wf = db.workflows.find(w => w.workflowId === workflowId);
    if (!wf) return { ok: false, error: "not found" };
    wf.status   = "interrupted";
    wf.updatedAt = Date.now();
    wf.history.push({ step: wf.steps[wf.currentStep], status: "interrupted", reason, ts: Date.now() });
    _save(db);
    return { ok: true, workflowId, status: "interrupted" };
}

function listActiveWorkflows() {
    const db  = _load();
    const now = Date.now();
    const active = db.workflows.filter(w => w.status === "active" && now - w.startedAt < STALE_MS);
    return { ok: true, count: active.length, workflows: active.map(w => ({ workflowId: w.workflowId, type: w.type, currentStep: w.steps[w.currentStep], progress: `${w.currentStep}/${w.steps.length}` })) };
}

module.exports = { startOrchestratedWorkflow, advanceOrchestratedWorkflow, getWorkflowStatus, interruptWorkflow, listActiveWorkflows };
