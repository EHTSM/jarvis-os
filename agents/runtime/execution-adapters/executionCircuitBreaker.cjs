"use strict";
/**
 * executionCircuitBreaker — rolling-window circuit breaker for execution adapters.
 *
 * recordOutcome(spec)          → { recorded, adapterType, breakerState }
 * isAllowed(spec)              → { allowed, breakerState, reason }
 * resetBreaker(spec)           → { reset, adapterType }
 * configureBreaker(spec)       → { configured, adapterType }
 * getBreakerState(adapterType) → BreakerState | { found: false }
 * getBreakerMetrics()          → BreakerMetrics
 * reset()
 *
 * States: closed → open → half_open → closed (or back to open)
 *   closed    — normal operation, recording outcomes in rolling window
 *   open      — all executions blocked; waits for cooldown before → half_open
 *   half_open — probe mode; successes → closed, any failure → open
 *
 * Accept `timestamp` param on recordOutcome / isAllowed for deterministic testing.
 */

const BREAKER_STATES = { CLOSED: "closed", OPEN: "open", HALF_OPEN: "half_open" };

const DEFAULT_CONFIG = {
    failureThreshold:  5,      // failures in window to trip breaker
    successThreshold:  2,      // successes in half_open to close
    windowSize:        10,     // rolling window size for failure tracking
    cooldownMs:        30000,  // ms in OPEN before → HALF_OPEN
};

let _breakers = new Map();   // adapterType → BreakerRecord
let _counter  = 0;

function _ensureBreaker(adapterType) {
    if (!_breakers.has(adapterType)) {
        _breakers.set(adapterType, {
            adapterType,
            state:          BREAKER_STATES.CLOSED,
            config:         { ...DEFAULT_CONFIG },
            window:         [],        // rolling outcome window
            halfOpenSuccesses: 0,
            openedAt:       null,
            lastTransition: new Date().toISOString(),
        });
    }
    return _breakers.get(adapterType);
}

function _transition(breaker, newState, timestamp) {
    breaker.state          = newState;
    breaker.lastTransition = new Date(timestamp).toISOString();
    if (newState === BREAKER_STATES.OPEN) {
        breaker.openedAt        = timestamp;
        breaker.halfOpenSuccesses = 0;
    }
    if (newState === BREAKER_STATES.CLOSED) {
        breaker.window          = [];
        breaker.halfOpenSuccesses = 0;
        breaker.openedAt        = null;
    }
    if (newState === BREAKER_STATES.HALF_OPEN) {
        breaker.halfOpenSuccesses = 0;
    }
}

// ── recordOutcome ─────────────────────────────────────────────────────

function recordOutcome(spec = {}) {
    const {
        adapterType = null,
        outcome     = null,    // "ok" | "error" | "timeout" | "rejected"
        timestamp   = Date.now(),
    } = spec;

    if (!adapterType) return { recorded: false, reason: "adapterType_required" };
    if (!outcome)     return { recorded: false, reason: "outcome_required" };

    const breaker   = _ensureBreaker(adapterType);
    const isFailure = outcome !== "ok";
    const recordId  = `cb-${++_counter}`;

    if (breaker.state === BREAKER_STATES.CLOSED) {
        // Push to rolling window
        breaker.window.push(isFailure ? "error" : "ok");
        if (breaker.window.length > breaker.config.windowSize)
            breaker.window.shift();

        const failures = breaker.window.filter(o => o === "error").length;
        if (failures >= breaker.config.failureThreshold)
            _transition(breaker, BREAKER_STATES.OPEN, timestamp);

    } else if (breaker.state === BREAKER_STATES.HALF_OPEN) {
        if (isFailure) {
            _transition(breaker, BREAKER_STATES.OPEN, timestamp);
        } else {
            breaker.halfOpenSuccesses++;
            if (breaker.halfOpenSuccesses >= breaker.config.successThreshold)
                _transition(breaker, BREAKER_STATES.CLOSED, timestamp);
        }
    }
    // OPEN: don't record outcomes in window (blocked)

    return { recorded: true, recordId, adapterType, outcome, breakerState: breaker.state };
}

// ── isAllowed ─────────────────────────────────────────────────────────

function isAllowed(spec = {}) {
    const { adapterType = null, timestamp = Date.now() } = spec;
    if (!adapterType) return { allowed: false, reason: "adapterType_required" };

    const breaker = _ensureBreaker(adapterType);

    if (breaker.state === BREAKER_STATES.CLOSED)
        return { allowed: true, breakerState: BREAKER_STATES.CLOSED };

    if (breaker.state === BREAKER_STATES.OPEN) {
        const elapsed = timestamp - (breaker.openedAt ?? 0);
        if (elapsed >= breaker.config.cooldownMs) {
            _transition(breaker, BREAKER_STATES.HALF_OPEN, timestamp);
            return { allowed: true, breakerState: BREAKER_STATES.HALF_OPEN, reason: "probe_allowed" };
        }
        const remaining = breaker.config.cooldownMs - elapsed;
        return {
            allowed: false, breakerState: BREAKER_STATES.OPEN,
            reason: "circuit_open", cooldownRemainingMs: remaining,
        };
    }

    // HALF_OPEN: allow probe executions
    if (breaker.state === BREAKER_STATES.HALF_OPEN)
        return { allowed: true, breakerState: BREAKER_STATES.HALF_OPEN, reason: "half_open_probe" };

    return { allowed: false, reason: "unknown_breaker_state" };
}

// ── resetBreaker ──────────────────────────────────────────────────────

function resetBreaker(spec = {}) {
    const { adapterType = null } = spec;
    if (!adapterType) return { reset: false, reason: "adapterType_required" };

    const breaker = _ensureBreaker(adapterType);
    _transition(breaker, BREAKER_STATES.CLOSED, Date.now());
    return { reset: true, adapterType, breakerState: BREAKER_STATES.CLOSED };
}

// ── configureBreaker ──────────────────────────────────────────────────

function configureBreaker(spec = {}) {
    const {
        adapterType       = null,
        failureThreshold  = null,
        successThreshold  = null,
        windowSize        = null,
        cooldownMs        = null,
    } = spec;

    if (!adapterType) return { configured: false, reason: "adapterType_required" };

    const breaker = _ensureBreaker(adapterType);
    if (failureThreshold !== null && failureThreshold > 0)
        breaker.config.failureThreshold = failureThreshold;
    if (successThreshold !== null && successThreshold > 0)
        breaker.config.successThreshold = successThreshold;
    if (windowSize !== null && windowSize > 0)
        breaker.config.windowSize = windowSize;
    if (cooldownMs !== null && cooldownMs >= 0)
        breaker.config.cooldownMs = cooldownMs;

    return { configured: true, adapterType, config: { ...breaker.config } };
}

// ── getBreakerState ───────────────────────────────────────────────────

function getBreakerState(adapterType) {
    if (!adapterType) return { found: false, reason: "adapterType_required" };
    const breaker = _breakers.get(adapterType);
    if (!breaker) return { found: false, adapterType };

    const failures = breaker.window.filter(o => o === "error").length;
    return {
        found: true, adapterType,
        state:            breaker.state,
        windowFailures:   failures,
        windowSize:       breaker.window.length,
        halfOpenSuccesses: breaker.halfOpenSuccesses,
        openedAt:         breaker.openedAt,
        config:           { ...breaker.config },
    };
}

// ── getBreakerMetrics ─────────────────────────────────────────────────

function getBreakerMetrics() {
    const all = [..._breakers.values()];
    const byState = { closed: 0, open: 0, half_open: 0 };
    for (const b of all) byState[b.state] = (byState[b.state] ?? 0) + 1;

    return {
        totalBreakers: all.length,
        byState,
        openBreakers:     byState.open,
        halfOpenBreakers: byState.half_open,
        closedBreakers:   byState.closed,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _breakers = new Map();
    _counter  = 0;
}

module.exports = {
    BREAKER_STATES, DEFAULT_CONFIG,
    recordOutcome, isAllowed, resetBreaker, configureBreaker,
    getBreakerState, getBreakerMetrics, reset,
};
