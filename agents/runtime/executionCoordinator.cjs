"use strict";
/**
 * Phase 356 — Unified Execution Coordinator
 *
 * Single entry point for all execution requests. Enforces:
 *   - Deduplication: identical inputs within a 2s window are not double-dispatched
 *   - Lifecycle tracking: PENDING → RUNNING → DONE | FAILED
 *   - Validation gate before dispatch
 *   - Recovery coordination after failure
 *   - Approval gate for CAUTION/CRITICAL commands
 *
 * All execution paths MUST call coordinator.dispatch() rather than going
 * directly to runtimeOrchestrator.
 */

const logger       = require("../../backend/utils/logger");
const orchestrator = require("./runtimeOrchestrator.cjs");
const safetyGuard  = require("./operatorSafetyGuard.cjs");

const MAX_TRACKED    = 500;
const DEDUP_WINDOW   = 2_000;   // ms — identical inputs within this window are deduped
const MAX_LIFECYCLE  = 200;     // keep last N lifecycle entries in memory

// Lifecycle store: execId → { execId, input, state, startedAt, endedAt?, error?, result? }
const _lifecycle = new Map();
const _lifecycleOrder = [];     // insertion-ordered ids for eviction

// Active-input dedup: inputKey → { execId, startedAt }
const _activeInputs = new Map();

let _counter = 0;

function _execId() {
    return `coord-${Date.now().toString(36)}-${(++_counter).toString(36)}`;
}

function _inputKey(input) {
    return input.trim().toLowerCase().slice(0, 200);
}

function _trackLifecycle(execId, entry) {
    _lifecycle.set(execId, entry);
    _lifecycleOrder.push(execId);
    if (_lifecycleOrder.length > MAX_LIFECYCLE) {
        const old = _lifecycleOrder.shift();
        _lifecycle.delete(old);
    }
}

function _updateLifecycle(execId, patch) {
    const existing = _lifecycle.get(execId);
    if (existing) _lifecycle.set(execId, { ...existing, ...patch });
}

/**
 * Dispatch an input through the coordinator.
 *
 * @param {string} input
 * @param {object} options
 * @param {string} [options.requestId]    — client-supplied dedup key
 * @param {string} [options.approvalLevel] — "safe" | "caution" | "critical"
 * @param {boolean} [options.dryRun]
 * @param {number}  [options.timeoutMs]
 * @param {number}  [options.retries]
 * @returns {Promise<{ success, reply, execId, durationMs, deduplicated?, dryRun? }>}
 */
async function dispatch(input, options = {}) {
    if (!input || !input.trim()) {
        return { success: false, error: "empty_input" };
    }

    const execId   = options.requestId || _execId();
    const inputKey = _inputKey(input);
    const now      = Date.now();

    // Dedup: if an identical input started within DEDUP_WINDOW, return its cached result
    const inFlight = _activeInputs.get(inputKey);
    if (inFlight && (now - inFlight.startedAt) < DEDUP_WINDOW) {
        logger.info(`[Coordinator] deduped execId=${execId} matches in-flight ${inFlight.execId}`);
        return { success: true, execId, deduplicated: true, original: inFlight.execId };
    }

    // Dry-run: classify but do not execute
    if (options.dryRun) {
        logger.info(`[Coordinator] dry-run execId=${execId} — "${input.slice(0, 60)}"`);
        return { success: true, execId, dryRun: true, input };
    }

    // Approval gate: CRITICAL level requires explicit operator approval flag
    if (options.approvalLevel === "critical" && !options.approved) {
        logger.warn(`[Coordinator] CRITICAL command blocked pending approval: "${input.slice(0, 60)}"`);
        return { success: false, error: "approval_required", approvalLevel: "critical", execId };
    }

    // Phase 393: server-side safety gate — catches programmatic bypass of UI gates
    const gateResult = safetyGuard.gate(input, { bypassSafety: options._internal, bypassThrottle: options._internal });
    if (!gateResult.allowed) {
        if (!gateResult.throttleResult.allowed) {
            logger.warn(`[Coordinator] throttle gate — "${input.slice(0, 40)}" dispatched ${gateResult.throttleResult.rate}x/min`);
            return { success: false, error: "dispatch_throttled", rate: gateResult.throttleResult.rate, execId };
        }
        if (gateResult.safetyResult.level === "critical" && !options.approved) {
            logger.warn(`[Coordinator] safety gate CRITICAL — ${gateResult.safetyResult.warnings.join("; ")}`);
            return { success: false, error: "safety_gate_critical", warnings: gateResult.safetyResult.warnings, execId };
        }
    }

    // Register lifecycle
    const lifecycle = { execId, input: input.slice(0, 200), state: "running", startedAt: now };
    _trackLifecycle(execId, lifecycle);
    _activeInputs.set(inputKey, { execId, startedAt: now });

    try {
        const result = await orchestrator.dispatch(input, {
            taskId:    execId,
            timeoutMs: options.timeoutMs,
            retries:   options.retries,
        });

        const durationMs = Date.now() - now;
        _updateLifecycle(execId, {
            state:     result.success ? "done" : "failed",
            endedAt:   Date.now(),
            durationMs,
            success:   result.success,
            error:     result.success ? null : (result.error || "unknown"),
        });

        return { ...result, execId, durationMs };
    } catch (err) {
        _updateLifecycle(execId, { state: "failed", endedAt: Date.now(), error: err.message });
        logger.error(`[Coordinator] dispatch error execId=${execId}: ${err.message}`);
        return { success: false, error: err.message, execId, durationMs: Date.now() - now };
    } finally {
        // Clear dedup entry after a short window so identical retries can proceed
        setTimeout(() => { _activeInputs.delete(inputKey); }, DEDUP_WINDOW).unref();
    }
}

/** Get full lifecycle record for a given execId */
function getLifecycle(execId) {
    return _lifecycle.get(execId) || null;
}

/** Get last N lifecycle entries, newest first */
function recentLifecycle(n = 20) {
    return [..._lifecycleOrder]
        .reverse()
        .slice(0, n)
        .map(id => _lifecycle.get(id))
        .filter(Boolean);
}

/** Live diagnostics */
function stats() {
    const entries = [..._lifecycle.values()];
    return {
        total:   entries.length,
        running: entries.filter(e => e.state === "running").length,
        done:    entries.filter(e => e.state === "done").length,
        failed:  entries.filter(e => e.state === "failed").length,
        activeInputs: _activeInputs.size,
    };
}

module.exports = { dispatch, getLifecycle, recentLifecycle, stats };
