"use strict";
/**
 * metricsExporter — operational metrics collection and export.
 *
 * collect()         → structured metrics snapshot
 * toJSON()          → JSON string
 * toPrometheus()    → Prometheus text-format string
 */

const history    = require("./executionHistory.cjs");
const rm         = require("./resourceMonitor.cjs");
const stabilizer = require("./runtimeStabilizer.cjs");
const anomaly    = require("./anomalyDetector.cjs");
const ts         = require("./trustScorer.cjs");
const pq         = require("./priorityQueue.cjs");

function collect() {
    const mem      = process.memoryUsage();
    const allRecs  = history.getAll();
    const wfRecs   = allRecs.filter(r => r.taskType?.startsWith("workflow:"));
    const wfSucc   = wfRecs.filter(r => r.success).length;

    const stabSnap  = stabilizer.stabilityReport();
    const allAnoms  = anomaly.getAllAnomalies();
    const trustSnap = ts.snapshot();

    const anomCounts = {};
    for (const a of allAnoms) {
        anomCounts[a.type] = (anomCounts[a.type] || 0) + 1;
    }

    const trustValues = Object.values(trustSnap);

    return {
        collectedAt: new Date().toISOString(),
        execution: {
            totalRecords: allRecs.length,
            workflowsRun: wfRecs.length,
            successRate:  wfRecs.length > 0
                ? parseFloat((wfSucc / wfRecs.length).toFixed(3))
                : null,
            queueDepth:   pq.size(),
        },
        resources: {
            heapUsedMB:  Math.round(mem.heapUsed  / 1e6),
            heapTotalMB: Math.round(mem.heapTotal / 1e6),
            rssMB:       Math.round(mem.rss       / 1e6),
            memPressure: parseFloat(rm.getMemoryPressure().toFixed(3)),
            cpuLoad:     parseFloat(rm.getCpuLoad().toFixed(3)),
        },
        stability: {
            trackedWorkflows: Object.keys(stabSnap).length,
            quarantinedCount: Object.values(stabSnap).filter(s => s.quarantined).length,
            suppressedCount:  Object.values(stabSnap).filter(s => s.suppressed).length,
        },
        anomalies: {
            total:  allAnoms.length,
            counts: anomCounts,
        },
        trust: {
            totalWorkflows: trustValues.length,
            avgTrust: trustValues.length > 0
                ? parseFloat((trustValues.reduce((s, v) => s + v, 0) / trustValues.length).toFixed(1))
                : null,
        },
    };
}

function toJSON() {
    return JSON.stringify(collect(), null, 2);
}

function toPrometheus() {
    const m     = collect();
    const lines = [];

    const metric = (name, help, type, value) => {
        if (value === null || value === undefined) return;
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} ${type}`);
        lines.push(`${name} ${value}`);
    };

    metric("jarvis_execution_records_total",    "Total execution records",          "counter", m.execution.totalRecords);
    metric("jarvis_workflows_run_total",         "Total workflow executions",         "counter", m.execution.workflowsRun);
    metric("jarvis_success_rate",               "Overall workflow success rate 0-1", "gauge",   m.execution.successRate);
    metric("jarvis_queue_depth",                "Current queue depth",               "gauge",   m.execution.queueDepth);
    metric("jarvis_heap_used_mb",               "Heap used in MB",                   "gauge",   m.resources.heapUsedMB);
    metric("jarvis_memory_pressure",            "Memory pressure 0-1",               "gauge",   m.resources.memPressure);
    metric("jarvis_cpu_load",                   "CPU load 0-1",                      "gauge",   m.resources.cpuLoad);
    metric("jarvis_quarantined_workflows",      "Quarantined workflow count",         "gauge",   m.stability.quarantinedCount);
    metric("jarvis_anomalies_total",            "Total anomalies detected",          "counter", m.anomalies.total);
    metric("jarvis_trust_avg",                  "Average trust score",               "gauge",   m.trust.avgTrust);

    return lines.join("\n");
}

module.exports = { collect, toJSON, toPrometheus };
