"use strict";
/**
 * Phase 471 — Deployment Pipeline Foundation
 *
 * Preflight checks, environment validation, deployment execution model,
 * post-deployment verification, and rollback orchestration.
 *
 * A pipeline is a named, replayable sequence of stages.
 * Each stage maps to an execution chain (from executionChainPlanner).
 * Stages have approval gates and are auditable.
 *
 * Pipeline state is persisted to data/pipeline-runs.json.
 * Max 20 pipeline runs retained.
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../../backend/utils/logger");

const RUNS_PATH = path.join(__dirname, "../../data/pipeline-runs.json");
const MAX_RUNS  = 20;

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Built-in pipelines ────────────────────────────────────────────────────────
const PIPELINES = {
    "standard-deploy": {
        name:  "standard-deploy",
        label: "Standard Deployment",
        stages: [
            { name: "preflight",    chain: "deployment-readiness", approvalLevel: "CAUTION",  rollbackSafe: true  },
            { name: "deploy",       chain: "deploy-update",        approvalLevel: "CRITICAL", rollbackSafe: false },
            { name: "verify",       chain: "health-check",         approvalLevel: "SAFE",     rollbackSafe: true  },
        ],
        rollbackChain: "recover-backend",
        requiresApproval: true,
    },
    "safe-update": {
        name:  "safe-update",
        label: "Safe Git Update",
        stages: [
            { name: "git-update",   chain: "git-safe-update",   approvalLevel: "CAUTION", rollbackSafe: true },
            { name: "health-check", chain: "health-check",      approvalLevel: "SAFE",    rollbackSafe: true },
        ],
        rollbackChain: "git-conflict-recovery",
        requiresApproval: false,
    },
    "frontend-deploy": {
        name:  "frontend-deploy",
        label: "Frontend Deployment",
        stages: [
            { name: "preflight",  chain: "deployment-readiness",      approvalLevel: "CAUTION",  rollbackSafe: true  },
            { name: "build",      chain: "recover-frontend-runtime",   approvalLevel: "CAUTION",  rollbackSafe: true  },
            { name: "stabilize",  chain: "stabilize-frontend",         approvalLevel: "SAFE",     rollbackSafe: true  },
            { name: "verify",     chain: "health-check",               approvalLevel: "SAFE",     rollbackSafe: true  },
        ],
        rollbackChain: "recover-frontend-runtime",
        requiresApproval: true,
    },
};

// ── Run persistence ───────────────────────────────────────────────────────────
function _loadRuns() {
    try { return JSON.parse(fs.readFileSync(RUNS_PATH, "utf8")); }
    catch { return []; }
}

function _saveRuns(runs) {
    try {
        const dir = path.dirname(RUNS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(RUNS_PATH, JSON.stringify(runs.slice(-MAX_RUNS), null, 2));
    } catch {}
}

function _genRunId() {
    return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** List available pipelines. */
function listPipelines() {
    return Object.values(PIPELINES).map(p => ({
        name:             p.name,
        label:            p.label,
        stageCount:       p.stages.length,
        requiresApproval: p.requiresApproval,
        rollbackChain:    p.rollbackChain,
    }));
}

/** Get a pipeline definition. */
function getPipeline(name) { return PIPELINES[name] || null; }

/**
 * Create a pipeline run record (does NOT execute — execution is done by the
 * coordinator). Returns a run object the caller uses to track progress.
 * @param {string} pipelineName
 * @param {object} opts — { operatorId, sessionId, approved, dryRun }
 */
function createRun(pipelineName, opts = {}) {
    const pipeline = PIPELINES[pipelineName];
    if (!pipeline) return { created: false, error: `unknown pipeline: ${pipelineName}` };

    const run = {
        id:           _genRunId(),
        pipeline:     pipelineName,
        operatorId:   opts.operatorId  || null,
        sessionId:    opts.sessionId   || null,
        approved:     opts.approved    === true,
        dryRun:       opts.dryRun      === true,
        state:        "pending",   // pending | running | passed | failed | rolled-back
        createdAt:    Date.now(),
        startedAt:    null,
        completedAt:  null,
        stages:       pipeline.stages.map(s => ({
            name:    s.name,
            chain:   s.chain,
            state:   "pending",   // pending | running | passed | failed | skipped
            result:  null,
        })),
        rollbackTriggered: false,
        auditLog:     [],
    };

    // Safety: CRITICAL pipelines must be explicitly approved
    if (pipeline.requiresApproval && !run.approved && !run.dryRun) {
        logger.warn(`[Pipeline] run=${run.id} pipeline=${pipelineName} requires approval`);
        run.state = "awaiting-approval";
    }

    const runs = _loadRuns();
    runs.push(run);
    _saveRuns(runs);
    return { created: true, run };
}

/** Update a stage within a run. */
function updateStage(runId, stageName, update) {
    const runs = _loadRuns();
    const run  = runs.find(r => r.id === runId);
    if (!run) return false;
    const stage = run.stages.find(s => s.name === stageName);
    if (!stage) return false;
    Object.assign(stage, update);
    if (update.state === "failed") {
        run.state = "failed";
        run.auditLog.push({ ts: Date.now(), event: "stage-failed", stage: stageName });
    } else if (run.stages.every(s => s.state === "passed")) {
        run.state      = "passed";
        run.completedAt = Date.now();
    }
    _saveRuns(runs);
    return true;
}

/** Approve a pending run. */
function approveRun(runId) {
    const runs = _loadRuns();
    const run  = runs.find(r => r.id === runId);
    if (!run) return false;
    if (run.state !== "awaiting-approval") return false;
    run.state    = "pending";
    run.approved = true;
    run.auditLog.push({ ts: Date.now(), event: "approved" });
    _saveRuns(runs);
    return true;
}

/** Mark a run as rolled back. */
function markRolledBack(runId, reason = "") {
    const runs = _loadRuns();
    const run  = runs.find(r => r.id === runId);
    if (!run) return false;
    run.state              = "rolled-back";
    run.rollbackTriggered  = true;
    run.completedAt        = Date.now();
    run.auditLog.push({ ts: Date.now(), event: "rollback", reason: reason.slice(0, 200) });
    _saveRuns(runs);
    return true;
}

/** List recent runs. */
function listRuns({ pipeline, state, limit = 20 } = {}) {
    return _loadRuns()
        .filter(r => !pipeline || r.pipeline === pipeline)
        .filter(r => !state    || r.state    === state)
        .slice(-Math.min(limit, MAX_RUNS))
        .reverse();
}

/** Get a specific run. */
function getRun(runId) {
    return _loadRuns().find(r => r.id === runId) || null;
}

module.exports = { listPipelines, getPipeline, createRun, updateStage, approveRun, markRolledBack, listRuns, getRun, PIPELINES };
