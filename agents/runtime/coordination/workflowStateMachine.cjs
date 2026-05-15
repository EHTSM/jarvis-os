"use strict";
/**
 * workflowStateMachine — formal workflow state machine with strict transition
 * validation, lifecycle enforcement, and recovery state management.
 *
 * States: created → scheduled → admitted → running → completed
 *                                                   → failed → recovering → stabilized
 *                                                   → blocked
 *                                                   → quarantined
 *                                                   → cancelled
 *
 * createWorkflowState(spec)              → { created, wfId, workflowId, state }
 * transitionState(wfId, toState, reason) → { transitioned, wfId, from, to }
 * validateTransition(wfId, toState)      → { valid, from, to, allowed }
 * getWorkflowState(wfId)                 → WorkflowState | null
 * getTransitionHistory(wfId)             → { found, wfId, currentState, history }
 * reset()
 */

const WORKFLOW_STATES = [
    "created",
    "scheduled",
    "admitted",
    "running",
    "blocked",
    "recovering",
    "stabilized",
    "completed",
    "failed",
    "quarantined",
    "cancelled",
];

const VALID_TRANSITIONS = {
    created:     ["scheduled", "cancelled"],
    scheduled:   ["admitted", "cancelled", "blocked"],
    admitted:    ["running", "cancelled"],
    running:     ["completed", "failed", "blocked", "recovering"],
    blocked:     ["scheduled", "running", "failed", "cancelled"],
    recovering:  ["stabilized", "failed", "quarantined"],
    stabilized:  ["running", "completed"],
    completed:   [],
    failed:      ["recovering", "quarantined", "cancelled"],
    quarantined: ["recovering"],
    cancelled:   [],
};

const TERMINAL_STATES = new Set(["completed", "cancelled"]);

let _workflows = new Map();
let _counter   = 0;

// ── createWorkflowState ───────────────────────────────────────────────

function createWorkflowState(spec = {}) {
    const { workflowId = null, metadata = {} } = spec;
    if (!workflowId) return { created: false, reason: "workflowId_required" };

    const wfId   = `wf-${++_counter}`;
    const now    = new Date().toISOString();
    _workflows.set(wfId, {
        wfId,
        workflowId,
        state:             "created",
        transitionHistory: [],
        metadata:          { ...metadata },
        createdAt:         now,
        updatedAt:         now,
    });
    return { created: true, wfId, workflowId, state: "created" };
}

// ── validateTransition ────────────────────────────────────────────────

function validateTransition(wfId, toState) {
    const record = _workflows.get(wfId);
    if (!record)                          return { valid: false, reason: "workflow_not_found" };
    if (!WORKFLOW_STATES.includes(toState))
        return { valid: false, reason: `invalid_state: ${toState}` };

    const allowed = VALID_TRANSITIONS[record.state] ?? [];
    if (!allowed.includes(toState)) {
        return { valid: false, reason: "invalid_transition", from: record.state, to: toState, allowed };
    }
    return { valid: true, from: record.state, to: toState };
}

// ── transitionState ───────────────────────────────────────────────────

function transitionState(wfId, toState, reason = null) {
    const record = _workflows.get(wfId);
    if (!record) return { transitioned: false, reason: "workflow_not_found" };

    const validation = validateTransition(wfId, toState);
    if (!validation.valid) return { transitioned: false, ...validation };

    const from    = record.state;
    const now     = new Date().toISOString();
    record.state  = toState;
    record.updatedAt = now;
    record.transitionHistory.push({ from, to: toState, reason: reason ?? null, ts: now });

    return { transitioned: true, wfId, from, to: toState };
}

// ── getWorkflowState ──────────────────────────────────────────────────

function getWorkflowState(wfId) {
    const record = _workflows.get(wfId);
    if (!record) return null;
    return {
        wfId:       record.wfId,
        workflowId: record.workflowId,
        state:      record.state,
        metadata:   { ...record.metadata },
        createdAt:  record.createdAt,
        updatedAt:  record.updatedAt,
        isTerminal: TERMINAL_STATES.has(record.state),
    };
}

// ── getTransitionHistory ──────────────────────────────────────────────

function getTransitionHistory(wfId) {
    const record = _workflows.get(wfId);
    if (!record) return { found: false };
    return {
        found:        true,
        wfId,
        currentState: record.state,
        history:      [...record.transitionHistory],
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _workflows = new Map();
    _counter   = 0;
}

module.exports = {
    WORKFLOW_STATES, VALID_TRANSITIONS, TERMINAL_STATES,
    createWorkflowState, transitionState, validateTransition,
    getWorkflowState, getTransitionHistory, reset,
};
