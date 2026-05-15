"use strict";
/**
 * pressureStateMachine — execution pressure state machine with metric-driven transitions.
 *
 * States:  normal → elevated → degraded → critical → recovery
 *
 * getState()                           → current state string
 * evaluate(metrics)                    → EvaluationResult (recommended state)
 * transition(metrics)                  → TransitionResult
 * applyStateActions(state)             → ActionSet
 * forceTransition(targetState, reason) → TransitionResult
 * getHistory()                         → TransitionRecord[]
 * reset()
 */

const STATES = ["normal", "elevated", "degraded", "critical", "recovery"];

const TRANSITION_RULES = {
    normal: {
        elevated:  m => m.errorRate > 0.10 || m.retryRate > 0.30,
        degraded:  m => m.errorRate > 0.25 || (m.health != null && m.health < 0.7),
        critical:  m => m.errorRate > 0.40 || (m.health != null && m.health < 0.4),
    },
    elevated: {
        normal:    m => m.errorRate <= 0.05 && (m.health == null || m.health >= 0.85),
        degraded:  m => m.errorRate > 0.20 || m.retryRate > 0.50,
        critical:  m => m.errorRate > 0.40 || (m.health != null && m.health < 0.4),
    },
    degraded: {
        elevated:  m => m.errorRate <= 0.10 && (m.health == null || m.health >= 0.65),
        normal:    m => m.errorRate <= 0.05 && (m.health == null || m.health >= 0.85),
        critical:  m => m.errorRate > 0.40 || (m.health != null && m.health < 0.4),
    },
    critical: {
        recovery:  () => true,   // critical always moves to recovery when transition() is called
    },
    recovery: {
        normal:    m => m.errorRate <= 0.05 && (m.health == null || m.health >= 0.80),
        elevated:  m => m.errorRate > 0.05  && m.errorRate <= 0.15,
    },
};

const STATE_ACTIONS = {
    normal:   { concurrencyLimit: null,  strategy: "fast",           verificationLevel: "standard", shedLoad: false },
    elevated: { concurrencyLimit: 8,     strategy: "safe",           verificationLevel: "elevated", shedLoad: false },
    degraded: { concurrencyLimit: 4,     strategy: "staged",         verificationLevel: "high",     shedLoad: true  },
    critical: { concurrencyLimit: 1,     strategy: "recovery_first", verificationLevel: "maximum",  shedLoad: true  },
    recovery: { concurrencyLimit: 2,     strategy: "safe",           verificationLevel: "high",     shedLoad: false },
};

let _current = "normal";
let _history = [];

// ── getState ──────────────────────────────────────────────────────────

function getState() { return _current; }

// ── evaluate ──────────────────────────────────────────────────────────

function evaluate(metrics = {}) {
    const rules = TRANSITION_RULES[_current] ?? {};

    // Check transitions in severity order: critical > degraded > elevated > recovery > normal
    const priority = ["critical", "degraded", "elevated", "recovery", "normal"];
    for (const target of priority) {
        if (target === _current) continue;
        const check = rules[target];
        if (check && check(metrics)) {
            return { recommended: target, from: _current, willTransition: target !== _current };
        }
    }
    return { recommended: _current, from: _current, willTransition: false };
}

// ── transition ────────────────────────────────────────────────────────

function transition(metrics = {}) {
    const { recommended, willTransition } = evaluate(metrics);

    if (!willTransition) {
        return { transitioned: false, state: _current, reason: "no_transition_condition_met" };
    }

    const from = _current;
    _current   = recommended;

    const record = { from, to: _current, metrics: { ...metrics }, ts: new Date().toISOString() };
    _history.push(record);

    return { transitioned: true, from, to: _current, actions: STATE_ACTIONS[_current] };
}

// ── applyStateActions ─────────────────────────────────────────────────

function applyStateActions(state) {
    const actions = STATE_ACTIONS[state];
    if (!actions) return { applied: false, reason: "unknown_state" };
    return { applied: true, state, ...actions };
}

// ── forceTransition ───────────────────────────────────────────────────

function forceTransition(targetState, reason = "forced") {
    if (!STATES.includes(targetState)) return { transitioned: false, reason: "invalid_state" };
    const from = _current;
    _current   = targetState;
    const record = { from, to: _current, reason, forced: true, ts: new Date().toISOString() };
    _history.push(record);
    return { transitioned: true, from, to: _current, forced: true };
}

// ── getHistory / reset ────────────────────────────────────────────────

function getHistory() { return [..._history]; }

function reset() {
    _current = "normal";
    _history = [];
}

module.exports = {
    STATES, TRANSITION_RULES, STATE_ACTIONS,
    getState, evaluate, transition, applyStateActions, forceTransition, getHistory, reset,
};
