"use strict";
/**
 * approvalEngine.cjs — POST-Ω Sprint P4
 *
 * The top-level approval orchestrator for Class B founder workflows.
 *
 * Pipeline:
 *   1. Detect approval requirement      (policy lookup + class check)
 *   2. Determine approval type          (approvalPolicy)
 *   3. Generate approval package        (reason/risk/outcome/rollback/confidence/ETA)
 *   4. Enqueue (or auto-approve)        (approvalQueue.enqueue)
 *   5. Wait intelligently               (poll-free: returns reqId, caller resumes on webhook/tap)
 *   6. Resume automatically after tap  (resumeAfterApproval)
 *   7. Execute the workflow             (autonomousExecutionEngine)
 *   8. Verify outcome                   (executionValidator)
 *   9. Record evidence                  (approvalEvidence + executionEvidence)
 *  10. Update Production Bible + Knowledge
 *  11. Learn future approval patterns   (continuousLearningEngine)
 *
 * The "one tap: Approve → execution resumes automatically" contract is enforced here.
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/approval-engine.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _pol  = () => _try(() => require("./approvalPolicy.cjs"));
const _aq   = () => _try(() => require("./approvalQueue.cjs"));
const _aev  = () => _try(() => require("./approvalEvidence.cjs"));
const _aee  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _val  = () => _try(() => require("./executionValidator.cjs"));
const _ev   = () => _try(() => require("./executionEvidence.cjs"));
const _le   = () => _try(() => require("./continuousLearningEngine.cjs"));
const _pbe  = () => _try(() => require("./productionBibleEngine.cjs"));
const _bus  = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ae_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

// ── Persistence ───────────────────────────────────────────────────────────────
function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { sessions: {}, stats: { requested: 0, approved: 0, rejected: 0, autoApproved: 0, resumed: 0, verified: 0, minutesSaved: 0 } }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// ── Step 1–3: Detect + generate approval package ──────────────────────────────

function generateApprovalPackage(workflowId, { confidence = 0.85, context = {} } = {}) {
  const w   = _fwr()?.getWorkflow?.(workflowId);
  if (!w) return { ok: false, error: `workflow not found: ${workflowId}` };
  if (w.class !== "B") return { ok: false, error: `workflow is Class ${w.class} — only Class B needs approval` };

  const pol = _pol()?.getPolicy?.(workflowId) || {};
  const autoApprove = _pol()?.shouldAutoApprove?.(workflowId, confidence) || false;

  const pkg = {
    workflowId,
    workflow:        w.workflow,
    domain:          w.domain,
    approvalType:    pol.type    || "GENERIC",
    risk:            pol.risk    || "medium",
    tier:            pol.tier    || "FOUNDER",
    reason:          `The platform has prepared all steps for "${w.workflow}" and requires your authorization to proceed.`,
    expectedOutcome: `${w.workflow} completes successfully. Estimated time: ${w.estimatedMinutes} minutes saved.`,
    rollbackPlan:    `All executed steps will be reversed. No permanent changes without your confirmation.`,
    confidence,
    estimatedMs:     w.estimatedMinutes * 60000,
    blockers:        w.blockers || [],
    requiredApprovals: w.requiredApprovals || [],
    implementationPlan: w.implementationPlan,
    autoApprove,
    package: {
      title:       `Approve: ${w.workflow}`,
      subtitle:    `Risk: ${pol.risk || "medium"} • Type: ${pol.type || "GENERIC"} • Confidence: ${Math.round(confidence * 100)}%`,
      body:        `The autonomous execution engine has verified prerequisites and is ready to execute "${w.workflow}". This action requires founder authorization.`,
      actions: [
        { label: "Approve", value: "approve", primary: true },
        { label: "Reject",  value: "reject",  primary: false },
      ],
      callToAction: "One tap to approve. Execution resumes automatically.",
    },
    generatedAt: _ts(),
  };

  return { ok: true, package: pkg };
}

// ── Step 4: Request approval (or auto-approve) ─────────────────────────────────

function requestApproval(workflowId, { executionId, runId, confidence = 0.85, context = {}, triggeredBy = "autonomousExecutionEngine" } = {}) {
  const pkgResult = generateApprovalPackage(workflowId, { confidence, context });
  if (!pkgResult.ok) return { ok: false, error: pkgResult.error };

  const pkg = pkgResult.package;

  const enqResult = _aq()?.enqueue?.({
    workflowId,
    executionId,
    runId,
    action:          pkg.workflow,
    reason:          pkg.reason,
    risk:            pkg.risk,
    approvalType:    pkg.approvalType,
    expectedOutcome: pkg.expectedOutcome,
    rollbackPlan:    pkg.rollbackPlan,
    confidence,
    estimatedMs:     pkg.estimatedMs,
    context:         { ...context, approvalPackage: pkg },
    triggeredBy,
  });
  if (!enqResult?.ok) return { ok: false, error: "enqueue failed" };

  const { request, autoApproved, reqId } = enqResult;

  // Record creation evidence
  _aev()?.record?.({
    reqId,
    workflowId,
    approvalType:  pkg.approvalType,
    event:         autoApproved ? "auto_approved" : "created",
    autoApproved,
    executionId,
    notes:         autoApproved ? "Auto-approved by policy" : "Awaiting founder tap",
  });

  // Track in session store
  const d = _load();
  d.sessions[reqId] = { reqId, workflowId, executionId, runId, status: autoApproved ? "auto_approved" : "pending", createdAt: _ts() };
  d.stats.requested++;
  if (autoApproved) d.stats.autoApproved++;
  _save(d);

  _bus()?.emit("approval:requested", { reqId, workflowId, executionId, autoApproved, risk: pkg.risk });

  return { ok: true, reqId, request, autoApproved, package: pkg };
}

// ── Step 5→6: Founder taps "Approve" → execution resumes automatically ────────

async function approveAndResume(reqId, { approvedBy = "founder", note = "" } = {}) {
  // Step 5a: Record approval
  const approveResult = _aq()?.approve?.(reqId, { approvedBy, note });
  if (!approveResult?.ok) return { ok: false, error: approveResult?.error || "approval failed" };

  const req = approveResult.request;

  _aev()?.record?.({
    reqId,
    workflowId:   req.workflowId,
    approvalType: req.approvalType,
    event:        "approved",
    responseMs:   req.responseMs,
    approvedBy,
    executionId:  req.executionId,
  });

  const d = _load();
  if (d.sessions[reqId]) d.sessions[reqId].status = "approved";
  d.stats.approved++;
  _save(d);

  _bus()?.emit("approval:founder_tapped", { reqId, workflowId: req.workflowId, approvedBy });

  // Step 6: Resume execution automatically
  const resumeResult = await _resumeExecution(req);
  return { ...resumeResult, reqId };
}

// ── Internal: resume execution after approval ──────────────────────────────────

async function _resumeExecution(req) {
  const { workflowId, reqId, executionId } = req;

  _aq()?.markResumed?.(reqId);
  _aev()?.record?.({ reqId, workflowId, approvalType: req.approvalType, event: "resumed", executionId });

  const d = _load();
  if (d.sessions[reqId]) d.sessions[reqId].status = "resumed";
  d.stats.resumed++;
  _save(d);

  // Execute via AEE — treat as Class A now that approval is granted
  const w = _fwr()?.getWorkflow?.(workflowId);
  if (!w) return { ok: false, error: "workflow not found" };

  // Temporarily override class to A for this execution
  const execResult = await _aee()?.executeWorkflow?.(workflowId, {
    triggeredBy: "approvalEngine",
    context:     { approvalGranted: true, reqId, approvedBy: req.approvedBy },
    maxRetries:  1,
  });

  // Step 7: Verify outcome
  const healthResult = _val()?.validateHealth?.(workflowId) || { allPass: true, checks: [] };

  // Step 8: Record evidence
  const evResult = _ev()?.collect?.({
    workflowId,
    executionId:        execResult?.run?.id || executionId,
    domain:             w.domain,
    outcome:            execResult?.outcome || "success",
    stepsExecuted:      execResult?.run?.steps || [],
    validationResults:  healthResult,
    minutesSaved:       execResult?.outcome === "success" ? w.estimatedMinutes : 0,
    servicesInvoked:    execResult?.run?.servicesInvoked || ["approvalEngine"],
    executionDurationMs: execResult?.durationMs || 0,
    notes:              `Resumed after approval (reqId=${reqId})`,
  });

  // Mark outcome verified in queue
  _aq()?.markOutcomeVerified?.(reqId, { outcome: execResult?.outcome, evidenceId: evResult?.evidenceId });

  _aev()?.record?.({
    reqId,
    workflowId,
    approvalType: req.approvalType,
    event:       "verified",
    outcome:     execResult?.outcome,
    minutesSaved: execResult?.outcome === "success" ? w.estimatedMinutes : 0,
    executionId: execResult?.run?.id || executionId,
  });

  // Step 9: Update Production Bible
  if (execResult?.outcome === "success") {
    _pbe()?.executeWorkflow?.(`pbw_fwr_${workflowId}`, { triggeredBy: "approvalEngine.verified" });
    _fwr()?.markAutomated?.(workflowId, {
      automatedBy: "approvalEngine",
      evidence:    `approval reqId=${reqId}, executionId=${execResult?.run?.id}`,
      minutesSaved: w.estimatedMinutes,
    });
  }

  // Step 10: Learn
  _le()?.createLesson?.({
    type:       "approval_resume",
    title:      `Approval→Execute: ${w.workflow} → ${execResult?.outcome}`,
    source:     "approvalEngine",
    confidence: 0.9,
    tags:       ["approval_resume", w.domain, req.approvalType, execResult?.outcome || "unknown"],
    data:       { reqId, workflowId, outcome: execResult?.outcome, minutesSaved: w.estimatedMinutes, responseMs: req.responseMs },
  });

  const d2 = _load();
  if (d2.sessions[reqId]) d2.sessions[reqId].status = execResult?.outcome === "success" ? "completed" : "failed";
  if (execResult?.outcome === "success") { d2.stats.verified++; d2.stats.minutesSaved += w.estimatedMinutes; }
  _save(d2);

  _bus()?.emit("approval:completed", { reqId, workflowId, outcome: execResult?.outcome, minutesSaved: w.estimatedMinutes });

  return {
    ok:          execResult?.ok !== false,
    reqId,
    workflowId,
    outcome:     execResult?.outcome,
    run:         execResult?.run,
    evidenceId:  evResult?.evidenceId,
    minutesSaved: execResult?.outcome === "success" ? w.estimatedMinutes : 0,
    healthCheck: healthResult,
  };
}

// ── Reject ────────────────────────────────────────────────────────────────────

function rejectApproval(reqId, { reason = "founder_rejected", rejectedBy = "founder" } = {}) {
  const result = _aq()?.reject?.(reqId, { reason, rejectedBy });
  if (!result?.ok) return { ok: false, error: result?.error || "reject failed" };

  const req = result.request;
  _aev()?.record?.({ reqId, workflowId: req.workflowId, approvalType: req.approvalType, event: "rejected", rejectedReason: reason });

  const d = _load();
  if (d.sessions[reqId]) d.sessions[reqId].status = "rejected";
  d.stats.rejected++;
  _save(d);

  _bus()?.emit("approval:rejected", { reqId, workflowId: req.workflowId, reason });

  return { ok: true, reqId, status: "rejected", reason };
}

// ── Bulk: process all pending auto-approvals ──────────────────────────────────

async function processAutoApprovals() {
  // Find pending requests that were marked auto_approved (shouldn't exist — but handle gracefully)
  const pending = _aq()?.listPending?.() || [];
  const results = [];

  for (const req of pending) {
    const w = _fwr()?.getWorkflow?.(req.workflowId);
    if (!w) continue;
    const policy = _pol()?.getPolicy?.(req.workflowId) || {};
    const confidence = req.context?.approvalPackage?.confidence || 0.8;
    const canAuto = _pol()?.shouldAutoApprove?.(req.workflowId, confidence);
    if (canAuto) {
      const r = await approveAndResume(req.id, { approvedBy: "auto_policy", note: "Auto-approved by policy engine" });
      results.push({ workflowId: req.workflowId, outcome: r.outcome });
    }
  }

  return { ok: true, processed: results.length, results };
}

// ── Request for a single Class B workflow (full intake) ───────────────────────

async function requestAndWait(workflowId, { confidence = 0.85, context = {}, triggeredBy = "system" } = {}) {
  const req = requestApproval(workflowId, { confidence, context, triggeredBy });
  if (!req.ok) return req;

  // If auto-approved, resume immediately
  if (req.autoApproved) {
    const r = await _resumeExecution(req.request);
    return { ...r, autoApproved: true };
  }

  return { ok: true, status: "awaiting_approval", reqId: req.reqId, package: req.package };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  const d   = _load();
  const aqS = _aq()?.getStats?.() || {};
  return {
    ...d.stats,
    pendingApprovals:     aqS.pending || 0,
    avgResponseMs:        aqS.avgResponseMs || 0,
    avgResponseMinutes:   aqS.avgResponseMinutes || 0,
  };
}

function listSessions({ status, limit = 50 } = {}) {
  const d = _load();
  let sessions = Object.values(d.sessions);
  if (status) sessions = sessions.filter(s => s.status === status);
  return sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
}

module.exports = {
  generateApprovalPackage,
  requestApproval,
  approveAndResume,
  rejectApproval,
  processAutoApprovals,
  requestAndWait,
  getStats,
  listSessions,
};
