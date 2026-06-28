"use strict";
/**
 * approvalAnalytics.cjs — POST-Ω Sprint P4
 *
 * Aggregates metrics across the approval lifecycle to answer:
 *   - What is blocking execution longest?
 *   - Which approval types have the fastest founder response?
 *   - Which workflows could be auto-approved (high confidence + low risk)?
 *   - How many founder-minutes are being saved vs still blocked?
 *   - What is the trend over the last 7 days?
 *
 * Reads from: approvalQueue (data/approval-queue.json)
 *             approvalEvidence (data/approval-evidence-index.json)
 *             founderWorkRegistry (for workflow metadata)
 *             executionEvidence (for cross-reference)
 *
 * No new storage — pure aggregation service.
 */

const fs   = require("fs");
const path = require("path");

const ROOT  = path.join(__dirname, "../..");
const _try  = fn => { try { return fn(); } catch { return null; } };
const _aq   = () => _try(() => require("./approvalQueue.cjs"));
const _aev  = () => _try(() => require("./approvalEvidence.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _pol  = () => _try(() => require("./approvalPolicy.cjs"));

function _rj(f, fb) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fb; } }

// ── Blocked time calculation ──────────────────────────────────────────────────
// A workflow is "blocked by approvals" if it is Class B and has pending requests

function getBlockedMinutes() {
  const aq  = _aq();
  const fwr = _fwr();
  if (!aq || !fwr) return { ok: false, blockedMinutes: 0, blockedWorkflows: [] };

  const pending  = aq.listPending();
  const blocked  = [];
  let   totalMin = 0;

  for (const req of pending) {
    const w = fwr.getWorkflow(req.workflowId);
    const waitMs  = Date.now() - new Date(req.createdAt).getTime();
    const waitMin = Math.round(waitMs / 60000);
    blocked.push({ workflowId: req.workflowId, workflow: w?.workflow || req.action, waitMinutes: waitMin, approvalType: req.approvalType, risk: req.risk });
    totalMin += w?.estimatedMinutes || 0;
  }

  return { ok: true, blockedMinutes: totalMin, blockedWorkflows: blocked };
}

// ── Response time by approval type ────────────────────────────────────────────

function getResponseTimeByType() {
  const idx = _rj(path.join(ROOT, "data/approval-evidence-index.json"), []);
  const byType = {};

  for (const e of idx) {
    if (!e.approvalType || e.responseMs == null || e.responseMs <= 0) continue;
    if (!byType[e.approvalType]) byType[e.approvalType] = { count: 0, totalMs: 0 };
    byType[e.approvalType].count++;
    byType[e.approvalType].totalMs += e.responseMs;
  }

  return Object.entries(byType).map(([type, d]) => ({
    approvalType:     type,
    count:            d.count,
    avgResponseMs:    Math.round(d.totalMs / d.count),
    avgResponseMin:   Math.round(d.totalMs / d.count / 60000 * 10) / 10,
  })).sort((a, b) => a.avgResponseMs - b.avgResponseMs);
}

// ── Auto-approve candidates ───────────────────────────────────────────────────
// Workflows where past approvals were fast + confidence is high → auto-approve

function getAutoApproveCandidates() {
  const fwr  = _fwr();
  const pol  = _pol();
  if (!fwr || !pol) return [];

  const reg      = fwr.getRegistry();
  const classB   = (reg.workflows || []).filter(w => w.class === "B");
  const idx      = _rj(path.join(ROOT, "data/approval-evidence-index.json"), []);

  return classB.filter(w => {
    const history = idx.filter(e => e.workflowId === w.id && (e.event === "approved" || e.event === "auto_approved"));
    if (history.length < 2) return false; // need at least 2 approvals to infer pattern
    const allFast = history.every(e => e.responseMs != null && e.responseMs < 300000); // < 5 min response
    const neverRejected = !idx.some(e => e.workflowId === w.id && e.event === "rejected");
    const policy = pol.getPolicy(w.id);
    return allFast && neverRejected && policy.risk !== pol.RISK.CRITICAL;
  }).map(w => ({
    workflowId: w.id,
    workflow:   w.workflow,
    domain:     w.domain,
    approvals:  idx.filter(e => e.workflowId === w.id && e.event === "approved").length,
    recommendation: "promote_to_auto_approve",
  }));
}

// ── 7-day trend ───────────────────────────────────────────────────────────────

function getTrend() {
  const idx   = _rj(path.join(ROOT, "data/approval-evidence-index.json"), []);
  const trend = [];

  for (let d = 6; d >= 0; d--) {
    const day    = new Date(Date.now() - d * 86400000);
    const dayStr = day.toISOString().slice(0, 10);
    const recs   = idx.filter(e => e.ts?.startsWith(dayStr));
    trend.push({
      date:         dayStr,
      created:      recs.filter(e => e.event === "created").length,
      approved:     recs.filter(e => e.event === "approved").length,
      autoApproved: recs.filter(e => e.autoApproved).length,
      rejected:     recs.filter(e => e.event === "rejected").length,
      minutesSaved: recs.filter(e => e.event === "verified").reduce((s, e) => s + (e.minutesSaved || 0), 0),
    });
  }

  return trend;
}

// ── Estimated minutes saved ───────────────────────────────────────────────────

function getMinutesSaved() {
  const idx        = _rj(path.join(ROOT, "data/approval-evidence-index.json"), []);
  const fromApproval = idx.filter(e => e.event === "verified").reduce((s, e) => s + (e.minutesSaved || 0), 0);
  const fromAuto     = idx.filter(e => e.autoApproved).length; // each auto-approve saves the approval-waiting time (~5 min avg)
  return { fromApproval, fromAutoApprove: fromAuto * 5, total: fromApproval + fromAuto * 5 };
}

// ── Automation blocked by approvals ──────────────────────────────────────────

function getApprovalBlockageReport() {
  const aqStats   = _aq()?.getStats?.() || {};
  const evSummary = _aev()?.getSummary?.() || {};
  const blocked   = getBlockedMinutes();
  const candidates= getAutoApproveCandidates();
  const saved     = getMinutesSaved();

  return {
    ok: true,
    pendingApprovals:        aqStats.pending || 0,
    totalApprovalRequests:   aqStats.created || 0,
    approvedCount:           aqStats.approved || 0,
    rejectedCount:           aqStats.rejected || 0,
    expiredCount:            aqStats.expired || 0,
    autoApprovedCount:       aqStats.autoApproved || 0,
    avgFounderResponseMs:    aqStats.avgResponseMs || 0,
    avgFounderResponseMin:   aqStats.avgResponseMinutes || 0,
    blockedMinutes:          blocked.blockedMinutes,
    blockedWorkflows:        blocked.blockedWorkflows,
    autoApproveCandidates:   candidates,
    minutesSaved:            saved,
    responseTimeByType:      getResponseTimeByType(),
    trend:                   getTrend(),
    generatedAt:             new Date().toISOString(),
  };
}

module.exports = {
  getBlockedMinutes,
  getResponseTimeByType,
  getAutoApproveCandidates,
  getTrend,
  getMinutesSaved,
  getApprovalBlockageReport,
};
