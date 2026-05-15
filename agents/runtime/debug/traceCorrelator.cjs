"use strict";
/**
 * traceCorrelator — advanced stack trace correlation and repair effectiveness scoring.
 *
 * correlate(traces[])
 *   → { groups[], repeatedPatterns[], uniqueCount, duplicateCount }
 *
 * scoreRepairEffectiveness(errorType)
 *   → { strategies[{name, successRate, attempts}], bestStrategy, totalAttempts }
 *
 * rankRootCauses(errors[], traces[])
 *   → [{ cause, type, confidence, frequency, traceCount }] sorted desc
 *
 * suppressDuplicates(errors[], threshold?)
 *   → { unique[], suppressed[], suppressedCount }
 *
 * reset()
 */

const stc = require("./stackTraceCluster.cjs");
const rcr = require("./rootCauseRanker.cjs");
const fm  = require("../failureMemory.cjs");

let _seq = 0;

// ── correlate ─────────────────────────────────────────────────────────

function correlate(traces = []) {
    const groups      = new Map();   // signature → [trace]
    const uniqueCount  = new Set();

    for (const trace of traces) {
        const sig = stc.signature(trace);
        uniqueCount.add(sig);
        if (!groups.has(sig)) groups.set(sig, []);
        groups.get(sig).push(trace);
    }

    const groupList = [...groups.entries()].map(([sig, items]) => ({
        signature:  sig,
        count:      items.length,
        sample:     items[0],
    })).sort((a, b) => b.count - a.count);

    const repeatedPatterns = groupList.filter(g => g.count > 1);

    return {
        groups:          groupList,
        repeatedPatterns,
        uniqueCount:     uniqueCount.size,
        duplicateCount:  traces.length - uniqueCount.size,
    };
}

// ── scoreRepairEffectiveness ──────────────────────────────────────────

function scoreRepairEffectiveness(errorType) {
    const snap       = fm.snapshot();
    const prefix     = `${errorType}::`;
    const strategies = [];

    for (const [key, stat] of Object.entries(snap)) {
        if (!key.startsWith(prefix)) continue;
        const name        = key.slice(prefix.length);
        const successRate = stat.attempts > 0
            ? parseFloat((stat.successes / stat.attempts).toFixed(3))
            : 0;
        strategies.push({ name, successRate, attempts: stat.attempts, successes: stat.successes });
    }

    strategies.sort((a, b) => b.successRate - a.successRate || b.attempts - a.attempts);

    return {
        errorType,
        strategies,
        bestStrategy:  strategies[0]?.name || null,
        totalAttempts: strategies.reduce((s, x) => s + x.attempts, 0),
    };
}

// ── rankRootCauses ────────────────────────────────────────────────────

function rankRootCauses(errors = [], traces = []) {
    // Base ranking from rootCauseRanker
    const baseRanked = rcr.rank(errors);

    // Trace frequency map: type → count
    const traceCounts = {};
    for (const trace of traces) {
        const lines  = (typeof trace === "string" ? trace : "").split("\n");
        const errLine = lines[0] || "";
        const type   = _guessErrorType(errLine);
        traceCounts[type] = (traceCounts[type] || 0) + 1;
    }

    // Augment with trace frequency
    const augmented = baseRanked.map(item => ({
        ...item,
        traceCount: traceCounts[item.type] || 0,
        frequency:  item.evidence?.frequency || 0,
    }));

    // Re-rank: confidence × 0.70 + normalised traceCount × 0.30
    const maxTrace = Math.max(...augmented.map(a => a.traceCount), 1);
    augmented.sort((a, b) => {
        const sa = a.confidence * 0.70 + (a.traceCount / maxTrace) * 0.30;
        const sb = b.confidence * 0.70 + (b.traceCount / maxTrace) * 0.30;
        return sb - sa;
    });

    return augmented;
}

// ── suppressDuplicates ────────────────────────────────────────────────

function suppressDuplicates(errors = [], threshold = 2) {
    const seen   = new Map();   // normalised key → first occurrence
    const unique = [];
    const suppressed = [];

    for (const err of errors) {
        const key = _normaliseMessage(err.message || "");
        if (!seen.has(key)) {
            seen.set(key, err);
            unique.push(err);
        } else if ((err.count || 1) >= threshold) {
            // High-count duplicates still get included (just once)
            const existing = seen.get(key);
            if (existing._merged) {
                suppressed.push(err);
            } else {
                existing._merged = true;
                suppressed.push(err);
            }
        } else {
            suppressed.push(err);
        }
    }

    return { unique, suppressed, suppressedCount: suppressed.length };
}

// ── helpers ───────────────────────────────────────────────────────────

function _normaliseMessage(msg) {
    return msg
        .replace(/\d+/g, "N")                 // numbers → N
        .replace(/['"]/g, "")                  // strip quotes
        .replace(/\s+/g, " ")                  // normalise whitespace
        .toLowerCase()
        .trim();
}

function _guessErrorType(line) {
    if (/SyntaxError/i.test(line))      return "syntax_error";
    if (/TypeError/i.test(line))        return "type_error";
    if (/Cannot find module/i.test(line)) return "module_not_found";
    if (/RangeError/i.test(line))       return "range_error";
    if (/ReferenceError/i.test(line))   return "reference_error";
    return "generic_error";
}

function reset() { stc.reset(); _seq = 0; }

module.exports = {
    correlate,
    scoreRepairEffectiveness,
    rankRootCauses,
    suppressDuplicates,
    reset,
};
