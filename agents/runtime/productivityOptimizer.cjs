"use strict";
/**
 * Phase 552 — Operator Productivity Optimization
 *
 * Reduces: UI friction, replay clutter, operational fatigue, unnecessary overlays,
 * repeated warnings.
 *
 * Improves: engineering flow, debugging continuity, workflow readability.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const CONFIG_PATH     = path.join(__dirname, "../../data/productivity-optimizer.json");
const WARNING_HISTORY = new Map();   // in-memory dedup, intentional
const SUPPRESS_TTL_MS = 15 * 60_000; // 15 min suppress window

const DEFAULT_CONFIG = {
    maxAlertsShown:         5,
    maxSuggestionsShown:    3,
    suppressRepeatedAlerts: true,
    alertSuppressTtlMs:     SUPPRESS_TTL_MS,
    collapseInfoSignals:    true,
    groupWorkflowsByCategory: true,
    debugModeVerbose:       false,
};

function _loadConfig() {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) }; }
    catch { return { ...DEFAULT_CONFIG }; }
}

function _saveConfig(cfg) {
    try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch {}
}

// ── Configuration ─────────────────────────────────────────────────────────────

function configure(updates = {}) {
    const cfg = { ..._loadConfig(), ...updates };
    _saveConfig(cfg);
    return { ok: true, config: cfg };
}

function getConfig() {
    return _loadConfig();
}

// ── Alert deduplication and filtering ────────────────────────────────────────

function filterAlerts(alerts = []) {
    const cfg = _loadConfig();
    if (!Array.isArray(alerts)) return [];

    const now = Date.now();
    const seen = new Set();
    const filtered = [];

    for (const alert of alerts) {
        const text = typeof alert === "string" ? alert : (alert.message || alert.detail || JSON.stringify(alert));
        const key  = text.slice(0, 60).toLowerCase();

        // Dedup within this call
        if (seen.has(key)) continue;
        seen.add(key);

        // Suppress if recently shown
        if (cfg.suppressRepeatedAlerts) {
            const lastShown = WARNING_HISTORY.get(key);
            if (lastShown && now - lastShown < cfg.alertSuppressTtlMs) continue;
        }

        // Collapse info-level signals
        if (cfg.collapseInfoSignals) {
            const level = alert.level || alert.priority || "info";
            if (level === "info" || level === "low") continue;
        }

        WARNING_HISTORY.set(key, now);
        filtered.push(alert);
        if (filtered.length >= cfg.maxAlertsShown) break;
    }

    return filtered;
}

// ── Suggestion deduplication ──────────────────────────────────────────────────

const _shownSuggestions = new Map();

function filterSuggestions(suggestions = [], sessionId = "global") {
    const cfg = _loadConfig();
    const now = Date.now();
    const key = (s) => `${sessionId}:${(s.name || s.label || s.goal || "").slice(0, 40)}`;

    return suggestions
        .filter(s => {
            const k = key(s);
            const last = _shownSuggestions.get(k);
            if (last && now - last < SUPPRESS_TTL_MS) return false;
            _shownSuggestions.set(k, now);
            return true;
        })
        .slice(0, cfg.maxSuggestionsShown);
}

// ── Workflow readability ──────────────────────────────────────────────────────

function formatWorkflowForOperator(workflow) {
    if (!workflow) return null;
    return {
        id:          workflow.id,
        name:        workflow.name,
        goal:        workflow.goal,
        category:    workflow.category,
        stepCount:   (workflow.steps || []).length,
        tags:        workflow.tags || [],
        useCount:    workflow.useCount || 0,
        confidence:  workflow.confidence || null,
        // Omit raw steps, estimatedDuration, custom fields — reduce visual clutter
    };
}

function formatWorkflowList(workflows = []) {
    const cfg = _loadConfig();
    const formatted = workflows.map(formatWorkflowForOperator);

    if (cfg.groupWorkflowsByCategory) {
        const ORDER = ["recovery", "deployment", "maintenance", "setup", "custom"];
        const groups = {};
        for (const wf of formatted) {
            const cat = wf.category || "custom";
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(wf);
        }
        return ORDER.filter(c => groups[c]).map(c => ({ category: c, workflows: groups[c] }));
    }

    return formatted;
}

// ── Engineering flow score ────────────────────────────────────────────────────

/**
 * Estimates how much cognitive friction the operator is experiencing.
 * Score 0-100 (lower = better flow, higher = more friction).
 */
function flowScore() {
    const analytics = _tryRequire("./operatorAnalytics.cjs");
    const session   = _tryRequire("./engineeringSession.cjs");
    const pressure  = _tryRequire("./runtimePressureMonitor.cjs");

    let friction = 0;
    const factors = [];

    if (analytics) {
        try {
            const s = analytics.summary();
            friction += s.fatigue.score * 0.4;
            if (s.fatigue.level === "high") factors.push(`High fatigue: ${s.fatigue.score}/100`);
        } catch {}
    }

    if (session) {
        try {
            const all = session.listSessions ? session.listSessions() : [];
            const blocked = all.filter(s => s.state === "blocked").length;
            friction += blocked * 15;
            if (blocked > 0) factors.push(`${blocked} blocked session(s)`);
        } catch {}
    }

    if (pressure) {
        const p = pressure.computePressure();
        if (p.level === "high")     { friction += 20; factors.push("High runtime pressure"); }
        if (p.level === "critical") { friction += 40; factors.push("Critical runtime pressure"); }
    }

    friction = Math.min(100, Math.round(friction));
    const flowLabel = friction <= 20 ? "excellent" : friction <= 40 ? "good" : friction <= 60 ? "degraded" : "poor";

    return {
        frictionScore: friction,
        flowLabel,
        factors,
        recommendation: friction > 60
            ? "High friction — consider activating productivity mode and resolving blocked sessions"
            : friction > 40
            ? "Moderate friction — monitor and address fatigue indicators"
            : "Flow is good — continue current work",
    };
}

// ── Debugging continuity ──────────────────────────────────────────────────────

function debuggingContinuity(sessionId) {
    const dbgMode = _tryRequire("./debuggingMode.cjs");
    const intel   = _tryRequire("./failureIntelligenceEngine.cjs");
    if (!dbgMode) return { available: false };

    const state = dbgMode.getState();
    if (!state.active || state.sessionId !== sessionId) return { active: false };

    const clusters  = dbgMode.clusterErrors ? dbgMode.clusterErrors() : [];
    const primaryError = clusters[0] || null;
    const recovery  = primaryError && intel ? intel.clusterRootCauses([primaryError.representative || ""]) : [];

    return {
        active:       true,
        sessionId,
        errorClusters: clusters.length,
        primaryCluster: primaryError ? { representative: primaryError.representative, count: primaryError.count } : null,
        suggestedRecovery: recovery[0] || null,
        cfg: _loadConfig(),
    };
}

module.exports = {
    configure, getConfig,
    filterAlerts, filterSuggestions,
    formatWorkflowForOperator, formatWorkflowList,
    flowScore, debuggingContinuity,
};
