"use strict";
/**
 * Phase 653 — Daily Execution Automation
 *
 * Automatic environment checks, startup validation, dependency verification,
 * deployment readiness scans, runtime-health workflows.
 * Replayable. Interruption-safe. Operator-controlled.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/daily-execution-automation.json");
const MAX_RUNS   = 50;
const RUN_TTL    = 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { runs: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - RUN_TTL;
    db.runs = (db.runs || []).filter(r => r.startedAt > cutoff).slice(0, MAX_RUNS);
}

// ── Automation catalog ─────────────────────────────────────────────────────────

const AUTOMATION_CATALOG = {
    "startup-check": {
        description: "Startup environment validation",
        replayable:  true,
        steps: [
            { order: 0, label: "Runtime health check",       safe: true,  endpoint: "GET /api/runtime/dashboard/status" },
            { order: 1, label: "Environment scan",           safe: true,  endpoint: "GET /api/runtime/env-health/report" },
            { order: 2, label: "Dependency validation",      safe: true,  endpoint: "GET /api/runtime/bootstrap/deps" },
            { order: 3, label: "Trust score check",          safe: true,  endpoint: "GET /api/runtime/trust/score" },
            { order: 4, label: "Continuity restore",         safe: true,  endpoint: "GET /api/runtime/auto-continuity/health" },
        ],
    },
    "dep-verification": {
        description: "Dependency and environment verification",
        replayable:  true,
        steps: [
            { order: 0, label: "Check package.json",         safe: true,  endpoint: "GET /api/runtime/bootstrap/deps" },
            { order: 1, label: "Validate env vars",          safe: true,  endpoint: "GET /api/runtime/bootstrap/env" },
            { order: 2, label: "Scan for dep conflicts",     safe: true,  endpoint: "GET /api/runtime/env-health/scan" },
        ],
    },
    "deploy-readiness": {
        description: "Deployment readiness scan",
        replayable:  true,
        steps: [
            { order: 0, label: "Check trust gate",           safe: true,  endpoint: "GET /api/runtime/trust/gate/deploy" },
            { order: 1, label: "Execution risk summary",     safe: true,  endpoint: "GET /api/runtime/exec-risk/summary" },
            { order: 2, label: "Check stale workflows",      safe: true,  endpoint: "GET /api/runtime/survivability/stale" },
            { order: 3, label: "Patch trust confidence",     safe: true,  endpoint: "GET /api/runtime/patch-trust/confidence" },
            { order: 4, label: "Deployment risk assessment", safe: true,  endpoint: "POST /api/runtime/exec-risk/deploy-risk" },
        ],
    },
    "runtime-health": {
        description: "Runtime health workflow",
        replayable:  true,
        steps: [
            { order: 0, label: "Quick status",               safe: true,  endpoint: "GET /api/runtime/dashboard/status" },
            { order: 1, label: "Resilience watchdog",        safe: true,  endpoint: "GET /api/runtime/resilience/watchdog" },
            { order: 2, label: "Workflow memory stats",      safe: true,  endpoint: "GET /api/runtime/workflow-memory/stats" },
            { order: 3, label: "Decision intelligence",      safe: true,  endpoint: "POST /api/runtime/decision/unsafe-runtime" },
        ],
    },
    "debug-init": {
        description: "Initialize debug investigation",
        replayable:  true,
        steps: [
            { order: 0, label: "Check active debug sessions", safe: true,  endpoint: "GET /api/runtime/trusted-debug" },
            { order: 1, label: "Correlate recent failures",   safe: true,  endpoint: "GET /api/runtime/debug-intel/correlate" },
            { order: 2, label: "Prioritize root causes",      safe: true,  endpoint: "POST /api/runtime/debug-intel/plan" },
            { order: 3, label: "Open debug run",              safe: false, requiresApproval: true, endpoint: "POST /api/runtime/trusted-debug/start" },
        ],
    },
};

function startAutomation(name = "", { sessionId = null, resumeFromStep = 0 } = {}) {
    const catalog = AUTOMATION_CATALOG[name];
    if (!catalog) return { ok: false, error: `Unknown automation: ${name}. Available: ${Object.keys(AUTOMATION_CATALOG).join(", ")}` };

    const runId = crypto.randomUUID();
    const db    = _load(); _prune(db);

    db.runs.unshift({
        id:            runId,
        name,
        description:   catalog.description,
        sessionId,
        steps:         catalog.steps.map(s => ({ ...s, status: s.order < resumeFromStep ? "skipped" : "pending", result: null })),
        currentStep:   resumeFromStep,
        status:        "running",
        interrupted:   false,
        resumeFromStep: 0,
        replayable:    catalog.replayable,
        startedAt:     Date.now(),
        completedAt:   null,
    });
    _save(db);

    return { ok: true, runId, name, description: catalog.description, stepCount: catalog.steps.length, resumeFromStep };
}

function recordStep(runId, stepOrder, { result = null, success = true, operatorApproved = false } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.id === runId);
    if (idx === -1) return { ok: false, error: "run not found" };

    const run  = db.runs[idx];
    const step = run.steps[stepOrder];
    if (!step) return { ok: false, error: "step not found" };
    if (step.requiresApproval && !operatorApproved) return { ok: false, requiresApproval: true, stepLabel: step.label };

    step.status     = success ? "completed" : "failed";
    step.result     = (typeof result === "string" ? result : JSON.stringify(result) || "").slice(0, 300);
    run.currentStep = Math.max(run.currentStep, stepOrder + 1);
    run.status      = run.currentStep >= run.steps.length ? "completed" : "running";
    if (run.status === "completed") run.completedAt = Date.now();

    db.runs[idx] = run;
    _save(db);
    return { ok: true, runId, stepOrder, status: step.status, nextStep: run.steps[run.currentStep] || null };
}

function interruptAutomation(runId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.id === runId);
    if (idx === -1) return { ok: false };
    db.runs[idx].interrupted     = true;
    db.runs[idx].status          = "interrupted";
    db.runs[idx].interruptAt     = Date.now();
    db.runs[idx].interruptReason = (reason || "").slice(0, 200);
    db.runs[idx].resumeFromStep  = db.runs[idx].currentStep;
    _save(db);
    return { ok: true, runId, resumeFromStep: db.runs[idx].currentStep };
}

function resumeAutomation(runId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, error: "operator approval required" };
    const db  = _load(); _prune(db);
    const run = db.runs.find(r => r.id === runId);
    if (!run) return { ok: false, error: "run not found" };
    return startAutomation(run.name, { sessionId: run.sessionId, resumeFromStep: run.resumeFromStep || run.currentStep });
}

function listRuns({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.runs
        .filter(r => !status || r.status === status)
        .slice(0, limit)
        .map(r => ({ id: r.id, name: r.name, status: r.status, currentStep: r.currentStep, total: r.steps.length, startedAt: r.startedAt }));
}

function catalogList() {
    return Object.entries(AUTOMATION_CATALOG).map(([name, def]) => ({ name, description: def.description, stepCount: def.steps.length, replayable: def.replayable }));
}

module.exports = { startAutomation, recordStep, interruptAutomation, resumeAutomation, listRuns, catalogList, AUTOMATION_CATALOG };
