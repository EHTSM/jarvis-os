"use strict";
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data/ultimate");
const LOG_DIR  = path.join(DATA_DIR, "_logs");

// ── SYSTEM LIMITS (hard-coded, never overridden) ─────────────────
const LIMITS = Object.freeze({
    MAX_EXECUTION_LOOPS:  3,
    MAX_CONCURRENT_TASKS: 5,
    MAX_RISK_SCORE:       70,   // 0-100; above this = blocked without admin approval
    CRITICAL_RISK_SCORE:  90,   // above this = always blocked, kill-switch candidate
    KILL_SWITCH_FILE:     path.join(DATA_DIR, "_kill_switch.json"),
    ADMIN_STATE_FILE:     path.join(DATA_DIR, "_admin_state.json")
});

function _ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }
function NOW()              { return new Date().toISOString(); }
function uid(prefix = "ult"){ return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; }
function hash(data)         { return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0,16); }

// ── Persistent key-value store ───────────────────────────────────
function load(key, def = null) {
    _ensureDir(DATA_DIR);
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${key}.json`), "utf8")); } catch { return def; }
}
function flush(key, data) {
    _ensureDir(DATA_DIR);
    fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

// ── Audit log ─────────────────────────────────────────────────────
function ultimateLog(agent, action, detail = {}, level = "INFO") {
    _ensureDir(LOG_DIR);
    const entry = { id: uid("log"), agent, action, detail, level, timestamp: NOW() };
    const file  = path.join(LOG_DIR, `ultimate_${NOW().slice(0,10)}.json`);
    let log = [];
    try { log = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    return entry.id;
}

// ── Kill switch state ─────────────────────────────────────────────
function isKillSwitchActive() {
    try {
        const state = JSON.parse(fs.readFileSync(LIMITS.KILL_SWITCH_FILE, "utf8"));
        return state.active === true;
    } catch { return false; }
}
function setKillSwitch(active, reason, adminId) {
    _ensureDir(DATA_DIR);
    const state = { active, reason: reason || "", activatedBy: adminId || "system", timestamp: NOW() };
    fs.writeFileSync(LIMITS.KILL_SWITCH_FILE, JSON.stringify(state, null, 2));
    ultimateLog("killSwitch", active ? "KILL_SWITCH_ACTIVATED" : "KILL_SWITCH_DEACTIVATED", { reason, adminId }, active ? "CRITICAL" : "WARN");
    return state;
}

// ── Admin state ───────────────────────────────────────────────────
function getAdminState() {
    try { return JSON.parse(fs.readFileSync(LIMITS.ADMIN_STATE_FILE, "utf8")); }
    catch { return { admins: [], pendingApprovals: [] }; }
}
function flushAdminState(state) {
    _ensureDir(DATA_DIR);
    fs.writeFileSync(LIMITS.ADMIN_STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Standard response shapes ──────────────────────────────────────
function ok(agent, data, status = "approved") {
    return { success: true, type: "ultimate", agent, status, data, timestamp: NOW() };
}
function fail(agent, reason) {
    return { success: false, type: "ultimate", agent, status: "error", error: reason, timestamp: NOW() };
}
function blocked(agent, reason, riskScore) {
    ultimateLog(agent, "ACTION_BLOCKED", { reason, riskScore }, "WARN");
    return { success: false, type: "ultimate", agent, status: "blocked", error: `⚠️ BLOCKED: ${reason}`, riskScore: riskScore || null, timestamp: NOW() };
}
function killed(agent) {
    return { success: false, type: "ultimate", agent, status: "kill_switch_active", error: "🛑 SYSTEM HALT — Kill switch is active. All autonomous operations suspended.", timestamp: NOW() };
}

module.exports = {
    LIMITS,
    load, flush,
    ultimateLog,
    isKillSwitchActive, setKillSwitch,
    getAdminState, flushAdminState,
    uid, NOW, hash,
    ok, fail, blocked, killed
};
