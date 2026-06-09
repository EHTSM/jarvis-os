"use strict";
/**
 * Phase 668 — Execution Memory Coordination
 *
 * Repeated-success prioritization, failed-chain suppression, deployment-pattern
 * correlation, environment-specific recall, replay-safe memory evolution.
 * TTL-bounded. Stale-safe. Operator-controlled.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/execution-memory-coord.json");
const MAX_ENTRIES = 200;
const TTL_MS      = 14 * 24 * 60 * 60 * 1000;
const STALE_MS    = 7  * 24 * 60 * 60 * 1000;
const SUPPRESS_THRESHOLD = 3;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { successes: [], failures: [], patterns: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.successes = (db.successes || []).filter(s => s.ts > cutoff).slice(0, MAX_ENTRIES);
    db.failures  = (db.failures  || []).filter(f => f.ts > cutoff).slice(0, MAX_ENTRIES);
    db.patterns  = (db.patterns  || []).slice(-MAX_ENTRIES);
}

// ── Success recording ─────────────────────────────────────────────────────────

function recordSuccess(chainId, opts = {}) {
    const { goal = "", env = "default", steps = [], durationMs = 0, deploymentId = null } = opts;
    const db = _load(); _prune(db);

    const idx = db.successes.findIndex(s => s.chainId === chainId);
    const record = { chainId, goal: goal.slice(0, 200), env, steps: steps.slice(0, 20), durationMs, deploymentId, hitCount: 1, ts: Date.now() };

    if (idx >= 0) {
        record.hitCount = (db.successes[idx].hitCount || 1) + 1;
        db.successes[idx] = record;
    } else {
        db.successes.unshift(record);
    }
    _save(db);
    return { ok: true, chainId, hitCount: record.hitCount };
}

// ── Failure suppression ───────────────────────────────────────────────────────

function recordFailure(chainId, opts = {}) {
    const { goal = "", env = "default", errorText = "", step = null } = opts;
    const db = _load(); _prune(db);

    const idx = db.failures.findIndex(f => f.chainId === chainId);
    const failCount = idx >= 0 ? (db.failures[idx].failCount || 1) + 1 : 1;
    const record = { chainId, goal: goal.slice(0, 200), env, errorText: errorText.slice(0, 200), step, failCount, ts: Date.now() };

    if (idx >= 0) { db.failures[idx] = record; }
    else          { db.failures.unshift(record); }
    _save(db);

    const suppressed = failCount >= SUPPRESS_THRESHOLD;
    return { ok: true, chainId, failCount, suppressed, warning: suppressed ? `Chain '${chainId}' suppressed after ${failCount} failures` : null };
}

function isSuppressed(chainId, { windowMs = 24 * 60 * 60 * 1000 } = {}) {
    const db     = _load();
    const cutoff = Date.now() - windowMs;
    const record = db.failures.find(f => f.chainId === chainId && f.ts > cutoff);
    return record ? record.failCount >= SUPPRESS_THRESHOLD : false;
}

// ── Repeated-success prioritization ──────────────────────────────────────────

function prioritizeRepeatedSuccesses(goal = "", { env = null, limit = 5 } = {}) {
    const db = _load(); _prune(db);
    const q  = goal.toLowerCase().slice(0, 100);

    const matches = db.successes
        .filter(s => {
            const goalMatch = s.goal.toLowerCase().includes(q) || q === "";
            const envMatch  = !env || s.env === env;
            return goalMatch && envMatch && !isSuppressed(s.chainId);
        })
        .sort((a, b) => (b.hitCount - a.hitCount) || (b.ts - a.ts))
        .slice(0, limit);

    return {
        ok:      true,
        goal,
        matches,
        count:   matches.length,
        primary: matches[0] || null,
        explainer: matches[0] ? `Best match: '${matches[0].chainId}' (${matches[0].hitCount} successes, env=${matches[0].env})` : "No successful chains found",
    };
}

// ── Deployment pattern correlation ────────────────────────────────────────────

function correlateDeploymentPatterns(deploymentId = "") {
    const db = _load();

    const related = db.successes.filter(s => s.deploymentId === deploymentId);
    const failed  = db.failures.filter(f => f.chainId.includes(deploymentId) || (db.successes.find(s => s.chainId === f.chainId)?.deploymentId === deploymentId));

    // Query operational memory
    const omi = _tryRequire("./operationalMemoryIntelligence.cjs");
    let memPattern = null;
    if (omi && deploymentId) { try { memPattern = omi.recallDeploymentPattern(deploymentId); } catch {} }

    return {
        ok:            true,
        deploymentId,
        successCount:  related.length,
        failureCount:  failed.length,
        successRate:   related.length + failed.length > 0
            ? Math.round(related.length / (related.length + failed.length) * 100)
            : null,
        memoryPattern: memPattern,
        safeToRepeat:  failed.length === 0 || (related.length / Math.max(related.length + failed.length, 1)) >= 0.8,
        explainer:     `Deployment '${deploymentId}': ${related.length} success(es), ${failed.length} failure(s)`,
    };
}

// ── Environment-specific recall ───────────────────────────────────────────────

function recallForEnvironment(goal = "", env = "default") {
    const db = _load(); _prune(db);
    const q  = goal.toLowerCase().slice(0, 100);

    const envSuccesses = db.successes.filter(s => s.env === env && (s.goal.toLowerCase().includes(q) || q === ""));
    const envFailures  = db.failures.filter(f => f.env === env  && (f.goal.toLowerCase().includes(q) || q === ""));

    const suppressedIds = new Set(envFailures.filter(f => f.failCount >= SUPPRESS_THRESHOLD).map(f => f.chainId));
    const viable = envSuccesses.filter(s => !suppressedIds.has(s.chainId)).sort((a, b) => b.hitCount - a.hitCount);

    return {
        ok:         true,
        env,
        goal,
        viable,
        suppressed: [...suppressedIds],
        primary:    viable[0] || null,
        warning:    suppressedIds.size > 0 ? `${suppressedIds.size} chain(s) suppressed in env '${env}'` : null,
    };
}

// ── Replay-safe memory evolution ──────────────────────────────────────────────

function evolveMemoryFromReplay(replayId, { chainId = null, succeeded = null, goal = "", env = "default", errorText = "" } = {}) {
    if (!replayId) return { ok: false, error: "replayId required" };

    // Check for replay dedup
    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let isDup = false;
    if (lhec) { try { isDup = lhec.isDuplicateRecovery(`mem-evolve:${replayId}`); } catch {} }
    if (isDup) return { ok: false, duplicate: true, error: "Duplicate replay memory evolution blocked" };

    if (chainId) {
        if (succeeded === true)  recordSuccess(chainId, { goal, env });
        if (succeeded === false) recordFailure(chainId, { goal, env, errorText });
    }

    return { ok: true, replayId, chainId, evolved: chainId != null, goal };
}

// ── Memory coordination summary ───────────────────────────────────────────────

function memoryCoordinationSummary() {
    const db      = _load(); _prune(db);
    const cutoff  = Date.now() - STALE_MS;
    const stale   = db.successes.filter(s => s.ts < cutoff);
    const suppressed = db.failures.filter(f => f.failCount >= SUPPRESS_THRESHOLD);

    return {
        ok:             true,
        successCount:   db.successes.length,
        failureCount:   db.failures.length,
        staleCount:     stale.length,
        suppressedCount: suppressed.length,
        topSuccesses:   db.successes.sort((a, b) => b.hitCount - a.hitCount).slice(0, 3).map(s => ({ chainId: s.chainId, hitCount: s.hitCount, env: s.env })),
        summary:        `Memory: ${db.successes.length} successes, ${suppressed.length} suppressed, ${stale.length} stale`,
    };
}

module.exports = { recordSuccess, recordFailure, isSuppressed, prioritizeRepeatedSuccesses, correlateDeploymentPatterns, recallForEnvironment, evolveMemoryFromReplay, memoryCoordinationSummary };
