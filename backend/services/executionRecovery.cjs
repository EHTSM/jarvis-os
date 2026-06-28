"use strict";
/**
 * executionRecovery.cjs — POST-Ω Sprint P3
 *
 * Handles retry and rollback for failed workflow executions.
 * Recovery strategies mirror Sprint 4's healing engine patterns —
 * no new architecture, same approach applied to founder workflows.
 *
 * Strategies:
 *   RETRY_IMMEDIATE  — re-run failed step immediately (transient errors)
 *   RETRY_WITH_DELAY — re-run after short wait (rate limit / resource contention)
 *   SKIP_AND_CONTINUE — skip non-critical step, continue plan
 *   PARTIAL_ROLLBACK  — undo completed steps in reverse order, stop at stable point
 *   FULL_ROLLBACK     — undo everything, restore pre-execution state
 *   ESCALATE          — too risky, pause and request founder approval
 *
 * Recovery is tracked in data/execution-recovery.json
 */

const fs   = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, "../../data/execution-recovery.json");

const _try  = fn => { try { return fn(); } catch { return null; } };
const _le   = () => _try(() => require("./continuousLearningEngine.cjs"));
const _hitl = () => _try(() => require("./humanInTheLoop.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _bus  = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

// ── Load / save ────────────────────────────────────────────────────────────────
function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { records: [], stats: { totalRecoveries: 0, successfulRecoveries: 0, escalations: 0 } }; }
}
function _save(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// ── Strategy selection ─────────────────────────────────────────────────────────
// Mirrors Sprint 4 selectStrategy() but for founder workflow context.
function selectStrategy(failure) {
  const { stepType, error = "", attemptCount = 0, domain, stepIndex, totalSteps } = failure;

  // Transient errors → retry
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOENT|spawn/i.test(error) && attemptCount < 2) {
    return "RETRY_IMMEDIATE";
  }

  // Rate limit / resource contention → delayed retry
  if (/429|rate.limit|busy|lock/i.test(error) && attemptCount < 2) {
    return "RETRY_WITH_DELAY";
  }

  // Validation steps can be skipped if the core execution completed
  if (stepType === "validation" && attemptCount < 1) {
    return "SKIP_AND_CONTINUE";
  }

  // Evidence / knowledge steps never block — skip
  if (stepType === "evidence" || stepType === "knowledge_update") {
    return "SKIP_AND_CONTINUE";
  }

  // Prerequisites failed → can't proceed
  if (stepType === "prereq_check") {
    return "ESCALATE";
  }

  // More than half the steps done → partial rollback
  if (stepIndex > totalSteps / 2) {
    return "PARTIAL_ROLLBACK";
  }

  // Too many attempts or early failure → full rollback
  if (attemptCount >= 2) {
    return "FULL_ROLLBACK";
  }

  return "ESCALATE";
}

// ── Execute recovery ──────────────────────────────────────────────────────────
async function recover({ executionId, workflowId, plan, steps, failedStep, error, attemptCount = 0 }) {
  const w        = _fwr()?.getWorkflow?.(workflowId);
  const failure  = {
    stepType:   failedStep?.type || "execution",
    error,
    attemptCount,
    domain:     w?.domain || "unknown",
    stepIndex:  failedStep?.order || 0,
    totalSteps: steps?.length || 1,
  };

  const strategy = selectStrategy(failure);
  const recId    = _id();
  const rec = {
    id:          recId,
    executionId,
    workflowId,
    failedStep:  failedStep?.name || "unknown",
    error:       (error || "").slice(0, 500),
    strategy,
    attemptCount,
    startedAt:   _ts(),
    outcome:     null,
    notes:       "",
  };

  switch (strategy) {
    case "RETRY_IMMEDIATE":
      rec.notes   = "Retrying failed step immediately";
      rec.outcome = "retry_queued";
      break;

    case "RETRY_WITH_DELAY":
      rec.notes   = "Retrying after 2s delay";
      // In async context caller handles the delay
      await new Promise(r => setTimeout(r, 2000));
      rec.outcome = "retry_queued";
      break;

    case "SKIP_AND_CONTINUE":
      rec.notes   = `Skipping non-critical step: ${failedStep?.name}`;
      rec.outcome = "skipped";
      break;

    case "PARTIAL_ROLLBACK": {
      const completedSteps = steps.filter(s => s.completed && s.rollback);
      rec.notes   = `Partial rollback of ${completedSteps.length} completed steps`;
      rec.rolledBackSteps = completedSteps.map(s => ({ step: s.name, rollback: s.rollback }));
      rec.outcome = "rolled_back_partial";
      break;
    }

    case "FULL_ROLLBACK": {
      const allRollback = steps.filter(s => s.rollback).reverse();
      rec.notes   = `Full rollback of ${allRollback.length} steps`;
      rec.rolledBackSteps = allRollback.map(s => ({ step: s.name, rollback: s.rollback }));
      rec.outcome = "rolled_back_full";
      break;
    }

    case "ESCALATE": {
      rec.notes   = `Escalating to founder: ${error}`;
      rec.outcome = "escalated";
      // Request founder approval via humanInTheLoop
      const hitl = _hitl();
      if (hitl) {
        const req = hitl.createRequest({
          action:  `Recovery needed: ${workflowId} — ${failedStep?.name || "unknown step"}`,
          context: { executionId, error: (error || "").slice(0, 200), strategy, attemptCount },
          risk:    "high",
          source:  "executionRecovery",
        });
        rec.approvalRequestId = req.id;
      }
      _bus()?.emit("execution:escalated", { executionId, workflowId, error, strategy });
      break;
    }
  }

  rec.completedAt = _ts();

  // Persist
  const d = _load();
  d.records.push(rec);
  if (d.records.length > 200) d.records = d.records.slice(-200);
  d.stats.totalRecoveries++;
  if (["retry_queued", "skipped", "rolled_back_partial"].includes(rec.outcome)) d.stats.successfulRecoveries++;
  if (rec.outcome === "escalated") d.stats.escalations++;
  _save(d);

  // Record lesson
  _try(() => _le()?.createLesson?.({
    type: "recovery", title: `Recovery: ${strategy} for ${workflowId} step "${failedStep?.name}"`,
    source: "executionRecovery", confidence: 0.8,
    tags: ["recovery", strategy, failure.domain],
    data: { executionId, workflowId, strategy, error: (error || "").slice(0, 200), outcome: rec.outcome },
  }));

  return { ok: true, record: rec, strategy, shouldRetry: rec.outcome === "retry_queued", shouldSkip: rec.outcome === "skipped" };
}

function getStats() {
  return _load().stats;
}

function listRecoveries({ executionId, workflowId, limit = 20 } = {}) {
  let recs = _load().records;
  if (executionId) recs = recs.filter(r => r.executionId === executionId);
  if (workflowId)  recs = recs.filter(r => r.workflowId === workflowId);
  return recs.slice(-limit).reverse();
}

module.exports = { selectStrategy, recover, getStats, listRecoveries };
