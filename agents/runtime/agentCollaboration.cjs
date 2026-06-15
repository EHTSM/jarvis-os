"use strict";
/**
 * agentCollaboration.cjs — J2 Agent Collaboration Runtime
 *
 * Thin orchestration layer over existing infrastructure:
 *   taskGraph.cjs             — 7-agent pipeline (PIPELINE), graph execution, node status
 *   multiAgentCoordinator.cjs — handoff, delegate, collaborate sessions
 *   missionRuntime.cjs        — mission state machine, subtask dispatch
 *   missionMemory.cjs         — authoritative mission storage
 *   runtimeEventBus.cjs       — SSE fan-out for live progress
 *   agentExecutionEngine.cjs  — per-agent run history
 *
 * No new storage files. Conversation threads are stored directly on mission
 * objects via missionMemory.updateMission({ _collab: ... }).
 *
 * Public API:
 *   getConversation(missionId)              → { missionId, thread[], graphId? }
 *   postMessage(missionId, from, to, body, opts) → message record
 *   overrideAgent(missionId, agentId, instruction, operatorId) → result
 *   claimTask(taskId, agentId)              → { taskId, agentId, claimedAt }
 *   delegateTask(taskId, fromAgentId, toAgentId, reason) → delegation record
 *   getAgentStatus(missionId)               → agent status matrix
 *   getDelegationLog(missionId)             → delegation events[]
 */

const logger  = require("../../backend/utils/logger");
const memory  = require("../../backend/services/missionMemory.cjs");
const eventBus = require("./runtimeEventBus.cjs");

// Lazy loads to avoid circular dependencies
let _tg  = null;
let _mac = null;
let _aee = null;
let _mr  = null;

function _getTG()  { if (!_tg)  { try { _tg  = require("../../backend/services/taskGraph.cjs");              } catch {} } return _tg;  }
function _getMAC() { if (!_mac) { try { _mac = require("../../backend/services/multiAgentCoordinator.cjs");   } catch {} } return _mac; }
function _getAEE() { if (!_aee) { try { _aee = require("../../backend/services/agentExecutionEngine.cjs");    } catch {} } return _aee; }
function _getMR()  { if (!_mr)  { try { _mr  = require("./missionRuntime.cjs");                               } catch {} } return _mr;  }

// ── Collaboration state on mission object ────────────────────────────────────
// We store _collab: { thread, delegations, claims, graphId } on mission metadata
// via missionMemory.updateMission so no extra file is needed.

function _getCollab(mission) {
    return mission._collab || { thread: [], delegations: [], claims: {}, graphId: null };
}

function _saveCollab(missionId, collab) {
    memory.updateMission(missionId, { _collab: collab });
}

// ── Message ID ────────────────────────────────────────────────────────────────
let _msgSeq = 0;
function _msgId() {
    return `msg_${Date.now()}_${(++_msgSeq).toString(36)}`;
}

// ── Emit helper ───────────────────────────────────────────────────────────────
function _emit(type, missionId, payload = {}) {
    try { eventBus.emit(type, { missionId, ...payload, _ts: Date.now() }); } catch {}
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Return the full conversation thread for a mission.
 * Thread entries: { id, from, to, body, type, ts, metadata }
 *
 * type: "message" | "delegation" | "feedback" | "approval" | "override" | "claim"
 */
function getConversation(missionId) {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    const collab = _getCollab(mission);

    // Enrich with graph nodes if a graph exists
    let graphNodes = null;
    if (collab.graphId) {
        const tg    = _getTG();
        const graph = tg ? tg.getGraph(collab.graphId) : null;
        if (graph) graphNodes = graph.nodes;
    }

    return {
        missionId,
        objective: mission.objective,
        status:    mission.status,
        graphId:   collab.graphId || null,
        thread:    collab.thread,
        graphNodes,
    };
}

/**
 * Post a message from one agent/operator to another, appending to the thread.
 *
 * opts: { type, metadata }
 *   type: "message" | "feedback" | "approval" | "override"
 */
function postMessage(missionId, from, to, body, opts = {}) {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const entry = {
        id:       _msgId(),
        from:     String(from),
        to:       String(to),
        body:     String(body).slice(0, 2000),
        type:     opts.type || "message",
        ts:       new Date().toISOString(),
        metadata: opts.metadata || {},
    };

    const collab = _getCollab(mission);
    collab.thread.push(entry);
    // Cap thread at 500 messages
    if (collab.thread.length > 500) collab.thread = collab.thread.slice(-500);
    _saveCollab(missionId, collab);

    _emit("agent:message", missionId, { from, to, type: entry.type, messageId: entry.id });
    logger.info(`[AgentCollab] [${missionId}] ${from} → ${to}: ${body.slice(0, 80)}`);

    return entry;
}

/**
 * Operator override: inject an instruction for a specific agent mid-mission.
 * Posts an override message, records it in the delegation log, and if the
 * mission has a running graph, emits an event that observers can act on.
 */
async function overrideAgent(missionId, agentId, instruction, operatorId = "operator") {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    // Post the override as a conversation message
    const msg = postMessage(missionId, operatorId, agentId, instruction, {
        type:     "override",
        metadata: { operatorId, agentId },
    });

    // Record in delegation log
    const collab = _getCollab(mission);
    collab.delegations.push({
        id:        _msgId(),
        type:      "override",
        from:      operatorId,
        to:        agentId,
        reason:    instruction.slice(0, 200),
        ts:        msg.ts,
        messageId: msg.id,
    });
    _saveCollab(missionId, collab);

    _emit("agent:override", missionId, { agentId, operatorId, instruction: instruction.slice(0, 100) });
    logger.info(`[AgentCollab] Operator override → ${agentId} in mission ${missionId}`);

    // If AEE available, dispatch the override instruction to the target agent
    const aee = _getAEE();
    let dispatchResult = null;
    if (aee) {
        try {
            dispatchResult = await aee.executeTask(agentId, `[OPERATOR OVERRIDE] ${instruction}`, {
                type:     "operator_override",
                metadata: { missionId, operatorId },
            });
        } catch (err) {
            logger.warn(`[AgentCollab] Override dispatch failed: ${err.message}`);
        }
    }

    return { message: msg, dispatchResult };
}

/**
 * Agent claims a task (signals intent to work on it).
 */
function claimTask(taskId, agentId) {
    // Tasks are stored on mission subtasks — find the mission
    const { missions } = memory.listMissions({ limit: 200 });
    let targetMission  = null;
    for (const m of missions) {
        if (m.subtasks && m.subtasks.find(s => s.id === taskId)) {
            targetMission = m;
            break;
        }
    }
    if (!targetMission) throw new Error(`Task not found: ${taskId}`);

    const collab       = _getCollab(targetMission);
    collab.claims[taskId] = { agentId, claimedAt: new Date().toISOString() };
    _saveCollab(targetMission.id, collab);

    // Post claim message to thread
    postMessage(targetMission.id, agentId, "runtime", `Claiming task ${taskId}`, {
        type:     "claim",
        metadata: { taskId },
    });

    _emit("agent:claim", targetMission.id, { taskId, agentId });
    return { taskId, agentId, missionId: targetMission.id, claimedAt: collab.claims[taskId].claimedAt };
}

/**
 * Delegate a task from one agent to another.
 * Uses multiAgentCoordinator.handoff() if both agents are in the pipeline.
 */
async function delegateTask(taskId, fromAgentId, toAgentId, reason = "") {
    // Locate the mission that contains this task
    const { missions } = memory.listMissions({ limit: 200 });
    let targetMission  = null;
    let subtask        = null;
    for (const m of missions) {
        const st = m.subtasks && m.subtasks.find(s => s.id === taskId);
        if (st) { targetMission = m; subtask = st; break; }
    }
    if (!targetMission) throw new Error(`Task not found: ${taskId}`);

    // Post delegation message
    const msg = postMessage(targetMission.id, fromAgentId, toAgentId,
        `Delegating task: ${subtask.description}. Reason: ${reason}`, {
        type:     "delegation",
        metadata: { taskId, reason },
    });

    const collab = _getCollab(targetMission);
    const delegation = {
        id:        _msgId(),
        type:      "delegation",
        taskId,
        from:      fromAgentId,
        to:        toAgentId,
        reason:    reason.slice(0, 200),
        ts:        msg.ts,
        messageId: msg.id,
        status:    "pending",
    };
    collab.delegations.push(delegation);
    _saveCollab(targetMission.id, collab);

    _emit("agent:delegation", targetMission.id, { taskId, from: fromAgentId, to: toAgentId, reason });

    // Wire through multiAgentCoordinator if available
    const mac = _getMAC();
    let handoffResult = null;
    if (mac) {
        try {
            handoffResult = await mac.handoff(fromAgentId, toAgentId,
                `[Delegated task ${taskId}] ${subtask.description}`, {
                timeoutMs: 30_000,
                metadata:  { missionId: targetMission.id, taskId },
            });
            delegation.status    = handoffResult.success ? "completed" : "failed";
            delegation.sessionId = handoffResult.sessionId || null;
        } catch (err) {
            delegation.status = "failed";
            delegation.error  = err.message;
            logger.warn(`[AgentCollab] Delegation handoff failed: ${err.message}`);
        }
        _saveCollab(targetMission.id, collab);
    }

    return { delegation, handoffResult };
}

/**
 * Returns the agent status matrix for a mission.
 * Combines pipeline positions, graph node statuses, run history, claims.
 */
function getAgentStatus(missionId) {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const collab = _getCollab(mission);
    const tg     = _getTG();
    const aee    = _getAEE();

    // Graph node status per agent
    const graphNodesByAgent = {};
    if (collab.graphId && tg) {
        const graph = tg.getGraph(collab.graphId);
        if (graph) {
            for (const node of graph.nodes) {
                graphNodesByAgent[node.agentId] = {
                    nodeId:      node.nodeId,
                    nodeStatus:  node.status,
                    durationMs:  node.durationMs,
                    delegatedTo: node.delegatedTo,
                    error:       node.error,
                };
            }
        }
    }

    // Run history counts per agent (last 50 runs)
    const runStatsByAgent = {};
    if (aee) {
        try {
            const { agents } = aee.listAgents ? aee.listAgents() : { agents: [] };
            for (const a of agents) {
                const history = aee.getHistory(a.id, { limit: 50 });
                runStatsByAgent[a.id] = history.stats || {};
            }
        } catch {}
    }

    // Claims
    const claims = collab.claims || {};

    // Build matrix from canonical PIPELINE
    const pipeline = tg ? tg.PIPELINE : [];
    const matrix   = pipeline.map(agent => ({
        id:          agent.id,
        name:        agent.name,
        position:    agent.position,
        capabilities: agent.capabilities,
        nodeStatus:  graphNodesByAgent[agent.id]?.nodeStatus || "idle",
        nodeId:      graphNodesByAgent[agent.id]?.nodeId     || null,
        durationMs:  graphNodesByAgent[agent.id]?.durationMs || null,
        delegatedTo: graphNodesByAgent[agent.id]?.delegatedTo || null,
        error:       graphNodesByAgent[agent.id]?.error       || null,
        runStats:    runStatsByAgent[agent.id] || null,
        claimedTasks: Object.entries(claims)
            .filter(([, c]) => c.agentId === agent.id)
            .map(([taskId, c]) => ({ taskId, claimedAt: c.claimedAt })),
    }));

    return {
        missionId,
        objective:  mission.objective,
        status:     mission.status,
        graphId:    collab.graphId || null,
        matrix,
        updatedAt:  new Date().toISOString(),
    };
}

/**
 * Returns the delegation event log for a mission.
 */
function getDelegationLog(missionId) {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    const collab = _getCollab(mission);
    return {
        missionId,
        objective:   mission.objective,
        delegations: collab.delegations || [],
        total:       (collab.delegations || []).length,
    };
}

/**
 * Start a collaboration session for a mission — creates a task graph
 * and links it to the mission. Idempotent: if a graph already exists, returns it.
 */
async function startCollaboration(missionId, opts = {}) {
    const mission = memory.getMission(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const collab = _getCollab(mission);
    if (collab.graphId) {
        const tg    = _getTG();
        const graph = tg ? tg.getGraph(collab.graphId) : null;
        return { missionId, graphId: collab.graphId, graph, reused: true };
    }

    const tg = _getTG();
    if (!tg) throw new Error("TaskGraph service unavailable");

    const { graphId } = tg.createGraph(mission.objective, {
        steps:    opts.steps || [],
        metadata: { missionId },
    });

    collab.graphId = graphId;
    // Seed the thread with a system message
    collab.thread.push({
        id:   _msgId(),
        from: "system",
        to:   "all",
        body: `Collaboration started for mission: "${mission.objective}"`,
        type: "message",
        ts:   new Date().toISOString(),
        metadata: { graphId },
    });
    _saveCollab(missionId, collab);

    _emit("agent:collaboration:start", missionId, { graphId, objective: mission.objective });
    logger.info(`[AgentCollab] Started collaboration for mission ${missionId}, graph ${graphId}`);

    return { missionId, graphId, reused: false };
}

module.exports = {
    getConversation,
    postMessage,
    overrideAgent,
    claimTask,
    delegateTask,
    getAgentStatus,
    getDelegationLog,
    startCollaboration,
};
