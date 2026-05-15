"use strict";
/**
 * executionSupervisor — coordinated autonomous execution lifecycle supervisor.
 *
 * Lifecycle phases (run in sequence by supervise):
 *   detect → analyze → decide → coordinate → verify → stabilize
 *
 * supervise(execution, signals)             → SupervisionResult
 * aggregateConfidence(signals)              → ConfidenceAggregate
 * triggerStabilization(metrics)            → StabilizationResult
 * getAuditTrail()                          → AuditRecord[]
 * getSupervisionStats()                    → Stats
 * reset()
 *
 * signals shape (all fields optional):
 *   riskScore       number 0-100
 *   routeScore      number 0-100
 *   confidenceMap   { routing, prediction, optimization, memory, evolution }
 *   anomalies       array of { type, severity }
 *   strategyRanking array of { strategy, score }
 *   pressure        "none"|"low"|"medium"|"high"|"critical"
 *   memoryProfile   { successRate, avgRetries, rollbackRate }
 */

const STABILIZATION_THRESHOLDS = {
    concurrency_reduce:   { riskScore: 60 },
    strategy_safe:        { riskScore: 50 },
    throttle_risky:       { riskScore: 70 },
    increase_verification:{ riskScore: 40 },
};

let _auditTrail   = [];
let _supervisions = [];
let _stabilizations = [];
let _counter      = 0;

// ── _detect ───────────────────────────────────────────────────────────

function _detect(execution, signals) {
    const anomalies = [...(signals.anomalies ?? [])];
    const pressure  = signals.pressure ?? "none";

    if ((signals.riskScore ?? 0) >= 70) {
        anomalies.push({ type: "high_risk_score", severity: "high", value: signals.riskScore });
    }
    if ((signals.routeScore ?? 100) < 40) {
        anomalies.push({ type: "poor_route_quality", severity: "medium", value: signals.routeScore });
    }
    if (execution.retryCount != null && execution.retryCount >= 3) {
        anomalies.push({ type: "retry_escalation", severity: "medium", count: execution.retryCount });
    }
    if (execution.rollbackTriggered) {
        anomalies.push({ type: "rollback_active", severity: "high" });
    }

    return { anomalies, pressureLevel: pressure, detectedCount: anomalies.length };
}

// ── _analyze ──────────────────────────────────────────────────────────

function _analyze(detection, signals) {
    const riskScore  = signals.riskScore  ?? 0;
    const routeScore = signals.routeScore ?? 100;
    const conf       = signals.confidenceMap ?? {};

    const confidenceValues = Object.values(conf).filter(v => typeof v === "number");
    const avgConfidence    = confidenceValues.length > 0
        ? confidenceValues.reduce((s, v) => s + v, 0) / confidenceValues.length
        : 75;

    const criticalAnomaly = detection.anomalies.some(a => a.severity === "critical");
    const highAnomaly     = detection.anomalies.some(a => a.severity === "high");

    const adjustedRisk = Math.min(100,
        riskScore +
        (criticalAnomaly ? 20 : 0) +
        (highAnomaly     ? 10 : 0) +
        (routeScore < 40 ? 15 : 0)
    );

    return {
        riskScore:      +adjustedRisk.toFixed(1),
        confidence:     +avgConfidence.toFixed(1),
        anomalyCount:   detection.anomalies.length,
        criticalAnomaly,
    };
}

// ── _decide ───────────────────────────────────────────────────────────

function _decide(analysis, signals) {
    const { riskScore, confidence } = analysis;
    const ranking = signals.strategyRanking ?? [];

    // Pick top-ranked strategy if available; otherwise derive from risk
    let strategy = ranking[0]?.strategy ?? null;
    if (!strategy) {
        strategy = riskScore >= 80 ? "sandbox"        :
                   riskScore >= 60 ? "recovery_first"  :
                   riskScore >= 40 ? "staged"          :
                   riskScore >= 20 ? "safe"            : "fast";
    }

    const verification = confidence < 60 || riskScore >= 50 ? "required" : "optional";
    const pace         = riskScore >= 60 ? "slow" : riskScore >= 30 ? "normal" : "fast";

    return { strategy, verification, pace, riskScore, confidence };
}

// ── _coordinate ───────────────────────────────────────────────────────

function _coordinate(decision, signals) {
    const adjustments = [];
    const pressure    = signals.pressure ?? "none";
    const memProfile  = signals.memoryProfile ?? {};

    if (pressure === "critical") {
        adjustments.push({ domain: "routing",      action: "restrict_to_healthy_only"  });
        adjustments.push({ domain: "concurrency",  action: "reduce_to_minimum"         });
    }
    if (pressure === "high" || pressure === "degraded") {
        adjustments.push({ domain: "evolution",    action: "pause_promotion_cycles"    });
        adjustments.push({ domain: "optimization", action: "disable_aggressive_tuning" });
    }
    if ((memProfile.rollbackRate ?? 0) > 0.2) {
        adjustments.push({ domain: "memory",       action: "flag_unstable_fingerprints" });
    }
    if (decision.strategy === "sandbox") {
        adjustments.push({ domain: "routing",      action: "route_to_sandbox_only"     });
    }

    return {
        coordinated:  true,
        adjustments,
        finalStrategy: decision.strategy,
        domainsAffected: [...new Set(adjustments.map(a => a.domain))].length,
    };
}

// ── _verify ───────────────────────────────────────────────────────────

function _verify(decision, coordination) {
    const issues = [];

    if (decision.strategy === "fast" && decision.riskScore >= 50) {
        issues.push("fast_strategy_with_high_risk");
    }
    if (coordination.adjustments.length > 4) {
        issues.push("excessive_coordination_adjustments");
    }

    const verified = issues.length === 0;
    const override = !verified ? _saferStrategy(decision.strategy) : null;

    return {
        verified,
        issues,
        finalStrategy: override ?? decision.strategy,
        overridden:    override !== null,
    };
}

function _saferStrategy(strategy) {
    const chain = ["fast", "safe", "staged", "recovery_first", "sandbox"];
    const idx   = chain.indexOf(strategy);
    return idx < chain.length - 1 ? chain[idx + 1] : strategy;
}

// ── _stabilize (internal, called by supervise when needed) ───────────

function _stabilizeInternal(analysis, decision) {
    const actions = [];
    const { riskScore } = analysis;

    if (riskScore >= STABILIZATION_THRESHOLDS.increase_verification.riskScore)
        actions.push("increase_verification_frequency");
    if (riskScore >= STABILIZATION_THRESHOLDS.strategy_safe.riskScore)
        actions.push("prioritize_safe_strategies");
    if (riskScore >= STABILIZATION_THRESHOLDS.concurrency_reduce.riskScore)
        actions.push("reduce_concurrency");
    if (riskScore >= STABILIZATION_THRESHOLDS.throttle_risky.riskScore)
        actions.push("throttle_risky_workflows");

    return { stabilized: actions.length > 0, actions, riskScore };
}

// ── supervise ─────────────────────────────────────────────────────────

function supervise(execution = {}, signals = {}) {
    const supervisionId = `sup-${++_counter}`;
    const phases        = [];
    const ts            = new Date().toISOString();

    // Phase 1: detect
    const detection = _detect(execution, signals);
    phases.push({ phase: "detect",    result: detection });

    // Phase 2: analyze
    const analysis  = _analyze(detection, signals);
    phases.push({ phase: "analyze",   result: analysis });

    // Phase 3: decide
    const decision  = _decide(analysis, signals);
    phases.push({ phase: "decide",    result: decision });

    // Phase 4: coordinate
    const coordination = _coordinate(decision, signals);
    phases.push({ phase: "coordinate", result: coordination });

    // Phase 5: verify
    const verification = _verify(decision, coordination);
    phases.push({ phase: "verify",    result: verification });

    // Phase 6: stabilize
    const stabilization = _stabilizeInternal(analysis, decision);
    phases.push({ phase: "stabilize", result: stabilization });

    const result = {
        supervisionId,
        finalStrategy:   verification.finalStrategy,
        verified:        verification.verified,
        stabilized:      stabilization.stabilized,
        riskScore:       analysis.riskScore,
        confidence:      analysis.confidence,
        pace:            decision.pace,
        verification:    decision.verification,
        anomalyCount:    detection.detectedCount,
        coordinationAdjustments: coordination.adjustments.length,
        phases,
        ts,
    };

    _supervisions.push(result);
    _auditTrail.push({ type: "supervision", supervisionId, riskScore: analysis.riskScore, finalStrategy: verification.finalStrategy, ts });

    return result;
}

// ── aggregateConfidence ───────────────────────────────────────────────

function aggregateConfidence(signals = {}) {
    const conf = signals.confidenceMap ?? {};
    const domains = ["routing", "prediction", "optimization", "memory", "evolution"];

    const present = domains.filter(d => typeof conf[d] === "number");
    if (present.length === 0) return { aggregate: 0, grade: "F", reason: "no_signals", domainCount: 0 };

    const avg     = present.reduce((s, d) => s + conf[d], 0) / present.length;
    const min     = Math.min(...present.map(d => conf[d]));
    const weakLink = domains.find(d => conf[d] === min) ?? null;

    // Penalize for missing domains
    const coveragePenalty = (domains.length - present.length) * 5;
    const aggregate = +Math.max(0, avg - coveragePenalty).toFixed(1);
    const grade     = aggregate >= 90 ? "A" : aggregate >= 75 ? "B" : aggregate >= 60 ? "C" : aggregate >= 40 ? "D" : "F";

    return { aggregate, grade, domainCount: present.length, weakLink, minScore: +min.toFixed(1) };
}

// ── triggerStabilization ──────────────────────────────────────────────

function triggerStabilization(metrics = {}) {
    const {
        riskScore    = 0,
        errorRate    = 0,
        concurrency  = 5,
        pressure     = "none",
    } = metrics;

    const actions = [];
    let targetConcurrency = concurrency;

    if (riskScore >= 40 || errorRate > 0.05) {
        actions.push("increase_verification_frequency");
    }
    if (riskScore >= 50 || errorRate > 0.1) {
        actions.push("prioritize_safe_strategies");
    }
    if (riskScore >= 60 || pressure === "high" || pressure === "critical") {
        targetConcurrency = Math.max(1, Math.floor(concurrency * 0.6));
        actions.push("reduce_concurrency");
    }
    if (riskScore >= 70) {
        actions.push("throttle_risky_workflows");
    }
    if (pressure === "critical" || errorRate > 0.3) {
        actions.push("activate_recovery_mode");
    }

    const record = { actions, targetConcurrency, metrics: { ...metrics }, ts: new Date().toISOString() };
    _stabilizations.push(record);
    _auditTrail.push({ type: "stabilization", actions: actions.length, riskScore, ts: record.ts });

    return {
        stabilized:        actions.length > 0,
        actions,
        targetConcurrency,
        originalConcurrency: concurrency,
    };
}

// ── getAuditTrail / getSupervisionStats / reset ───────────────────────

function getAuditTrail() { return [..._auditTrail]; }

function getSupervisionStats() {
    const total   = _supervisions.length;
    const avgRisk = total > 0
        ? +(_supervisions.reduce((s, r) => s + r.riskScore, 0) / total).toFixed(1)
        : 0;
    const verified = _supervisions.filter(r => r.verified).length;
    return { total, avgRiskScore: avgRisk, verifiedRate: total > 0 ? +(verified / total).toFixed(3) : 0, stabilizations: _stabilizations.length };
}

function reset() {
    _auditTrail     = [];
    _supervisions   = [];
    _stabilizations = [];
    _counter        = 0;
}

module.exports = {
    STABILIZATION_THRESHOLDS,
    supervise, aggregateConfidence, triggerStabilization,
    getAuditTrail, getSupervisionStats, reset,
};
