"use strict";
/**
 * ContinuousLearningEngine — analyze failures and successes, create lessons,
 * update recommendations, and persist learning patterns.
 *
 * Data sources (all read-only):
 *   data/learning-patterns.json   — pre-existing pattern store (read + extend)
 *   data/learning.json            — pre-existing habit/freq store
 *   data/agent-runs.json          — AgentExecutionEngine run history
 *   data/autonomous-cycles.json   — AutonomousTaskLoop cycle history
 *   data/tool-usage.json          — ToolExecutionLayer usage log
 *   data/coordination-sessions.json — MultiAgentCoordinator sessions
 *   data/healing-history.json     — SelfHealingRuntime records
 *
 * Writes:
 *   data/lessons.json             — created lessons
 *   data/recommendations.json     — active recommendations
 *   data/learning-patterns.json   — extended with new patterns (merged safely)
 *
 * Analysis runs:
 *   analyzeFailures()  — cluster failure records, identify root causes
 *   analyzeSuccesses() — identify high-performance patterns
 *   createLesson(data) — save a new lesson from any source
 *   runFullAnalysis()  — full pipeline, returns lessons + recommendations
 *
 * Public API:
 *   analyzeFailures(opts)                → { clusters[], lessons[] }
 *   analyzeSuccesses(opts)               → { patterns[], lessons[] }
 *   createLesson(lesson)                 → { lessonId, saved: true }
 *   runFullAnalysis()                    → { lessons[], recommendations[], stats }
 *   getLessons(opts)                     → { lessons[], total }
 *   getRecommendations(opts)             → { recommendations[], total }
 *   updateRecommendation(recId, patch)   → updated recommendation
 *   getStats()                           → analysis stats
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");

// ── File paths ────────────────────────────────────────────────────────────
const LESSONS_FILE  = path.join(__dirname, "../../data/lessons.json");
const RECS_FILE     = path.join(__dirname, "../../data/recommendations.json");
const PATTERNS_FILE = path.join(__dirname, "../../data/learning-patterns.json");

const DATA_SOURCES = {
    agentRuns:    path.join(__dirname, "../../data/agent-runs.json"),
    cycles:       path.join(__dirname, "../../data/autonomous-cycles.json"),
    toolUsage:    path.join(__dirname, "../../data/tool-usage.json"),
    coordSessions:path.join(__dirname, "../../data/coordination-sessions.json"),
    healHistory:  path.join(__dirname, "../../data/healing-history.json"),
};

function _rj(file, fb) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fb; } }
function _wj(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

let _lessons = _rj(LESSONS_FILE, []);
let _recs    = _rj(RECS_FILE,    []);
let _seq     = _lessons.length + _recs.length;

function _lid() { return `les_${Date.now()}_${(++_seq).toString(36)}`; }
function _rid() { return `rec_${Date.now()}_${(++_seq).toString(36)}`; }
// _lessons/_recs grow by one push per createLesson()/recommendation for the
// life of the process — slice(-N) here previously only trimmed the copy
// written to disk, never the in-memory array itself, so RSS grew unbounded.
// createLesson() fires on nearly every tick across 3 of the 10 org files
// (autonomousEvolutionOrg, autonomousKnowledgeOrg, businessOrg), making this
// the dominant steady-state leak. Reassigning keeps memory and disk bounded
// together — same fix as autonomousTaskLoop.cjs's _cycles/_learning.
function _saveLessons() { try { _lessons = _lessons.slice(-2000); _wj(LESSONS_FILE, _lessons); } catch { /* non-fatal */ } }
function _saveRecs()    { try { _recs    = _recs.slice(-500);    _wj(RECS_FILE,    _recs);    } catch { /* non-fatal */ } }

// ── Data loading ─────────────────────────────────────────────────────────
// Cached per-tick (cleared at the top of runFullAnalysis) so a single analysis
// pass parses each source file at most once instead of once per call site.
const _dataCache = {};
function _cached(key, file) {
    if (!(key in _dataCache)) _dataCache[key] = _rj(file, []);
    return _dataCache[key];
}
function _clearDataCache() { for (const k of Object.keys(_dataCache)) delete _dataCache[k]; }

function _loadRuns()      { return _cached("agentRuns",     DATA_SOURCES.agentRuns); }
function _loadCycles()    { return _cached("cycles",        DATA_SOURCES.cycles); }
function _loadToolUsage() { return _cached("toolUsage",     DATA_SOURCES.toolUsage); }
function _loadCoordSess() { return _cached("coordSessions", DATA_SOURCES.coordSessions); }
function _loadHealHist()  { return _cached("healHistory",   DATA_SOURCES.healHistory); }

// ── Failure analysis ─────────────────────────────────────────────────────
function analyzeFailures({ since, limit = 200 } = {}) {
    const cutoff = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 3600_000); // last 7 days

    const failedRuns   = _loadRuns().filter(r => !r.success && new Date(r.completedAt || r.startedAt) >= cutoff);
    const failedCycles = _loadCycles().filter(c => c.status === "failed" && new Date(c.createdAt) >= cutoff);
    const failedTools  = _loadToolUsage().filter(u => !u.success && new Date(u.startedAt) >= cutoff);

    // Cluster by error message prefix (top-40-chars)
    const clusters = new Map();
    const allFails = [
        ...failedRuns.map(r  => ({ source: "agent",  id: r.runId,   error: r.error || "unknown", agentId: r.agentId,  input: r.input })),
        ...failedTools.map(u => ({ source: "tool",   id: u.callId,  error: u.error || "unknown", toolId: u.toolId,    action: u.action })),
        ...failedCycles.map(c=> ({ source: "cycle",  id: c.cycleId, error: c.error || "unknown", goalType: c.goalType })),
    ];

    for (const f of allFails) {
        const key = (f.error || "unknown").slice(0, 40);
        const cl  = clusters.get(key) || { pattern: key, count: 0, sources: new Set(), examples: [], rootCause: null };
        cl.count++;
        cl.sources.add(f.source);
        if (cl.examples.length < 3) cl.examples.push({ id: f.id, source: f.source, error: f.error });
        clusters.set(key, cl);
    }

    const clustered = Array.from(clusters.values())
        .sort((a, b) => b.count - a.count)
        .map(c => ({ ...c, sources: Array.from(c.sources), rootCause: _inferRootCause(c.pattern), severity: c.count >= 10 ? "high" : c.count >= 3 ? "medium" : "low" }));

    // Auto-generate lessons for top failure patterns
    const newLessons = [];
    for (const cl of clustered.slice(0, 5)) {
        if (_lessons.some(l => l.sourcePattern === cl.pattern)) continue; // already have this lesson
        const lesson = {
            lessonId:      _lid(),
            type:          "failure",
            title:         `Recurring failure: ${cl.pattern.slice(0, 60)}`,
            detail:        `Pattern occurred ${cl.count} times across: ${Array.from(cl.sources).join(", ")}. Root cause: ${cl.rootCause}.`,
            severity:      cl.severity,
            sourcePattern: cl.pattern,
            recommendation:`Investigate and fix ${cl.rootCause}. Consider circuit-breaking affected agent/tool.`,
            createdAt:     new Date().toISOString(),
            source:        "auto_analysis",
            applied:       false,
        };
        _lessons.push(lesson);
        newLessons.push(lesson);
    }
    if (newLessons.length) _saveLessons();

    return { clusters: clustered.slice(0, limit), lessons: newLessons, totalFailures: allFails.length };
}

function _inferRootCause(errorPattern) {
    const p = errorPattern.toLowerCase();
    if (p.includes("timeout"))     return "timeout — upstream service too slow or network latency";
    if (p.includes("rate limit") || p.includes("429")) return "rate limiting — reduce call frequency or add backoff";
    if (p.includes("401") || p.includes("unauthorized")) return "auth failure — token expired or not set";
    if (p.includes("403") || p.includes("forbidden"))    return "permission denied — check access scopes";
    if (p.includes("404"))         return "resource not found — verify IDs and paths";
    if (p.includes("not_configured")) return "missing credentials — set required environment variable";
    if (p.includes("econnrefused") || p.includes("enotfound")) return "network error — service unavailable or wrong URL";
    if (p.includes("quota"))       return "quota exceeded — upgrade plan or reduce usage";
    if (p.includes("unknown"))     return "unclassified error — review logs for detail";
    return "application error — review stack trace";
}

// ── Success analysis ──────────────────────────────────────────────────────
function analyzeSuccesses({ since, limit = 50 } = {}) {
    const cutoff = since ? new Date(since) : new Date(Date.now() - 7 * 24 * 3600_000);

    const successRuns   = _loadRuns().filter(r => r.success && new Date(r.completedAt || r.startedAt) >= cutoff);
    const successCycles = _loadCycles().filter(c => (c.status === "completed" || c.successRate >= 80) && new Date(c.createdAt) >= cutoff);
    const successTools  = _loadToolUsage().filter(u => u.success && new Date(u.startedAt) >= cutoff);
    const successCoord  = _loadCoordSess().filter(s => s.status === "completed" && new Date(s.createdAt) >= cutoff);

    // Per-agent success rates
    const agentMap = new Map();
    for (const r of _loadRuns()) {
        const a = agentMap.get(r.agentId) || { agentId: r.agentId, total: 0, success: 0, totalMs: 0 };
        a.total++; if (r.success) { a.success++; a.totalMs += r.durationMs || 0; }
        agentMap.set(r.agentId, a);
    }
    const agentPatterns = Array.from(agentMap.values())
        .filter(a => a.total >= 3)
        .map(a => ({ ...a, successRate: Math.round(a.success / a.total * 100), avgMs: a.total ? Math.round(a.totalMs / a.total) : 0 }))
        .sort((a, b) => b.successRate - a.successRate);

    // Per-tool success rates
    const toolMap = new Map();
    for (const u of _loadToolUsage()) {
        const t = toolMap.get(u.toolId) || { toolId: u.toolId, total: 0, success: 0 };
        t.total++; if (u.success) t.success++;
        toolMap.set(u.toolId, t);
    }
    const toolPatterns = Array.from(toolMap.values())
        .filter(t => t.total >= 2)
        .map(t => ({ ...t, successRate: Math.round(t.success / t.total * 100) }))
        .sort((a, b) => b.successRate - a.successRate);

    const patterns = [
        ...agentPatterns.slice(0, 5).map(a => ({ type: "agent", ...a })),
        ...toolPatterns.slice(0, 5).map(t => ({ type: "tool",  ...t })),
    ];

    // Auto-generate positive lessons for top performers
    const newLessons = [];
    for (const p of patterns.filter(x => x.successRate >= 90).slice(0, 3)) {
        const key = `success:${p.agentId || p.toolId}`;
        if (_lessons.some(l => l.sourcePattern === key)) continue;
        const name = p.agentId || p.toolId;
        const lesson = {
            lessonId:      _lid(),
            type:          "success",
            title:         `High performer: ${name} (${p.successRate}% success)`,
            detail:        `${name} succeeds ${p.successRate}% of the time across ${p.total} runs. Leverage as preferred ${p.type}.`,
            severity:      "info",
            sourcePattern: key,
            recommendation:`Route similar tasks to ${name} first. Use as fallback for other ${p.type}s.`,
            createdAt:     new Date().toISOString(),
            source:        "auto_analysis",
            applied:       false,
        };
        _lessons.push(lesson);
        newLessons.push(lesson);
    }
    if (newLessons.length) _saveLessons();

    return { patterns: patterns.slice(0, limit), lessons: newLessons, totals: { successRuns: successRuns.length, successCycles: successCycles.length, successTools: successTools.length, successCoord: successCoord.length } };
}

// ── Lesson management ────────────────────────────────────────────────────
function createLesson(data) {
    const lesson = {
        lessonId:      _lid(),
        type:          data.type       || "manual",
        title:         (data.title     || "Untitled lesson").slice(0, 200),
        detail:        (data.detail    || "").slice(0, 1000),
        severity:      data.severity   || "info",
        sourcePattern: data.sourcePattern || null,
        recommendation:data.recommendation || null,
        createdAt:     new Date().toISOString(),
        source:        data.source     || "manual",
        applied:       false,
        agentId:       data.agentId    || null,
        toolId:        data.toolId     || null,
    };
    _lessons.push(lesson);
    _saveLessons();
    return { lessonId: lesson.lessonId, saved: true };
}

function getLessons({ type, severity, source, limit = 100, offset = 0 } = {}) {
    let rows = [..._lessons].reverse();
    if (type)     rows = rows.filter(l => l.type     === type);
    if (severity) rows = rows.filter(l => l.severity === severity);
    if (source)   rows = rows.filter(l => l.source   === source);
    return { lessons: rows.slice(offset, offset + limit), total: rows.length };
}

// ── Recommendations ──────────────────────────────────────────────────────
function _upsertRecommendation(rec) {
    const existing = _recs.findIndex(r => r.title === rec.title);
    if (existing >= 0) {
        _recs[existing] = { ..._recs[existing], ...rec, updatedAt: new Date().toISOString() };
    } else {
        _recs.push({ recId: _rid(), status: "open", priority: rec.priority || 2, createdAt: new Date().toISOString(), ...rec });
    }
    _saveRecs();
}

function getRecommendations({ status, priority, limit = 50, offset = 0 } = {}) {
    let rows = [..._recs].sort((a, b) => (a.priority - b.priority) || b.createdAt.localeCompare(a.createdAt));
    if (status)   rows = rows.filter(r => r.status   === status);
    if (priority !== undefined) rows = rows.filter(r => r.priority === Number(priority));
    return { recommendations: rows.slice(offset, offset + limit), total: rows.length };
}

function updateRecommendation(recId, patch) {
    const idx = _recs.findIndex(r => r.recId === recId);
    if (idx < 0) throw new Error(`Recommendation ${recId} not found`);
    _recs[idx] = { ..._recs[idx], ...patch, recId, updatedAt: new Date().toISOString() };
    _saveRecs();
    return _recs[idx];
}

// ── Full analysis pipeline ────────────────────────────────────────────────
function runFullAnalysis() {
    logger.info("[LearningEngine] Running full analysis...");
    _clearDataCache();
    const failResult    = analyzeFailures();
    const successResult = analyzeSuccesses();

    // Generate recommendations from failures
    for (const cl of failResult.clusters.filter(c => c.severity === "high")) {
        _upsertRecommendation({ title: `Fix: ${cl.pattern.slice(0, 80)}`, detail: `High-severity failure cluster (${cl.count} occurrences). Root cause: ${cl.rootCause}`, priority: 1, type: "fix", source: "auto_analysis" });
    }
    for (const cl of failResult.clusters.filter(c => c.severity === "medium")) {
        _upsertRecommendation({ title: `Investigate: ${cl.pattern.slice(0, 80)}`, detail: `Medium-severity failure (${cl.count} occurrences). Root cause: ${cl.rootCause}`, priority: 2, type: "investigate", source: "auto_analysis" });
    }
    // Generate recommendations from successes
    for (const p of successResult.patterns.filter(x => x.successRate >= 90)) {
        const name = p.agentId || p.toolId;
        _upsertRecommendation({ title: `Leverage high-performer: ${name}`, detail: `${name} achieves ${p.successRate}% success. Prioritise for routing.`, priority: 3, type: "optimize", source: "auto_analysis" });
    }

    // Persist new patterns back to learning-patterns.json (merge safely)
    try {
        const store   = _rj(PATTERNS_FILE, { patterns: {}, history: [], meta: {} });
        const history = Array.isArray(store.history) ? store.history : [];
        const nowStr  = new Date().toISOString();
        // Append a summary entry
        history.push({ timestamp: nowStr, event: "full_analysis", failClusters: failResult.clusters.length, successPatterns: successResult.patterns.length, newLessons: failResult.lessons.length + successResult.lessons.length });
        store.history = history.slice(-500);
        store.meta    = { totalLearned: history.length, lastUpdated: nowStr };
        _wj(PATTERNS_FILE, store);
    } catch { /* non-critical */ }

    const stats = {
        totalLessons:      _lessons.length,
        totalRecommendations: _recs.length,
        openRecommendations:  _recs.filter(r => r.status === "open").length,
        failClusters:      failResult.clusters.length,
        successPatterns:   successResult.patterns.length,
        newLessonsThisRun: failResult.lessons.length + successResult.lessons.length,
    };

    logger.info(`[LearningEngine] Analysis done: ${stats.newLessonsThisRun} new lessons, ${stats.openRecommendations} open recs`);
    return { lessons: [...failResult.lessons, ...successResult.lessons], recommendations: _recs.slice(0, 20), stats };
}

function getStats() {
    return {
        totalLessons:         _lessons.length,
        lessonsByType:        _lessons.reduce((a, l) => { a[l.type] = (a[l.type] || 0) + 1; return a; }, {}),
        totalRecommendations: _recs.length,
        openRecs:             _recs.filter(r => r.status === "open").length,
        appliedLessons:       _lessons.filter(l => l.applied).length,
    };
}

// Populates lessons/recs on first run. Call after the HTTP server is listening —
// NOT at module load — so a large agent-runs/tool-usage/cycles history doesn't
// get parsed and clustered in memory before the process can bind its port.
let _autoAnalysisStarted = false;
function startAutoAnalysis() {
    if (_autoAnalysisStarted) return;
    _autoAnalysisStarted = true;
    setImmediate(() => {
        try { runFullAnalysis(); } catch { /* non-critical */ }
    });
}

module.exports = { analyzeFailures, analyzeSuccesses, createLesson, runFullAnalysis, getLessons, getRecommendations, updateRecommendation, getStats, startAutoAnalysis };
