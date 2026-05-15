"use strict";
/**
 * dependencyStabilityTracker — track reliability of packages, APIs, tools, and env.
 *
 * record(depId, event)            — append event to dep history
 *   event: { type, ts? }
 *   types: install_failure | install_success | api_failure | api_success
 *          tool_failure | tool_success | env_inconsistency
 *
 * getStability(depId)             → { stability: 0–1, failures, successes, total }
 * isUnstable(depId, threshold?)   → boolean  (default threshold 0.5)
 * getUnstable(threshold?)         → depId[]
 * getAll()                        → { [depId]: stability record }
 * reset()
 */

const _deps = new Map();   // depId → { events: [] }

const SUCCESS_TYPES = new Set(["install_success", "api_success", "tool_success"]);
const FAILURE_TYPES = new Set(["install_failure", "api_failure", "tool_failure", "env_inconsistency"]);

function record(depId, event = {}) {
    if (!_deps.has(depId)) _deps.set(depId, { events: [] });
    _deps.get(depId).events.push({ ...event, ts: event.ts ?? new Date().toISOString() });
}

function getStability(depId) {
    const dep = _deps.get(depId);
    if (!dep || dep.events.length === 0) return { stability: 1.0, failures: 0, successes: 0, total: 0 };

    const failures  = dep.events.filter(e => FAILURE_TYPES.has(e.type)).length;
    const successes = dep.events.filter(e => SUCCESS_TYPES.has(e.type)).length;
    const total     = failures + successes;
    const stability = total === 0 ? 1.0 : successes / total;

    return { stability: Math.round(stability * 1000) / 1000, failures, successes, total };
}

function isUnstable(depId, threshold = 0.5) {
    return getStability(depId).stability < threshold;
}

function getUnstable(threshold = 0.5) {
    return [..._deps.keys()].filter(id => isUnstable(id, threshold));
}

function getAll() {
    const out = {};
    for (const id of _deps.keys()) out[id] = getStability(id);
    return out;
}

function reset() { _deps.clear(); }

module.exports = { record, getStability, isUnstable, getUnstable, getAll, reset, SUCCESS_TYPES, FAILURE_TYPES };
