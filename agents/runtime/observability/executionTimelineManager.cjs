"use strict";
/**
 * executionTimelineManager — per-execution timeline reconstruction from
 * ordered state transitions. Detects bottleneck stages, computes stage
 * durations, and supports replay visualization.
 *
 * recordTransition(spec)         → { recorded, timelineId, stage, durationMs }
 * getTimeline(executionId)       → Timeline | null
 * getStageBreakdown(executionId) → StageBreakdown | null
 * detectBottleneck(executionId)  → { bottleneckStage, durationMs } | null
 * getTimelinesForWorkflow(workflowId) → Timeline[]
 * getTimelineMetrics()           → TimelineMetrics
 * reset()
 */

const VISIBILITY_STATES = [
    "queued", "validated", "authorized", "sandboxed",
    "executing", "waiting", "retrying", "recovering",
    "completed", "failed", "quarantined", "cancelled", "replayed",
];

const TERMINAL_STATES = new Set(["completed", "failed", "quarantined", "cancelled", "replayed"]);

let _timelines = new Map();   // executionId → Timeline
let _counter   = 0;

// ── recordTransition ──────────────────────────────────────────────────

function recordTransition(spec = {}) {
    const {
        executionId = null,
        workflowId  = null,
        stage       = null,
        timestamp   = new Date().toISOString(),
        meta        = null,
    } = spec;

    if (!executionId) return { recorded: false, reason: "executionId_required" };
    if (!stage)       return { recorded: false, reason: "stage_required" };
    if (!VISIBILITY_STATES.includes(stage))
        return { recorded: false, reason: `invalid_stage: ${stage}` };

    let timeline = _timelines.get(executionId);
    if (!timeline) {
        timeline = {
            timelineId:  `tl-${++_counter}`,
            executionId,
            workflowId:  workflowId ?? null,
            stages:      [],
            startedAt:   timestamp,
            completedAt: null,
            terminalState: null,
        };
        _timelines.set(executionId, timeline);
    }

    const prev         = timeline.stages[timeline.stages.length - 1] ?? null;
    const durationMs   = prev ? new Date(timestamp) - new Date(prev.timestamp) : 0;

    timeline.stages.push(Object.freeze({ stage, timestamp, durationMs, meta: meta ?? null }));

    if (TERMINAL_STATES.has(stage)) {
        timeline.completedAt   = timestamp;
        timeline.terminalState = stage;
    }

    return { recorded: true, timelineId: timeline.timelineId, executionId, stage, durationMs };
}

// ── getTimeline ────────────────────────────────────────────────────────

function getTimeline(executionId) {
    if (!executionId) return null;
    return _timelines.get(executionId) ?? null;
}

// ── getStageBreakdown ──────────────────────────────────────────────────

function getStageBreakdown(executionId) {
    const tl = _timelines.get(executionId);
    if (!tl) return null;

    const breakdown = {};
    for (const s of tl.stages) {
        breakdown[s.stage] = { durationMs: s.durationMs, timestamp: s.timestamp };
    }
    const totalMs = tl.stages.reduce((sum, s) => sum + s.durationMs, 0);
    return { executionId, breakdown, totalMs, stageCount: tl.stages.length };
}

// ── detectBottleneck ───────────────────────────────────────────────────

function detectBottleneck(executionId) {
    const tl = _timelines.get(executionId);
    if (!tl || tl.stages.length < 2) return null;

    let bottleneck = tl.stages[0];
    for (const s of tl.stages) {
        if (s.durationMs > bottleneck.durationMs) bottleneck = s;
    }
    return { executionId, bottleneckStage: bottleneck.stage, durationMs: bottleneck.durationMs };
}

// ── getTimelinesForWorkflow ────────────────────────────────────────────

function getTimelinesForWorkflow(workflowId) {
    if (!workflowId) return [];
    return [..._timelines.values()].filter(tl => tl.workflowId === workflowId);
}

// ── getTimelineMetrics ─────────────────────────────────────────────────

function getTimelineMetrics() {
    const all         = [..._timelines.values()];
    const completed   = all.filter(tl => tl.terminalState === "completed");
    const failed      = all.filter(tl => tl.terminalState === "failed");
    const quarantined = all.filter(tl => tl.terminalState === "quarantined");

    const durations = completed
        .filter(tl => tl.startedAt && tl.completedAt)
        .map(tl => new Date(tl.completedAt) - new Date(tl.startedAt));

    const avgLatencyMs = durations.length
        ? Math.round(durations.reduce((s, v) => s + v, 0) / durations.length)
        : 0;
    const maxLatencyMs = durations.length ? Math.max(...durations) : 0;

    return {
        totalTimelines:    all.length,
        completedCount:    completed.length,
        failedCount:       failed.length,
        quarantinedCount:  quarantined.length,
        avgLatencyMs,
        maxLatencyMs,
    };
}

// ── reset ──────────────────────────────────────────────────────────────

function reset() {
    _timelines = new Map();
    _counter   = 0;
}

module.exports = {
    VISIBILITY_STATES, TERMINAL_STATES,
    recordTransition, getTimeline, getStageBreakdown,
    detectBottleneck, getTimelinesForWorkflow, getTimelineMetrics, reset,
};
