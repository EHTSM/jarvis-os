"use strict";
/**
 * Shared store for the Media Layer.
 * Per-user project storage. Connects to existing analyticsAgent for tracking.
 * Enforces safety gates before any publish action.
 */
const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/media");

function _ensure(userId) {
    const dir = path.join(DATA_DIR, _safeId(userId));
    fs.mkdirSync(dir, { recursive: true });
}

function _safeId(id) {
    return String(id || "anon").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

// ── Storage ──────────────────────────────────────────────────────────
function load(userId, key, def = {}) {
    _ensure(userId);
    const file = path.join(DATA_DIR, _safeId(userId), `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { /* fresh */ }
    return def instanceof Array ? [] : { ...def };
}

function flush(userId, key, data) {
    _ensure(userId);
    fs.writeFileSync(path.join(DATA_DIR, _safeId(userId), `${key}.json`), JSON.stringify(data, null, 2));
}

// Global media store (cross-user: shared templates, OTT cache, etc.)
const GLOBAL_DIR = path.join(DATA_DIR, "_global");
function loadGlobal(key, def = {}) {
    fs.mkdirSync(GLOBAL_DIR, { recursive: true });
    const file = path.join(GLOBAL_DIR, `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch { /* fresh */ }
    return def instanceof Array ? [] : { ...def };
}
function flushGlobal(key, data) {
    fs.mkdirSync(GLOBAL_DIR, { recursive: true });
    fs.writeFileSync(path.join(GLOBAL_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

// ── Utilities ────────────────────────────────────────────────────────
function uid(p = "med") {
    return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}
function NOW() { return new Date().toISOString(); }

// ── Analytics bridge ─────────────────────────────────────────────────
function trackEvent(eventType, meta = {}) {
    try {
        const analytics = require("../business/analyticsAgent.cjs");
        if (analytics.track) analytics.track("api_call", { feature: "media", action: eventType, ...meta });
    } catch { /* analytics optional */ }
}

// ── Safety gates ─────────────────────────────────────────────────────
// Must be called before any publish/generate-with-likeness action
const CONSENT_REQUIRED_TYPES = new Set(["likeness","voice_clone","voice","avatar","deepfake","dubbing"]);

function requireSafeContext({ consent, source, watermark, contentType }) {
    if (CONSENT_REQUIRED_TYPES.has(contentType)) {
        if (!consent)    return { safe: false, reason: `Content type "${contentType}" requires explicit consent: { consent: true }` };
        if (!source)     return { safe: false, reason: "Source must be specified (e.g. source: 'user-owned')" };
        if (!watermark)  return { safe: false, reason: `watermark metadata is required for "${contentType}" content` };
    }
    return { safe: true };
}

// ── Standard response shapes ─────────────────────────────────────────
function ok(agent, data, meta = {}) {
    return { success: true, type: "media", agent, data, ...meta };
}
function fail(agent, error, code = 400) {
    return { success: false, type: "media", agent, error: String(error), code };
}
function blocked(agent, reason) {
    return { success: false, type: "media", agent, error: `SAFETY BLOCK: ${reason}`, code: 403, blocked: true };
}

module.exports = {
    load, flush, loadGlobal, flushGlobal,
    uid, NOW, trackEvent,
    requireSafeContext, ok, fail, blocked, _safeId
};
