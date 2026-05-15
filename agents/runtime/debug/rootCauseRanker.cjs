"use strict";
/**
 * rootCauseRanker — rank probable root causes from error observations.
 *
 * rank(errors[], context?)   → [{ cause, type, confidence, evidence }] highest-first
 * topCause(errors[])         → single best guess or null
 *
 * Scoring: frequency weight + type severity + recency boost.
 * "missing" module errors rank highest — they're almost always root cause.
 */

const TYPE_SEVERITY = {
    module_not_found: 95,
    oom:              90,
    uncaught_except:  88,
    unhandled_reject: 85,
    enoent:           80,
    syntax_error:     78,
    econnrefused:     72,
    type_error:       68,
    reference_error:  65,
    assertion:        60,
    timeout:          50,
    range_error:      45,
    generic_error:    30,
};

function rank(errors, context = {}) {
    if (!Array.isArray(errors) || errors.length === 0) return [];

    const total = errors.reduce((s, e) => s + (e.count || 1), 0);
    if (total === 0) return [];

    const scored = errors.map(e => {
        const freq     = (e.count || 1) / total;                    // 0–1
        const severity = (TYPE_SEVERITY[e.type] || 30) / 100;      // 0–1
        const recency  = _recencyWeight(e.lastSeen);                // 0–1

        const raw = freq * 0.35 + severity * 0.45 + recency * 0.20;
        return {
            cause:      e.message,
            type:       e.type || "generic_error",
            confidence: parseFloat(Math.min(raw, 1).toFixed(3)),
            evidence:   {
                count:     e.count || 1,
                frequency: parseFloat(freq.toFixed(3)),
                severity:  Math.round(severity * 100),
                lastSeen:  e.lastSeen || null,
            },
        };
    });

    return scored.sort((a, b) => b.confidence - a.confidence);
}

function topCause(errors) {
    const ranked = rank(errors);
    return ranked.length > 0 ? ranked[0] : null;
}

function _recencyWeight(ts) {
    if (!ts) return 0.5;
    const ageMs = Date.now() - new Date(ts).getTime();
    if (ageMs < 0) return 1.0;
    // Decay to 0.1 over 1 hour
    return Math.max(0.1, 1.0 - ageMs / 3_600_000);
}

module.exports = { rank, topCause, TYPE_SEVERITY };
