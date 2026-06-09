"use strict";
/**
 * Phase 606 — Workflow Survivability System
 *
 * Ensures workflows survive interruption: checkpoint persistence,
 * interrupt detection, resume-from-checkpoint, stale workflow cleanup,
 * survivability score.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/workflow-survivability.json");
const STALE_MS    = 2 * 60 * 60 * 1000;  // 2h without activity = stale
const MAX_CHECKPOINTS = 100;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { checkpoints: [], interrupts: [], resumes: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Checkpoint management ─────────────────────────────────────────────────────

function saveCheckpoint(workflowId, stepIndex, state = {}) {
    if (!workflowId) return { ok: false, error: "workflowId required" };
    const db   = _load();
    const key  = `${workflowId}:${stepIndex}`;
    db.checkpoints = (db.checkpoints || []).filter(c => `${c.workflowId}:${c.stepIndex}` !== key);
    db.checkpoints.unshift({
        workflowId,
        stepIndex,
        state:      JSON.stringify(state).slice(0, 2000),
        savedAt:    Date.now(),
        key,
    });
    db.checkpoints = db.checkpoints.slice(0, MAX_CHECKPOINTS);
    _save(db);
    return { ok: true, workflowId, stepIndex };
}

function loadCheckpoint(workflowId) {
    const db = _load();
    const checkpoints = (db.checkpoints || [])
        .filter(c => c.workflowId === workflowId)
        .sort((a, b) => b.stepIndex - a.stepIndex);
    if (checkpoints.length === 0) return { ok: false, error: "no checkpoint found" };
    const cp = checkpoints[0];
    let state = {};
    try { state = JSON.parse(cp.state); } catch {}
    return { ok: true, workflowId, stepIndex: cp.stepIndex, state, savedAt: cp.savedAt };
}

function deleteCheckpoints(workflowId) {
    const db = _load();
    const before = (db.checkpoints || []).length;
    db.checkpoints = (db.checkpoints || []).filter(c => c.workflowId !== workflowId);
    _save(db);
    return { ok: true, removed: before - db.checkpoints.length };
}

// ── Interrupt detection ───────────────────────────────────────────────────────

function recordInterrupt(workflowId, { reason = "", stepIndex = null, canResume = true } = {}) {
    const db = _load();
    db.interrupts = [...(db.interrupts || []), {
        workflowId,
        reason:    (reason || "").slice(0, 200),
        stepIndex,
        canResume,
        ts:        Date.now(),
    }].slice(-200);
    _save(db);
    return { ok: true, workflowId, canResume };
}

function detectStaleWorkflows() {
    const db     = _load();
    const cutoff = Date.now() - STALE_MS;
    const checkpoints = db.checkpoints || [];

    const byWorkflow = new Map();
    checkpoints.forEach(cp => {
        if (!byWorkflow.has(cp.workflowId) || byWorkflow.get(cp.workflowId).savedAt < cp.savedAt) {
            byWorkflow.set(cp.workflowId, cp);
        }
    });

    const stale = [];
    for (const [wid, cp] of byWorkflow) {
        if (cp.savedAt < cutoff) stale.push({ workflowId: wid, lastActivity: cp.savedAt, stepIndex: cp.stepIndex });
    }
    return { staleCount: stale.length, staleWorkflows: stale };
}

// ── Resume logic ──────────────────────────────────────────────────────────────

function resumeWorkflow(workflowId, { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, error: "operator approval required to resume workflow" };

    const cp = loadCheckpoint(workflowId);
    if (!cp.ok) return { ok: false, error: `No checkpoint for ${workflowId}: ${cp.error}` };

    const bwe = _tryRequire("./browserWorkflowEngine.cjs");
    let bweResult = null;
    if (bwe && bwe.resumeWorkflow) {
        try { bweResult = bwe.resumeWorkflow(workflowId); } catch {}
    }

    const db = _load();
    db.resumes = [...(db.resumes || []), {
        workflowId,
        fromStep:  cp.stepIndex,
        ts:        Date.now(),
    }].slice(-100);
    _save(db);

    return { ok: true, workflowId, resumedFromStep: cp.stepIndex, bweResult };
}

// ── Survivability score ───────────────────────────────────────────────────────

function survivabilityScore() {
    const db = _load();
    const interrupts = db.interrupts || [];
    const resumes    = db.resumes    || [];
    const checkpoints = db.checkpoints || [];

    const resumable      = interrupts.filter(i => i.canResume).length;
    const resumeRate     = interrupts.length > 0 ? resumes.length / interrupts.length : 1;
    const checkpointRate = checkpoints.length > 0 ? 1 : 0.7;

    const score = Math.min(95, Math.round((resumeRate * 0.5 + checkpointRate * 0.3 + (resumable / Math.max(interrupts.length, 1)) * 0.2) * 100));
    return {
        score,
        grade:           score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D",
        interruptCount:  interrupts.length,
        resumeCount:     resumes.length,
        checkpointCount: checkpoints.length,
        stale:           detectStaleWorkflows().staleCount,
        summary:         `Survivability: ${score}/95`,
    };
}

function survivabilityReport() {
    const score  = survivabilityScore();
    const stale  = detectStaleWorkflows();

    return {
        ok:    true,
        score,
        stale,
        recommendation: score.score < 60
            ? "Many workflows interrupted without recovery — investigate checkpoint saves"
            : score.score < 80
            ? "Survivability acceptable — review stale workflows"
            : "Workflow survivability healthy",
    };
}

module.exports = { saveCheckpoint, loadCheckpoint, deleteCheckpoints, recordInterrupt, detectStaleWorkflows, resumeWorkflow, survivabilityScore, survivabilityReport };
