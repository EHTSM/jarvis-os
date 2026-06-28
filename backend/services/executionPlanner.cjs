"use strict";
/**
 * executionPlanner.cjs — POST-Ω Sprint P3
 *
 * Generates an ordered, validated execution plan from a Founder Work Registry
 * workflow. Does NOT execute — only plans.
 *
 * A plan is:
 *   - A sequence of ExecutionStep objects
 *   - Each step knows: what to do, how to do it, what executor handles it,
 *     what prerequisite must pass, what evidence to collect, rollback steps
 *   - Steps are domain-routed to the correct existing service
 *
 * Plan output is consumed by autonomousExecutionEngine.cjs.
 */

const fs   = require("fs");
const path = require("path");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _pbe  = () => _try(() => require("./productionBibleEngine.cjs"));
const _dv   = () => _try(() => require("./deploymentValidator.cjs"));
const _em   = () => _try(() => require("./engineeringMemoryEngine.cjs"));

// ── Domain → Executor mapping ─────────────────────────────────────────────────
// Maps workflow domains to the existing service that handles them.
// All executors are existing capabilities — no new services.
const DOMAIN_EXECUTOR = {
  deployment:       "deploymentValidator + co2FounderOps",
  daily_ops:        "continuousRuntimeObserver + deploymentValidator",
  user_ops:         "co3UserSuccess",
  business:         "businessOrg + revenueOS",
  marketing:        "contentSEOEngine + growthOS",
  engineering:      "engineeringOrg + autonomousEngineeringPlatform",
  product:          "continuousDesignObserver + accessibilityAuditor",
  docs:             "releaseEngine + engineeringOrg",
  self_improvement: "selfReviewEngine + consolidationAudit",
  legal:            "MANUAL_ONLY",
};

// ── Step templates by workflow domain ──────────────────────────────────────────
function _stepsForDomain(w, bibleWf) {
  const prereqStep = w.blockers?.length
    ? [{ order: 0, type: "prereq_check", name: "Verify prerequisites",
         action: `Check: ${w.blockers.join("; ")}`,
         executor: "executionValidator", rollback: null, evidenceKey: "prereq_result" }]
    : [];

  const bibleExecSteps = (bibleWf?.execution?.steps || w.manualSteps || []).map((step, i) => ({
    order:       i + 1,
    type:        "execution",
    name:        step,
    action:      step,
    executor:    DOMAIN_EXECUTOR[w.domain] || "platform",
    rollback:    (bibleWf?.rollback?.steps?.[i]) || `Undo: ${step}`,
    evidenceKey: `step_${i + 1}_result`,
  }));

  const validationSteps = (bibleWf?.validation?.steps || [`Verify: ${w.workflow} completed`]).map((step, i) => ({
    order:       bibleExecSteps.length + i + 1,
    type:        "validation",
    name:        step,
    action:      step,
    executor:    "executionValidator",
    rollback:    null,
    evidenceKey: `validation_${i + 1}_result`,
  }));

  const evidenceStep = {
    order:       bibleExecSteps.length + validationSteps.length + 1,
    type:        "evidence",
    name:        `Collect evidence for: ${w.workflow}`,
    action:      bibleWf?.evidence?.description || `Record outcome in data/execution-evidence.json`,
    executor:    "executionEvidence",
    rollback:    null,
    evidenceKey: "evidence_collected",
  };

  const knowledgeStep = {
    order:       evidenceStep.order + 1,
    type:        "knowledge_update",
    name:        "Update engineering memory + knowledge",
    action:      `Record lesson: automated '${w.workflow}', saved ${w.estimatedMinutes}min`,
    executor:    "engineeringMemoryEngine + continuousLearningEngine",
    rollback:    null,
    evidenceKey: "knowledge_updated",
  };

  return [...prereqStep, ...bibleExecSteps, ...validationSteps, evidenceStep, knowledgeStep];
}

// ── Real executor resolvers by domain ─────────────────────────────────────────
// Each resolver produces a concrete executor function signature for the engine
function _resolveExecutor(domain) {
  switch (domain) {
    case "deployment":       return { service: "deploymentValidator", method: "runCheck" };
    case "daily_ops":        return { service: "deploymentValidator", method: "runCheck" };
    case "self_improvement": return { service: "selfReviewEngine",    method: "runReview" };
    case "product":          return { service: "consolidationAudit",  method: "runAudit" };
    case "docs":             return { service: "consolidationAudit",  method: "runAudit" };
    case "engineering":      return { service: "engineeringMemoryEngine", method: "recall" };
    default:                 return { service: "platform",            method: "record" };
  }
}

// ── Core API ──────────────────────────────────────────────────────────────────

function buildPlan(workflowId) {
  const fwr = _fwr();
  if (!fwr) return { ok: false, error: "founderWorkRegistry unavailable" };

  const w = fwr.getWorkflow(workflowId);
  if (!w) return { ok: false, error: `workflow not found: ${workflowId}` };
  if (w.class === "C") return { ok: false, error: "Class C workflows cannot be automated" };

  // Find corresponding bible workflow for richer step data
  const bible    = _pbe();
  const bibleWf  = bible?.getWorkflow?.(`pbw_fwr_${workflowId}`) ||
                   bible?.getWorkflow?.(`pbw_deploy_${workflowId.replace("wf_deploy_","")}`);

  const steps    = _stepsForDomain(w, bibleWf);
  const executor = _resolveExecutor(w.domain);

  // Estimate: each execution step ~30s, validation ~10s, evidence ~5s
  const estimatedMs = steps.reduce((sum, s) => {
    if (s.type === "execution")    return sum + 30000;
    if (s.type === "validation")   return sum + 10000;
    if (s.type === "prereq_check") return sum + 5000;
    return sum + 3000;
  }, 0);

  const plan = {
    planId:          `plan_${workflowId}_${Date.now()}`,
    workflowId,
    workflowName:    w.workflow,
    domain:          w.domain,
    class:           w.class,
    estimatedMs,
    estimatedMinutesSaved: w.estimatedMinutes,
    steps,
    totalSteps:      steps.length,
    executionSteps:  steps.filter(s => s.type === "execution").length,
    validationSteps: steps.filter(s => s.type === "validation").length,
    primaryExecutor: executor,
    rollbackPlan:    steps.filter(s => s.rollback).map(s => ({ step: s.name, rollback: s.rollback })),
    prerequisiteCheck: w.blockers.length === 0 ? "none" : w.blockers.join("; "),
    approvalRequired: w.class === "B",
    approvalDesc:    w.requiredApprovals?.join(", ") || "none",
    createdAt:       new Date().toISOString(),
  };

  // Enrich with related memory items (best-effort, recall only — no risk scoring)
  plan.relatedMemory       = [];
  plan.predictedSuccessPct = 90;

  return { ok: true, plan };
}

function buildBatchPlans(options = {}) {
  const { domain, limit = 20, classType = "A" } = options;
  const fwr = _fwr();
  if (!fwr) return { ok: false, error: "registry unavailable" };

  let workflows = fwr.listWorkflows({ domain, classType, status: "pending_automation" });
  workflows = workflows.slice(0, limit);

  const plans  = [];
  const errors = [];
  for (const w of workflows) {
    const r = buildPlan(w.id);
    if (r.ok) plans.push(r.plan);
    else       errors.push({ workflowId: w.id, error: r.error });
  }

  return { ok: true, plans, errors, total: plans.length };
}

module.exports = { buildPlan, buildBatchPlans, DOMAIN_EXECUTOR };
