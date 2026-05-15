"use strict";
/**
 * stackTraceCluster — group similar stack traces by normalized signature.
 *
 * signature(trace)     → stable string key for this trace
 * add(trace)           → cluster id
 * getClusters()        → [{ id, signature, count, representative, mostRecent }]
 * getCluster(id)       → single cluster or null
 * topClusters(n)       → top N by count
 * reset()
 */

let _clusters = new Map();   // signature → { id, signature, count, representative, mostRecent }
let _seq      = 0;

// Extract the top N frames from a stack trace string, strip line numbers and addresses
function signature(trace) {
    if (typeof trace !== "string") return "non_string_trace";

    return trace
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.startsWith("at "))
        .slice(0, 5)                              // use top 5 frames for signature
        .map(l =>
            l
                .replace(/\(.*:\d+:\d+\)/g, "(…)")   // strip file:line:col
                .replace(/:[0-9]+:[0-9]+/g,  ":N:N")  // bare line:col
                .replace(/<anonymous>/g,     "<anon>")
                .replace(/node:internal\/[^ ]+/, "node:internal/…")
                .trim()
        )
        .join(" | ");
}

function add(trace) {
    const sig = signature(trace);

    if (_clusters.has(sig)) {
        const c = _clusters.get(sig);
        c.count++;
        c.mostRecent = new Date().toISOString();
        return c.id;
    }

    const id = ++_seq;
    _clusters.set(sig, {
        id,
        signature:       sig,
        count:           1,
        representative:  trace,
        firstSeen:       new Date().toISOString(),
        mostRecent:      new Date().toISOString(),
    });
    return id;
}

function getClusters() {
    return [..._clusters.values()].sort((a, b) => b.count - a.count);
}

function getCluster(id) {
    for (const c of _clusters.values()) {
        if (c.id === id) return { ...c };
    }
    return null;
}

function topClusters(n = 5) {
    return getClusters().slice(0, n);
}

function reset() { _clusters = new Map(); _seq = 0; }

module.exports = { signature, add, getClusters, getCluster, topClusters, reset };
