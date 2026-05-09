"use strict";
const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/security");
const LOG_DIR  = path.join(__dirname, "../../data/security/_logs");

const THREAT_LEVELS = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

const BLOCK_THRESHOLD = 3; // HIGH+

function _ensure(userId) {
    const dir = path.join(DATA_DIR, _safeId(userId));
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

function _safeId(id) {
    return String(id || "anon").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function load(userId, key, def = {}) {
    _ensure(userId);
    const file = path.join(DATA_DIR, _safeId(userId), `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); }
    catch {}
    return def instanceof Array ? [] : { ...def };
}

function flush(userId, key, data) {
    _ensure(userId);
    fs.writeFileSync(path.join(DATA_DIR, _safeId(userId), `${key}.json`), JSON.stringify(data, null, 2));
}

function uid(p = "sec") {
    return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}
function NOW() { return new Date().toISOString(); }

// Mandatory security event log — all suspicious activity recorded
function securityLog(agent, userId, eventType, detail = {}, threatLevel = "INFO") {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const entry = { id: uid("sl"), agent, userId: _safeId(userId), eventType, threatLevel, detail, timestamp: NOW() };
    const file  = path.join(LOG_DIR, `security_${new Date().toISOString().slice(0,10)}.json`);
    let log = [];
    try { if (fs.existsSync(file)) log = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    return entry.id;
}

function scoreThreat(indicators = []) {
    const weights = {
        knownMaliciousIP:4, bruteForce:3, sqlInjection:4, xss:3, unusualGeoLocation:2,
        multipleFailedLogins:2, largeDataExfiltration:4, privilegeEscalation:4,
        suspiciousScript:3, phishingLink:3, malwareSignature:4, highValueTransaction:2,
        oddHours:1, newDevice:1, vpnTor:2
    };
    const score = indicators.reduce((s, i) => s + (weights[i] || 1), 0);
    if (score >= 8) return { level: "CRITICAL", score, block: true };
    if (score >= 5) return { level: "HIGH",     score, block: true };
    if (score >= 2) return { level: "MEDIUM",   score, block: false };
    return              { level: "LOW",          score, block: false };
}

function ok(agent, data, meta = {}) {
    return { success: true, type: "security", agent, data, ...meta };
}
function fail(agent, error, code = 400) {
    return { success: false, type: "security", agent, error: String(error), code };
}
function blocked(agent, reason, level = "HIGH") {
    return { success: false, type: "security", agent, error: `🚨 SECURITY BLOCK [${level}]: ${reason}`, code: 403, blocked: true };
}
function alert_(agent, message, level = "HIGH") {
    return { success: true, type: "security", agent, alert: true, alertLevel: level, message, timestamp: NOW() };
}

module.exports = { load, flush, uid, NOW, securityLog, scoreThreat, ok, fail, blocked, alert_, THREAT_LEVELS, BLOCK_THRESHOLD, _safeId };
