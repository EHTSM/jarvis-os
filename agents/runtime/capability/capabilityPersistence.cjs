"use strict";
/**
 * capabilityPersistence — record capability execution history.
 *
 * record(capabilityId, entry)
 *   entry: { input, output?, policy, durationMs, success, failureReason?, policyDecision? }
 * getHistory(capabilityId)    → entries[]
 * getUsage()                  → { [capabilityId]: count }
 * getFailures()               → all failed entries (with capabilityId stamped)
 * getPolicyDecisions()        → entries where policyDecision is set
 * reset()
 */

const _history = new Map();   // capabilityId → entries[]

function record(capabilityId, entry) {
    if (!_history.has(capabilityId)) _history.set(capabilityId, []);
    _history.get(capabilityId).push({
        ...entry,
        capabilityId,
        ts: new Date().toISOString(),
    });
}

function getHistory(capabilityId) {
    return [...(_history.get(capabilityId) ?? [])];
}

function getUsage() {
    const out = {};
    for (const [id, entries] of _history) out[id] = entries.length;
    return out;
}

function getFailures() {
    const out = [];
    for (const [, entries] of _history) {
        for (const e of entries) { if (!e.success) out.push(e); }
    }
    return out;
}

function getPolicyDecisions() {
    const out = [];
    for (const [, entries] of _history) {
        for (const e of entries) { if (e.policyDecision) out.push(e); }
    }
    return out;
}

function reset() { _history.clear(); }

module.exports = { record, getHistory, getUsage, getFailures, getPolicyDecisions, reset };
