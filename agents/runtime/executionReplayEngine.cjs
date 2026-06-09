"use strict";
/**
 * Phase 391 — Execution Replay Engine
 *
 * Records successful chains and allows replay of validated workflows.
 * Stores: replay library, step-level execution outcomes, timing data.
 *
 * Replay is NOT automatic — operator must explicitly trigger a replay.
 * Replays are bounded: same step limits and approval gates as original execution.
 * Library is bounded: max 50 saved replays, evict oldest on overflow.
 */

const fs   = require("fs");
const path = require("path");

const REPLAY_DIR  = path.join(__dirname, "../../data/replay-library");
const MAX_REPLAYS = 50;
const MAX_STEPS   = 8;

function _ensureDir() {
    try { if (!fs.existsSync(REPLAY_DIR)) fs.mkdirSync(REPLAY_DIR, { recursive: true }); } catch {}
}

function _replayPath(id) {
    return path.join(REPLAY_DIR, `${id}.json`);
}

function _listIds() {
    try {
        return fs.readdirSync(REPLAY_DIR)
            .filter(f => f.endsWith(".json"))
            .map(f => f.replace(".json", ""));
    } catch { return []; }
}

function _load(id) {
    try { return JSON.parse(fs.readFileSync(_replayPath(id), "utf8")); } catch { return null; }
}

function _save(replay) {
    _ensureDir();
    fs.writeFileSync(_replayPath(replay.id), JSON.stringify(replay, null, 2));
}

function _evictOldest() {
    const ids = _listIds();
    if (ids.length < MAX_REPLAYS) return;
    // Load all, sort by savedAt, delete oldest
    const all = ids.map(id => _load(id)).filter(Boolean).sort((a, b) => a.savedAt - b.savedAt);
    const toDelete = all.slice(0, all.length - MAX_REPLAYS + 1);
    for (const r of toDelete) {
        try { fs.unlinkSync(_replayPath(r.id)); } catch {}
    }
}

/**
 * Record a successful chain execution as a replayable workflow.
 *
 * @param {string}   chainName   — name of the chain template
 * @param {string}   goal        — original goal string
 * @param {Array}    steps       — steps with { cmd, label, approvalLevel, result?, durationMs? }
 * @param {object}   meta        — { triggeredBy?, environment?, tags? }
 * @returns {string} replayId
 */
function record(chainName, goal, steps, meta = {}) {
    _evictOldest();
    const id = `replay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const replay = {
        id,
        chainName,
        goal:    goal.slice(0, 200),
        savedAt: Date.now(),
        steps:   steps.slice(0, MAX_STEPS).map((s, i) => ({
            idx:          i,
            cmd:          s.cmd,
            label:        s.label,
            approvalLevel: s.approvalLevel || "safe",
            result:       s.result ? { ok: s.result.ok, output: (s.result.output || "").slice(0, 500) } : null,
            durationMs:   s.durationMs || null,
        })),
        successRate: steps.length > 0
            ? Math.round(steps.filter(s => s.result?.ok !== false).length / steps.length * 100)
            : null,
        meta: {
            triggeredBy:  meta.triggeredBy || "operator",
            tags:         meta.tags || [],
        },
    };
    _save(replay);
    return id;
}

/**
 * List all saved replays (summary only, no step detail).
 */
function list(limit = 20) {
    return _listIds()
        .map(id => _load(id))
        .filter(Boolean)
        .sort((a, b) => b.savedAt - a.savedAt)
        .slice(0, limit)
        .map(r => ({
            id:          r.id,
            chainName:   r.chainName,
            goal:        r.goal,
            savedAt:     r.savedAt,
            stepCount:   r.steps.length,
            successRate: r.successRate,
            tags:        r.meta?.tags || [],
        }));
}

/**
 * Load a full replay record by ID.
 */
function get(id) {
    return _load(id);
}

/**
 * Build a chain object from a replay record — ready for execution.
 * Strips result/timing data; preserves step order and approval levels.
 */
function toChain(id) {
    const replay = _load(id);
    if (!replay) return null;
    return {
        name:    replay.chainName,
        goal:    replay.goal,
        replayId: id,
        steps:   replay.steps.map(s => ({
            idx:           s.idx,
            cmd:           s.cmd,
            label:         s.label,
            approvalLevel: s.approvalLevel,
            failBehavior:  "stop",   // replays are stricter — stop on any failure
        })),
    };
}

/**
 * Delete a replay by ID.
 */
function remove(id) {
    try { fs.unlinkSync(_replayPath(id)); return true; } catch { return false; }
}

/**
 * Stats about the replay library.
 */
function stats() {
    const ids = _listIds();
    const replays = ids.map(id => _load(id)).filter(Boolean);
    const byChain = {};
    for (const r of replays) {
        byChain[r.chainName] = (byChain[r.chainName] || 0) + 1;
    }
    return {
        total:   ids.length,
        byChain,
        oldest:  replays.length ? Math.min(...replays.map(r => r.savedAt)) : null,
        newest:  replays.length ? Math.max(...replays.map(r => r.savedAt)) : null,
    };
}

module.exports = { record, list, get, toChain, remove, stats };
