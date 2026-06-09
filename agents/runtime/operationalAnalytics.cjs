"use strict";
/**
 * Phase 458 — Operational Analytics Layer
 *
 * Tracks: workflow success rates, recovery effectiveness, runtime stability,
 * adapter reliability, deployment survivability.
 *
 * Lightweight, local-first, aggressively compressed.
 * Max 1000 raw events, 90-day TTL. Aggregates computed on read.
 * No telemetry spam — only records on explicit calls.
 *
 * Storage: data/operational-analytics.json
 */

const fs   = require("fs");
const path = require("path");

const ANALYTICS_PATH = path.join(__dirname, "../../data/operational-analytics.json");
const MAX_EVENTS     = 1000;
const TTL_MS         = 90 * 24 * 60 * 60 * 1000;

const EVENT_TYPES = ["workflow", "recovery", "adapter", "deployment", "session"];

function _load() {
    try { return JSON.parse(fs.readFileSync(ANALYTICS_PATH, "utf8")); }
    catch { return []; }
}

function _save(events) {
    try {
        const dir = path.dirname(ANALYTICS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(events, null, 2));
    } catch {}
}

function _prune(events) {
    const cutoff = Date.now() - TTL_MS;
    return events.filter(e => e.ts > cutoff).slice(-MAX_EVENTS);
}

function _append(event) {
    const events = _load();
    events.push({ ...event, ts: Date.now() });
    _save(_prune(events));
}

// ── Record functions ──────────────────────────────────────────────────────────

/** Record a workflow execution outcome. */
function recordWorkflow({ chainName, success, durationMs, stepCount, sessionId }) {
    _append({ type: "workflow", chainName, success: !!success, durationMs: durationMs || 0, stepCount: stepCount || 0, sessionId: sessionId || null });
}

/** Record a recovery attempt outcome. */
function recordRecovery({ chainName, recovered, attemptNumber, durationMs }) {
    _append({ type: "recovery", chainName, recovered: !!recovered, attemptNumber: attemptNumber || 1, durationMs: durationMs || 0 });
}

/** Record an adapter event. */
function recordAdapter({ adapter, event, healthy }) {
    _append({ type: "adapter", adapter, event: (event || "").slice(0, 40), healthy: !!healthy });
}

/** Record a deployment event. */
function recordDeployment({ flow, success, durationMs, rollback }) {
    _append({ type: "deployment", flow: (flow || "").slice(0, 60), success: !!success, durationMs: durationMs || 0, rollback: !!rollback });
}

/** Record a session lifecycle event. */
function recordSession({ sessionId, event, confidence, degradationState }) {
    _append({ type: "session", sessionId, event: (event || "").slice(0, 40), confidence: confidence ?? null, degradationState: degradationState || null });
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function _rate(events, successKey = "success") {
    if (!events.length) return null;
    const successes = events.filter(e => e[successKey]).length;
    return Math.round((successes / events.length) * 100);
}

function _avgMs(events) {
    const valid = events.filter(e => e.durationMs > 0);
    if (!valid.length) return null;
    return Math.round(valid.reduce((s, e) => s + e.durationMs, 0) / valid.length);
}

/**
 * Compute analytics summary.
 * @param {{ windowMs?: number }} opts — time window (default: all time)
 */
function summary({ windowMs } = {}) {
    let events = _prune(_load());
    if (windowMs) {
        const cutoff = Date.now() - windowMs;
        events = events.filter(e => e.ts > cutoff);
    }

    const workflows   = events.filter(e => e.type === "workflow");
    const recoveries  = events.filter(e => e.type === "recovery");
    const adapters    = events.filter(e => e.type === "adapter");
    const deployments = events.filter(e => e.type === "deployment");
    const sessions    = events.filter(e => e.type === "session");

    // Per-chain workflow stats
    const chainStats = {};
    for (const w of workflows) {
        if (!chainStats[w.chainName]) chainStats[w.chainName] = { runs: 0, successes: 0, totalMs: 0 };
        chainStats[w.chainName].runs++;
        if (w.success) chainStats[w.chainName].successes++;
        chainStats[w.chainName].totalMs += w.durationMs || 0;
    }
    const chainSummary = Object.entries(chainStats).map(([name, s]) => ({
        chain:       name,
        runs:        s.runs,
        successRate: Math.round((s.successes / s.runs) * 100),
        avgMs:       Math.round(s.totalMs / s.runs),
    })).sort((a, b) => b.runs - a.runs);

    // Per-adapter reliability
    const adapterStats = {};
    for (const a of adapters) {
        if (!adapterStats[a.adapter]) adapterStats[a.adapter] = { total: 0, healthy: 0 };
        adapterStats[a.adapter].total++;
        if (a.healthy) adapterStats[a.adapter].healthy++;
    }
    const adapterSummary = Object.entries(adapterStats).map(([adapter, s]) => ({
        adapter,
        reliability: Math.round((s.healthy / s.total) * 100),
        events: s.total,
    }));

    return {
        totalEvents:      events.length,
        window:           windowMs || null,
        workflows: {
            total:        workflows.length,
            successRate:  _rate(workflows),
            avgDurationMs: _avgMs(workflows),
            byChain:      chainSummary.slice(0, 10),
        },
        recoveries: {
            total:        recoveries.length,
            recoveryRate: _rate(recoveries, "recovered"),
            avgDurationMs: _avgMs(recoveries),
        },
        adapters: {
            total:        adapters.length,
            byAdapter:    adapterSummary,
        },
        deployments: {
            total:        deployments.length,
            successRate:  _rate(deployments),
            rollbacks:    deployments.filter(d => d.rollback).length,
        },
        sessions: {
            total:        sessions.length,
            completions:  sessions.filter(s => s.event === "complete").length,
        },
    };
}

/** Raw event query. */
function query({ type, limit = 100, windowMs } = {}) {
    let events = _prune(_load());
    if (windowMs) { const c = Date.now() - windowMs; events = events.filter(e => e.ts > c); }
    if (type) events = events.filter(e => e.type === type);
    return events.slice(-Math.min(limit, MAX_EVENTS)).reverse();
}

/** Disk stats. */
function storageStats() {
    const events = _prune(_load());
    let sizeBytes = 0;
    try { sizeBytes = fs.statSync(ANALYTICS_PATH).size; } catch {}
    return { total: events.length, max: MAX_EVENTS, sizeBytes };
}

module.exports = {
    recordWorkflow, recordRecovery, recordAdapter, recordDeployment, recordSession,
    summary, query, storageStats, EVENT_TYPES,
};
