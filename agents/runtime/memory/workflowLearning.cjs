"use strict";
/**
 * workflowLearning — derive patterns from execution history.
 *
 * identifyHighSuccess(entries, threshold?)  → [{fingerprint, successRate, executions}]
 *   threshold default 0.8 — min success rate to qualify
 *
 * identifyUnstable(entries, threshold?)     → [{fingerprint, successRate, executions}]
 *   threshold default 0.5 — max success rate (needs ≥2 executions)
 *
 * recommendStrategy(fingerprint, entries)  → strategy string
 *   returns most-successful strategy for that fingerprint, or "safe" if unknown
 *
 * shouldAvoid(fingerprint, entries, n?)    → { avoid, reason? }
 *   avoid when last n (default 3) executions all failed
 */

function _groupByFP(entries) {
    const g = new Map();
    for (const e of entries) {
        const fp = e.fingerprint ?? "__unknown__";
        if (!g.has(fp)) g.set(fp, []);
        g.get(fp).push(e);
    }
    return g;
}

function identifyHighSuccess(entries, threshold = 0.8) {
    const result = [];
    for (const [fp, execs] of _groupByFP(entries)) {
        const rate = execs.filter(e => e.success).length / execs.length;
        if (rate >= threshold) result.push({ fingerprint: fp, successRate: Math.round(rate * 1000) / 1000, executions: execs.length });
    }
    return result;
}

function identifyUnstable(entries, threshold = 0.5) {
    const result = [];
    for (const [fp, execs] of _groupByFP(entries)) {
        if (execs.length < 2) continue;
        const rate = execs.filter(e => e.success).length / execs.length;
        if (rate < threshold) result.push({ fingerprint: fp, successRate: Math.round(rate * 1000) / 1000, executions: execs.length });
    }
    return result;
}

function recommendStrategy(fingerprint, entries) {
    const hits = entries.filter(e => e.fingerprint === fingerprint && e.success);
    if (hits.length === 0) return "safe";
    const counts = {};
    for (const e of hits) { const s = e.strategy ?? "direct"; counts[s] = (counts[s] ?? 0) + 1; }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function shouldAvoid(fingerprint, entries, consecutiveThreshold = 3) {
    const matching = entries
        .filter(e => e.fingerprint === fingerprint)
        .sort((a, b) => (a.ts < b.ts ? -1 : 1));

    if (matching.length === 0) return { avoid: false };

    let consecutive = 0;
    for (let i = matching.length - 1; i >= 0; i--) {
        if (!matching[i].success) consecutive++;
        else break;
    }

    if (consecutive >= consecutiveThreshold) {
        return { avoid: true, reason: `${consecutive} consecutive failures` };
    }
    return { avoid: false };
}

module.exports = { identifyHighSuccess, identifyUnstable, recommendStrategy, shouldAvoid };
