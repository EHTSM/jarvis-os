"use strict";
/**
 * workflowFingerprint — deterministic workflow identity via DJB2-XOR hash.
 *
 * generate(workflow)  → 8-char hex string
 *   workflow: { steps[], deps?, category? }
 *   steps entries may be strings or { id, deps? } objects
 *
 * match(fp1, fp2)     → boolean
 * describe(workflow)  → human-readable label
 */

function _sortedJSON(obj) {
    if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
    if (Array.isArray(obj)) return "[" + obj.map(_sortedJSON).join(",") + "]";
    return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + _sortedJSON(obj[k])).join(",") + "}";
}

function _djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
        h |= 0;
    }
    return Math.abs(h).toString(16).padStart(8, "0");
}

function generate(workflow = {}) {
    const { steps = [], deps = [], category = "default" } = workflow;

    const normSteps = steps
        .map(s => typeof s === "string" ? { id: s, deps: [] } : { id: s.id ?? "", deps: (s.deps ?? []).sort() })
        .sort((a, b) => (a.id < b.id ? -1 : 1));

    const payload = { steps: normSteps, deps: [...deps].sort(), category };
    return _djb2(_sortedJSON(payload));
}

function match(fp1, fp2) { return fp1 === fp2; }

function describe(workflow = {}) {
    const { steps = [], category = "default" } = workflow;
    return `${category}[${steps.length}steps]:${generate(workflow)}`;
}

module.exports = { generate, match, describe };
