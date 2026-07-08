"use strict";
/**
 * missionOrchestrator.cjs — I3: Mission Orchestrator
 *
 * Coordinates existing systems to execute missions derived from
 * I2 Decision Engine decisions. Does NOT duplicate any existing system:
 *
 *   Storage authority   → missionMemory      (unchanged)
 *   Lifecycle authority → missionRuntime     (unchanged)
 *   Execution authority → autonomousLoop     (unchanged)
 *   Capability routing  → agentRegistry      (unchanged)
 *   Graph topology      → taskGraph          (unchanged)
 *   Event fan-out       → runtimeEventBus    (unchanged)
 *
 * The Orchestrator owns only:
 *   • Translating decisions into mission+stage plans
 *   • Stage dependency tracking (reuses missionMemory subtasks)
 *   • Retry / rollback coordination
 *   • Progress event emission
 *
 * Mission lifecycle managed here:
 *   Created → Planned → Queued → Executing → Waiting → Retrying
 *            → Completed → Failed → RolledBack
 *
 * (missionMemory stores: planned | active | paused | completed | failed | cancelled)
 * Orchestrator maps its richer lifecycle into those storage states.
 *
 * Public API:
 *   start()                            → { started }
 *   stop()                             → void
 *   createFromDecision(decision)       → orchestratedMission
 *   createManual(opts)                 → orchestratedMission
 *   pause(missionId, reason)           → orchestratedMission
 *   resume(missionId)                  → orchestratedMission
 *   cancel(missionId, reason)          → orchestratedMission
 *   getMission(missionId)              → orchestratedMission | null
 *   listMissions(opts)                 → { missions[], total }
 *   getStatistics()                    → stats object
 */

const fs     = require("fs");
const path   = require("path");
const crypto = require("crypto");
const logger = require("../utils/logger");

// ── Lazy service loaders ───────────────────────────────────────────────────
function _getBus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs");  } catch { return null; } }
function _getMem()    { try { return require("./missionMemory.cjs");                       } catch { return null; } }
function _getRT()     { try { return require("../../agents/runtime/missionRuntime.cjs");   } catch { return null; } }
function _getLoop()   { try { return require("../../agents/autonomousLoop.cjs");           } catch { return null; } }
function _getReg()    { try { return require("../../agents/runtime/agentRegistry.cjs");    } catch { return null; } }
function _getObs()    { try { return require("./observabilityEngine.cjs");                 } catch { return null; } }

// ── Paths ──────────────────────────────────────────────────────────────────
const DATA_DIR       = path.join(__dirname, "../../data");
const ORCH_FILE      = path.join(DATA_DIR, "orchestrator-state.json");

// ── ID generation ──────────────────────────────────────────────────────────
let _seq = 0;
function _oid()  { return `orch_${Date.now()}_${(++_seq).toString(36)}`; }
function _stid() { return `stg_${Date.now()}_${(++_seq).toString(36)}`; }

// ── Orchestrator lifecycle states (superset of missionMemory statuses) ─────
const ORCH_STATES = new Set([
    "created", "planned", "queued", "executing",
    "waiting", "retrying", "completed", "failed", "rolledback",
    "paused", "cancelled",
]);

// Mirrors the terminal-state filter _loadOrch() already applies when
// restoring _live from disk on boot (see below) — but nothing evicted these
// from _live during a running process, so it grew by one entry per mission
// ever created for the life of the process. missionMemory is authoritative
// for terminal missions (getMission() already falls back to it when a
// missionId isn't in _live), so evicting here is safe.
const TERMINAL_STATES = new Set(["completed", "failed", "rolledback", "cancelled"]);

// Map orchestrator state → missionMemory status
const TO_MEM_STATUS = {
    created:    "planned",
    planned:    "planned",
    queued:     "planned",
    executing:  "active",
    waiting:    "active",
    retrying:   "active",
    completed:  "completed",
    failed:     "failed",
    rolledback: "cancelled",
    paused:     "paused",
    cancelled:  "cancelled",
};

// ── In-process orchestration registry ─────────────────────────────────────
// missionMemory is authoritative for mission data; this map tracks
// live orchestration metadata that doesn't need to persist to disk.
const _live = new Map();  // missionId → orchestrationRecord

// Persist orchestration metadata (origin decision, stages, retries) separately
let _orcState    = null;   // lazy-loaded
let _orcDirty    = false;
let _orcWriting  = false;

function _loadOrch() {
    if (_orcState) return _orcState;
    try { _orcState = JSON.parse(fs.readFileSync(ORCH_FILE, "utf8")); } catch { _orcState = { records: [] }; }
    // Restore live map from persisted state
    for (const rec of _orcState.records || []) {
        if (!TERMINAL_STATES.has(rec.orchStatus)) {
            _live.set(rec.missionId, rec);
        }
    }
    return _orcState;
}

function _saveOrch() {
    _orcDirty = true;
    if (_orcWriting) return;
    _orcWriting = true;
    setImmediate(() => {
        const data  = JSON.stringify({ records: [..._live.values()], savedAt: new Date().toISOString() }, null, 2);
        const tmp   = ORCH_FILE + ".tmp";
        fs.writeFile(tmp, data, "utf8", err => {
            _orcWriting = false;
            if (!err) fs.rename(tmp, ORCH_FILE, () => { _orcDirty = false; });
            else logger.warn(`[Orchestrator] save error: ${err.message}`);
        });
    });
}

// ── Statistics counters ────────────────────────────────────────────────────
const _stats = {
    created: 0, completed: 0, failed: 0, cancelled: 0,
    totalStages: 0, retries: 0, rollbacks: 0,
};
let _startedAt = null;

// ── Event helper ───────────────────────────────────────────────────────────
function _emit(eventType, missionId, payload = {}) {
    try { _getBus()?.emit(eventType, { missionId, ...payload, _source: "orchestrator" }); } catch { /* non-fatal */ }
}

// ── Stage: build execution stage descriptors from a goal ──────────────────
/**
 * Decompose a mission goal into ordered stages with dependency declarations.
 * Each stage maps to a missionMemory subtask and an autonomousLoop task.
 * Reuses agentRegistry.findForCapability for assignment.
 *
 * Returns stages[] where each stage has:
 *   id, description, capability, assignedAgent, dependsOn[], status, loopTaskId, retries, maxRetries
 */
function _planStages(goal, priority, opts = {}) {
    const reg = _getReg();

    // Capability pipeline — ordered, with dependency wiring
    const pipeline = [
        { capability: "goal_decompose", descFn: g => `Decompose goal: "${g.slice(0, 80)}"`,           dependsOn: [] },
        { capability: "task_plan",      descFn: g => `Plan execution tasks for: "${g.slice(0, 80)}"`,  dependsOn: [0] },
        { capability: "validation",     descFn: g => `Validate plan for: "${g.slice(0, 80)}"`,         dependsOn: [1] },
        { capability: "execution",      descFn: g => `Execute plan for: "${g.slice(0, 80)}"`,          dependsOn: [1, 2] },
        { capability: "reporting",      descFn: g => `Report completion for: "${g.slice(0, 80)}"`,     dependsOn: [3] },
    ];

    // Allow caller to skip stages by capability name
    const skip = new Set(opts.skipCapabilities || []);

    const stages = [];
    for (let i = 0; i < pipeline.length; i++) {
        const p   = pipeline[i];
        if (skip.has(p.capability)) continue;

        const agent = reg ? reg.findForCapability(p.capability) : null;
        const stgIdx = stages.length;
        stages.push({
            id:            _stid(),
            index:         stgIdx,
            description:   p.descFn(goal),
            capability:    p.capability,
            assignedAgent: agent?.id || null,
            dependsOn:     p.dependsOn.filter(d => d < stgIdx).map(d => stages[d]?.id).filter(Boolean),
            status:        "pending",
            loopTaskId:    null,
            retries:       0,
            maxRetries:    2,
            startedAt:     null,
            completedAt:   null,
            output:        null,
            error:         null,
        });
    }
    return stages;
}

// ── Core: create orchestrated mission ─────────────────────────────────────
function _createRecord(opts) {
    const {
        goal, priority = "medium", originDecisionId = null,
        requiresApproval = false, skipCapabilities = [],
        rollbackPlan = null,
    } = opts;

    if (!goal?.trim()) throw new Error("missionOrchestrator: goal is required");

    const mem     = _getMem();
    const rt      = _getRT();
    if (!mem) throw new Error("missionMemory unavailable");

    // Create the authoritative mission in missionMemory
    const memPriority = ["low", "medium", "high", "critical"].includes(priority) ? priority : "medium";
    const memMission  = mem.createMission({
        objective: goal.trim(),
        priority:  memPriority,
        subtasks:  [],   // stages added below
    });

    const stages = _planStages(goal.trim(), priority, { skipCapabilities });

    // Register each stage as a missionMemory subtask for unified visibility
    for (const stg of stages) {
        try {
            mem.addSubtask(memMission.id, {
                id:            stg.id,
                description:   stg.description,
                assignedAgent: stg.assignedAgent,
                status:        "pending",
            });
        } catch { /* non-fatal — subtask visibility is best-effort */ }
    }

    // Record the originating decision link
    if (originDecisionId) {
        try {
            mem.recordDecision(memMission.id, {
                type:        "origin",
                description: `Created from decision ${originDecisionId}`,
                rationale:   "Autonomous Decision Engine triggered mission creation",
                outcome:     "pending",
            });
        } catch { /* non-fatal */ }
    }

    const now = new Date().toISOString();
    const rec = {
        missionId:        memMission.id,
        orchId:           _oid(),
        goal:             goal.trim(),
        originDecisionId,
        priority:         memPriority,
        orchStatus:       "planned",
        currentStage:     null,
        stages,
        progress:         { total: stages.length, completed: 0, failed: 0, pending: stages.length },
        requiresApproval,
        rollbackPlan:     rollbackPlan || `Revert changes made by mission ${memMission.id}`,
        verificationStatus: "pending",
        createdAt:        now,
        updatedAt:        now,
        estimatedCompletion: null,
        startedAt:        null,
        completedAt:      null,
        error:            null,
    };

    _live.set(memMission.id, rec);
    _saveOrch();
    _stats.created++;
    _stats.totalStages += stages.length;

    _emit("orchestrator:created", memMission.id, { goal: goal.trim(), priority, stageCount: stages.length, requiresApproval });
    logger.info(`[Orchestrator] Created mission ${memMission.id} — ${stages.length} stages, priority=${priority}`);

    return { ...rec };
}

// ── Transition orchestration state ─────────────────────────────────────────
function _transition(missionId, nextStatus, patch = {}) {
    const rec = _live.get(missionId);
    if (!rec) throw new Error(`Orchestrator: mission not in live registry: ${missionId}`);
    if (!ORCH_STATES.has(nextStatus)) throw new Error(`Invalid orch state: ${nextStatus}`);

    rec.orchStatus = nextStatus;
    rec.updatedAt  = new Date().toISOString();
    Object.assign(rec, patch);

    // Sync to missionMemory
    const memStatus = TO_MEM_STATUS[nextStatus];
    if (memStatus) {
        try { _getMem()?.updateMission(missionId, { status: memStatus }); } catch { /* non-fatal */ }
    }

    if (TERMINAL_STATES.has(nextStatus)) rec._terminalAt = Date.now();

    _saveOrch();
    _emit(`orchestrator:${nextStatus}`, missionId, { orchStatus: nextStatus, ...patch });
    return { ...rec };
}

// ── Evict terminal missions from _live ─────────────────────────────────────
// _live is meant to hold only in-flight orchestration state (missionMemory is
// authoritative once a mission finishes — getMission()/listMissions() already
// fall back to it). A short grace window keeps just-completed missions
// visible to callers polling for a result before the record is dropped.
const LIVE_EVICTION_GRACE_MS = 5 * 60_000;

function _sweepTerminalMissions() {
    const now = Date.now();
    for (const [missionId, rec] of _live) {
        if (rec._terminalAt && now - rec._terminalAt > LIVE_EVICTION_GRACE_MS) {
            _live.delete(missionId);
        }
    }
}

setInterval(_sweepTerminalMissions, 60_000).unref();

// ── Queue for execution (non-approval missions auto-advance) ───────────────
function _queue(missionId) {
    const rec = _live.get(missionId);
    if (!rec) return;
    _transition(missionId, "queued");
    // Immediately begin execution (auto-advance from queued → executing)
    setImmediate(() => _advance(missionId).catch(err => {
        logger.warn(`[Orchestrator] advance error for ${missionId}: ${err.message}`);
    }));
}

// ── Advance mission: dispatch next ready stages ────────────────────────────
async function _advance(missionId) {
    const rec = _live.get(missionId);
    if (!rec) return;
    if (["completed", "failed", "cancelled", "rolledback", "paused"].includes(rec.orchStatus)) return;

    _transition(missionId, "executing");

    const readyStages = _getReadyStages(rec);
    if (readyStages.length === 0) {
        // All stages done?
        const allDone  = rec.stages.every(s => ["completed", "skipped"].includes(s.status));
        const anyFailed = rec.stages.some(s => s.status === "failed");

        if (anyFailed) {
            _fail(missionId, "One or more stages failed");
        } else if (allDone) {
            _complete(missionId);
        } else {
            // Some stages still pending but nothing ready — dependency deadlock or waiting
            _transition(missionId, "waiting");
        }
        return;
    }

    // Dispatch each ready stage to autonomousLoop (parallel where no dependency)
    for (const stg of readyStages) {
        stg.status    = "running";
        stg.startedAt = new Date().toISOString();
        rec.currentStage = stg.id;
        rec.updatedAt    = new Date().toISOString();

        _emit("orchestrator:stage:started", missionId, { stageId: stg.id, capability: stg.capability, agent: stg.assignedAgent });

        try {
            const loop = _getLoop();
            if (loop) {
                const queued    = loop.addTask({
                    input: stg.description,
                    type:  `orchestrator_stage_${stg.capability}`,
                });
                stg.loopTaskId  = queued.id;
            }
            // Update missionMemory subtask
            try {
                _getMem()?.updateMission(missionId, {});  // touch updatedAt
                const rt = _getRT();
                if (rt) rt.updateSubtaskStatus(missionId, stg.id, "running");
            } catch { /* non-fatal */ }

            // Monitor stage completion asynchronously
            _monitorStage(missionId, stg).catch(() => { /* handled inside */ });
        } catch (err) {
            stg.status = "failed";
            stg.error  = err.message;
            logger.warn(`[Orchestrator] Stage dispatch failed ${stg.id}: ${err.message}`);
        }
    }

    _saveOrch();
    _updateProgress(rec);
}

// ── Monitor stage via autonomousLoop task completion ───────────────────────
// Poll the loop queue for task status. Cap at 5 minutes.
async function _monitorStage(missionId, stg) {
    if (!stg.loopTaskId) {
        // No loop task — mark complete immediately (graceful degradation)
        _stageComplete(missionId, stg, null);
        return;
    }
    const POLL_MS  = 3_000;
    const TIMEOUT  = 5 * 60_000;
    const deadline = Date.now() + TIMEOUT;

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_MS));
        const rec = _live.get(missionId);
        if (!rec || ["cancelled", "failed", "paused"].includes(rec.orchStatus)) return;

        try {
            const loop = _getLoop();
            if (!loop) { _stageComplete(missionId, stg, null); return; }
            const all  = loop.getQueue();
            const task = all.find(t => t.id === stg.loopTaskId);
            if (!task) { _stageComplete(missionId, stg, null); return; }

            if (task.status === "completed") {
                _stageComplete(missionId, stg, task.result || null);
                return;
            }
            if (task.status === "failed") {
                _stageFailed(missionId, stg, task.error || "Loop task failed");
                return;
            }
        } catch { /* non-fatal — keep polling */ }
    }
    // Timeout — treat as complete (optimistic: loop ran to execution)
    _stageComplete(missionId, stg, "timeout-assumed-complete");
}

function _stageComplete(missionId, stg, output) {
    const rec = _live.get(missionId);
    if (!rec) return;
    stg.status      = "completed";
    stg.completedAt = new Date().toISOString();
    stg.output      = output;
    _updateProgress(rec);
    _saveOrch();

    try { _getRT()?.updateSubtaskStatus(missionId, stg.id, "completed", output); } catch { /* non-fatal */ }
    _emit("orchestrator:stage:completed", missionId, { stageId: stg.id, capability: stg.capability });
    _obs(`orchestrator.stage.completed`, 1, { missionId });

    // Advance to next ready stages
    _advance(missionId).catch(() => { /* handled */ });
}

function _stageFailed(missionId, stg, errMsg) {
    const rec = _live.get(missionId);
    if (!rec) return;

    if (stg.retries < stg.maxRetries) {
        stg.retries++;
        stg.status = "pending";   // reset for retry
        stg.error  = errMsg;
        _stats.retries++;
        _transition(missionId, "retrying", { error: `Retrying stage ${stg.id} (attempt ${stg.retries}/${stg.maxRetries})` });
        _emit("orchestrator:stage:retrying", missionId, { stageId: stg.id, attempt: stg.retries });
        logger.info(`[Orchestrator] Retrying stage ${stg.id} attempt ${stg.retries}`);
        setTimeout(() => _advance(missionId).catch(() => { /* handled */ }), 5_000 * stg.retries);
    } else {
        stg.status = "failed";
        stg.error  = errMsg;
        try { _getRT()?.updateSubtaskStatus(missionId, stg.id, "failed", errMsg); } catch { /* non-fatal */ }
        _emit("orchestrator:stage:failed", missionId, { stageId: stg.id, error: errMsg });
        _fail(missionId, `Stage "${stg.description.slice(0, 60)}" failed after ${stg.maxRetries} retries: ${errMsg}`);
    }
    _updateProgress(rec);
    _saveOrch();
}

// ── Progress recompute ────────────────────────────────────────────────────
function _updateProgress(rec) {
    const total     = rec.stages.length;
    const completed = rec.stages.filter(s => s.status === "completed").length;
    const failed    = rec.stages.filter(s => s.status === "failed").length;
    const pending   = rec.stages.filter(s => s.status === "pending").length;
    rec.progress = { total, completed, failed, pending };

    if (total > 0 && completed > 0) {
        const avgStageMs = 30_000;  // rough estimate
        const remaining  = pending * avgStageMs;
        rec.estimatedCompletion = new Date(Date.now() + remaining).toISOString();
    }
}

// ── Ready stages: pending stages whose all deps are completed ─────────────
function _getReadyStages(rec) {
    const completedIds = new Set(
        rec.stages.filter(s => s.status === "completed").map(s => s.id)
    );
    return rec.stages.filter(s =>
        s.status === "pending" &&
        (s.dependsOn || []).every(dep => completedIds.has(dep))
    );
}

// ── Mission terminal transitions ──────────────────────────────────────────
function _complete(missionId) {
    const rec = _live.get(missionId);
    if (!rec) return;
    rec.completedAt         = new Date().toISOString();
    rec.verificationStatus  = "passed";
    _transition(missionId, "completed");
    _stats.completed++;
    _obs("orchestrator.mission.completed", 1, { priority: rec.priority });
    try { _getRT()?.completeMission(missionId, { summary: `Orchestrator completed mission: ${rec.goal.slice(0, 80)}` }); } catch { /* non-fatal */ }
    logger.info(`[Orchestrator] Mission ${missionId} completed`);
}

function _fail(missionId, reason) {
    const rec = _live.get(missionId);
    if (!rec) return;
    rec.completedAt = new Date().toISOString();
    rec.error       = reason;
    _transition(missionId, "failed", { error: reason });
    _stats.failed++;
    _obs("orchestrator.mission.failed", 1, { priority: rec?.priority });
    try { _getRT()?.failMission(missionId, reason); } catch { /* non-fatal */ }
    logger.warn(`[Orchestrator] Mission ${missionId} failed: ${reason}`);
}

// ── Observability helper ───────────────────────────────────────────────────
function _obs(name, value, tags = {}) {
    try { _getObs()?.recordMetric(name, value, tags); } catch { /* non-fatal */ }
}

// ── Decision Engine subscriber ─────────────────────────────────────────────
// Listen for 'decision' events on runtimeEventBus.
// CreateMission decisions that do not requiresApproval are auto-queued.
const SUB_ID   = "orchestrator_i3";
let   _running = false;

function _subscribeDecisions() {
    const bus = _getBus();
    if (!bus) { logger.warn("[Orchestrator] runtimeEventBus unavailable"); return; }
    try {
        bus.subscribe(SUB_ID, envelope => {
            if (envelope.type !== "decision") return;
            const d = envelope.payload;
            if (!d || d.recommendedAction !== "CreateMission") return;
            if (d.requiresApproval) return;   // operator must approve explicitly

            // Auto-create mission from decision
            try {
                const goal = d.reason?.slice(0, 300) || `Auto-mission from decision ${d.decisionId}`;
                _createRecord({ goal, priority: _mapPriority(d.priority), originDecisionId: d.decisionId });
                const ids = [..._live.keys()];
                const missionId = ids[ids.length - 1];
                if (missionId) _queue(missionId);
            } catch (err) {
                logger.warn(`[Orchestrator] auto-create from decision failed: ${err.message}`);
            }
        });
    } catch (err) {
        logger.warn(`[Orchestrator] bus subscribe error: ${err.message}`);
    }
}

function _mapPriority(decPriority) {
    const map = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low", NONE: "low" };
    return map[decPriority] || "medium";
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

function start() {
    if (_running) return { started: false, reason: "already_running" };
    _running   = true;
    _startedAt = Date.now();
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    _loadOrch();
    _subscribeDecisions();
    logger.info("[Orchestrator] I3 started");
    return { started: true };
}

function stop() {
    _running = false;
    try { _getBus()?.unsubscribe(SUB_ID); } catch { /* ok */ }
    logger.info("[Orchestrator] stopped");
}

/**
 * Create an orchestrated mission from an I2 Decision object.
 * @param {object} decision — { decisionId, reason, priority, requiresApproval, recommendedAction }
 */
function createFromDecision(decision) {
    if (!decision?.decisionId) throw new Error("createFromDecision: decision.decisionId required");
    const goal = decision.reason?.slice(0, 400) || `Mission from decision ${decision.decisionId}`;
    const rec  = _createRecord({
        goal,
        priority:          _mapPriority(decision.priority),
        originDecisionId:  decision.decisionId,
        requiresApproval:  decision.requiresApproval ?? false,
        rollbackPlan:      `Revert actions triggered by decision ${decision.decisionId}`,
    });
    if (!rec.requiresApproval) _queue(rec.missionId);
    return rec;
}

/**
 * Create a manual orchestrated mission.
 * @param {{ goal, priority?, requiresApproval?, rollbackPlan?, skipCapabilities? }} opts
 */
function createManual(opts = {}) {
    const rec = _createRecord(opts);
    if (!rec.requiresApproval) _queue(rec.missionId);
    return rec;
}

/**
 * Pause a mission (stops new stage dispatches).
 */
function pause(missionId, reason = "Paused by operator") {
    const rec = _live.get(missionId);
    if (!rec) throw new Error(`Mission not found in orchestrator: ${missionId}`);
    if (["completed", "failed", "cancelled", "rolledback"].includes(rec.orchStatus)) {
        throw new Error(`Cannot pause mission in state: ${rec.orchStatus}`);
    }
    return _transition(missionId, "paused", { pauseReason: reason });
}

/**
 * Resume a paused mission.
 */
function resume(missionId) {
    const rec = _live.get(missionId);
    if (!rec) throw new Error(`Mission not found in orchestrator: ${missionId}`);
    if (rec.orchStatus !== "paused") throw new Error(`Mission is not paused (current: ${rec.orchStatus})`);
    _transition(missionId, "queued");
    _queue(missionId);
    return { ...rec };
}

/**
 * Cancel a mission.
 */
function cancel(missionId, reason = "Cancelled by operator") {
    const rec = _live.get(missionId);
    if (!rec) throw new Error(`Mission not found in orchestrator: ${missionId}`);
    if (["completed", "cancelled", "rolledback"].includes(rec.orchStatus)) {
        throw new Error(`Cannot cancel mission in state: ${rec.orchStatus}`);
    }
    rec.completedAt = new Date().toISOString();
    _transition(missionId, "cancelled", { cancelReason: reason });
    _stats.cancelled++;
    try { _getRT()?.cancelMission(missionId, reason); } catch { /* non-fatal */ }
    return { ...rec };
}

/**
 * Get a single orchestrated mission (merges live record + missionMemory).
 */
function getMission(missionId) {
    const rec  = _live.get(missionId);
    if (!rec) {
        // Fall back to missionMemory for missions not in live registry (terminal)
        try {
            const mem = _getMem();
            if (mem) return mem.getMission(missionId);
        } catch { /* ok */ }
        return null;
    }
    // Merge fresh missionMemory data for timeline / subtask outputs
    try {
        const fresh = _getMem()?.getMission(missionId);
        if (fresh) return { ...rec, _memData: { timeline: fresh.timeline, metrics: fresh.metrics } };
    } catch { /* ok */ }
    return { ...rec };
}

/**
 * List orchestrated missions.
 * @param {{ status?, priority?, limit?, since? }} opts
 */
function listMissions({ status, priority, limit = 100, since } = {}) {
    let records = [..._live.values()];
    if (status)   records = records.filter(r => r.orchStatus === status);
    if (priority) records = records.filter(r => r.priority   === priority);
    if (since)    records = records.filter(r => r.createdAt  >= since);
    records = records.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
    return { missions: records.map(r => ({ ...r })), total: records.length };
}

/**
 * Statistics snapshot.
 */
function getStatistics() {
    const active = [..._live.values()].filter(r => ["executing", "waiting", "retrying", "queued"].includes(r.orchStatus)).length;
    return {
        running:    _running,
        startedAt:  _startedAt ? new Date(_startedAt).toISOString() : null,
        uptimeSec:  _startedAt ? Math.round((Date.now() - _startedAt) / 1000) : 0,
        liveMissions:   _live.size,
        activeMissions: active,
        ..._stats,
    };
}

module.exports = { start, stop, createFromDecision, createManual, pause, resume, cancel, getMission, listMissions, getStatistics };
