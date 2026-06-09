"use strict";
/**
 * Phase 576 — Debugging Assist Mode
 *
 * Focused debugging workflow: runtime-failure clustering, root-cause
 * suggestions, replay-linked debugging, dependency issue detection,
 * validation-first recovery. Reduces noise and repeated overlays.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/debug-assist-mode.json");

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { active: false, sessionId: null, activatedAt: null, errorLog: [], suppressedOverlays: {} }; }
}
function _save(s) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); } catch {}
}

// ── Mode lifecycle ────────────────────────────────────────────────────────────

function activate(sessionId, goal = "") {
    const state = { active: true, sessionId: sessionId || null, goal: (goal || "").slice(0, 200), activatedAt: Date.now(), errorLog: [], suppressedOverlays: {} };
    _save(state);
    return { ok: true, debugAssistMode: true, sessionId, goal };
}

function deactivate() {
    const state = _load();
    state.active = false;
    _save(state);
    return { ok: true, debugAssistMode: false };
}

function getState() { return _load(); }

// ── Error ingestion ───────────────────────────────────────────────────────────

function ingestError(message, ctx = {}) {
    const state = _load();
    state.errorLog = [{ message: (message || "").slice(0, 500), ctx, ts: Date.now() }, ...(state.errorLog || [])].slice(0, 200);
    _save(state);
}

// ── Root-cause suggestions ────────────────────────────────────────────────────

const ROOT_CAUSE_DB = [
    { pattern: /cannot find module|module not found/i,        cause: "missing-dependency",  fix: "Run: npm ci",              confidence: 88 },
    { pattern: /econnrefused|connection refused/i,             cause: "service-down",        fix: "Check: pm2 status",        confidence: 85 },
    { pattern: /syntax.*error|unexpected token/i,             cause: "syntax-error",        fix: "Run: node --check <file>", confidence: 90 },
    { pattern: /enoent.*\.env/i,                              cause: "missing-env",         fix: "Create .env from .env.example", confidence: 85 },
    { pattern: /jwt.*invalid|token.*expired/i,                cause: "auth-token-issue",    fix: "Regenerate JWT secret",    confidence: 80 },
    { pattern: /etimedout|timeout/i,                          cause: "network-timeout",     fix: "Check network / firewall", confidence: 75 },
    { pattern: /eacces|permission denied/i,                   cause: "permissions",         fix: "Check file/port permissions", confidence: 82 },
    { pattern: /port.*in use|eaddrinuse/i,                    cause: "port-conflict",       fix: "Run: lsof -i :<port>",     confidence: 90 },
    { pattern: /heap out of memory|javascript heap/i,         cause: "memory-exhaustion",   fix: "Increase --max-old-space-size or reduce concurrency", confidence: 85 },
    { pattern: /nginx|502 bad gateway|503 service/i,          cause: "proxy-failure",       fix: "Check nginx config + upstream process", confidence: 82 },
];

/**
 * Suggest root causes for a set of error messages.
 */
function rootCauseSuggestions(errors = []) {
    const combined = errors.join("\n");
    const matches  = [];
    const seen     = new Set();

    for (const rule of ROOT_CAUSE_DB) {
        if (rule.pattern.test(combined) && !seen.has(rule.cause)) {
            seen.add(rule.cause);
            matches.push({ cause: rule.cause, fix: rule.fix, confidence: rule.confidence });
        }
    }

    if (matches.length === 0) {
        matches.push({ cause: "unknown", fix: "Check logs: pm2 logs --lines 100", confidence: 40 });
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
}

// ── Dependency issue detection ────────────────────────────────────────────────

function detectDependencyIssues(errorTexts = []) {
    const combined = errorTexts.join(" ").toLowerCase();
    const issues   = [];

    if (/cannot find module|module not found/.test(combined))
        issues.push({ type: "missing-module",   severity: "high",   action: "npm ci" });
    if (/peer dep|peer dependency/.test(combined))
        issues.push({ type: "peer-conflict",    severity: "medium", action: "npm install --legacy-peer-deps" });
    if (/version.*required|engine.*node/i.test(combined))
        issues.push({ type: "version-mismatch", severity: "medium", action: "Use nvm to switch Node version" });
    if (/lock.*file|package-lock/.test(combined))
        issues.push({ type: "lockfile-drift",   severity: "low",    action: "npm ci (from lockfile)" });

    return issues;
}

// ── Overlay suppression (noise reduction) ────────────────────────────────────

const OVERLAY_COOLDOWN_MS = 15 * 60 * 1000; // 15 min

/**
 * Should we show a given overlay type right now?
 * Suppresses repeated identical overlays within the cooldown window.
 */
function shouldShowOverlay(overlayType, sessionId = null) {
    const state = _load();
    const key   = `${sessionId || "global"}:${overlayType}`;
    const last  = (state.suppressedOverlays || {})[key] || 0;
    const now   = Date.now();

    if (now - last < OVERLAY_COOLDOWN_MS) {
        return { show: false, reason: `Overlay '${overlayType}' shown ${Math.round((now - last) / 1000)}s ago — suppressed` };
    }

    state.suppressedOverlays        = state.suppressedOverlays || {};
    state.suppressedOverlays[key]   = now;
    _save(state);
    return { show: true };
}

// ── Validation-first recovery planner ────────────────────────────────────────

/**
 * Build a validation-first recovery plan from root cause suggestions.
 */
function recoveryPlan(causes = [], goal = "") {
    const steps = [];

    // Step 0: always validate state first
    steps.push({ order: 0, type: "validate", action: "GET /api/runtime/dashboard", note: "Validate system state before any recovery", mandatory: true });

    causes.slice(0, 3).forEach((c, i) => {
        steps.push({ order: i + 1, type: "fix", cause: c.cause, action: c.fix, confidence: c.confidence, requiresApproval: true });
    });

    // Step last: verify after recovery
    steps.push({ order: steps.length, type: "verify", action: "curl -s http://localhost:5050/health", note: "Verify backend health after recovery", mandatory: true });

    return {
        goal,
        steps,
        validationFirst:  true,
        operatorApproval: true,
    };
}

module.exports = { activate, deactivate, getState, ingestError, rootCauseSuggestions, detectDependencyIssues, shouldShowOverlay, recoveryPlan };
