"use strict";
/**
 * Phase 737 — Operator Intelligence Surface
 *
 * Unified operator-facing intelligence surface: surfaces only what the operator
 * needs to act on — critical signals, recommended actions, platform health summary.
 * Low-noise, high-signal design.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function platformHealthSummary() {
    const dims = {};

    const pmr = _tryRequire("./platformMaturityResilience.cjs");
    if (pmr) { try { const r = pmr.platformMaturityResilienceReport(); dims.maturity = { ok: r.ok, critical: r.criticalCount, warnings: r.warningCount }; } catch {} }

    const ppr = _tryRequire("./platformProductivityResilience.cjs");
    if (ppr) { try { const r = ppr.platformProductivityResilienceReport(); dims.productivity = { ok: r.ok, critical: r.criticalCount, warnings: r.warningCount }; } catch {} }

    const pcr = _tryRequire("./platformCoordinationResilience2.cjs");
    if (pcr) { try { const r = pcr.platformCoordinationResilience2Report(); dims.coordination = { ok: r.ok, critical: r.criticalCount, warnings: r.warningCount }; } catch {} }

    const ecc = _tryRequire("./engineeringCommandCenter.cjs");
    if (ecc) { try { const d = ecc.commandCenterDashboard(); dims.commandCenter = { ok: !d.storm, criticalPanels: d.criticalCount }; } catch {} }

    const allOk     = Object.values(dims).every(d => d.ok !== false);
    const totalCrit = Object.values(dims).reduce((n, d) => n + (d.critical || 0), 0);
    const totalWarn = Object.values(dims).reduce((n, d) => n + (d.warnings || 0), 0);

    return {
        ok:          allOk,
        totalCrit,
        totalWarn,
        dims,
        level:       allOk ? (totalWarn === 0 ? "nominal" : "watch") : "degraded",
        summary:     `Platform health: ${allOk ? "OK" : "DEGRADED"} critical=${totalCrit} warnings=${totalWarn}`,
    };
}

function operatorActionQueue() {
    const actions = [];

    const psa = _tryRequire("./platformSignalAggregation.cjs");
    if (psa) {
        try {
            const surface = psa.signalSurface();
            surface.topSignals?.forEach(s => {
                actions.push({ priority: "high", action: `investigate:${s.dimension}:${s.check}`, source: s.source, severity: s.severity });
            });
        } catch {}
    }

    const occ = _tryRequire("./engineeringCommandCenter.cjs");
    if (occ) {
        try {
            const d = occ.commandCenterDashboard();
            if (d.storm) actions.push({ priority: "critical", action: "resolve-command-center-storm", source: "engineeringCommandCenter" });
        } catch {}
    }

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const h = lss.survivabilityHealth();
            if (h.storm) actions.push({ priority: "critical", action: "resolve-survivability-storm", source: "longSessionSurvivability" });
        } catch {}
    }

    actions.sort((a, b) => {
        const rank = { critical: 0, high: 1, medium: 2, low: 3 };
        return (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9);
    });

    return { ok: true, count: actions.length, actions };
}

function intelligenceSurfaceReport() {
    const health  = platformHealthSummary();
    const actions = operatorActionQueue();

    const psa = _tryRequire("./platformSignalAggregation.cjs");
    let signalSurface = null;
    if (psa) { try { signalSurface = psa.aggregateSignals({ maxAge: 2 * 60 * 60 * 1000 }); } catch {} }

    return {
        ok:           health.ok,
        health:       { level: health.level, critical: health.totalCrit, warnings: health.totalWarn },
        actionQueue:  { count: actions.count, topActions: actions.actions.slice(0, 5) },
        signals:      signalSurface ? { total: signalSurface.total, critical: signalSurface.criticalCount } : null,
        summary:      `Intelligence surface: level=${health.level} actions=${actions.count} signals=${signalSurface?.total ?? 0}`,
    };
}

module.exports = { platformHealthSummary, operatorActionQueue, intelligenceSurfaceReport };
