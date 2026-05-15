"use strict";
/**
 * deployEventStream — event stream for deployment operations.
 *
 * emit(deploymentId, event, data?)   → event entry
 * getStream(deploymentId)            → sorted event array
 * subscribe(deploymentId, fn)        — register callback for new events
 * unsubscribe(deploymentId, fn)      — remove callback
 * getAllDeployments()                → list of deployment IDs with events
 * reset()
 */

const DEPLOY_EVENTS = [
    "validation_start", "validation_passed", "validation_failed",
    "deploy_start",     "deploy_complete",   "deploy_failed",
    "health_check_start", "health_check_passed", "health_check_failed",
    "rollback_start",   "rollback_complete",  "rollback_failed",
    "deployment_succeeded", "deployment_failed",
    "manual_rollback_triggered",
];

// deploymentId → event[]
const _streams      = new Map();
// deploymentId → Set<fn>
const _subscribers  = new Map();
let   _seq          = 0;

function emit(deploymentId, event, data = {}) {
    if (!_streams.has(deploymentId)) _streams.set(deploymentId, []);
    const entry = {
        seq:          ++_seq,
        ts:           new Date().toISOString(),
        deploymentId,
        event,
        data,
    };
    _streams.get(deploymentId).push(entry);

    // Notify subscribers
    const subs = _subscribers.get(deploymentId);
    if (subs) for (const fn of subs) { try { fn(entry); } catch { /* ignore */ } }

    return entry;
}

function getStream(deploymentId) {
    return (_streams.get(deploymentId) || []).slice().sort((a, b) => a.seq - b.seq);
}

function subscribe(deploymentId, fn) {
    if (!_subscribers.has(deploymentId)) _subscribers.set(deploymentId, new Set());
    _subscribers.get(deploymentId).add(fn);
}

function unsubscribe(deploymentId, fn) {
    _subscribers.get(deploymentId)?.delete(fn);
}

function getAllDeployments() {
    return [..._streams.keys()];
}

function reset() {
    _streams.clear();
    _subscribers.clear();
    _seq = 0;
}

module.exports = { emit, getStream, subscribe, unsubscribe, getAllDeployments, reset, DEPLOY_EVENTS };
