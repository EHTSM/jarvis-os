"use strict";
/**
 * strategyEvolutionEngine — strategy performance comparison, ranking, and outcome learning.
 *
 * recordOutcome(strategy, outcome)              → RecordResult
 * rankStrategies()                              → RankedList
 * promoteStrategy(strategy)                     → PromotionResult
 * demoteStrategy(strategy)                      → DemotionResult
 * scoreConfidence(strategy)                     → ConfidenceScore
 * runEvolutionCycle(executions)                 → EvolutionResult
 * getEvolutionState()                           → EvolutionState
 * reset()
 */

const STRATEGY_TIERS = ["sandbox", "recovery_first", "staged", "safe", "fast"];
// Index 0 = lowest tier, 4 = highest tier

let _outcomes  = new Map();   // strategy → OutcomeSummary
let _cycles    = [];
let _promotions = [];
let _demotions  = [];
let _cycleCounter = 0;

// ── _ensureStrategy ───────────────────────────────────────────────────

function _ensureStrategy(strategy) {
    if (!_outcomes.has(strategy)) {
        _outcomes.set(strategy, {
            strategy,
            successCount:  0,
            failureCount:  0,
            totalRetries:  0,
            totalDuration: 0,
            callCount:     0,
            tier:          STRATEGY_TIERS.indexOf(strategy) >= 0 ? STRATEGY_TIERS.indexOf(strategy) : 2,
        });
    }
    return _outcomes.get(strategy);
}

// ── recordOutcome ─────────────────────────────────────────────────────

function recordOutcome(strategy, outcome = {}) {
    const rec = _ensureStrategy(strategy);
    rec.callCount++;
    if (outcome.success !== false) rec.successCount++;
    else                           rec.failureCount++;
    rec.totalRetries  += outcome.retryCount  ?? 0;
    rec.totalDuration += outcome.durationMs  ?? 0;
    return { recorded: true, strategy, callCount: rec.callCount };
}

// ── rankStrategies ────────────────────────────────────────────────────

function rankStrategies() {
    if (_outcomes.size === 0) return { ranked: [], count: 0 };

    const ranked = [..._outcomes.values()].map(s => {
        const successRate = s.callCount > 0 ? s.successCount / s.callCount : 0;
        const avgRetries  = s.callCount > 0 ? s.totalRetries / s.callCount : 0;
        const avgDuration = s.callCount > 0 ? s.totalDuration / s.callCount : 0;
        const score       = +(successRate * 100 - avgRetries * 5 - (avgDuration > 2000 ? 10 : 0)).toFixed(1);
        return { strategy: s.strategy, score, successRate: +successRate.toFixed(3), avgRetries: +avgRetries.toFixed(2), callCount: s.callCount };
    }).sort((a, b) => b.score - a.score);

    return { ranked, count: ranked.length, topStrategy: ranked[0]?.strategy ?? null };
}

// ── promoteStrategy ───────────────────────────────────────────────────

function promoteStrategy(strategy) {
    const rec  = _ensureStrategy(strategy);
    const maxT = STRATEGY_TIERS.length - 1;
    if (rec.tier >= maxT) return { promoted: false, strategy, reason: "already_at_top" };
    rec.tier++;
    const record = { strategy, from: rec.tier - 1, to: rec.tier, ts: new Date().toISOString() };
    _promotions.push(record);
    return { promoted: true, strategy, newTier: rec.tier, newTierName: STRATEGY_TIERS[rec.tier] ?? "custom" };
}

// ── demoteStrategy ────────────────────────────────────────────────────

function demoteStrategy(strategy) {
    const rec = _ensureStrategy(strategy);
    if (rec.tier <= 0) return { demoted: false, strategy, reason: "already_at_floor" };
    rec.tier--;
    const record = { strategy, from: rec.tier + 1, to: rec.tier, ts: new Date().toISOString() };
    _demotions.push(record);
    return { demoted: true, strategy, newTier: rec.tier, newTierName: STRATEGY_TIERS[rec.tier] ?? "custom" };
}

// ── scoreConfidence ───────────────────────────────────────────────────

function scoreConfidence(strategy) {
    const rec = _outcomes.get(strategy);
    if (!rec || rec.callCount === 0) return { score: 0, grade: "F", reason: "no_data" };

    const successRate = rec.successCount / rec.callCount;
    const sampleBonus = Math.min(20, rec.callCount * 2);   // up to 20 points for sample size
    const raw         = successRate * 80 + sampleBonus;
    const score       = +Math.min(100, raw).toFixed(1);
    const grade       = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";

    return { score, grade, strategy, successRate: +successRate.toFixed(3), sampleSize: rec.callCount };
}

// ── runEvolutionCycle ─────────────────────────────────────────────────

function runEvolutionCycle(executions = []) {
    const cycleId = `cycle-${++_cycleCounter}`;
    if (executions.length === 0) {
        const result = { cycleId, evolved: false, reason: "no_executions", promotions: [], demotions: [] };
        _cycles.push(result);
        return result;
    }

    // Learn from executions
    for (const e of executions) {
        if (e.strategy) recordOutcome(e.strategy, e);
    }

    // Auto-promote / demote based on thresholds
    const promotions = [];
    const demotions  = [];

    for (const [strategy, rec] of _outcomes) {
        if (rec.callCount < 3) continue;   // need minimum sample
        const sr = rec.successCount / rec.callCount;
        if (sr >= 0.9 && rec.callCount >= 5) {
            const r = promoteStrategy(strategy);
            if (r.promoted) promotions.push(strategy);
        } else if (sr < 0.4) {
            const r = demoteStrategy(strategy);
            if (r.demoted) demotions.push(strategy);
        }
    }

    const { ranked } = rankStrategies();
    const result = {
        cycleId,
        evolved:     promotions.length > 0 || demotions.length > 0,
        promotions,
        demotions,
        topStrategy: ranked[0]?.strategy ?? null,
        executionsLearned: executions.length,
        ts: new Date().toISOString(),
    };
    _cycles.push(result);
    return result;
}

// ── getEvolutionState ─────────────────────────────────────────────────

function getEvolutionState() {
    return {
        strategyCount: _outcomes.size,
        cycleCount:    _cycles.length,
        promotions:    _promotions.length,
        demotions:     _demotions.length,
        strategies:    [..._outcomes.keys()],
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _outcomes     = new Map();
    _cycles       = [];
    _promotions   = [];
    _demotions    = [];
    _cycleCounter = 0;
}

module.exports = {
    STRATEGY_TIERS,
    recordOutcome, rankStrategies, promoteStrategy, demoteStrategy,
    scoreConfidence, runEvolutionCycle, getEvolutionState, reset,
};
