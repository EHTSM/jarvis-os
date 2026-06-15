"use strict";
/**
 * K6 — Enterprise Analytics Service
 * Pure aggregation layer — reads from existing services.
 * No new storage. No new observers. No new metrics engine.
 *
 * Sources:
 *   metricsStore          → request/error/latency counters
 *   errorAggregator       → error rates, top errors
 *   taskGraph             → graph execution stats
 *   autonomousLoop        → task failure/timing reports
 *   missionMemory         → mission success/failure trends
 *   backgroundRuntime     → runtime recommendations
 *   intelligenceLayer     → correlations, insights, trends
 *   aiService             → provider call counts + health
 *   securityLayer         → audit events, security score
 *   adminService          → team/member stats
 *   governanceService     → compliance score, policy stats, risk matrix
 *   automationService     → rule stats, history outcomes
 *   continuousLearning    → lessons + recommendation backlog
 */
const path = require("path");

// ── Lazy service loaders ──────────────────────────────────────────
let _ms, _ea, _tg, _al, _mm, _br, _il, _ai, _sec, _admin, _gov, _auto, _cl, _ar;

function _metricsStore()   { if (!_ms)    try { _ms    = require("../utils/metricsStore");                         } catch {} return _ms;    }
function _errAgg()         { if (!_ea)    try { _ea    = require("./errorAggregator.cjs");                         } catch {} return _ea;    }
function _tGraph()         { if (!_tg)    try { _tg    = require("./taskGraph.cjs");                               } catch {} return _tg;    }
function _autoLoop()       { if (!_al)    try { _al    = require("../../agents/autonomousLoop.cjs");               } catch {} return _al;    }
function _missions()       { if (!_mm)    try { _mm    = require("./missionMemory.cjs");                           } catch {} return _mm;    }
function _bgRuntime()      { if (!_br)    try { _br    = require("./backgroundRuntime.cjs");                       } catch {} return _br;    }
function _intel()          { if (!_il)    try { _il    = require("./intelligenceLayer.cjs");                       } catch {} return _il;    }
function _aiSvc()          { if (!_ai)    try { _ai    = require("./aiService.js");                                } catch {} return _ai;    }
function _secLayer(ws)     { if (!_sec)   try { _sec   = require("./securityLayer.cjs");                           } catch {} return _sec;   }
function _adminSvc()       { if (!_admin) try { _admin = require("./adminService.cjs");                            } catch {} return _admin; }
function _govSvc()         { if (!_gov)   try { _gov   = require("./governanceService.cjs");                       } catch {} return _gov;   }
function _autoSvc()        { if (!_auto)  try { _auto  = require("./automationService.cjs");                       } catch {} return _auto;  }
function _learning()       { if (!_cl)    try { _cl    = require("./continuousLearningEngine.cjs");                } catch {} return _cl;    }
function _agentReg()       { if (!_ar)    try { _ar    = require("../../agents/runtime/agentRegistry.cjs");        } catch {} return _ar;    }

// ── Safe call helpers ─────────────────────────────────────────────
function _try(fn, fallback = null) { try { return fn(); } catch { return fallback; } }

// ── Executive KPIs ────────────────────────────────────────────────
// Aggregates the top-level health, throughput, and AI signals.

function getExecutive(workspaceId = "default") {
  const ms      = _metricsStore();
  const snap    = _try(() => ms?.getSnapshot(), {});
  const ea      = _errAgg();
  const errRate = _try(() => ea?.getErrorRate(), 0);
  const topErr  = _try(() => ea?.getTopErrors(3), []);
  const br      = _bgRuntime();
  const brRecs  = _try(() => br?.getRecommendations({ limit: 5 }), { total: 0 });
  const agents  = _try(() => _agentReg()?.listAll(), []);
  const aiSvc   = _aiSvc();
  const aiSnap  = _try(() => aiSvc?.getProviderStatus(), {});

  const uptimeSec = snap?.uptime || Math.round(process.uptime());
  const healthScore = Math.max(0, Math.min(100, Math.round(100 - (errRate * 10))));

  return {
    generatedAt: Date.now(),
    kpis: {
      healthScore,
      uptimeSeconds:    uptimeSec,
      totalRequests:    snap?.requests      || 0,
      errorRate:        snap?.error_rate    || 0,
      activeAgents:     agents.length,
      aiProvidersUp:    Object.values(aiSnap).filter(p => p?.available).length,
      runtimeRecs:      brRecs.total || 0,
    },
    topErrors: topErr,
    byIntent:  snap?.byIntent  || {},
    latency:   snap?.latency   || {},
  };
}

// ── Workspace Health ──────────────────────────────────────────────
function getWorkspaceHealth(workspaceId = "default") {
  const sec      = _secLayer();
  const score    = _try(() => sec?.getSecurityScore(workspaceId), { score: 0, grade: "N/A", factors: [] });
  const sessions = _try(() => sec?.getSessions(workspaceId), []);
  const policies = _try(() => sec?.getPolicies(workspaceId), {});
  const admin    = _adminSvc();
  const stats    = _try(() => admin?.getStatistics(workspaceId), {});
  const quotas   = _try(() => admin?.getQuotas(workspaceId), {});
  const govSvc   = _govSvc();
  const reports  = _try(() => govSvc?.getReports(workspaceId), {});

  return {
    generatedAt: Date.now(),
    security: {
      score:        score?.score    || 0,
      grade:        score?.grade    || "N/A",
      activeSessions: Array.isArray(sessions) ? sessions.length : 0,
    },
    governance: {
      complianceScore: reports?.compliance?.score  || 0,
      complianceGrade: reports?.compliance?.grade  || "N/A",
      activePolicies:  reports?.policies?.active   || 0,
    },
    members: {
      total:      stats?.members?.total      || 0,
      active:     stats?.members?.active     || 0,
      suspended:  stats?.members?.suspended  || 0,
    },
    quotas: {
      maxMembers:    quotas?.maxMembers    || 0,
      maxApiTokens:  quotas?.maxApiTokens  || 0,
    },
  };
}

// ── Team Productivity ─────────────────────────────────────────────
function getProductivity(workspaceId = "default") {
  const ms       = _metricsStore();
  const snap     = _try(() => ms?.getSnapshot(), {});
  const al       = _autoLoop();
  const timing   = _try(() => al?.getTimingReport(), { type_breakdown: [], slow_tasks: [] });
  const failures = _try(() => al?.getFailureReport(), []);
  const cl       = _learning();
  const clStats  = _try(() => cl?.getStats(), {});

  return {
    generatedAt: Date.now(),
    requests: {
      total:   snap?.requests    || 0,
      errors:  snap?.errors      || 0,
      byMode:  snap?.byMode      || {},
    },
    taskExecution: {
      typeBreakdown:  timing?.type_breakdown || [],
      slowTaskCount:  (timing?.slow_tasks || []).length,
      topFailures:    failures.slice(0, 5),
    },
    learning: {
      totalLessons:         clStats?.totalLessons         || 0,
      appliedLessons:       clStats?.appliedLessons       || 0,
      openRecommendations:  clStats?.openRecs             || 0,
    },
  };
}

// ── Automation ROI ────────────────────────────────────────────────
function getAutomationROI(workspaceId = "default") {
  const autoSvc = _autoSvc();
  const stats   = _try(() => autoSvc?.getStatistics(workspaceId), { rules: {}, history: {} });
  const history = _try(() => autoSvc?.getHistory(workspaceId, { limit: 200 }), []);

  const successCount   = stats?.history?.byOutcome?.success     || 0;
  const totalFired     = (stats?.history?.total || 0) - (stats?.history?.byOutcome?.dry_run || 0);
  const successRate    = totalFired > 0 ? +((successCount / totalFired) * 100).toFixed(1) : 0;

  // Rough time-saved estimate: each queued_task automation saves ~5 min of manual work
  const queueTaskRuns  = history.filter(h => !h.dryRun && h.outcome === "success").length;
  const estimatedMinSaved = queueTaskRuns * 5;

  return {
    generatedAt: Date.now(),
    rules: {
      total:     stats?.rules?.total  || 0,
      active:    stats?.rules?.active || 0,
      byTrigger: stats?.rules?.byTrigger || {},
    },
    execution: {
      total:       stats?.history?.total   || 0,
      last24h:     stats?.history?.last24h || 0,
      last7d:      stats?.history?.last7d  || 0,
      successRate,
      byOutcome:   stats?.history?.byOutcome || {},
    },
    roi: {
      estimatedMinSaved,
      estimatedHoursSaved: +(estimatedMinSaved / 60).toFixed(1),
      automationRunsTotal: totalFired,
    },
    topRules: stats?.topRules || [],
  };
}

// ── Security Overview ─────────────────────────────────────────────
function getSecurityOverview(workspaceId = "default") {
  const sec     = _secLayer();
  const score   = _try(() => sec?.getSecurityScore(workspaceId), {});
  const audit   = _try(() => sec?.getAuditLog(workspaceId, { limit: 100 }), []);
  const devices = _try(() => sec?.getDevices(workspaceId), []);
  const tokens  = _try(() => sec?.getTokens(workspaceId), []);

  const eventsByType = {};
  for (const e of audit) {
    const prefix = (e.action || "other").split(".")[0];
    eventsByType[prefix] = (eventsByType[prefix] || 0) + 1;
  }

  const last24h = audit.filter(e => e.ts && e.ts > Date.now() - 86400_000).length;

  return {
    generatedAt: Date.now(),
    score:          score?.score     || 0,
    grade:          score?.grade     || "N/A",
    factors:        score?.factors   || [],
    audit: {
      total:      audit.length,
      last24h,
      byType:     eventsByType,
      recent:     audit.slice(0, 10),
    },
    devices: {
      total:   Array.isArray(devices) ? devices.length : 0,
      trusted: Array.isArray(devices) ? devices.filter(d => d.trusted).length : 0,
    },
    tokens: {
      total:  Array.isArray(tokens) ? tokens.length : 0,
      active: Array.isArray(tokens) ? tokens.filter(t => t.status === "active").length : 0,
    },
  };
}

// ── Governance Overview ───────────────────────────────────────────
function getGovernanceOverview(workspaceId = "default") {
  const govSvc     = _govSvc();
  const reports    = _try(() => govSvc?.getReports(workspaceId), {});
  const riskMatrix = _try(() => govSvc?.getRiskMatrix(workspaceId), []);
  const compliance = _try(() => govSvc?.getCompliance(workspaceId), {});

  const riskCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of riskMatrix) riskCounts[r.riskLevel] = (riskCounts[r.riskLevel] || 0) + 1;

  return {
    generatedAt: Date.now(),
    compliance: {
      score:      reports?.compliance?.score  || 0,
      grade:      reports?.compliance?.grade  || "N/A",
      frameworks: compliance?.frameworks      || [],
      nextReview: compliance?.nextReviewAt    || null,
    },
    policies: {
      total:    reports?.policies?.total    || 0,
      active:   reports?.policies?.active   || 0,
      blocking: reports?.policies?.blocking || 0,
      byType:   reports?.policies?.byType   || {},
    },
    risk: {
      summary:     riskCounts,
      highestRisk: (riskMatrix).sort((a, b) => b.score - a.score).slice(0, 3),
    },
  };
}

// ── AI Provider Utilization ───────────────────────────────────────
function getAIUtilization() {
  const aiSvc     = _aiSvc();
  const providers = _try(() => aiSvc?.getProviderStatus(), {});
  const ms        = _metricsStore();
  const snap      = _try(() => ms?.getSnapshot(), {});

  const providerList = Object.entries(providers).map(([name, info]) => ({
    name,
    available: info?.available  || false,
    hasKey:    info?.hasKey     || false,
    callCount: info?.callCount  || 0,
    lastFailure: info?.lastFailure || null,
  }));

  const totalCalls = providerList.reduce((s, p) => s + p.callCount, 0);

  return {
    generatedAt: Date.now(),
    providers: providerList,
    totalCalls,
    requestsTotal: snap?.requests || 0,
    latency:       snap?.latency  || {},
  };
}

// ── Runtime Capacity ──────────────────────────────────────────────
function getRuntimeCapacity(workspaceId = "default") {
  const al       = _autoLoop();
  const queue    = _try(() => al?.getQueue(), []);
  const timing   = _try(() => al?.getTimingReport(), { type_breakdown: [], slow_tasks: [], recent_execs: [] });
  const tg       = _tGraph();
  const graphs   = _try(() => tg?.getGraphStats(), {});
  const br       = _bgRuntime();
  const brStatus = _try(() => br?.getStatus(), {});
  const agents   = _try(() => _agentReg()?.listAll(), []);
  const missions = _try(() => _missions()?.getMissionStats(), {});

  const mem = process.memoryUsage();

  return {
    generatedAt: Date.now(),
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMB:      Math.round(mem.rss / 1024 / 1024),
      heapUsedMB:    Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB:   Math.round(mem.heapTotal / 1024 / 1024),
    },
    taskQueue: {
      pending:        Array.isArray(queue) ? queue.filter(t => t.status === "pending").length  : 0,
      running:        Array.isArray(queue) ? queue.filter(t => t.status === "running").length  : 0,
      total:          Array.isArray(queue) ? queue.length : 0,
      typeBreakdown:  timing?.type_breakdown  || [],
      slowTaskCount:  (timing?.slow_tasks     || []).length,
      recentExecs:    (timing?.recent_execs   || []).slice(0, 5),
    },
    graphs: {
      total:      graphs?.total       || 0,
      completed:  graphs?.completed   || 0,
      failed:     graphs?.failed      || 0,
      running:    graphs?.running     || 0,
      avgDurationMs: graphs?.avgDurationMs || 0,
    },
    agents: { count: agents.length },
    missions: {
      total:       missions?.total       || 0,
      byStatus:    missions?.byStatus    || {},
      failureRate: missions?.failureRate || 0,
    },
    backgroundRuntime: {
      running: brStatus?.running || false,
    },
  };
}

// ── Mission Success Trends ─────────────────────────────────────────
// (included in getExecutive reports endpoint, surfaced separately too)
function getMissionTrends() {
  const mm    = _missions();
  const stats = _try(() => mm?.getMissionStats(), {});
  const list  = _try(() => mm?.listMissions({ limit: 20 }), { missions: [] });

  const recent = (list?.missions || []).slice(0, 20).map(m => ({
    id:         m.id,
    title:      m.title,
    status:     m.status,
    priority:   m.priority,
    createdAt:  m.createdAt,
    completedAt: m.completedAt,
    subtasks:   m.subtasks?.length   || 0,
    learnings:  m.learnings?.length  || 0,
    failures:   m.failures?.length   || 0,
  }));

  return {
    generatedAt: Date.now(),
    stats,
    recentMissions: recent,
  };
}

// ── Enterprise Report (rolled-up) ─────────────────────────────────
function getEnterpriseReport(workspaceId = "default") {
  return {
    generatedAt: Date.now(),
    executive:    getExecutive(workspaceId),
    workspace:    getWorkspaceHealth(workspaceId),
    productivity: getProductivity(workspaceId),
    automation:   getAutomationROI(workspaceId),
    security:     getSecurityOverview(workspaceId),
    governance:   getGovernanceOverview(workspaceId),
    ai:           getAIUtilization(),
    runtime:      getRuntimeCapacity(workspaceId),
    missions:     getMissionTrends(),
  };
}

module.exports = {
  getExecutive,
  getWorkspaceHealth,
  getProductivity,
  getAutomationROI,
  getSecurityOverview,
  getGovernanceOverview,
  getAIUtilization,
  getRuntimeCapacity,
  getMissionTrends,
  getEnterpriseReport,
};
