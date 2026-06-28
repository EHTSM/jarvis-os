"use strict";
/**
 * workspaceDashboard.cjs — POST-Ω Sprint P9 Autonomous Workspace Mesh
 *
 * Pure aggregation dashboard for the Workspace Mesh:
 *   - active workspaces + health
 *   - active missions
 *   - synchronization status
 *   - bottlenecks
 *   - execution graph (recent runs)
 *   - founder time saved
 *
 * No own storage — reads from workspaceMesh, workspaceRegistry,
 * workspaceHealth, workspaceSynchronization, workspaceCoordinator.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _mesh = () => _try(() => require("./workspaceMesh.cjs"));
const _wr   = () => _try(() => require("./workspaceRegistry.cjs"));
const _wh   = () => _try(() => require("./workspaceHealth.cjs"));
const _ws   = () => _try(() => require("./workspaceSynchronization.cjs"));
const _wc   = () => _try(() => require("./workspaceCoordinator.cjs"));

// ── Dashboard ─────────────────────────────────────────────────────────────────

function getDashboard() {
  const meshStats  = _mesh()?.getStats?.() || {};
  const regStats   = _wr()?.getStats?.() || {};
  const healthData = _wh()?.checkMesh?.() || { ok: true, healthy: 0, degraded: 0, critical: 0, total: 0, workspaces: [] };
  const syncStats  = _ws()?.getStats?.() || {};
  const coordStats = _wc()?.getStats?.() || {};

  // Active workspaces
  const activeWorkspaces = (_wr()?.list?.({ status: "active" }) || []).map(ws => {
    const metrics = _wh()?.getWorkspaceMetrics?.(ws.id);
    return {
      id:           ws.id,
      type:         ws.type,
      label:        ws.label,
      category:     ws.category,
      capabilities: ws.capabilities,
      health:       metrics?.score ?? ws.health,
      status:       ws.status,
      missionCount: (ws.missions || []).length,
      lastSeen:     ws.lastSeen,
    };
  });

  // Active missions across all workspaces
  const allWs = _wr()?.list?.() || [];
  const missionSet = new Set();
  for (const ws of allWs) for (const m of (ws.missions || [])) missionSet.add(m);
  const activeMissions = Array.from(missionSet).slice(0, 20);

  // Sync summary
  const syncSummary = {
    totalSyncs:      syncStats.syncsPerformed || 0,
    openConflicts:   syncStats.openConflicts  || 0,
    conflictsResolved: syncStats.conflictsResolved || 0,
  };

  // Bottlenecks
  const bottlenecks = (_wh()?.detectBottlenecks?.()?.bottlenecks || []).slice(0, 10);

  // Execution graph (recent runs)
  const recentRuns = (_wc()?.listRuns?.({ limit: 10 })?.runs || []).map(r => ({
    id:           r.id,
    missionId:    r.missionId,
    title:        r.title,
    domain:       r.domain,
    status:       r.status,
    subTasks:     r.subTasks?.length || 0,
    recoveries:   r.recoveries,
    minutesSaved: r.minutesSaved,
    ts:           r.startedAt,
  }));

  // Category breakdown
  const byCategory = { local: 0, remote: 0, cloud: 0 };
  for (const ws of activeWorkspaces) {
    byCategory[ws.category] = (byCategory[ws.category] || 0) + 1;
  }

  return {
    ok: true,
    summary: {
      totalWorkspaces:      regStats.total || 0,
      activeWorkspaces:     regStats.active || 0,
      failedWorkspaces:     regStats.failed || 0,
      activeMissions:       activeMissions.length,
      totalExecutions:      meshStats.totalExecutions || 0,
      successfulExecutions: meshStats.successfulExecutions || 0,
      totalMinutesSaved:    meshStats.totalMinutesSaved || 0,
      totalRecoveries:      coordStats.recoveries || 0,
    },
    activeWorkspaces,
    activeMissions,
    syncStatus: syncSummary,
    health: {
      healthy:  healthData.healthy,
      degraded: healthData.degraded,
      critical: healthData.critical,
      total:    healthData.total,
      breakdown: healthData.workspaces?.map(w => ({ type: w.type, label: w.label, score: w.score, status: w.status })) || [],
    },
    bottlenecks,
    executionGraph: {
      recentRuns,
      domainDistribution: _buildDomainDistribution(recentRuns),
    },
    founderTimeSaved: {
      totalMinutes: meshStats.totalMinutesSaved || 0,
      totalHours:   Math.round((meshStats.totalMinutesSaved || 0) / 60 * 10) / 10,
      perExecution: meshStats.totalExecutions
        ? Math.round((meshStats.totalMinutesSaved || 0) / meshStats.totalExecutions)
        : 0,
    },
    byCategory,
  };
}

function _buildDomainDistribution(runs) {
  const dist = {};
  for (const r of runs) dist[r.domain] = (dist[r.domain] || 0) + 1;
  return dist;
}

// ── Single workspace detail ───────────────────────────────────────────────────

function getWorkspaceDetail(workspaceId) {
  const ws = _wr()?.get?.(workspaceId);
  if (!ws) return { ok: false, error: "workspace not found" };

  const metrics    = _wh()?.getWorkspaceMetrics?.(workspaceId);
  const syncHistory = _ws()?.getSyncHistory?.({ limit: 10 })?.sessions?.filter(s =>
    s.results?.some(r => r.workspaceId === workspaceId)
  ) || [];
  const recentRuns = (_wc()?.listRuns?.({ limit: 20 })?.runs || []).filter(r =>
    r.subTasks?.some(t => t.workspaceId === workspaceId || t.workspaceType === ws.type)
  );

  return {
    ok: true,
    workspace: {
      ...ws,
      healthScore: metrics?.score ?? ws.health,
      metrics: metrics?.metrics || {},
      recentChecks: metrics?.recentChecks || [],
    },
    syncHistory,
    recentRuns: recentRuns.slice(-5),
    alerts: _wh()?.getAlerts?.({ limit: 10 })?.alerts?.filter(a => a.workspaceId === workspaceId) || [],
  };
}

// ── Mesh summary for executive view ──────────────────────────────────────────

function getMeshSummary() {
  const status = _mesh()?.getStatus?.() || {};
  return {
    ok:          true,
    bootstrapped: status.bootstrapped,
    workspaces:  status.workspaces,
    health:      status.health,
    bottlenecks: (status.bottlenecks || []).length,
    sync:        status.sync,
    stats:       status.stats,
  };
}

module.exports = {
  getDashboard,
  getWorkspaceDetail,
  getMeshSummary,
};
