"use strict";
/**
 * trustDecay — reduce trust after repeated failures.
 *
 * addFailure(entityId, type?)     → { entityId, failures, factor }
 * getDecayFactor(entityId)        → number  1.0 (no decay) → 0.1 (max decay)
 * applyDecay(score, entityId)     → number  score adjusted by decay factor
 * resetDecay(entityId?)           → clears one or all entities
 * getRecord(entityId)             → { failures, factor, lastFailure } | null
 *
 * Decay formula: factor = Math.max(0.1, 1 − failures × 0.15)
 */

const _records = new Map();  // entityId → { failures, lastFailure, type? }

function addFailure(entityId, type = null) {
    const rec = _records.get(entityId) ?? { failures: 0, lastFailure: null, type };
    rec.failures   += 1;
    rec.lastFailure = new Date().toISOString();
    _records.set(entityId, rec);
    return { entityId, failures: rec.failures, factor: getDecayFactor(entityId) };
}

function getDecayFactor(entityId) {
    const rec = _records.get(entityId);
    if (!rec || rec.failures === 0) return 1.0;
    return Math.max(0.1, 1 - rec.failures * 0.15);
}

function applyDecay(score, entityId) {
    return Math.round(score * getDecayFactor(entityId));
}

function resetDecay(entityId = null) {
    if (entityId === null) { _records.clear(); return; }
    _records.delete(entityId);
}

function getRecord(entityId) {
    const rec = _records.get(entityId);
    if (!rec) return null;
    return { ...rec, factor: getDecayFactor(entityId) };
}

module.exports = { addFailure, getDecayFactor, applyDecay, resetDecay, getRecord };
