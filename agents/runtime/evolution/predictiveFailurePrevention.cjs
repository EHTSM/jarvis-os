"use strict";
/**
 * predictiveFailurePrevention — predicts failure conditions before execution.
 *
 * predict(context) → PredictionReport
 * predictRollbackProbability(fingerprint, entries, depStability) → number 0-1
 * predictRetryStorm(entries, window)        → { risk, probability }
 * predictDependencyCollapse(depStability)   → { risk, affectedDeps[] }
 * predictQueueCongestion(depth, rate, drain) → { risk, estimatedWaitMs }
 * predictResourceExhaustion(metrics)        → { risk, warnings[] }
 */

const RISK = { NONE: "none", LOW: "low", MEDIUM: "medium", HIGH: "high", CRITICAL: "critical" };

// ── predictRollbackProbability ────────────────────────────────────────

function predictRollbackProbability(fingerprint, entries = [], depStability = {}) {
    const fpEntries = entries.filter(e => e.fingerprint === fingerprint);

    // Historical rollback rate
    const histRate = fpEntries.length > 0
        ? fpEntries.filter(e => e.rollbackTriggered).length / fpEntries.length
        : 0;

    // Dep instability factor: avg(1 - stability) for all deps
    const vals    = Object.values(depStability);
    const depFactor = vals.length > 0
        ? vals.reduce((s, v) => s + (1 - (v.stability ?? 1.0)), 0) / vals.length
        : 0;

    // Recent failure trend (last 5 entries)
    const recent      = fpEntries.slice(-5);
    const recentFails = recent.filter(e => !e.success).length / Math.max(1, recent.length);

    const probability = Math.min(1, histRate * 0.5 + depFactor * 0.3 + recentFails * 0.2);
    return +probability.toFixed(3);
}

// ── predictRetryStorm ─────────────────────────────────────────────────

function predictRetryStorm(entries = [], window = 10) {
    const recent     = entries.slice(-window);
    if (recent.length === 0) return { risk: RISK.NONE, probability: 0 };

    const avgRetries = recent.reduce((s, e) => s + (e.retryCount ?? 0), 0) / recent.length;
    const trend      = _trend(recent.map(e => e.retryCount ?? 0));

    let probability = Math.min(1, avgRetries / 5);
    if (trend > 0.5) probability = Math.min(1, probability + 0.2);  // rising trend

    const risk = probability > 0.7 ? RISK.HIGH :
                 probability > 0.4 ? RISK.MEDIUM :
                 probability > 0.1 ? RISK.LOW : RISK.NONE;

    return { risk, probability: +probability.toFixed(3), avgRetries, trend: +trend.toFixed(2) };
}

// ── predictDependencyCollapse ─────────────────────────────────────────

function predictDependencyCollapse(depStability = {}) {
    const entries      = Object.entries(depStability);
    if (entries.length === 0) return { risk: RISK.NONE, affectedDeps: [] };

    const criticalDeps = entries.filter(([, v]) => (v.stability ?? 1.0) < 0.3);
    const fragile      = entries.filter(([, v]) => (v.stability ?? 1.0) < 0.6);

    const risk = criticalDeps.length >= 2 ? RISK.CRITICAL :
                 criticalDeps.length >= 1 ? RISK.HIGH :
                 fragile.length >= 2       ? RISK.MEDIUM :
                 fragile.length >= 1       ? RISK.LOW : RISK.NONE;

    return {
        risk,
        affectedDeps: fragile.map(([id, v]) => ({
            depId: id,
            stability: v.stability ?? 0,
            critical:  (v.stability ?? 1.0) < 0.3,
        })),
    };
}

// ── predictQueueCongestion ────────────────────────────────────────────

function predictQueueCongestion(queueDepth = 0, arrivalRate = 1, drainRate = 1) {
    if (drainRate <= 0) {
        return { risk: RISK.CRITICAL, estimatedWaitMs: Infinity, saturation: Infinity };
    }
    const saturation       = arrivalRate / drainRate;
    const estimatedWaitMs  = saturation >= 1
        ? Infinity
        : Math.round((queueDepth / (drainRate - arrivalRate)) * 1000);

    const risk = saturation >= 1.0  ? RISK.CRITICAL :
                 saturation >= 0.85 ? RISK.HIGH :
                 saturation >= 0.7  ? RISK.MEDIUM :
                 queueDepth > 20    ? RISK.LOW : RISK.NONE;

    return {
        risk,
        estimatedWaitMs: isFinite(estimatedWaitMs) ? estimatedWaitMs : null,
        saturation: +saturation.toFixed(3),
        queueDepth,
    };
}

// ── predictResourceExhaustion ─────────────────────────────────────────

function predictResourceExhaustion(metrics = {}) {
    const warnings = [];
    const { avgHeapUsedMB = 0, avgCpuUserMs = 0, totalProcesses = 0 } = metrics;

    if (avgHeapUsedMB > 350)  warnings.push({ type: "heap_exhaustion",    heapMB: avgHeapUsedMB, risk: RISK.HIGH });
    else if (avgHeapUsedMB > 200) warnings.push({ type: "heap_pressure",  heapMB: avgHeapUsedMB, risk: RISK.MEDIUM });

    if (avgCpuUserMs > 400)   warnings.push({ type: "cpu_exhaustion",     cpuMs: avgCpuUserMs,   risk: RISK.HIGH });
    else if (avgCpuUserMs > 250) warnings.push({ type: "cpu_pressure",    cpuMs: avgCpuUserMs,   risk: RISK.MEDIUM });

    if (totalProcesses > 15)  warnings.push({ type: "process_overload",   count: totalProcesses, risk: RISK.HIGH });

    const risk = warnings.some(w => w.risk === RISK.HIGH)     ? RISK.HIGH :
                 warnings.some(w => w.risk === RISK.MEDIUM)   ? RISK.MEDIUM :
                 warnings.length > 0                          ? RISK.LOW : RISK.NONE;

    return { risk, warnings };
}

// ── predict (main entry point) ────────────────────────────────────────

function predict(context = {}) {
    const {
        fingerprint   = null,
        entries       = [],
        depStability  = {},
        metrics       = {},
        queueDepth    = 0,
        arrivalRate   = 0,
        drainRate     = 1,
        retryWindow   = 10,
    } = context;

    const rollbackProb  = predictRollbackProbability(fingerprint ?? "", entries, depStability);
    const retryStorm    = predictRetryStorm(entries, retryWindow);
    const depCollapse   = predictDependencyCollapse(depStability);
    const queueCong     = predictQueueCongestion(queueDepth, arrivalRate, drainRate);
    const resExhaust    = predictResourceExhaustion(metrics);

    const risks = [retryStorm.risk, depCollapse.risk, queueCong.risk, resExhaust.risk];
    const RISK_ORDER = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
    const overallRisk = risks.reduce((max, r) =>
        RISK_ORDER[r] > RISK_ORDER[max] ? r : max, RISK.NONE
    );

    return {
        rollbackProbability: rollbackProb,
        retryStorm,
        dependencyCollapse:  depCollapse,
        queueCongestion:     queueCong,
        resourceExhaustion:  resExhaust,
        overallRisk,
        shouldBlock:         overallRisk === RISK.CRITICAL,
        shouldWarn:          overallRisk === RISK.HIGH || overallRisk === RISK.MEDIUM,
        ts:                  new Date().toISOString(),
    };
}

// ── helpers ───────────────────────────────────────────────────────────

function _trend(values) {
    if (values.length < 2) return 0;
    const n    = values.length;
    const xBar = (n - 1) / 2;
    const yBar = values.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - xBar) * (values[i] - yBar);
        den += (i - xBar) ** 2;
    }
    return den === 0 ? 0 : num / den;
}

module.exports = {
    RISK, predict,
    predictRollbackProbability, predictRetryStorm,
    predictDependencyCollapse, predictQueueCongestion, predictResourceExhaustion,
};
