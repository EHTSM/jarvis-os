"use strict";
/**
 * interruptionTester — schedule and verify workflow interruptions and restarts.
 *
 * scheduleInterruption(workflowId, atStep, reason?)
 *   — register a pending interruption for a step
 *
 * checkInterruption(workflowId, currentStep)
 *   → { shouldInterrupt, reason }
 *
 * testRestartFrom(workflowId, checkpoint, ctx?)
 *   → { canRestart, completedSteps[], pendingSteps[], resumeCtx }
 *
 * verifyResume(workflowId, completedSteps[], allSteps[])
 *   → { canResume, missing[], ready }
 *
 * getLog()   → all interruption events
 * reset()
 */

// workflowId → [{atStep, reason, triggered, ts}]
const _pending = new Map();
let   _log     = [];
let   _seq     = 0;

// ── scheduleInterruption ──────────────────────────────────────────────

function scheduleInterruption(workflowId, atStep, reason = "test_interruption") {
    if (!_pending.has(workflowId)) _pending.set(workflowId, []);
    const entry = {
        seq:       ++_seq,
        workflowId,
        atStep,
        reason,
        triggered: false,
        ts:        new Date().toISOString(),
    };
    _pending.get(workflowId).push(entry);
    return entry;
}

// ── checkInterruption ─────────────────────────────────────────────────

function checkInterruption(workflowId, currentStep) {
    const entries = _pending.get(workflowId) || [];
    for (const entry of entries) {
        if (entry.triggered) continue;
        if (entry.atStep === currentStep || entry.atStep === "*") {
            entry.triggered = true;
            const event = {
                seq:        ++_seq,
                ts:         new Date().toISOString(),
                type:       "interruption_triggered",
                workflowId,
                step:       currentStep,
                reason:     entry.reason,
            };
            _log.push(event);
            return { shouldInterrupt: true, reason: entry.reason };
        }
    }
    return { shouldInterrupt: false, reason: null };
}

// ── testRestartFrom ───────────────────────────────────────────────────

function testRestartFrom(workflowId, checkpoint, ctx = {}) {
    if (!checkpoint) {
        return {
            canRestart:     false,
            completedSteps: [],
            pendingSteps:   [],
            resumeCtx:      ctx,
            error:          "no_checkpoint",
        };
    }

    const completedSteps = checkpoint.completedSteps || [];
    const allSteps       = checkpoint.allSteps       || [];
    const pendingSteps   = allSteps.filter(s => !completedSteps.includes(s));

    const resumeCtx = Object.assign({}, checkpoint.ctx || {}, ctx, { _resumed: true });

    const event = {
        seq:        ++_seq,
        ts:         new Date().toISOString(),
        type:       "restart_simulated",
        workflowId,
        completedSteps,
        pendingSteps,
    };
    _log.push(event);

    return {
        canRestart:     pendingSteps.length > 0 || completedSteps.length > 0,
        completedSteps,
        pendingSteps,
        resumeCtx,
    };
}

// ── verifyResume ──────────────────────────────────────────────────────

function verifyResume(workflowId, completedSteps = [], allSteps = []) {
    const completedSet = new Set(completedSteps);
    const missing      = allSteps.filter(s => !completedSet.has(s));

    const event = {
        seq:        ++_seq,
        ts:         new Date().toISOString(),
        type:       "resume_verified",
        workflowId,
        completedCount: completedSteps.length,
        missingCount:   missing.length,
    };
    _log.push(event);

    return {
        canResume: missing.length > 0,
        missing,
        ready:     missing.length === 0,
        completedSteps,
    };
}

function getLog()  { return [..._log]; }
function reset()   { _pending.clear(); _log = []; _seq = 0; }

module.exports = {
    scheduleInterruption,
    checkInterruption,
    testRestartFrom,
    verifyResume,
    getLog,
    reset,
};
