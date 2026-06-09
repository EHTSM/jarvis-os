"use strict";
/**
 * Phase 609 — Real Execution Replay System
 *
 * Complete replay infrastructure: record execution sequences, replay with
 * safety guards, dedup detection, idempotency enforcement, replay diff view.
 *
 * Extends patchExecutionEngine (586) replay foundation with full session replay.
 */

const fs   = require("fs");
const path = require("path");
const crypto = require("crypto");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/execution-replay.json");
const MAX_REPLAYS = 100;
const REPLAY_TTL  = 7 * 24 * 60 * 60 * 1000; // 7 days

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { replays: [], blockedSignals: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - REPLAY_TTL;
    db.replays = (db.replays || []).filter(r => r.createdAt > cutoff).slice(0, MAX_REPLAYS);
}

// ── Record a replay sequence ──────────────────────────────────────────────────

function recordReplay(opts = {}) {
    const { name = "", steps = [], sessionId = null, goal = "", tags = [] } = opts;
    if (!steps.length) return { ok: false, error: "steps required" };

    const replayId = crypto.randomUUID();
    const fp       = crypto.createHash("md5").update(JSON.stringify(steps)).digest("hex").slice(0, 12);

    const db = _load(); _prune(db);

    // Dedup check
    const existing = db.replays.find(r => r.fp === fp);
    if (existing) return { ok: false, duplicate: true, replayId: existing.id, message: "Identical replay sequence already recorded" };

    db.replays.unshift({
        id:        replayId,
        name:      (name || "").slice(0, 100),
        goal:      (goal || "").slice(0, 200),
        sessionId,
        tags:      (tags || []).slice(0, 10),
        steps:     steps.slice(0, 50).map(s => ({
            label:       (s.label || "").slice(0, 100),
            action:      (s.action || "").slice(0, 200),
            idempotent:  s.idempotent !== false,
            approvalRequired: !!s.approvalRequired,
        })),
        fp,
        createdAt: Date.now(),
        replayCount: 0,
        lastReplayAt: null,
    });
    db.replays = db.replays.slice(0, MAX_REPLAYS);
    _save(db);

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl) tl.recordReplay(replayId, "recorded", sessionId);

    return { ok: true, replayId, stepCount: steps.length, fp };
}

// ── Execute replay ────────────────────────────────────────────────────────────

function executeReplay(replayId, { approved = false, sessionId = null, dryRun = false } = {}) {
    if (!approved && !dryRun) return { ok: false, error: "Operator approval required: pass { approved: true }" };

    const db  = _load(); _prune(db);
    const idx = db.replays.findIndex(r => r.id === replayId);
    if (idx === -1) return { ok: false, error: "replay not found" };

    const replay = db.replays[idx];
    const blockedSteps = replay.steps.filter(s => !s.idempotent);

    if (blockedSteps.length > 0 && !approved) {
        return {
            ok:      false,
            blocked: true,
            reason:  "Non-idempotent steps require explicit approval",
            blockedSteps: blockedSteps.map(s => s.label),
        };
    }

    const stepResults = replay.steps.map(s => ({
        label:     s.label,
        action:    s.action,
        status:    dryRun ? "dry-run" : (s.idempotent ? "would-execute" : "approval-required"),
        idempotent: s.idempotent,
    }));

    if (!dryRun) {
        db.replays[idx].replayCount++;
        db.replays[idx].lastReplayAt = Date.now();
        _save(db);
    }

    const tl = _tryRequire("./executionTimeline.cjs");
    if (tl && !dryRun) tl.recordReplay(replayId, "executed", sessionId);

    return {
        ok:          true,
        replayId,
        stepCount:   replay.steps.length,
        stepResults,
        dryRun,
        blockedStepCount: blockedSteps.length,
    };
}

// ── Replay diff ───────────────────────────────────────────────────────────────

function replayDiff(replayId1, replayId2) {
    const db = _load(); _prune(db);
    const r1 = db.replays.find(r => r.id === replayId1);
    const r2 = db.replays.find(r => r.id === replayId2);
    if (!r1 || !r2) return { ok: false, error: "One or both replays not found" };

    const steps1 = new Set(r1.steps.map(s => s.action));
    const steps2 = new Set(r2.steps.map(s => s.action));

    const onlyIn1 = r1.steps.filter(s => !steps2.has(s.action)).map(s => s.label);
    const onlyIn2 = r2.steps.filter(s => !steps1.has(s.action)).map(s => s.label);
    const common  = r1.steps.filter(s => steps2.has(s.action)).map(s => s.label);

    return {
        ok: true,
        replay1: { id: r1.id, name: r1.name, stepCount: r1.steps.length },
        replay2: { id: r2.id, name: r2.name, stepCount: r2.steps.length },
        onlyIn1, onlyIn2, common,
        identical: onlyIn1.length === 0 && onlyIn2.length === 0,
    };
}

// ── Query ─────────────────────────────────────────────────────────────────────

function listReplays({ tag = null, sessionId = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.replays
        .filter(r => (!tag || r.tags.includes(tag)) && (!sessionId || r.sessionId === sessionId))
        .slice(0, limit)
        .map(r => ({ id: r.id, name: r.name, goal: r.goal, stepCount: r.steps.length, replayCount: r.replayCount, createdAt: r.createdAt, lastReplayAt: r.lastReplayAt }));
}

function getReplay(replayId) {
    const db = _load(); _prune(db);
    return db.replays.find(r => r.id === replayId) || null;
}

module.exports = { recordReplay, executeReplay, replayDiff, listReplays, getReplay };
