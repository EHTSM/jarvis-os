"use strict";
/**
 * replayLog — structured execution event recorder for replay and audit.
 *
 * record(workflowId, eventType, data)  → event entry
 * getReplay(workflowId)                → sorted event array
 * exportReplay(workflowId)             → human-readable string
 * getAllWorkflows()                     → list of workflow IDs with events
 * reset()                              — clear all recorded events
 */

const EVENT_TYPES = [
    "workflow_start",  "workflow_end",
    "step_start",      "step_end",      "step_failed",
    "recovery_start",  "recovery_end",
    "approval_requested", "approval_granted", "approval_denied",
    "anomaly_detected",   "quarantine_triggered",
    "chaos_injected",     "checkpoint_written",
];

// workflowId → event[]
const _logs = new Map();
let   _seq  = 0;

function record(workflowId, eventType, data = {}) {
    if (!_logs.has(workflowId)) _logs.set(workflowId, []);
    const event = {
        seq:        ++_seq,
        ts:         new Date().toISOString(),
        workflowId,
        eventType,
        data,
    };
    _logs.get(workflowId).push(event);
    return event;
}

function getReplay(workflowId) {
    return (_logs.get(workflowId) || []).slice().sort((a, b) => a.seq - b.seq);
}

function exportReplay(workflowId) {
    const events = getReplay(workflowId);
    if (events.length === 0) return `[no events recorded for: ${workflowId}]`;
    return events.map(e => {
        const ts   = e.ts.slice(11, 23);  // HH:MM:SS.mmm
        const data = Object.keys(e.data).length > 0
            ? ` | ${JSON.stringify(e.data)}`
            : "";
        return `[${ts}] ${e.eventType}${data}`;
    }).join("\n");
}

function getAllWorkflows() {
    return [..._logs.keys()];
}

function reset() { _logs.clear(); _seq = 0; }

module.exports = { record, getReplay, exportReplay, getAllWorkflows, reset, EVENT_TYPES };
