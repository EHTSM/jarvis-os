"use strict";
/**
 * observabilityTimeline — builds chronological timelines from execution history.
 *
 * buildAll(entries, telemetryLog) → TimelineReport
 */

// ── individual builders ───────────────────────────────────────────────

function buildExecutionHistory(entries = []) {
    return [...entries]
        .sort(_byTs)
        .map(e => ({
            ts:          e.ts,
            executionId: e.executionId ?? null,
            fingerprint: e.fingerprint ?? null,
            success:     e.success,
            strategy:    e.strategy ?? null,
            durationMs:  e.durationMs ?? 0,
            state:       e.state ?? (e.success ? "completed" : "failed"),
        }));
}

function buildRetryTimeline(entries = []) {
    return [...entries]
        .filter(e => (e.retryCount ?? 0) > 0)
        .sort(_byTs)
        .map(e => ({
            ts:          e.ts,
            fingerprint: e.fingerprint ?? null,
            executionId: e.executionId ?? null,
            retryCount:  e.retryCount,
            success:     e.success,
        }));
}

function buildRollbackTimeline(entries = []) {
    return [...entries]
        .filter(e => e.rollbackTriggered)
        .sort(_byTs)
        .map(e => ({
            ts:          e.ts,
            fingerprint: e.fingerprint ?? null,
            executionId: e.executionId ?? null,
            strategy:    e.strategy ?? null,
            success:     e.success,
        }));
}

function buildStrategyTimeline(entries = []) {
    const sorted   = [...entries].sort(_byTs);
    const timeline = [];
    let prev = null;
    for (const e of sorted) {
        const strat = e.strategy ?? null;
        if (strat !== prev) {
            timeline.push({
                ts:          e.ts,
                fingerprint: e.fingerprint ?? null,
                from:        prev,
                to:          strat,
            });
            prev = strat;
        }
    }
    return timeline;
}

function buildTelemetryTimeline(telemetryLog = []) {
    return [...telemetryLog]
        .sort(_byTs)
        .map(e => ({
            ts:    e.ts,
            event: e.event,
            ...Object.fromEntries(
                Object.entries(e).filter(([k]) => k !== "ts" && k !== "event")
            ),
        }));
}

// ── buildAll ──────────────────────────────────────────────────────────

function buildAll(entries = [], telemetryLog = []) {
    return {
        executionHistory:  buildExecutionHistory(entries),
        retryTimeline:     buildRetryTimeline(entries),
        rollbackTimeline:  buildRollbackTimeline(entries),
        strategyTimeline:  buildStrategyTimeline(entries),
        telemetryTimeline: buildTelemetryTimeline(telemetryLog),
        generatedAt:       new Date().toISOString(),
        entryCount:        entries.length,
        telemetryCount:    telemetryLog.length,
    };
}

// ── helpers ───────────────────────────────────────────────────────────

function _byTs(a, b) {
    return new Date(a.ts).getTime() - new Date(b.ts).getTime();
}

module.exports = {
    buildExecutionHistory, buildRetryTimeline, buildRollbackTimeline,
    buildStrategyTimeline, buildTelemetryTimeline, buildAll,
};
