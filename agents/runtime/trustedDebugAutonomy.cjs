"use strict";
/**
 * Phase 631 — Trusted Debug Autonomy
 *
 * Autonomous safe debugging flows: runtime diagnosis, dep verification,
 * validation-first recovery, bounded restart orchestration, replay-linked recovery.
 * Operator-visible. Interrupt-safe. Rollback-aware. Max retry depth = 3.
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/trusted-debug-autonomy.json");
const MAX_RUNS    = 50;
const RUN_TTL     = 24 * 60 * 60 * 1000;
const MAX_RETRIES = 3;
const MAX_DEPTH   = 10;

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

// ── Autonomous debug run lifecycle ────────────────────────────────────────────

function startDebugRun(opts = {}) {
    const { goal = "", sessionId = null, replayId = null, errorContext = "" } = opts;
    if (!goal) return { ok: false, error: "goal required" };

    // Trust gate
    const tl = _tryRequire("./operationalTrustLayer.cjs");
    if (tl) {
        const gate = tl.gateOperation("recovery");
        if (!gate.ok) return { ok: false, error: `Trust gate blocked: ${gate.reason}`, trustScore: gate.score };
    }

    // Choose recovery path
    const ode  = _tryRequire("./operationalDecisionEngine.cjs");
    let recovery = null;
    if (ode && errorContext) {
        try { recovery = ode.chooseRecoveryPath(errorContext); } catch {}
    }

    // Validation-first step plan
    const steps = [
        { order: 0, label: "Check runtime dashboard",        safe: true,  autonomousOk: true,  retryable: false },
        { order: 1, label: "Check environment health",       safe: true,  autonomousOk: true,  retryable: false },
        { order: 2, label: "Verify dependencies",            safe: true,  autonomousOk: true,  retryable: false },
        { order: 3, label: "Check trust score",              safe: true,  autonomousOk: true,  retryable: false },
        { order: 4, label: "Ingest errors into debug session", safe: true, autonomousOk: true,  retryable: true  },
        { order: 5, label: "Build recovery plan",            safe: true,  autonomousOk: true,  retryable: false },
        { order: 6, label: "Execute safe recovery steps",    safe: false, autonomousOk: false, requiresApproval: true, retryable: true },
        { order: 7, label: "Verify health post-recovery",   safe: true,  autonomousOk: true,  retryable: false },
    ].slice(0, MAX_DEPTH);

    const runId = crypto.randomUUID();
    const db    = _load(); _prune(db);

    db.runs.unshift({
        id:           runId,
        goal:         (goal || "").slice(0, 200),
        sessionId,
        replayId,
        errorContext: (errorContext || "").slice(0, 300),
        recovery,
        steps:        steps.map(s => ({ ...s, status: "pending", retryCount: 0, result: null })),
        currentStep:  0,
        retryCount:   0,
        status:       "running",
        interrupted:  false,
        startedAt:    Date.now(),
        completedAt:  null,
    });
    _save(db);

    const tline = _tryRequire("./executionTimeline.cjs");
    if (tline) tline.record("chain", { runId, goal, event: "trusted-debug-run-started", sessionId });

    return { ok: true, runId, stepCount: steps.length, recovery, requiresApprovalSteps: steps.filter(s => s.requiresApproval).length };
}

function executeStep(runId, stepOrder, { result = null, approved = false } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.id === runId);
    if (idx === -1) return { ok: false, error: "run not found" };

    const run  = db.runs[idx];
    if (run.interrupted) return { ok: false, error: "run interrupted" };

    const step = run.steps[stepOrder];
    if (!step) return { ok: false, error: "step not found" };
    if (!step.autonomousOk && !approved) return { ok: false, requiresApproval: true, stepLabel: step.label };

    step.status    = "completed";
    step.result    = result || { status: "advisory" };
    step.executedAt = Date.now();

    run.currentStep = Math.max(run.currentStep, stepOrder + 1);
    run.status      = run.currentStep >= run.steps.length ? "completed" : "running";
    if (run.status === "completed") {
        run.completedAt = Date.now();
        const tl = _tryRequire("./operationalTrustLayer.cjs");
        if (tl) tl.recordSignal("recovery-success", { sessionId: run.sessionId });
    }

    db.runs[idx] = run;
    _save(db);

    return { ok: true, runId, stepOrder, nextStep: run.steps[run.currentStep] || null };
}

function retryStep(runId, stepOrder) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.id === runId);
    if (idx === -1) return { ok: false, error: "run not found" };

    const run  = db.runs[idx];
    const step = run.steps[stepOrder];
    if (!step) return { ok: false, error: "step not found" };
    if (!step.retryable) return { ok: false, error: `Step '${step.label}' is not retryable` };

    step.retryCount = (step.retryCount || 0) + 1;
    run.retryCount  = (run.retryCount || 0) + 1;

    if (step.retryCount > MAX_RETRIES) return { ok: false, error: `Max retries (${MAX_RETRIES}) reached for step '${step.label}'` };
    if (run.retryCount  > MAX_RETRIES * 2) return { ok: false, error: "Run-level retry limit reached — operator intervention required" };

    step.status = "pending";
    db.runs[idx] = run;
    _save(db);

    return { ok: true, runId, stepOrder, retryCount: step.retryCount };
}

function interruptRun(runId, { reason = "" } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.id === runId);
    if (idx === -1) return { ok: false, error: "run not found" };

    db.runs[idx].interrupted    = true;
    db.runs[idx].status         = "interrupted";
    db.runs[idx].interruptAt    = Date.now();
    db.runs[idx].interruptReason = (reason || "").slice(0, 200);
    _save(db);

    return { ok: true, runId, interrupted: true };
}

function listRuns({ status = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.runs
        .filter(r => !status || r.status === status)
        .slice(0, limit)
        .map(r => ({ id: r.id, goal: r.goal, status: r.status, currentStep: r.currentStep, total: r.steps.length, retryCount: r.retryCount, startedAt: r.startedAt }));
}

module.exports = { startDebugRun, executeStep, retryStep, interruptRun, listRuns };
