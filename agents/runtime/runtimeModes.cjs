"use strict";
/**
 * Phase 460 — Production Environment Modes
 *
 * Runtime modes: development | recovery | deployment | safe-mode | diagnostics
 *
 * Each mode adjusts:
 *   - runtime limits (burst cap, concurrency, timeouts)
 *   - recovery behavior (auto-retry, max attempts)
 *   - validation strictness (probe required vs optional)
 *
 * Active mode is persisted to data/runtime-mode.json.
 * Defaults to "development" on first use.
 */

const fs   = require("fs");
const path = require("path");

const MODE_PATH = path.join(__dirname, "../../data/runtime-mode.json");

const MODES = {
    development: {
        name:        "development",
        label:       "Development",
        description: "Standard local dev — relaxed limits, auto-retry enabled",
        limits: {
            maxBurst:           10,
            maxConcurrency:     3,
            workflowTimeoutMs:  60_000,
            chainCooldownMs:    30_000,
            maxRetries:         3,
        },
        recovery: {
            autoRetry:          true,
            maxAttempts:        3,
            cooldownBetweenMs:  5_000,
        },
        validation: {
            probeRequired:      false,
            strictFalsePositive: false,
            confirmOnCaution:   false,
        },
    },
    recovery: {
        name:        "recovery",
        label:       "Recovery",
        description: "Incident recovery — conservative limits, guided repair",
        limits: {
            maxBurst:           5,
            maxConcurrency:     1,
            workflowTimeoutMs:  90_000,
            chainCooldownMs:    60_000,
            maxRetries:         2,
        },
        recovery: {
            autoRetry:          true,
            maxAttempts:        2,
            cooldownBetweenMs:  10_000,
        },
        validation: {
            probeRequired:      true,
            strictFalsePositive: true,
            confirmOnCaution:   true,
        },
    },
    deployment: {
        name:        "deployment",
        label:       "Deployment",
        description: "Production deployment — approval-gated, strict validation",
        limits: {
            maxBurst:           3,
            maxConcurrency:     1,
            workflowTimeoutMs:  120_000,
            chainCooldownMs:    120_000,
            maxRetries:         1,
        },
        recovery: {
            autoRetry:          false,
            maxAttempts:        1,
            cooldownBetweenMs:  30_000,
        },
        validation: {
            probeRequired:      true,
            strictFalsePositive: true,
            confirmOnCaution:   true,
        },
    },
    "safe-mode": {
        name:        "safe-mode",
        label:       "Safe Mode",
        description: "Emergency safe mode — read-only probes, no auto-execution",
        limits: {
            maxBurst:           2,
            maxConcurrency:     1,
            workflowTimeoutMs:  30_000,
            chainCooldownMs:    300_000,
            maxRetries:         0,
        },
        recovery: {
            autoRetry:          false,
            maxAttempts:        0,
            cooldownBetweenMs:  60_000,
        },
        validation: {
            probeRequired:      true,
            strictFalsePositive: true,
            confirmOnCaution:   true,
        },
    },
    diagnostics: {
        name:        "diagnostics",
        label:       "Diagnostics",
        description: "Read-heavy diagnostics — no writes, health probes only",
        limits: {
            maxBurst:           20,
            maxConcurrency:     5,
            workflowTimeoutMs:  15_000,
            chainCooldownMs:    5_000,
            maxRetries:         0,
        },
        recovery: {
            autoRetry:          false,
            maxAttempts:        0,
            cooldownBetweenMs:  0,
        },
        validation: {
            probeRequired:      true,
            strictFalsePositive: false,
            confirmOnCaution:   false,
        },
    },
};

// ── Storage ───────────────────────────────────────────────────────────────────
function _loadState() {
    try { return JSON.parse(fs.readFileSync(MODE_PATH, "utf8")); }
    catch { return { mode: "development", switchedAt: null, previousMode: null }; }
}

function _saveState(state) {
    try {
        const dir = path.dirname(MODE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MODE_PATH, JSON.stringify(state, null, 2));
    } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Get the current active mode config. */
function getActiveMode() {
    const state = _loadState();
    const mode  = MODES[state.mode] || MODES.development;
    return { ...mode, switchedAt: state.switchedAt, previousMode: state.previousMode };
}

/** Get a specific mode config (without switching). */
function getMode(name) { return MODES[name] || null; }

/** List all available modes. */
function listModes() {
    return Object.values(MODES).map(m => ({
        name:        m.name,
        label:       m.label,
        description: m.description,
        active:      _loadState().mode === m.name,
    }));
}

/**
 * Switch the active runtime mode.
 * @param {string} name — mode name
 * @returns {{ ok: boolean, previous: string, current: string }}
 */
function switchMode(name) {
    if (!MODES[name]) return { ok: false, error: `unknown mode: ${name}`, available: Object.keys(MODES) };
    const state = _loadState();
    const prev  = state.mode;
    _saveState({ mode: name, switchedAt: Date.now(), previousMode: prev });
    return { ok: true, previous: prev, current: name, config: MODES[name] };
}

/** Get the limits for the current mode (for use by other modules). */
function currentLimits() { return getActiveMode().limits; }

/** Get the validation config for the current mode. */
function currentValidation() { return getActiveMode().validation; }

/** Get the recovery config for the current mode. */
function currentRecovery() { return getActiveMode().recovery; }

module.exports = { getActiveMode, getMode, listModes, switchMode, currentLimits, currentValidation, currentRecovery, MODES };
