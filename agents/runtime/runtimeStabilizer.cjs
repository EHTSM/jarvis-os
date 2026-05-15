"use strict";
/**
 * runtimeStabilizer — self-healing runtime stabilization.
 *
 * Tracks instability events per workflow name and applies:
 *   - Retry suppression after SUPPRESSION_THRESHOLD events in window
 *   - Automatic quarantine after QUARANTINE_THRESHOLD events in window
 *   - Adaptive throttle multiplier (1.0 → 0.1 as instabilities accumulate)
 *   - Cooldown delay utility
 *
 * All state is in-memory only. Call reset() between tests.
 *
 * Window = QUARANTINE_WINDOW_MS (default 60s).
 * Quarantine duration = DEFAULT_QUARANTINE_MS (default 30s).
 */

const QUARANTINE_THRESHOLD  = 3;
const QUARANTINE_WINDOW_MS  = 60_000;
const DEFAULT_QUARANTINE_MS = 30_000;
const SUPPRESSION_THRESHOLD = 2;

// Per-workflow: { instabilities: [{ts, reason}], quarantine: {until, reason} | null }
const _state = new Map();

function _entry(workflowName) {
    if (!_state.has(workflowName)) {
        _state.set(workflowName, { instabilities: [], quarantine: null });
    }
    return _state.get(workflowName);
}

// Returns instability events within the current window, pruning stale ones
function _recent(workflowName) {
    const e   = _entry(workflowName);
    const now = Date.now();
    e.instabilities = e.instabilities.filter(i => now - i.ts < QUARANTINE_WINDOW_MS);
    return e.instabilities;
}

// ── Core ──────────────────────────────────────────────────────────────

/**
 * Record an instability event for a workflow.
 * Automatically triggers quarantine if threshold is crossed.
 *
 * @returns {{ suppressed, quarantined, instabilityCount }}
 */
function recordInstability(workflowName, reason = "unknown") {
    const e = _entry(workflowName);
    e.instabilities.push({ ts: Date.now(), reason });

    const recent     = _recent(workflowName);
    const count      = recent.length;
    const suppressed = count >= SUPPRESSION_THRESHOLD;

    if (count >= QUARANTINE_THRESHOLD && !isQuarantined(workflowName)) {
        quarantine(workflowName, DEFAULT_QUARANTINE_MS,
            `${count} instabilities in ${QUARANTINE_WINDOW_MS / 1000}s window`);
    }

    return { suppressed, quarantined: isQuarantined(workflowName), instabilityCount: count };
}

/** True if this workflow is currently quarantined (and the quarantine hasn't expired). */
function isQuarantined(workflowName) {
    const e = _entry(workflowName);
    if (!e.quarantine) return false;
    if (Date.now() >= e.quarantine.until) {
        e.quarantine = null;  // auto-release expired quarantine
        return false;
    }
    return true;
}

/**
 * Manually quarantine a workflow for a given duration.
 * @returns {object} quarantine record
 */
function quarantine(workflowName, durationMs = DEFAULT_QUARANTINE_MS, reason = "manual") {
    const e = _entry(workflowName);
    e.quarantine = {
        until:          Date.now() + durationMs,
        reason,
        quarantinedAt:  new Date().toISOString(),
    };
    return e.quarantine;
}

/** Release quarantine immediately. Returns true if there was an active quarantine. */
function releaseQuarantine(workflowName) {
    const e = _entry(workflowName);
    const had = !!e.quarantine;
    e.quarantine = null;
    return had;
}

/** True if retry suppression is active for this workflow. */
function shouldSuppressRetries(workflowName) {
    return _recent(workflowName).length >= SUPPRESSION_THRESHOLD;
}

/**
 * Adaptive throttle multiplier.
 * 1.0 = no throttle, 0.1 = maximum throttle.
 * Decreases by 0.20 per recent instability.
 */
function getThrottle(workflowName) {
    const count = _recent(workflowName).length;
    return parseFloat(Math.max(1.0 - count * 0.20, 0.1).toFixed(2));
}

/** Await a non-blocking cooldown delay. */
async function cooldown(durationMs = 1_000) {
    await new Promise(r => {
        const t = setTimeout(r, durationMs);
        if (t.unref) t.unref();
    });
}

/** Snapshot of stabilization state for all tracked workflows. */
function stabilityReport() {
    const report = {};
    for (const [name] of _state) {
        const recent = _recent(name);
        report[name] = {
            instabilityCount: recent.length,
            quarantined:      isQuarantined(name),
            suppressed:       recent.length >= SUPPRESSION_THRESHOLD,
            throttle:         getThrottle(name),
            quarantineEnds:   _entry(name).quarantine?.until
                ? new Date(_entry(name).quarantine.until).toISOString()
                : null,
        };
    }
    return report;
}

function reset() { _state.clear(); }

module.exports = {
    recordInstability,
    isQuarantined,
    quarantine,
    releaseQuarantine,
    shouldSuppressRetries,
    getThrottle,
    cooldown,
    stabilityReport,
    reset,
    QUARANTINE_THRESHOLD,
    QUARANTINE_WINDOW_MS,
    DEFAULT_QUARANTINE_MS,
    SUPPRESSION_THRESHOLD,
};
