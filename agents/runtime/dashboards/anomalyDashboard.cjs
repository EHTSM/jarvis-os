"use strict";
/**
 * anomalyDashboard — aggregated view over anomalyDetector data.
 *
 * getSummary()               → { total, byType, bySeverity, criticalCount, warningCount, generatedAt }
 * getTopOffenders(n)         → [{ workflowId, count }] — most anomalous workflows
 * getTimeline(workflowId)    → [{ ts, type, severity, detail }] sorted by time
 */

const anomalyDetector = require("../anomalyDetector.cjs");

function getSummary() {
    const all      = anomalyDetector.getAllAnomalies();
    const byType   = {};
    const bySev    = {};

    for (const a of all) {
        byType[a.type]     = (byType[a.type]     || 0) + 1;
        bySev[a.severity]  = (bySev[a.severity]  || 0) + 1;
    }

    return {
        total:         all.length,
        byType,
        bySeverity:    bySev,
        criticalCount: bySev["critical"] || 0,
        warningCount:  bySev["warning"]  || 0,
        generatedAt:   new Date().toISOString(),
    };
}

function getTopOffenders(n = 5) {
    const all    = anomalyDetector.getAllAnomalies();
    const counts = {};
    for (const a of all) {
        const wf = a.workflowId || "unknown";
        counts[wf] = (counts[wf] || 0) + 1;
    }
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([workflowId, count]) => ({ workflowId, count }));
}

function getTimeline(workflowId) {
    const EXCLUDED = new Set(["workflowId", "detectedAt", "type", "severity"]);
    return anomalyDetector.getAnomalies(workflowId)
        .map(a => ({
            ts:       a.detectedAt,
            type:     a.type,
            severity: a.severity,
            detail:   Object.fromEntries(
                Object.entries(a).filter(([k]) => !EXCLUDED.has(k))
            ),
        }))
        .sort((a, b) => new Date(a.ts) - new Date(b.ts));
}

module.exports = { getSummary, getTopOffenders, getTimeline };
