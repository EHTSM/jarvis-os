"use strict";
/**
 * approvalDashboard.cjs — POST-Ω Sprint P4
 *
 * Aggregated dashboard data for the Approval & Human-in-the-Loop system.
 * Single source of truth for the frontend dashboard panel.
 *
 * Data structure mirrors the execution dashboard pattern:
 *   waiting / approved / rejected / expired
 *   avg approval delay
 *   founder response time
 *   automation blocked by approvals
 *   estimated minutes saved
 *   trend (7-day)
 *   auto-approve candidates
 *   class B coverage (how many of 32 Class B workflows are now approval-driven)
 */

const _try   = fn => { try { return fn(); } catch { return null; } };
const _ae    = () => _try(() => require("./approvalEngine.cjs"));
const _aq    = () => _try(() => require("./approvalQueue.cjs"));
const _aev   = () => _try(() => require("./approvalEvidence.cjs"));
const _aa    = () => _try(() => require("./approvalAnalytics.cjs"));
const _pol   = () => _try(() => require("./approvalPolicy.cjs"));
const _fwr   = () => _try(() => require("./founderWorkRegistry.cjs"));
const _hitl  = () => _try(() => require("./humanInTheLoop.cjs"));

function getDashboard() {
  // Queue stats
  const aqStats   = _aq()?.getStats?.()    || {};
  const evSummary = _aev()?.getSummary?.() || {};
  const aeStats   = _ae()?.getStats?.()    || {};
  const analytics = _aa()?.getApprovalBlockageReport?.() || {};
  const policies  = _pol()?.listPolicies?.() || [];

  // HITL legacy pending
  const hitlPending = _hitl()?.listPending?.()?.length || 0;

  // Class B coverage
  const reg     = _fwr()?.getRegistry?.() || { workflows: [] };
  const classB  = (reg.workflows || []).filter(w => w.class === "B");
  const covered = classB.filter(w => policies.some(p => p.workflowId === w.id));

  // Recent approvals (last 10)
  const recent = [
    ...(_aq()?.listByStatus?.("approved", 5) || []),
    ...(_aq()?.listByStatus?.("rejected", 3) || []),
    ...(_aq()?.listByStatus?.("expired",  2) || []),
  ].sort((a, b) => new Date(b.approvedAt || b.createdAt) - new Date(a.approvedAt || a.createdAt)).slice(0, 10);

  return {
    ok: true,
    summary: {
      waiting:              aqStats.pending     || 0,
      approved:             aqStats.approved    || 0,
      rejected:             aqStats.rejected    || 0,
      expired:              aqStats.expired     || 0,
      autoApproved:         aqStats.autoApproved|| 0,
      totalRequests:        aqStats.created     || 0,
      hitlLegacyPending:    hitlPending,
      avgApprovalDelayMs:   aqStats.avgResponseMs || 0,
      avgApprovalDelayMin:  aqStats.avgResponseMinutes || 0,
      founderResponseTimeMs:aqStats.avgResponseMs || 0,
      founderResponseTimeMin:aqStats.avgResponseMinutes || 0,
    },
    automation: {
      classBTotal:             classB.length,
      classBCovered:           covered.length,
      classBCoveragePercent:   classB.length > 0 ? Math.round(covered.length / classB.length * 100) : 0,
      blockedMinutes:          analytics.blockedMinutes || 0,
      blockedWorkflows:        analytics.blockedWorkflows || [],
      minutesSaved:            analytics.minutesSaved || {},
      autoApproveCandidates:   analytics.autoApproveCandidates || [],
    },
    evidence: {
      totalEvents:           evSummary.totalEvents    || 0,
      verified:              evSummary.verified       || 0,
      avgResponseMinutes:    evSummary.avgResponseMinutes || 0,
      minutesSaved:          evSummary.minutesSaved   || 0,
    },
    sessions: {
      requested:   aeStats.requested  || 0,
      approved:    aeStats.approved   || 0,
      rejected:    aeStats.rejected   || 0,
      autoApproved:aeStats.autoApproved || 0,
      resumed:     aeStats.resumed    || 0,
      verified:    aeStats.verified   || 0,
      minutesSaved:aeStats.minutesSaved || 0,
    },
    trend:      analytics.trend || [],
    byType:     analytics.responseTimeByType || [],
    recentActivity: recent,
    pendingQueue:   _aq()?.listPending?.() || [],
    generatedAt:    new Date().toISOString(),
  };
}

function getPendingForFounder() {
  const pending = _aq()?.listPending?.() || [];
  return pending.map(req => ({
    reqId:           req.id,
    workflowId:      req.workflowId,
    action:          req.action,
    risk:            req.risk,
    approvalType:    req.approvalType,
    reason:          req.reason,
    expectedOutcome: req.expectedOutcome,
    rollbackPlan:    req.rollbackPlan,
    confidence:      req.confidence,
    estimatedMs:     req.estimatedMs,
    createdAt:       req.createdAt,
    expiresAt:       req.expiresAt,
    waitingMinutes:  Math.round((Date.now() - new Date(req.createdAt).getTime()) / 60000),
    callToAction:    "Tap Approve to resume execution automatically",
  }));
}

module.exports = { getDashboard, getPendingForFounder };
