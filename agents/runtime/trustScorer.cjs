"use strict";
/**
 * trustScorer — workflow trust lifecycle management.
 *
 * Trust model:
 *   new workflows       → INITIAL_TRUST (20)
 *   successful run      → +SUCCESS_GAIN (5), capped at 100
 *   failed run          → −FAILURE_LOSS (10), floored at 0
 *
 * Trust levels:
 *   0–29   untrusted   → limited execution
 *   30–59  limited     → limited execution
 *   60–84  trusted     → trusted execution
 *   85–100 privileged  → privileged execution
 *
 * Persists to data/workflow-trust.json.
 */

const fs   = require("fs");
const path = require("path");

const TRUST_PATH    = path.join(__dirname, "../../data/workflow-trust.json");
const INITIAL_TRUST = 20;
const MAX_TRUST     = 100;
const MIN_TRUST     = 0;
const SUCCESS_GAIN  = 5;
const FAILURE_LOSS  = 10;

const TRUST_LEVELS = {
    UNTRUSTED:  { min: 0,  max: 29,  name: "untrusted",  permissionLevel: "limited"    },
    LIMITED:    { min: 30, max: 59,  name: "limited",    permissionLevel: "limited"    },
    TRUSTED:    { min: 60, max: 84,  name: "trusted",    permissionLevel: "trusted"    },
    PRIVILEGED: { min: 85, max: 100, name: "privileged", permissionLevel: "privileged" },
};

let _store = {};

function _load() {
    try { _store = JSON.parse(fs.readFileSync(TRUST_PATH, "utf8")); }
    catch { _store = {}; }
}

function _save() {
    try {
        const dir = path.dirname(TRUST_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(TRUST_PATH, JSON.stringify(_store, null, 2));
    } catch { /* non-critical — trust persists best-effort */ }
}

_load();

function _entry(workflowName) {
    if (!_store[workflowName]) {
        _store[workflowName] = {
            score:     INITIAL_TRUST,
            runs:      0,
            successes: 0,
            failures:  0,
            lastSeen:  null,
        };
    }
    return _store[workflowName];
}

// ── Query ─────────────────────────────────────────────────────────────

function getTrust(workflowName) {
    return _entry(workflowName).score;
}

function getTrustLevel(workflowName) {
    const score = getTrust(workflowName);
    for (const level of Object.values(TRUST_LEVELS)) {
        if (score >= level.min && score <= level.max) return level;
    }
    return TRUST_LEVELS.UNTRUSTED;
}

// ── Mutations ─────────────────────────────────────────────────────────

function recordSuccess(workflowName) {
    const e   = _entry(workflowName);
    e.score   = Math.min(e.score + SUCCESS_GAIN, MAX_TRUST);
    e.runs++;
    e.successes++;
    e.lastSeen = new Date().toISOString();
    _save();
    return e.score;
}

function recordFailure(workflowName) {
    const e   = _entry(workflowName);
    e.score   = Math.max(e.score - FAILURE_LOSS, MIN_TRUST);
    e.runs++;
    e.failures++;
    e.lastSeen = new Date().toISOString();
    _save();
    return e.score;
}

/** Manually set trust score (e.g. after human review). */
function grantTrust(workflowName, score) {
    const e   = _entry(workflowName);
    e.score   = Math.max(MIN_TRUST, Math.min(Math.round(score), MAX_TRUST));
    e.lastSeen = new Date().toISOString();
    _save();
    return e.score;
}

function reset(workflowName) {
    delete _store[workflowName];
    _save();
}

function resetAll() {
    _store = {};
    _save();
}

function snapshot() { return { ..._store }; }

module.exports = {
    getTrust,
    getTrustLevel,
    recordSuccess,
    recordFailure,
    grantTrust,
    reset,
    resetAll,
    snapshot,
    INITIAL_TRUST,
    SUCCESS_GAIN,
    FAILURE_LOSS,
    TRUST_LEVELS,
};
