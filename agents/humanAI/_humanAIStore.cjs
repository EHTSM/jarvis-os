"use strict";
const path   = require("path");
const fs     = require("fs");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data/humanAI");
const LOG_DIR  = path.join(__dirname, "../../data/humanAI/_logs");

function _ensureDir(dir) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); }

function NOW()               { return new Date().toISOString(); }
function uid(prefix = "hai") { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; }

// ── Per-user data isolation ───────────────────────────────────────
function load(userId, key, def = null) {
    _ensureDir(path.join(DATA_DIR, userId));
    const file = path.join(DATA_DIR, userId, `${key}.json`);
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; }
}
function flush(userId, key, data) {
    _ensureDir(path.join(DATA_DIR, userId));
    fs.writeFileSync(path.join(DATA_DIR, userId, `${key}.json`), JSON.stringify(data, null, 2));
}

// ── Mandatory audit log ──────────────────────────────────────────
function humanAILog(agent, userId, action, detail = {}, level = "INFO") {
    _ensureDir(LOG_DIR);
    const entry = { id:uid("log"), agent, userId, action, detail, level, timestamp:NOW() };
    const file  = path.join(LOG_DIR, `humanai_${NOW().slice(0,10)}.json`);
    let   log   = [];
    try { log = JSON.parse(fs.readFileSync(file,"utf8")); } catch {}
    log.push(entry);
    fs.writeFileSync(file, JSON.stringify(log, null, 2));
    return entry.id;
}

// ── MANDATORY CONSENT GATE ────────────────────────────────────────
// Every function that touches personal data MUST call this first.
// If consent is not explicitly true → the action is blocked.
function requireConsent(consent, purpose = "personal data usage") {
    if (consent !== true) {
        return {
            blocked:  true,
            error:    `⚠️ CONSENT REQUIRED — Action blocked. You must pass consent:true to authorise ${purpose}.`,
            code:     403,
            guidance: "Pass { consent: true } to explicitly authorise this action. Consent can be revoked at any time."
        };
    }
    return null; // null = consent granted, proceed
}

// ── Watermark — injected into every generated identity/voice/avatar output ──
function watermark(agentName) {
    return {
        isSimulation:     true,
        watermark:        `JARVIS-AI-SIMULATION | Agent: ${agentName} | Generated: ${NOW()}`,
        generatedBy:      "Jarvis OS HumanAI Layer",
        hash:             crypto.createHash("sha256").update(agentName + NOW()).digest("hex").slice(0, 16),
        legalNotice:      "SIMULATION ONLY. This output does NOT represent a real person, real identity, real voice, or real consciousness. No biometric data was used."
    };
}

// ── Safety disclaimers ────────────────────────────────────────────
const HUMANAI_DISCLAIMER =
    "⚠️ SIMULATION ONLY — This output does NOT clone, replicate, or impersonate any real person. " +
    "No biometric data, real neural data, or real identity information is processed. " +
    "All personality, voice, and behaviour models are algorithmic simulations with user consent.";

const BCI_DISCLAIMER =
    "⚠️ BCI SIMULATION — No real brain-computer interface hardware is accessed. " +
    "This is a text-based simulation of neural input/output patterns only.";

// ── Standard response shapes ──────────────────────────────────────
function ok(agent, data, meta = {}) {
    return { success:true, type:"humanAI", agent, consent:true, data, disclaimer:HUMANAI_DISCLAIMER, timestamp:NOW(), ...meta };
}
function fail(agent, reason) {
    return { success:false, type:"humanAI", agent, error:reason, timestamp:NOW() };
}
function blocked(agent, reason, code = 403) {
    return { success:false, type:"humanAI", agent, error:`⚠️ BLOCKED: ${reason}`, code, timestamp:NOW() };
}

module.exports = {
    load, flush, uid, NOW,
    humanAILog, requireConsent, watermark,
    ok, fail, blocked,
    HUMANAI_DISCLAIMER, BCI_DISCLAIMER
};
