"use strict";
/**
 * workforceDashboard.cjs — POST-Ω Sprint P7 Autonomous Workforce OS
 *
 * Unified dashboard: active teams, available agents, overloaded agents,
 * workload heatmap, skill coverage, mission assignments, performance
 * rankings, collaboration graph.
 *
 * Pure aggregation — no own storage.
 * Reuses: skillEngine, teamBuilder, capacityPlanner, performanceEngine,
 *         workforceManager.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _se  = () => _try(() => require("./skillEngine.cjs"));
const _tb  = () => _try(() => require("./teamBuilder.cjs"));
const _cp  = () => _try(() => require("./capacityPlanner.cjs"));
const _pe  = () => _try(() => require("./performanceEngine.cjs"));
const _wm  = () => _try(() => require("./workforceManager.cjs"));

function _ts() { return new Date().toISOString(); }

// ── Collaboration graph ────────────────────────────────────────────────────────

function buildCollaborationGraph() {
  const teams = _tb()?.listTeams?.({ limit: 50 }) || [];
  const nodes = new Map();  // agentId → { id, org, teamCount }
  const edges = [];         // { source, target, teamId, sharedCount }

  for (const team of teams) {
    const active = (team.members || []).filter(m => m.status === "active");
    for (const member of active) {
      if (!nodes.has(member.agentId)) {
        nodes.set(member.agentId, { id: member.agentId, org: member.org, teamCount: 0 });
      }
      nodes.get(member.agentId).teamCount++;
    }
    // Create edges between all pairs in this team
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const edge = edges.find(e =>
          (e.source === active[i].agentId && e.target === active[j].agentId) ||
          (e.source === active[j].agentId && e.target === active[i].agentId)
        );
        if (edge) edge.sharedCount++;
        else edges.push({ source: active[i].agentId, target: active[j].agentId, teamId: team.id, sharedCount: 1 });
      }
    }
  }

  return {
    nodes:     [...nodes.values()],
    edges:     edges.sort((a, b) => b.sharedCount - a.sharedCount).slice(0, 50),
    nodeCount: nodes.size,
    edgeCount: edges.length,
  };
}

// ── Workload heatmap ─────────────────────────────────────────────────────────

function buildWorkloadHeatmap() {
  const agents = _se()?.listAgents?.({ limit: 200 }) || [];
  const heatmap = {};

  for (const agent of agents) {
    const org = agent.org || "unknown";
    if (!heatmap[org]) heatmap[org] = { agents: [], avgWorkload: 0, maxWorkload: 0, overloaded: 0 };
    const entry = { id: agent.id, workload: agent.workload, maxConcurrent: agent.maxConcurrent, ratio: agent.workload / (agent.maxConcurrent || 1) };
    heatmap[org].agents.push(entry);
    heatmap[org].maxWorkload = Math.max(heatmap[org].maxWorkload, agent.workload);
    if (agent.workload >= agent.maxConcurrent * 0.85) heatmap[org].overloaded++;
  }

  for (const org of Object.keys(heatmap)) {
    const h = heatmap[org];
    h.avgWorkload = h.agents.length > 0
      ? Math.round(h.agents.reduce((s, a) => s + a.ratio, 0) / h.agents.length * 100) / 100
      : 0;
  }

  return heatmap;
}

// ── Main dashboard ────────────────────────────────────────────────────────────

function getDashboard() {
  const cap      = _cp()?.snapshot?.() || {};
  const agents   = _se()?.listAgents?.({ limit: 200 }) || [];
  const teams    = _tb()?.listTeams?.({ status: "active", limit: 20 }) || [];
  const rankings = _pe()?.getRankings?.({ limit: 10 }) || { rankings: [] };
  const wfStats  = _wm()?.getStats?.() || {};
  const perf     = _pe()?.getDashboardData?.() || {};
  const skillCov = _se()?.getSkillCoverage?.() || {};
  const seStats  = _se()?.getStats?.() || {};

  const available = agents.filter(a => a.available);
  const overloaded = agents.filter(a => a.workload >= a.maxConcurrent * 0.85);

  // Mission assignments
  const missionList = _wm()?.listMissions?.({ limit: 10 })?.missions || [];

  return {
    ok: true,

    // Summary
    summary: {
      totalAgents:     agents.length,
      availableAgents: available.length,
      overloadedAgents: overloaded.length,
      activeTeams:     teams.length,
      queueDepth:      cap.queueDepth || 0,
      utilizationRate: cap.utilizationRate || 0,
      missionsRun:     wfStats.missionsRun || 0,
      minutesSaved:    wfStats.minutesSaved || 0,
      autoAssigned:    wfStats.autoAssigned || 0,
    },

    // Active teams
    activeTeams: teams.map(t => ({
      id:          t.id,
      missionId:   t.missionId,
      missionTitle: t.missionTitle,
      type:        t.type,
      memberCount: t.members?.filter(m => m.status === "active").length,
      lead:        t.leadId,
      skillCoverage: t.skillCoverage,
      createdAt:   t.createdAt,
    })),

    // Agent availability
    availableAgents: available.slice(0, 10).map(a => ({ id: a.id, org: a.org, workload: a.workload, score: a.score })),
    overloadedAgents: overloaded.map(a => ({ id: a.id, org: a.org, workload: a.workload, maxConcurrent: a.maxConcurrent })),

    // Workload heatmap
    workloadHeatmap: buildWorkloadHeatmap(),

    // Skill coverage
    skillCoverage: Object.entries(skillCov).slice(0, 20).map(([skill, v]) => ({
      skill, total: v.total, available: v.available, avgConfidence: Math.round(v.avgConfidence * 100) / 100,
    })).sort((a, b) => a.available - b.available),

    // Mission assignments
    missionAssignments: missionList.slice(-5).map(m => ({
      id: m.id, title: m.title?.slice(0, 60), teamType: m.teamType,
      teamSize: m.teamSize, status: m.status, minutesSaved: m.minutesSaved,
    })),

    // Performance rankings
    performanceRankings: rankings.rankings.slice(0, 10),

    // Collaboration graph
    collaborationGraph: buildCollaborationGraph(),

    // Bottlenecks
    bottlenecks: cap.bottlenecks || [],

    generatedAt: _ts(),
  };
}

function getAgentCard(agentId) {
  const agent = _se()?.getAgent?.(agentId);
  if (!agent) return { ok: false, error: "agent not found" };
  const perf  = _pe()?.getAgentPerformance?.(agentId) || {};
  return {
    ok:             true,
    agent,
    performance:    perf.scores || {},
    recentEvents:   perf.recentEvents || [],
    activeTeams:    agent.activeTeams || [],
  };
}

module.exports = {
  getDashboard,
  buildCollaborationGraph,
  buildWorkloadHeatmap,
  getAgentCard,
};
