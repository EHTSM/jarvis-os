"use strict";
/**
 * Phase 683 — Engineering Memory Strategy
 *
 * Repeated-success prioritization, failed-strategy suppression,
 * deployment-pattern analysis, environment-specific strategy recall,
 * replay-safe memory evolution.
 * Bounded storage. Duplicate suppression. Stale-memory cleanup.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH         = path.join(__dirname, "../../data/eng-memory-strategy.json");
const MAX_ENTRIES        = 300;
const TTL_MS             = 21 * 24 * 60 * 60 * 1000;
const STALE_TTL          = 7  * 24 * 60 * 60 * 1000;
const SUPPRESS_THRESHOLD = 3;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { strategies: [], suppressions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.strategies  = (db.strategies  || []).filter(s => s.ts > cutoff).slice(0, MAX_ENTRIES);
    db.suppressions = (db.suppressions || []).filter(s => s.ts > cutoff).slice(0, 100);
}

// ── Strategy recording ────────────────────────────────────────────────────────

function recordStrategyOutcome(strategyId, opts = {}) {
    if (!strategyId) return { ok: false, error: "strategyId required" };
    const { goal = "", env = "default", succeeded = null, deploymentId = null, errorText = "" } = opts;

    const db  = _load(); _prune(db);
    const idx = db.strategies.findIndex(s => s.strategyId === strategyId);

    const existing = idx >= 0 ? db.strategies[idx] : { successCount: 0, failCount: 0, createdAt: Date.now() };
    const record = {
        strategyId,
        goal:        goal.slice(0, 200),
        env,
        deploymentId,
        errorText:   errorText.slice(0, 100),
        successCount: succeeded === true  ? existing.successCount + 1 : existing.successCount,
        failCount:    succeeded === false ? existing.failCount    + 1 : existing.failCount,
        lastOutcome: succeeded,
        createdAt:   existing.createdAt,
        ts:          Date.now(),
    };

    if (idx >= 0) { db.strategies[idx] = record; }
    else          { db.strategies.unshift(record); }

    // Auto-suppress after threshold failures
    if (record.failCount >= SUPPRESS_THRESHOLD) {
        const sidx = db.suppressions.findIndex(s => s.strategyId === strategyId);
        if (sidx === -1) db.suppressions.unshift({ strategyId, reason: "repeated-failure", failCount: record.failCount, ts: Date.now() });
    }

    _save(db);

    const suppressed = record.failCount >= SUPPRESS_THRESHOLD;
    return { ok: true, strategyId, successCount: record.successCount, failCount: record.failCount, suppressed };
}

// ── Repeated-success prioritization ──────────────────────────────────────────

function prioritizeSuccessfulStrategies(goal = "", { env = null, limit = 5 } = {}) {
    const db  = _load(); _prune(db);
    const q   = goal.toLowerCase().slice(0, 100);
    const suppressedIds = new Set(db.suppressions.map(s => s.strategyId));

    const matches = db.strategies
        .filter(s => {
            const goalMatch = s.goal.toLowerCase().includes(q) || q === "";
            const envMatch  = !env || s.env === env;
            const notSuppressed = !suppressedIds.has(s.strategyId);
            const hasSuccess = s.successCount > 0;
            return goalMatch && envMatch && notSuppressed && hasSuccess;
        })
        .sort((a, b) => (b.successCount - a.successCount) || (b.ts - a.ts))
        .slice(0, limit);

    return {
        ok:      true,
        goal,
        matches,
        count:   matches.length,
        primary: matches[0] || null,
        explainer: matches[0] ? `Best: '${matches[0].strategyId}' (${matches[0].successCount} successes, env=${matches[0].env})` : "No successful strategies found",
    };
}

// ── Failed-strategy suppression check ────────────────────────────────────────

function isSuppressed(strategyId) {
    const db = _load();
    return db.suppressions.some(s => s.strategyId === strategyId);
}

function listSuppressed({ limit = 20 } = {}) {
    const db = _load(); _prune(db);
    return db.suppressions.slice(0, limit).map(s => ({ strategyId: s.strategyId, reason: s.reason, failCount: s.failCount, ageMs: Date.now() - s.ts }));
}

// ── Deployment-pattern analysis ───────────────────────────────────────────────

function analyzeDeploymentPatterns(deploymentId = "") {
    const db = _load(); _prune(db);

    const related  = db.strategies.filter(s => s.deploymentId === deploymentId);
    const successes = related.filter(s => s.successCount > 0);
    const failures  = related.filter(s => s.failCount >= SUPPRESS_THRESHOLD);

    // Also check operational memory
    const omi = _tryRequire("./operationalMemoryIntelligence.cjs");
    let memPattern = null;
    if (omi && deploymentId) { try { memPattern = omi.recallDeploymentPattern(deploymentId); } catch {} }

    const successRate = related.length > 0 ? Math.round(successes.length / related.length * 100) : null;

    return {
        ok:            true,
        deploymentId,
        totalStrategies: related.length,
        successCount:  successes.length,
        failureCount:  failures.length,
        successRate,
        memoryPattern: memPattern,
        safeToRepeat:  successRate !== null && successRate >= 80,
        recommendation: successRate !== null
            ? (successRate >= 80 ? "Deployment pattern reliable — safe to repeat" : `Caution: only ${successRate}% success rate`)
            : "No deployment pattern data available",
    };
}

// ── Environment-specific strategy recall ──────────────────────────────────────

function recallStrategyForEnvironment(goal = "", env = "default") {
    const db  = _load(); _prune(db);
    const q   = goal.toLowerCase().slice(0, 100);
    const suppressedIds = new Set(db.suppressions.map(s => s.strategyId));

    const envStrategies = db.strategies.filter(s =>
        s.env === env &&
        (s.goal.toLowerCase().includes(q) || q === "") &&
        !suppressedIds.has(s.strategyId)
    ).sort((a, b) => b.successCount - a.successCount);

    return {
        ok:         true,
        env,
        goal,
        strategies: envStrategies.slice(0, 5),
        primary:    envStrategies[0] || null,
        suppressed: [...suppressedIds].length,
        warning:    [...suppressedIds].length > 0 ? `${[...suppressedIds].length} strategies suppressed in env '${env}'` : null,
    };
}

// ── Replay-safe memory evolution ──────────────────────────────────────────────

function evolveMemoryFromReplay(replayId, opts = {}) {
    if (!replayId) return { ok: false, error: "replayId required" };

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    let isDup  = false;
    if (lhec) { try { isDup = lhec.isDuplicateRecovery(`mem-strat-evolve:${replayId}`); } catch {} }
    if (isDup) return { ok: false, duplicate: true, error: "Duplicate replay memory evolution blocked" };

    const { strategyId = null, succeeded = null, goal = "", env = "default" } = opts;
    if (strategyId && succeeded !== null) {
        recordStrategyOutcome(strategyId, { goal, env, succeeded });
    }

    return { ok: true, replayId, evolved: strategyId != null };
}

// ── Stale memory cleanup ──────────────────────────────────────────────────────

function cleanupStaleMemory({ dryRun = true } = {}) {
    const db     = _load();
    const cutoff = Date.now() - STALE_TTL;
    const stale  = db.strategies.filter(s => s.ts < cutoff);

    if (!dryRun) {
        const ids = new Set(stale.map(s => s.strategyId));
        db.strategies   = db.strategies.filter(s => !ids.has(s.strategyId));
        db.suppressions = db.suppressions.filter(s => !ids.has(s.strategyId));
        _save(db);
    }

    return { ok: true, staleCount: stale.length, pruned: !dryRun };
}

// ── Memory stats ──────────────────────────────────────────────────────────────

function memoryStrategyStats() {
    const db      = _load(); _prune(db);
    const cutoff  = Date.now() - STALE_TTL;
    const stale   = db.strategies.filter(s => s.ts < cutoff);

    return {
        ok:               true,
        totalStrategies:  db.strategies.length,
        suppressedCount:  db.suppressions.length,
        staleCount:       stale.length,
        successfulCount:  db.strategies.filter(s => s.successCount > 0).length,
        summary:          `Memory: ${db.strategies.length} strategies, ${db.suppressions.length} suppressed, ${stale.length} stale`,
    };
}

module.exports = { recordStrategyOutcome, prioritizeSuccessfulStrategies, isSuppressed, listSuppressed, analyzeDeploymentPatterns, recallStrategyForEnvironment, evolveMemoryFromReplay, cleanupStaleMemory, memoryStrategyStats };
