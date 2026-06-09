"use strict";
/**
 * Phase 515 — Operational Debugging Mode
 *
 * Dedicated debugging mode: focused recovery suggestions,
 * error clustering, validation-first execution ordering,
 * replay-assisted debugging, runtime timeline visibility.
 *
 * State: data/debugging-mode.json
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/debugging-mode.json");
const ERROR_CLUSTER_WINDOW_MS = 30 * 60 * 1000; // 30min

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { active: false, sessionId: null, activatedAt: null, errorLog: [] }; }
}

function _save(s) {
    try { fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {}
}

// ── Activate / deactivate ─────────────────────────────────────────────────────

function activate(sessionId, operatorId) {
    const state = { active: true, sessionId: sessionId || null, operatorId: operatorId || null, activatedAt: Date.now(), errorLog: [] };
    _save(state);
    return { ok: true, debuggingMode: true, sessionId, activatedAt: new Date(state.activatedAt).toISOString() };
}

function deactivate() {
    const state = _load();
    state.active = false;
    state.sessionId = null;
    _save(state);
    return { ok: true, debuggingMode: false };
}

function getState() { return _load(); }

// ── Error logging and clustering ──────────────────────────────────────────────

/**
 * Log an error event during a debugging session.
 */
function logError(message, context = {}) {
    const state = _load();
    const entry = { message: (message || "").slice(0, 500), context, ts: Date.now() };
    state.errorLog = [entry, ...(state.errorLog || [])].slice(0, 100);
    _save(state);
    return entry;
}

/**
 * Cluster errors in the current debugging window.
 * Groups by message prefix (first 40 chars) to identify repeated errors.
 */
function clusterErrors() {
    const state   = _load();
    const now     = Date.now();
    const window  = (state.errorLog || []).filter(e => now - e.ts < ERROR_CLUSTER_WINDOW_MS);

    const clusters = {};
    for (const e of window) {
        const key = (e.message || "").slice(0, 40).trim();
        if (!clusters[key]) clusters[key] = { key, count: 0, examples: [], firstSeen: e.ts, lastSeen: e.ts };
        clusters[key].count++;
        clusters[key].lastSeen = Math.max(clusters[key].lastSeen, e.ts);
        if (clusters[key].examples.length < 3) clusters[key].examples.push(e.message);
    }

    const sorted = Object.values(clusters).sort((a, b) => b.count - a.count);

    return {
        windowMs:     ERROR_CLUSTER_WINDOW_MS,
        totalErrors:  window.length,
        clusters:     sorted,
        topError:     sorted[0] || null,
        repeated:     sorted.filter(c => c.count >= 3).length,
    };
}

// ── Focused recovery suggestions ─────────────────────────────────────────────

/**
 * Suggest recovery actions tuned for debugging context.
 * Validation-first: always check system state before executing recovery.
 */
function focusedRecoverySuggestions(errorContext = {}) {
    const { errors = [], goal = "", recentChain = "" } = errorContext;
    const suggestions = [];

    // Always: validation first
    suggestions.push({
        step:     1,
        type:     "validate-first",
        label:    "Check runtime dashboard before any recovery action",
        command:  "GET /api/runtime/dashboard",
        priority: "always",
        reason:   "Understand system state before executing recovery",
    });

    // Error-pattern based suggestions
    const errorText = errors.join(" ").toLowerCase();
    if (/module not found|cannot find/i.test(errorText)) {
        suggestions.push({ step: 2, type: "recovery", label: "Dependency repair", workflowId: "dependency-repair", priority: "high", reason: "Module not found pattern detected" });
    }
    if (/connection refused|econnrefused|enotfound/i.test(errorText)) {
        suggestions.push({ step: 2, type: "recovery", label: "Backend restore", workflowId: "backend-restore", priority: "high", reason: "Connection failure pattern detected" });
    }
    if (/nginx|502|503|upstream/i.test(errorText)) {
        suggestions.push({ step: 2, type: "recovery", label: "Frontend recovery", workflowId: "frontend-recovery", priority: "high", reason: "Proxy/nginx failure detected" });
    }

    // Goal-based
    if (goal.toLowerCase().includes("deploy")) {
        suggestions.push({ step: 3, type: "validation", label: "Deployment environment check", command: "GET /api/runtime/deployments/environment", priority: "medium", reason: "Deployment goal — verify environment first" });
    }

    // Replay assistance
    const replay = _tryRequire("./executionReplayEngine.cjs");
    if (replay && replay.list) {
        try {
            const recent = replay.list({ limit: 1 });
            if (recent.length > 0 && recent[0].goal && goal && recent[0].goal.toLowerCase().includes(goal.toLowerCase().split(" ")[0])) {
                suggestions.push({ step: suggestions.length + 1, type: "replay", label: `Replay previous: "${recent[0].goal}"`, replayId: recent[0].id, priority: "medium", reason: "Similar previous execution available for reference" });
            }
        } catch {}
    }

    return suggestions;
}

// ── Runtime timeline visibility ───────────────────────────────────────────────

/**
 * Build a debugging-focused timeline: errors, recoveries, state transitions.
 */
function debugTimeline(sessionId) {
    const forensics = _tryRequire("./runtimeForensics.cjs");
    const sm        = _tryRequire("./engineeringSession.cjs");
    if (!forensics) return { available: false };

    const events = forensics.query({ sessionId, limit: 50 });
    const session = sm && sessionId ? sm.get(sessionId) : null;

    const timeline = events.map(e => ({
        ts:      e.ts,
        type:    e.type,
        label:   e.summary || e.type,
        chain:   e.chain   || null,
        isError: e.type === "failure" || e.type === "error",
    })).sort((a, b) => (a.ts || 0) - (b.ts || 0));

    const errorCount    = timeline.filter(e => e.isError).length;
    const recoveryCount = timeline.filter(e => e.type === "recovery").length;

    return {
        available:  true,
        sessionId,
        sessionGoal: session ? session.goal : null,
        timeline,
        errorCount,
        recoveryCount,
        summary: `${timeline.length} event(s): ${errorCount} error(s), ${recoveryCount} recovery attempt(s)`,
    };
}

module.exports = { activate, deactivate, getState, logError, clusterErrors, focusedRecoverySuggestions, debugTimeline };
