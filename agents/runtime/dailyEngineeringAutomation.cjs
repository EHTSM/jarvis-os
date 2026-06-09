"use strict";
/**
 * Phase 624 — Daily Engineering Automation
 *
 * Startup environment restore, deployment prep flows, debugging init,
 * validation workflows, operational health scans.
 * Replayable. Interruption-safe. Operator-controlled.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/daily-engineering-automation.json");
const MAX_RUNS    = 50;
const RUN_TTL     = 24 * 60 * 60 * 1000;

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

// ── Automation catalog ────────────────────────────────────────────────────────

const AUTOMATION_CATALOG = {
    "startup-restore": {
        description: "Restore engineering environment on session start",
        steps: [
            { order: 0, label: "Scan environment health",       endpoint: "GET /api/runtime/env-health/report",     safe: true },
            { order: 1, label: "Bootstrap validation",           endpoint: "GET /api/runtime/bootstrap/plan",        safe: true },
            { order: 2, label: "Restore workflow survivability", endpoint: "GET /api/runtime/survivability/score",   safe: true },
            { order: 3, label: "Check session continuity",       endpoint: "GET /api/runtime/session-continuity",    safe: true },
            { order: 4, label: "Load morning briefing",          endpoint: "GET /api/runtime/dashboard/briefing",    safe: true },
        ],
        replayable:      true,
        interruptSafe:   true,
    },
    "deployment-prep": {
        description: "Prepare deployment pre-flight",
        steps: [
            { order: 0, label: "Check trust score",              endpoint: "GET /api/runtime/trust/score",           safe: true },
            { order: 1, label: "Verify dependencies",            endpoint: "GET /api/runtime/bootstrap/deps",        safe: true },
            { order: 2, label: "Environment health scan",        endpoint: "GET /api/runtime/env-health/scan",       safe: true },
            { order: 3, label: "Check open deployments",         endpoint: "GET /api/runtime/deploy-workflow?status=open", safe: true },
            { order: 4, label: "Open deployment workflow",       endpoint: "POST /api/runtime/deploy-workflow/open",  safe: false, requiresApproval: true },
        ],
        replayable:      true,
        interruptSafe:   true,
    },
    "debug-init": {
        description: "Initialize debugging session for an issue",
        steps: [
            { order: 0, label: "Check runtime dashboard",        endpoint: "GET /api/runtime/dashboard/status",      safe: true },
            { order: 1, label: "Scan env health",                endpoint: "GET /api/runtime/env-health/report",     safe: true },
            { order: 2, label: "Check active debug sessions",    endpoint: "GET /api/runtime/debug-workflow/active", safe: true },
            { order: 3, label: "Open debug workflow",            endpoint: "POST /api/runtime/debug-workflow/open",  safe: false, requiresApproval: true },
        ],
        replayable:      true,
        interruptSafe:   true,
    },
    "validation-workflow": {
        description: "Full production health validation",
        steps: [
            { order: 0, label: "Trust score check",              endpoint: "GET /api/runtime/trust/score",           safe: true },
            { order: 1, label: "Survivability check",            endpoint: "GET /api/runtime/survivability/score",   safe: true },
            { order: 2, label: "Environment health",             endpoint: "GET /api/runtime/env-health/report",     safe: true },
            { order: 3, label: "Daily engineering audit",        endpoint: "POST /api/runtime/eng-audit/run",        safe: true },
            { order: 4, label: "Foundation health check",        endpoint: "GET /api/runtime/eng-foundation/health", safe: true },
        ],
        replayable:      true,
        interruptSafe:   true,
    },
    "health-scan": {
        description: "Quick operational health scan",
        steps: [
            { order: 0, label: "Quick status",                   endpoint: "GET /api/runtime/dashboard/status",      safe: true },
            { order: 1, label: "Trust gate: deploy",             endpoint: "GET /api/runtime/trust/gate/deploy",     safe: true },
            { order: 2, label: "Stale workflow check",           endpoint: "GET /api/runtime/survivability/stale",   safe: true },
        ],
        replayable:      true,
        interruptSafe:   true,
    },
};

// ── Run automation ────────────────────────────────────────────────────────────

function startAutomation(automationName = "", { sessionId = null, replayId = null, resumeFromStep = 0 } = {}) {
    const catalog = AUTOMATION_CATALOG[automationName];
    if (!catalog) return { ok: false, error: `Unknown automation: ${automationName}. Available: ${Object.keys(AUTOMATION_CATALOG).join(", ")}` };

    const runId = crypto.randomUUID();
    const db    = _load(); _prune(db);

    db.runs.unshift({
        id:            runId,
        automationName,
        description:   catalog.description,
        sessionId,
        replayId,
        steps:         catalog.steps.map(s => ({
            ...s,
            status:      s.order < resumeFromStep ? "skipped" : "pending",
            result:      null,
            executedAt:  null,
        })),
        currentStep:   resumeFromStep,
        status:        "running",
        replayable:    catalog.replayable,
        interruptSafe: catalog.interruptSafe,
        startedAt:     Date.now(),
        completedAt:   null,
        interrupted:   false,
    });
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("chain", { runId, automationName, event: "daily-automation-started", sessionId });

    return {
        ok:            true,
        runId,
        automationName,
        description:   catalog.description,
        stepCount:     catalog.steps.length,
        resumingFrom:  resumeFromStep,
        steps:         catalog.steps,
    };
}

function recordStepResult(runId, stepOrder, { result = null, success = true, operatorApproved = false } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.id === runId);
    if (idx === -1) return { ok: false, error: "run not found" };

    const run  = db.runs[idx];
    const step = run.steps[stepOrder];
    if (!step) return { ok: false, error: "step not found" };

    if (step.requiresApproval && !operatorApproved) {
        return { ok: false, requiresApproval: true, stepLabel: step.label, endpoint: step.endpoint };
    }

    step.status    = success ? "completed" : "failed";
    step.result    = (typeof result === "string" ? result : JSON.stringify(result) || "").slice(0, 300);
    step.executedAt = Date.now();

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
    if (idx === -1) return { ok: false, error: "run not found" };

    const run = db.runs[idx];
    db.runs[idx] = {
        ...run,
        interrupted:   true,
        status:        "interrupted",
        interruptAt:   Date.now(),
        interruptReason: (reason || "").slice(0, 200),
        resumeFromStep: run.currentStep,
    };
    _save(db);
    return { ok: true, runId, interrupted: true, resumeFromStep: run.currentStep };
}

function resumeAutomation(runId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, error: "operator approval required to resume automation" };

    const db  = _load(); _prune(db);
    const run = db.runs.find(r => r.id === runId);
    if (!run) return { ok: false, error: "run not found" };

    return startAutomation(run.automationName, {
        sessionId:      run.sessionId,
        replayId:       run.replayId,
        resumeFromStep: run.resumeFromStep || run.currentStep,
    });
}

function listRuns({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.runs
        .filter(r => !status || r.status === status)
        .slice(0, limit)
        .map(r => ({ id: r.id, automationName: r.automationName, status: r.status, currentStep: r.currentStep, total: r.steps.length, startedAt: r.startedAt, completedAt: r.completedAt }));
}

function catalogList() {
    return Object.entries(AUTOMATION_CATALOG).map(([name, def]) => ({
        name,
        description:  def.description,
        stepCount:    def.steps.length,
        replayable:   def.replayable,
        interruptSafe: def.interruptSafe,
    }));
}

module.exports = { startAutomation, recordStepResult, interruptAutomation, resumeAutomation, listRuns, catalogList, AUTOMATION_CATALOG };
