"use strict";
/**
 * Phase 638 — Daily Autonomous Engineering Flows
 *
 * Environment restoration, dependency verification, deployment prep,
 * debugging startup, runtime stabilization, operational health scans.
 * Replayable. Interruption-safe. Operator-controlled.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/daily-autonomous-flows.json");
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

// ── Flow definitions ──────────────────────────────────────────────────────────

const FLOW_CATALOG = {
    "env-restore": {
        description: "Restore engineering environment at session start",
        replayable: true,
        steps: [
            { order: 0, label: "Scan environment health",     safe: true,  endpoint: "GET /api/runtime/env-health/report" },
            { order: 1, label: "Validate bootstrap",          safe: true,  endpoint: "GET /api/runtime/bootstrap/plan" },
            { order: 2, label: "Restore session continuity",  safe: true,  endpoint: "GET /api/runtime/session-continuity" },
            { order: 3, label: "Load workflow memory",        safe: true,  endpoint: "GET /api/runtime/memory-evolution/stats" },
            { order: 4, label: "Morning briefing",            safe: true,  endpoint: "GET /api/runtime/dashboard/briefing" },
        ],
    },
    "dep-verify": {
        description: "Verify all dependencies are healthy",
        replayable: true,
        steps: [
            { order: 0, label: "Check package.json",          safe: true,  endpoint: "GET /api/runtime/bootstrap/deps" },
            { order: 1, label: "Validate environment vars",   safe: true,  endpoint: "GET /api/runtime/bootstrap/env" },
            { order: 2, label: "Scan environment health",     safe: true,  endpoint: "GET /api/runtime/env-health/scan" },
        ],
    },
    "deploy-prep": {
        description: "Prepare for deployment",
        replayable: true,
        steps: [
            { order: 0, label: "Check trust score",            safe: true,  endpoint: "GET /api/runtime/trust/score" },
            { order: 1, label: "Verify dependencies",          safe: true,  endpoint: "GET /api/runtime/bootstrap/deps" },
            { order: 2, label: "Check open deployments",       safe: true,  endpoint: "GET /api/runtime/deploy-workflow?status=open" },
            { order: 3, label: "Capture pre-deploy snapshot",  safe: false, requiresApproval: true, endpoint: "POST /api/runtime/deploy-survivability/snapshot" },
            { order: 4, label: "Open deployment workflow",     safe: false, requiresApproval: true, endpoint: "POST /api/runtime/deploy-workflow/open" },
        ],
    },
    "debug-startup": {
        description: "Initialize debug investigation",
        replayable: true,
        steps: [
            { order: 0, label: "Check active debug sessions",  safe: true,  endpoint: "GET /api/runtime/debug-workflow/active" },
            { order: 1, label: "Check runtime pressure",       safe: true,  endpoint: "GET /api/runtime/dashboard/status" },
            { order: 2, label: "Scan environment",             safe: true,  endpoint: "GET /api/runtime/env-health/report" },
            { order: 3, label: "Open debug workflow",          safe: false, requiresApproval: true, endpoint: "POST /api/runtime/debug-workflow/open" },
        ],
    },
    "runtime-stabilize": {
        description: "Stabilize runtime after anomaly",
        replayable: true,
        steps: [
            { order: 0, label: "Check runtime dashboard",      safe: true,  endpoint: "GET /api/runtime/dashboard/status" },
            { order: 1, label: "Check survivability",          safe: true,  endpoint: "GET /api/runtime/survivability/score" },
            { order: 2, label: "Detect unsafe state",          safe: true,  endpoint: "POST /api/runtime/decision/unsafe-state" },
            { order: 3, label: "Choose recovery path",         safe: true,  endpoint: "POST /api/runtime/decision/recovery-path" },
            { order: 4, label: "Verify health post-recovery",  safe: true,  endpoint: "GET /health" },
        ],
    },
    "health-scan": {
        description: "Operational health scan",
        replayable: true,
        steps: [
            { order: 0, label: "Quick status",                  safe: true, endpoint: "GET /api/runtime/dashboard/status" },
            { order: 1, label: "Trust gate",                    safe: true, endpoint: "GET /api/runtime/trust/gate/deploy" },
            { order: 2, label: "Stale workflow check",          safe: true, endpoint: "GET /api/runtime/survivability/stale" },
            { order: 3, label: "Foundation health",             safe: true, endpoint: "GET /api/runtime/eng-foundation/health" },
        ],
    },
};

// ── Flow execution ────────────────────────────────────────────────────────────

function startFlow(flowName = "", { sessionId = null, replayId = null, resumeFromStep = 0 } = {}) {
    const catalog = FLOW_CATALOG[flowName];
    if (!catalog) return { ok: false, error: `Unknown flow: ${flowName}. Available: ${Object.keys(FLOW_CATALOG).join(", ")}` };

    const runId = crypto.randomUUID();
    const db    = _load(); _prune(db);

    db.runs.unshift({
        id:            runId,
        flowName,
        description:   catalog.description,
        sessionId,
        replayId,
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

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("chain", { runId, flowName, event: "daily-autonomous-flow-started", sessionId });

    return { ok: true, runId, flowName, description: catalog.description, stepCount: catalog.steps.length, resumeFromStep };
}

function recordStep(runId, stepOrder, { result = null, success = true, operatorApproved = false } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.id === runId);
    if (idx === -1) return { ok: false, error: "run not found" };

    const run  = db.runs[idx];
    const step = run.steps[stepOrder];
    if (!step) return { ok: false, error: "step not found" };

    if (step.requiresApproval && !operatorApproved) {
        return { ok: false, requiresApproval: true, stepLabel: step.label };
    }

    step.status    = success ? "completed" : "failed";
    step.result    = (typeof result === "string" ? result : JSON.stringify(result) || "").slice(0, 300);
    run.currentStep = Math.max(run.currentStep, stepOrder + 1);
    run.status      = run.currentStep >= run.steps.length ? "completed" : "running";
    if (run.status === "completed") run.completedAt = Date.now();

    db.runs[idx] = run;
    _save(db);

    return { ok: true, runId, stepOrder, status: step.status, nextStep: run.steps[run.currentStep] || null };
}

function interruptFlow(runId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.id === runId);
    if (idx === -1) return { ok: false };

    db.runs[idx].interrupted   = true;
    db.runs[idx].status        = "interrupted";
    db.runs[idx].interruptAt   = Date.now();
    db.runs[idx].interruptReason = (reason || "").slice(0, 200);
    db.runs[idx].resumeFromStep = db.runs[idx].currentStep;
    _save(db);
    return { ok: true, runId, interrupted: true, resumeFromStep: db.runs[idx].currentStep };
}

function resumeFlow(runId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, error: "operator approval required" };

    const db  = _load(); _prune(db);
    const run = db.runs.find(r => r.id === runId);
    if (!run) return { ok: false, error: "run not found" };

    return startFlow(run.flowName, { sessionId: run.sessionId, replayId: run.replayId, resumeFromStep: run.resumeFromStep || run.currentStep });
}

function listRuns({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.runs
        .filter(r => !status || r.status === status)
        .slice(0, limit)
        .map(r => ({ id: r.id, flowName: r.flowName, status: r.status, currentStep: r.currentStep, total: r.steps.length, startedAt: r.startedAt }));
}

function catalogList() {
    return Object.entries(FLOW_CATALOG).map(([name, def]) => ({ name, description: def.description, stepCount: def.steps.length, replayable: def.replayable }));
}

module.exports = { startFlow, recordStep, interruptFlow, resumeFlow, listRuns, catalogList, FLOW_CATALOG };
