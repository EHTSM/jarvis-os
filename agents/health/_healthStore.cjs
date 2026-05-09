/**
 * Shared store for the Health Layer.
 * All data is namespaced by userId — strict isolation enforced.
 * Mock encryption applied — replace with AES-256 at rest in production.
 */

"use strict";
const fs   = require("fs");
const path = require("path");

const DATA_DIR   = path.join(__dirname, "../../data/health");
const DISCLAIMER = "This is not medical advice. Always consult a qualified healthcare professional before making any health decisions.";

const EMERGENCY_NUMBERS = {
    india:          "112",
    ambulance:      "108",
    police:         "100",
    fire:           "101",
    poison_control: "1800-116-117",
    mental_health:  "iCall: 9152987821",
    women_helpline: "1091"
};

// ── Storage helpers ──────────────────────────────────────────────────
function _safeId(id) {
    return String(id).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function _ensure(userId) {
    const dir = path.join(DATA_DIR, _safeId(userId));
    fs.mkdirSync(dir, { recursive: true });
}

// Mock encryption — base64 wrapping; swap for node:crypto AES-256-CBC in production
function _encrypt(obj) {
    return Buffer.from(JSON.stringify(obj)).toString("base64");
}
function _decrypt(str) {
    try { return JSON.parse(Buffer.from(str, "base64").toString("utf8")); }
    catch { return str; }
}

function load(userId, key, def = {}, encrypted = false) {
    _ensure(userId);
    const file = path.join(DATA_DIR, _safeId(userId), `${key}.json`);
    try {
        if (fs.existsSync(file)) {
            const raw = JSON.parse(fs.readFileSync(file, "utf8"));
            return encrypted ? _decrypt(raw.payload) : raw;
        }
    } catch { /* fresh start */ }
    return def instanceof Array ? [] : { ...def };
}

function flush(userId, key, data, encrypted = false) {
    _ensure(userId);
    const payload = encrypted ? { payload: _encrypt(data) } : data;
    fs.writeFileSync(
        path.join(DATA_DIR, _safeId(userId), `${key}.json`),
        JSON.stringify(payload, null, 2)
    );
}

// ── Utilities ────────────────────────────────────────────────────────
function uid(p = "hlth") {
    return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}
function NOW() { return new Date().toISOString(); }

// Privacy-compliant access logging — required for health data
function accessLog(userId, agent, action, details = {}) {
    try {
        const logs = load(userId, "_access_log", []);
        logs.push({
            agent, action,
            meta: JSON.stringify(details).slice(0, 200),
            timestamp: NOW()
        });
        flush(userId, "_access_log", logs.slice(-5000));
    } catch { /* non-critical */ }
}

// ── Risk levels ──────────────────────────────────────────────────────
const RISK = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" };

// ── Standard response shapes ─────────────────────────────────────────
function ok(agent, data, meta = {}) {
    return { success: true, type: "health", agent, disclaimer: DISCLAIMER, data, ...meta };
}

function fail(agent, error, code = 400) {
    return { success: false, type: "health", agent, disclaimer: DISCLAIMER, error: String(error), code };
}

// For HIGH-risk situations — always surface emergency numbers
function escalate(agent, message, level = RISK.HIGH) {
    return {
        success: true, type: "health", agent,
        disclaimer: DISCLAIMER,
        riskLevel: level,
        escalation: true,
        message,
        action: level === RISK.HIGH
            ? "⚠️ URGENT: Please seek IMMEDIATE medical help. Call 112 (Emergency) or 108 (Ambulance) NOW."
            : "Please consult a doctor as soon as possible.",
        emergencyNumbers: EMERGENCY_NUMBERS,
        data: {}
    };
}

module.exports = {
    load, flush, uid, NOW,
    accessLog, ok, fail, escalate,
    DISCLAIMER, RISK, EMERGENCY_NUMBERS, _safeId
};
