"use strict";
/**
 * Phase 738 — Cross-Phase Intelligence
 *
 * Aggregates health signals across all phase foundations (645, 660, 675, 690,
 * 705, 720, 735) to surface a unified cross-phase platform view.
 * Identifies degraded phases, trend direction, and cross-phase risk propagation.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const PHASE_FOUNDATIONS = [
    { phase: 645, mod: "./trustedAutonomousFoundation.cjs",       fn: "fullPlatformHealth645" },
    { phase: 660, mod: "./operatorSafetyFoundation.cjs",          fn: "fullPlatformHealth660" },
    { phase: 675, mod: "./productionReadinessFoundation.cjs",     fn: "fullPlatformHealth675" },
    { phase: 690, mod: "./dailyOperatorFoundation.cjs",           fn: "fullPlatformHealth690" },
    { phase: 705, mod: "./multiEnvironmentFoundation.cjs",        fn: "fullPlatformHealth705" },
    { phase: 720, mod: "./engineeringProductivityOSFoundation.cjs", fn: "fullPlatformHealth720" },
    { phase: 735, mod: "./operatorProductMaturityFoundation.cjs", fn: "fullPlatformHealth735" },
];

function collectPhaseHealths() {
    return PHASE_FOUNDATIONS.map(({ phase, mod, fn }) => {
        const m = _tryRequire(mod);
        if (!m || !m[fn]) return { phase, ok: null, status: "unavailable", loaded: false };
        try {
            const h = m[fn]();
            return { phase, ok: h.ok, status: h.status || (h.ok ? "HEALTHY" : "DEGRADED"), loaded: true, modules: h.modules };
        } catch (e) {
            return { phase, ok: false, status: "error", error: e.message, loaded: false };
        }
    });
}

function crossPhaseHealthReport() {
    const phases = collectPhaseHealths();

    const loaded    = phases.filter(p => p.loaded).length;
    const healthy   = phases.filter(p => p.ok === true).length;
    const degraded  = phases.filter(p => p.ok === false).length;
    const allHealthy = degraded === 0 && loaded === PHASE_FOUNDATIONS.length;

    const degradedPhases = phases.filter(p => p.ok === false).map(p => p.phase);

    return {
        ok:             allHealthy,
        total:          PHASE_FOUNDATIONS.length,
        loaded,
        healthy,
        degraded,
        degradedPhases,
        phases,
        level:          allHealthy ? "nominal" : degraded > 2 ? "critical" : "degraded",
        summary:        `Cross-phase health: ${healthy}/${PHASE_FOUNDATIONS.length} healthy — degraded=${degradedPhases.join(",") || "none"}`,
    };
}

function crossPhaseRiskPropagation() {
    const report = crossPhaseHealthReport();
    const risks  = [];

    if (report.degradedPhases.length > 0) {
        report.degradedPhases.forEach(phase => {
            risks.push({
                phase,
                risk: `phase-${phase}-degraded`,
                propagation: phase < 700 ? "foundation-risk" : "surface-risk",
                severity: phase <= 675 ? "critical" : "warning",
            });
        });
    }

    const critRisks = risks.filter(r => r.severity === "critical").length;
    return {
        ok:         critRisks === 0,
        risks,
        critRisks,
        warnRisks:  risks.filter(r => r.severity === "warning").length,
        summary:    `Risk propagation: ${risks.length} risks (critical=${critRisks})`,
    };
}

function crossPhaseTrendDirection() {
    const report = crossPhaseHealthReport();
    const latestPhases = report.phases.slice(-3);
    const latestHealthy = latestPhases.filter(p => p.ok === true).length;

    const trend = latestHealthy === 3 ? "improving" : latestHealthy >= 2 ? "stable" : "degrading";

    return {
        ok:    trend !== "degrading",
        trend,
        basis: `Last 3 phases: ${latestHealthy}/3 healthy`,
        summary: `Trend: ${trend}`,
    };
}

module.exports = { collectPhaseHealths, crossPhaseHealthReport, crossPhaseRiskPropagation, crossPhaseTrendDirection };
