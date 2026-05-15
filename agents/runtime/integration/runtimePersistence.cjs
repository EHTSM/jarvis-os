"use strict";
/**
 * runtimePersistence — in-memory checkpoints, recovery snapshots, execution history.
 *
 * checkpoint(state)                       → CheckpointRecord
 * restoreFromCheckpoint(checkpointId)     → RuntimeState | null
 * listCheckpoints()                       → CheckpointRecord[]
 * pruneCheckpoints(keepLatest)            → number pruned
 * saveRecoverySnapshot(incident, result)  → SnapshotRecord
 * getRecoverySnapshots(filter)            → SnapshotRecord[]
 * appendExecutionHistory(execution)       → void
 * getExecutionHistory(filter)             → HistoryEntry[]
 * getPersistenceStats()                   → Stats
 * reset()
 */

const MAX_CHECKPOINTS  = 50;
const MAX_SNAPSHOTS    = 200;
const MAX_HISTORY      = 2000;

let _checkpoints = [];
let _snapshots   = [];
let _history     = [];
let _counter     = 0;

// ── checkpoint ────────────────────────────────────────────────────────

function checkpoint(state = {}) {
    const checkpointId = `ckpt-${++_counter}`;
    const record = {
        checkpointId,
        mode:               state.mode               ?? "normal",
        activeWorkflows:    state.activeWorkflows     ?? 0,
        degradedComponents: state.degradedComponents ?? 0,
        activeContainments: state.activeContainments ?? 0,
        activeRecoveryTrees: state.activeRecoveryTrees ?? 0,
        arbitrationPending: state.arbitrationPending ?? 0,
        componentStates:    state.componentStates    ?? {},
        // Compact workflow list: only ids and states
        workflowSummary:    (state.activeWorkflowList ?? []).map(w => ({
            workflowId: w.workflowId,
            type:       w.type,
            state:      w.state,
        })),
        ts: new Date().toISOString(),
    };

    _checkpoints.push(record);
    if (_checkpoints.length > MAX_CHECKPOINTS) _checkpoints.shift();

    return { checkpointId, ts: record.ts, size: _checkpoints.length };
}

// ── restoreFromCheckpoint ─────────────────────────────────────────────

function restoreFromCheckpoint(checkpointId) {
    const record = _checkpoints.find(c => c.checkpointId === checkpointId);
    if (!record) return null;
    // Return a copy of the stored state (immutable restore)
    return JSON.parse(JSON.stringify(record));
}

// ── listCheckpoints ───────────────────────────────────────────────────

function listCheckpoints() {
    return _checkpoints.map(c => ({
        checkpointId:       c.checkpointId,
        mode:               c.mode,
        activeWorkflows:    c.activeWorkflows,
        degradedComponents: c.degradedComponents,
        ts:                 c.ts,
    }));
}

// ── pruneCheckpoints ──────────────────────────────────────────────────

function pruneCheckpoints(keepLatest = 10) {
    const before = _checkpoints.length;
    if (_checkpoints.length > keepLatest) {
        _checkpoints = _checkpoints.slice(-keepLatest);
    }
    return before - _checkpoints.length;
}

// ── saveRecoverySnapshot ──────────────────────────────────────────────

function saveRecoverySnapshot(incident = {}, result = {}) {
    const snapshotId = `snap-${++_counter}`;
    const record = {
        snapshotId,
        incidentType:    incident.type        ?? "unknown",
        incidentId:      incident.incidentId  ?? null,
        errorType:       incident.errorType   ?? null,
        strategyUsed:    result.strategy      ?? null,
        outcome:         result.outcome       ?? "unknown",  // resolved | escalated | failed
        recoverySteps:   result.recoverySteps ?? [],
        durationMs:      result.durationMs    ?? null,
        lessonLearned:   result.lessonLearned ?? null,
        ts:              new Date().toISOString(),
    };

    _snapshots.push(record);
    if (_snapshots.length > MAX_SNAPSHOTS) _snapshots.shift();

    return { snapshotId, ts: record.ts };
}

// ── getRecoverySnapshots ──────────────────────────────────────────────

function getRecoverySnapshots(filter = {}) {
    let results = [..._snapshots];
    if (filter.incidentType) results = results.filter(s => s.incidentType === filter.incidentType);
    if (filter.outcome)      results = results.filter(s => s.outcome === filter.outcome);
    if (filter.since)        results = results.filter(s => s.ts >= filter.since);
    return results;
}

// ── appendExecutionHistory ────────────────────────────────────────────

function appendExecutionHistory(execution = {}) {
    _history.push({
        execId:       execution.execId       ?? `exec-${++_counter}`,
        workflowId:   execution.workflowId   ?? null,
        type:         execution.type         ?? "generic",
        state:        execution.state        ?? "unknown",
        strategy:     execution.strategy     ?? null,
        componentId:  execution.componentId  ?? null,
        retryCount:   execution.retryCount   ?? 0,
        reroutes:     execution.reroutes     ?? 0,
        durationMs:   execution.completedAt && execution.startedAt
            ? new Date(execution.completedAt) - new Date(execution.startedAt)
            : null,
        ts: execution.completedAt ?? new Date().toISOString(),
    });
    if (_history.length > MAX_HISTORY) _history.shift();
}

// ── getExecutionHistory ───────────────────────────────────────────────

function getExecutionHistory(filter = {}) {
    let results = [..._history];
    if (filter.type)     results = results.filter(h => h.type  === filter.type);
    if (filter.state)    results = results.filter(h => h.state === filter.state);
    if (filter.since)    results = results.filter(h => h.ts    >= filter.since);
    if (filter.limit)    results = results.slice(-filter.limit);
    return results;
}

// ── getPersistenceStats ───────────────────────────────────────────────

function getPersistenceStats() {
    const completed = _history.filter(h => h.state === "completed").length;
    const failed    = _history.filter(h => h.state === "failed").length;
    return {
        checkpoints:   _checkpoints.length,
        snapshots:     _snapshots.length,
        historyEntries: _history.length,
        resolvedIncidents: _snapshots.filter(s => s.outcome === "resolved").length,
        successRate:   _history.length > 0 ? +(completed / _history.length).toFixed(3) : 0,
        failureRate:   _history.length > 0 ? +(failed    / _history.length).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _checkpoints = [];
    _snapshots   = [];
    _history     = [];
    _counter     = 0;
}

module.exports = {
    MAX_CHECKPOINTS, MAX_SNAPSHOTS, MAX_HISTORY,
    checkpoint, restoreFromCheckpoint, listCheckpoints, pruneCheckpoints,
    saveRecoverySnapshot, getRecoverySnapshots,
    appendExecutionHistory, getExecutionHistory,
    getPersistenceStats, reset,
};
