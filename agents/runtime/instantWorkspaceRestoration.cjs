"use strict";
/**
 * Phase 706 — Instant Workspace Restoration
 *
 * Reconnect-safe restoration of VS Code state, terminal sessions,
 * browser workflows, deployment context, replay continuity, debugging workflows.
 * Stale-session protection. Replay durability.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH    = path.join(__dirname, "../../data/instant-workspace-restore.json");
const STALE_MS      = 12 * 60 * 60 * 1000;
const DEDUP_MS      = 10 * 60 * 1000;
const SESSION_TTL   = 14 * 24 * 60 * 60 * 1000;
const MAX_SNAPSHOTS = 20;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { snapshots: [], restores: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - SESSION_TTL;
    db.snapshots = (db.snapshots || []).filter(s => s.ts > cut).slice(0, MAX_SNAPSHOTS);
    db.restores  = (db.restores  || []).filter(r => r.ts > cut).slice(0, 100);
}

// ── Snapshot full workspace ───────────────────────────────────────────────────

function snapshotFullWorkspace(snapshotId, state = {}) {
    if (!snapshotId) return { ok: false, error: "snapshotId required" };
    const db  = _load(); _prune(db);
    const idx = db.snapshots.findIndex(s => s.snapshotId === snapshotId);
    const record = {
        snapshotId,
        vsCode:      state.vsCode      || null,
        terminal:    state.terminal    || null,
        browser:     state.browser     || null,
        deployment:  state.deployment  || null,
        replay:      state.replay      || null,
        debugging:   state.debugging   || null,
        goal:        (state.goal || "").slice(0, 200),
        ts:          Date.now(),
        createdAt:   idx >= 0 ? db.snapshots[idx].createdAt : Date.now(),
    };
    if (idx >= 0) { db.snapshots[idx] = record; } else { db.snapshots.unshift(record); }
    _save(db);
    return { ok: true, snapshotId, components: Object.keys(record).filter(k => record[k] && !["snapshotId","goal","ts","createdAt"].includes(k)) };
}

// ── Instant restore ───────────────────────────────────────────────────────────

function instantRestore(snapshotId, { operatorApproved = false, force = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const db     = _load(); _prune(db);
    const snap   = db.snapshots.find(s => s.snapshotId === snapshotId);
    if (!snap) return { ok: false, error: "Snapshot not found" };

    const ageMs = Date.now() - snap.ts;
    if (ageMs > STALE_MS && !force) return { ok: false, stale: true, ageMs, error: "Snapshot stale (>12h) — pass force=true" };

    const restored = [];

    // VS Code
    const vei = _tryRequire("./vsCodeExecutionIntelligence.cjs");
    if (vei && snap.vsCode) {
        try { vei.restoreEditContinuity(snapshotId); restored.push("vscode"); } catch {}
    }

    // Terminal
    const ewr = _tryRequire("./engineeringWorkspaceRestoration.cjs");
    if (ewr && snap.terminal) {
        try { ewr.restoreTerminalSession(snapshotId, { operatorApproved: true }); restored.push("terminal"); } catch {}
    }

    // Browser
    if (ewr && snap.browser) {
        try { ewr.restoreBrowserState(snapshotId, { operatorApproved: true }); restored.push("browser"); } catch {}
    }

    // Deployment context
    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec && snap.deployment) {
        try { dec.persistDeploymentReplayContinuity(snapshotId, snap.deployment); restored.push("deployment"); } catch {}
    }

    // Replay continuity
    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc && snap.replay) {
        try { lhwc.persistWorkspaceSession(snapshotId, { goal: snap.goal, env: snap.replay?.env || "default", progress: snap.replay?.progress || 0 }); restored.push("replay"); } catch {}
    }

    // Debugging workflows
    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee && snap.debugging) {
        try { cee.saveExecutionContext(`debug-restore-${snapshotId}`, { env: snap.debugging?.env || "vscode", goal: snap.goal, depth: 1 }); restored.push("debugging"); } catch {}
    }

    db.restores.push({ snapshotId, ts: Date.now(), restored });
    _save(db);

    return { ok: true, snapshotId, restored, ageMs, stale: ageMs > STALE_MS, detail: `Restored: ${restored.join(", ") || "nothing"}` };
}

// ── Reconnect-safe partial restore ────────────────────────────────────────────

function reconnectSafeRestore(snapshotId, components = []) {
    const db   = _load();
    const snap = db.snapshots.find(s => s.snapshotId === snapshotId);
    if (!snap) return { ok: false, error: "Snapshot not found" };

    const ageMs  = Date.now() - snap.ts;
    const stale  = ageMs > STALE_MS;
    const targets = components.length > 0 ? components : ["vscode", "terminal", "replay"];

    // Check for reconnect storm first
    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const storm = lhwc.workspaceStormStatus();
            if (storm.storm) return { ok: false, storm: true, error: "Reconnect storm detected — defer restoration", recentCount: storm.recentCount };
        } catch {}
    }

    const available = targets.filter(t => snap[t] !== null && snap[t] !== undefined);
    return {
        ok:        !stale,
        snapshotId,
        available,
        stale,
        ageMs,
        warning:   stale ? "Stale snapshot — use force=true in instantRestore" : null,
        detail:    `Reconnect-safe: ${available.length}/${targets.length} components available`,
    };
}

// ── List snapshots ────────────────────────────────────────────────────────────

function listWorkspaceSnapshots({ limit = 10 } = {}) {
    const db = _load(); _prune(db);
    return db.snapshots.slice(0, limit).map(s => ({
        snapshotId: s.snapshotId,
        goal:       s.goal,
        ageMs:      Date.now() - s.ts,
        stale:      (Date.now() - s.ts) > STALE_MS,
        components: ["vsCode","terminal","browser","deployment","replay","debugging"].filter(k => s[k] !== null && s[k] !== undefined),
    }));
}

// ── Restore health summary ────────────────────────────────────────────────────

function workspaceRestoreHealth() {
    const db    = _load(); _prune(db);
    const fresh = db.snapshots.filter(s => (Date.now() - s.ts) <= STALE_MS);
    const stale = db.snapshots.filter(s => (Date.now() - s.ts) >  STALE_MS);

    const lhwc  = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    let storm   = false;
    if (lhwc) { try { storm = lhwc.workspaceStormStatus().storm; } catch {} }

    return {
        ok:             !storm && fresh.length >= 0,
        freshSnapshots: fresh.length,
        staleSnapshots: stale.length,
        totalSnapshots: db.snapshots.length,
        storm,
        summary:        `Workspace restore: ${fresh.length} fresh, ${stale.length} stale, storm=${storm}`,
    };
}

module.exports = { snapshotFullWorkspace, instantRestore, reconnectSafeRestore, listWorkspaceSnapshots, workspaceRestoreHealth };
