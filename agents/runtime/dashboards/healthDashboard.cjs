"use strict";
/**
 * healthDashboard — aggregated runtime health view.
 *
 * getHealthSummary()         → { status, score, execution, resources, anomalies, stability, generatedAt }
 *   status: "healthy" | "degraded" | "critical"
 *   score:  0–100
 *
 * getWorkflowHealth(name)    → per-workflow health snapshot
 */

const qualityScorer = require("../qualityScorer.cjs");
const trustScorer   = require("../trustScorer.cjs");
const anomaly       = require("../anomalyDetector.cjs");
const rm            = require("../resourceMonitor.cjs");
const stabilizer    = require("../runtimeStabilizer.cjs");
const history       = require("../executionHistory.cjs");

function getHealthSummary() {
    const mem     = process.memoryUsage();
    const allRecs = history.getAll();
    const wfRecs  = allRecs.filter(r => r.taskType?.startsWith("workflow:"));
    const succRate = wfRecs.length > 0
        ? wfRecs.filter(r => r.success).length / wfRecs.length
        : null;

    const allAnoms = anomaly.getAllAnomalies();
    const crits    = allAnoms.filter(a => a.severity === "critical").length;
    const warns    = allAnoms.filter(a => a.severity === "warning").length;

    const stabSnap  = stabilizer.stabilityReport();
    const quarCount = Object.values(stabSnap).filter(s => s.quarantined).length;

    const memPressure = rm.getMemoryPressure();
    const cpuLoad     = rm.getCpuLoad();

    let score = 100;
    score -= crits    * 15;
    score -= warns    *  5;
    score -= quarCount * 10;
    if (memPressure > 0.85) score -= 20;
    if (cpuLoad     > 0.90) score -= 15;
    if (succRate !== null && succRate < 0.70) score -= 15;
    score = Math.max(0, Math.min(100, score));

    return {
        status:    score >= 80 ? "healthy" : score >= 50 ? "degraded" : "critical",
        score,
        execution: {
            workflowsRun: wfRecs.length,
            successRate:  succRate !== null ? parseFloat(succRate.toFixed(3)) : null,
        },
        resources: {
            memPressure: parseFloat(memPressure.toFixed(3)),
            cpuLoad:     parseFloat(cpuLoad.toFixed(3)),
            heapMB:      Math.round(mem.heapUsed / 1e6),
        },
        anomalies: { critical: crits, warning: warns, total: allAnoms.length },
        stability: { quarantined: quarCount },
        generatedAt: new Date().toISOString(),
    };
}

function getWorkflowHealth(name) {
    const trust    = trustScorer.getTrust(name);
    const level    = trustScorer.getTrustLevel(name).name;
    const wfAnoms  = anomaly.getAnomalies(name);
    const stabSnap = stabilizer.stabilityReport();
    const stab     = stabSnap[name];
    const recs     = history.getAll().filter(r => r.taskType === `workflow:${name}`);
    const succRate = recs.length > 0
        ? parseFloat((recs.filter(r => r.success).length / recs.length).toFixed(3))
        : null;

    return {
        name,
        trust, level,
        successRate:    succRate,
        anomalies:      wfAnoms.length,
        quarantined:    stab?.quarantined   ?? false,
        instabilities:  stab?.instabilityCount ?? 0,
        generatedAt:    new Date().toISOString(),
    };
}

module.exports = { getHealthSummary, getWorkflowHealth };
