"use strict";
/**
 * Phase 605 — Operational Trust Layer
 *
 * Tracks operator trust signals across the platform: execution reliability,
 * approval discipline, rollback frequency, recovery success, replay integrity.
 * Provides a trust score that gates high-risk operations.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/operational-trust.json");
const MAX_EVENTS  = 200;
const TTL_MS      = 7 * 24 * 60 * 60 * 1000; // 7 days

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { events: [], overrides: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.events = (db.events || []).filter(e => e.ts > cutoff).slice(0, MAX_EVENTS);
}

// ── Signal recording ──────────────────────────────────────────────────────────

const SIGNAL_WEIGHTS = {
    "deploy-success":      +3,
    "deploy-fail":         -2,
    "deploy-rollback":     -3,
    "patch-applied":       +1,
    "patch-rejected":      -1,
    "recovery-success":    +2,
    "recovery-fail":       -2,
    "replay-success":      +1,
    "replay-blocked":      -1,
    "approval-respected":  +1,
    "approval-bypassed":   -5,
    "debug-resolved":      +2,
    "debug-unresolved":    -1,
};

function recordSignal(signalType, { sessionId = null, detail = "" } = {}) {
    const weight = SIGNAL_WEIGHTS[signalType];
    if (weight === undefined) return { ok: false, error: `Unknown signal: ${signalType}` };
    const db = _load(); _prune(db);
    db.events.unshift({
        type:      signalType,
        weight,
        sessionId,
        detail:    (detail || "").slice(0, 100),
        ts:        Date.now(),
    });
    _save(db);
    return { ok: true, signalType, weight };
}

// ── Trust score ───────────────────────────────────────────────────────────────

const TRUST_BASELINE = 65; // Start with reasonable trust
const TRUST_MAX      = 95;
const TRUST_MIN      = 10;

function computeTrustScore(events = []) {
    if (events.length === 0) return TRUST_BASELINE;

    const total  = events.reduce((sum, e) => sum + e.weight, 0);
    const raw    = TRUST_BASELINE + total;
    return Math.max(TRUST_MIN, Math.min(TRUST_MAX, raw));
}

function getTrustScore({ windowMs = 7 * 24 * 60 * 60 * 1000 } = {}) {
    const db    = _load(); _prune(db);
    const since = Date.now() - windowMs;
    const events = db.events.filter(e => e.ts > since);

    const score  = computeTrustScore(events);
    const grade  = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "F";
    const recent = events.slice(0, 10).map(e => ({ type: e.type, weight: e.weight, ts: e.ts }));

    return {
        score,
        grade,
        signalCount: events.length,
        recentSignals: recent,
        summary: `Trust: ${score}/95 (${grade})`,
    };
}

// ── Operation gating ──────────────────────────────────────────────────────────

const TRUST_THRESHOLDS = {
    "deploy":    55,
    "rollback":  45,
    "patch":     40,
    "recovery":  35,
    "replay":    30,
};

function gateOperation(operationType) {
    const threshold = TRUST_THRESHOLDS[operationType];
    if (!threshold) return { ok: true, reason: "no threshold for this operation" };

    const { score, grade } = getTrustScore();
    if (score >= threshold) {
        return { ok: true, score, grade, threshold, operation: operationType };
    }
    return {
        ok:        false,
        blocked:   true,
        score,
        grade,
        threshold,
        operation: operationType,
        reason:    `Trust score ${score} below threshold ${threshold} for '${operationType}'`,
    };
}

// ── Override management ───────────────────────────────────────────────────────

function addTrustOverride(operationType, { reason = "", expiresInMs = 60 * 60 * 1000, operatorId = null } = {}) {
    const db = _load();
    db.overrides = (db.overrides || []).filter(o => Date.now() < o.expiresAt && o.operationType !== operationType);
    db.overrides.push({
        operationType,
        reason:     (reason || "").slice(0, 200),
        operatorId,
        grantedAt:  Date.now(),
        expiresAt:  Date.now() + expiresInMs,
    });
    _save(db);
    return { ok: true, operationType, expiresAt: new Date(Date.now() + expiresInMs).toISOString() };
}

function trustReport() {
    const trust = getTrustScore();
    const db    = _load(); _prune(db);
    const activeOverrides = (db.overrides || []).filter(o => Date.now() < o.expiresAt);

    // Pull signals from daily validation if available
    const dv = _tryRequire("./dailyEngineeringValidation.cjs");
    let todayMetrics = null;
    if (dv) try { todayMetrics = dv.todayReport(); } catch {}

    return {
        ok:             true,
        trust,
        activeOverrides: activeOverrides.length,
        overrides:      activeOverrides.map(o => ({ type: o.operationType, reason: o.reason, expiresAt: new Date(o.expiresAt).toISOString() })),
        todayMetrics,
        gates: Object.keys(TRUST_THRESHOLDS).map(op => gateOperation(op)),
    };
}

module.exports = { recordSignal, getTrustScore, gateOperation, addTrustOverride, trustReport, SIGNAL_WEIGHTS };
