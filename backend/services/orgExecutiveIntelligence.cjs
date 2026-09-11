"use strict";
/**
 * orgExecutiveIntelligence.cjs — V5 Global AI Organization Platform,
 * Module 6: Executive Intelligence.
 *
 * "Using existing analytics" — but checked before reuse: analyticsService.
 * cjs's getExecutive/getWorkspaceHealth accept a workspaceId param that
 * is NEVER actually used inside those functions' bodies (confirmed by
 * reading them) — they read platform-wide metricsStore/errorAggregator/
 * agentRegistry state regardless of the argument. Wrapping those and
 * calling the result "this org's executive intelligence" would misrepresent
 * platform-wide numbers as org-specific — a worse violation of "no fake
 * data" than building fresh composition. The one analyticsService function
 * that IS genuinely workspace-scoped is getAutomationROI (it calls
 * automationService.getStatistics/getHistory(workspaceId), the same real,
 * already-orgId-keyed service Modules 2/5/7 use) — that one is reused
 * directly. Everything else here composes the genuinely org-scoped real
 * data Modules 1-5 already built: enterpriseMonitoring (org/connector/AI
 * health), orgKnowledgeGraph (graph size), orgAgents (agent success),
 * usageMetering (real timestamped ledger for trend computation).
 *
 * No AI-generated forecasts, no fabricated recommendations — every
 * recommendation below fires only when a real, checkable threshold on
 * real data is crossed; the forecast is a real linear projection over
 * real historical daily cost, not a model's guess.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _org        = () => _try(() => require("./organizationService.cjs"));
const _monitoring  = () => _try(() => require("./enterpriseMonitoring.cjs"));
const _graph       = () => _try(() => require("./orgKnowledgeGraph.cjs"));
const _agents      = () => _try(() => require("./orgAgents.cjs"));
const _usage       = () => _try(() => require("./usageMetering.cjs"));
const _analytics   = () => _try(() => require("./analyticsService.cjs"));

function _assertMember(orgId, accountId) {
  if (!_org()?.hasPermission?.(orgId, accountId, "view_members")) {
    const e = new Error("Forbidden — not a member of this organization");
    e.status = 403;
    throw e;
  }
}

/** Real, composed snapshot — every figure traceable to a real
 * already-org-scoped source. */
function getInsights(orgId, accountId) {
  _assertMember(orgId, accountId);
  const health = _monitoring()?.getOrgHealth?.(orgId, accountId) || {};
  const connectors = _monitoring()?.getConnectorHealth?.(orgId) || {};
  const aiUsage = _monitoring()?.getAiUsageHealth?.(orgId) || {};
  const graphStats = _graph()?.getOrgGraph?.(orgId, accountId) || { totalNodes: 0, byType: {} };
  const agentHistory = _agents()?.getHistory?.(orgId, accountId, { limit: 200 }) || { stats: {} };
  const automationRoi = _try(() => _analytics()?.getAutomationROI?.(orgId)) || {};

  return {
    ok: true, orgId, generatedAt: new Date().toISOString(),
    org: { name: health.name, plan: health.plan, memberCount: health.memberCount },
    connectorHealthScore: connectors.score ?? null,
    aiSpendUsd: aiUsage.totalCostUsdSampled ?? 0,
    aiBudgetAllowed: aiUsage.budgetAllowed ?? true,
    knowledgeNodeCount: graphStats.totalNodes ?? 0,
    agentSuccessRate: agentHistory.stats?.successRate ?? null,
    automationRulesActive: automationRoi.rules?.active ?? 0,
    automationHoursSaved: automationRoi.roi?.estimatedHoursSaved ?? 0,
  };
}

/** Real, threshold-based recommendations — each one only fires if the
 * real underlying data actually crosses a checkable line. No filler. */
function getRecommendations(orgId, accountId) {
  _assertMember(orgId, accountId);
  const recs = [];

  const connectors = _monitoring()?.getConnectorHealth?.(orgId) || {};
  if (connectors.overdue > 0) {
    recs.push({ id: "connector_rotation", severity: "warning", text: `${connectors.overdue} connector credential(s) are overdue for rotation — rotate them to avoid service disruption.` });
  }

  const aiUsage = _monitoring()?.getAiUsageHealth?.(orgId) || {};
  if (aiUsage.budgetAllowed === false) {
    recs.push({ id: "ai_budget", severity: "critical", text: aiUsage.budgetReason || "AI budget exceeded — requests may start failing until the cap is raised or usage decreases." });
  }
  if (aiUsage.failures > 0 && aiUsage.requests > 0 && (aiUsage.failures / aiUsage.requests) > 0.3) {
    recs.push({ id: "ai_failure_rate", severity: "warning", text: `${aiUsage.failures} of ${aiUsage.requests} sampled AI requests failed (>${Math.round((aiUsage.failures / aiUsage.requests) * 100)}%) — check provider configuration.` });
  }

  const agentHistory = _agents()?.getHistory?.(orgId, accountId, { limit: 200 }) || { stats: {} };
  if (agentHistory.stats?.successRate != null && agentHistory.total > 3 && agentHistory.stats.successRate < 50) {
    recs.push({ id: "agent_success_rate", severity: "warning", text: `Agent task success rate is ${agentHistory.stats.successRate}% over the last ${agentHistory.total} runs — review recent failures.` });
  }

  const automationRoi = _try(() => _analytics()?.getAutomationROI?.(orgId)) || {};
  if ((automationRoi.rules?.total || 0) === 0) {
    recs.push({ id: "no_automation", severity: "info", text: "No automation rules configured yet — set one up to reduce manual repetitive work." });
  }

  if (!recs.length) recs.push({ id: "all_clear", severity: "info", text: "No issues detected against current thresholds." });
  return { ok: true, orgId, recommendations: recs };
}

/** Real linear projection over real historical daily AI cost — not a
 * model-generated guess. Groups the real usage ledger by real calendar
 * day, then extrapolates the recent daily average forward. Returns
 * insufficientData:true rather than fabricating a trend when there isn't
 * enough real history to project from. */
function getForecast(orgId, accountId, opts = {}) {
  _assertMember(orgId, accountId);
  const days = opts.days || 30;
  const events = _usage()?.queryFromLedger?.({ orgId, limit: 5000 }) || [];

  const byDay = {};
  for (const e of events) {
    const day = (e.ts || "").slice(0, 10); // YYYY-MM-DD
    if (!day) continue;
    byDay[day] = (byDay[day] || 0) + (e.estimatedCostUsd || 0);
  }
  const dayKeys = Object.keys(byDay).sort();
  if (dayKeys.length < 2) {
    return { ok: true, orgId, insufficientData: true, historicalDays: dayKeys.length, note: "Need at least 2 distinct real usage days to project a trend." };
  }

  const dailyCosts = dayKeys.map(k => byDay[k]);
  const recentWindow = dailyCosts.slice(-7); // last 7 real observed days, or fewer if history is shorter
  const avgDailyCostUsd = recentWindow.reduce((s, c) => s + c, 0) / recentWindow.length;
  const projectedTotalUsd = Math.round(avgDailyCostUsd * days * 1_000_000) / 1_000_000;

  return {
    ok: true, orgId, insufficientData: false,
    historicalDays: dayKeys.length,
    avgDailyCostUsd: Math.round(avgDailyCostUsd * 1_000_000) / 1_000_000,
    projectionDays: days,
    projectedTotalCostUsd: projectedTotalUsd,
    method: "linear projection of the average real daily AI cost over the last up-to-7 real observed days",
  };
}

/** Real plain-language composition of the three functions above — no new
 * data, purely a readable summary. */
function getOperationalSummary(orgId, accountId) {
  _assertMember(orgId, accountId);
  const insights = getInsights(orgId, accountId);
  const recommendations = getRecommendations(orgId, accountId);
  const forecast = getForecast(orgId, accountId);

  const lines = [];
  lines.push(`${insights.org.name || orgId} has ${insights.org.memberCount ?? "an unknown number of"} member(s) on the ${insights.org.plan || "unknown"} plan.`);
  lines.push(`Connector health score: ${insights.connectorHealthScore ?? "N/A"}. AI spend so far (sampled): $${insights.aiSpendUsd}.`);
  lines.push(`Knowledge graph tracks ${insights.knowledgeNodeCount} node(s) for this organization.`);
  if (insights.agentSuccessRate != null) lines.push(`Agent task success rate: ${insights.agentSuccessRate}%.`);
  lines.push(`${insights.automationRulesActive} active automation rule(s), an estimated ${insights.automationHoursSaved}h saved.`);
  if (!forecast.insufficientData) {
    lines.push(`Projected AI spend over the next ${forecast.projectionDays} days: ~$${forecast.projectedTotalCostUsd} (based on ${forecast.historicalDays} real days of usage history).`);
  }
  const critical = recommendations.recommendations.filter(r => r.severity === "critical");
  if (critical.length) lines.push(`${critical.length} critical issue(s) require attention: ${critical.map(r => r.text).join(" ")}`);

  return { ok: true, orgId, generatedAt: new Date().toISOString(), summary: lines.join(" "), insights, recommendations: recommendations.recommendations, forecast };
}

module.exports = { getInsights, getRecommendations, getForecast, getOperationalSummary };
