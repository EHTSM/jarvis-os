"use strict";
/**
 * missionCollaborationEngine.cjs — Phase I6: Multi-Agent Collaboration Engine
 *
 * Allows specialized agents to collaborate on ONE mission through a
 * structured handoff chain with parallel execution support.
 *
 * Collaboration model:
 *   Mission
 *     └── CollaborationPlan
 *           ├── assignedAgents[]      — agents participating
 *           ├── executionOrder[]      — sequential handoff chain
 *           ├── parallelGroups[]      — stages that run simultaneously
 *           ├── approvalStages[]      — gates that require explicit approval
 *           └── completionCriteria[] — checks for "done"
 *
 * Handoff lifecycle:
 *   pending → accepted → running → completed | failed | rejected | retried
 *
 * Ownership model per mission:
 *   currentOwner, previousOwners[], handoffHistory[], executionTimeline[]
 *
 * STRICT ARCHITECTURE RULES:
 *   No new runtime     — reuses agentRuntimeSupervisor.triggerTick + missionOrchestrator
 *   No new scheduler   — setImmediate / setTimeout only for async transitions
 *   No new supervisor  — delegates to agentRuntimeSupervisor
 *   No new mission     — missionMemory is the authority for mission objects
 *   No new graph       — knowledgeGraph / graphReasoningEngine not duplicated
 *   No new queue       — autonomousExecutionRuntime not duplicated
 *   No new bus         — runtimeEventBus only
 *
 * Reused systems:
 *   missionMemory, missionOrchestrator, agentRuntimeSupervisor,
 *   autonomousExecutionRuntime, runtimeEventBus, continuousLearningEngine
 *
 * Public API:
 *   createPlan(missionId, planSpec)       → CollaborationPlan
 *   getPlan(missionId)                    → CollaborationPlan | null
 *   listPlans(opts)                       → { plans[], total }
 *   handoff(missionId, fromAgent, toAgent, payload) → HandoffRecord
 *   claim(missionId, agentId)             → HandoffRecord
 *   release(missionId, agentId, outcome)  → HandoffRecord
 *   retry(missionId, handoffId)           → HandoffRecord
 *   reject(missionId, agentId, reason)    → HandoffRecord
 *   accept(missionId, agentId, handoffId) → HandoffRecord
 *   getMissionOwnership(missionId)        → OwnershipRecord
 *   getActiveCollaborations()             → CollaborationPlan[]
 *   getBlockedChains()                    → BlockedChain[]
 *   getStalledHandoffs(thresholdMs)       → HandoffRecord[]
 *   getStats()                            → stats object
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

// ── Lazy loaders ───────────────────────────────────────────────────────────────
function _mm()   { try { return require("./missionMemory.cjs");                              } catch { return null; } }
function _orch() { try { return require("./missionOrchestrator.cjs");                        } catch { return null; } }
function _sup()  { try { return require("./agentRuntimeSupervisor.cjs");                     } catch { return null; } }
function _aer()  { try { return require("./autonomousExecutionRuntime.cjs");                 } catch { return null; } }
function _bus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs");        } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");                   } catch { return null; } }

// ── Persistence ────────────────────────────────────────────────────────────────
const DATA_DIR    = path.join(__dirname, "../../data");
const COLLAB_FILE = path.join(DATA_DIR, "collaboration-plans.json");

let _store   = null;   // { plans: {}, handoffs: {}, ownership: {} }
let _dirty   = false;
let _writing = false;

function _load() {
    if (_store) return _store;
    try {
        _store = JSON.parse(fs.readFileSync(COLLAB_FILE, "utf8"));
        if (!_store.plans)     _store.plans = {};
        if (!_store.handoffs)  _store.handoffs = {};
        if (!_store.ownership) _store.ownership = {};
    } catch {
        _store = { plans: {}, handoffs: {}, ownership: {} };
    }
    return _store;
}

function _save() {
    _dirty = true;
    if (_writing) return;
    _writing = true;
    setImmediate(() => {
        const data = JSON.stringify({ ..._store, savedAt: new Date().toISOString() }, null, 2);
        const tmp  = COLLAB_FILE + ".tmp";
        fs.writeFile(tmp, data, "utf8", err => {
            _writing = false;
            if (!err) fs.rename(tmp, COLLAB_FILE, () => { _dirty = false; });
            else      logger.warn(`[CollabEngine] save error: ${err.message}`);
        });
    });
}

// ── ID helpers ─────────────────────────────────────────────────────────────────
let _seq = 0;
function _cid()  { return `collab_${Date.now()}_${(++_seq).toString(36)}`; }
function _hid()  { return `hoff_${Date.now()}_${(++_seq).toString(36)}`; }
function _gid()  { return `grp_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Event helper ───────────────────────────────────────────────────────────────
function _emit(type, payload) {
    try { _bus()?.emit(type, { ...payload, _source: "collaboration_engine" }); } catch {}
}

// ── Statistics ─────────────────────────────────────────────────────────────────
const _stats = {
    plansCreated: 0,
    handoffsTotal: 0,
    handoffsCompleted: 0,
    handoffsFailed: 0,
    handoffsRetried: 0,
    parallelGroupsExecuted: 0,
    blockedChains: 0,
    recoveryMissionsCreated: 0,
};

// ─────────────────────────────────────────────────────────────────────────────
// COLLABORATION PLAN (I6-1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * createPlan(missionId, spec)
 *
 * spec: {
 *   assignedAgents[]      — ["agent_planner", "agent_developer", "agent_tester", ...]
 *   executionOrder[]      — [{ agentId, stage, description }] — ordered handoff chain
 *   parallelGroups[]      — [{ id?, agents[], description }] — run simultaneously
 *   approvalStages[]      — [{ afterAgent, approvalNote }]
 *   completionCriteria[]  — [{ type, description }]
 * }
 */
function createPlan(missionId, spec = {}) {
    if (!missionId) throw new Error("createPlan: missionId required");
    const store = _load();

    // Validate mission exists
    const mission = _mm()?.getMission(missionId);
    if (!mission) throw new Error(`createPlan: mission ${missionId} not found`);

    const now = new Date().toISOString();

    const plan = {
        planId:             _cid(),
        missionId,
        assignedAgents:     spec.assignedAgents || [],
        executionOrder:     (spec.executionOrder || []).map((e, i) => ({
            index:          i,
            agentId:        e.agentId,
            stage:          e.stage || `stage_${i + 1}`,
            description:    e.description || "",
            status:         "pending",
            startedAt:      null,
            completedAt:    null,
            handoffId:      null,
        })),
        parallelGroups:     (spec.parallelGroups || []).map(g => ({
            groupId:     g.id || _gid(),
            agents:      g.agents || [],
            description: g.description || "",
            status:      "pending",
            startedAt:   null,
            completedAt: null,
            results:     {},
        })),
        approvalStages:     spec.approvalStages || [],
        completionCriteria: spec.completionCriteria || [
            { type: "all_stages_done", description: "All execution order stages completed" },
        ],
        status:             "active",
        currentStageIndex:  0,
        createdAt:          now,
        updatedAt:          now,
        completedAt:        null,
        error:              null,
    };

    store.plans[missionId] = plan;

    // Initialise ownership record (I6-4)
    if (!store.ownership[missionId]) {
        store.ownership[missionId] = {
            missionId,
            currentOwner:    plan.executionOrder[0]?.agentId || null,
            previousOwners:  [],
            handoffHistory:  [],
            executionTimeline: [{ ts: now, event: "plan_created", agentId: null, note: `Plan with ${plan.executionOrder.length} stages and ${plan.parallelGroups.length} parallel groups` }],
        };
    }

    _save();
    _stats.plansCreated++;
    _emit("collaboration:plan_created", { missionId, planId: plan.planId, agentCount: plan.assignedAgents.length, stageCount: plan.executionOrder.length });
    logger.info(`[CollabEngine] Plan created for mission ${missionId} — ${plan.executionOrder.length} stages, ${plan.parallelGroups.length} parallel groups`);

    // Annotate the mission in missionMemory
    try {
        _mm()?.recordDecision(missionId, {
            type:        "collaboration_plan",
            description: `Collaboration plan assigned: ${plan.assignedAgents.join(" → ")}`,
            rationale:   `Multi-agent execution with ${plan.executionOrder.length} ordered stages`,
            outcome:     "pending",
        });
    } catch {}

    // Auto-advance to first stage
    setImmediate(() => _advancePlan(missionId).catch(() => {}));

    return { ...plan };
}

/**
 * getPlan(missionId) — retrieve a collaboration plan
 */
function getPlan(missionId) {
    const store = _load();
    const plan  = store.plans[missionId];
    return plan ? { ...plan } : null;
}

/**
 * listPlans(opts) — list collaboration plans
 * opts: { status?, limit?, activeOnly? }
 */
function listPlans({ status, limit = 50, activeOnly } = {}) {
    const store = _load();
    let plans = Object.values(store.plans);
    if (status)     plans = plans.filter(p => p.status === status);
    if (activeOnly) plans = plans.filter(p => p.status === "active");
    plans = plans.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    return { plans: plans.map(p => ({ ...p })), total: plans.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN ADVANCE — move through execution order, dispatch parallel groups
// ─────────────────────────────────────────────────────────────────────────────

async function _advancePlan(missionId) {
    const store = _load();
    const plan  = store.plans[missionId];
    if (!plan || plan.status !== "active") return;

    const now = new Date().toISOString();
    const order = plan.executionOrder;

    // Dispatch any pending parallel groups first
    for (const grp of plan.parallelGroups) {
        if (grp.status === "pending") {
            await _runParallelGroup(missionId, grp);
        }
    }

    // Find next pending stage in order
    const nextStage = order.find(s => s.status === "pending");
    if (!nextStage) {
        // Check completion criteria
        const allStagesDone = order.every(s => ["completed", "skipped"].includes(s.status));
        if (allStagesDone) {
            _completePlan(missionId);
        }
        return;
    }

    // Check approval gate before this stage
    const approval = plan.approvalStages.find(a => {
        const prevIdx = order.findIndex(s => s.agentId === a.afterAgent);
        return prevIdx >= 0 && prevIdx === nextStage.index - 1;
    });
    if (approval && !approval.approved) {
        plan.status = "waiting_approval";
        plan.updatedAt = now;
        _save();
        _emit("collaboration:waiting_approval", { missionId, gate: approval });
        return;
    }

    // Dispatch the stage — trigger the assigned agent's tick
    nextStage.status    = "running";
    nextStage.startedAt = now;
    plan.currentStageIndex = nextStage.index;
    plan.updatedAt = now;

    // Create a handoff to this agent
    const hoff = _createHandoff(missionId, null, nextStage.agentId, {
        stage:       nextStage.stage,
        description: nextStage.description,
        stageIndex:  nextStage.index,
    });
    nextStage.handoffId = hoff.handoffId;

    // Update ownership
    _transferOwnership(missionId, nextStage.agentId, `Stage ${nextStage.index + 1}: ${nextStage.stage}`);

    _save();
    _emit("collaboration:stage_started", { missionId, stage: nextStage.stage, agentId: nextStage.agentId });

    // Trigger the agent's tick so it picks up the collaborative work context
    try {
        const sup = _sup();
        if (sup) {
            const agentState = sup.getAgent(nextStage.agentId);
            if (agentState && agentState.status === "running") {
                await sup.triggerTick(nextStage.agentId);
            }
        }
    } catch (e) { logger.warn(`[CollabEngine] Trigger tick failed: ${e.message}`); }

    // Register the assignment in missionMemory subtask
    try {
        _mm()?.addSubtask(missionId, {
            description:  `[Collab] ${nextStage.stage}: ${nextStage.description}`,
            assignedAgent: nextStage.agentId,
            status:       "running",
        });
    } catch {}
}

// Parallel group execution (I6-3)
async function _runParallelGroup(missionId, grp) {
    const store = _load();
    const plan  = store.plans[missionId];
    if (!plan) return;

    const now = new Date().toISOString();
    grp.status    = "running";
    grp.startedAt = now;
    plan.updatedAt = now;
    _save();
    _stats.parallelGroupsExecuted++;
    _emit("collaboration:parallel_group_started", { missionId, groupId: grp.groupId, agents: grp.agents });

    // Trigger all agents in the group simultaneously (no await on each)
    const triggers = grp.agents.map(async agentId => {
        const hoff = _createHandoff(missionId, null, agentId, {
            stage:       `parallel_${grp.groupId}`,
            description: grp.description,
            groupId:     grp.groupId,
            parallel:    true,
        });
        try {
            const sup = _sup();
            if (sup?.getAgent(agentId)?.status === "running") {
                await sup.triggerTick(agentId);
                grp.results[agentId] = { status: "triggered", ts: new Date().toISOString() };
            } else {
                grp.results[agentId] = { status: "skipped_not_running", ts: new Date().toISOString() };
            }
        } catch (e) {
            grp.results[agentId] = { status: "error", error: e.message, ts: new Date().toISOString() };
        }
    });

    await Promise.allSettled(triggers);
    grp.status      = "completed";
    grp.completedAt = new Date().toISOString();
    _save();
    _emit("collaboration:parallel_group_completed", { missionId, groupId: grp.groupId });
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDOFF ENGINE (I6-2)
// ─────────────────────────────────────────────────────────────────────────────

function _createHandoff(missionId, fromAgent, toAgent, payload = {}) {
    const store = _load();
    if (!store.handoffs[missionId]) store.handoffs[missionId] = [];

    const now  = new Date().toISOString();
    const hoff = {
        handoffId:    _hid(),
        missionId,
        fromAgent:    fromAgent || null,
        toAgent,
        payload,
        status:       "pending",
        createdAt:    now,
        acceptedAt:   null,
        claimedAt:    null,
        releasedAt:   null,
        completedAt:  null,
        retries:      0,
        maxRetries:   3,
        error:        null,
        outcome:      null,
    };

    store.handoffs[missionId].push(hoff);
    _stats.handoffsTotal++;
    _save();
    _emit("collaboration:handoff_created", { missionId, handoffId: hoff.handoffId, fromAgent, toAgent });
    return { ...hoff };
}

/**
 * handoff(missionId, fromAgent, toAgent, payload) — explicit handoff request
 */
function handoff(missionId, fromAgent, toAgent, payload = {}) {
    const store = _load();
    const plan  = store.plans[missionId];
    if (!plan) throw new Error(`No collaboration plan for mission ${missionId}`);

    const hoff = _createHandoff(missionId, fromAgent, toAgent, payload);

    // Advance current stage in plan if this fromAgent just completed their stage
    const stage = plan.executionOrder.find(s => s.agentId === fromAgent && s.status === "running");
    if (stage) {
        stage.status      = "completed";
        stage.completedAt = new Date().toISOString();
        plan.updatedAt    = new Date().toISOString();
        _save();
        _stats.handoffsCompleted++;
        _emit("collaboration:stage_completed", { missionId, stage: stage.stage, agentId: fromAgent });
        // Advance to next stage
        setImmediate(() => _advancePlan(missionId).catch(() => {}));
    }

    logger.info(`[CollabEngine] Handoff ${hoff.handoffId}: ${fromAgent} → ${toAgent} on mission ${missionId}`);
    return { ...hoff };
}

/**
 * claim(missionId, agentId) — agent claims a pending handoff
 */
function claim(missionId, agentId) {
    const store   = _load();
    const handoffs = store.handoffs[missionId] || [];
    const hoff    = handoffs.find(h => h.toAgent === agentId && h.status === "pending");
    if (!hoff) throw new Error(`No pending handoff for agent ${agentId} on mission ${missionId}`);

    hoff.status    = "claimed";
    hoff.claimedAt = new Date().toISOString();
    _save();
    _emit("collaboration:handoff_claimed", { missionId, handoffId: hoff.handoffId, agentId });
    return { ...hoff };
}

/**
 * accept(missionId, agentId, handoffId) — agent explicitly accepts a handoff
 */
function accept(missionId, agentId, handoffId) {
    const store   = _load();
    const handoffs = store.handoffs[missionId] || [];
    const hoff    = handoffId
        ? handoffs.find(h => h.handoffId === handoffId)
        : handoffs.find(h => h.toAgent === agentId && ["pending", "claimed"].includes(h.status));
    if (!hoff) throw new Error(`Handoff not found for accept: ${handoffId || agentId}`);

    hoff.status     = "accepted";
    hoff.acceptedAt = new Date().toISOString();
    _transferOwnership(missionId, agentId, `Accepted handoff ${hoff.handoffId}`);
    _save();
    _emit("collaboration:handoff_accepted", { missionId, handoffId: hoff.handoffId, agentId });
    return { ...hoff };
}

/**
 * release(missionId, agentId, outcome) — agent releases ownership (stage done)
 */
function release(missionId, agentId, outcome = "completed") {
    const store   = _load();
    const handoffs = store.handoffs[missionId] || [];
    const hoff    = handoffs.find(h => h.toAgent === agentId && ["accepted", "claimed", "running"].includes(h.status));
    if (!hoff) throw new Error(`No active handoff for agent ${agentId} on mission ${missionId}`);

    hoff.status      = "completed";
    hoff.releasedAt  = new Date().toISOString();
    hoff.completedAt = hoff.releasedAt;
    hoff.outcome     = outcome;
    _stats.handoffsCompleted++;
    _save();
    _emit("collaboration:handoff_released", { missionId, handoffId: hoff.handoffId, agentId, outcome });

    // Mark the corresponding stage done and advance
    const plan  = store.plans[missionId];
    if (plan) {
        const stage = plan.executionOrder.find(s => s.agentId === agentId && s.status === "running");
        if (stage) {
            stage.status      = "completed";
            stage.completedAt = hoff.completedAt;
            plan.updatedAt    = new Date().toISOString();
            _save();
            setImmediate(() => _advancePlan(missionId).catch(() => {}));
        }
    }
    return { ...hoff };
}

/**
 * retry(missionId, handoffId) — retry a failed handoff
 */
function retry(missionId, handoffId) {
    const store   = _load();
    const handoffs = store.handoffs[missionId] || [];
    const hoff    = handoffs.find(h => h.handoffId === handoffId);
    if (!hoff) throw new Error(`Handoff ${handoffId} not found on mission ${missionId}`);
    if (hoff.status !== "failed" && hoff.status !== "rejected") {
        throw new Error(`Can only retry failed/rejected handoffs (current: ${hoff.status})`);
    }
    if (hoff.retries >= hoff.maxRetries) throw new Error(`Max retries (${hoff.maxRetries}) reached`);

    hoff.retries++;
    hoff.status   = "pending";
    hoff.error    = null;
    _stats.handoffsRetried++;
    _save();
    _emit("collaboration:handoff_retried", { missionId, handoffId, attempt: hoff.retries });

    // Trigger destination agent
    try { _sup()?.triggerTick(hoff.toAgent).catch(() => {}); } catch {}
    return { ...hoff };
}

/**
 * reject(missionId, agentId, reason) — agent rejects a handoff
 */
function reject(missionId, agentId, reason = "Rejected by agent") {
    const store   = _load();
    const handoffs = store.handoffs[missionId] || [];
    const hoff    = handoffs.find(h => h.toAgent === agentId && ["pending", "claimed", "accepted"].includes(h.status));
    if (!hoff) throw new Error(`No rejectable handoff for agent ${agentId} on mission ${missionId}`);

    hoff.status = "rejected";
    hoff.error  = reason;
    _stats.handoffsFailed++;
    _save();
    _emit("collaboration:handoff_rejected", { missionId, handoffId: hoff.handoffId, agentId, reason });

    // Mark stage failed in plan
    const plan = store.plans[missionId];
    if (plan) {
        const stage = plan.executionOrder.find(s => s.agentId === agentId && s.status === "running");
        if (stage) {
            stage.status = "failed";
            stage.completedAt = new Date().toISOString();
            plan.updatedAt = new Date().toISOString();
            plan.error = reason;
            _save();
        }
    }
    return { ...hoff };
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNERSHIP TRACKING (I6-4)
// ─────────────────────────────────────────────────────────────────────────────

function _transferOwnership(missionId, newOwner, note = "") {
    const store = _load();
    let own     = store.ownership[missionId];
    if (!own) {
        own = { missionId, currentOwner: null, previousOwners: [], handoffHistory: [], executionTimeline: [] };
        store.ownership[missionId] = own;
    }

    const now = new Date().toISOString();
    if (own.currentOwner && own.currentOwner !== newOwner) {
        own.previousOwners.push({ agentId: own.currentOwner, releasedAt: now });
        own.handoffHistory.push({ from: own.currentOwner, to: newOwner, ts: now, note });
    }
    own.currentOwner = newOwner;
    own.executionTimeline.push({ ts: now, event: "ownership_transfer", agentId: newOwner, note });
    _save();
}

/**
 * getMissionOwnership(missionId) — full ownership record
 */
function getMissionOwnership(missionId) {
    const store = _load();
    return store.ownership[missionId] ? { ...store.ownership[missionId] } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// OBSERVATION: BLOCKED CHAINS, STALLED HANDOFFS (I6-6 support)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getActiveCollaborations() — all active plans with current stage and ownership
 */
function getActiveCollaborations() {
    const store = _load();
    return Object.values(store.plans)
        .filter(p => p.status === "active" || p.status === "waiting_approval")
        .map(p => {
            const own = store.ownership[p.missionId];
            const currentStage = p.executionOrder[p.currentStageIndex] || null;
            const pendingHandoffs = (store.handoffs[p.missionId] || []).filter(h => h.status === "pending").length;
            return {
                ...p,
                currentOwner:    own?.currentOwner || null,
                currentStage,
                pendingHandoffs,
            };
        });
}

/**
 * getBlockedChains() — plans where a stage is stuck (no running handoffs and not complete)
 */
function getBlockedChains() {
    const store = _load();
    const blocked = [];
    for (const plan of Object.values(store.plans)) {
        if (!["active", "waiting_approval"].includes(plan.status)) continue;
        const activeHandoffs = (store.handoffs[plan.missionId] || []).filter(h =>
            ["pending", "claimed", "accepted"].includes(h.status)
        );
        const runningStage = plan.executionOrder.find(s => s.status === "running");
        if (runningStage && activeHandoffs.length === 0) {
            const own = store.ownership[plan.missionId];
            blocked.push({
                missionId:    plan.missionId,
                planId:       plan.planId,
                blockedStage: runningStage,
                currentOwner: own?.currentOwner || null,
                blockedSince: runningStage.startedAt,
            });
        }
    }
    _stats.blockedChains = blocked.length;
    return blocked;
}

/**
 * getStalledHandoffs(thresholdMs) — handoffs that have been pending/claimed for too long
 */
const DEFAULT_STALL_THRESHOLD_MS = 5 * 60_000; // 5 minutes
function getStalledHandoffs(thresholdMs = DEFAULT_STALL_THRESHOLD_MS) {
    const store = _load();
    const cutoff = new Date(Date.now() - thresholdMs).toISOString();
    const stalled = [];
    for (const handoffs of Object.values(store.handoffs)) {
        for (const h of handoffs) {
            if (["pending", "claimed"].includes(h.status) && h.createdAt < cutoff) {
                stalled.push({ ...h });
            }
        }
    }
    return stalled;
}

/**
 * completePlan(missionId) — force-complete a plan (called internally or by executive)
 */
function _completePlan(missionId) {
    const store = _load();
    const plan  = store.plans[missionId];
    if (!plan) return;
    plan.status      = "completed";
    plan.completedAt = new Date().toISOString();
    plan.updatedAt   = plan.completedAt;
    _save();

    // Sync to missionMemory
    try { _mm()?.updateMission(missionId, { status: "completed" }); } catch {}

    // Register a lesson
    try {
        _le()?.createLesson?.({
            type:     "collaboration_outcome",
            severity: "info",
            source:   "collaboration_engine",
            title:    `Collaboration complete: mission ${missionId}`,
            detail:   `${plan.executionOrder.length} stages, ${plan.parallelGroups.length} parallel groups — completed ${plan.completedAt}`,
            tags:     ["collaboration", "auto"],
            missionId,
        });
    } catch {}

    _emit("collaboration:plan_completed", { missionId, planId: plan.planId });
    logger.info(`[CollabEngine] Collaboration plan completed for mission ${missionId}`);
}

// Public version for executive agent / routes
function completePlan(missionId) {
    _completePlan(missionId);
    const store = _load();
    return store.plans[missionId] ? { ...store.plans[missionId] } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────────────

function getStats() {
    const store = _load();
    const plans = Object.values(store.plans);
    return {
        ..._stats,
        totalPlans:    plans.length,
        activePlans:   plans.filter(p => p.status === "active").length,
        completedPlans:plans.filter(p => p.status === "completed").length,
        totalMissions: Object.keys(store.handoffs).length,
        totalHandoffsFailed: _stats.handoffsFailed,
    };
}

/**
 * getHandoffs(missionId) — all handoffs for a mission
 */
function getHandoffs(missionId) {
    const store = _load();
    return (store.handoffs[missionId] || []).map(h => ({ ...h }));
}

module.exports = {
    // I6-1: Plan
    createPlan,
    getPlan,
    listPlans,
    completePlan,
    // I6-2: Handoff Engine
    handoff,
    claim,
    release,
    retry,
    reject,
    accept,
    getHandoffs,
    // I6-4: Ownership
    getMissionOwnership,
    // Observation (I6-5, I6-6)
    getActiveCollaborations,
    getBlockedChains,
    getStalledHandoffs,
    getStats,
};
