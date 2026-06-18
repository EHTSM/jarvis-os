"use strict";
/**
 * hybridWorkforceService.cjs — Phase M2: Hybrid Workforce
 *
 * Humans and AI Agents collaborate inside the same org mission hierarchy.
 * No new runtime, no new approval engine, no new assignment engine.
 *
 * Reused systems (unchanged):
 *   missionMemory.cjs         → addSubtask, recordApproval, updateSubtask
 *   missionOrchestrator.cjs   → createManual, stage assignment
 *   autonomousExecutionRuntime→ executeStage (AI execution)
 *   organizationService.cjs   → RBAC, hasPermission, getMemberRole
 *   operationsAlertingLayer   → fire() for approval requests + escalation
 *   runtimeEventBus           → emit("workforce:*") events
 *   continuousLearningEngine  → createLesson() on handoffs
 *
 * Worker model:
 *   WorkerType: "human" | "ai"
 *   WorkerRef:  { type, id, name, capability?, orgRole? }
 *     - human: { type:"human", id: accountId, name, orgRole }
 *     - ai:    { type:"ai",    id: agentId/capabilityName, name, capability }
 *
 * Collaboration patterns:
 *   Planner(AI) → Developer(AI) → Reviewer(Human) → Tester(AI) → Approver(Human) → Deploy(AI)
 *   Sales Rep(Human) → Sales AI → Manager Approval(Human) → CS AI
 *
 * Approval chain:
 *   requestApproval(missionId, stepId, requestedBy, approvers[])
 *   submitApproval(missionId, approvalId, accountId, { verdict, reason })
 *   getApprovalStatus(missionId, approvalId)
 *
 * Assignment model:
 *   assignStep(missionId, stepId, worker, assignedBy)
 *   unassignStep(missionId, stepId, assignedBy)
 *   handoff(missionId, stepId, fromWorker, toWorker, reason)
 *
 * Escalation:
 *   escalate(missionId, stepId, reason, toWorker, escalatedBy)
 *   getEscalations(missionId)
 *
 * Public API:
 *   WorkerType, WORKER_TYPES, APPROVAL_VERDICTS
 *
 *   createCollaborationPlan(missionId, steps[], opts)  → plan
 *   getCollaborationPlan(missionId)                    → plan
 *   assignStep(missionId, stepId, worker, assignedBy)  → step
 *   unassignStep(missionId, stepId, assignedBy)        → step
 *   handoff(missionId, stepId, fromWorker, toWorker, reason, assignedBy) → step
 *   executeAIStep(missionId, stepId, capability, input, opts) → result
 *   signalHumanStepComplete(missionId, stepId, accountId, output) → step
 *   requestApproval(missionId, stepId, requestedBy, approvers, opts) → approvalId
 *   submitApproval(missionId, approvalId, accountId, verdict, reason) → approval
 *   getApprovalStatus(missionId, approvalId) → approval
 *   escalate(missionId, stepId, reason, toWorker, escalatedBy) → escalation
 *   getEscalations(missionId) → escalations[]
 *   getMissionWorkforce(missionId) → { steps, approvals, escalations, workers }
 *   listWorkersForOrg(orgId) → { humans, agents }
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");

// ── Storage (collaboration plans + escalations live here; approvals in missions.json) ──
const DATA_DIR  = path.join(__dirname, "../../data");
const PLANS_FILE = path.join(DATA_DIR, "workforce-plans.json");

function _readPlans() {
    try { return JSON.parse(fs.readFileSync(PLANS_FILE, "utf8")); }
    catch { return { plans: {} }; }
}
function _writePlans(store) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PLANS_FILE, JSON.stringify(store, null, 2));
}

// ── ID helpers ────────────────────────────────────────────────────────────────
let _seq = 0;
function _id(p) { return `${p}_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Lazy loaders ──────────────────────────────────────────────────────────────
function _mm()    { try { return require("./missionMemory.cjs");              } catch { return null; } }
function _orch()  { try { return require("./missionOrchestrator.cjs");        } catch { return null; } }
function _rt()    { try { return require("./autonomousExecutionRuntime.cjs");  } catch { return null; } }
function _org()   { try { return require("./organizationService.cjs");        } catch { return null; } }
function _alert() { try { return require("./operationsAlertingLayer.cjs");    } catch { return null; } }
function _bus()   { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _le()    { try { return require("./continuousLearningEngine.cjs");   } catch { return null; } }

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_TYPES = { HUMAN: "human", AI: "ai" };

const STEP_STATUS = {
    PENDING:      "pending",
    ASSIGNED:     "assigned",
    IN_PROGRESS:  "in_progress",
    AWAITING_APPROVAL: "awaiting_approval",
    APPROVED:     "approved",
    REJECTED:     "rejected",
    COMPLETED:    "completed",
    ESCALATED:    "escalated",
    SKIPPED:      "skipped",
};

const APPROVAL_VERDICTS = { APPROVED: "approved", REJECTED: "rejected", ABSTAINED: "abstained" };

// ─────────────────────────────────────────────────────────────────────────────
// WORKER VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function _validateWorker(w) {
    if (!w || !w.type || !w.id) throw new Error("worker requires { type, id }");
    if (!Object.values(WORKER_TYPES).includes(w.type)) throw new Error(`Invalid worker type: ${w.type}. Use 'human' or 'ai'`);
    return {
        type:       w.type,
        id:         w.id,
        name:       w.name || w.id,
        capability: w.capability || null,
        orgRole:    w.orgRole || null,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLABORATION PLAN — the step-by-step hybrid workforce choreography
// Stored in workforce-plans.json keyed by missionId.
// Each step references a mission subtask (or creates one).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createCollaborationPlan(missionId, steps[], opts)
 * steps[]: { name, worker: WorkerRef, requiresApproval?, approvers?, dependsOn?, capability?, description? }
 * Creates subtasks in missionMemory for each step, returns plan.
 */
function createCollaborationPlan(missionId, steps = [], opts = {}) {
    if (!missionId) throw new Error("missionId required");
    if (!Array.isArray(steps) || steps.length === 0) throw new Error("at least one step required");

    const mm = _mm();
    if (!mm) throw new Error("missionMemory unavailable");

    const mission = mm.getMission(missionId);
    if (!mission) throw Object.assign(new Error("Mission not found"), { status: 404 });

    const store = _readPlans();
    if (store.plans[missionId]) {
        // Replace existing plan
        logger.warn(`[HybridWorkforce] Replacing existing plan for mission ${missionId}`);
    }

    const planSteps = [];
    for (const s of steps) {
        const worker = _validateWorker(s.worker);
        const stepId = _id("step");

        // Create a corresponding mission subtask so missionMemory is the source of truth
        const subtask = mm.addSubtask(missionId, {
            description:   s.description || s.name,
            assignedAgent: worker.type === "ai" ? worker.id : `human:${worker.id}`,
            status:        "pending",
        });

        planSteps.push({
            stepId,
            subtaskId:        subtask.subtasks?.slice(-1)[0]?.id || stepId,
            name:             s.name,
            description:      s.description || s.name,
            worker,
            requiresApproval: s.requiresApproval || false,
            approvers:        (s.approvers || []).map(_validateWorker),
            dependsOn:        s.dependsOn || [],
            capability:       worker.type === "ai" ? (s.capability || worker.capability) : null,
            status:           STEP_STATUS.PENDING,
            assignedAt:       null,
            startedAt:        null,
            completedAt:      null,
            output:           null,
            approvalId:       null,
            escalations:      [],
        });
    }

    const plan = {
        missionId,
        planId:     _id("plan"),
        steps:      planSteps,
        orgId:      mission.metadata?.orgId || opts.orgId || null,
        deptId:     mission.metadata?.deptId || opts.deptId || null,
        teamId:     mission.metadata?.teamId || opts.teamId || null,
        createdAt:  new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
        status:     "active",
    };

    store.plans[missionId] = plan;
    _writePlans(store);

    _bus()?.emit("workforce:plan:created", { missionId, planId: plan.planId, steps: planSteps.length });
    logger.info(`[HybridWorkforce] Plan ${plan.planId} created for mission ${missionId} — ${planSteps.length} steps`);
    return { ...plan };
}

function getCollaborationPlan(missionId) {
    const store = _readPlans();
    return store.plans[missionId] || null;
}

function _getStep(missionId, stepId) {
    const store = _readPlans();
    const plan  = store.plans[missionId];
    if (!plan) throw Object.assign(new Error("No collaboration plan for this mission"), { status: 404 });
    const step = plan.steps.find(s => s.stepId === stepId);
    if (!step) throw Object.assign(new Error(`Step ${stepId} not found in plan`), { status: 404 });
    return { store, plan, step };
}

function _saveAndEmit(store, plan, eventType, payload = {}) {
    plan.updatedAt = new Date().toISOString();
    store.plans[plan.missionId] = plan;
    _writePlans(store);
    _bus()?.emit(eventType, { missionId: plan.missionId, planId: plan.planId, ...payload });
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

function assignStep(missionId, stepId, worker, assignedBy) {
    const w = _validateWorker(worker);
    const { store, plan, step } = _getStep(missionId, stepId);
    step.worker     = w;
    step.status     = STEP_STATUS.ASSIGNED;
    step.assignedAt = new Date().toISOString();
    // Mirror to missionMemory subtask
    try {
        _mm()?.updateSubtask(missionId, step.subtaskId, { assignedAgent: w.type === "ai" ? w.id : `human:${w.id}` });
    } catch {}
    _saveAndEmit(store, plan, "workforce:step:assigned", { stepId, worker: w, assignedBy });
    logger.info(`[HybridWorkforce] Step ${stepId} assigned to ${w.type}:${w.id} (mission: ${missionId})`);
    return { ...step };
}

function unassignStep(missionId, stepId, assignedBy) {
    const { store, plan, step } = _getStep(missionId, stepId);
    const prev = step.worker;
    step.status     = STEP_STATUS.PENDING;
    step.assignedAt = null;
    step.worker     = null;
    try { _mm()?.updateSubtask(missionId, step.subtaskId, { assignedAgent: null }); } catch {}
    _saveAndEmit(store, plan, "workforce:step:unassigned", { stepId, previousWorker: prev, assignedBy });
    return { ...step };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDOFF — transfer step from one worker to another
// ─────────────────────────────────────────────────────────────────────────────

function handoff(missionId, stepId, fromWorker, toWorker, reason, assignedBy) {
    const from = _validateWorker(fromWorker);
    const to   = _validateWorker(toWorker);
    const { store, plan, step } = _getStep(missionId, stepId);

    const handoffRecord = {
        id:         _id("hoff"),
        from,
        to,
        reason:     reason || "handoff",
        at:         new Date().toISOString(),
        by:         assignedBy || from.id,
    };

    if (!step.handoffs) step.handoffs = [];
    step.handoffs.push(handoffRecord);
    step.worker     = to;
    step.status     = STEP_STATUS.ASSIGNED;
    step.assignedAt = handoffRecord.at;

    try { _mm()?.updateSubtask(missionId, step.subtaskId, { assignedAgent: to.type === "ai" ? to.id : `human:${to.id}` }); } catch {}

    try {
        _le()?.createLesson({
            type:   "workforce_handoff",
            title:  `[Handoff] ${from.name} → ${to.name} on mission ${missionId}`,
            detail: reason || "no reason given",
            source: "hybridWorkforceService",
        });
    } catch {}

    _saveAndEmit(store, plan, "workforce:step:handoff", { stepId, from, to, reason, handoffId: handoffRecord.id });
    logger.info(`[HybridWorkforce] Handoff ${handoffRecord.id}: ${from.id} → ${to.id} for step ${stepId}`);
    return { step: { ...step }, handoff: handoffRecord };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI STEP EXECUTION — runs a step assigned to an AI worker via existing runtime
// ─────────────────────────────────────────────────────────────────────────────

async function executeAIStep(missionId, stepId, capability, input, opts = {}) {
    const { store, plan, step } = _getStep(missionId, stepId);
    if (step.worker?.type !== "ai") throw new Error("Step is not assigned to an AI worker");

    step.status    = STEP_STATUS.IN_PROGRESS;
    step.startedAt = new Date().toISOString();
    _saveAndEmit(store, plan, "workforce:step:started", { stepId, worker: step.worker, workerType: "ai" });

    let result;
    try {
        const rt = _rt();
        if (!rt) throw new Error("autonomousExecutionRuntime unavailable");
        result = await rt.executeStage({
            capability:    capability || step.capability || "generic",
            input:         typeof input === "string" ? input : JSON.stringify(input),
            missionId,
            stageId:       stepId,
            assignedAgent: step.worker.id,
            policy:        opts.policy,
        });

        const { store: s2, plan: p2, step: s } = _getStep(missionId, stepId);
        s.status      = result.success ? STEP_STATUS.COMPLETED : STEP_STATUS.ESCALATED;
        s.completedAt = new Date().toISOString();
        s.output      = result.output || result;
        _saveAndEmit(s2, p2, result.success ? "workforce:step:completed" : "workforce:step:failed", { stepId, worker: step.worker, success: result.success });

        // Mirror output to missionMemory subtask
        try { _mm()?.updateSubtask(missionId, s.subtaskId, { status: s.status, output: s.output }); } catch {}

        return { stepId, worker: step.worker, success: result.success, output: result.output, result };
    } catch (e) {
        const { store: s3, plan: p3, step: s2 } = _getStep(missionId, stepId);
        s2.status     = STEP_STATUS.ESCALATED;
        s2.completedAt = new Date().toISOString();
        _saveAndEmit(s3, p3, "workforce:step:failed", { stepId, error: e.message });
        throw e;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// HUMAN STEP COMPLETION — signal that a human has finished their step
// ─────────────────────────────────────────────────────────────────────────────

function signalHumanStepComplete(missionId, stepId, accountId, output) {
    const { store, plan, step } = _getStep(missionId, stepId);
    if (step.worker?.type !== "human") throw new Error("Step is not assigned to a human worker");
    if (step.worker.id !== accountId) {
        // Allow org admins/leads to complete on behalf
        const orgId = plan.orgId;
        const role  = orgId ? _org()?.getMemberRole(orgId, accountId) : null;
        if (!role || !["org_owner","org_admin","dept_lead"].includes(role)) {
            throw Object.assign(new Error("You are not the assigned human for this step"), { status: 403 });
        }
    }

    step.status      = step.requiresApproval ? STEP_STATUS.AWAITING_APPROVAL : STEP_STATUS.COMPLETED;
    step.completedAt = new Date().toISOString();
    step.output      = output || null;
    step.startedAt   = step.startedAt || step.assignedAt;

    try { _mm()?.updateSubtask(missionId, step.subtaskId, { status: step.status, output: step.output }); } catch {}
    _saveAndEmit(store, plan, "workforce:step:human_complete", { stepId, accountId, requiresApproval: step.requiresApproval });

    logger.info(`[HybridWorkforce] Human step ${stepId} completed by ${accountId} (mission: ${missionId})`);
    return { ...step };
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL CHAIN
// Approval request stored in missionMemory.approvals[] via recordApproval().
// Approval status tracked in plan step.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * requestApproval(missionId, stepId, requestedBy, approvers[], opts)
 * approvers[]: WorkerRef[] — must include at least one human worker
 */
function requestApproval(missionId, stepId, requestedBy, approvers = [], opts = {}) {
    const { store, plan, step } = _getStep(missionId, stepId);
    if (!approvers.length) throw new Error("At least one approver is required");

    const humanApprovers = approvers.filter(a => a.type === "human");
    if (!humanApprovers.length) throw new Error("At least one human approver is required for approval chains");

    const approvalId = _id("apr");
    const mm         = _mm();

    // Record in missionMemory
    if (mm) {
        mm.recordApproval(missionId, {
            type:        opts.type || `step_approval:${stepId}`,
            status:      "pending",
            requestedBy: requestedBy || step.worker?.id || "system",
            approvedBy:  null,
        });
    }

    step.status     = STEP_STATUS.AWAITING_APPROVAL;
    step.approvalId = approvalId;
    if (!step.pendingApprovals) step.pendingApprovals = [];
    step.pendingApprovals.push({
        approvalId,
        approvers:    approvers.map(_validateWorker),
        requestedBy:  requestedBy || step.worker?.id,
        requestedAt:  new Date().toISOString(),
        verdicts:     [],
        status:       "pending",
        description:  opts.description || `Approval required for: ${step.name}`,
    });

    _saveAndEmit(store, plan, "workforce:approval:requested", { stepId, approvalId, requestedBy, approvers });

    // Notify each human approver
    for (const approver of humanApprovers) {
        _alert()?.fire({
            title:    `[Approval Required] ${step.name}`,
            message:  `${requestedBy || "A teammate"} requires your approval for mission step: ${step.name}`,
            severity: "info",
            source:   "hybridWorkforceService",
        });
    }

    logger.info(`[HybridWorkforce] Approval ${approvalId} requested for step ${stepId} (mission: ${missionId})`);
    return { approvalId, stepId, missionId, status: "pending", approvers: approvers.map(_validateWorker) };
}

/**
 * submitApproval(missionId, approvalId, accountId, verdict, reason)
 * verdict: "approved" | "rejected" | "abstained"
 */
function submitApproval(missionId, approvalId, accountId, verdict, reason) {
    if (!Object.values(APPROVAL_VERDICTS).includes(verdict)) {
        throw new Error(`Invalid verdict: ${verdict}. Must be: ${Object.values(APPROVAL_VERDICTS).join(", ")}`);
    }

    // Find the step that owns this approvalId
    const planR = getCollaborationPlan(missionId);
    if (!planR) throw Object.assign(new Error("No collaboration plan for this mission"), { status: 404 });

    const step = planR.steps.find(s => s.pendingApprovals?.some(a => a.approvalId === approvalId));
    if (!step) throw Object.assign(new Error("Approval not found in plan"), { status: 404 });

    const { store: st, plan: pl } = _getStep(missionId, step.stepId);
    const approval = pl.steps.find(s => s.stepId === step.stepId)
        ?.pendingApprovals?.find(a => a.approvalId === approvalId);
    if (!approval) throw Object.assign(new Error("Approval record not found"), { status: 404 });

    // Check that accountId is a valid approver
    const isApprover = approval.approvers.some(a => a.id === accountId);
    if (!isApprover) throw Object.assign(new Error("You are not a listed approver for this request"), { status: 403 });

    // Check not already voted
    if (approval.verdicts.some(v => v.by === accountId)) {
        throw Object.assign(new Error("You have already submitted an approval verdict"), { status: 409 });
    }

    approval.verdicts.push({ by: accountId, verdict, reason: reason || null, at: new Date().toISOString() });

    // Resolve: approved when all human approvers have approved; rejected if any reject
    const humanApprovers  = approval.approvers.filter(a => a.type === "human");
    const humanVerdicts   = approval.verdicts.filter(v => humanApprovers.some(a => a.id === v.by));
    const anyRejected     = humanVerdicts.some(v => v.verdict === APPROVAL_VERDICTS.REJECTED);
    const allApproved     = humanApprovers.every(a => humanVerdicts.some(v => v.by === a.id && v.verdict === APPROVAL_VERDICTS.APPROVED));

    const planStep = pl.steps.find(s => s.stepId === step.stepId);
    if (anyRejected) {
        approval.status = "rejected";
        planStep.status = STEP_STATUS.REJECTED;
        _mm()?.recordApproval(missionId, { type: `step_approval:${step.stepId}`, status: "rejected", requestedBy: approval.requestedBy, approvedBy: accountId });
        _alert()?.fire({ title: `[Approval Rejected] ${planStep.name}`, message: reason || "Rejected", severity: "warning", source: "hybridWorkforceService" });
    } else if (allApproved) {
        approval.status = "approved";
        planStep.status = STEP_STATUS.APPROVED;
        _mm()?.recordApproval(missionId, { type: `step_approval:${step.stepId}`, status: "approved", requestedBy: approval.requestedBy, approvedBy: accountId });
    }

    _saveAndEmit(st, pl, `workforce:approval:${approval.status === "pending" ? "vote" : approval.status}`, { approvalId, by: accountId, verdict, status: approval.status });
    logger.info(`[HybridWorkforce] Approval ${approvalId} — ${accountId} voted ${verdict} (status: ${approval.status})`);
    return { approvalId, verdict, status: approval.status, missionId, stepId: step.stepId };
}

function getApprovalStatus(missionId, approvalId) {
    const plan = getCollaborationPlan(missionId);
    if (!plan) return null;
    for (const step of plan.steps) {
        const approval = (step.pendingApprovals || []).find(a => a.approvalId === approvalId);
        if (approval) return { ...approval, stepId: step.stepId, stepName: step.name };
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCALATION
// ─────────────────────────────────────────────────────────────────────────────

function escalate(missionId, stepId, reason, toWorker, escalatedBy) {
    const to = _validateWorker(toWorker);
    const { store, plan, step } = _getStep(missionId, stepId);

    const escalation = {
        id:          _id("esc"),
        stepId,
        from:        step.worker,
        to,
        reason:      reason || "escalated",
        escalatedBy: escalatedBy || step.worker?.id,
        at:          new Date().toISOString(),
        resolved:    false,
    };

    if (!step.escalations) step.escalations = [];
    step.escalations.push(escalation);
    step.status = STEP_STATUS.ESCALATED;
    step.worker = to;

    // Notify via alerting layer
    _alert()?.fire({
        title:    `[Escalation] ${step.name} — ${reason || "needs attention"}`,
        message:  `Step "${step.name}" escalated to ${to.name} (${to.type})`,
        severity: "warning",
        source:   "hybridWorkforceService",
    });

    try { _mm()?.updateSubtask(missionId, step.subtaskId, { assignedAgent: to.type === "ai" ? to.id : `human:${to.id}` }); } catch {}

    _saveAndEmit(store, plan, "workforce:step:escalated", { stepId, escalationId: escalation.id, to, reason });
    logger.info(`[HybridWorkforce] Escalation ${escalation.id}: step ${stepId} → ${to.type}:${to.id} (mission: ${missionId})`);
    return { ...escalation };
}

function getEscalations(missionId) {
    const plan = getCollaborationPlan(missionId);
    if (!plan) return { escalations: [], total: 0 };
    const all = plan.steps.flatMap(s => (s.escalations || []).map(e => ({ ...e, stepName: s.name })));
    return { escalations: all, total: all.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFORCE OVERVIEW
// ─────────────────────────────────────────────────────────────────────────────

function getMissionWorkforce(missionId) {
    const plan    = getCollaborationPlan(missionId);
    if (!plan) return { missionId, plan: null, steps: [], approvals: [], escalations: [], workers: [] };

    const mm      = _mm();
    const mission = mm?.getMission(missionId);

    // Unique workers across all steps
    const workerMap = new Map();
    for (const step of plan.steps) {
        if (step.worker) workerMap.set(`${step.worker.type}:${step.worker.id}`, step.worker);
        for (const a of step.approvers || []) workerMap.set(`${a.type}:${a.id}`, a);
    }

    const escalations = getEscalations(missionId);
    const approvals   = (mission?.approvals || []);
    const summary = {
        total:        plan.steps.length,
        pending:      plan.steps.filter(s => s.status === STEP_STATUS.PENDING).length,
        inProgress:   plan.steps.filter(s => s.status === STEP_STATUS.IN_PROGRESS).length,
        awaitingApproval: plan.steps.filter(s => s.status === STEP_STATUS.AWAITING_APPROVAL).length,
        completed:    plan.steps.filter(s => s.status === STEP_STATUS.COMPLETED).length,
        escalated:    plan.steps.filter(s => s.status === STEP_STATUS.ESCALATED).length,
    };

    return {
        missionId,
        planId:      plan.planId,
        orgId:       plan.orgId,
        teamId:      plan.teamId,
        steps:       plan.steps,
        summary,
        approvals,
        escalations: escalations.escalations,
        workers:     Array.from(workerMap.values()),
    };
}

/**
 * listWorkersForOrg(orgId) — returns members (humans) + registered AI agents for an org.
 * Humans from organizationService, AI from autonomousExecutionRuntime capability list.
 */
function listWorkersForOrg(orgId) {
    const humans = [];
    const agents = [];

    try {
        const org = _org();
        if (org && orgId) {
            const { members } = org.listMembers(orgId);
            for (const m of members) {
                humans.push({ type: "human", id: m.accountId, orgRole: m.orgRole, deptId: m.deptId, teamId: m.teamId });
            }
        }
    } catch {}

    try {
        const rt = _rt();
        if (rt) {
            for (const cap of rt.listCapabilities()) {
                agents.push({ type: "ai", id: cap.name, name: cap.description || cap.name, capability: cap.name });
            }
        }
    } catch {}

    return { humans, agents, total: humans.length + agents.length };
}

module.exports = {
    // Plan
    createCollaborationPlan,
    getCollaborationPlan,
    // Assignment
    assignStep,
    unassignStep,
    handoff,
    // Execution
    executeAIStep,
    signalHumanStepComplete,
    // Approvals
    requestApproval,
    submitApproval,
    getApprovalStatus,
    // Escalation
    escalate,
    getEscalations,
    // Overview
    getMissionWorkforce,
    listWorkersForOrg,
    // Constants
    WORKER_TYPES,
    STEP_STATUS,
    APPROVAL_VERDICTS,
};
