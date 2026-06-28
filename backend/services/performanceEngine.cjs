"use strict";
/**
 * performanceEngine.cjs — POST-Ω Sprint P7 Autonomous Workforce OS
 *
 * Measures and tracks workforce performance:
 *   - delivery speed
 *   - quality score
 *   - reliability (task completion rate)
 *   - collaboration score (cross-team effectiveness)
 *   - learning rate (improvement over time)
 *   - recovery ability (from failures)
 *
 * Reuses: skillEngine, teamBuilder, continuousLearningEngine,
 *         founderProfileEngine (P6), decisionLearningEngine (P6).
 *
 * Storage: data/performance-records.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "performance-records.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _se  = () => _try(() => require("./skillEngine.cjs"));
const _tb  = () => _try(() => require("./teamBuilder.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `perf_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch {
    return {
      records:    [],  // individual performance records (last 1000)
      agentStats: {},  // agentId → aggregate stats
      teamStats:  {},  // teamId → aggregate stats
      rankings:   [],  // computed rankings (last computed)
      updatedAt:  null,
    };
  }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.records.length > 1000) d.records = d.records.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Record a performance event ────────────────────────────────────────────────

function record({
  agentId,
  teamId,
  missionId,
  event,          // "task_complete" | "task_failed" | "recovery" | "collaboration" | "handoff"
  durationMs,
  qualityScore,   // 0-100 — quality of output
  outcome,        // "success" | "failure" | "partial"
  collaborators = [],
  notes = "",
} = {}) {
  if (!agentId || !event) return { ok: false, error: "agentId and event required" };

  const d   = _load();
  const id  = _id();

  const rec = {
    id, agentId, teamId, missionId, event, durationMs,
    qualityScore: qualityScore ?? 75,
    outcome: outcome || "success",
    collaborators,
    notes,
    ts: _ts(),
  };

  d.records.push(rec);

  // Update agent aggregate stats
  const as = d.agentStats[agentId] || {
    totalTasks: 0, successCount: 0, failCount: 0, recoveryCount: 0,
    avgDurationMs: 0, avgQuality: 0, collaborationCount: 0, handoffCount: 0,
    firstSeen: _ts(), lastActive: null,
  };

  as.totalTasks++;
  as.lastActive = _ts();
  if (outcome === "success")  as.successCount++;
  if (outcome === "failure")  as.failCount++;
  if (event === "recovery")   as.recoveryCount++;
  if (event === "collaboration") as.collaborationCount++;
  if (event === "handoff")    as.handoffCount++;
  if (durationMs > 0) as.avgDurationMs = Math.round((as.avgDurationMs * (as.totalTasks - 1) + durationMs) / as.totalTasks);
  as.avgQuality = Math.round((as.avgQuality * (as.totalTasks - 1) + (qualityScore ?? 75)) / as.totalTasks);
  d.agentStats[agentId] = as;

  // Update team aggregate stats
  if (teamId) {
    const ts = d.teamStats[teamId] || {
      totalTasks: 0, successCount: 0, failCount: 0, avgDurationMs: 0, avgQuality: 0,
    };
    ts.totalTasks++;
    if (outcome === "success") ts.successCount++;
    if (outcome === "failure") ts.failCount++;
    if (durationMs > 0) ts.avgDurationMs = Math.round((ts.avgDurationMs * (ts.totalTasks - 1) + durationMs) / ts.totalTasks);
    ts.avgQuality = Math.round((ts.avgQuality * (ts.totalTasks - 1) + (qualityScore ?? 75)) / ts.totalTasks);
    d.teamStats[teamId] = ts;
  }

  _save(d);

  // Register success/failure with skill engine
  if (outcome === "success") _try(() => _se()?.recordSuccess?.(agentId, { teamId, durationMs }));
  if (outcome === "failure") _try(() => _se()?.recordFailure?.(agentId, { teamId }));

  return { ok: true, id };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function _scoreAgent(as) {
  if (!as || as.totalTasks === 0) return { deliverySpeed: 50, quality: 50, reliability: 50, collaboration: 50, learning: 50, recovery: 50, composite: 50 };

  const reliability    = as.totalTasks > 0 ? Math.round(as.successCount / as.totalTasks * 100) : 50;
  const quality        = as.avgQuality || 75;
  const deliverySpeed  = as.avgDurationMs > 0 ? Math.max(0, Math.round(100 - as.avgDurationMs / 60000)) : 50; // penalize > 1min
  const collaboration  = as.collaborationCount > 0 ? Math.min(100, as.collaborationCount * 10) : 40;
  const recovery       = as.recoveryCount > 0 ? Math.min(100, 60 + as.recoveryCount * 10) : 60;
  // Learning rate — improves with more tasks
  const learning       = Math.min(100, 40 + Math.round(as.totalTasks / 2));

  const composite = Math.round(
    reliability  * 0.30 +
    quality      * 0.25 +
    deliverySpeed * 0.15 +
    collaboration * 0.10 +
    recovery      * 0.10 +
    learning      * 0.10
  );

  return { deliverySpeed, quality, reliability, collaboration, learning, recovery, composite };
}

// ── Agent performance report ──────────────────────────────────────────────────

function getAgentPerformance(agentId) {
  const d  = _load();
  const as = d.agentStats[agentId];
  const agent = _se()?.getAgent?.(agentId);
  if (!as && !agent) return { ok: false, error: "agent not found" };
  const scores = _scoreAgent(as || {});
  const recent = d.records.filter(r => r.agentId === agentId).slice(-10);
  return {
    ok: true,
    agentId,
    org:       agent?.org,
    skills:    agent?.skills || [],
    stats:     as || {},
    scores,
    recentEvents: recent,
  };
}

// ── Rankings ─────────────────────────────────────────────────────────────────

function computeRankings() {
  const d       = _load();
  const agents  = _se()?.listAgents?.({ limit: 200 }) || [];
  const ranked  = agents.map(agent => {
    const as     = d.agentStats[agent.id] || {};
    const scores = _scoreAgent(as);
    return {
      agentId:    agent.id,
      org:        agent.org,
      composite:  scores.composite,
      scores,
      totalTasks: as.totalTasks || 0,
      successRate: as.totalTasks > 0 ? Math.round(as.successCount / as.totalTasks * 100) : agent.successRate * 100,
    };
  }).sort((a, b) => b.composite - a.composite);

  d.rankings   = ranked;
  _save(d);
  return { ok: true, rankings: ranked };
}

function getRankings({ limit = 20, org } = {}) {
  const d       = _load();
  let rankings  = d.rankings.length ? d.rankings : computeRankings().rankings;
  if (org)      rankings = rankings.filter(r => r.org === org);
  return { ok: true, rankings: rankings.slice(0, limit) };
}

// ── Team performance ──────────────────────────────────────────────────────────

function getTeamPerformance(teamId) {
  const d  = _load();
  const ts = d.teamStats[teamId];
  const team = _tb()?.getTeam?.(teamId);
  return {
    ok:       true,
    teamId,
    team:     team ? { type: team.type, size: team.members?.length, missionId: team.missionId } : null,
    stats:    ts || { totalTasks: 0, successCount: 0, failCount: 0, avgQuality: 75 },
    successRate: ts?.totalTasks > 0 ? Math.round(ts.successCount / ts.totalTasks * 100) : 0,
    records:  d.records.filter(r => r.teamId === teamId).slice(-10),
  };
}

// ── Dashboard data ────────────────────────────────────────────────────────────

function getDashboardData() {
  const d       = _load();
  const rankings = computeRankings().rankings;
  const teams    = _tb()?.listTeams?.({ status: "active", limit: 20 }) || [];

  return {
    ok:            true,
    totalRecords:  d.records.length,
    agentsTracked: Object.keys(d.agentStats).length,
    teamsTracked:  Object.keys(d.teamStats).length,
    topPerformers: rankings.slice(0, 5),
    bottomPerformers: rankings.slice(-3).reverse(),
    activeTeamStats: teams.map(t => ({
      teamId: t.id, type: t.type, missionId: t.missionId,
      stats:  d.teamStats[t.id] || {},
    })),
    recentEvents:  d.records.slice(-10),
    generatedAt:   _ts(),
  };
}

function getStats() {
  const d = _load();
  return {
    totalRecords:  d.records.length,
    agentsTracked: Object.keys(d.agentStats).length,
    teamsTracked:  Object.keys(d.teamStats).length,
    updatedAt:     d.updatedAt,
  };
}

module.exports = {
  record,
  getAgentPerformance,
  computeRankings,
  getRankings,
  getTeamPerformance,
  getDashboardData,
  getStats,
};
