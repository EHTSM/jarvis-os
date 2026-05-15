"use strict";
/**
 * metricsCollector — collects per-execution runtime metrics and aggregates them.
 *
 * record(result, opts?) — ingest one execution result
 * getAll()             — raw metric records
 * getSummary()         — aggregated summary
 * reset()
 */

let _records = [];

// ── record ────────────────────────────────────────────────────────────

function record(result, opts = {}) {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();

    const entry = {
        executionId:      result.executionId ?? null,
        fingerprint:      result._integration?.fingerprint ?? opts.fingerprint ?? null,
        ts:               new Date().toISOString(),
        durationMs:       result.totalDurationMs ?? 0,
        retryCount:       result._integration?.memoryEntry?.retryCount
                          ?? (result.steps ?? []).reduce((s, st) => s + Math.max(0, (st.attempts ?? 1) - 1), 0),
        retryOverheadMs:  opts.retryOverheadMs ?? 0,
        rollbackTriggered: result.rollbackTriggered ?? false,
        stepsSpawned:     (result.steps ?? []).length,
        success:          result.success ?? false,
        strategy:         result._integration?.strategy ?? result.strategy ?? null,
        sandboxed:        result._integration?.strategy === "sandbox" || result.sandboxRedirected || false,
        governed:         result.state === "governance_blocked",
        classification:   result.classification ?? "safe",
        heapUsedBytes:    mem.heapUsed,
        heapTotalBytes:   mem.heapTotal,
        cpuUserMs:        Math.round(cpu.user / 1000),
        cpuSystemMs:      Math.round(cpu.system / 1000),
        queueLatencyMs:   opts.queueLatencyMs ?? 0,
    };
    _records.push(entry);
    return entry;
}

// ── getSummary ────────────────────────────────────────────────────────

function getSummary() {
    if (_records.length === 0) {
        return {
            totalExecutions:     0,
            successRate:         0,
            avgDurationMs:       0,
            avgRetryCount:       0,
            totalRetries:        0,
            rollbackFrequency:   0,
            totalStepsSpawned:   0,
            avgStepsPerExecution: 0,
            sandboxUsageRate:    0,
            governanceBlockRate: 0,
            avgHeapUsedMB:       0,
            avgQueueLatencyMs:   0,
            throughputPerMin:    0,
        };
    }

    const n             = _records.length;
    const successes     = _records.filter(r => r.success).length;
    const rollbacks     = _records.filter(r => r.rollbackTriggered).length;
    const sandboxed     = _records.filter(r => r.sandboxed).length;
    const governed      = _records.filter(r => r.governed).length;
    const totalRetries  = _records.reduce((s, r) => s + r.retryCount, 0);
    const totalSteps    = _records.reduce((s, r) => s + r.stepsSpawned, 0);
    const totalDuration = _records.reduce((s, r) => s + r.durationMs, 0);
    const totalHeap     = _records.reduce((s, r) => s + r.heapUsedBytes, 0);
    const totalLatency  = _records.reduce((s, r) => s + r.queueLatencyMs, 0);

    // throughput: executions per minute estimated from time span
    let throughputPerMin = 0;
    if (n > 1) {
        const first = new Date(_records[0].ts).getTime();
        const last  = new Date(_records[n - 1].ts).getTime();
        const spanMs = Math.max(1, last - first);
        throughputPerMin = (n / spanMs) * 60000;
    }

    return {
        totalExecutions:      n,
        successRate:          successes / n,
        avgDurationMs:        totalDuration / n,
        avgRetryCount:        totalRetries / n,
        totalRetries,
        rollbackFrequency:    rollbacks / n,
        totalStepsSpawned:    totalSteps,
        avgStepsPerExecution: totalSteps / n,
        sandboxUsageRate:     sandboxed / n,
        governanceBlockRate:  governed / n,
        avgHeapUsedMB:        (totalHeap / n) / (1024 * 1024),
        avgQueueLatencyMs:    totalLatency / n,
        throughputPerMin,
    };
}

function getAll()  { return [..._records]; }
function reset()   { _records = []; }

module.exports = { record, getAll, getSummary, reset };
