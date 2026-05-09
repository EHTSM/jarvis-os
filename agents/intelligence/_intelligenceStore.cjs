"use strict";
const path = require("path");
const fs   = require("fs");

const DATA_DIR = path.join(__dirname, "../../data/intelligence");

function _ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function NOW()               { return new Date().toISOString(); }
function uid(prefix = "int") { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`; }

function load(userId, key, def = null) {
    _ensureDir(path.join(DATA_DIR, userId));
    const file = path.join(DATA_DIR, userId, `${key}.json`);
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return def; }
}

function flush(userId, key, data) {
    _ensureDir(path.join(DATA_DIR, userId));
    const file = path.join(DATA_DIR, userId, `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

// ── Safety limits (mandatory) ─────────────────────────────────────
const MAX_ITERATIONS = 3;
const MAX_IDEAS      = 5;
const MAX_DEPTH      = 3;
const MAX_THOUGHTS   = 10;
const PIPELINE_TIMEOUT_MS = 30000; // 30 s hard cap

const INTELLIGENCE_DISCLAIMER =
    "⚠️ SIMULATION ONLY — This system simulates intelligence patterns and reasoning structures. " +
    "It does NOT possess consciousness, AGI, or sentience. " +
    "All outputs are algorithmically generated reasoning models, not true cognitive processes.";

// ── Standard response shapes ──────────────────────────────────────
function ok(agent, data, meta = {}) {
    return { success: true, type: "intelligence", agent, data, disclaimer: INTELLIGENCE_DISCLAIMER, timestamp: NOW(), ...meta };
}
function fail(agent, reason) {
    return { success: false, type: "intelligence", agent, error: reason, timestamp: NOW() };
}
function blocked(agent, reason) {
    return { success: false, type: "intelligence", agent, error: `⛔ LIMIT REACHED: ${reason}`, code: 429, timestamp: NOW() };
}

// ── Reasoning quality scorer ──────────────────────────────────────
function scoreReasoning(text = "") {
    const words    = text.split(/\s+/).filter(Boolean).length;
    const hasWhy   = /why|because|therefore|thus|hence|reason/i.test(text);
    const hasHow   = /how|method|approach|strategy|step|process/i.test(text);
    const hasWhat  = /what|define|concept|idea|hypothesis/i.test(text);
    const hasEvid  = /evidence|data|research|study|experiment|test/i.test(text);
    const checks   = [words >= 10, hasWhy, hasHow, hasWhat, hasEvid];
    const score    = Math.round(checks.filter(Boolean).length / checks.length * 100);
    return { score, grade: score >= 80 ? "STRONG" : score >= 60 ? "GOOD" : score >= 40 ? "FAIR" : "WEAK" };
}

// ── Utility: truncate idea list to MAX_IDEAS ──────────────────────
function limitIdeas(arr) { return (arr || []).slice(0, MAX_IDEAS); }

module.exports = {
    load, flush, uid, NOW,
    ok, fail, blocked,
    INTELLIGENCE_DISCLAIMER,
    MAX_ITERATIONS, MAX_IDEAS, MAX_DEPTH, MAX_THOUGHTS, PIPELINE_TIMEOUT_MS,
    scoreReasoning, limitIdeas
};
