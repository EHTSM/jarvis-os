"use strict";
const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/legal");
const LOG_DIR  = path.join(__dirname, "../../data/legal/_audit");

const DISCLAIMER = "⚠️ This is AI-generated legal assistance only — NOT final legal advice. Always consult a qualified lawyer for decisions affecting your rights or obligations.";

const JURISDICTIONS = ["India","USA","UK","EU","Australia","Canada","Singapore","UAE","Global"];

const RISK_LEVELS = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH", CRITICAL: "CRITICAL" };

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
    catch { /* fresh */ }
    return def instanceof Array ? [] : { ...def };
}

function flush(userId, key, data) {
    _ensure(userId);
    fs.writeFileSync(path.join(DATA_DIR, _safeId(userId), `${key}.json`), JSON.stringify(data, null, 2));
}

function uid(p = "leg") {
    return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}
function NOW() { return new Date().toISOString(); }

// Mandatory audit log for ALL sensitive legal operations
function auditLog(agent, userId, action, detail = {}) {
    _ensure(userId);
    const entry = { id: uid("al"), agent, userId: _safeId(userId), action, detail, timestamp: NOW() };
    const file  = path.join(LOG_DIR, `audit_${new Date().toISOString().slice(0,10)}.json`);
    let log = [];
    try { if (fs.existsSync(file)) log = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    return entry.id;
}

// Risk scoring — blocks CRITICAL actions
function scoreRisk(factors = []) {
    const weights = { jurisdictionConflict:3, highValue:2, gdprRelevant:2, criminalElement:4, contractualDispute:1, ipClaim:2, regulatoryBreach:3 };
    const score   = factors.reduce((s, f) => s + (weights[f] || 1), 0);
    if (score >= 8) return RISK_LEVELS.CRITICAL;
    if (score >= 5) return RISK_LEVELS.HIGH;
    if (score >= 2) return RISK_LEVELS.MEDIUM;
    return RISK_LEVELS.LOW;
}

function ok(agent, data, meta = {}) {
    return { success: true, type: "legal", agent, disclaimer: DISCLAIMER, data, ...meta };
}
function fail(agent, error, code = 400) {
    return { success: false, type: "legal", agent, error: String(error), code, disclaimer: DISCLAIMER };
}
function blocked(agent, reason, riskLevel = "HIGH") {
    return { success: false, type: "legal", agent, error: `⚠️ BLOCKED [${riskLevel}]: ${reason}`, code: 403, blocked: true, disclaimer: DISCLAIMER };
}

module.exports = { load, flush, uid, NOW, auditLog, scoreRisk, ok, fail, blocked, DISCLAIMER, JURISDICTIONS, RISK_LEVELS, _safeId };
