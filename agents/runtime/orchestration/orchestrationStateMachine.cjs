"use strict";
/**
 * orchestrationStateMachine — formalizes runtime orchestration states.
 *
 * 12 states with typed transitions.
 */

const STATES = {
    QUEUED:             "queued",
    SCHEDULED:          "scheduled",
    RUNNING:            "running",
    STAGED:             "staged",
    SANDBOXED:          "sandboxed",
    ROLLBACK:           "rollback",
    RECOVERY:           "recovery",
    ISOLATED:           "isolated",
    THROTTLED:          "throttled",
    COMPLETED:          "completed",
    FAILED:             "failed",
    GOVERNANCE_BLOCKED: "governance_blocked",
};

const TERMINAL_STATES = new Set([
    STATES.COMPLETED, STATES.FAILED, STATES.GOVERNANCE_BLOCKED,
]);

// Valid transitions: from → Set of valid to states
const TRANSITIONS = {
    [STATES.QUEUED]:    new Set([STATES.SCHEDULED, STATES.GOVERNANCE_BLOCKED, STATES.THROTTLED]),
    [STATES.SCHEDULED]: new Set([STATES.RUNNING, STATES.THROTTLED, STATES.ISOLATED, STATES.GOVERNANCE_BLOCKED]),
    [STATES.RUNNING]:   new Set([STATES.STAGED, STATES.SANDBOXED, STATES.ROLLBACK, STATES.COMPLETED, STATES.FAILED]),
    [STATES.STAGED]:    new Set([STATES.RUNNING, STATES.ROLLBACK, STATES.COMPLETED, STATES.FAILED]),
    [STATES.SANDBOXED]: new Set([STATES.RUNNING, STATES.ROLLBACK, STATES.COMPLETED, STATES.FAILED]),
    [STATES.ROLLBACK]:  new Set([STATES.RECOVERY, STATES.FAILED]),
    [STATES.RECOVERY]:  new Set([STATES.RUNNING, STATES.COMPLETED, STATES.FAILED]),
    [STATES.ISOLATED]:  new Set([STATES.SCHEDULED, STATES.THROTTLED, STATES.FAILED]),
    [STATES.THROTTLED]: new Set([STATES.SCHEDULED, STATES.ISOLATED, STATES.QUEUED]),
    [STATES.COMPLETED]: new Set(),
    [STATES.FAILED]:    new Set(),
    [STATES.GOVERNANCE_BLOCKED]: new Set(),
};

// ── instance factory ──────────────────────────────────────────────────

function create(initialState = STATES.QUEUED) {
    if (!Object.values(STATES).includes(initialState)) {
        throw new Error(`Unknown initial state: "${initialState}"`);
    }
    let _state    = initialState;
    const _history = [{ state: initialState, ts: new Date().toISOString() }];

    function transition(to) {
        if (!Object.values(STATES).includes(to)) {
            throw new Error(`Unknown state: "${to}"`);
        }
        if (TERMINAL_STATES.has(_state)) {
            throw new Error(`Cannot transition from terminal state "${_state}"`);
        }
        if (!TRANSITIONS[_state]?.has(to)) {
            throw new Error(`Invalid transition: "${_state}" → "${to}"`);
        }
        _state = to;
        _history.push({ state: to, ts: new Date().toISOString() });
        return _state;
    }

    function canTransition(to) {
        return !TERMINAL_STATES.has(_state) && (TRANSITIONS[_state]?.has(to) ?? false);
    }

    return {
        get state()    { return _state; },
        get history()  { return [..._history]; },
        get terminal() { return TERMINAL_STATES.has(_state); },
        transition,
        canTransition,
    };
}

// ── static helpers ────────────────────────────────────────────────────

function isTerminal(state) { return TERMINAL_STATES.has(state); }

function validTransitionsFrom(state) {
    return [...(TRANSITIONS[state] ?? new Set())];
}

module.exports = { STATES, TERMINAL_STATES, TRANSITIONS, create, isTerminal, validTransitionsFrom };
