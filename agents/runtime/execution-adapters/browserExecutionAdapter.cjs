"use strict";
/**
 * browserExecutionAdapter — controlled browser navigation adapter.
 *
 * navigateUrl(spec)        → { navigated, executionId, url }
 * captureScreenshot(spec)  → { captured, executionId, screenshotRef }
 * validateUrl(spec)        → { valid, reason }
 * getBrowserLog()          → BrowserRecord[]
 * getAdapterMetrics()      → AdapterMetrics
 * reset()
 *
 * Safety: deny javascript:/data:/file:/vbscript: URIs, credential-bearing URLs,
 * executable downloads, and localhost in controlled mode.
 * Navigation requires operator+. Screenshots are observer-permitted.
 */

const DENY_URL_PATTERNS = [
    /^javascript:/i,
    /^data:/i,
    /^file:/i,
    /^vbscript:/i,
    /[?&]password=/i,
    /[?&]token=/i,
    /\/credentials\//i,
    /\.exe$/i,
    /\.dmg$/i,
    /\.sh$/i,
    /\.bat$/i,
    /\.ps1$/i,
];

const DENY_HOSTNAMES = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

const ALLOWED_SCHEMES = ["https:", "http:"];

const AUTHORITY_RANK = {
    observer: 0, operator: 1, controller: 2, governor: 3, "root-runtime": 4,
};

let _browserLog = [];
let _counter    = 0;

// ── validateUrl ───────────────────────────────────────────────────────

function validateUrl(spec = {}) {
    const { url = null } = spec;
    if (!url) return { valid: false, reason: "url_required" };

    for (const pattern of DENY_URL_PATTERNS) {
        if (pattern.test(url))
            return { valid: false, reason: "url_matches_deny_pattern", url };
    }

    let parsed;
    try { parsed = new URL(url); }
    catch { return { valid: false, reason: "invalid_url_format", url }; }

    if (!ALLOWED_SCHEMES.includes(parsed.protocol))
        return { valid: false, reason: `scheme_not_allowed: ${parsed.protocol}`, url };

    if (DENY_HOSTNAMES.includes(parsed.hostname))
        return { valid: false, reason: "hostname_denied", url, hostname: parsed.hostname };

    return { valid: true, url, hostname: parsed.hostname };
}

// ── navigateUrl ───────────────────────────────────────────────────────

function navigateUrl(spec = {}) {
    const { url = null, workflowId = null, authorityLevel = null } = spec;

    if (!authorityLevel || (AUTHORITY_RANK[authorityLevel] ?? -1) < AUTHORITY_RANK.operator)
        return { navigated: false, reason: "insufficient_authority_for_navigation", required: "operator" };

    const v = validateUrl({ url });
    if (!v.valid) return { navigated: false, reason: v.reason, url };

    const executionId = `browser-exec-${++_counter}`;
    _browserLog.push({
        executionId, op: "navigate", url: v.url,
        authorityLevel, workflowId, ts: new Date().toISOString(),
    });

    return {
        navigated: true, executionId, url: v.url,
        title: `[simulated title: ${v.hostname}]`,
        workflowId, authorityLevel,
    };
}

// ── captureScreenshot ─────────────────────────────────────────────────

function captureScreenshot(spec = {}) {
    const { url = null, workflowId = null, authorityLevel = "observer" } = spec;
    if (!url) return { captured: false, reason: "url_required" };

    const v = validateUrl({ url });
    if (!v.valid) return { captured: false, reason: v.reason, url };

    const executionId = `browser-exec-${++_counter}`;
    _browserLog.push({
        executionId, op: "screenshot", url: v.url,
        authorityLevel, workflowId, ts: new Date().toISOString(),
    });

    return {
        captured: true, executionId, url: v.url,
        screenshotRef: `[screenshot-${executionId}]`,
        workflowId, authorityLevel,
    };
}

// ── getBrowserLog ─────────────────────────────────────────────────────

function getBrowserLog() {
    return [..._browserLog];
}

// ── getAdapterMetrics ─────────────────────────────────────────────────

function getAdapterMetrics() {
    const byOp = {};
    for (const r of _browserLog) byOp[r.op] = (byOp[r.op] ?? 0) + 1;
    return {
        totalExecutions: _browserLog.length,
        byOperation:     byOp,
        adapterType:     "browser",
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _browserLog = [];
    _counter    = 0;
}

module.exports = {
    DENY_URL_PATTERNS, DENY_HOSTNAMES, ALLOWED_SCHEMES,
    validateUrl, navigateUrl, captureScreenshot,
    getBrowserLog, getAdapterMetrics, reset,
};
