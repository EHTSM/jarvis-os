"use strict";
/**
 * engineering.js — J4 Engineering Intelligence routes
 *
 * GET /engineering/intelligence  — full J4 intelligence payload (60s cache)
 *   Returns: repositoryHealth, missionRisk, commitRisk, codeHotspots,
 *            recentFailures, regressionTrends, dependencyRisk,
 *            executionInsights, suggestedNextMission, failureHeatmap,
 *            aiTimeline
 *
 * All data derived from existing services. No new storage.
 * No new observers. No new databases.
 */
const router = require("express").Router();
const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");

// ── Lazy service refs ────────────────────────────────────────────────────────

function _try(fn) { try { return fn(); } catch { return null; } }

const _data = () => path.join(__dirname, "../../data");

function _readJSON(file, fallback = []) {
    try { const d = JSON.parse(fs.readFileSync(path.join(_data(), file), "utf8")); return d; }
    catch { return fallback; }
}

function _missionMemory() { return _try(() => require("../services/missionMemory.cjs")); }
function _intel()         { return _try(() => require("../services/intelligenceLayer.cjs")); }
function _errorAgg()      { return _try(() => require("./errorAggregator.cjs"))
                         || _try(() => require("../services/errorAggregator.cjs")); }
function _dlq()           { return _try(() => require("../../agents/runtime/deadLetterQueue.cjs")); }
function _execHistory()   { return _try(() => require("../../agents/runtime/executionHistory.cjs")); }
function _bgRuntime()     { return _try(() => require("../services/backgroundRuntime.cjs")); }
function _learnEngine()   { return _try(() => require("../services/continuousLearningEngine.cjs")); }

// ── In-memory cache (60s TTL) ────────────────────────────────────────────────

let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 60_000;

// ── Data readers ─────────────────────────────────────────────────────────────

function _missions() {
    const mm = _missionMemory();
    if (mm) {
        try { const { missions } = mm.listMissions({ limit: 300 }); return missions || []; }
        catch {}
    }
    return Array.isArray(_readJSON("missions.json")) ? _readJSON("missions.json") : [];
}

function _healingHistory() {
    const raw = _readJSON("healing-history.json", []);
    return Array.isArray(raw) ? raw : [];
}

function _deadLetterItems() {
    const d = _dlq();
    if (d) try { return d.list() || []; } catch {}
    const raw = _readJSON("dead-letter.json", []);
    return Array.isArray(raw) ? raw : [];
}

// Records can embed multi-MB "artifacts" (array) or "output" (string) fields
// (e.g. code_search echoing raw grep matches from minified JS bundles) — this
// view never reads either field. A JSON.parse reviver isn't enough (V8 must
// fully tokenize the value before a reviver can discard it), so strip both
// out of the raw line string first. Same fix as rootCauseAnalysisEngine.cjs.
function _stripBloatField(line, fieldName) {
    const i = line.indexOf(`"${fieldName}"`);
    if (i === -1) return line;
    let j = line.indexOf(":", i) + 1;
    while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
    const openChar = line[j];
    let end = -1;
    if (openChar === "[" || openChar === "{") {
        const closeChar = openChar === "[" ? "]" : "}";
        let depth = 0, inStr = false, esc = false;
        for (let k = j; k < line.length; k++) {
            const c = line[k];
            if (inStr) {
                if (esc) esc = false;
                else if (c === "\\") esc = true;
                else if (c === '"') inStr = false;
                continue;
            }
            if (c === '"') inStr = true;
            else if (c === openChar) depth++;
            else if (c === closeChar) { depth--; if (depth === 0) { end = k + 1; break; } }
        }
    } else if (openChar === '"') {
        let esc = false;
        for (let k = j + 1; k < line.length; k++) {
            const c = line[k];
            if (esc) { esc = false; continue; }
            if (c === "\\") { esc = true; continue; }
            if (c === '"') { end = k + 1; break; }
        }
    } else {
        return line;
    }
    if (end === -1) return line;
    let removeEnd = end;
    if (line[removeEnd] === ",") removeEnd++;
    return line.slice(0, i) + line.slice(removeEnd);
}

function _execHistory() {
    const eh = _try(() => require("../../agents/runtime/executionHistory.cjs"));
    if (eh) try { return eh.list?.({ limit: 200 }) || eh.getHistory?.({ limit: 200 }) || []; } catch {}
    // Fall back to ndjson.
    try {
        const lines = fs.readFileSync(path.join(_data(), "execution-runtime.ndjson"), "utf8")
            .split("\n").filter(Boolean).slice(-200);
        return lines.map(l => {
            try { return JSON.parse(_stripBloatField(_stripBloatField(l, "artifacts"), "output")); }
            catch { return null; }
        }).filter(Boolean);
    } catch { return []; }
}

function _gitHistory() {
    try {
        const mm = _missionMemory();
        if (!mm) return [];
        const { missions } = mm.listMissions({ limit: 300 });
        const out = [];
        for (const m of (missions || [])) {
            for (const a of (m.artifacts || [])) {
                if (a.type === "git-commit" || a.type === "final-commit") {
                    out.push({
                        missionId:     m.id,
                        objective:     m.objective,
                        missionStatus: m.status,
                        commitHash:    a.metadata?.commitHash,
                        commitMessage: a.metadata?.commitMessage,
                        branch:        a.metadata?.branch,
                        filesChanged:  a.metadata?.filesChanged || [],
                        recordedAt:    a.recordedAt,
                        isFinal:       a.type === "final-commit",
                    });
                }
            }
        }
        return out.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt));
    } catch { return []; }
}

function _topErrors() {
    const ea = _errorAgg();
    if (ea) try { return ea.getTopErrors?.(20) || []; } catch {}
    return _readJSON("error-groups.json", []);
}

function _errorTrend() {
    const ea = _errorAgg();
    if (ea) try { return ea.getErrorTrend?.(48) || []; } catch {}
    return [];
}

function _intelInsights() {
    const il = _intel();
    if (!il) return null;
    try { return il.getInsights(); } catch { return null; }
}

function _intelTrends(days = 14) {
    const il = _intel();
    if (!il) return null;
    try { return il.getTrends(days); } catch { return null; }
}

function _intelCorrelations() {
    const il = _intel();
    if (!il) return null;
    try { return il.getCorrelations(); } catch { return null; }
}

function _bgRecommendations() {
    const bg = _bgRuntime();
    if (!bg) return [];
    try {
        const r = bg.getRecommendations?.({ limit: 50 }) || {};
        return r.recommendations || [];
    } catch { return []; }
}

// ── Score helpers ────────────────────────────────────────────────────────────

function _clamp(v, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, Math.round(v))); }

function _pct(count, total) { return total > 0 ? (count / total) * 100 : 0; }

// ── Repository Health Score ──────────────────────────────────────────────────
// Composite: mission completion rate + healing success rate + exec verification rate + DLQ pressure

function _repoHealth(missions, healing, execs, dlqItems) {
    const total    = missions.length;
    const done     = missions.filter(m => m.status === "completed").length;
    const failed   = missions.filter(m => m.status === "failed").length;
    const missionScore = total > 0 ? _pct(done, done + failed) : 70;

    const healOk   = healing.filter(h => h.success).length;
    const healScore = healing.length > 0 ? _pct(healOk, healing.length) : 70;

    const verified = execs.filter(e => e.verificationResult === "passed").length;
    const totalEx  = execs.filter(e => e.verificationResult && e.verificationResult !== "pending").length;
    const execScore = totalEx > 0 ? _pct(verified, totalEx) : 70;

    const dlqPressure = Math.min(100, dlqItems.length * 2); // each item is -2 points max 100
    const dlqScore    = Math.max(0, 100 - dlqPressure);

    const composite = _clamp(missionScore * 0.3 + healScore * 0.25 + execScore * 0.3 + dlqScore * 0.15);
    const grade     = composite >= 80 ? "A" : composite >= 65 ? "B" : composite >= 50 ? "C" : "D";

    return {
        score: composite,
        grade,
        breakdown: {
            missionCompletion: _clamp(missionScore),
            healingSuccessRate: _clamp(healScore),
            execVerificationRate: _clamp(execScore),
            dlqPressure: _clamp(dlqScore),
        },
        trend: _deriveTrend(missions, "status", "completed"),
    };
}

function _deriveTrend(items, field, goodVal) {
    if (!items.length) return "stable";
    const now    = Date.now();
    const week   = 7 * 86400_000;
    const recent = items.filter(i => new Date(i.createdAt || i.ts || 0) > new Date(now - week));
    const older  = items.filter(i => new Date(i.createdAt || i.ts || 0) <= new Date(now - week) && new Date(i.createdAt || i.ts || 0) > new Date(now - 2 * week));
    if (!older.length || !recent.length) return "stable";
    const rOk = recent.filter(i => i[field] === goodVal).length / recent.length;
    const oOk = older.filter(i => i[field] === goodVal).length / older.length;
    if (rOk - oOk > 0.1) return "improving";
    if (oOk - rOk > 0.1) return "degrading";
    return "stable";
}

// ── Code Hotspots ────────────────────────────────────────────────────────────
// Files that appear most in mission commit artifacts + DLQ errors

function _codeHotspots(gitHist, dlqItems) {
    const fileCounts = {};
    const fileFailures = {};

    for (const c of gitHist) {
        for (const f of (c.filesChanged || [])) {
            fileCounts[f] = (fileCounts[f] || 0) + 1;
        }
    }
    // DLQ items that reference file paths
    for (const item of dlqItems) {
        const matches = String(item.input || item.error || "").match(/[\w./\-]+\.(js|jsx|ts|tsx|cjs|py|json)/g) || [];
        for (const f of matches) {
            fileFailures[f] = (fileFailures[f] || 0) + 1;
        }
    }
    const all = new Set([...Object.keys(fileCounts), ...Object.keys(fileFailures)]);
    const hotspots = [...all].map(f => ({
        file:         f,
        commitCount:  fileCounts[f] || 0,
        failureCount: fileFailures[f] || 0,
        hotScore:     (fileCounts[f] || 0) * 2 + (fileFailures[f] || 0) * 5,
    }))
    .filter(h => h.hotScore > 0)
    .sort((a, b) => b.hotScore - a.hotScore)
    .slice(0, 15);

    return hotspots;
}

// ── Commit Risk Score ────────────────────────────────────────────────────────
// Rollback rate, final commits that failed, average commit frequency

function _commitRisk(gitHist, missions) {
    const rollbacks = gitHist.filter(c => c.commitMessage?.toLowerCase().includes("revert") || c.isFinal === false && missions.find(m => m.id === c.missionId && m.status === "failed")).length;
    const total     = gitHist.length;
    const rate      = total > 0 ? rollbacks / total : 0;

    // Frequency: commits per day in last 14d
    const now = Date.now();
    const recent14 = gitHist.filter(c => new Date(c.recordedAt) > new Date(now - 14 * 86400_000));
    const freq = recent14.length / 14;

    // High frequency + high rollback = high risk
    const riskScore = _clamp(rate * 60 + Math.min(40, freq > 5 ? (freq - 5) * 4 : 0));

    return {
        score:        riskScore,
        level:        riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low",
        rollbackRate: Math.round(rate * 100),
        totalCommits: total,
        recentCommits: recent14.length,
        commitsPerDay: Math.round(freq * 10) / 10,
    };
}

// ── Mission Risk Score ───────────────────────────────────────────────────────

function _missionRisk(missions) {
    const active  = missions.filter(m => m.status === "running" || m.status === "active");
    const failed  = missions.filter(m => m.status === "failed");
    const planned = missions.filter(m => m.status === "planned");

    const totalFailures = missions.reduce((s, m) => s + (m.metrics?.failureCount || m.failures?.length || 0), 0);
    const avgFailures   = missions.length > 0 ? totalFailures / missions.length : 0;

    const subtaskCompletion = missions.reduce((s, m) => {
        const t = m.metrics?.totalSubtasks || m.subtasks?.length || 0;
        const c = m.metrics?.completedSubtasks || m.subtasks?.filter(st => st.status === "completed").length || 0;
        return s + (t > 0 ? c / t : 1);
    }, 0) / Math.max(1, missions.length);

    const riskScore = _clamp(
        (1 - subtaskCompletion) * 40 +
        Math.min(40, avgFailures * 10) +
        (active.length > 3 ? 20 : 0)
    );

    return {
        score:              riskScore,
        level:              riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low",
        activeMissions:     active.length,
        failedMissions:     failed.length,
        plannedMissions:    planned.length,
        avgFailuresPerMission: Math.round(avgFailures * 10) / 10,
        subtaskCompletionRate: Math.round(subtaskCompletion * 100),
    };
}

// ── Dependency Risk ──────────────────────────────────────────────────────────
// Tasks that repeatedly fail by type = dependency pressure points

function _dependencyRisk(dlqItems, healing) {
    const typeCounts = {};
    for (const item of dlqItems) {
        const t = item.taskType || item.type || "unknown";
        typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
    // Healing failures by targetType
    const healFails = {};
    for (const h of healing.filter(h => !h.success)) {
        healFails[h.targetType || "unknown"] = (healFails[h.targetType || "unknown"] || 0) + 1;
    }

    const risks = Object.entries(typeCounts).map(([type, count]) => ({
        dependency: type,
        failureCount: count,
        healingFails: healFails[type] || 0,
        riskLevel: count >= 10 ? "high" : count >= 4 ? "medium" : "low",
    })).sort((a, b) => b.failureCount - a.failureCount).slice(0, 10);

    return risks;
}

// ── Recent Failures ──────────────────────────────────────────────────────────

function _recentFailures(execs, missions, topErrors) {
    const now = Date.now();
    const window = 24 * 60 * 60 * 1000; // 24h

    const execFails = execs
        .filter(e => e.status === "failed" && new Date(e.startedAt) > new Date(now - window))
        .slice(0, 10)
        .map(e => ({
            type:      "execution",
            id:        e.executionId,
            label:     e.capability || e.input?.slice(0, 60) || "unknown",
            ts:        e.startedAt,
            duration:  e.duration,
            reason:    e.verificationResult || "failed",
            missionId: e.missionId,
        }));

    const missionFails = missions
        .filter(m => m.status === "failed")
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 5)
        .map(m => ({
            type:  "mission",
            id:    m.id,
            label: m.objective?.slice(0, 60) || m.id,
            ts:    m.updatedAt,
            reason: m.failures?.[0]?.description || "unknown",
        }));

    const errorFails = (topErrors || []).slice(0, 5).map(e => ({
        type:  "error",
        id:    e.fingerprint || e.id,
        label: e.message?.slice(0, 60) || "unknown error",
        ts:    e.lastSeen || e.firstSeen,
        count: e.count,
        reason: e.category || "error",
    }));

    return [...execFails, ...missionFails, ...errorFails]
        .sort((a, b) => new Date(b.ts) - new Date(a.ts))
        .slice(0, 20);
}

// ── Regression Trends ────────────────────────────────────────────────────────

function _regressionTrends(intelTrends, missions, execs) {
    if (intelTrends?.buckets?.length) {
        return intelTrends.buckets.map(b => ({
            date:        b.date || b.bucket,
            errors:      b.errors || 0,
            missions:    b.missions || 0,
            deployments: b.deployments || 0,
        }));
    }
    // Derive from missions + execs if intel not available
    const buckets = {};
    const day = 86400_000;
    for (const m of missions) {
        const d = new Date(m.createdAt || Date.now()).toISOString().slice(0, 10);
        if (!buckets[d]) buckets[d] = { date: d, errors: 0, missions: 0, failures: 0 };
        buckets[d].missions++;
        if (m.status === "failed") buckets[d].failures++;
    }
    for (const e of execs) {
        const d = new Date(e.startedAt || Date.now()).toISOString().slice(0, 10);
        if (!buckets[d]) buckets[d] = { date: d, errors: 0, missions: 0, failures: 0 };
        if (e.status === "failed") buckets[d].errors++;
    }
    return Object.values(buckets).sort((a, b) => a.date < b.date ? -1 : 1).slice(-14);
}

// ── Execution Insights ───────────────────────────────────────────────────────

function _executionInsights(execs) {
    const total    = execs.length;
    const ok       = execs.filter(e => e.status === "completed").length;
    const failed   = execs.filter(e => e.status === "failed").length;
    const verified = execs.filter(e => e.verificationResult === "passed").length;

    const durations = execs.filter(e => e.duration > 0).map(e => e.duration);
    const avgDur    = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
    const p95Dur    = durations.length ? durations.sort((a,b)=>a-b)[Math.floor(durations.length * 0.95)] || 0 : 0;

    // Capability leaderboard
    const capCounts = {};
    const capFails  = {};
    for (const e of execs) {
        const c = e.capability || "unknown";
        capCounts[c] = (capCounts[c] || 0) + 1;
        if (e.status === "failed") capFails[c] = (capFails[c] || 0) + 1;
    }
    const topCapabilities = Object.entries(capCounts)
        .map(([cap, count]) => ({
            capability: cap,
            count,
            failures: capFails[cap] || 0,
            failRate: Math.round(_pct(capFails[cap] || 0, count)),
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);

    return {
        total, ok, failed,
        successRate: _clamp(_pct(ok, total)),
        verificationRate: _clamp(_pct(verified, total)),
        avgDurationMs: avgDur,
        p95DurationMs: p95Dur,
        topCapabilities,
    };
}

// ── Suggested Next Mission ───────────────────────────────────────────────────

function _suggestedNextMission(insights, recs, missions) {
    // Try insight with highest strength
    const highInsights = (insights?.insights || [])
        .filter(i => i.severity === "high" || i.strength >= 70)
        .slice(0, 3)
        .map(i => ({
            source:     "correlation",
            objective:  i.recommendation || i.insight,
            confidence: i.strength || 70,
            reason:     i.insight,
        }));

    // Try recommendations with high confidence
    const highRecs = recs
        .filter(r => (r.confidence || r.priority === "high"))
        .slice(0, 3)
        .map(r => ({
            source:     "recommendation",
            objective:  r.action || r.title || r.description,
            confidence: r.confidence || 60,
            reason:     r.reason || r.description,
        }));

    // Unresolved failures as mission opportunity
    const failMissions = missions.filter(m => m.status === "failed").slice(0, 2).map(m => ({
        source:     "retry",
        objective:  `Retry: ${m.objective}`,
        confidence: 85,
        reason:     `Previous attempt failed — ${m.failures?.[0]?.description || "unknown reason"}`,
        missionId:  m.id,
    }));

    const all = [...failMissions, ...highInsights, ...highRecs]
        .filter(s => s.objective)
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 5);

    return all;
}

// ── Failure Heatmap ──────────────────────────────────────────────────────────
// Errors by day-of-week + hour-of-day derived from error trend + exec failures

function _failureHeatmap(execs, healing) {
    const grid = {}; // "dayOfWeek:hour" → count
    const combine = [
        ...execs.filter(e => e.status === "failed").map(e => e.startedAt),
        ...healing.filter(h => !h.success).map(h => h.ts),
    ];
    for (const ts of combine) {
        const d = new Date(ts);
        if (isNaN(d)) continue;
        const key = `${d.getDay()}:${d.getHours()}`;
        grid[key] = (grid[key] || 0) + 1;
    }
    // Convert to flat array for frontend rendering
    const cells = [];
    let maxVal = 1;
    for (const [key, count] of Object.entries(grid)) {
        const [day, hour] = key.split(":").map(Number);
        cells.push({ day, hour, count });
        if (count > maxVal) maxVal = count;
    }
    // Normalize
    for (const c of cells) c.intensity = Math.round((c.count / maxVal) * 100);
    return { cells, maxCount: maxVal };
}

// ── AI Engineering Timeline ──────────────────────────────────────────────────
// Fused chronological timeline of missions, commits, failures, healing

function _aiTimeline(missions, gitHist, execs, healing) {
    const events = [];

    for (const m of missions.slice(-30)) {
        events.push({ ts: m.createdAt, type: "mission", action: "created",    label: m.objective?.slice(0, 60), id: m.id, status: m.status });
        if (m.completedAt) events.push({ ts: m.completedAt, type: "mission", action: "completed", label: m.objective?.slice(0, 60), id: m.id, status: m.status });
        for (const f of (m.failures || []).slice(0, 2)) {
            events.push({ ts: f.timestamp, type: "failure", action: "mission_failure", label: f.description?.slice(0, 60) || "failure", id: f.id, missionId: m.id });
        }
    }
    for (const c of gitHist.slice(0, 20)) {
        events.push({ ts: c.recordedAt, type: "commit", action: c.isFinal ? "mission_complete" : "commit", label: c.commitMessage?.slice(0, 60), hash: c.commitHash?.slice(0, 7), missionId: c.missionId });
    }
    for (const e of execs.filter(ex => ex.status === "failed").slice(-15)) {
        events.push({ ts: e.startedAt, type: "exec_failure", action: "exec_failed", label: e.capability || e.input?.slice(0, 60), id: e.executionId, missionId: e.missionId });
    }
    for (const h of healing.filter(h => !h.success).slice(-10)) {
        events.push({ ts: h.ts, type: "healing", action: "heal_failed", label: `${h.strategy} on ${h.targetType}`, id: h.recId });
    }

    return events
        .filter(e => e.ts)
        .sort((a, b) => new Date(b.ts) - new Date(a.ts))
        .slice(0, 60);
}

// ── Historical Replay ────────────────────────────────────────────────────────
// Per-mission execution replay data (subtask chain + outcomes)

function _historicalReplay(missions, gitHist) {
    return missions
        .filter(m => m.status === "completed" || m.status === "failed")
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 8)
        .map(m => ({
            missionId:  m.id,
            objective:  m.objective,
            status:     m.status,
            duration:   m.completedAt && m.createdAt
                ? Date.parse(m.completedAt) - Date.parse(m.createdAt)
                : null,
            subtasks:   (m.subtasks || []).map(st => ({
                id:     st.id,
                desc:   st.description?.slice(0, 50),
                status: st.status,
                agent:  st.assignedAgent,
            })),
            failures:   (m.failures || []).slice(0, 3).map(f => ({
                phase: f.phase,
                desc:  f.description?.slice(0, 60),
                resolved: f.resolved,
            })),
            commits: gitHist.filter(c => c.missionId === m.id).slice(0, 5).map(c => ({
                hash:    c.commitHash?.slice(0, 7),
                message: c.commitMessage?.slice(0, 60),
                final:   c.isFinal,
            })),
        }));
}

// ── Main computation ─────────────────────────────────────────────────────────

function _compute() {
    const missions   = _missions();
    const healing    = _healingHistory();
    const dlqItems   = _deadLetterItems();
    const execs      = _execHistory();
    const gitHist    = _gitHistory();
    const topErrors  = _topErrors();
    const intelTrends = _intelTrends(14);
    const insights   = _intelInsights();
    const recs       = _bgRecommendations();

    return {
        computed_at:      new Date().toISOString(),
        repositoryHealth: _repoHealth(missions, healing, execs, dlqItems),
        missionRisk:      _missionRisk(missions),
        commitRisk:       _commitRisk(gitHist, missions),
        codeHotspots:     _codeHotspots(gitHist, dlqItems),
        recentFailures:   _recentFailures(execs, missions, topErrors),
        regressionTrends: _regressionTrends(intelTrends, missions, execs),
        dependencyRisk:   _dependencyRisk(dlqItems, healing),
        executionInsights: _executionInsights(execs),
        suggestedNextMission: _suggestedNextMission(insights, recs, missions),
        failureHeatmap:   _failureHeatmap(execs, healing),
        aiTimeline:       _aiTimeline(missions, gitHist, execs, healing),
        historicalReplay: _historicalReplay(missions, gitHist),
    };
}

// ── Route ────────────────────────────────────────────────────────────────────

router.get("/engineering/intelligence", (req, res) => {
    try {
        const now = Date.now();
        if (!_cache || now - _cacheTs > CACHE_TTL) {
            _cache   = _compute();
            _cacheTs = now;
        }
        res.json({ ok: true, ..._cache });
    } catch (err) {
        logger.error(`[EngineeringIntelligence] ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.post("/engineering/intelligence/invalidate", (req, res) => {
    _cache   = null;
    _cacheTs = 0;
    res.json({ ok: true, message: "cache invalidated" });
});

// ── Engineering Rule Registry (Sprint 2) ─────────────────────────────────────

function _registry() { return _try(() => require("../services/engineeringRuleRegistry.cjs")); }

// GET /engineering/rules — list all registered engineering rules
router.get("/engineering/rules", (req, res) => {
    try {
        const reg = _registry();
        if (!reg) return res.status(503).json({ ok: false, error: "rule registry unavailable" });
        const { problemClass, autoApply, action, limit = 100, offset = 0 } = req.query;
        const result = reg.listRules({
            problemClass,
            autoApply: autoApply !== undefined ? autoApply === "true" : undefined,
            action,
            limit:  Number(limit),
            offset: Number(offset),
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        logger.error(`[EngineeringRules] list failed: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /engineering/rules/stats — registry statistics
router.get("/engineering/rules/stats", (req, res) => {
    try {
        const reg = _registry();
        if (!reg) return res.status(503).json({ ok: false, error: "rule registry unavailable" });
        res.json({ ok: true, ...reg.getStats() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /engineering/rules/classify — classify an error message against known rules
router.post("/engineering/rules/classify", (req, res) => {
    try {
        const reg = _registry();
        if (!reg) return res.status(503).json({ ok: false, error: "rule registry unavailable" });
        const { error: errorMsg } = req.body;
        if (!errorMsg) return res.status(400).json({ ok: false, error: "error field required" });
        const result = reg.classifyError(errorMsg);
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /engineering/rules/extract/:missionId — extract rules from a mission
router.post("/engineering/rules/extract/:missionId", (req, res) => {
    try {
        const reg = _registry();
        if (!reg) return res.status(503).json({ ok: false, error: "rule registry unavailable" });
        const result = reg.extractFromMission(req.params.missionId);
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /engineering/rules — register a new rule manually
router.post("/engineering/rules", (req, res) => {
    try {
        const reg = _registry();
        if (!reg) return res.status(503).json({ ok: false, error: "rule registry unavailable" });
        const result = reg.registerRule(req.body);
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── Root Cause Analysis (Sprint 3) ───────────────────────────────────────────

function _rca() { return _try(() => require("../services/rootCauseAnalysisEngine.cjs")); }

// GET /engineering/rca — list all root cause analyses
router.get("/engineering/rca", (req, res) => {
    try {
        const rca = _rca();
        if (!rca) return res.status(503).json({ ok: false, error: "RCA engine unavailable" });
        const { status, minConfidence, limit = 50, offset = 0 } = req.query;
        const result = rca.listAnalyses({
            status,
            minConfidence: minConfidence !== undefined ? Number(minConfidence) : undefined,
            limit:  Number(limit),
            offset: Number(offset),
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        logger.error(`[EngineeringRCA] list failed: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /engineering/rca/stats — RCA statistics
router.get("/engineering/rca/stats", (req, res) => {
    try {
        const rca = _rca();
        if (!rca) return res.status(503).json({ ok: false, error: "RCA engine unavailable" });
        res.json({ ok: true, ...rca.getStats() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /engineering/rca/:problemClass — get one RCA
router.get("/engineering/rca/:problemClass", (req, res) => {
    try {
        const rca = _rca();
        if (!rca) return res.status(503).json({ ok: false, error: "RCA engine unavailable" });
        const analysis = rca.getAnalysis(req.params.problemClass);
        if (!analysis) return res.status(404).json({ ok: false, error: "RCA not found" });
        res.json({ ok: true, analysis });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /engineering/rca/run — force a fresh analysis run
router.post("/engineering/rca/run", (req, res) => {
    try {
        const rca = _rca();
        if (!rca) return res.status(503).json({ ok: false, error: "RCA engine unavailable" });
        rca.invalidate();
        const result = rca.runAnalysis({ force: true });
        _cache = null; _cacheTs = 0; // also invalidate intelligence cache
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// POST /engineering/rca/:rcaId/resolve — record that a fix succeeded
router.post("/engineering/rca/:rcaId/resolve", (req, res) => {
    try {
        const rca = _rca();
        if (!rca) return res.status(503).json({ ok: false, error: "RCA engine unavailable" });
        const result = rca.recordFixSuccess(req.params.rcaId, req.body || {});
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// GET /engineering/playbooks — list engineering playbooks
router.get("/engineering/playbooks", (req, res) => {
    try {
        const rca = _rca();
        if (!rca) return res.status(503).json({ ok: false, error: "RCA engine unavailable" });
        const { status, limit = 50, offset = 0 } = req.query;
        const result = rca.listPlaybooks({ status, limit: Number(limit), offset: Number(offset) });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── Engineering Confidence Engine (Sprint 5) ──────────────────────────────

function _ce() { return _try(() => require("../services/engineeringConfidenceEngine.cjs")); }

/**
 * POST /engineering/confidence/explain
 * Body: { error, capability?, problemClass?, strategy?, retries?, maxRetries? }
 * Returns a full reproducible confidence breakdown with evidence weights.
 */
router.post("/engineering/confidence/explain", (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "confidence engine unavailable" });
        const { error: errorMsg, ...context } = req.body;
        if (!errorMsg) return res.status(400).json({ ok: false, error: "error field required" });
        const result = ce.explain(errorMsg, context);
        res.json({ ok: true, ...result });
    } catch (err) {
        logger.error(`[ConfEngine] explain failed: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * GET /engineering/confidence/rule/:ruleId
 * Returns a strength report for a specific engineering rule.
 */
router.get("/engineering/confidence/rule/:ruleId", (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "confidence engine unavailable" });
        const result = ce.explainRule(req.params.ruleId);
        if (result.error) return res.status(404).json({ ok: false, ...result });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * GET /engineering/confidence/rca/:problemClass
 * Returns a confidence audit for an RCA problem class, comparing
 * the reported confidence against a derived confidence from evidence.
 */
router.get("/engineering/confidence/rca/:problemClass", (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "confidence engine unavailable" });
        const result = ce.explainRCA(req.params.problemClass);
        if (result.error) return res.status(404).json({ ok: false, ...result });
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * POST /engineering/confidence/strategy
 * Body: { decision (StrategyDecision from selectStrategy), error, context? }
 * Returns confidence breakdown specific to a healing strategy decision.
 */
router.post("/engineering/confidence/strategy", (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "confidence engine unavailable" });
        const { decision, error: errorMsg, context = {} } = req.body;
        if (!decision) return res.status(400).json({ ok: false, error: "decision field required" });
        const result = ce.explainStrategy(decision, errorMsg || "", context);
        res.json({ ok: true, ...result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * GET /engineering/confidence/stats
 * Session statistics: how many decisions explained, avg confidence,
 * which evidence source contributed most.
 */
router.get("/engineering/confidence/stats", (req, res) => {
    try {
        const ce = _ce();
        if (!ce) return res.status(503).json({ ok: false, error: "confidence engine unavailable" });
        res.json({ ok: true, ...ce.getStats() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── DLQ Drain Engine (Sprint 6) ───────────────────────────────────────────

function _drain() { return _try(() => require("../services/dlqDrainEngine.cjs")); }

/**
 * POST /engineering/dlq/drain
 * Body: { dryRun?: boolean, maxItems?: number, minConfidence?: number }
 *
 * Classify and optionally drain the Dead Letter Queue.
 * dryRun defaults to true — pass dryRun:false to execute routing.
 */
router.post("/engineering/dlq/drain", (req, res) => {
    try {
        const engine = _drain();
        if (!engine) return res.status(503).json({ ok: false, error: "DLQ drain engine unavailable" });
        const { dryRun = true, maxItems, minConfidence } = req.body;
        const report = engine.drain({ dryRun, maxItems, minConfidence });
        res.json(report);
    } catch (err) {
        logger.error(`[DLQDrain] drain failed: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * GET /engineering/dlq/report
 * Returns the most recent drain report (classification + routing decisions).
 */
router.get("/engineering/dlq/report", (req, res) => {
    try {
        const engine = _drain();
        if (!engine) return res.status(503).json({ ok: false, error: "DLQ drain engine unavailable" });
        const report = engine.getLastReport();
        if (!report) return res.status(404).json({ ok: false, error: "no drain run yet — POST /engineering/dlq/drain first" });
        res.json({ ok: true, ...report });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * GET /engineering/dlq/stats
 * Session aggregate statistics across all drain runs.
 */
router.get("/engineering/dlq/stats", (req, res) => {
    try {
        const engine = _drain();
        if (!engine) return res.status(503).json({ ok: false, error: "DLQ drain engine unavailable" });
        res.json({ ok: true, ...engine.getStats() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── Autonomous Engineering Scenario (Sprint 7) ────────────────────────────

function _scenario() { return _try(() => require("../services/autonomousEngineeringScenario.cjs")); }

/**
 * POST /engineering/scenario/run
 * Body: { goal, approved?, requireApproval? }
 * Runs an end-to-end autonomous engineering scenario from a user goal string.
 */
router.post("/engineering/scenario/run", async (req, res) => {
    try {
        const engine = _scenario();
        if (!engine) return res.status(503).json({ ok: false, error: "scenario engine unavailable" });
        const { goal, approved, requireApproval } = req.body;
        if (!goal) return res.status(400).json({ ok: false, error: "goal field required" });
        const report = await engine.run(goal, { approved, requireApproval });
        res.json(report);
    } catch (err) {
        logger.error(`[Scenario] run failed: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/**
 * GET /engineering/scenario/list
 * Lists available scenario goal strings.
 */
router.get("/engineering/scenario/list", (req, res) => {
    try {
        const engine = _scenario();
        if (!engine) return res.status(503).json({ ok: false, error: "scenario engine unavailable" });
        res.json({ ok: true, scenarios: engine.listScenarios() });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── Engineering Benchmark Suite (Sprint 8) ───────────────────────────────

function _bench() { return _try(() => require("../services/engineeringBenchmark.cjs")); }

/**
 * POST /engineering/benchmark/run
 * Run the full 10-scenario benchmark suite against the live repository.
 * Warning: this commits real changes. Use in dev only.
 */
router.post("/engineering/benchmark/run", async (req, res) => {
    try {
        const b = _bench();
        if (!b) return res.status(503).json({ ok: false, error: "benchmark engine unavailable" });
        const report = await b.runAll(req.body || {});
        res.json(report);
    } catch (err) {
        logger.error(`[Benchmark] run failed: ${err.message}`);
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** GET /engineering/benchmark/report — last benchmark report */
router.get("/engineering/benchmark/report", (req, res) => {
    try {
        const b = _bench();
        if (!b) return res.status(503).json({ ok: false, error: "benchmark engine unavailable" });
        const report = b.getReport();
        if (!report) return res.status(404).json({ ok: false, error: "no benchmark run yet" });
        res.json(report);
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** GET /engineering/benchmark/scenarios — list all 10 scenario definitions */
router.get("/engineering/benchmark/scenarios", (req, res) => {
    try {
        const b = _bench();
        if (!b) return res.status(503).json({ ok: false, error: "benchmark engine unavailable" });
        res.json({ ok: true, scenarios: b.SCENARIOS.map(s => ({ id: s.id, goal: s.goal, targetFile: s.targetFile })) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

/** POST /engineering/benchmark/scenario/:id — run a single scenario */
router.post("/engineering/benchmark/scenario/:id", async (req, res) => {
    try {
        const b = _bench();
        if (!b) return res.status(503).json({ ok: false, error: "benchmark engine unavailable" });
        const result = await b.runScenario(req.params.id, req.body || {});
        res.json(result);
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
