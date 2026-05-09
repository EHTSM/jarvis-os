"use strict";
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data/futureTech");
const LOG_DIR  = path.join(__dirname, "../../data/futureTech/_logs");

function _ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function NOW()              { return new Date().toISOString(); }
function uid(prefix = "ft") { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; }
function hash(data)         { return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0,16); }

// ── Persistent storage ───────────────────────────────────────────
function load(key, def = null) {
    _ensureDir(DATA_DIR);
    const file = path.join(DATA_DIR, `${key}.json`);
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; }
}
function flush(key, data) {
    _ensureDir(DATA_DIR);
    fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}
function loadUser(userId, key, def = null) {
    _ensureDir(path.join(DATA_DIR, "users", userId));
    const file = path.join(DATA_DIR, "users", userId, `${key}.json`);
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; }
}
function flushUser(userId, key, data) {
    _ensureDir(path.join(DATA_DIR, "users", userId));
    fs.writeFileSync(path.join(DATA_DIR, "users", userId, `${key}.json`), JSON.stringify(data, null, 2));
}

// ── Audit log ────────────────────────────────────────────────────
function ftLog(agent, userId, action, detail = {}, level = "INFO") {
    _ensureDir(LOG_DIR);
    const entry = { id:uid("log"), agent, userId, action, detail, level, timestamp:NOW() };
    const file  = path.join(LOG_DIR, `ft_${NOW().slice(0,10)}.json`);
    let log = [];
    try { log = JSON.parse(fs.readFileSync(file,"utf8")); } catch {}
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    return entry.id;
}

// ── MANDATORY APPROVAL GATE for real-world control ───────────────
// Any action_type === "control" MUST pass approved:true or is blocked.
function requireApproval(approved, actionDescription) {
    if (approved !== true) {
        return {
            blocked:    true,
            success:    false,
            type:       "futureTech",
            mode:       "blocked",
            error:      `⚠️ APPROVAL REQUIRED — Real-world control action blocked.\nAction: "${actionDescription}"\nPass approved:true with explicit human authorisation to proceed.`,
            code:       403,
            guidance:   "Set approved:true only after a human operator has explicitly authorised this control action.",
            timestamp:  NOW()
        };
    }
    return null; // null = approved, proceed
}

// ── Simulation confidence helper ─────────────────────────────────
function simConfidence() { return Math.round(60 + Math.random() * 38); }
function simPercent()    { return parseFloat((Math.random() * 100).toFixed(2)); }
function simValue(min, max, decimals = 2) { return parseFloat((min + Math.random()*(max-min)).toFixed(decimals)); }

// ── Standard response shapes ─────────────────────────────────────
function ok(agent, data, mode = "simulation", meta = {}) {
    return { success:true, type:"futureTech", agent, mode, data, timestamp:NOW(), ...meta };
}
function fail(agent, reason) {
    return { success:false, type:"futureTech", agent, mode:"error", error:reason, timestamp:NOW() };
}
function blocked(agent, reason, code = 403) {
    return { success:false, type:"futureTech", agent, mode:"blocked", error:`⚠️ BLOCKED: ${reason}`, code, timestamp:NOW() };
}

module.exports = {
    load, flush, loadUser, flushUser,
    ftLog, requireApproval,
    simConfidence, simPercent, simValue,
    uid, NOW, hash,
    ok, fail, blocked
};
