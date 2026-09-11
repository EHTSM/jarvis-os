"use strict";
/**
 * enterpriseMonitoring.cjs — Enterprise & Physical Integration Mission,
 * Module 7: Enterprise Monitoring.
 *
 * Pure composition over existing, already-real systems — no new metrics
 * storage, no new health-check mechanism:
 *
 *   - Organization health:  organizationService.getOrg + getOrgBillingOverview
 *   - Connector health:     secretVault.listSecrets({ orgId }) — real
 *     per-org rotation/validity status, same data myConnectors.js reads
 *   - AI usage health:      usageMetering.queryFromLedger({ orgId }) +
 *     orgBudgets.checkBudget({ orgId }) — real spend-vs-cap status
 *   - Background jobs:      backgroundRuntime.getStatus() — platform-wide
 *     (jobs in this codebase aren't org-scoped; surfaced as-is, labeled
 *     platform-level, not fabricated as per-org data that doesn't exist)
 *   - Queue monitoring:     agents/taskQueue.getHealthReport() — same
 *     platform-wide caveat as background jobs
 *   - Alert center:         operationsAlertingLayer.fire/listAlerts, now
 *     orgId-aware (see that file's Module 7 changes) — evaluateOrgAlerts()
 *     below fires REAL alerts through the REAL alert engine when real
 *     thresholds are breached (connector overdue rotation, budget
 *     exceeded), rather than inventing a second alerting mechanism.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _org      = () => _try(() => require("./organizationService.cjs"));
const _vault     = () => _try(() => require("./secretVault.cjs"));
const _usage     = () => _try(() => require("./usageMetering.cjs"));
const _budgets    = () => _try(() => require("./orgBudgets.cjs"));
const _bgRuntime = () => _try(() => require("./backgroundRuntime.cjs"));
const _taskQueue = () => _try(() => require("../../agents/taskQueue.cjs"));
const _alerting  = () => _try(() => require("./operationsAlertingLayer.cjs"));

// ── Organization health ──────────────────────────────────────────────────────

function getOrgHealth(orgId, requestingAccountId) {
  const org = _org()?.getOrg?.(orgId);
  if (!org) return { ok: false, error: "Organization not found" };
  let billing = null;
  try { billing = _org()?.getOrgBillingOverview?.(orgId, requestingAccountId); } catch { /* requires manage_billing; non-fatal for a health summary */ }
  return {
    ok: true,
    orgId, name: org.name, plan: org.plan, status: org.status,
    memberCount: org.memberCount, deptCount: org.deptCount,
    billing: billing ? { byPlan: billing.byPlan, byStatus: billing.byStatus } : null,
  };
}

// ── Connector health (per-org, real vault rotation status) ──────────────────

function getConnectorHealth(orgId) {
  const secrets = _vault()?.listSecrets?.({ orgId }) || [];
  const now = Date.now();
  const details = secrets.map(r => {
    const dueAt = r.rotationDueAt ? new Date(r.rotationDueAt).getTime() : null;
    const daysLeft = dueAt ? Math.round((dueAt - now) / 86_400_000) : null;
    const status = daysLeft === null ? "ok" : daysLeft < 0 ? "overdue" : daysLeft < 14 ? "expiring" : "ok";
    return { connectorId: r.connectorId, type: r.type, status, daysUntilRotation: daysLeft, lastValidatedAt: r.lastValidatedAt };
  });
  const overdue = details.filter(d => d.status === "overdue");
  const expiring = details.filter(d => d.status === "expiring");
  return {
    ok: true, orgId,
    totalConnectors: details.length,
    ok_count: details.filter(d => d.status === "ok").length,
    expiring: expiring.length,
    overdue: overdue.length,
    score: details.length ? Math.round((details.filter(d => d.status === "ok").length / details.length) * 100) : 100,
    details,
  };
}

// ── AI usage health (per-org, real ledger + real budget) ─────────────────────

function getAiUsageHealth(orgId) {
  const events = _usage()?.queryFromLedger?.({ orgId, limit: 1000 }) || [];
  const budgetStatus = _budgets()?.checkBudget?.({ orgId }) || { allowed: true };
  const totalCostUsd = events.reduce((sum, e) => sum + (e.estimatedCostUsd || 0), 0);
  const failCount = events.filter(e => e.success === false).length;
  return {
    ok: true, orgId,
    requestsLast1000: events.length,
    totalCostUsdSampled: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    failureCountSampled: failCount,
    budget: budgetStatus.org || null,
    budgetAllowed: budgetStatus.allowed,
    budgetReason: budgetStatus.reason || null,
  };
}

// ── Background jobs / queue monitoring (platform-wide, explicitly labeled) ──

function getBackgroundJobsHealth() {
  const status = _bgRuntime()?.getStatus?.() || { running: false, observers: [] };
  return { ok: true, scope: "platform", running: status.running, observers: status.observers };
}

function getQueueHealth() {
  const report = _taskQueue()?.getHealthReport?.();
  return { ok: true, scope: "platform", ...(report || {}) };
}

// ── Alert center ──────────────────────────────────────────────────────────────

function getOrgAlerts(orgId, opts = {}) {
  return _alerting()?.listAlerts?.({ orgId, ...opts }) || { alerts: [], total: 0, stats: {} };
}

/**
 * Evaluates real per-org thresholds and fires/resolves real alerts through
 * operationsAlertingLayer — the same engine backing the platform-wide
 * probe() cycle, just with orgId attached. Call this from a route (on
 * demand) rather than a new global timer, since Module 7's scope is
 * per-org monitoring, not another platform-wide background loop.
 */
function evaluateOrgAlerts(orgId) {
  const alerting = _alerting();
  if (!alerting) return { fired: [], resolved: [] };
  const fired = [];
  const resolved = [];

  const connHealth = getConnectorHealth(orgId);
  const dedupeConn = "connector_rotation_overdue";
  if (connHealth.overdue > 0) {
    fired.push(alerting.fire({
      orgId, title: "Connector credential rotation overdue",
      detail: `${connHealth.overdue} connector credential(s) past their rotation due date`,
      severity: "warning", source: "enterpriseMonitoring", category: "connectors",
      dedupeKey: dedupeConn,
    }).alertId);
  } else {
    const existing = alerting.listAlerts({ orgId, status: "firing" }).alerts.find(a => a.dedupeKey === `${orgId}::${dedupeConn}`);
    if (existing) { alerting.resolve(existing.alertId); resolved.push(existing.alertId); }
  }

  const aiHealth = getAiUsageHealth(orgId);
  const dedupeBudget = "ai_budget_exceeded";
  if (!aiHealth.budgetAllowed) {
    fired.push(alerting.fire({
      orgId, title: "AI budget exceeded",
      detail: aiHealth.budgetReason || "Organization AI budget cap reached",
      severity: "critical", source: "enterpriseMonitoring", category: "billing",
      dedupeKey: dedupeBudget,
    }).alertId);
  } else {
    const existing = alerting.listAlerts({ orgId, status: "firing" }).alerts.find(a => a.dedupeKey === `${orgId}::${dedupeBudget}`);
    if (existing) { alerting.resolve(existing.alertId); resolved.push(existing.alertId); }
  }

  return { fired, resolved, evaluatedAt: new Date().toISOString() };
}

module.exports = {
  getOrgHealth,
  getConnectorHealth,
  getAiUsageHealth,
  getBackgroundJobsHealth,
  getQueueHealth,
  getOrgAlerts,
  evaluateOrgAlerts,
};
