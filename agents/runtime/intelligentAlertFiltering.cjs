"use strict";
/**
 * Phase 740 — Intelligent Alert Filtering
 *
 * Reduces operator alert fatigue by classifying, deduplicating, and
 * suppressing low-value alerts. Surfaces only actionable, novel alerts.
 * Tracks suppression rates and alert value scores.
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE     = path.join(__dirname, "../../data/intelligent-alert-filtering.json");
const DEDUP_MS      = 10 * 60 * 1000;
const SUPPRESS_AT   = 3;
const MAX_ENTRIES   = 300;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch { return { alerts: [], suppressionMap: {}, stats: { total: 0, suppressed: 0, surfaced: 0 } }; }
}
function _save(db) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}
function _fp(alert) { return `${alert.source}:${alert.type}:${alert.severity}`; }

function classifyAlert(alert) {
    if (!alert || !alert.type) return { ...alert, classification: "unknown", value: 0 };

    let value = 50;
    if (alert.severity === "critical") value = 100;
    else if (alert.severity === "warning") value = 60;
    else if (alert.severity === "info") value = 20;

    const classification =
        alert.severity === "critical" ? "actionable" :
        alert.severity === "warning"  ? "watchable"  : "informational";

    return { ...alert, classification, value };
}

function filterAlert(alert) {
    if (!alert || !alert.type || !alert.source) return { ok: false, error: "alert missing type or source" };

    const classified = classifyAlert(alert);
    const db   = _load();
    const now  = Date.now();
    const fp   = _fp(alert);

    db.stats.total++;

    // Dedup
    const recent = db.alerts.filter(a => a.fp === fp && now - a.ts < DEDUP_MS);
    if (recent.length > 0) {
        db.stats.suppressed++;
        _save(db);
        return { ok: true, surfaced: false, reason: "duplicate", fp };
    }

    // Suppression: if this fp has been surfaced >= SUPPRESS_AT times in the last hour
    const hourAgo = now - 60 * 60 * 1000;
    const hourCount = db.alerts.filter(a => a.fp === fp && a.ts > hourAgo && a.surfaced).length;
    if (hourCount >= SUPPRESS_AT && classified.classification === "informational") {
        db.stats.suppressed++;
        _save(db);
        return { ok: true, surfaced: false, reason: "suppressed", fp };
    }

    classified.fp       = fp;
    classified.ts       = now;
    classified.surfaced = true;
    db.alerts.push(classified);
    if (db.alerts.length > MAX_ENTRIES) db.alerts = db.alerts.slice(-MAX_ENTRIES);
    db.stats.surfaced++;
    _save(db);

    return { ok: true, surfaced: true, classification: classified.classification, value: classified.value, fp };
}

function getActiveAlerts({ maxAge = 60 * 60 * 1000, minSeverity } = {}) {
    const db  = _load();
    const now = Date.now();
    const SEV_RANK = { critical: 3, warning: 2, info: 1 };
    const minRank  = SEV_RANK[minSeverity] || 0;

    const active = db.alerts
        .filter(a => a.surfaced && now - a.ts <= maxAge && (SEV_RANK[a.severity] || 0) >= minRank)
        .sort((a, b) => (SEV_RANK[b.severity] || 0) - (SEV_RANK[a.severity] || 0));

    return {
        ok:             true,
        count:          active.length,
        critical:       active.filter(a => a.severity === "critical").length,
        warnings:       active.filter(a => a.severity === "warning").length,
        alerts:         active.slice(0, 20),
        summary:        `Active alerts: ${active.length} (critical=${active.filter(a => a.severity === "critical").length})`,
    };
}

function alertFilteringStats() {
    const db = _load();
    const { total, suppressed, surfaced } = db.stats;
    const suppressionRate = total > 0 ? Math.round((suppressed / total) * 100) : 0;
    return { ok: true, total, suppressed, surfaced, suppressionRate, summary: `Alert filtering: ${suppressionRate}% suppressed (${surfaced} surfaced of ${total})` };
}

module.exports = { classifyAlert, filterAlert, getActiveAlerts, alertFilteringStats };
