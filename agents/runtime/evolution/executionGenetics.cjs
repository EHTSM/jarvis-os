"use strict";
/**
 * executionGenetics — persists best execution genome combinations.
 *
 * Genome = { strategy, retryLimit, classification, sandboxed, rollbackReady }
 *
 * recordGenome(fingerprint, genome, success, durationMs)
 * getBestGenome(fingerprint)          → Genome | null
 * mutateGenome(fingerprint, delta)    → MutationResult
 * scoreGenome(genome, outcomes)       → number 0-100
 * getHighSuccessRoutes(threshold?)    → RouteEntry[]
 * getOptimalRecoveryChains()          → ChainEntry[]
 * reset()
 */

let _genomes    = new Map();  // fingerprint → GenomeEntry[]
let _mutations  = new Map();  // fingerprint → MutationLog[]

// ── recordGenome ──────────────────────────────────────────────────────

function recordGenome(fingerprint, genome, success, durationMs = 0) {
    if (!_genomes.has(fingerprint)) _genomes.set(fingerprint, []);
    _genomes.get(fingerprint).push({
        genome:    { ...genome },
        success,
        durationMs,
        ts:        new Date().toISOString(),
    });
}

// ── getBestGenome ─────────────────────────────────────────────────────

function getBestGenome(fingerprint) {
    const records = _genomes.get(fingerprint) ?? [];
    if (records.length === 0) return null;
    const successful = records.filter(r => r.success);
    if (successful.length === 0) return null;
    // Best: lowest avg duration among successful
    const byGenomeKey = {};
    for (const r of successful) {
        const key = JSON.stringify(r.genome);
        if (!byGenomeKey[key]) byGenomeKey[key] = { genome: r.genome, total: 0, durationSum: 0 };
        byGenomeKey[key].total++;
        byGenomeKey[key].durationSum += r.durationMs;
    }
    let best = null, bestScore = Infinity;
    for (const entry of Object.values(byGenomeKey)) {
        const avg = entry.durationSum / entry.total;
        const score = avg - entry.total * 50;  // reward frequency
        if (score < bestScore) { bestScore = score; best = entry.genome; }
    }
    return best;
}

// ── mutateGenome ──────────────────────────────────────────────────────

function mutateGenome(fingerprint, delta = {}) {
    const base = getBestGenome(fingerprint) ?? { strategy: "safe", retryLimit: 3 };
    const mutated = { ...base, ...delta, mutatedAt: new Date().toISOString() };

    if (!_mutations.has(fingerprint)) _mutations.set(fingerprint, []);
    _mutations.get(fingerprint).push({ from: base, to: mutated, ts: new Date().toISOString() });

    return { fingerprint, from: base, to: mutated, mutated: true };
}

// ── scoreGenome ───────────────────────────────────────────────────────

function scoreGenome(genome, outcomes = []) {
    if (outcomes.length === 0) return 50;
    const key = JSON.stringify(genome);
    const matching = outcomes.filter(o => JSON.stringify(o.genome ?? {}) === key);
    if (matching.length === 0) return 50;
    const successRate = matching.filter(o => o.success).length / matching.length;
    const avgDur      = matching.reduce((s, o) => s + (o.durationMs ?? 0), 0) / matching.length;
    return Math.round(Math.max(0, Math.min(100, successRate * 80 + 20 - avgDur / 1000)));
}

// ── getHighSuccessRoutes ──────────────────────────────────────────────

function getHighSuccessRoutes(threshold = 0.8) {
    const routes = [];
    for (const [fp, records] of _genomes) {
        if (records.length < 2) continue;
        const successRate = records.filter(r => r.success).length / records.length;
        if (successRate >= threshold) {
            routes.push({
                fingerprint: fp,
                successRate,
                executions:  records.length,
                bestGenome:  getBestGenome(fp),
            });
        }
    }
    return routes.sort((a, b) => b.successRate - a.successRate);
}

// ── getOptimalRecoveryChains ──────────────────────────────────────────

function getOptimalRecoveryChains() {
    const chains = [];
    for (const [fp, records] of _genomes) {
        const recoveryAttempts = records.filter(r => r.genome?.rollbackReady);
        if (recoveryAttempts.length === 0) continue;
        const recovered = recoveryAttempts.filter(r => r.success).length;
        chains.push({
            fingerprint:    fp,
            recoveryRate:   recovered / recoveryAttempts.length,
            attempts:       recoveryAttempts.length,
            bestRecoveryGenome: recoveryAttempts.filter(r => r.success).at(-1)?.genome ?? null,
        });
    }
    return chains.sort((a, b) => b.recoveryRate - a.recoveryRate);
}

function getMutationLog(fingerprint) {
    return [...(_mutations.get(fingerprint) ?? [])];
}

function reset() {
    _genomes   = new Map();
    _mutations = new Map();
}

module.exports = {
    recordGenome, getBestGenome, mutateGenome, scoreGenome,
    getHighSuccessRoutes, getOptimalRecoveryChains, getMutationLog, reset,
};
