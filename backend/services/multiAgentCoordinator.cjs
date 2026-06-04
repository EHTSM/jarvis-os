"use strict";
/**
 * MultiAgentCoordinator — agent handoff, delegation, collaboration and
 * shared task execution across the agent pool.
 *
 * Model: a Coordination Session is a unit of work that involves ≥2 agents.
 * Sessions go through: plan → executing → completed|failed.
 *
 * Patterns:
 *   handoff     — agent A finishes, passes output to agent B
 *   delegation  — orchestrator agent breaks a goal into sub-tasks and assigns
 *                 each to a specialist agent
 *   collaboration — two agents run in parallel; results are merged by a
 *                   reducer function
 *
 * Persists full session history to data/coordination-sessions.json.
 *
 * Public API:
 *   handoff(fromAgentId, toAgentId, context, opts)     → { sessionId, ... }
 *   delegate(orchestratorId, subtasks[], opts)         → { sessionId, ... }
 *   collaborate(agentIds[], sharedInput, opts)         → { sessionId, ... }
 *   getSession(sessionId)                               → Session
 *   listSessions(opts)                                  → { sessions[], stats }
 *   getCoordinationStats()                              → stats object
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");
const auditLog = require("../utils/auditLog.cjs");
const execLog  = require("../utils/execLog.cjs");

const SESSION_FILE = path.join(__dirname, "../../data/coordination-sessions.json");

function _rj(file, fb) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fb; } }
function _wj(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

let _sessions = _rj(SESSION_FILE, []);
let _seq = _sessions.length;
function _sid() { return `coord_${Date.now()}_${(++_seq).toString(36)}`; }
function _save() { try { _wj(SESSION_FILE, _sessions.slice(-1000)); } catch { /* non-fatal */ } }

// ── Agent dispatch shim ──────────────────────────────────────────────────
// Uses AgentExecutionEngine if available; falls back to runtimeOrchestrator
let _aee = null;
function _getAEE() {
    if (!_aee) {
        try { _aee = require("./agentExecutionEngine.cjs"); } catch { _aee = null; }
    }
    return _aee;
}

async function _dispatchToAgent(agentId, input, opts = {}) {
    const aee = _getAEE();
    if (aee) return aee.executeTask(agentId, input, opts);
    // Fallback — use orchestrator directly
    try {
        const orc = require("../../agents/runtime/runtimeOrchestrator.cjs");
        const r   = await orc.dispatch(`[Agent: ${agentId}] ${input}`, { timeoutMs: opts.timeoutMs || 30_000, retries: 0 });
        return { runId: null, success: r.success, output: r.reply || r.output || "", error: r.error, durationMs: 0 };
    } catch (e) {
        return { runId: null, success: false, output: null, error: e.message, durationMs: 0 };
    }
}

// ── Session helpers ──────────────────────────────────────────────────────
function _newSession(pattern, agents, input, opts = {}) {
    const session = {
        sessionId:   _sid(),
        pattern,
        agents,
        input:       (input || "").slice(0, 500),
        status:      "running",
        createdAt:   new Date().toISOString(),
        completedAt: null,
        durationMs:  null,
        steps:       [],         // Array<StepRecord>
        output:      null,
        error:       null,
        metadata:    opts.metadata || {},
    };
    _sessions.push(session);
    _save();
    auditLog.append({ type: "coord_start", sessionId: session.sessionId, pattern, agents });
    return session;
}

function _finishSession(session, success, output, error) {
    session.status      = success ? "completed" : "failed";
    session.completedAt = new Date().toISOString();
    session.durationMs  = Date.now() - new Date(session.createdAt).getTime();
    session.output      = (output || "").slice(0, 1000);
    session.error       = error  || null;
    _save();
    auditLog.append({ type: success ? "coord_complete" : "coord_fail", sessionId: session.sessionId, durationMs: session.durationMs });
    execLog.append({ agentId: "MultiAgentCoordinator", taskType: `coord:${session.pattern}`, taskId: session.sessionId, success, durationMs: session.durationMs });
}

function _addStep(session, step) {
    session.steps.push({ ts: new Date().toISOString(), ...step });
    _save();
}

// ── Handoff ──────────────────────────────────────────────────────────────
/**
 * Agent A finishes, passes its output + context to agent B as input.
 * Optionally chains through a list of agents.
 */
async function handoff(fromAgentId, toAgentId, context, opts = {}) {
    const chain   = opts.chain || [toAgentId];          // support multi-hop chains
    const session = _newSession("handoff", [fromAgentId, ...chain], context, opts);

    let currentOutput = context;
    let currentAgent  = fromAgentId;

    // Run "from" agent first if fromInput is provided
    if (opts.fromInput) {
        const r = await _dispatchToAgent(fromAgentId, opts.fromInput, opts);
        _addStep(session, { agent: fromAgentId, action: "execute", success: r.success, output: r.output, error: r.error, runId: r.runId });
        if (!r.success) { _finishSession(session, false, null, `Handoff origin failed: ${r.error}`); return { sessionId: session.sessionId, success: false, error: session.error }; }
        currentOutput = r.output || context;
    }

    // Walk the handoff chain
    for (const agentId of chain) {
        const input = `Handoff from ${currentAgent}: ${currentOutput}`;
        const r     = await _dispatchToAgent(agentId, input, opts);
        _addStep(session, { agent: agentId, action: "handoff_receive", success: r.success, output: r.output, error: r.error, runId: r.runId });
        if (!r.success) {
            _finishSession(session, false, null, `Handoff to ${agentId} failed: ${r.error}`);
            return { sessionId: session.sessionId, success: false, error: session.error };
        }
        currentOutput = r.output || currentOutput;
        currentAgent  = agentId;
    }

    _finishSession(session, true, currentOutput, null);
    return { sessionId: session.sessionId, success: true, output: currentOutput };
}

// ── Delegation ───────────────────────────────────────────────────────────
/**
 * Orchestrator agent delegates subtasks to specialist agents.
 * subtasks: [{ agentId, input }]
 * Executes sequentially (ordered dependencies). For parallel: use collaborate().
 */
async function delegate(orchestratorId, subtasks, opts = {}) {
    if (!Array.isArray(subtasks) || subtasks.length === 0) {
        throw new Error("subtasks must be a non-empty array");
    }
    const agents  = [orchestratorId, ...subtasks.map(s => s.agentId)];
    const session = _newSession("delegation", agents, subtasks.map(s => s.input).join(" | "), opts);

    const results = [];
    for (const st of subtasks) {
        const r = await _dispatchToAgent(st.agentId, st.input, opts);
        _addStep(session, { agent: st.agentId, action: "delegated_task", success: r.success, output: r.output, error: r.error, runId: r.runId, taskInput: st.input.slice(0, 80) });
        results.push({ agentId: st.agentId, ...r });
        if (!r.success && opts.failFast) {
            _finishSession(session, false, null, `Delegation to ${st.agentId} failed: ${r.error}`);
            return { sessionId: session.sessionId, success: false, results, error: session.error };
        }
    }

    const allOk  = results.every(r => r.success);
    const merged = results.filter(r => r.success).map(r => r.output).join("\n\n");
    _finishSession(session, allOk, merged, allOk ? null : `${results.filter(r => !r.success).length} subtask(s) failed`);
    return { sessionId: session.sessionId, success: allOk, results, output: merged };
}

// ── Collaboration ────────────────────────────────────────────────────────
/**
 * Multiple agents work on the same input in parallel; outputs are merged.
 */
async function collaborate(agentIds, sharedInput, opts = {}) {
    if (!Array.isArray(agentIds) || agentIds.length < 2) {
        throw new Error("collaborate requires at least 2 agents");
    }
    const session = _newSession("collaboration", agentIds, sharedInput, opts);

    // Fire all agents in parallel
    const promises = agentIds.map(id => _dispatchToAgent(id, sharedInput, opts).then(r => ({ agentId: id, ...r })));
    const results  = await Promise.allSettled(promises).then(arr =>
        arr.map((p, i) => p.status === "fulfilled" ? p.value : { agentId: agentIds[i], success: false, error: p.reason?.message || "rejected" })
    );

    for (const r of results) {
        _addStep(session, { agent: r.agentId, action: "collaborate", success: r.success, output: r.output, error: r.error, runId: r.runId });
    }

    const succeeded = results.filter(r => r.success);
    const merged    = succeeded.map(r => `[${r.agentId}]: ${r.output}`).join("\n\n");
    const allOk     = succeeded.length === results.length;
    _finishSession(session, succeeded.length > 0, merged, allOk ? null : `${results.length - succeeded.length} agent(s) failed`);
    return { sessionId: session.sessionId, success: succeeded.length > 0, results, output: merged };
}

// ── Query API ────────────────────────────────────────────────────────────
function getSession(sessionId) {
    return _sessions.find(s => s.sessionId === sessionId) || null;
}

function listSessions({ pattern, status, agentId, limit = 50, offset = 0 } = {}) {
    let rows = [..._sessions].reverse();
    if (pattern) rows = rows.filter(s => s.pattern  === pattern);
    if (status)  rows = rows.filter(s => s.status   === status);
    if (agentId) rows = rows.filter(s => s.agents.includes(agentId));

    const stats = {
        total:        _sessions.length,
        handoffs:     _sessions.filter(s => s.pattern === "handoff").length,
        delegations:  _sessions.filter(s => s.pattern === "delegation").length,
        collaborations:_sessions.filter(s => s.pattern === "collaboration").length,
        completed:    _sessions.filter(s => s.status  === "completed").length,
        failed:       _sessions.filter(s => s.status  === "failed").length,
        running:      _sessions.filter(s => s.status  === "running").length,
        avgDurationMs: (() => {
            const done = _sessions.filter(s => s.durationMs);
            return done.length ? Math.round(done.reduce((a, s) => a + s.durationMs, 0) / done.length) : 0;
        })(),
    };
    return { sessions: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function getCoordinationStats() {
    return listSessions({}).stats;
}

module.exports = { handoff, delegate, collaborate, getSession, listSessions, getCoordinationStats };
