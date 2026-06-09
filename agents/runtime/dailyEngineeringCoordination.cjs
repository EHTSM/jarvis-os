"use strict";
/**
 * Phase 669 — Daily Engineering Coordination
 *
 * Startup orchestration, deployment prep, debugging init, dependency verification,
 * health sequencing. Replayable. Interruption-safe. Operator-controlled.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/daily-eng-coord.json");
const MAX_RUNS   = 30;
const TTL_MS     = 24 * 60 * 60 * 1000;

const SEQUENCES = {
    "startup": [
        { step: "validate-health",       autonomous: true,  critical: true  },
        { step: "check-env",             autonomous: true,  critical: true  },
        { step: "verify-dependencies",   autonomous: true,  critical: true  },
        { step: "check-trust-level",     autonomous: true,  critical: false },
        { step: "review-interrupted",    autonomous: true,  critical: false },
        { step: "initialize-monitoring", autonomous: true,  critical: false },
    ],
    "deployment-prep": [
        { step: "run-health-checks",     autonomous: true,  critical: true  },
        { step: "check-deployment-deps", autonomous: true,  critical: true  },
        { step: "validate-patch-trust",  autonomous: true,  critical: true  },
        { step: "review-risk-signals",   autonomous: true,  critical: true  },
        { step: "operator-approve",      autonomous: false, critical: true  },
        { step: "create-deploy-plan",    autonomous: false, critical: true  },
    ],
    "debug-init": [
        { step: "identify-error-pattern", autonomous: true,  critical: true  },
        { step: "correlate-sessions",     autonomous: true,  critical: false },
        { step: "prioritize-actions",     autonomous: true,  critical: false },
        { step: "prepare-recovery-path",  autonomous: false, critical: true  },
    ],
    "dep-verification": [
        { step: "load-dependency-graph",  autonomous: true,  critical: true  },
        { step: "check-service-health",   autonomous: true,  critical: true  },
        { step: "validate-execution-order", autonomous: true, critical: true },
        { step: "confirm-ready",          autonomous: true,  critical: false },
    ],
    "health-sequence": [
        { step: "platform-resilience",   autonomous: true,  critical: true  },
        { step: "execution-state",       autonomous: true,  critical: true  },
        { step: "trust-level",           autonomous: true,  critical: false },
        { step: "memory-health",         autonomous: true,  critical: false },
        { step: "risk-summary",          autonomous: true,  critical: false },
    ],
};

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { runs: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.runs = (db.runs || []).filter(r => r.createdAt > cutoff).slice(0, MAX_RUNS);
}

// ── Sequence management ───────────────────────────────────────────────────────

function startSequence(sequenceType = "startup") {
    if (!SEQUENCES[sequenceType]) return { ok: false, error: `Unknown sequence: ${sequenceType}`, available: Object.keys(SEQUENCES) };

    const runId = crypto.randomUUID();
    const db    = _load(); _prune(db);

    const run = {
        runId,
        sequenceType,
        steps:        SEQUENCES[sequenceType].map((s, i) => ({ ...s, index: i, status: "pending", startedAt: null, completedAt: null })),
        currentStep:  0,
        status:       "running",
        createdAt:    Date.now(),
        updatedAt:    Date.now(),
    };

    db.runs.unshift(run);
    _save(db);

    return { ok: true, runId, sequenceType, stepCount: run.steps.length, firstStep: run.steps[0] };
}

function advanceStep(runId, { operatorApproved = false, result = null } = {}) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.runId === runId);
    if (idx === -1) return { ok: false, error: "Run not found" };

    const run  = db.runs[idx];
    const step = run.steps[run.currentStep];
    if (!step) return { ok: false, error: "No current step" };

    if (!step.autonomous && !operatorApproved) return { ok: false, requiresApproval: true, step: step.step };

    step.status      = "completed";
    step.completedAt = Date.now();
    step.result      = result;
    run.currentStep++;
    run.updatedAt = Date.now();

    if (run.currentStep >= run.steps.length) run.status = "completed";

    db.runs[idx] = run;
    _save(db);

    const nextStep = run.steps[run.currentStep] || null;
    return { ok: true, runId, completedStep: step.step, nextStep: nextStep?.step || null, status: run.status };
}

function interruptSequence(runId) {
    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.runId === runId);
    if (idx === -1) return { ok: false, error: "Run not found" };

    db.runs[idx].status    = "interrupted";
    db.runs[idx].updatedAt = Date.now();
    _save(db);

    return { ok: true, runId, resumeFromStep: db.runs[idx].currentStep };
}

function resumeSequence(runId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const db  = _load(); _prune(db);
    const idx = db.runs.findIndex(r => r.runId === runId);
    if (idx === -1) return { ok: false, error: "Run not found" };
    if (db.runs[idx].status !== "interrupted") return { ok: false, error: "Run is not interrupted" };

    db.runs[idx].status    = "running";
    db.runs[idx].updatedAt = Date.now();
    _save(db);

    const currentStep = db.runs[idx].steps[db.runs[idx].currentStep];
    return { ok: true, runId, resumingFrom: currentStep?.step || null };
}

function listRuns({ status = null, limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.runs
        .filter(r => !status || r.status === status)
        .slice(0, limit)
        .map(r => ({ runId: r.runId, sequenceType: r.sequenceType, status: r.status, currentStep: r.currentStep, stepCount: r.steps.length }));
}

// ── Live execution orchestration ──────────────────────────────────────────────

function runStartupOrchestration() {
    const results = [];

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) { try { const r = esi.executionStateSummary();   results.push({ step: "execution-state",  ok: r.stable,  detail: r.summary }); } catch {} }

    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae) { try { const r = dae.detectStaleDependencyChains(); results.push({ step: "dep-chains",   ok: r.ok,     detail: r.detail  }); } catch {} }

    const ecc = _tryRequire("./engineeringContextCoordination.cjs");
    if (ecc) { try { const r = ecc.reconnectInterruptedChains();   results.push({ step: "interrupted",  ok: r.count === 0, detail: r.detail }); } catch {} }

    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (otl) { try { const r = otl.trustStatus();                  results.push({ step: "trust-level",  ok: r.ok,     detail: `score=${r.score}` }); } catch {} }

    const allOk = results.every(r => r.ok !== false);
    return {
        ok:       allOk,
        results,
        ready:    allOk,
        warnings: results.filter(r => !r.ok).map(r => `${r.step}: ${r.detail}`),
        summary:  `Startup: ${results.filter(r => r.ok !== false).length}/${results.length} checks passed`,
    };
}

function catalogSequences() {
    return Object.entries(SEQUENCES).map(([type, steps]) => ({
        type,
        stepCount: steps.length,
        requiresApproval: steps.some(s => !s.autonomous),
        steps: steps.map(s => s.step),
    }));
}

module.exports = { startSequence, advanceStep, interruptSequence, resumeSequence, listRuns, runStartupOrchestration, catalogSequences };
