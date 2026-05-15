"use strict";
/**
 * patternAnalyzer — execution pattern detection and fingerprint clustering.
 *
 * recordExecution(exec)                        → void
 * detectPatterns(opts)                         → Pattern[]
 * getRecurringFailures(minOccurrences)         → FailurePattern[]
 * clusterFingerprints(executions)              → Cluster[]
 * getHotWorkflows(topN)                        → WorkflowFrequency[]
 * getPatternStats()                            → Stats
 * reset()
 */

const MIN_PATTERN_OCCURRENCES = 3;
const MAX_HISTORY             = 2000;
const CLUSTER_SIMILARITY      = 0.7;   // jaccard threshold for same cluster

let _executions  = [];
let _fingerprints = new Map();   // fingerprint → count
let _typeSeqs    = [];           // sliding window of recent event types (last 500)
let _counter     = 0;

// ── recordExecution ───────────────────────────────────────────────────

function recordExecution(exec = {}) {
    const entry = {
        id:          exec.id          ?? `exec-${++_counter}`,
        type:        exec.type        ?? "unknown",
        strategy:    exec.strategy    ?? "default",
        outcome:     exec.outcome     ?? "unknown",  // success | failure | partial
        durationMs:  exec.durationMs  ?? 0,
        errorType:   exec.errorType   ?? null,
        fingerprint: exec.fingerprint ?? _buildFingerprint(exec),
        tags:        exec.tags        ?? [],
        ts:          exec.ts          ?? new Date().toISOString(),
    };

    _executions.push(entry);
    if (_executions.length > MAX_HISTORY) _executions.shift();

    // Track fingerprint frequency
    const fp = entry.fingerprint;
    _fingerprints.set(fp, (_fingerprints.get(fp) ?? 0) + 1);

    // Track type sequence for pattern detection
    _typeSeqs.push(entry.type);
    if (_typeSeqs.length > 500) _typeSeqs.shift();

    return entry;
}

function _buildFingerprint(exec) {
    const parts = [
        exec.type    ?? "?",
        exec.strategy ?? "?",
        exec.errorType ?? "ok",
    ];
    return parts.join(":");
}

// ── detectPatterns ────────────────────────────────────────────────────

function detectPatterns(opts = {}) {
    const minOcc = opts.minOccurrences ?? MIN_PATTERN_OCCURRENCES;
    const patterns = [];

    // 1. Frequent fingerprint patterns
    for (const [fp, count] of _fingerprints) {
        if (count >= minOcc) {
            const [type, strategy, errorType] = fp.split(":");
            patterns.push({
                patternType: "frequent_fingerprint",
                fingerprint: fp,
                type, strategy, errorType,
                occurrences: count,
                frequency: +( count / Math.max(1, _executions.length) ).toFixed(3),
            });
        }
    }

    // 2. Recurring failure sequences (consecutive failures of same type)
    const failureRuns = _detectConsecutiveRuns(
        _executions.filter(e => e.outcome === "failure"),
        minOcc
    );
    for (const run of failureRuns) {
        patterns.push({
            patternType: "failure_run",
            errorType:   run.key,
            occurrences: run.maxRun,
            frequency:   +( run.total / Math.max(1, _executions.length) ).toFixed(3),
        });
    }

    // 3. Strategy-specific patterns
    const stratCounts = {};
    for (const e of _executions) {
        const k = `${e.strategy}:${e.outcome}`;
        stratCounts[k] = (stratCounts[k] ?? 0) + 1;
    }
    for (const [k, count] of Object.entries(stratCounts)) {
        if (count >= minOcc) {
            const [strategy, outcome] = k.split(":");
            patterns.push({
                patternType: "strategy_outcome",
                strategy, outcome,
                occurrences: count,
                frequency:   +( count / Math.max(1, _executions.length) ).toFixed(3),
            });
        }
    }

    return patterns.sort((a, b) => b.occurrences - a.occurrences);
}

function _detectConsecutiveRuns(subset, minOcc) {
    // Group by errorType, find max consecutive run
    const byError = {};
    for (const e of subset) {
        const key = e.errorType ?? "unknown";
        if (!byError[key]) byError[key] = { key, total: 0, maxRun: 0, curRun: 0 };
        byError[key].total++;
        byError[key].curRun++;
        if (byError[key].curRun > byError[key].maxRun) byError[key].maxRun = byError[key].curRun;
    }
    return Object.values(byError).filter(r => r.maxRun >= minOcc);
}

// ── getRecurringFailures ──────────────────────────────────────────────

function getRecurringFailures(minOccurrences = MIN_PATTERN_OCCURRENCES) {
    const failures = _executions.filter(e => e.outcome === "failure");
    const byError  = {};
    for (const e of failures) {
        const k = e.errorType ?? "unknown";
        if (!byError[k]) byError[k] = { errorType: k, count: 0, strategies: new Set(), lastSeen: null };
        byError[k].count++;
        byError[k].strategies.add(e.strategy);
        byError[k].lastSeen = e.ts;
    }
    return Object.values(byError)
        .filter(r => r.count >= minOccurrences)
        .map(r => ({ ...r, strategies: [...r.strategies] }))
        .sort((a, b) => b.count - a.count);
}

// ── clusterFingerprints ───────────────────────────────────────────────

function clusterFingerprints(executions = _executions) {
    if (executions.length === 0) return [];

    const clusters = [];

    for (const exec of executions) {
        const fp    = exec.fingerprint ?? _buildFingerprint(exec);
        const fpSet = new Set(fp.split(":"));

        let placed = false;
        for (const cluster of clusters) {
            const sim = _jaccardSets(fpSet, cluster._fpSet);
            if (sim >= CLUSTER_SIMILARITY) {
                cluster.members.push(exec.id ?? fp);
                cluster.fingerprints.add(fp);
                cluster.outcomes[exec.outcome] = (cluster.outcomes[exec.outcome] ?? 0) + 1;
                placed = true;
                break;
            }
        }

        if (!placed) {
            clusters.push({
                clusterId:    `cl-${clusters.length + 1}`,
                representative: fp,
                _fpSet:       fpSet,
                fingerprints: new Set([fp]),
                members:      [exec.id ?? fp],
                outcomes:     { [exec.outcome]: 1 },
            });
        }
    }

    return clusters.map(c => ({
        clusterId:    c.clusterId,
        representative: c.representative,
        size:         c.members.length,
        fingerprints: [...c.fingerprints],
        outcomes:     c.outcomes,
    }));
}

function _jaccardSets(a, b) {
    let intersection = 0;
    for (const v of a) if (b.has(v)) intersection++;
    const union = a.size + b.size - intersection;
    return union === 0 ? 1 : intersection / union;
}

// ── getHotWorkflows ───────────────────────────────────────────────────

function getHotWorkflows(topN = 5) {
    const counts = {};
    for (const e of _executions) {
        counts[e.type] = (counts[e.type] ?? 0) + 1;
    }
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([type, count]) => ({
            type,
            count,
            frequency: +( count / Math.max(1, _executions.length) ).toFixed(3),
        }));
}

// ── getPatternStats ───────────────────────────────────────────────────

function getPatternStats() {
    const total     = _executions.length;
    const failures  = _executions.filter(e => e.outcome === "failure").length;
    const successes = _executions.filter(e => e.outcome === "success").length;
    return {
        totalExecutions:    total,
        uniqueFingerprints: _fingerprints.size,
        failureRate:        total > 0 ? +(failures / total).toFixed(3) : 0,
        successRate:        total > 0 ? +(successes / total).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _executions   = [];
    _fingerprints = new Map();
    _typeSeqs     = [];
    _counter      = 0;
}

module.exports = {
    MIN_PATTERN_OCCURRENCES, CLUSTER_SIMILARITY,
    recordExecution, detectPatterns, getRecurringFailures,
    clusterFingerprints, getHotWorkflows, getPatternStats, reset,
};
