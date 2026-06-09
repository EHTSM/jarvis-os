"use strict";
/**
 * Phase 697 — Engineering Workspace Restoration
 *
 * Reconnect-safe workspace restore, terminal-session restoration,
 * replay continuity recovery, deployment-session persistence, browser-state restoration.
 * PREVENTS: duplicate execution resurrection, stale workflow continuation, replay corruption.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/workspace-restoration.json");
const MAX_SNAPSHOTS = 20;
const TTL_MS        = 24 * 60 * 60 * 1000;
const STALE_MS      = 12 * 60 * 60 * 1000;
const DEDUP_MS      = 10 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { snapshots: [], dedup: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.snapshots = (db.snapshots || []).filter(s => s.ts > cutoff).slice(0, MAX_SNAPSHOTS);
    db.dedup     = (db.dedup     || []).filter(d => d.ts > Date.now() - DEDUP_MS);
}

function _isDup(db, key) { return db.dedup.some(d => d.key === key); }

// ── Workspace snapshot ────────────────────────────────────────────────────────

function snapshotWorkspace(workspaceId, opts = {}) {
    if (!workspaceId) return { ok: false, error: "workspaceId required" };
    const { openFiles = [], activeTerminals = [], activeBrowserSessions = [], deploymentId = null } = opts;

    const db  = _load(); _prune(db);
    const idx = db.snapshots.findIndex(s => s.workspaceId === workspaceId);

    const record = {
        workspaceId,
        openFiles:             openFiles.slice(0, 20),
        activeTerminals:       activeTerminals.slice(0, 10),
        activeBrowserSessions: activeBrowserSessions.slice(0, 5),
        deploymentId,
        createdAt: idx >= 0 ? db.snapshots[idx].createdAt : Date.now(),
        ts: Date.now(),
    };

    if (idx >= 0) { db.snapshots[idx] = record; }
    else          { db.snapshots.unshift(record); }
    _save(db);
    return { ok: true, workspaceId, fileCount: openFiles.length, terminalCount: activeTerminals.length };
}

// ── Reconnect-safe workspace restore ─────────────────────────────────────────

function restoreWorkspace(workspaceId, { operatorApproved = false, force = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const db       = _load(); _prune(db);
    const dupKey   = `restore:${workspaceId}`;
    if (_isDup(db, dupKey)) return { ok: false, duplicate: true, error: "Workspace restore blocked in dedup window" };
    db.dedup.push({ key: dupKey, ts: Date.now() });

    const snapshot = db.snapshots.find(s => s.workspaceId === workspaceId);
    if (!snapshot) return { ok: false, error: "No workspace snapshot found" };

    const ageMs = Date.now() - snapshot.ts;
    const stale = ageMs > STALE_MS;
    if (stale && !force) { _save(db); return { ok: false, stale: true, ageMs, error: "Snapshot stale (>12h) — pass force=true to restore" }; }

    _save(db);
    return {
        ok:          true,
        workspaceId,
        snapshot,
        ageMs,
        stale,
        warning:     stale ? "Stale snapshot restored — validate state before continuing" : null,
        approvalRequired: true,
    };
}

// ── Terminal session restoration ──────────────────────────────────────────────

function restoreTerminalSession(sessionId = "", { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const db     = _load(); _prune(db);
    const dupKey = `term-restore:${sessionId}`;
    if (_isDup(db, dupKey)) return { ok: false, duplicate: true, error: "Terminal session restore blocked in dedup window" };
    db.dedup.push({ key: dupKey, ts: Date.now() });

    // Check terminal coord intelligence for chain state
    const tci = _tryRequire("./terminalCoordinationIntelligence.cjs");
    let chainRecovery = null;
    if (tci && sessionId) { try { chainRecovery = tci.recoverTerminalReplay(sessionId); } catch {} }

    _save(db);
    return {
        ok:            true,
        sessionId,
        chainRecovery: chainRecovery?.ok ? chainRecovery : null,
        plan: [
            { step: "validate-terminal-state", autonomous: true  },
            { step: "restore-working-dir",     autonomous: true  },
            { step: "resume-chain",            autonomous: false, requiresApproval: true },
        ],
        approvalRequired: true,
    };
}

// ── Replay continuity recovery ────────────────────────────────────────────────

function recoverReplayContinuity(replayId = "", { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };
    if (!replayId) return { ok: false, error: "replayId required" };

    const db     = _load(); _prune(db);
    const dupKey = `replay-recovery:${replayId}`;
    if (_isDup(db, dupKey)) return { ok: false, duplicate: true, error: "Replay recovery blocked in dedup window" };
    db.dedup.push({ key: dupKey, ts: Date.now() });
    _save(db);

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let replayState = null;
    if (lhec) { try { replayState = lhec.restoreReplayContinuity(replayId); } catch {} }

    return {
        ok:          true,
        replayId,
        replayState: replayState?.ok ? replayState : null,
        stale:       replayState?.stale || false,
        warning:     replayState?.stale ? "Replay state stale — verify before execution" : null,
        approvalRequired: true,
    };
}

// ── Deployment-session persistence ────────────────────────────────────────────

function persistDeploymentWorkspaceSession(deploymentId, workspaceId) {
    const db  = _load(); _prune(db);
    const idx = db.snapshots.findIndex(s => s.workspaceId === workspaceId);
    if (idx >= 0) { db.snapshots[idx].deploymentId = deploymentId; db.snapshots[idx].ts = Date.now(); _save(db); }
    return { ok: true, deploymentId, workspaceId };
}

// ── Browser-state restoration ─────────────────────────────────────────────────

function restoreBrowserState(sessionId = "", { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const boc = _tryRequire("./browserOperationCoordination.cjs");
    if (boc) {
        try {
            const continuity = boc.checkAuthContinuity(sessionId);
            if (!continuity.ok) return { ok: false, blocked: true, reason: continuity.error || continuity.warning };
        } catch {}
    }

    return {
        ok:   true,
        sessionId,
        plan: [
            { step: "validate-session",       autonomous: true  },
            { step: "check-stale-state",      autonomous: true  },
            { step: "restore-auth-context",   autonomous: false, requiresApproval: true },
            { step: "validate-page-state",    autonomous: true  },
        ],
        approvalRequired: true,
    };
}

// ── Workspace restoration summary ─────────────────────────────────────────────

function workspaceRestorationSummary() {
    const db    = _load(); _prune(db);
    const stale = db.snapshots.filter(s => (Date.now() - s.ts) > STALE_MS);
    return {
        ok:              true,
        snapshotCount:   db.snapshots.length,
        staleCount:      stale.length,
        activeCount:     db.snapshots.length - stale.length,
        summary:         `Workspace restoration: ${db.snapshots.length} snapshots, ${stale.length} stale`,
    };
}

module.exports = { snapshotWorkspace, restoreWorkspace, restoreTerminalSession, recoverReplayContinuity, persistDeploymentWorkspaceSession, restoreBrowserState, workspaceRestorationSummary };
