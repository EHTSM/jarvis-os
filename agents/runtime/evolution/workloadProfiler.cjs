"use strict";
/**
 * workloadProfiler — classifies workloads into behavioral profiles.
 *
 * Profiles: stable | bursty | dangerous | latency-sensitive |
 *           resource-heavy | retry-prone | dependency-fragile
 *
 * classify(entries, depStability, metrics)  → ProfileReport
 * getProfileBehavior(profile)               → BehaviorOverrides
 * profileAffectsOrchestration(profiles, policy) → PolicyAdjustments
 */

const PROFILES = [
    "stable",
    "bursty",
    "dangerous",
    "latency-sensitive",
    "resource-heavy",
    "retry-prone",
    "dependency-fragile",
];

// ── classify ─────────────────────────────────────────────────────────

function classify(entries = [], depStability = {}, metrics = {}) {
    if (entries.length === 0) {
        return { primary: "stable", secondary: [], confidence: 0.5, profiles: ["stable"] };
    }

    const successRate  = entries.filter(e => e.success).length   / entries.length;
    const rollbackRate = entries.filter(e => e.rollbackTriggered).length / entries.length;
    const avgRetries   = entries.reduce((s, e) => s + (e.retryCount ?? 0), 0) / entries.length;
    const avgDuration  = entries.reduce((s, e) => s + (e.durationMs ?? 0), 0) / entries.length;
    const heapMB       = metrics.avgHeapUsedMB ?? 0;
    const avgStab      = _avgStability(depStability);

    const hasDangerous = entries.some(e =>
        e.classification === "dangerous" || e.classification === "destructive"
    );

    const scores = {
        "stable":             _stableScore(successRate, avgRetries, rollbackRate),
        "bursty":             _burstyScore(entries),
        "dangerous":          hasDangerous ? 0.9 : 0.1,
        "latency-sensitive":  avgDuration > 0 && avgDuration < 200 ? 0.8 : 0.2,
        "resource-heavy":     heapMB > 150 ? 0.85 : heapMB > 80 ? 0.6 : 0.1,
        "retry-prone":        avgRetries > 2 ? 0.9 : avgRetries > 1 ? 0.6 : 0.1,
        "dependency-fragile": avgStab < 0.6 ? 0.9 : avgStab < 0.8 ? 0.5 : 0.1,
    };

    const sorted     = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const primary    = sorted[0][0];
    const secondary  = sorted.slice(1).filter(([, s]) => s >= 0.6).map(([p]) => p);
    const allProfiles = [primary, ...secondary];
    const confidence  = sorted[0][1];

    return { primary, secondary, confidence: +confidence.toFixed(2), profiles: allProfiles, scores };
}

// ── getProfileBehavior ────────────────────────────────────────────────

function getProfileBehavior(profile) {
    const BEHAVIORS = {
        "stable": {
            preferredStrategy:    "fast",
            retryLimitDelta:      +1,
            sandboxRequired:      false,
            throttleSensitivity:  0.5,
        },
        "bursty": {
            preferredStrategy:    "safe",
            retryLimitDelta:      0,
            sandboxRequired:      false,
            throttleSensitivity:  0.8,
        },
        "dangerous": {
            preferredStrategy:    "sandbox",
            retryLimitDelta:      -1,
            sandboxRequired:      true,
            throttleSensitivity:  0.9,
        },
        "latency-sensitive": {
            preferredStrategy:    "fast",
            retryLimitDelta:      -1,
            sandboxRequired:      false,
            throttleSensitivity:  0.4,
        },
        "resource-heavy": {
            preferredStrategy:    "staged",
            retryLimitDelta:      -1,
            sandboxRequired:      false,
            throttleSensitivity:  0.85,
        },
        "retry-prone": {
            preferredStrategy:    "recovery_first",
            retryLimitDelta:      +1,
            sandboxRequired:      false,
            throttleSensitivity:  0.7,
        },
        "dependency-fragile": {
            preferredStrategy:    "safe",
            retryLimitDelta:      +1,
            sandboxRequired:      false,
            throttleSensitivity:  0.75,
        },
    };
    return BEHAVIORS[profile] ?? BEHAVIORS["stable"];
}

// ── profileAffectsOrchestration ───────────────────────────────────────

function profileAffectsOrchestration(profiles = [], currentPolicy = {}) {
    const adjustments = {};
    for (const profile of profiles) {
        const behavior = getProfileBehavior(profile);
        if (behavior.sandboxRequired) adjustments.sandboxRequired = true;
        if (behavior.retryLimitDelta !== 0) {
            adjustments.retryLimitDelta = (adjustments.retryLimitDelta ?? 0) + behavior.retryLimitDelta;
        }
        if (!adjustments.preferredStrategy) {
            adjustments.preferredStrategy = behavior.preferredStrategy;
        }
    }
    return adjustments;
}

// ── helpers ───────────────────────────────────────────────────────────

function _stableScore(successRate, avgRetries, rollbackRate) {
    if (successRate >= 0.85 && avgRetries < 0.5 && rollbackRate < 0.1) return 0.95;
    if (successRate >= 0.7  && avgRetries < 1.0 && rollbackRate < 0.2) return 0.7;
    return Math.max(0.1, successRate * 0.5);
}

function _burstyScore(entries) {
    if (entries.length < 3) return 0.3;
    const intervals = [];
    for (let i = 1; i < entries.length; i++) {
        const dt = new Date(entries[i].ts).getTime() - new Date(entries[i - 1].ts).getTime();
        intervals.push(dt);
    }
    const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    const variance = intervals.reduce((s, v) => s + (v - avg) ** 2, 0) / intervals.length;
    const cv = avg > 0 ? Math.sqrt(variance) / avg : 0;
    return cv > 1.0 ? 0.85 : cv > 0.5 ? 0.6 : 0.2;
}

function _avgStability(depStability) {
    const vals = Object.values(depStability);
    if (vals.length === 0) return 1.0;
    return vals.reduce((s, v) => s + (v.stability ?? 1.0), 0) / vals.length;
}

module.exports = { PROFILES, classify, getProfileBehavior, profileAffectsOrchestration };
