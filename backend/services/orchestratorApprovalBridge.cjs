"use strict";
/**
 * orchestratorApprovalBridge.cjs — Phase 3 (Workflow Autonomy), Missions
 * 153–156 (Human Approval / Escalation).
 *
 * REAL, LIVE, EVIDENCED GAP CLOSED (not new architecture):
 *
 * missionOrchestrator.cjs's Approval-node stages enqueue a real approval
 * request via approvalQueue.enqueue() (see missionOrchestrator.cjs's
 * _requestApprovalForStage()), storing { missionId, stageId, capability }
 * in the request's `context`. The stage then sits in `awaiting_approval`
 * until something calls missionOrchestrator.resolveBlockingStage().
 *
 * The real, production HTTP path a founder/operator actually uses to act
 * on an approval is POST /approval/approve/:reqId and /approval/reject/:reqId
 * (backend/routes/approvalRoutes.js) → approvalEngine.cjs's
 * approveAndResume()/rejectApproval() → approvalQueue.cjs's approve()/
 * reject(), which emit real "approval:approved"/"approval:rejected" events
 * on the existing runtimeEventBus. approvalEngine.cjs's own _resumeExecution()
 * only knows how to resume a founderWorkRegistry-registered workflow
 * (`_fwr().getWorkflow(workflowId)`) — an orchestrator stage's default
 * workflowId ("orchestrator_stage_<stageId>", set when no approvalPolicy.
 * workflowId is supplied) is never a real founderWorkRegistry entry, so
 * _resumeExecution() silently no-ops (`{ok:false, error:"workflow not
 * found"}`) while the outer approve() call still reports success. The net
 * effect, confirmed by direct trace (not assumed): a founder can tap
 * "Approve" on an orchestrator Approval-node stage in the real approval
 * queue/dashboard and the underlying mission stage never advances — it
 * stays stuck in `awaiting_approval` forever. The only way to unblock it
 * was tests/manual code calling resolveBlockingStage() directly, which no
 * production code path ever does.
 *
 * The same gap exists for expiry: approvalQueue.expireStale() marks a
 * stale request "expired" and emits "approval:expired", but nothing ever
 * fails the corresponding orchestrator stage — an expired approval leaves
 * the stage (and the whole mission, since nothing downstream can become
 * ready) hung in `awaiting_approval` indefinitely, which is arguably worse
 * than an uncontrolled retry: it is an uncontrolled, silent stall.
 *
 * Fix: a single event-bus subscription (the exact pattern already used by
 * orgAutomationCenter.cjs's startAiWiring() and automationService.cjs's
 * startEventLoop() — one subscribe() call, no polling, no new scheduler)
 * that, on approval:approved / approval:rejected / approval:expired,
 * looks the request back up via the already-real approvalQueue.getRequest()
 * to recover context.missionId/context.stageId (not present on the event
 * payload itself, only on the stored request), and — ONLY when both are
 * present, i.e. this approval genuinely originated from an orchestrator
 * Approval-node stage — calls the existing missionOrchestrator.
 * resolveBlockingStage() with the matching outcome. Any approval request
 * NOT carrying an orchestrator missionId/stageId (the overwhelming
 * majority — founderWorkRegistry-driven approvals, revenueOS/commercial/
 * payment approvals, etc.) is untouched; this module does nothing for them,
 * exactly as before this fix.
 *
 * Idempotent: resolveBlockingStage() itself already throws if the stage is
 * not in a blocking status (BLOCKING_STATUSES), so a duplicate/replayed
 * event (or a race between two listeners) is a caught no-op here, never a
 * double-resolve. No new store, no new dispatch/execution path, no
 * authorization change — this only forwards a decision the real
 * approvalQueue/approvalEngine subsystem already made.
 */

const logger = require("../utils/logger");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bus = () => _try(() => require("../../agents/runtime/runtimeEventBus.cjs"));
const _aq  = () => _try(() => require("./approvalQueue.cjs"));
const _orch = () => _try(() => require("./missionOrchestrator.cjs"));

const SUB_ID = "orchestratorApprovalBridge";

// Maps an approvalQueue event type to the resolveBlockingStage() outcome an
// orchestrator Approval-node stage should be resolved with.
const OUTCOME_FOR_EVENT = {
  "approval:approved": "approved",
  "approval:rejected": "rejected",
  "approval:expired":  "rejected",
};

let _wired = 0, _skipped = 0, _errors = 0;

function _handle(evt) {
  const outcome = OUTCOME_FOR_EVENT[evt?.type];
  if (!outcome) return;

  const reqId = evt.payload?.reqId;
  if (!reqId) return;

  const aq = _aq();
  if (!aq) return;

  let req;
  try { req = aq.getRequest(reqId); } catch { req = null; }
  if (!req) return;

  const missionId = req.context?.missionId;
  const stageId   = req.context?.stageId;
  // Not an orchestrator-originated approval (the common case) — nothing
  // for this bridge to do. This is the correct, safe default: only act on
  // requests this bridge can prove came from a real orchestrator stage.
  if (!missionId || !stageId) return;

  const orch = _orch();
  if (!orch) return;

  try {
    const reason = evt.type === "approval:expired"
      ? "approval request expired before a decision was made"
      : req.rejectedReason || undefined;
    orch.resolveBlockingStage(missionId, stageId, { outcome, reason });
    _wired++;
    logger.info(`[OrchestratorApprovalBridge] ${evt.type} -> resolved stage ${stageId} on mission ${missionId} (${outcome})`);
  } catch (err) {
    // Stage already resolved/not in a blocking status, mission no longer
    // live, etc. — not a fatal condition for this bridge; the stage's own
    // state is the source of truth and is left exactly as it was.
    _skipped++;
    logger.warn(`[OrchestratorApprovalBridge] could not resolve stage ${stageId} on mission ${missionId}: ${err.message}`);
  }
}

let _subscribed = false;
function start() {
  if (_subscribed) return { started: false, reason: "already_subscribed" };
  const bus = _bus();
  if (!bus) return { started: false, reason: "runtimeEventBus unavailable" };
  try {
    bus.subscribe(SUB_ID, (evt) => {
      try { _handle(evt); } catch (err) { _errors++; logger.warn(`[OrchestratorApprovalBridge] handler error: ${err.message}`); }
    });
  } catch (err) {
    return { started: false, reason: err.message };
  }
  _subscribed = true;
  return { started: true };
}

function stop() {
  if (!_subscribed) return { stopped: false, reason: "not_subscribed" };
  try { _bus()?.unsubscribe(SUB_ID); } catch { /* ok */ }
  _subscribed = false;
  return { stopped: true };
}

function isRunning() { return _subscribed; }

function getStats() { return { subscribed: _subscribed, resolved: _wired, skipped: _skipped, errors: _errors }; }

module.exports = { start, stop, isRunning, getStats };
