"use strict";
/**
 * circuitBreaker — per-fingerprint circuit breaker: closed / open / half_open.
 *
 * record(fingerprint, success)  → BreakerState
 * isOpen(fingerprint)           → boolean
 * getState(fingerprint)         → "closed" | "open" | "half_open"
 * tryRecover(fingerprint, nowMs?) → boolean  (moves open → half_open if cooldown passed)
 * forceClose(fingerprint)       → void
 * getAll()                      → { [fingerprint]: BreakerEntry }
 * reset(fingerprint?)
 */

const STATE = { CLOSED: "closed", OPEN: "open", HALF_OPEN: "half_open" };

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS       = 30000;
const DEFAULT_HALF_OPEN_PASSES  = 2;  // successes needed to close from half_open

let _breakers = new Map();  // fingerprint → BreakerEntry

function _get(fingerprint) {
    if (!_breakers.has(fingerprint)) {
        _breakers.set(fingerprint, {
            state:              STATE.CLOSED,
            failures:           0,
            consecutiveFails:   0,
            halfOpenSuccesses:  0,
            openedAt:           null,
            lastFailureAt:      null,
            lastSuccessAt:      null,
        });
    }
    return _breakers.get(fingerprint);
}

// ── record ────────────────────────────────────────────────────────────

function record(fingerprint, success, opts = {}) {
    const threshold   = opts.failureThreshold ?? DEFAULT_FAILURE_THRESHOLD;
    const cooldownMs  = opts.cooldownMs       ?? DEFAULT_COOLDOWN_MS;
    const halfOpenPasses = opts.halfOpenPasses ?? DEFAULT_HALF_OPEN_PASSES;
    const b = _get(fingerprint);

    if (success) {
        b.lastSuccessAt     = Date.now();
        b.consecutiveFails  = 0;
        if (b.state === STATE.HALF_OPEN) {
            b.halfOpenSuccesses++;
            if (b.halfOpenSuccesses >= halfOpenPasses) {
                b.state            = STATE.CLOSED;
                b.failures         = 0;
                b.halfOpenSuccesses = 0;
            }
        }
    } else {
        b.failures++;
        b.consecutiveFails++;
        b.lastFailureAt = Date.now();
        if (b.state === STATE.HALF_OPEN) {
            // Failed test execution — re-open
            b.state            = STATE.OPEN;
            b.openedAt         = Date.now();
            b.halfOpenSuccesses = 0;
        } else if (b.state === STATE.CLOSED && b.consecutiveFails >= threshold) {
            b.state    = STATE.OPEN;
            b.openedAt = Date.now();
        }
    }
    return { fingerprint, state: b.state };
}

// ── isOpen ────────────────────────────────────────────────────────────

function isOpen(fingerprint) {
    const b = _get(fingerprint);
    return b.state === STATE.OPEN || b.state === STATE.HALF_OPEN;
}

function getState(fingerprint) {
    return _get(fingerprint).state;
}

// ── tryRecover ────────────────────────────────────────────────────────

function tryRecover(fingerprint, nowMs = Date.now(), opts = {}) {
    const cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    const b = _get(fingerprint);
    if (b.state !== STATE.OPEN) return false;
    if (b.openedAt !== null && (nowMs - b.openedAt) >= cooldownMs) {
        b.state             = STATE.HALF_OPEN;
        b.halfOpenSuccesses = 0;
        return true;
    }
    return false;
}

function forceClose(fingerprint) {
    const b = _get(fingerprint);
    b.state             = STATE.CLOSED;
    b.failures          = 0;
    b.consecutiveFails  = 0;
    b.halfOpenSuccesses = 0;
    b.openedAt          = null;
}

// ── getAll ────────────────────────────────────────────────────────────

function getAll() {
    const result = {};
    for (const [fp, b] of _breakers) {
        result[fp] = { ...b };
    }
    return result;
}

function getOpenBreakers() {
    return [..._breakers.entries()]
        .filter(([, b]) => b.state === STATE.OPEN)
        .map(([fp, b]) => ({ fingerprint: fp, ...b }));
}

// ── reset ─────────────────────────────────────────────────────────────

function reset(fingerprint) {
    if (fingerprint !== undefined) {
        _breakers.delete(fingerprint);
    } else {
        _breakers = new Map();
    }
}

module.exports = {
    STATE, record, isOpen, getState, tryRecover, forceClose,
    getAll, getOpenBreakers, reset,
};
