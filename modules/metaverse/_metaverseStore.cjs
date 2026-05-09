"use strict";
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data/metaverse");
const LOG_DIR  = path.join(__dirname, "../../data/metaverse/_logs");

function _ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function NOW()               { return new Date().toISOString(); }
function uid(prefix = "mv")  { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; }
function hash(data)          { return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0,16); }

// ── Per-world / per-user data isolation ──────────────────────────
function loadWorld(worldId, def = null) {
    _ensureDir(DATA_DIR);
    const file = path.join(DATA_DIR, `world_${worldId}.json`);
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; }
}
function flushWorld(worldId, data) {
    _ensureDir(DATA_DIR);
    fs.writeFileSync(path.join(DATA_DIR, `world_${worldId}.json`), JSON.stringify(data, null, 2));
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
function loadGlobal(key, def = null) {
    _ensureDir(DATA_DIR);
    const file = path.join(DATA_DIR, `${key}.json`);
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; }
}
function flushGlobal(key, data) {
    _ensureDir(DATA_DIR);
    fs.writeFileSync(path.join(DATA_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

// ── World data model ─────────────────────────────────────────────
function newWorld(overrides = {}) {
    return {
        worldId:      overrides.worldId      || uid("wld"),
        name:         overrides.name         || "Unnamed World",
        worldType:    overrides.worldType    || "social",
        theme:        overrides.theme        || "default",
        status:       overrides.status       || "active",
        ownerId:      overrides.ownerId      || null,
        maxUsers:     overrides.maxUsers     || 100,
        physics:      overrides.physics      || "standard",
        assets:       [],
        users:        [],
        interactions: [],
        createdAt:    NOW(),
        updatedAt:    NOW()
    };
}

// ── Audit / transaction log ──────────────────────────────────────
function metaLog(agent, userId, action, detail = {}, level = "INFO") {
    _ensureDir(LOG_DIR);
    const entry = { id:uid("log"), agent, userId, action, detail, level, timestamp:NOW() };
    const file  = path.join(LOG_DIR, `meta_${NOW().slice(0,10)}.json`);
    let log = [];
    try { log = JSON.parse(fs.readFileSync(file,"utf8")); } catch {}
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    return entry.id;
}

// ── Security check (rate + anomaly) ─────────────────────────────
function rateCheck(userId, action, limitPerMinute = 30) {
    const key = `rate_${userId}_${action}`;
    const rec = loadUser(userId, key, { count:0, window: NOW() });
    const ageMs = Date.now() - new Date(rec.window).getTime();
    if (ageMs > 60000) { rec.count = 0; rec.window = NOW(); }
    rec.count++;
    flushUser(userId, key, rec);
    return rec.count <= limitPerMinute;
}

// ── Standard response shapes ─────────────────────────────────────
function ok(agent, data, meta = {}) {
    return { success:true, type:"metaverse", agent, data, timestamp:NOW(), ...meta };
}
function fail(agent, reason) {
    return { success:false, type:"metaverse", agent, error:reason, timestamp:NOW() };
}
function blocked(agent, reason, code = 403) {
    return { success:false, type:"metaverse", agent, error:`⚠️ BLOCKED: ${reason}`, code, timestamp:NOW() };
}

module.exports = {
    loadWorld, flushWorld, loadUser, flushUser, loadGlobal, flushGlobal,
    newWorld, metaLog, rateCheck, hash,
    uid, NOW,
    ok, fail, blocked
};
