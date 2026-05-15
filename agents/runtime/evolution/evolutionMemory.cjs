"use strict";
/**
 * evolutionMemory — persists adaptive evolution intelligence.
 *
 * Stores:
 *   - successful evolution patterns
 *   - failed orchestration mutations
 *   - best concurrency profiles
 *   - safest execution configurations
 *   - historical adaptation outcomes
 */

let _evolutionPatterns  = new Map();  // fingerprint → EvolutionPattern[]
let _failedMutations    = new Map();  // fingerprint → MutationRecord[]
let _concurrencyProfiles = [];
let _safeConfigs        = new Map();  // configKey → ConfigEntry
let _adaptationHistory  = new Map();  // fingerprint → AdaptationOutcome[]

// ── evolution patterns ────────────────────────────────────────────────

function recordEvolutionPattern(fingerprint, pattern) {
    if (!_evolutionPatterns.has(fingerprint)) _evolutionPatterns.set(fingerprint, []);
    _evolutionPatterns.get(fingerprint).push({ ...pattern, recordedAt: new Date().toISOString() });
}

function getSuccessfulPatterns(fingerprint) {
    return (_evolutionPatterns.get(fingerprint) ?? []).filter(p => p.success !== false);
}

function getAllEvolutionPatterns() {
    const result = {};
    for (const [fp, patterns] of _evolutionPatterns) result[fp] = [...patterns];
    return result;
}

// ── failed mutations ──────────────────────────────────────────────────

function recordFailedMutation(fingerprint, mutation) {
    if (!_failedMutations.has(fingerprint)) _failedMutations.set(fingerprint, []);
    _failedMutations.get(fingerprint).push({ ...mutation, recordedAt: new Date().toISOString() });
}

function getFailedMutations(fingerprint) {
    return [...(_failedMutations.get(fingerprint) ?? [])];
}

function wasAttemptedMutation(fingerprint, mutationKey) {
    const mutations = _failedMutations.get(fingerprint) ?? [];
    return mutations.some(m => m.key === mutationKey || m.strategy === mutationKey);
}

// ── concurrency profiles ──────────────────────────────────────────────

function recordConcurrencyProfile(profile) {
    _concurrencyProfiles.push({ ...profile, recordedAt: new Date().toISOString() });
    if (_concurrencyProfiles.length > 50) _concurrencyProfiles.shift();
}

function getBestConcurrencyProfile() {
    const successful = _concurrencyProfiles.filter(p => p.success !== false);
    if (successful.length === 0) return null;
    // Pick the one with best success rate / duration tradeoff
    const byLevel = {};
    for (const p of successful) {
        const lvl = p.concurrencyLevel ?? 4;
        if (!byLevel[lvl]) byLevel[lvl] = { total: 0, durationSum: 0 };
        byLevel[lvl].total++;
        byLevel[lvl].durationSum += p.avgDurationMs ?? 0;
    }
    let best = null, bestScore = Infinity;
    for (const [lvl, stats] of Object.entries(byLevel)) {
        const score = stats.durationSum / stats.total - stats.total * 10;
        if (score < bestScore) { bestScore = score; best = { concurrencyLevel: Number(lvl), ...stats }; }
    }
    return best;
}

function getAllConcurrencyProfiles() { return [..._concurrencyProfiles]; }

// ── safe configurations ───────────────────────────────────────────────

function recordSafeConfig(configKey, config) {
    _safeConfigs.set(configKey, { ...config, savedAt: new Date().toISOString() });
}

function getSafeConfig(configKey)   { return _safeConfigs.get(configKey) ?? null; }
function getAllSafeConfigs()         {
    return [..._safeConfigs.entries()].map(([key, cfg]) => ({ configKey: key, ...cfg }));
}

// ── adaptation history ────────────────────────────────────────────────

function recordAdaptationOutcome(fingerprint, outcome) {
    if (!_adaptationHistory.has(fingerprint)) _adaptationHistory.set(fingerprint, []);
    _adaptationHistory.get(fingerprint).push({ ...outcome, recordedAt: new Date().toISOString() });
}

function getAdaptationHistory(fingerprint)  {
    return [...(_adaptationHistory.get(fingerprint) ?? [])];
}

function getLastAdaptation(fingerprint) {
    const history = _adaptationHistory.get(fingerprint) ?? [];
    return history.at(-1) ?? null;
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _evolutionPatterns  = new Map();
    _failedMutations    = new Map();
    _concurrencyProfiles = [];
    _safeConfigs        = new Map();
    _adaptationHistory  = new Map();
}

module.exports = {
    recordEvolutionPattern, getSuccessfulPatterns, getAllEvolutionPatterns,
    recordFailedMutation, getFailedMutations, wasAttemptedMutation,
    recordConcurrencyProfile, getBestConcurrencyProfile, getAllConcurrencyProfiles,
    recordSafeConfig, getSafeConfig, getAllSafeConfigs,
    recordAdaptationOutcome, getAdaptationHistory, getLastAdaptation,
    reset,
};
