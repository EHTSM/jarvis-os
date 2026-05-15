"use strict";
/**
 * systemicPressureAnalyzer — domain-scoped pressure readings, systemic pressure
 * aggregation, cascade propagation modeling, and pressure timeline analysis.
 *
 * recordPressureReading(spec)      → { recorded, readingId }
 * analyzeSystemicPressure()        → { analyzed, overallPressure, overallScore, domains }
 * detectPressureCascade(spec)      → { detected, cascadeId, affectedDomains }
 * getPressureTimeline()            → { readings, trend, totalReadings }
 * reset()
 */

const PRESSURE_LEVELS = { critical: 0.8, high: 0.5, medium: 0.2, low: 0 };

let _readings = [];
let _cascades = [];
let _counter  = 0;

// ── _scoreToLevel ─────────────────────────────────────────────────────

function _scoreToLevel(score) {
    return score >= PRESSURE_LEVELS.critical ? "critical"
         : score >= PRESSURE_LEVELS.high     ? "high"
         : score >= PRESSURE_LEVELS.medium   ? "medium"
         :                                     "low";
}

// ── recordPressureReading ─────────────────────────────────────────────

function recordPressureReading(spec = {}) {
    const { isolationDomain = "default", pressureLevel = null, score = null } = spec;

    if (score == null && pressureLevel == null)
        return { recorded: false, reason: "score_or_pressureLevel_required" };

    const effectiveScore = score != null ? score
        : pressureLevel === "critical" ? 0.9
        : pressureLevel === "high"     ? 0.65
        : pressureLevel === "medium"   ? 0.35
        :                               0.1;

    const effectiveLevel = pressureLevel ?? _scoreToLevel(effectiveScore);

    const readingId = `reading-${++_counter}`;
    _readings.push({
        readingId,
        isolationDomain,
        pressureLevel: effectiveLevel,
        score:         +effectiveScore.toFixed(3),
        recordedAt:    new Date().toISOString(),
    });
    return { recorded: true, readingId, isolationDomain, pressureLevel: effectiveLevel, score: effectiveScore };
}

// ── analyzeSystemicPressure ───────────────────────────────────────────

function analyzeSystemicPressure() {
    if (_readings.length === 0)
        return { analyzed: true, overallPressure: "low", overallScore: 0, domainCount: 0, domains: {} };

    const byDomain = {};
    for (const r of _readings) {
        if (!byDomain[r.isolationDomain]) byDomain[r.isolationDomain] = [];
        byDomain[r.isolationDomain].push(r.score);
    }

    const domains      = {};
    let   overallScore = 0;

    for (const [domain, scores] of Object.entries(byDomain)) {
        const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
        domains[domain] = { avgScore: +avg.toFixed(3), pressure: _scoreToLevel(avg), readingCount: scores.length };
        overallScore    = Math.max(overallScore, avg);
    }

    return {
        analyzed:       true,
        overallPressure: _scoreToLevel(overallScore),
        overallScore:   +overallScore.toFixed(3),
        domainCount:    Object.keys(domains).length,
        domains,
    };
}

// ── detectPressureCascade ─────────────────────────────────────────────

function detectPressureCascade(spec = {}) {
    const { sourceDomain = null, propagationFactor = 0.7, connectedDomains = [] } = spec;
    if (!sourceDomain) return { detected: false, reason: "sourceDomain_required" };

    // Get latest source score
    const sourceReadings = _readings.filter(r => r.isolationDomain === sourceDomain);
    const sourceScore    = sourceReadings.length > 0
        ? sourceReadings[sourceReadings.length - 1].score : 0;

    const cascadeScore   = +(sourceScore * propagationFactor).toFixed(3);
    const affectedDomains = [];

    for (const domain of connectedDomains) {
        if (domain === sourceDomain) continue;
        const cascadeLevel = _scoreToLevel(cascadeScore);
        if (cascadeScore >= PRESSURE_LEVELS.medium) {
            affectedDomains.push({ domain, cascadeScore, cascadeLevel });
        }
    }

    const cascadeId = `cascade-${++_counter}`;
    _cascades.push({ cascadeId, sourceDomain, sourceScore, cascadeScore, affectedCount: affectedDomains.length, detectedAt: new Date().toISOString() });

    return {
        detected:        true,
        cascadeId,
        sourceDomain,
        sourceScore,
        cascadeScore,
        affectedDomains,
        affectedCount:   affectedDomains.length,
    };
}

// ── getPressureTimeline ───────────────────────────────────────────────

function getPressureTimeline() {
    const readings = [..._readings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));

    let trend = "stable";
    if (readings.length >= 4) {
        const half     = Math.floor(readings.length / 2);
        const early    = readings.slice(0, half).reduce((s, r) => s + r.score, 0) / half;
        const recent   = readings.slice(-half).reduce((s, r) => s + r.score, 0) / half;
        trend = recent > early + 0.1 ? "rising"
              : recent < early - 0.1 ? "falling"
              :                        "stable";
    }

    return { readings, trend, totalReadings: readings.length, cascadeCount: _cascades.length };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _readings = [];
    _cascades = [];
    _counter  = 0;
}

module.exports = {
    PRESSURE_LEVELS,
    recordPressureReading, analyzeSystemicPressure,
    detectPressureCascade, getPressureTimeline, reset,
};
