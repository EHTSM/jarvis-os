"use strict";
/**
 * missionRuntime.cjs — J1 Unified Mission Runtime
 *
 * Thin orchestration layer. Does NOT duplicate storage, observers, or execution
 * loops — it wires together:
 *   - missionMemory.cjs       (authoritative storage + timeline)
 *   - runtimeEventBus.cjs     (SSE fan-out for live progress)
 *   - runtimeOrchestrator.cjs (subtask dispatch)
 *   - executiveReasoning.cjs  (strategic analysis)
 *   - autonomousPlanning.cjs  (planning horizons)
 *
 * State machine:
 *   planned → running → completed
 *                    → failed
 *                    → cancelled
 *   (planned → cancelled is also valid)
 *
 * Public API:
 *   startMission(missionId)
 *   completeMission(missionId, opts)
 *   failMission(missionId, reason)
 *   cancelMission(missionId, reason)
 *   updateSubtaskStatus(missionId, subtaskId, status, output)
 *   getDependencyGraph(missionId)
 *   getExecutionTimeline(missionId)
 *   runtimeStatus()
 *   getActiveMission()
 */

const logger        = require("../../backend/utils/logger");
const memory        = require("../../backend/services/missionMemory.cjs");
const eventBus      = require("./runtimeEventBus.cjs");
const orchestrator  = require("./runtimeOrchestrator.cjs");

// Lazy-load heavy services to avoid circular dep issues at require time
let _reasoning = null;
let _planning  = null;

function _getReasoning() {
    if (!_reasoning) {
        try { _reasoning = require("../../backend/services/executiveReasoning.cjs"); } catch { _reasoning = null; }
    }
    return _reasoning;
}

function _getPlanning() {
    if (!_planning) {
        try { _planning = require("../../backend/services/autonomousPlanning.cjs"); } catch { _planning = null; }
    }
    return _planning;
}

// ── Valid state transitions ───────────────────────────────────────────────────
const TRANSITIONS = {
    planned:   new Set(["running", "cancelled"]),
    running:   new Set(["completed", "failed", "cancelled"]),
    completed: new Set(),
    failed:    new Set(["running"]),   // allow retry
    cancelled: new Set(),
};

function _canTransition(current, next) {
    return TRANSITIONS[current]?.has(next) ?? false;
}

// ── Event emission (wraps eventBus.emit with mission context) ────────────────
function _emit(type, missionId, payload = {}) {
    try {
        eventBus.emit(type, { missionId, ...payload, _ts: Date.now() });
    } catch (err) {
        logger.warn(`[MissionRuntime] Event emit failed (${type}): ${err.message}`);
    }
}

// ── State machine transition (core) ─────────────────────────────────────────
function _transition(missionId, nextStatus, patch = {}) {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const current = mission.status;
    if (current === nextStatus) return mission; // idempotent
    if (!_canTransition(current, nextStatus)) {
        throw new Error(`Invalid transition ${current} → ${nextStatus} for mission ${missionId}`);
    }

    const now = new Date().toISOString();
    const update = { status: nextStatus, ...patch };
    if (nextStatus === "running"   && !mission.startedAt)   update.startedAt   = now;
    if (nextStatus === "completed" || nextStatus === "failed" || nextStatus === "cancelled") {
        update.completedAt = now;
    }

    const updated = memory.updateMission(missionId, update);
    _emit(`mission:${nextStatus}`, missionId, {
        objective: updated.objective,
        priority:  updated.priority,
        metrics:   updated.metrics,
        reason:    patch.failureReason || patch.cancelReason || undefined,
    });

    return updated;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Transition mission from planned → running and emit live event.
 */
function startMission(missionId) {
    const mission = _transition(missionId, "running");
    logger.info(`[MissionRuntime] Started mission ${missionId}: "${mission.objective}"`);

    // Kick off any pending subtasks that have no dependencies
    const ready = _getReadySubtasks(mission);
    for (const st of ready) {
        _dispatchSubtask(missionId, st).catch(err => {
            logger.warn(`[MissionRuntime] Subtask dispatch failed ${st.id}: ${err.message}`);
        });
    }

    return mission;
}

/**
 * Transition mission from running → completed.
 */
function completeMission(missionId, opts = {}) {
    const mission = _transition(missionId, "completed", {
        summary: opts.summary || null,
    });
    logger.info(`[MissionRuntime] Completed mission ${missionId}`);
    return mission;
}

/**
 * Transition mission from running → failed.
 */
function failMission(missionId, reason = "Unknown failure") {
    memory.recordFailure(missionId, {
        description: reason,
        severity:    "critical",
        phase:       "execution",
        resolution:  "manual review required",
    });
    const mission = _transition(missionId, "failed", { failureReason: reason });
    logger.warn(`[MissionRuntime] Failed mission ${missionId}: ${reason}`);
    return mission;
}

/**
 * Cancel a mission (from planned or running).
 */
function cancelMission(missionId, reason = "Cancelled by operator") {
    const mission = _transition(missionId, "cancelled", { cancelReason: reason });
    logger.info(`[MissionRuntime] Cancelled mission ${missionId}: ${reason}`);
    return mission;
}

/**
 * Update a subtask's status and propagate progress events.
 * Auto-completes the mission if all subtasks are done.
 */
function updateSubtaskStatus(missionId, subtaskId, status, output = null) {
    const VALID = new Set(["pending", "running", "completed", "failed", "skipped"]);
    if (!VALID.has(status)) throw new Error(`Invalid subtask status: ${status}`);

    // Use missionMemory's updateMission to patch the subtask in-place
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const st = mission.subtasks.find(s => s.id === subtaskId);
    if (!st) throw new Error(`Subtask not found: ${subtaskId} in mission ${missionId}`);

    const now = new Date().toISOString();
    const patchedSubtasks = mission.subtasks.map(s => {
        if (s.id !== subtaskId) return s;
        const next = { ...s, status };
        if (status === "running"   && !s.startedAt)   next.startedAt   = now;
        if (status === "completed" || status === "failed") {
            next.completedAt = now;
            if (output !== null) next.output = output;
        }
        return next;
    });

    const updated = memory.updateMission(missionId, { subtasks: patchedSubtasks });

    _emit("mission:subtask:updated", missionId, {
        subtaskId,
        subtaskStatus: status,
        metrics: updated.metrics,
    });

    // Auto-check for mission completion
    if (status === "completed" || status === "failed") {
        _checkAutoComplete(updated);
    }

    return updated;
}

/**
 * Build dependency graph from subtask ids.
 * Each subtask may carry a `dependsOn: [subtaskId]` array.
 * Returns adjacency list: { [subtaskId]: { deps: string[], dependents: string[] } }
 */
function getDependencyGraph(missionId) {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const nodes = {};
    for (const st of mission.subtasks) {
        nodes[st.id] = {
            id:          st.id,
            description: st.description,
            status:      st.status,
            deps:        Array.isArray(st.dependsOn) ? [...st.dependsOn] : [],
            dependents:  [],
        };
    }

    // Build reverse edges
    for (const [id, node] of Object.entries(nodes)) {
        for (const dep of node.deps) {
            if (nodes[dep]) nodes[dep].dependents.push(id);
        }
    }

    // Topological sort (Kahn's algorithm) for execution order
    const order = [];
    const inDegree = {};
    for (const [id, node] of Object.entries(nodes)) inDegree[id] = node.deps.length;
    const queue = Object.keys(inDegree).filter(id => inDegree[id] === 0);

    while (queue.length > 0) {
        const id = queue.shift();
        order.push(id);
        for (const dep of nodes[id].dependents) {
            inDegree[dep]--;
            if (inDegree[dep] === 0) queue.push(dep);
        }
    }

    const hasCycle = order.length < Object.keys(nodes).length;

    return {
        missionId,
        objective: mission.objective,
        nodes,
        executionOrder: order,
        hasCycle,
        totalNodes:     Object.keys(nodes).length,
        completedNodes: Object.values(nodes).filter(n => n.status === "completed").length,
    };
}

/**
 * Get the full execution timeline for a mission (from missionMemory's timeline[]).
 */
function getExecutionTimeline(missionId) {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const durationMs = mission.completedAt && mission.startedAt
        ? new Date(mission.completedAt) - new Date(mission.startedAt)
        : mission.startedAt
            ? Date.now() - new Date(mission.startedAt)
            : null;

    return {
        missionId,
        objective:   mission.objective,
        status:      mission.status,
        startedAt:   mission.startedAt  || null,
        completedAt: mission.completedAt || null,
        durationMs,
        events:      mission.timeline || [],
        eventCount:  (mission.timeline || []).length,
        metrics:     mission.metrics,
    };
}

/**
 * Live runtime health snapshot.
 */
function runtimeStatus() {
    const stats      = memory.getMissionStats();
    const busMeta    = eventBus.metrics();
    const orchStatus = orchestrator.status();

    return {
        ts:              new Date().toISOString(),
        missions:        stats,
        eventBus:        busMeta,
        orchestrator: {
            active:       orchStatus.governor?.active ?? 0,
            queueDepth:   orchStatus.queue?.length ?? 0,
        },
    };
}

/**
 * Returns the first running mission, or the first planned mission if none running.
 */
function getActiveMission() {
    const { missions } = memory.listMissions({ status: "running", limit: 1 });
    if (missions.length > 0) return missions[0];
    const { missions: planned } = memory.listMissions({ status: "planned", limit: 1 });
    return planned[0] ?? null;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Return subtasks that are pending and whose dependencies are all completed.
 */
function _getReadySubtasks(mission) {
    const completedIds = new Set(
        mission.subtasks.filter(s => s.status === "completed").map(s => s.id)
    );
    return mission.subtasks.filter(st => {
        if (st.status !== "pending") return false;
        const deps = Array.isArray(st.dependsOn) ? st.dependsOn : [];
        return deps.every(dep => completedIds.has(dep));
    });
}

/**
 * Dispatch a subtask to the runtime orchestrator.
 */
async function _dispatchSubtask(missionId, subtask) {
    try {
        updateSubtaskStatus(missionId, subtask.id, "running");
        const result = await orchestrator.dispatch(subtask.description, {
            priority: "normal",
            metadata: { missionId, subtaskId: subtask.id },
        });
        const output = typeof result === "string" ? result : JSON.stringify(result);
        updateSubtaskStatus(missionId, subtask.id, "completed", output);

        // After completing one subtask, check if more are now unblocked
        const mission = memory.getMission(missionId);
        if (mission && mission.status === "running") {
            const ready = _getReadySubtasks(mission);
            for (const next of ready) {
                _dispatchSubtask(missionId, next).catch(err => {
                    logger.warn(`[MissionRuntime] Chained subtask dispatch failed ${next.id}: ${err.message}`);
                });
            }
        }
    } catch (err) {
        updateSubtaskStatus(missionId, subtask.id, "failed", err.message);
    }
}

/**
 * Check if all non-skipped subtasks are terminal and auto-complete or fail.
 */
function _checkAutoComplete(mission) {
    if (mission.status !== "running") return;
    if (mission.subtasks.length === 0) return;

    const terminal  = new Set(["completed", "failed", "skipped"]);
    const allDone   = mission.subtasks.every(s => terminal.has(s.status));
    if (!allDone) return;

    const anyFailed = mission.subtasks.some(s => s.status === "failed");
    if (anyFailed) {
        failMission(mission.id, "One or more subtasks failed");
    } else {
        completeMission(mission.id, { summary: "All subtasks completed successfully" });
    }
}

module.exports = {
    startMission,
    completeMission,
    failMission,
    cancelMission,
    updateSubtaskStatus,
    getDependencyGraph,
    getExecutionTimeline,
    runtimeStatus,
    getActiveMission,
};
