"use strict";
/**
 * Phase 414 — Adapter Self-Healing
 *
 * Detects stale or disconnected adapter states and initiates safe recovery.
 * Works with toolStateMonitor to detect problems, then takes bounded action.
 *
 * Healing actions (bounded, no infinite loops):
 *   - vscode:     emit reconnect signal (no process restart)
 *   - terminal:   emit reconnect signal
 *   - browser:    emit reconnect signal
 *   - runtime:    check pm2 status, attempt pm2 reload (max once per 10 min)
 *
 * Max 1 healing attempt per adapter per 10 minutes (tracked in-memory).
 * After 3 consecutive failures for one adapter → mark adapter as "degraded", stop healing.
 */

const logger    = require("../../backend/utils/logger");
const pressure  = require("./runtimePressureMonitor.cjs");

const HEAL_COOLDOWN_MS  = 10 * 60 * 1000;  // 10 min per adapter
const MAX_CONSECUTIVE   = 3;

const _healAttempts = new Map(); // adapterName → { lastAt, consecutiveFails, degraded }

function _state(adapter) {
    if (!_healAttempts.has(adapter)) {
        _healAttempts.set(adapter, { lastAt: 0, consecutiveFails: 0, degraded: false });
    }
    return _healAttempts.get(adapter);
}

/**
 * Check whether healing is permitted for an adapter.
 * @param {string} adapter
 * @returns {{ allowed: boolean, reason: string }}
 */
function canHeal(adapter) {
    const s = _state(adapter);
    if (s.degraded) return { allowed: false, reason: "adapter_degraded_max_failures" };
    const elapsed = Date.now() - s.lastAt;
    if (elapsed < HEAL_COOLDOWN_MS && s.lastAt > 0) {
        return { allowed: false, reason: `heal_cooldown:${Math.ceil((HEAL_COOLDOWN_MS - elapsed) / 1000)}s` };
    }
    return { allowed: true, reason: "" };
}

/**
 * Attempt to heal a specific adapter.
 * Returns the healing outcome (what was attempted and whether it succeeded conceptually).
 *
 * For real pm2 healing, uses execSync to check status. All others emit a
 * reconnect hint (no process restart without operator approval).
 *
 * @param {string} adapter  — "vscode" | "terminal" | "browser" | "runtime"
 * @param {object} [context]
 * @returns {{ healed: boolean, action: string, reason: string }}
 */
function heal(adapter, context = {}) {
    const gate = canHeal(adapter);
    if (!gate.allowed) {
        return { healed: false, action: "skipped", reason: gate.reason };
    }

    const s      = _state(adapter);
    s.lastAt     = Date.now();

    let action   = "reconnect-signal";
    let healed   = true;

    try {
        if (adapter === "runtime") {
            // Check pm2 status — safe read-only probe
            const { execSync } = require("child_process");
            const out = execSync("pm2 jlist 2>/dev/null", { timeout: 3000, encoding: "utf8" });
            const procs = JSON.parse(out);
            const backend = procs.find(p => p.name === "jarvis-os");
            if (backend && backend.pm2_env?.status !== "online") {
                // pm2 reload is safer than restart — does not kill in-flight requests
                execSync("pm2 reload jarvis-os", { timeout: 10_000, encoding: "utf8" });
                action = "pm2-reload";
                pressure.recordAdapterFault("runtime");
                logger.warn(`[AdapterHeal] runtime adapter: pm2 reload issued`);
            } else {
                action = "runtime-healthy-no-action";
            }
        } else {
            // Non-runtime adapters: emit a reconnect hint signal only
            // (actual reconnect is driven by frontend polling toolStateMonitor)
            logger.info(`[AdapterHeal] ${adapter}: reconnect signal emitted`);
        }

        // Success path
        s.consecutiveFails = 0;
    } catch (err) {
        healed             = false;
        s.consecutiveFails = (s.consecutiveFails || 0) + 1;
        pressure.recordAdapterFault(adapter);
        logger.warn(`[AdapterHeal] ${adapter}: heal failed (${s.consecutiveFails}/${MAX_CONSECUTIVE}) — ${err.message}`);

        if (s.consecutiveFails >= MAX_CONSECUTIVE) {
            s.degraded = true;
            logger.warn(`[AdapterHeal] ${adapter}: marked DEGRADED after ${MAX_CONSECUTIVE} consecutive failures`);
        }
    }

    return { healed, action, reason: healed ? "ok" : "heal_failed" };
}

/**
 * Run healing for all known adapters that have a stale state.
 * Uses toolStateMonitor's detectProblems to identify candidates.
 * @returns {Array<{ adapter, result }>}
 */
function healAll() {
    let problems = [];
    try {
        const tsm = require("./toolStateMonitor.cjs");
        problems = tsm.detectProblems();
    } catch { return []; }

    return problems.map(problem => ({
        adapter: problem.tool,
        result:  heal(problem.tool, { problem }),
    }));
}

/**
 * Mark an adapter as explicitly degraded (called externally on repeated errors).
 * @param {string} adapter
 */
function markDegraded(adapter) {
    _state(adapter).degraded = true;
    pressure.recordAdapterFault(adapter);
    logger.warn(`[AdapterHeal] ${adapter}: externally marked degraded`);
}

/**
 * Reset degraded state for an adapter (called when reconnection confirmed).
 * @param {string} adapter
 */
function resetAdapter(adapter) {
    const s = _state(adapter);
    s.degraded         = false;
    s.consecutiveFails = 0;
    logger.info(`[AdapterHeal] ${adapter}: reset to healthy`);
}

/** Diagnostics snapshot. */
function snapshot() {
    const result = {};
    for (const [adapter, s] of _healAttempts.entries()) {
        result[adapter] = {
            lastHealAt:        s.lastAt,
            consecutiveFails:  s.consecutiveFails,
            degraded:          s.degraded,
            cooldownRemainingMs: Math.max(0, HEAL_COOLDOWN_MS - (Date.now() - s.lastAt)),
        };
    }
    return result;
}

module.exports = { canHeal, heal, healAll, markDegraded, resetAdapter, snapshot };
