"use strict";
/**
 * Phase 742 — Runtime Pattern Recognition
 *
 * Identifies repeating runtime failure patterns, anomaly clusters, and
 * known-bad states. Maps patterns to remediation playbooks.
 * Does not auto-remediate — surfaces patterns for operator review.
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE    = path.join(__dirname, "../../data/runtime-pattern-recognition.json");
const WINDOW_MS    = 2 * 60 * 60 * 1000;   // 2h pattern window
const MIN_OCCUR    = 3;                      // min occurrences to call it a pattern
const MAX_PATTERNS = 100;

function _load() {
    try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
    catch { return { events: [], patterns: [] }; }
}
function _save(db) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); } catch {}
}

function recordRuntimeEvent(type, detail = {}) {
    if (!type) return { ok: false, error: "type required" };
    const db = _load();
    db.events.push({ type, detail, ts: Date.now() });
    if (db.events.length > 1000) db.events = db.events.slice(-1000);
    _save(db);
    return { ok: true, type };
}

function detectPatterns() {
    const db  = _load();
    const now = Date.now();
    const recent = db.events.filter(e => now - e.ts <= WINDOW_MS);

    const freq = {};
    recent.forEach(e => { freq[e.type] = (freq[e.type] || 0) + 1; });

    const patterns = Object.entries(freq)
        .filter(([, count]) => count >= MIN_OCCUR)
        .map(([type, count]) => ({
            type,
            count,
            rate:     Math.round(count / (WINDOW_MS / 60000)),
            severity: count >= 10 ? "critical" : count >= 5 ? "warning" : "info",
            playbook: _playbookFor(type),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_PATTERNS);

    return {
        ok:       true,
        patterns,
        total:    patterns.length,
        critical: patterns.filter(p => p.severity === "critical").length,
        summary:  `Pattern recognition: ${patterns.length} patterns detected (${patterns.filter(p => p.severity === "critical").length} critical)`,
    };
}

function _playbookFor(type) {
    if (type.includes("deploy"))    return "deployment-recovery";
    if (type.includes("crash"))     return "crash-triage";
    if (type.includes("auth"))      return "auth-remediation";
    if (type.includes("timeout"))   return "timeout-investigation";
    if (type.includes("memory"))    return "memory-profiling";
    if (type.includes("session"))   return "session-recovery";
    return "general-investigation";
}

function anomalyCluster() {
    const { patterns } = detectPatterns();
    const clusters = {};

    patterns.forEach(p => {
        const playbook = p.playbook;
        if (!clusters[playbook]) clusters[playbook] = { playbook, types: [], totalCount: 0 };
        clusters[playbook].types.push(p.type);
        clusters[playbook].totalCount += p.count;
    });

    const list = Object.values(clusters).sort((a, b) => b.totalCount - a.totalCount);
    return {
        ok:       true,
        clusters: list,
        count:    list.length,
        summary:  `Anomaly clusters: ${list.length} (largest: ${list[0]?.playbook || "none"} — ${list[0]?.totalCount || 0} events)`,
    };
}

function patternRecognitionReport() {
    const patterns  = detectPatterns();
    const clusters  = anomalyCluster();
    const db        = _load();
    const now       = Date.now();
    const recentEvt = db.events.filter(e => now - e.ts <= WINDOW_MS).length;

    return {
        ok:           patterns.critical === 0,
        patterns:     { total: patterns.total, critical: patterns.critical, top: patterns.patterns.slice(0, 5) },
        clusters:     { count: clusters.count, top: clusters.clusters.slice(0, 3) },
        recentEvents: recentEvt,
        summary:      `Pattern report: ${patterns.total} patterns across ${recentEvt} events — critical=${patterns.critical}`,
    };
}

module.exports = { recordRuntimeEvent, detectPatterns, anomalyCluster, patternRecognitionReport };
