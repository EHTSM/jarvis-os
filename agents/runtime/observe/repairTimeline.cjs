"use strict";
/**
 * repairTimeline — timeline of repair decisions per workflow.
 *
 * record(workflowId, stepName, attempt, strategy, success, durationMs?)
 *   — record one repair decision event
 *
 * getTimeline(workflowId)   → sorted timeline entries
 * getSummary(workflowId)    → { total, succeeded, failed, successRate, strategies{} }
 * getAllWorkflows()          → list of workflowIds with repair events
 * reset()
 */

// workflowId → event[]
const _timelines = new Map();
let   _seq       = 0;

function record(workflowId, stepName, attempt, strategy, success, durationMs = 0) {
    if (!_timelines.has(workflowId)) _timelines.set(workflowId, []);
    const event = {
        seq:        ++_seq,
        ts:         new Date().toISOString(),
        workflowId,
        stepName,
        attempt,
        strategy,
        success:    !!success,
        durationMs,
    };
    _timelines.get(workflowId).push(event);
    return event;
}

function getTimeline(workflowId) {
    return (_timelines.get(workflowId) || []).slice().sort((a, b) => a.seq - b.seq);
}

function getSummary(workflowId) {
    const events = getTimeline(workflowId);
    if (events.length === 0) return null;

    const succeeded = events.filter(e => e.success).length;
    const failed    = events.length - succeeded;

    const strategies = {};
    for (const e of events) {
        if (!strategies[e.strategy]) strategies[e.strategy] = { attempts: 0, successes: 0 };
        strategies[e.strategy].attempts++;
        if (e.success) strategies[e.strategy].successes++;
    }
    for (const s of Object.values(strategies)) {
        s.successRate = s.attempts > 0
            ? parseFloat((s.successes / s.attempts).toFixed(3))
            : 0;
    }

    return {
        workflowId,
        total:       events.length,
        succeeded,
        failed,
        successRate: parseFloat((succeeded / events.length).toFixed(3)),
        strategies,
    };
}

function getAllWorkflows() {
    return [..._timelines.keys()];
}

function reset() { _timelines.clear(); _seq = 0; }

module.exports = { record, getTimeline, getSummary, getAllWorkflows, reset };
