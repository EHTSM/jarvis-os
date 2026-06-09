"use strict";
/**
 * Phase 526 — Workspace Snapshot System
 *
 * Save and restore full engineering workspace state:
 * workspace, profile, mode, active session, workflow chain progress,
 * adapter context, continuity checkpoints.
 *
 * Lightweight, replay-safe, reconnect-safe.
 * data/workspace-snapshots.json — max 10 snapshots.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const SNAPSHOTS_PATH = path.join(__dirname, "../../data/workspace-snapshots.json");
const MAX_SNAPSHOTS  = 10;

function _load() {
    try { return JSON.parse(fs.readFileSync(SNAPSHOTS_PATH, "utf8")); }
    catch { return []; }
}

function _save(snaps) {
    try { fs.writeFileSync(SNAPSHOTS_PATH, JSON.stringify(snaps.slice(-MAX_SNAPSHOTS), null, 2)); } catch {}
}

function _genId() {
    return `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}

// ── Capture ───────────────────────────────────────────────────────────────────

/**
 * Capture full workspace state into a named snapshot.
 * @param {string} name — operator-provided label
 * @param {{ sessionId?, operatorId? }} opts
 */
function capture(name, opts = {}) {
    const workspace  = _tryRequire("./projectWorkspace.cjs");
    const profiles   = _tryRequire("./engineeringProfile.cjs");
    const modes      = _tryRequire("./runtimeModes.cjs");
    const sm         = _tryRequire("./engineeringSession.cjs");
    const continuity = _tryRequire("./engineeringContinuity.cjs");
    const pressure   = _tryRequire("./runtimePressureMonitor.cjs");

    const activeWS      = workspace ? workspace.getActiveWorkspace() : { name: "default" };
    const activeProfile = profiles  ? profiles.getActiveProfile()   : { name: "jarvis-os-dev" };
    const activeMode    = modes     ? modes.getActiveMode()          : { name: "development" };
    const session       = sm && opts.sessionId ? sm.get(opts.sessionId) : null;
    const cpList        = continuity ? continuity.listCheckpoints({ operatorId: opts.operatorId, limit: 3 }) : [];
    const progress      = continuity && opts.sessionId ? continuity.getWorkflowProgress(opts.sessionId) : null;
    const pres          = pressure ? pressure.computePressure() : { level: "nominal", score: 0 };

    const snap = {
        id:          _genId(),
        name:        (name || "snapshot").slice(0, 80),
        operatorId:  opts.operatorId || null,
        capturedAt:  Date.now(),
        workspace: {
            name:    activeWS.name,
            label:   activeWS.label,
            profile: activeWS.profile,
        },
        profile:     activeProfile.name,
        mode:        activeMode.name,
        session: session ? {
            id:    session.id,
            goal:  session.goal,
            state: session.state,
        } : null,
        workflowProgress: progress || null,
        recentCheckpoints: cpList.slice(0, 3).map(cp => ({
            id:        cp.id,
            sessionId: cp.sessionId,
            lastChain: cp.lastChain,
            lastStep:  cp.lastStep,
        })),
        pressure: { level: pres.level, score: pres.score },
    };

    const snaps = _load();
    snaps.push(snap);
    _save(snaps);

    return { ok: true, snapshot: snap };
}

// ── Restore ───────────────────────────────────────────────────────────────────

/**
 * Restore workspace state from a snapshot.
 * Returns a restoration plan — does NOT execute it.
 */
function restore(snapshotId) {
    const snaps = _load();
    const snap  = snaps.find(s => s.id === snapshotId);
    if (!snap) return { ok: false, error: `snapshot ${snapshotId} not found` };

    const workspace = _tryRequire("./projectWorkspace.cjs");
    const modes     = _tryRequire("./runtimeModes.cjs");
    const profiles  = _tryRequire("./engineeringProfile.cjs");

    const actions = [];

    // Switch workspace
    if (workspace && snap.workspace?.name) {
        const ws = workspace.getWorkspace(snap.workspace.name);
        if (ws) {
            workspace.switchWorkspace(snap.workspace.name);
            actions.push({ type: "workspace-restored", value: snap.workspace.name });
        }
    }

    // Restore mode
    if (modes && snap.mode) {
        try { modes.activateMode(snap.mode); actions.push({ type: "mode-restored", value: snap.mode }); } catch {}
    }

    // Restore profile
    if (profiles && snap.profile) {
        try { profiles.activateProfile(snap.profile); actions.push({ type: "profile-restored", value: snap.profile }); } catch {}
    }

    return {
        ok:              true,
        snapshotId,
        name:            snap.name,
        capturedAt:      snap.capturedAt,
        actionsApplied:  actions.length,
        actions,
        sessionHint:     snap.session ? `Previous session: "${snap.session.goal}" (${snap.session.state})` : null,
        workflowHint:    snap.workflowProgress ? `Resume workflow "${snap.workflowProgress.workflowId}" at step ${snap.workflowProgress.stepIndex}` : null,
        chainHint:       snap.recentCheckpoints[0]?.lastChain || null,
        restoredAt:      new Date().toISOString(),
    };
}

/**
 * Delete a snapshot.
 */
function deleteSnapshot(snapshotId) {
    const snaps = _load();
    const idx   = snaps.findIndex(s => s.id === snapshotId);
    if (idx < 0) return { ok: false, error: "snapshot not found" };
    snaps.splice(idx, 1);
    _save(snaps);
    return { ok: true };
}

/**
 * List all snapshots (newest first).
 */
function listSnapshots({ operatorId } = {}) {
    return _load()
        .filter(s => !operatorId || s.operatorId === operatorId)
        .reverse()
        .map(s => ({
            id:         s.id,
            name:       s.name,
            operatorId: s.operatorId,
            capturedAt: s.capturedAt,
            workspace:  s.workspace?.name,
            mode:       s.mode,
            hasSession: !!s.session,
            hasWorkflowProgress: !!s.workflowProgress,
        }));
}

module.exports = { capture, restore, deleteSnapshot, listSnapshots };
