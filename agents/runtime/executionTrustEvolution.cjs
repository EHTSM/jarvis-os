"use strict";
/**
 * Phase 622 — Execution Trust Evolution
 *
 * Tracks trust progression over time: autonomous recoveries, failed chains,
 * rollback reliability, deployment trust quality, workflow survivability.
 * Generates trust progression metrics, autonomy safety scoring,
 * operational confidence summaries.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/trust-evolution.json");
const MAX_EVENTS = 300;
const TTL_MS     = 30 * 24 * 60 * 60 * 1000; // 30 days

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { events: [], snapshots: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.events    = (db.events    || []).filter(e => e.ts > cutoff).slice(0, MAX_EVENTS);
    db.snapshots = (db.snapshots || []).filter(s => s.ts > cutoff).slice(0, 90);
}

// ── Event categories ──────────────────────────────────────────────────────────

const EVENT_IMPACT = {
    "autonomous-recovery-success":  +4,
    "autonomous-recovery-fail":     -3,
    "chain-completed":              +2,
    "chain-failed":                 -2,
    "chain-interrupted":            -1,
    "rollback-success":             +2,
    "rollback-fail":                -3,
    "deployment-success":           +3,
    "deployment-fail":              -2,
    "patch-applied":                +1,
    "patch-rejected":               -1,
    "replay-success":               +1,
    "replay-blocked":               -1,
    "unsafe-state-detected":        -5,
    "approval-respected":           +2,
    "validation-passed":            +1,
    "survivability-above-80":       +1,
    "trust-override-used":          -2,
};

function recordTrustEvent(eventType, { detail = "", sessionId = null } = {}) {
    const impact = EVENT_IMPACT[eventType];
    if (impact === undefined) return { ok: false, error: `Unknown event type: ${eventType}` };

    const db = _load(); _prune(db);
    db.events.unshift({ type: eventType, impact, detail: (detail || "").slice(0, 100), sessionId, ts: Date.now() });
    _save(db);
    return { ok: true, eventType, impact };
}

// ── Trust progression ─────────────────────────────────────────────────────────

const BASE_TRUST = 60;
const MAX_TRUST  = 95;
const MIN_TRUST  = 5;
const DECAY_PER_DAY = 2; // organic decay toward base if inactive

function computeTrustProgression(events = []) {
    if (events.length === 0) return BASE_TRUST;

    // Weight recent events more
    const now   = Date.now();
    const total = events.reduce((sum, e) => {
        const ageHours = (now - e.ts) / (60 * 60 * 1000);
        const weight   = Math.max(0.3, 1 - ageHours / 168); // decay over 7 days
        return sum + e.impact * weight;
    }, 0);

    return Math.max(MIN_TRUST, Math.min(MAX_TRUST, Math.round(BASE_TRUST + total)));
}

function trustProgression({ windowDays = 30 } = {}) {
    const db     = _load(); _prune(db);
    const window = windowDays * 24 * 60 * 60 * 1000;
    const since  = Date.now() - window;
    const events = db.events.filter(e => e.ts > since);

    // Daily buckets
    const dayBuckets = new Map();
    events.forEach(e => {
        const day = new Date(e.ts).toISOString().slice(0, 10);
        if (!dayBuckets.has(day)) dayBuckets.set(day, []);
        dayBuckets.get(day).push(e);
    });

    const daily = [];
    let running = BASE_TRUST;
    for (const [day, evts] of [...dayBuckets.entries()].sort()) {
        const impact = evts.reduce((s, e) => s + e.impact, 0);
        running      = Math.max(MIN_TRUST, Math.min(MAX_TRUST, running + impact));
        daily.push({ day, trust: running, events: evts.length, netImpact: impact });
    }

    const current = computeTrustProgression(events);
    const trend   = daily.length >= 2 ? (daily[daily.length - 1].trust - daily[0].trust) : 0;

    return {
        current,
        trend:    trend > 2 ? "improving" : trend < -2 ? "declining" : "stable",
        trendValue: trend,
        daily,
        eventCount: events.length,
        grade:    current >= 80 ? "A" : current >= 65 ? "B" : current >= 50 ? "C" : current >= 35 ? "D" : "F",
    };
}

// ── Autonomy safety score ─────────────────────────────────────────────────────

function autonomySafetyScore() {
    const db = _load(); _prune(db);
    const recent = db.events.filter(e => Date.now() - e.ts < 7 * 24 * 60 * 60 * 1000);

    const unsafeSignals   = recent.filter(e => e.type === "unsafe-state-detected").length;
    const approvalViolations = recent.filter(e => e.type === "trust-override-used").length;
    const successfulAuto  = recent.filter(e => e.type === "autonomous-recovery-success").length;
    const totalAuto       = recent.filter(e => e.type.startsWith("autonomous-")).length;

    const autoSuccessRate = totalAuto > 0 ? successfulAuto / totalAuto : 1;
    const penaltyScore    = Math.max(0, 100 - unsafeSignals * 15 - approvalViolations * 20);
    const score           = Math.min(95, Math.round((autoSuccessRate * 0.6 + penaltyScore / 100 * 0.4) * 100));

    return {
        score,
        grade:              score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : "D",
        autonomousSuccessRate: Math.round(autoSuccessRate * 100) + "%",
        unsafeSignals,
        approvalViolations,
        summary:            `Autonomy safety: ${score}/95`,
    };
}

// ── Daily snapshot ────────────────────────────────────────────────────────────

function takeSnapshot() {
    const progression = trustProgression({ windowDays: 7 });
    const safety      = autonomySafetyScore();

    const db = _load(); _prune(db);
    db.snapshots.unshift({
        ts:        Date.now(),
        day:       new Date().toISOString().slice(0, 10),
        trust:     progression.current,
        safety:    safety.score,
        trend:     progression.trend,
    });
    _save(db);

    return { ok: true, trust: progression.current, safety: safety.score, trend: progression.trend };
}

// ── Operational confidence summary ────────────────────────────────────────────

function confidenceSummary() {
    const progression = trustProgression({ windowDays: 7 });
    const safety      = autonomySafetyScore();

    // Pull from operational trust layer
    const otl   = _tryRequire("./operationalTrustLayer.cjs");
    let baseline = null;
    if (otl) try { baseline = otl.getTrustScore(); } catch {}

    return {
        ok:              true,
        trustProgression: progression.current,
        trustTrend:      progression.trend,
        autonomySafety:  safety.score,
        baselineTrust:   baseline?.score || null,
        overall:         Math.round((progression.current + safety.score + (baseline?.score || 65)) / 3),
        grade:           progression.grade,
        summary:         `Trust: ${progression.current} (${progression.trend}) | Safety: ${safety.score} | Baseline: ${baseline?.score || "n/a"}`,
    };
}

module.exports = { recordTrustEvent, trustProgression, autonomySafetyScore, takeSnapshot, confidenceSummary, EVENT_IMPACT };
