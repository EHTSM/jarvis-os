"use strict";
/**
 * executionStateMachine — per-execution lifecycle state machine.
 *
 * STATES: pending, preparing, executing, checkpointing, blocked, failed, rolled_back, completed, cancelled
 *
 * create(executionId)
 * transition(executionId, event)   → nextState (throws on invalid transition)
 * getState(executionId)            → current state string
 * getHistory(executionId)          → [{from, event, to, ts}]
 * isTerminal(state)                → boolean
 * reset()
 */

const STATES = {
    PENDING:       "pending",
    PREPARING:     "preparing",
    EXECUTING:     "executing",
    CHECKPOINTING: "checkpointing",
    BLOCKED:       "blocked",
    FAILED:        "failed",
    ROLLED_BACK:   "rolled_back",
    COMPLETED:     "completed",
    CANCELLED:     "cancelled",
};

const TERMINAL = new Set(["blocked", "failed", "rolled_back", "completed", "cancelled"]);

// event → nextState per current state
const TRANSITIONS = {
    pending:       { prepare: "preparing",  cancel: "cancelled" },
    preparing:     { execute: "executing",  block:  "blocked",   cancel: "cancelled" },
    executing:     { checkpoint: "checkpointing", complete: "completed", fail: "failed", cancel: "cancelled" },
    checkpointing: { execute: "executing",  fail: "failed",      cancel: "cancelled" },
    blocked:       {},
    failed:        { rollback: "rolled_back" },
    rolled_back:   { complete: "completed" },
    completed:     {},
    cancelled:     {},
};

// executionId → { state, history[] }
const _machines = new Map();

function create(executionId) {
    _machines.set(executionId, { state: "pending", history: [] });
}

function transition(executionId, event) {
    const m = _machines.get(executionId);
    if (!m) throw new Error(`No state machine for execution: ${executionId}`);
    const next = TRANSITIONS[m.state]?.[event];
    if (!next) throw new Error(`Invalid transition: ${m.state} --[${event}]-- (no valid state)`);
    m.history.push({ from: m.state, event, to: next, ts: new Date().toISOString() });
    m.state = next;
    return next;
}

function getState(executionId)   { return _machines.get(executionId)?.state ?? null; }
function getHistory(executionId) { return [...(_machines.get(executionId)?.history ?? [])]; }
function isTerminal(state)       { return TERMINAL.has(state); }
function reset()                 { _machines.clear(); }

module.exports = { create, transition, getState, getHistory, isTerminal, reset, STATES, TRANSITIONS };
