"use strict";
/**
 * approvalQueue.cjs — POST-Ω Sprint P4
 *
 * Persistent approval queue that wraps and extends humanInTheLoop.cjs.
 * Does NOT duplicate HITL storage — it adds:
 *   - richer approval packages (reason/risk/outcome/rollback/confidence/ETA)
 *   - TTL expiry enforcement
 *   - auto-approve for low-risk items that meet confidence threshold
 *   - approval type classification
 *   - execution resumption tracking
 *   - analytics fields (response time, retry count)
 *
 * Storage: data/approval-queue.json (separate from hitl-queue.json)
 * HITL requests are still created for UI compatibility — this layer adds metadata.
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/approval-queue.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _hitl = () => _try(() => require("./humanInTheLoop.cjs"));
const _pol  = () => _try(() => require("./approvalPolicy.cjs"));
const _bus  = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));

function _ts()  { return new Date().toISOString(); }
function _id()  { return `aq_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Persistence ───────────────────────────────────────────────────────────────
function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { requests: {}, stats: { created: 0, approved: 0, rejected: 0, expired: 0, autoApproved: 0, totalResponseMs: 0 } }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

function enqueue({
  workflowId,
  executionId,
  runId,
  action,
  reason,
  risk,
  approvalType,
  expectedOutcome,
  rollbackPlan,
  confidence     = 0.8,
  estimatedMs    = 30000,
  context        = {},
  triggeredBy    = "autonomousExecutionEngine",
}) {
  const pol    = _pol()?.getPolicy?.(workflowId) || {};
  const resolvedRisk  = risk         || pol.risk         || "medium";
  const resolvedType  = approvalType || pol.type         || "GENERIC";
  const ttlMs         = pol.ttlMs    || 3600000;

  // Auto-approve check
  const autoApprove = _pol()?.shouldAutoApprove?.(workflowId, confidence);

  const reqId = _id();
  const req = {
    id:             reqId,
    workflowId,
    executionId,
    runId,
    action,
    reason:         reason         || `Automated execution of: ${action}`,
    risk:           resolvedRisk,
    approvalType:   resolvedType,
    expectedOutcome: expectedOutcome || "Workflow completes successfully",
    rollbackPlan:   rollbackPlan   || "Revert all executed steps",
    confidence,
    estimatedMs,
    context,
    triggeredBy,
    status:         autoApprove ? "auto_approved" : "pending",
    autoApproved:   !!autoApprove,
    approvedBy:     autoApprove ? "auto_policy" : null,
    approvedAt:     autoApprove ? _ts() : null,
    rejectedReason: null,
    createdAt:      _ts(),
    expiresAt:      new Date(Date.now() + ttlMs).toISOString(),
    responseMs:     autoApprove ? 0 : null,
    resumedAt:      null,
    outcomeVerified: false,
  };

  // Also create HITL request for UI compatibility (only for non-auto)
  if (!autoApprove) {
    const hitl = _hitl();
    if (hitl) {
      const hitlReq = hitl.createRequest({
        workflowId,
        intent:      action,
        dangerLevel: resolvedRisk === "high" || resolvedRisk === "critical" ? "dangerous" : "review",
        dangerReason: reason,
        context:     { ...context, approvalQueueId: reqId, approvalType: resolvedType, confidence, expectedOutcome, rollbackPlan },
        source:      "approvalEngine",
      });
      req.hitlRequestId = hitlReq.id;
    }
  }

  const d = _load();
  d.requests[reqId] = req;
  d.stats.created++;
  if (autoApprove) d.stats.autoApproved++;
  _save(d);

  // Emit event
  _bus()?.emit("approval:created", { reqId, workflowId, executionId, autoApprove, risk: resolvedRisk });

  return { ok: true, request: req, autoApproved: !!autoApprove, reqId };
}

// ── Approve ───────────────────────────────────────────────────────────────────

function approve(reqId, { approvedBy = "founder", note = "" } = {}) {
  const d = _load();
  const req = d.requests[reqId];
  if (!req) return { ok: false, error: "not found" };
  if (req.status !== "pending") return { ok: false, error: `status is ${req.status}` };

  req.status     = "approved";
  req.approvedBy = approvedBy;
  req.approvedAt = _ts();
  req.responseMs = Date.now() - new Date(req.createdAt).getTime();
  req.note       = note;

  d.stats.approved++;
  d.stats.totalResponseMs += req.responseMs;
  _save(d);

  // Mirror approval in HITL store
  if (req.hitlRequestId) {
    _try(() => _hitl()?.approve(req.hitlRequestId, { approvedBy }));
  }

  _bus()?.emit("approval:approved", { reqId, workflowId: req.workflowId, executionId: req.executionId, approvedBy, responseMs: req.responseMs });

  return { ok: true, request: req };
}

// ── Reject ────────────────────────────────────────────────────────────────────

function reject(reqId, { reason = "manual_rejection", rejectedBy = "founder" } = {}) {
  const d = _load();
  const req = d.requests[reqId];
  if (!req) return { ok: false, error: "not found" };
  if (req.status !== "pending") return { ok: false, error: `status is ${req.status}` };

  req.status         = "rejected";
  req.rejectedReason = reason;
  req.rejectedBy     = rejectedBy;
  req.approvedAt     = _ts();
  req.responseMs     = Date.now() - new Date(req.createdAt).getTime();

  d.stats.rejected++;
  d.stats.totalResponseMs += req.responseMs;
  _save(d);

  if (req.hitlRequestId) {
    _try(() => _hitl()?.reject(req.hitlRequestId, { reason }));
  }

  _bus()?.emit("approval:rejected", { reqId, workflowId: req.workflowId, reason });

  return { ok: true, request: req };
}

// ── Expire stale requests ─────────────────────────────────────────────────────

function expireStale() {
  const d    = _load();
  let expired = 0;
  const now  = Date.now();
  for (const req of Object.values(d.requests)) {
    if (req.status === "pending" && new Date(req.expiresAt).getTime() < now) {
      req.status = "expired";
      d.stats.expired++;
      expired++;
      _bus()?.emit("approval:expired", { reqId: req.id, workflowId: req.workflowId });
    }
  }
  if (expired > 0) _save(d);
  return { expired };
}

// ── Mark resumed ──────────────────────────────────────────────────────────────

function markResumed(reqId) {
  const d = _load();
  const req = d.requests[reqId];
  if (!req) return { ok: false, error: "not found" };
  req.resumedAt = _ts();
  _save(d);
  return { ok: true };
}

function markOutcomeVerified(reqId, { outcome, evidenceId } = {}) {
  const d = _load();
  const req = d.requests[reqId];
  if (!req) return { ok: false, error: "not found" };
  req.outcomeVerified = true;
  req.verifiedAt      = _ts();
  req.verifiedOutcome = outcome;
  req.evidenceId      = evidenceId;
  _save(d);
  return { ok: true };
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getRequest(reqId) {
  expireStale();
  return _load().requests[reqId] || null;
}

function listPending() {
  expireStale();
  const d = _load();
  return Object.values(d.requests)
    .filter(r => r.status === "pending")
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function listByStatus(status, limit = 50) {
  expireStale();
  const d = _load();
  return Object.values(d.requests)
    .filter(r => r.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

function listAll({ status, workflowId, approvalType, limit = 100 } = {}) {
  expireStale();
  let list = Object.values(_load().requests);
  if (status)       list = list.filter(r => r.status === status);
  if (workflowId)   list = list.filter(r => r.workflowId === workflowId);
  if (approvalType) list = list.filter(r => r.approvalType === approvalType);
  return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

function getStats() {
  expireStale();
  const d     = _load();
  const stats = d.stats;
  const avgResponseMs = stats.approved > 0
    ? Math.round(stats.totalResponseMs / stats.approved)
    : 0;
  return {
    ...stats,
    avgResponseMs,
    avgResponseMinutes: Math.round(avgResponseMs / 60000 * 10) / 10,
    pending: listPending().length,
  };
}

module.exports = {
  enqueue, approve, reject, expireStale,
  markResumed, markOutcomeVerified,
  getRequest, listPending, listByStatus, listAll, getStats,
};
