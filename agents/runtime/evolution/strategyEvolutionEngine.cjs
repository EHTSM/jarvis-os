"use strict";
/**
 * strategyEvolutionEngine — learns, scores, and evolves execution strategies.
 *
 * recordOutcome(fingerprint, strategy, success, durationMs)
 * scoreStrategy(fingerprint, strategy)   → { score, efficiency, grade, executions }
 * evolveStrategy(fingerprint, candidates) → { evolved, strategy, reason, score }
 * getPreferredStrategy(fingerprint)      → string | null
 * shouldRetireStrategy(fingerprint, strategy, threshold?) → boolean
 * getEvolutionGeneration(fingerprint)    → GenerationEntry | null
 * reset()
 */

let _outcomes    = new Map();   // fingerprint → [{ strategy, success, durationMs, ts }]
let _generations = new Map();   // fingerprint → { strategy, generation, score }

// ── recordOutcome ─────────────────────────────────────────────────────

function recordOutcome(fingerprint, strategy, success, durationMs = 0) {
    if (!_outcomes.has(fingerprint)) _outcomes.set(fingerprint, []);
    _outcomes.get(fingerprint).push({
        strategy, success, durationMs, ts: new Date().toISOString(),
    });
}

// ── scoreStrategy ─────────────────────────────────────────────────────

function scoreStrategy(fingerprint, strategy) {
    const records = (_outcomes.get(fingerprint) ?? []).filter(r => r.strategy === strategy);
    if (records.length === 0) return { score: 50, efficiency: 0.5, grade: "C", executions: 0 };

    const successRate    = records.filter(r => r.success).length / records.length;
    const avgDuration    = records.reduce((s, r) => s + r.durationMs, 0) / records.length;
    const recentSlice    = records.slice(-3);
    const recentSuccess  = recentSlice.filter(r => r.success).length / recentSlice.length;
    const durationPenalty = Math.min(20, avgDuration / 1000);

    const raw = Math.max(0, Math.min(100,
        50 + (successRate * 30) + (recentSuccess * 10) - durationPenalty
    ));
    const score = Math.round(raw);

    return {
        score,
        efficiency: successRate,
        grade:      _grade(score),
        executions: records.length,
        avgDurationMs: Math.round(avgDuration),
    };
}

// ── evolveStrategy ────────────────────────────────────────────────────

function evolveStrategy(fingerprint, candidates = []) {
    if (candidates.length === 0) {
        return { evolved: false, strategy: "safe", reason: "no_candidates" };
    }

    const fpRecords = _outcomes.get(fingerprint) ?? [];
    if (fpRecords.length === 0) {
        return { evolved: false, strategy: candidates[0], reason: "no_history" };
    }

    const scored = candidates
        .map(s => ({ strategy: s, ...scoreStrategy(fingerprint, s) }))
        .sort((a, b) => b.score - a.score);

    const best    = scored[0];
    const current = _generations.get(fingerprint)?.strategy ?? null;

    if (best.strategy !== current) {
        _generations.set(fingerprint, {
            strategy:   best.strategy,
            generation: (_generations.get(fingerprint)?.generation ?? 0) + 1,
            score:      best.score,
            evolvedAt:  new Date().toISOString(),
        });
        return {
            evolved:  true,
            strategy: best.strategy,
            from:     current,
            score:    best.score,
            reason:   "better_strategy_found",
        };
    }
    return { evolved: false, strategy: current, score: best.score, reason: "current_is_best" };
}

// ── getPreferredStrategy ──────────────────────────────────────────────

function getPreferredStrategy(fingerprint) {
    return _generations.get(fingerprint)?.strategy ?? null;
}

// ── shouldRetireStrategy ──────────────────────────────────────────────

function shouldRetireStrategy(fingerprint, strategy, threshold = 0.3) {
    const { efficiency, executions } = scoreStrategy(fingerprint, strategy);
    return executions >= 3 && efficiency < threshold;
}

function getEvolutionGeneration(fingerprint) {
    return _generations.get(fingerprint) ?? null;
}

function getAllGenerations() {
    return [..._generations.entries()].map(([fp, g]) => ({ fingerprint: fp, ...g }));
}

// ── helpers ───────────────────────────────────────────────────────────

function _grade(s) {
    if (s >= 90) return "A";
    if (s >= 75) return "B";
    if (s >= 60) return "C";
    if (s >= 40) return "D";
    return "F";
}

function reset() {
    _outcomes    = new Map();
    _generations = new Map();
}

module.exports = {
    recordOutcome, scoreStrategy, evolveStrategy,
    getPreferredStrategy, shouldRetireStrategy,
    getEvolutionGeneration, getAllGenerations, reset,
};
