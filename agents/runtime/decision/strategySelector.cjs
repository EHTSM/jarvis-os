"use strict";
/**
 * strategySelector — dynamic execution strategy selection and degraded-mode orchestration.
 *
 * selectStrategy(context)                      → StrategyDecision
 * activateDegradedMode(conditions)             → ModeDecision
 * getCurrentMode()                             → string
 * recordOutcome(strategy, context, success)    → void
 * getSelectorStats()                           → Stats
 * reset()
 */

const STRATEGIES     = ["sandbox", "recovery_first", "staged", "safe", "fast"];
const DEGRADED_MODES = ["normal", "safe", "degraded", "recovery"];

// Thresholds for strategy selection
const THRESHOLDS = {
    confidence:  { critical: 0.30, low: 0.50, moderate: 0.70 },
    pressure:    { critical: 0.85, high: 0.65, medium: 0.40 },
    health:      { critical: 0.30, degraded: 0.55, warning: 0.75 },
    anomaly:     { many: 3, some: 1 },
};

let _currentMode      = "normal";
let _outcomeHistory   = [];   // { strategy, conditionBand, success }
let _selectionHistory = [];
let _counter          = 0;

// ── _classifyBands ────────────────────────────────────────────────────

function _pressureBand(p = 0) {
    return p >= THRESHOLDS.pressure.critical ? "critical"
         : p >= THRESHOLDS.pressure.high     ? "high"
         : p >= THRESHOLDS.pressure.medium   ? "medium"
         :                                     "low";
}

function _healthBand(h = 1) {
    return h <= THRESHOLDS.health.critical  ? "critical"
         : h <= THRESHOLDS.health.degraded  ? "degraded"
         : h <= THRESHOLDS.health.warning   ? "warning"
         :                                    "healthy";
}

function _confidenceBand(c = 1) {
    return c <= THRESHOLDS.confidence.critical  ? "critical"
         : c <= THRESHOLDS.confidence.low       ? "low"
         : c <= THRESHOLDS.confidence.moderate  ? "moderate"
         :                                        "high";
}

// ── _historicalSuccessRate ────────────────────────────────────────────

function _historicalSuccessRate(strategy, condBand) {
    const matching = _outcomeHistory.filter(
        o => o.strategy === strategy && o.conditionBand === condBand
    );
    if (matching.length === 0) return null;
    return matching.filter(o => o.success).length / matching.length;
}

// ── selectStrategy ────────────────────────────────────────────────────

function selectStrategy(context = {}) {
    const pressure      = context.pressure       ?? 0;
    const health        = context.health         ?? 1;
    const confidence    = context.confidence     ?? 1;
    const anomalyCount  = context.anomalyCount   ?? 0;
    const workloadRisk  = context.workloadRisk   ?? "low";
    const latencyClass  = context.latencyClass   ?? "standard";
    const incidentCount = context.incidentCount  ?? 0;

    const pb = _pressureBand(pressure);
    const hb = _healthBand(health);
    const cb = _confidenceBand(confidence);
    const condBand = `${pb}|${hb}`;

    const reasons = [];
    let strategy;

    // Rule hierarchy (first match wins)
    if (cb === "critical") {
        strategy = "sandbox";
        reasons.push("confidence_critical: execution confidence too low for any real strategy");
    } else if (pb === "critical" || hb === "critical") {
        strategy = "recovery_first";
        reasons.push(`${pb === "critical" ? "pressure_critical" : "health_critical"}: runtime at critical state`);
    } else if (_currentMode === "recovery") {
        strategy = "recovery_first";
        reasons.push("degraded_mode_recovery: system is in recovery mode");
    } else if (anomalyCount >= THRESHOLDS.anomaly.many) {
        strategy = "staged";
        reasons.push(`anomaly_count_${anomalyCount}: multiple active anomaly predictions`);
    } else if (pb === "high" || hb === "degraded" || _currentMode === "degraded") {
        strategy = "safe";
        reasons.push(`${pb === "high" ? "pressure_high" : "health_degraded"}: elevated degradation`);
    } else if (pb === "medium" || hb === "warning" || anomalyCount >= THRESHOLDS.anomaly.some) {
        strategy = "staged";
        reasons.push("moderate_pressure_or_anomaly: cautious staged execution");
    } else if (workloadRisk === "critical" || workloadRisk === "high") {
        strategy = "safe";
        reasons.push(`workload_risk_${workloadRisk}: high-risk workload requires safe strategy`);
    } else {
        strategy = "fast";
        reasons.push("nominal_conditions: all signals within normal range");
    }

    // Adjust for latency-sensitive workloads that can't afford staged
    if (strategy === "staged" && latencyClass === "realtime") {
        strategy = "safe";
        reasons.push("latency_realtime: staged too slow for realtime; promoted to safe");
    }

    // Historical evidence
    const histRate = _historicalSuccessRate(strategy, condBand);
    const historicalEvidence = histRate != null
        ? { conditionBand: condBand, successRate: +histRate.toFixed(3), samples: _outcomeHistory.filter(o => o.conditionBand === condBand).length }
        : { conditionBand: condBand, successRate: null, samples: 0 };

    // Demote strategy if historical success rate is low for this band
    if (histRate != null && histRate < 0.4 && strategy !== "sandbox") {
        const idx = STRATEGIES.indexOf(strategy);
        if (idx > 0) {
            const demoted = STRATEGIES[idx - 1];
            reasons.push(`historical_demotion: ${strategy} has ${(histRate * 100).toFixed(0)}% success in ${condBand}; demoted to ${demoted}`);
            strategy = demoted;
        }
    }

    const confidenceLevel = cb === "high"     ? "high"
                          : cb === "moderate" ? "moderate"
                          :                     "low";

    const decision = {
        decisionId:   `strat-${++_counter}`,
        strategy,
        reasoning:    reasons.join("; "),
        telemetryBasis: { pressureBand: pb, healthBand: hb, confidenceBand: cb, anomalyCount },
        historicalEvidence,
        confidenceLevel,
        currentMode:  _currentMode,
        ts:           new Date().toISOString(),
    };

    _selectionHistory.push({ strategy, condBand, confidenceLevel });
    return decision;
}

// ── activateDegradedMode ──────────────────────────────────────────────

function activateDegradedMode(conditions = {}) {
    const health   = conditions.health   ?? 1;
    const pressure = conditions.pressure ?? 0;

    const pb = _pressureBand(pressure);
    const hb = _healthBand(health);
    const reasons = [];

    let targetMode;
    if (pb === "critical" || hb === "critical") {
        targetMode = "recovery";
        reasons.push("critical_state_detected");
    } else if (pb === "high" || hb === "degraded") {
        targetMode = "degraded";
        reasons.push("degraded_state_detected");
    } else if (pb === "medium" || hb === "warning") {
        targetMode = "safe";
        reasons.push("elevated_state_detected");
    } else {
        targetMode = "normal";
        reasons.push("nominal_state_restored");
    }

    const prevMode = _currentMode;
    _currentMode   = targetMode;

    return {
        mode:         targetMode,
        previousMode: prevMode,
        changed:      targetMode !== prevMode,
        reasoning:    reasons.join("; "),
        telemetryBasis: { pressureBand: pb, healthBand: hb },
        confidenceLevel: "high",
        ts: new Date().toISOString(),
    };
}

// ── getCurrentMode ────────────────────────────────────────────────────

function getCurrentMode() { return _currentMode; }

// ── recordOutcome ─────────────────────────────────────────────────────

function recordOutcome(strategy, context = {}, success = false) {
    const pb = _pressureBand(context.pressure ?? 0);
    const hb = _healthBand(context.health     ?? 1);
    _outcomeHistory.push({ strategy, conditionBand: `${pb}|${hb}`, success });
    if (_outcomeHistory.length > 500) _outcomeHistory.shift();
}

// ── getSelectorStats ──────────────────────────────────────────────────

function getSelectorStats() {
    const byStrategy = {};
    for (const h of _selectionHistory) {
        byStrategy[h.strategy] = (byStrategy[h.strategy] ?? 0) + 1;
    }
    return {
        totalSelections:  _selectionHistory.length,
        byStrategy,
        currentMode:      _currentMode,
        outcomeHistory:   _outcomeHistory.length,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _currentMode      = "normal";
    _outcomeHistory   = [];
    _selectionHistory = [];
    _counter          = 0;
}

module.exports = {
    STRATEGIES, DEGRADED_MODES, THRESHOLDS,
    selectStrategy, activateDegradedMode, getCurrentMode,
    recordOutcome, getSelectorStats, reset,
};
