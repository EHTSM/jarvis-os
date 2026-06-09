"use strict";
/**
 * Phase 499 — Engineering Continuity Mode
 *
 * Interrupted-session continuation, reconnect-safe debugging,
 * deployment-session recovery, workflow persistence, runtime restoration.
 *
 * Makes long engineering sessions survivable across disconnects/restarts.
 * State stored in data/continuity-state.json.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/continuity-state.json");
const MAX_CHECKPOINTS = 20;

// ── Persistence ───────────────────────────────────────────────────────────────

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { checkpoints: [], lastRestoredAt: null }; }
}

function _save(state) {
    try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch {}
}

// ── Checkpoint creation ───────────────────────────────────────────────────────

/**
 * Create a continuity checkpoint for a session.
 * Captures session state, active workspace, mode, recent workflow.
 */
function checkpoint(sessionId, opts = {}) {
    const sm        = _tryRequire("./engineeringSession.cjs");
    const workspace = _tryRequire("./projectWorkspace.cjs");
    const modes     = _tryRequire("./runtimeModes.cjs");
    const hardening = _tryRequire("./sessionHardening.cjs");

    const session = sm ? sm.get(sessionId) : null;
    if (!session && !opts.force) return { ok: false, error: "session not found" };

    const cp = {
        id:           `cp-${Date.now().toString(36)}`,
        sessionId,
        goal:         session ? session.goal  : (opts.goal || "unknown"),
        sessionState: session ? session.state : "unknown",
        workspace:    workspace ? workspace.getActiveWorkspace().name : "default",
        mode:         modes    ? modes.getActiveMode().name           : "development",
        lastChain:    opts.lastChain  || null,
        lastStep:     opts.lastStep   || null,
        context:      opts.context    || {},
        operatorId:   opts.operatorId || null,
        createdAt:    Date.now(),
    };

    const state = _load();
    state.checkpoints = [cp, ...state.checkpoints].slice(0, MAX_CHECKPOINTS);
    _save(state);

    return { ok: true, checkpoint: cp };
}

// ── Session restoration ───────────────────────────────────────────────────────

/**
 * Restore the most recent viable session for an operator.
 * Returns the checkpoint + restoration plan.
 */
function findRestorable(operatorId) {
    const sm      = _tryRequire("./engineeringSession.cjs");
    const state   = _load();
    const hardening = _tryRequire("./sessionHardening.cjs");

    // Try session hardening first (has stale detection)
    if (hardening && hardening.findRecoverableSession) {
        const recoverable = hardening.findRecoverableSession(operatorId);
        if (recoverable) {
            const cp = state.checkpoints.find(c => c.sessionId === recoverable.id);
            return {
                found:       true,
                source:      "session-hardening",
                session:     recoverable,
                checkpoint:  cp || null,
                plan:        _buildRestorationPlan(recoverable, cp),
            };
        }
    }

    // Fall back to checkpoint search
    const matchingCp = state.checkpoints.find(cp =>
        (!operatorId || cp.operatorId === operatorId) &&
        cp.sessionState === "active"
    );

    if (!matchingCp) return { found: false, reason: "no restorable session found" };

    const session = sm ? sm.get(matchingCp.sessionId) : null;
    return {
        found:      true,
        source:     "checkpoint",
        session:    session || { id: matchingCp.sessionId, goal: matchingCp.goal, state: matchingCp.sessionState },
        checkpoint: matchingCp,
        plan:       _buildRestorationPlan(session, matchingCp),
    };
}

function _buildRestorationPlan(session, checkpoint) {
    const steps = [];

    steps.push({ step: 1, action: "verify-health",    label: "Check runtime health before resuming", command: "GET /api/runtime/pressure" });
    steps.push({ step: 2, action: "restore-workspace", label: `Switch to workspace: ${checkpoint ? checkpoint.workspace : "default"}`,
        command: checkpoint ? `POST /api/runtime/workspaces/switch {name:'${checkpoint.workspace}'}` : null });
    steps.push({ step: 3, action: "restore-mode",      label: `Restore runtime mode: ${checkpoint ? checkpoint.mode : "development"}`,
        command: checkpoint ? `POST /api/runtime/modes/activate {mode:'${checkpoint.mode}'}` : null });

    if (checkpoint && checkpoint.lastChain) {
        steps.push({ step: 4, action: "resume-workflow", label: `Resume last chain: ${checkpoint.lastChain}`,
            command: `POST /api/runtime/chains/execute {chain:'${checkpoint.lastChain}'}`,
            note:    checkpoint.lastStep ? `Last completed step: ${checkpoint.lastStep}` : null });
    }

    steps.push({ step: steps.length + 1, action: "verify-session", label: "Verify session is active and healthy",
        command: `GET /api/runtime/sessions/${session ? session.id : "?"}` });

    return {
        sessionId: session ? session.id : null,
        goal:      session ? session.goal : (checkpoint ? checkpoint.goal : "unknown"),
        steps,
    };
}

// ── Workflow persistence ──────────────────────────────────────────────────────

/**
 * Save in-progress workflow state so it can be resumed after interruption.
 */
function saveWorkflowProgress(sessionId, workflowId, stepIndex, context = {}) {
    const state = _load();
    if (!state.workflowProgress) state.workflowProgress = {};
    state.workflowProgress[sessionId] = {
        workflowId,
        stepIndex,
        context,
        savedAt: Date.now(),
    };
    _save(state);
    return { ok: true };
}

/**
 * Get saved workflow progress for a session.
 */
function getWorkflowProgress(sessionId) {
    const state = _load();
    return (state.workflowProgress || {})[sessionId] || null;
}

// ── Runtime restoration ───────────────────────────────────────────────────────

/**
 * Full runtime restoration after a crash/restart.
 * Returns a restoration summary with all recovery actions needed.
 */
function runtimeRestoration() {
    const sm        = _tryRequire("./engineeringSession.cjs");
    const workspace = _tryRequire("./projectWorkspace.cjs");
    const modes     = _tryRequire("./runtimeModes.cjs");
    const hardening = _tryRequire("./sessionHardening.cjs");
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");

    const actions   = [];
    const warnings  = [];

    // Stale session recovery
    if (hardening && hardening.recoverStaleSessions) {
        const recovered = hardening.recoverStaleSessions();
        if (recovered > 0) {
            actions.push({ type: "stale-sessions-cleaned", count: recovered, label: `Cleaned ${recovered} stale session(s)` });
        }
    }

    // Blocked sessions
    if (sm) {
        const blocked = sm.list({ limit: 20 }).filter(s => s.state === "blocked");
        if (blocked.length > 0) {
            warnings.push(`${blocked.length} blocked session(s) found after restoration`);
            actions.push({ type: "blocked-sessions", count: blocked.length, label: `${blocked.length} session(s) need manual review`, ids: blocked.map(s => s.id) });
        }
    }

    // Pressure after restoration
    const pres = pressure ? pressure.computePressure() : null;
    if (pres && (pres.level === "high" || pres.level === "critical")) {
        warnings.push(`Runtime pressure is ${pres.level} post-restoration — consider safe-mode`);
        actions.push({ type: "pressure-warning", level: pres.level, label: `Switch to safe-mode: POST /api/runtime/modes/activate {mode:'safe-mode'}` });
    }

    const state = _load();
    state.lastRestoredAt = Date.now();
    _save(state);

    return {
        restoredAt:     new Date().toISOString(),
        actionsApplied: actions.length,
        warnings,
        actions,
        pressureLevel:  pres ? pres.level : "unknown",
        activeWorkspace: workspace ? workspace.getActiveWorkspace().name : "default",
        runtimeMode:    modes    ? modes.getActiveMode().name : "development",
        status:         warnings.length === 0 ? "clean" : "degraded",
    };
}

/**
 * List recent checkpoints (for operator visibility).
 */
function listCheckpoints({ operatorId, limit = 10 } = {}) {
    const state = _load();
    return (state.checkpoints || [])
        .filter(cp => !operatorId || cp.operatorId === operatorId)
        .slice(0, limit);
}

module.exports = {
    checkpoint, findRestorable, saveWorkflowProgress,
    getWorkflowProgress, runtimeRestoration, listCheckpoints,
};
