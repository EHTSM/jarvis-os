// Phase 370: Lightweight internal execution event bus.
// Local-only. No network. No external deps.
// Bounded ring buffer (max 200 events). Subscribers are keyed Maps — no leak risk.
// Events: execution-started | execution-completed | execution-failed | execution-cancelled |
//         validation-failed | recovery-triggered | recovery-completed | workflow-completed |
//         workflow-step | adapter-problem

const MAX_EVENTS       = 200;
const MAX_SUBSCRIBERS  = 50;
let _seq = 0;

const _ring        = []; // circular event buffer
const _subscribers = new Map(); // subId → { fn, filter }

function _emit(type, payload = {}) {
  const event = { id: ++_seq, type, ts: Date.now(), ...payload };
  _ring.push(event);
  if (_ring.length > MAX_EVENTS) _ring.shift();
  for (const [, sub] of _subscribers) {
    if (!sub.filter || sub.filter === type || (Array.isArray(sub.filter) && sub.filter.includes(type))) {
      try { sub.fn(event); } catch { /* subscriber errors must not stop bus */ }
    }
  }
  return event;
}

// Emit helpers — typed API prevents typos at call sites
export const bus = {
  executionStarted:    (cmd, meta = {})    => _emit("execution-started",    { cmd, ...meta }),
  executionCompleted:  (cmd, ok, meta = {}) => _emit("execution-completed",  { cmd, ok, ...meta }),
  executionFailed:     (cmd, error, meta = {}) => _emit("execution-failed",  { cmd, error, ...meta }),
  executionCancelled:  (cmd, meta = {})    => _emit("execution-cancelled",   { cmd, ...meta }),
  validationFailed:    (cmd, checks)       => _emit("validation-failed",     { cmd, checks }),
  recoveryTriggered:   (cmd, meta = {})    => _emit("recovery-triggered",    { cmd, ...meta }),
  recoveryCompleted:   (cmd, ok, meta = {}) => _emit("recovery-completed",   { cmd, ok, ...meta }),
  workflowCompleted:   (name, stepCount)   => _emit("workflow-completed",    { name, stepCount }),
  workflowStep:        (name, idx, ok)     => _emit("workflow-step",         { name, idx, ok }),
  adapterProblem:      (tool, detail)      => _emit("adapter-problem",       { tool, detail }),
};

/**
 * Subscribe to bus events.
 * @param {Function} fn     — callback(event)
 * @param {string|string[]|null} filter — event type(s) to receive, null = all
 * @returns {string} subId — call unsubscribe(subId) to clean up
 */
export function subscribe(fn, filter = null) {
  if (_subscribers.size >= MAX_SUBSCRIBERS) {
    console.warn("[ExecutionBus] subscriber limit reached — ignoring");
    return null;
  }
  const subId = `sub-${++_seq}`;
  _subscribers.set(subId, { fn, filter });
  return subId;
}

export function unsubscribe(subId) {
  _subscribers.delete(subId);
}

/** Get recent events, newest first */
export function recentEvents(n = 20) {
  return [..._ring].reverse().slice(0, n);
}

/** Bus diagnostics */
export function busStats() {
  return { seq: _seq, buffered: _ring.length, subscribers: _subscribers.size };
}

// React hook — subscribe for the lifetime of the component
import { useEffect } from "react";
export function useBusSubscription(fn, filter = null) {
  useEffect(() => {
    const id = subscribe(fn, filter);
    return () => { if (id) unsubscribe(id); };
  }, []); // eslint-disable-line
}
