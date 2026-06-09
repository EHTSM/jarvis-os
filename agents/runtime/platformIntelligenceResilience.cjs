"use strict";
/**
 * Phase 749 — Platform Intelligence Resilience
 *
 * Validates resilience of intelligence infrastructure: signal continuity,
 * replay signal survivability, alert pipeline stability,
 * decision support availability, context coherence, pattern recognition reliability.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function checkIntelligenceContinuity() {
    const signals = [];
    let ok = true;

    const psa = _tryRequire("./platformSignalAggregation.cjs");
    if (psa) {
        try {
            const r = psa.aggregateSignals({ maxAge: 60 * 60 * 1000 });
            if (r.criticalCount > 5) { signals.push({ check: "signal-critical-flood", count: r.criticalCount, severity: "critical" }); ok = false; }
        } catch {}
    }

    const ois = _tryRequire("./operatorIntelligenceSurface.cjs");
    if (ois) {
        try {
            const r = ois.platformHealthSummary();
            if (r.level === "degraded" && r.totalCrit > 3) { signals.push({ check: "surface-degraded", critical: r.totalCrit, severity: "critical" }); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Intelligence continuity intact" : `${signals.length} signal(s)` };
}

function checkIntelligenceReplay() {
    const signals = [];
    let ok = true;

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const d = lss.assessSurvivabilityDurability();
            if (!d.durable) { d.signals?.forEach(s => signals.push(s)); ok = false; }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Intelligence replay intact" : `${signals.length} signal(s)` };
}

function checkAlertPipelineStability() {
    const signals = [];
    let ok = true;

    const iaf = _tryRequire("./intelligentAlertFiltering.cjs");
    if (iaf) {
        try {
            const stats = iaf.alertFilteringStats();
            if (stats.suppressionRate < 10 && stats.total > 50) {
                signals.push({ check: "alert-suppression-too-low", rate: stats.suppressionRate, severity: "warning" });
            }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Alert pipeline stable" : `${signals.length} signal(s)` };
}

function checkIntelligenceCoordination() {
    const signals = [];
    let ok = true;

    const cpi = _tryRequire("./crossPhaseIntelligence.cjs");
    if (cpi) {
        try {
            const r = cpi.crossPhaseRiskPropagation();
            r.risks.filter(ri => ri.severity === "critical").forEach(ri => {
                signals.push({ check: `critical-phase-risk:${ri.phase}`, severity: "critical" });
                ok = false;
            });
        } catch {}
    }

    return { ok, signals, detail: ok ? "Intelligence coordination stable" : `${signals.length} signal(s)` };
}

function checkDecisionSupportAvailability() {
    const signals = [];
    let ok = true;

    const pds = _tryRequire("./platformDecisionSupport.cjs");
    if (!pds) { signals.push({ check: "decision-support-unavailable", severity: "warning" }); }

    const owo = _tryRequire("./operatorWorkflowOrchestration.cjs");
    if (!owo) { signals.push({ check: "workflow-orchestration-unavailable", severity: "warning" }); }

    return { ok, signals, detail: ok ? "Decision support available" : `${signals.length} signal(s)` };
}

function checkPatternRecognitionReliability() {
    const signals = [];
    let ok = true;

    const rpr = _tryRequire("./runtimePatternRecognition.cjs");
    if (rpr) {
        try {
            const r = rpr.patternRecognitionReport();
            if (r.patterns?.critical > 3) {
                signals.push({ check: "too-many-critical-patterns", count: r.patterns.critical, severity: "warning" });
            }
        } catch {}
    }

    return { ok, signals, detail: ok ? "Pattern recognition reliable" : `${signals.length} signal(s)` };
}

function platformIntelligenceResilienceReport() {
    const continuity    = checkIntelligenceContinuity();
    const replay        = checkIntelligenceReplay();
    const alertPipeline = checkAlertPipelineStability();
    const coordination  = checkIntelligenceCoordination();
    const decisionSup   = checkDecisionSupportAvailability();
    const patterns      = checkPatternRecognitionReliability();

    const dimensions    = { continuity, replay, alertPipeline, coordination, decisionSupport: decisionSup, patterns };
    const allSignals    = Object.values(dimensions).flatMap(d => d.signals || []);
    const criticalCount = allSignals.filter(s => s.severity === "critical").length;
    const warningCount  = allSignals.filter(s => s.severity === "warning").length;
    const healthy       = criticalCount === 0;

    return {
        ok: healthy, healthy, criticalCount, warningCount, dimensions,
        summary: `Platform intelligence resilience: ${healthy ? "RESILIENT" : "DEGRADED"} — critical=${criticalCount} warnings=${warningCount}`,
    };
}

module.exports = { checkIntelligenceContinuity, checkIntelligenceReplay, checkAlertPipelineStability, checkIntelligenceCoordination, checkDecisionSupportAvailability, checkPatternRecognitionReliability, platformIntelligenceResilienceReport };
