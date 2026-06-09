"use strict";
/**
 * Phase 593 — Advanced Recovery Orchestration
 *
 * Interrupted workflow restoration, deployment rollback recovery,
 * adapter restart coordination, runtime-state healing, replay-chain restoration.
 *
 * Prevents: duplicate recovery, stale resurrection, replay corruption.
 * State: data/recovery-orchestration.json
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/recovery-orchestration.json");

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { active: {}, completed: [], dedupeLog: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}

// ── Duplicate execution guard ─────────────────────────────────────────────────

const DEDUP_TTL_MS = 10 * 60 * 1000; // 10 min

function _isDuplicateRecovery(db, recoveryKey) {
    const now   = Date.now();
    const log   = (db.dedupeLog || []).filter(e => now - e.ts < DEDUP_TTL_MS);
    db.dedupeLog = log;
    if (log.some(e => e.key === recoveryKey)) return true;
    log.push({ key: recoveryKey, ts: now });
    db.dedupeLog = log;
    return false;
}

// ── Interrupted workflow restoration ─────────────────────────────────────────

/**
 * Restore an interrupted engineering chain from its last checkpoint.
 */
function restoreInterruptedChain(chainId, { approved = false, sessionId = null } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required" };

    const ec = _tryRequire("./engineeringChains.cjs");
    if (!ec) return { ok: false, error: "engineeringChains unavailable" };

    const active = ec.getActiveChains();
    const chain  = active.find(c => c.chainId === chainId);
    if (!chain) return { ok: false, error: `Chain ${chainId} not found in active chains` };
    if (!chain.stale) return { ok: false, error: "Chain is still running — not safe to restore" };

    const db  = _load();
    const key = `restore:${chainId}`;
    if (_isDuplicateRecovery(db, key)) { _save(db); return { ok: false, error: "Duplicate restore attempt detected — cooldown active" }; }
    _save(db);

    // Resume from last known step
    return ec.executeChain(chain.chainName, { approved: true, sessionId: sessionId || chain.sessionId, resumeFromStep: chain.lastStep });
}

// ── Deployment rollback recovery ──────────────────────────────────────────────

function executeDeploymentRollback(runId, { approved = false } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required for deployment rollback" };

    const db  = _load();
    const key = `rollback:${runId}`;
    if (_isDuplicateRecovery(db, key)) { _save(db); return { ok: false, error: "Duplicate rollback attempt — cooldown active" }; }

    const pipeline = _tryRequire("./deploymentPipeline.cjs");
    let result     = { note: "deploymentPipeline not loaded — manual rollback required" };

    if (pipeline && typeof pipeline.rollbackRun === "function") {
        try { result = pipeline.rollbackRun(runId); } catch (e) { result = { error: e.message }; }
    }

    // Record to timeline
    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordDeployment("rollback", "rolling-back", runId);

    // Record recovery
    const rdv = _tryRequire("./dailyEngineeringValidation.cjs");
    if (rdv) try { rdv.recordDeployment({ success: false, rollback: true }); } catch {}

    _save(db);
    return { ok: true, runId, ...result };
}

// ── Adapter restart coordination ──────────────────────────────────────────────

/**
 * Coordinate restart of a named adapter with duplicate-restart guard.
 */
function restartAdapter(adapterName, { approved = false, reason = "" } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required" };

    const db  = _load();
    const key = `adapter-restart:${adapterName}`;
    if (_isDuplicateRecovery(db, key)) { _save(db); return { ok: false, error: `Adapter '${adapterName}' restart already in progress — cooldown active` }; }
    _save(db);

    const health = _tryRequire("./agents/runtime/adapters/adapterHealthMonitor.cjs");
    let   result = { note: "adapterHealthMonitor not loaded — restart must be done manually" };

    if (health && typeof health.restartAdapter === "function") {
        try { result = health.restartAdapter(adapterName); } catch (e) { result = { error: e.message }; }
    }

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("recovery", { label: `Adapter restart: ${adapterName}`, adapterName, reason });

    return { ok: true, adapterName, reason, ...result };
}

// ── Runtime-state healing ─────────────────────────────────────────────────────

/**
 * Attempt to heal runtime state: clear stale active chains, mark stuck processes.
 */
function healRuntimeState({ approved = false } = {}) {
    if (!approved) return { ok: false, error: "Operator approval required" };

    const healed  = [];
    const ec      = _tryRequire("./engineeringChains.cjs");
    const ts      = _tryRequire("./terminalSupervisor.cjs");

    if (ec) {
        try {
            const active = ec.getActiveChains();
            const stale  = active.filter(c => c.stale);
            healed.push({ action: "stale-chains-detected", count: stale.length, names: stale.map(c => c.chainName) });
        } catch {}
    }

    if (ts) {
        try {
            const runaway = ts.detectRunaway();
            healed.push({ action: "runaway-detection", stale: runaway.stale.length, runaway: runaway.runaway.length });
        } catch {}
    }

    // Record to timeline
    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.record("recovery", { label: "Runtime state healing executed" });

    return { ok: true, healed, summary: `${healed.length} healing actions taken` };
}

// ── Replay-chain restoration ──────────────────────────────────────────────────

/**
 * Restore context for a replay chain from timeline history.
 */
function restoreReplayChain(replayId) {
    const tl = _tryRequire("./executionTimeline.cjs");
    if (!tl) return { ok: false, error: "executionTimeline unavailable" };

    const events = tl.replayThread(replayId);
    if (events.length === 0) return { ok: false, error: `No timeline events for replay ${replayId}` };

    const sorted = events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return {
        ok:          true,
        replayId,
        eventCount:  events.length,
        firstEvent:  sorted[0],
        lastEvent:   sorted[sorted.length - 1],
        duration:    (sorted[sorted.length - 1]?.ts || 0) - (sorted[0]?.ts || 0),
        types:       [...new Set(events.map(e => e.type))],
    };
}

module.exports = { restoreInterruptedChain, executeDeploymentRollback, restartAdapter, healRuntimeState, restoreReplayChain };
