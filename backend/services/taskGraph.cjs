"use strict";
/**
 * TaskGraph — Shared task graph for the 7-specialist agent pipeline.
 *
 * Pipeline:  Planner → Developer → Reviewer → Tester → Security → DevOps → Operator
 *
 * A graph decomposes a top-level goal into a directed-acyclic graph (DAG) of
 * task nodes, each assigned to the appropriate specialist agent.  Nodes are
 * executed in topological order; each node receives the merged outputs of its
 * predecessors as context before dispatch.  Agent-to-agent transitions use
 * multiAgentCoordinator.handoff().
 *
 * Failure handling
 *   - If a node's assigned agent fails, the node is delegated to the next
 *     capable agent in the pipeline (first one that has all required caps).
 *   - If delegation also fails the node moves to status="escalated" and the
 *     graph is paused (status="paused").
 *
 * Public API:
 *   createGraph(goal, opts)        → { graphId, nodes[], edges[], status }
 *   executeGraph(graphId)          → { graphId, status, results[] }
 *   getGraph(graphId)              → Graph | null
 *   listGraphs(opts)               → { graphs[], total, stats }
 *   cancelGraph(graphId)           → { graphId, status }
 *   getGraphStats()                → { total, completed, failed, escalated, avgDurationMs }
 *
 * Persists to data/task-graphs.json (max 500 graphs, atomic write).
 */

const fs      = require("fs");
const path    = require("path");
const logger  = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");
const execLog  = require("../utils/execLog.cjs");

// ── External service wiring ─────────────────────────────────────────────────
// Loaded lazily to avoid circular-require issues at module init time.
let _mac = null;
let _aee = null;

function _getMAC() {
    if (!_mac) {
        try { _mac = require("./multiAgentCoordinator.cjs"); } catch { _mac = null; }
    }
    return _mac;
}

function _getAEE() {
    if (!_aee) {
        try { _aee = require("./agentExecutionEngine.cjs"); } catch { _aee = null; }
    }
    return _aee;
}

// ── Persistence ─────────────────────────────────────────────────────────────
const GRAPH_FILE = path.join(__dirname, "../../data/task-graphs.json");
const MAX_GRAPHS = 500;

function _rj(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function _wj(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

let _graphs = _rj(GRAPH_FILE, []);
let _gseq   = _graphs.length;

function _gid()  { return `graph_${Date.now()}_${(++_gseq).toString(36)}`; }
function _nid(i) { return `node_${i}`; }

function _save() {
    try { _wj(GRAPH_FILE, _graphs.slice(-MAX_GRAPHS)); } catch { /* non-fatal */ }
}

// ── Specialist agent definitions ────────────────────────────────────────────
/**
 * The 7-stage pipeline, in execution order.
 * Each entry declares:
 *   id          — agent identifier used for dispatch
 *   name        — human-readable label
 *   capabilities— skills this agent can perform
 *   position    — 0-based pipeline index (topological layer default)
 *   prompt      — role hint prepended to node input when dispatching
 */
const PIPELINE = [
    {
        id:           "planner",
        name:         "Planner Agent",
        position:     0,
        capabilities: ["goal_decompose", "task_plan", "dependency_map", "priority_assign"],
        prompt:       "You are the Planner agent. Decompose the goal into clear, ordered subtasks and identify dependencies.",
    },
    {
        id:           "developer",
        name:         "Developer Agent",
        position:     1,
        capabilities: ["code_write", "code_refactor", "pr_create", "api_design"],
        prompt:       "You are the Developer agent. Implement the task according to the plan produced by the Planner.",
    },
    {
        id:           "reviewer",
        name:         "Reviewer Agent",
        position:     2,
        capabilities: ["code_review", "pr_review", "style_check", "logic_verify"],
        prompt:       "You are the Reviewer agent. Critique the implementation for correctness, style and completeness.",
    },
    {
        id:           "tester",
        name:         "Tester Agent",
        position:     3,
        capabilities: ["test_write", "test_run", "coverage_check", "regression_check"],
        prompt:       "You are the Tester agent. Write and execute tests to validate the implementation.",
    },
    {
        id:           "security",
        name:         "Security Agent",
        position:     4,
        capabilities: ["vulnerability_scan", "secret_detect", "dep_audit", "security_review"],
        prompt:       "You are the Security agent. Audit the implementation for vulnerabilities, secrets and dependency risks.",
    },
    {
        id:           "devops",
        name:         "DevOps Agent",
        position:     5,
        capabilities: ["deploy", "ci_configure", "monitor", "infra_provision", "incident_resolve"],
        prompt:       "You are the DevOps agent. Prepare CI/CD pipelines, deploy the change and verify it is running.",
    },
    {
        id:           "operator",
        name:         "Operator Agent",
        position:     6,
        capabilities: ["task_dispatch", "escalate", "incident_triage", "queue_drain", "status_report"],
        prompt:       "You are the Operator agent. Confirm operational readiness, close the loop and produce a final status summary.",
    },
];

// Quick lookup maps
const _byId  = Object.fromEntries(PIPELINE.map(a => [a.id, a]));
const _byPos = Object.fromEntries(PIPELINE.map(a => [a.position, a]));

/** Return the first agent after position `pos` that has all `caps`. */
function _nextCapable(afterPos, caps = []) {
    for (let p = afterPos + 1; p < PIPELINE.length; p++) {
        const agent = _byPos[p];
        if (!agent) continue;
        const hasCaps = caps.every(c => agent.capabilities.includes(c));
        if (hasCaps) return agent;
    }
    return null;
}

// ── Node / Graph schema helpers ─────────────────────────────────────────────
/**
 * Node statuses: pending → running → completed | failed | escalated | skipped
 * Graph statuses: pending → running → completed | failed | paused | cancelled
 */
function _makeNode(index, agentId, task, requiredCaps = []) {
    return {
        nodeId:           _nid(index),
        index,
        agentId,
        task:             task.slice(0, 600),
        requiredCaps,
        status:           "pending",
        startedAt:        null,
        completedAt:      null,
        durationMs:       null,
        input:            null,        // full composed input sent to agent
        predecessorOutputs: [],        // [{ nodeId, agentId, output }]
        output:           null,
        error:            null,
        delegatedTo:      null,        // agentId if we fell back to another agent
        runId:            null,        // AEE run id
        sessionId:        null,        // MAC session id for handoff
        retryCount:       0,
    };
}

function _makeGraph(graphId, goal, nodes, edges, opts = {}) {
    return {
        graphId,
        goal:        goal.slice(0, 500),
        status:      "pending",
        createdAt:   new Date().toISOString(),
        startedAt:   null,
        completedAt: null,
        durationMs:  null,
        nodes,
        edges,        // [{ from: nodeId, to: nodeId }]
        output:       null,
        error:        null,
        metadata:     opts.metadata || {},
        cancelledAt:  null,
    };
}

// ── Goal decomposition ──────────────────────────────────────────────────────
/**
 * Decompose `goal` into a default linear pipeline with optional extra nodes
 * injected by `opts.steps` (array of { agentId, task } overrides).
 *
 * Default: one node per pipeline stage in order, each depending on the
 * previous.  If `opts.steps` is supplied it replaces the default tasks
 * while still using the pipeline ordering.
 *
 * Returns { nodes[], edges[] }.
 */
function _decompose(goal, opts = {}) {
    const customSteps = Array.isArray(opts.steps) ? opts.steps : [];

    // Build node list — one per pipeline stage
    const nodes = PIPELINE.map((agent, i) => {
        const custom = customSteps.find(s => s.agentId === agent.id);
        const task   = custom
            ? custom.task
            : _defaultTask(agent, goal, i);
        const caps   = custom && custom.requiredCaps ? custom.requiredCaps : agent.capabilities.slice(0, 2);
        return _makeNode(i, agent.id, task, caps);
    });

    // Linear DAG: each node depends on the previous
    const edges = [];
    for (let i = 1; i < nodes.length; i++) {
        edges.push({ from: nodes[i - 1].nodeId, to: nodes[i].nodeId });
    }

    return { nodes, edges };
}

function _defaultTask(agent, goal, position) {
    const tasks = [
        `Analyze and decompose this goal into an ordered task plan with dependencies: "${goal}"`,
        `Implement the following based on the Planner's task plan. Goal: "${goal}"`,
        `Review the Developer's implementation for the goal: "${goal}". Identify issues and provide feedback.`,
        `Write and execute tests to validate the implementation for: "${goal}". Report coverage and failures.`,
        `Security-audit the implementation for: "${goal}". Identify vulnerabilities and secrets.`,
        `Set up CI/CD and deploy the validated implementation for: "${goal}". Confirm it is live.`,
        `Confirm operational status, document outcomes and produce a final summary for: "${goal}"`,
    ];
    return tasks[position] || `Handle pipeline stage ${position} for: "${goal}"`;
}

// ── Topological sort ────────────────────────────────────────────────────────
/**
 * Returns nodes in execution order respecting edges.
 * Uses Kahn's algorithm.  Throws if a cycle is detected.
 */
function _topoSort(nodes, edges) {
    const inDegree = Object.fromEntries(nodes.map(n => [n.nodeId, 0]));
    const adj      = Object.fromEntries(nodes.map(n => [n.nodeId, []]));

    for (const e of edges) {
        adj[e.from].push(e.to);
        inDegree[e.to] = (inDegree[e.to] || 0) + 1;
    }

    const queue  = nodes.filter(n => inDegree[n.nodeId] === 0).map(n => n.nodeId);
    const result = [];

    while (queue.length) {
        const nid  = queue.shift();
        const node = nodes.find(n => n.nodeId === nid);
        result.push(node);
        for (const next of adj[nid]) {
            inDegree[next]--;
            if (inDegree[next] === 0) queue.push(next);
        }
    }

    if (result.length !== nodes.length) {
        throw new Error("Task graph contains a cycle — cannot execute");
    }
    return result;
}

/** Collect direct predecessor nodes for a given nodeId. */
function _predecessors(nodeId, edges, nodes) {
    const predIds = edges.filter(e => e.to === nodeId).map(e => e.from);
    return predIds.map(id => nodes.find(n => n.nodeId === id)).filter(Boolean);
}

// ── Node execution ──────────────────────────────────────────────────────────
/**
 * Execute a single graph node.  Builds composed input from predecessorOutputs,
 * dispatches via AEE (+ MAC handoff for agent transitions), handles
 * failure → delegation → escalation.
 *
 * Returns the mutated node.
 */
async function _executeNode(node, graph) {
    if (graph.status === "cancelled") {
        node.status = "skipped";
        return node;
    }

    // Build predecessor context
    const predNodes = _predecessors(node.nodeId, graph.edges, graph.nodes);
    node.predecessorOutputs = predNodes.map(p => ({
        nodeId:  p.nodeId,
        agentId: p.agentId,
        output:  p.output || "",
    }));

    const predCtx = node.predecessorOutputs.length
        ? "\n\n--- Predecessor Outputs ---\n" +
          node.predecessorOutputs.map(p => `[${p.agentId}]: ${p.output}`).join("\n\n")
        : "";

    const agent = _byId[node.agentId];
    const rolePrompt = agent ? agent.prompt : "";
    node.input = `${rolePrompt}\n\nTask: ${node.task}${predCtx}`;
    node.status    = "running";
    node.startedAt = new Date().toISOString();
    _save();

    auditLog.append({
        type:    "graph_node_start",
        graphId: graph.graphId,
        nodeId:  node.nodeId,
        agentId: node.agentId,
    });

    // ── Primary dispatch ─────────────────────────────────────────────────
    let result = await _dispatchNode(node, graph, node.agentId);

    // ── Delegation on failure ────────────────────────────────────────────
    if (!result.success) {
        const currentPos   = agent ? agent.position : PIPELINE.length;
        const delegatee    = _nextCapable(currentPos, node.requiredCaps);

        if (delegatee) {
            logger.warn(`[TaskGraph] Node ${node.nodeId} delegating from ${node.agentId} to ${delegatee.id}`);
            auditLog.append({
                type:    "graph_node_delegate",
                graphId: graph.graphId,
                nodeId:  node.nodeId,
                from:    node.agentId,
                to:      delegatee.id,
            });
            node.delegatedTo  = delegatee.id;
            node.retryCount   = (node.retryCount || 0) + 1;
            result = await _dispatchNode(node, graph, delegatee.id);
        }

        // ── Escalation if delegation also failed ─────────────────────────
        if (!result.success) {
            node.status      = "escalated";
            node.error       = result.error || "Both primary agent and delegate failed";
            node.completedAt = new Date().toISOString();
            node.durationMs  = Date.now() - new Date(node.startedAt).getTime();
            _save();
            auditLog.append({
                type:    "graph_node_escalated",
                graphId: graph.graphId,
                nodeId:  node.nodeId,
                error:   node.error,
            });
            return node;
        }
    }

    // ── Success path ─────────────────────────────────────────────────────
    node.status      = "completed";
    node.output      = (result.output || "").slice(0, 2000);
    node.runId       = result.runId  || null;
    node.sessionId   = result.sessionId || null;
    node.completedAt = new Date().toISOString();
    node.durationMs  = Date.now() - new Date(node.startedAt).getTime();
    node.error       = null;
    _save();

    auditLog.append({
        type:    "graph_node_complete",
        graphId: graph.graphId,
        nodeId:  node.nodeId,
        agentId: node.agentId,
        durationMs: node.durationMs,
    });

    return node;
}

/**
 * Dispatch a node to a specific agent.
 * Uses MAC.handoff() when there is a predecessor (agent-to-agent transition)
 * otherwise uses AEE.executeTask() directly.
 *
 * Returns { success, output, runId, sessionId, error }.
 */
async function _dispatchNode(node, graph, targetAgentId) {
    const aee = _getAEE();
    const mac = _getMAC();

    const predIds = graph.edges.filter(e => e.to === node.nodeId).map(e => e.from);

    try {
        // If we have predecessor nodes that completed, use a handoff chain
        if (predIds.length > 0 && mac) {
            const lastPredNode = graph.nodes
                .filter(n => predIds.includes(n.nodeId) && n.status === "completed")
                .sort((a, b) => (a.index || 0) - (b.index || 0))
                .pop();

            if (lastPredNode) {
                const fromAgentId = lastPredNode.delegatedTo || lastPredNode.agentId;
                const r = await mac.handoff(fromAgentId, targetAgentId, node.input, {
                    metadata: { graphId: graph.graphId, nodeId: node.nodeId },
                    timeoutMs: 45_000,
                });
                return {
                    success:   r.success,
                    output:    r.output || "",
                    runId:     null,
                    sessionId: r.sessionId,
                    error:     r.error || null,
                };
            }
        }

        // No predecessor or MAC unavailable — direct AEE dispatch
        if (aee) {
            const r = await aee.executeTask(targetAgentId, node.input, {
                type:      "graph_node",
                timeoutMs: 45_000,
                metadata:  { graphId: graph.graphId, nodeId: node.nodeId },
            });
            return {
                success:   r.success,
                output:    r.output || "",
                runId:     r.runId,
                sessionId: null,
                error:     r.error || null,
            };
        }

        // Final fallback — runtimeOrchestrator
        const orc = require("../../agents/runtime/runtimeOrchestrator.cjs");
        const r   = await orc.dispatch(`[Agent: ${targetAgentId}] ${node.input}`, {
            timeoutMs: 45_000,
            retries:   0,
            meta:      { graphId: graph.graphId, nodeId: node.nodeId },
        });
        return {
            success:   r.success,
            output:    r.reply || r.output || "",
            runId:     null,
            sessionId: null,
            error:     r.error || null,
        };

    } catch (err) {
        return {
            success:   false,
            output:    null,
            runId:     null,
            sessionId: null,
            error:     err.message,
        };
    }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * createGraph(goal, opts) → { graphId, nodes[], edges[], status }
 *
 * opts:
 *   steps[]   — override per-agent tasks: [{ agentId, task, requiredCaps? }]
 *   metadata  — arbitrary object stored on the graph
 *   skipAgents[] — agent ids to skip (their nodes marked "skipped")
 */
function createGraph(goal, opts = {}) {
    if (!goal || typeof goal !== "string" || !goal.trim()) {
        throw new Error("goal must be a non-empty string");
    }

    const graphId       = _gid();
    const { nodes, edges } = _decompose(goal.trim(), opts);

    // Apply skip list
    if (Array.isArray(opts.skipAgents)) {
        for (const node of nodes) {
            if (opts.skipAgents.includes(node.agentId)) {
                node.status = "skipped";
            }
        }
    }

    const graph = _makeGraph(graphId, goal.trim(), nodes, edges, opts);
    _graphs.push(graph);
    _save();

    auditLog.append({ type: "graph_created", graphId, goal: goal.slice(0, 100), nodeCount: nodes.length });
    logger.info(`[TaskGraph] Created graph ${graphId} — ${nodes.length} nodes for goal: "${goal.slice(0, 80)}"`);

    return { graphId, nodes, edges, status: graph.status };
}

/**
 * executeGraph(graphId) → { graphId, status, results[] }
 *
 * Runs nodes in topological order.  Pauses if any node escalates.
 * results[] mirrors the nodes array with live status/output.
 */
async function executeGraph(graphId) {
    const graph = _graphs.find(g => g.graphId === graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);

    if (graph.status === "cancelled") {
        return { graphId, status: "cancelled", results: graph.nodes };
    }
    if (graph.status === "completed") {
        return { graphId, status: "completed", results: graph.nodes };
    }
    if (graph.status === "running") {
        throw new Error(`Graph ${graphId} is already running`);
    }

    graph.status    = "running";
    graph.startedAt = new Date().toISOString();
    _save();

    auditLog.append({ type: "graph_start", graphId, goal: graph.goal.slice(0, 100) });
    execLog.append({ agentId: "TaskGraph", taskType: "graph_execute", taskId: graphId, success: null, durationMs: 0 });

    let ordered;
    try {
        ordered = _topoSort(graph.nodes, graph.edges);
    } catch (err) {
        graph.status = "failed";
        graph.error  = err.message;
        graph.completedAt = new Date().toISOString();
        graph.durationMs  = Date.now() - new Date(graph.startedAt).getTime();
        _save();
        return { graphId, status: "failed", error: err.message, results: graph.nodes };
    }

    for (const node of ordered) {
        // Already handled (skipped before execution started, or graph cancelled)
        if (node.status === "skipped" || graph.status === "cancelled") {
            if (node.status !== "skipped") node.status = "skipped";
            continue;
        }

        await _executeNode(node, graph);

        if (node.status === "escalated") {
            graph.status = "paused";
            graph.error  = `Graph paused — node ${node.nodeId} (${node.agentId}) escalated: ${node.error}`;
            _save();
            auditLog.append({ type: "graph_paused", graphId, nodeId: node.nodeId });
            logger.warn(`[TaskGraph] Graph ${graphId} paused due to escalation at node ${node.nodeId}`);
            return { graphId, status: "paused", error: graph.error, results: graph.nodes };
        }
    }

    // Determine final status
    const hasFailures  = graph.nodes.some(n => n.status === "failed");
    const hasEscalated = graph.nodes.some(n => n.status === "escalated");
    const allDone      = graph.nodes.every(n => ["completed", "skipped", "escalated", "failed"].includes(n.status));

    graph.status      = hasEscalated ? "paused" : (hasFailures ? "failed" : "completed");
    graph.completedAt = new Date().toISOString();
    graph.durationMs  = Date.now() - new Date(graph.startedAt).getTime();

    // Capture the final operator node output as graph-level output
    const lastComplete = [...graph.nodes].reverse().find(n => n.status === "completed");
    graph.output = lastComplete ? (lastComplete.output || "").slice(0, 2000) : null;

    _save();

    auditLog.append({
        type:       "graph_complete",
        graphId,
        status:     graph.status,
        durationMs: graph.durationMs,
    });
    execLog.append({
        agentId:    "TaskGraph",
        taskType:   "graph_execute",
        taskId:     graphId,
        success:    graph.status === "completed",
        durationMs: graph.durationMs,
    });
    logger.info(`[TaskGraph] Graph ${graphId} finished with status="${graph.status}" in ${graph.durationMs}ms`);

    return { graphId, status: graph.status, durationMs: graph.durationMs, results: graph.nodes, output: graph.output };
}

/**
 * getGraph(graphId) → Graph | null
 */
function getGraph(graphId) {
    return _graphs.find(g => g.graphId === graphId) || null;
}

/**
 * listGraphs({ status, limit, offset }) → { graphs[], total, stats }
 */
function listGraphs({ status, limit = 50, offset = 0 } = {}) {
    let rows = [..._graphs].reverse();
    if (status) rows = rows.filter(g => g.status === status);

    const total = rows.length;
    const stats = _computeStats();

    return { graphs: rows.slice(offset, offset + limit), total, stats };
}

/**
 * cancelGraph(graphId) → { graphId, status }
 */
function cancelGraph(graphId) {
    const graph = _graphs.find(g => g.graphId === graphId);
    if (!graph) throw new Error(`Graph ${graphId} not found`);
    if (["completed", "failed", "cancelled"].includes(graph.status)) {
        return { graphId, status: graph.status };
    }

    graph.status      = "cancelled";
    graph.cancelledAt = new Date().toISOString();
    // Mark any pending/running nodes as skipped
    for (const node of graph.nodes) {
        if (["pending", "running"].includes(node.status)) {
            node.status = "skipped";
        }
    }
    _save();
    auditLog.append({ type: "graph_cancelled", graphId });
    logger.info(`[TaskGraph] Graph ${graphId} cancelled`);
    return { graphId, status: "cancelled" };
}

/**
 * getGraphStats() → { total, completed, failed, escalated, paused, running, pending, avgDurationMs }
 */
function getGraphStats() {
    return _computeStats();
}

function _computeStats() {
    const all       = _graphs;
    const completed = all.filter(g => g.status === "completed");
    const failed    = all.filter(g => g.status === "failed");
    const escalated = all.filter(g => g.nodes && g.nodes.some(n => n.status === "escalated"));
    const done      = all.filter(g => g.durationMs != null);
    const avgDurationMs = done.length
        ? Math.round(done.reduce((s, g) => s + g.durationMs, 0) / done.length)
        : 0;

    return {
        total:          all.length,
        completed:      completed.length,
        failed:         failed.length,
        escalated:      escalated.length,
        paused:         all.filter(g => g.status === "paused").length,
        running:        all.filter(g => g.status === "running").length,
        pending:        all.filter(g => g.status === "pending").length,
        cancelled:      all.filter(g => g.status === "cancelled").length,
        avgDurationMs,
        successRate:    all.length
            ? Math.round(completed.length / all.length * 100)
            : 0,
    };
}

// ── Module exports ──────────────────────────────────────────────────────────
module.exports = {
    // Core lifecycle
    createGraph,
    executeGraph,
    getGraph,
    listGraphs,
    cancelGraph,
    getGraphStats,

    // Pipeline metadata (useful for callers that want to inspect agent definitions)
    PIPELINE,
};
