"use strict";
const fs   = require("fs");
const path = require("path");

const DATA_DIR    = path.join(__dirname, "../../data/governance");
const GLOBAL_DIR  = path.join(DATA_DIR, "_global");
const AUDIT_DIR   = path.join(DATA_DIR, "_audit");

const GOV_DISCLAIMER = "Governance outputs are advisory. Binding decisions require authorised human review and approval.";

const RISK_BANDS = { NEGLIGIBLE:"NEGLIGIBLE", LOW:"LOW", MEDIUM:"MEDIUM", HIGH:"HIGH", CRITICAL:"CRITICAL" };

function _ensure(userId) {
    const dir = userId ? path.join(DATA_DIR, _safeId(userId)) : GLOBAL_DIR;
    [dir, GLOBAL_DIR, AUDIT_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }));
}

function _safeId(id) {
    return String(id || "anon").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function load(userId, key, def = {}) {
    _ensure(userId);
    const file = path.join(DATA_DIR, _safeId(userId), `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    return def instanceof Array ? [] : { ...def };
}

function flush(userId, key, data) {
    _ensure(userId);
    fs.writeFileSync(path.join(DATA_DIR, _safeId(userId), `${key}.json`), JSON.stringify(data, null, 2));
}

function loadGlobal(key, def = {}) {
    _ensure(null);
    const file = path.join(GLOBAL_DIR, `${key}.json`);
    try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    return def instanceof Array ? [] : { ...def };
}

function flushGlobal(key, data) {
    _ensure(null);
    fs.writeFileSync(path.join(GLOBAL_DIR, `${key}.json`), JSON.stringify(data, null, 2));
}

function uid(p = "gov") {
    return `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
}
function NOW() { return new Date().toISOString(); }

// Immutable governance audit trail
function govAudit(agent, userId, action, detail = {}) {
    _ensure(userId);
    const entry = { id: uid("ga"), agent, userId: userId ? _safeId(userId) : "system", action, detail, timestamp: NOW() };
    const file  = path.join(AUDIT_DIR, `gov_audit_${new Date().toISOString().slice(0,10)}.json`);
    let log = [];
    try { if (fs.existsSync(file)) log = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    return entry.id;
}

function scoreRisk(factors = []) {
    const map = { regulatory:3, dataPrivacy:3, financialExposure:4, reputational:2, operational:2, legal:3, ethical:2, environmental:1, cyber:3, strategic:2 };
    const score = factors.reduce((s, f) => s + (map[f] || 1), 0);
    const likelihood = Math.min(10, score);
    const band = score >= 10 ? "CRITICAL" : score >= 7 ? "HIGH" : score >= 4 ? "MEDIUM" : score >= 2 ? "LOW" : "NEGLIGIBLE";
    return { score, likelihood, band };
}

function ok(agent, data, meta = {}) {
    return { success: true, type: "governance", agent, disclaimer: GOV_DISCLAIMER, data, ...meta };
}
function fail(agent, error, code = 400) {
    return { success: false, type: "governance", agent, error: String(error), code };
}
function blocked(agent, reason) {
    return { success: false, type: "governance", agent, error: `🚫 GOVERNANCE BLOCK: ${reason}`, code: 403, blocked: true };
}

module.exports = { load, flush, loadGlobal, flushGlobal, uid, NOW, govAudit, scoreRisk, ok, fail, blocked, GOV_DISCLAIMER, RISK_BANDS, _safeId };
