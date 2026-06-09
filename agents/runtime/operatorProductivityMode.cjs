"use strict";
/**
 * Phase 505 — Operator Productivity Mode
 *
 * Focus-oriented engineering mode: reduces operational noise,
 * suppresses unnecessary overlays and repeated warnings,
 * improves engineering flow, execution readability, recovery visibility.
 *
 * Wraps dashboard/assistant output through a noise filter.
 * State: data/productivity-mode.json
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/productivity-mode.json");

const DEFAULTS = {
    active:               false,
    suppressRepeatedWarnings: true,
    suppressHealthyAlerts:    true,
    maxSuggestionsPerCall:    3,
    warningCooldownMs:        5 * 60 * 1000,
    activatedAt:              null,
};

function _load() {
    try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) }; }
    catch { return { ...DEFAULTS }; }
}

function _save(state) {
    try { fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch {}
}

// Tracks warnings shown this session — in-memory to avoid disk churn
const _shownWarnings = new Map(); // message → lastShownAt

function _isRepeated(message, cooldownMs) {
    const now  = Date.now();
    const last = _shownWarnings.get(message);
    if (last && now - last < cooldownMs) return true;
    _shownWarnings.set(message, now);
    return false;
}

// ── Public API ────────────────────────────────────────────────────────────────

function activate() {
    const state = _load();
    state.active      = true;
    state.activatedAt = Date.now();
    _shownWarnings.clear();
    _save(state);
    return { ok: true, mode: "productivity", activatedAt: new Date(state.activatedAt).toISOString() };
}

function deactivate() {
    const state = _load();
    state.active      = false;
    state.activatedAt = null;
    _save(state);
    return { ok: true, mode: "standard" };
}

function getState() {
    return _load();
}

/**
 * Filter a dashboard object through productivity noise reduction.
 * Removes low-value alerts, caps suggestions, suppresses repeated warnings.
 */
function filterDashboard(dashboardData) {
    const cfg = _load();
    if (!cfg.active) return dashboardData;

    const filtered = { ...dashboardData };

    // Filter alerts: keep only actionable ones (not "healthy" noise)
    if (cfg.suppressHealthyAlerts && Array.isArray(filtered.alerts)) {
        filtered.alerts = filtered.alerts.filter(a => {
            const lower = a.toLowerCase();
            // Suppress: "no active sessions", "all adapters healthy", etc.
            if (lower.includes("no active") || lower.includes("0 blocked")) return false;
            if (cfg.suppressRepeatedWarnings && _isRepeated(a, cfg.warningCooldownMs)) return false;
            return true;
        });
    }

    return filtered;
}

/**
 * Filter suggestions list through productivity mode caps.
 */
function filterSuggestions(suggestions) {
    const cfg = _load();
    if (!cfg.active) return suggestions;
    return (suggestions || [])
        .filter(s => !cfg.suppressRepeatedWarnings || !_isRepeated(s.name || s.label || "", cfg.warningCooldownMs))
        .slice(0, cfg.maxSuggestionsPerCall);
}

/**
 * Focused operator summary — what matters right now, nothing else.
 */
function focusSummary() {
    const dashboard = _tryRequire("./operatorDashboard.cjs");
    const cfg       = _load();
    if (!dashboard) return { available: false };

    const d = filterDashboard(dashboard.getDashboard());

    // Build focused output: only what an operator in flow needs to see
    const items = [];

    if (d.health !== "healthy") items.push(`[${d.health.toUpperCase()}] Runtime: ${d.health}`);
    if (d.alerts.length > 0)   items.push(`Alerts: ${d.alerts.join(" | ")}`);

    if (d.sessions.blocked > 0) items.push(`Blocked sessions: ${d.sessions.blocked}`);
    if (d.deployments.awaitingApproval > 0) items.push(`Awaiting approval: ${d.deployments.awaitingApproval} deployment(s)`);
    if (d.deployments.failed > 0) items.push(`Failed deployments: ${d.deployments.failed}`);

    if (items.length === 0) items.push("All clear — continue engineering");

    return {
        focusMode:     cfg.active,
        summary:       items.join("\n"),
        items,
        health:        d.health,
        pressureLevel: d.pressure.level,
        heapMb:        d.memory.heapMb,
        ts:            d.ts,
    };
}

/**
 * Configure productivity mode settings.
 */
function configure(opts = {}) {
    const state = _load();
    if (typeof opts.suppressRepeatedWarnings === "boolean") state.suppressRepeatedWarnings = opts.suppressRepeatedWarnings;
    if (typeof opts.suppressHealthyAlerts    === "boolean") state.suppressHealthyAlerts    = opts.suppressHealthyAlerts;
    if (typeof opts.maxSuggestionsPerCall    === "number")  state.maxSuggestionsPerCall    = Math.min(5, Math.max(1, opts.maxSuggestionsPerCall));
    if (typeof opts.warningCooldownMs        === "number")  state.warningCooldownMs        = Math.min(30 * 60_000, Math.max(60_000, opts.warningCooldownMs));
    _save(state);
    return { ok: true, config: state };
}

module.exports = { activate, deactivate, getState, filterDashboard, filterSuggestions, focusSummary, configure };
