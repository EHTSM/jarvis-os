"use strict";
/**
 * Phase 581 — Operator Execution Calmness
 *
 * Reduces workflow clutter, replay overload, warning fatigue,
 * operational spam, and repetitive overlays.
 *
 * Improves: execution clarity, debugging focus, deployment readability.
 * All filtering is opt-in per session and operator-controlled.
 */

const crypto = require("crypto");

// ── Noise filter registry ────────────────────────────────────────────────────

// Per-session filter state: Map<sessionId, FilterState>
const _filters = new Map();

const DEFAULTS = {
    suppressRepeatWarnings:   true,   // suppress identical warnings within 10 min
    suppressLowPriorityLogs:  false,  // hide logs below 'info' level
    dedupOverlays:            true,   // prevent same overlay twice in 15 min
    collapseRecoverySpam:     true,   // if same recovery step repeats 3x, collapse to summary
    muteMonitoringDuringDebug:false,  // suppress monitoring overlays during debug mode
    maxConcurrentWarnings:    3,      // cap simultaneous warning banners
};

function _getFilter(sessionId) {
    if (!_filters.has(sessionId)) _filters.set(sessionId, { ...DEFAULTS, _warningCache: new Map(), _overlayCache: new Map(), _recoveryStepCounts: new Map() });
    return _filters.get(sessionId);
}

// ── Noise evaluation ──────────────────────────────────────────────────────────

/**
 * Decide whether to show a warning.
 * Returns { show: bool, reason? }
 */
function evaluateWarning(sessionId, warningKey, severity = "warning") {
    const f    = _getFilter(sessionId);
    const now  = Date.now();
    const WARN_TTL_MS = 10 * 60 * 1000;

    if (f.suppressRepeatWarnings) {
        const h    = crypto.createHash("md5").update(warningKey).digest("hex").slice(0, 8);
        const last = f._warningCache.get(h) || 0;
        if (now - last < WARN_TTL_MS) {
            return { show: false, reason: `Warning suppressed — shown ${Math.round((now - last) / 1000)}s ago` };
        }
        f._warningCache.set(h, now);
        // Prune old entries
        for (const [k, ts] of f._warningCache) { if (now - ts > WARN_TTL_MS * 2) f._warningCache.delete(k); }
    }

    // Count active warnings
    const activeCount = [...f._warningCache.values()].filter(ts => now - ts < WARN_TTL_MS).length;
    if (activeCount > f.maxConcurrentWarnings && severity !== "critical") {
        return { show: false, reason: `Max concurrent warnings (${f.maxConcurrentWarnings}) reached` };
    }

    return { show: true };
}

/**
 * Decide whether to show an overlay.
 */
function evaluateOverlay(sessionId, overlayType) {
    const f   = _getFilter(sessionId);
    const now = Date.now();
    const OVL_TTL_MS = 15 * 60 * 1000;

    if (!f.dedupOverlays) return { show: true };

    const last = f._overlayCache.get(overlayType) || 0;
    if (now - last < OVL_TTL_MS) {
        return { show: false, reason: `Overlay '${overlayType}' suppressed — shown ${Math.round((now - last) / 1000)}s ago` };
    }
    f._overlayCache.set(overlayType, now);
    return { show: true };
}

/**
 * Track a recovery step. If same step repeats >=3x, collapse to summary.
 * Returns { collapsed: bool, count, summary? }
 */
function trackRecoveryStep(sessionId, stepId) {
    const f     = _getFilter(sessionId);
    const count = (f._recoveryStepCounts.get(stepId) || 0) + 1;
    f._recoveryStepCounts.set(stepId, count);

    if (f.collapseRecoverySpam && count >= 3) {
        return { collapsed: true, count, summary: `Recovery step '${stepId}' has been attempted ${count} times — consider escalating to a different strategy` };
    }
    return { collapsed: false, count };
}

// ── Log filtering ─────────────────────────────────────────────────────────────

const LOG_LEVELS = { debug: 0, info: 1, warning: 2, error: 3, critical: 4 };

/**
 * Filter a log entry. Returns true if should be shown.
 */
function shouldShowLog(sessionId, level = "info") {
    const f        = _getFilter(sessionId);
    const minLevel = f.suppressLowPriorityLogs ? LOG_LEVELS.info : LOG_LEVELS.debug;
    return (LOG_LEVELS[level] || 0) >= minLevel;
}

// ── Configuration ─────────────────────────────────────────────────────────────

function configure(sessionId, overrides = {}) {
    const f = _getFilter(sessionId);
    Object.assign(f, Object.fromEntries(
        Object.entries(overrides).filter(([k]) => k in DEFAULTS)
    ));
    return { ok: true, sessionId, current: _publicState(f) };
}

function getConfig(sessionId) {
    return _publicState(_getFilter(sessionId));
}

function resetSession(sessionId) {
    _filters.delete(sessionId);
    return { ok: true, sessionId };
}

function _publicState(f) {
    const { _warningCache, _overlayCache, _recoveryStepCounts, ...pub } = f;
    return pub;
}

// ── Clarity report ────────────────────────────────────────────────────────────

/**
 * Report on how much noise is being filtered in a session.
 */
function clarityReport(sessionId) {
    const f   = _getFilter(sessionId);
    const now = Date.now();
    return {
        sessionId,
        activeWarnings:       [...f._warningCache.values()].filter(ts => now - ts < 10 * 60 * 1000).length,
        suppressedOverlays:   f._overlayCache.size,
        repeatedRecoverySteps: [...f._recoveryStepCounts.values()].filter(c => c >= 2).length,
        config:               _publicState(f),
    };
}

module.exports = { evaluateWarning, evaluateOverlay, trackRecoveryStep, shouldShowLog, configure, getConfig, resetSession, clarityReport, DEFAULTS };
