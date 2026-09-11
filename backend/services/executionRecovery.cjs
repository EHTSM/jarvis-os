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
const _aer  = () => _try(() => require("./autonomousExecutionRuntime.cjs"));

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

  // JARVIS INCIDENT REPAIR (2026-09-03, P1-3): ENOENT is a missing
  // file/path — a deterministic condition, not a race or a slow backend.
  // This function used to lump it in with timeout/ECONNRESET/spawn as
  // "transient", which contradicts how the rest of this codebase already
  // classifies it: engineeringCapabilities.cjs marks ENOENT explicitly
  // `nonRetriable: true`, and rootCauseAnalysisEngine.cjs lists it among
  // its canonical DETERMINISTIC error classes. Retrying an operation whose
  // target path genuinely does not exist changes nothing about the
  // filesystem — it is guaranteed to fail identically again, so
  // RETRY_IMMEDIATE for ENOENT was 1-2 guaranteed-failing retries wasted
  // per real occurrence before eventually escalating anyway. Routed to
  // ESCALATE instead — the same deterministic-failure path this codebase's
  // other two ENOENT classifiers already use — so a founder gets a real
  // decision point instead of the system silently burning retry budget.
  // Genuinely transient errors (timeout/ETIMEDOUT/ECONNRESET/spawn — a slow
  // backend, a dropped connection, a subprocess launch race) are unaffected.
  if (/ENOENT/i.test(error)) {
    return "ESCALATE";
  }

  // Transient errors → retry
  if (/timeout|ETIMEDOUT|ECONNRESET|spawn/i.test(error) && attemptCount < 2) {
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

// ── Real rollback execution ───────────────────────────────────────────────────
// Engineering Autonomous Completion mission — this used to only BUILD a
// descriptive `rolledBackSteps` array (`{step, rollback}`, where `rollback`
// is a plain string like "Undo: <step name>" from executionPlanner.cjs —
// never an executable descriptor) and report "rolled_back_*" regardless of
// whether anything was actually reverted.
//
// Real undo only exists for one substrate in this codebase: git (via
// engineeringCapabilities.cjs's `rollback` capability, which now supports
// a genuine `git revert`/`git checkout --` — see that file). Founder
// workflow steps outside the engineering/docs domain (business, marketing,
// CRM, etc.) have no git-backed state and no other real undo mechanism
// anywhere in the codebase (executionPlanner's `step.rollback` is
// documentation text, not a callable) — for those, this function reports
// `reverted:false, reason:"no_real_rollback_mechanism"` honestly rather
// than fabricating a success outcome.
async function _executeRealRollback(stepsToRollback, domain) {
  const results = [];
  let anyReverted = false;

  const isGitBacked = domain === "engineering" || domain === "docs";
  if (!isGitBacked) {
    for (const s of stepsToRollback) {
      results.push({ step: s.name, rollback: s.rollback, reverted: false, reason: "no_real_rollback_mechanism_for_domain", domain });
    }
    return { results, anyReverted: false, summary: `domain "${domain}" has no git-backed state — nothing could be actually reverted (recorded honestly, not fabricated)` };
  }

  const aer = _aer();
  if (!aer) {
    for (const s of stepsToRollback) results.push({ step: s.name, rollback: s.rollback, reverted: false, reason: "autonomousExecutionRuntime_unavailable" });
    return { results, anyReverted: false, summary: "execution runtime unavailable — rollback capability could not be invoked" };
  }

  for (const s of stepsToRollback) {
    // A step may carry a real target from its own execution output (e.g. a
    // targetFile it patched, or a commitHash it created) — check common
    // shapes before falling back to unstage-only.
    const targetFile   = s.output?.targetFile || s.targetFile || null;
    const commitHash   = s.output?.commitHash  || s.commitHash  || null;
    const input = commitHash ? `rollback:commit=${commitHash}` : targetFile ? `rollback:file=${targetFile}` : "";
    try {
      const r = await aer.executeStage({ stageId: `recovery_rollback_${Date.now()}_${Math.random().toString(36).slice(2,5)}`, capability: "rollback", input, maxAttempts: 1 });
      const reverted = r.status === "completed";
      if (reverted) anyReverted = true;
      results.push({ step: s.name, rollback: s.rollback, reverted, target: commitHash || targetFile || "(unstage_only)", error: reverted ? null : r.error });
    } catch (e) {
      results.push({ step: s.name, rollback: s.rollback, reverted: false, error: e.message });
    }
  }
  return { results, anyReverted, summary: `${results.filter(r => r.reverted).length}/${results.length} steps genuinely reverted via git` };
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
      const outcome = await _executeRealRollback(completedSteps, failure.domain);
      rec.notes   = `Partial rollback of ${completedSteps.length} completed steps — ${outcome.summary}`;
      rec.rolledBackSteps = outcome.results;
      rec.outcome = outcome.anyReverted ? "rolled_back_partial" : "rollback_unavailable";
      break;
    }

    case "FULL_ROLLBACK": {
      const allRollback = steps.filter(s => s.rollback).reverse();
      const outcome = await _executeRealRollback(allRollback, failure.domain);
      rec.notes   = `Full rollback of ${allRollback.length} steps — ${outcome.summary}`;
      rec.rolledBackSteps = outcome.results;
      rec.outcome = outcome.anyReverted ? "rolled_back_full" : "rollback_unavailable";
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
