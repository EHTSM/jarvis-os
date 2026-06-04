"use strict";
/**
 * AgentExecutionEngine — per-agent task dispatch with history, retry
 * tracking and failure analytics.
 *
 * Plugs into the existing agentRegistry + executionHistory + auditLog stack.
 *
 * Public API:
 *   executeTask(agentId, input, opts) → { runId, success, output, durationMs }
 *   retryTask(runId)                  → { runId, ... }
 *   getHistory(agentId, opts)         → { runs[], stats }
 *   getFailures(agentId, opts)        → { failures[], stats }
 *   listAgents()                      → { agents[] }
 *   getAgent(agentId)                 → agent stats | null
 */

const path        = require("path");
const fs          = require("fs");
const logger      = require("../utils/logger");
const execLog     = require("../utils/execLog.cjs");
const auditLog    = require("../utils/auditLog.cjs");

// ── Persistent run store ─────────────────────────────────────────────────
const RUN_FILE = path.join(__dirname, "../../data/agent-runs.json");

function _loadRuns() {
    try {
        const raw = fs.readFileSync(RUN_FILE, "utf8");
        return JSON.parse(raw);
    } catch { return []; }
}

function _saveRuns(runs) {
    const dir = path.dirname(RUN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = RUN_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(runs.slice(-2000), null, 2)); // keep last 2000
    fs.renameSync(tmp, RUN_FILE);
}

let _runs = _loadRuns();  // Array of RunRecord (newest-last order)
let _seq  = _runs.length;

function _id() { return `run_${Date.now()}_${(++_seq).toString(36)}`; }

function _appendRun(run) {
    _runs.push(run);
    if (_runs.length > 2000) _runs = _runs.slice(-2000);
    _saveRuns(_runs);
}

// ── Agent capability registry (lightweight — for meta only) ──────────────
const BUILTIN_AGENTS = [
    { id: "sales",     name: "Sales Agent",      capabilities: ["lead_qualify","email_send","crm_write"] },
    { id: "marketing", name: "Marketing Agent",  capabilities: ["email_draft","social_post","campaign_schedule"] },
    { id: "seo",       name: "SEO Agent",        capabilities: ["keyword_research","meta_generate","rank_track"] },
    { id: "support",   name: "Support Agent",    capabilities: ["ticket_read","ticket_reply","escalate"] },
    { id: "research",  name: "Research Agent",   capabilities: ["web_search","brief_generate","summarize"] },
    { id: "dev",       name: "Dev Agent",        capabilities: ["code_write","pr_create","test_run"] },
    { id: "devops",    name: "DevOps Agent",     capabilities: ["deploy","monitor","incident_resolve"] },
    { id: "analytics", name: "Analytics Agent",  capabilities: ["report_generate","anomaly_detect","kpi_track"] },
    { id: "content",   name: "Content Agent",    capabilities: ["blog_write","newsletter_draft","brand_voice"] },
    { id: "runtime",   name: "Runtime Agent",    capabilities: ["task_dispatch","queue_drain","tool_call"] },
];

/**
 * Execute a task for a specific agent.
 * Routes to runtimeOrchestrator.dispatch() with agent-context-aware input.
 */
async function executeTask(agentId, input, opts = {}) {
    const runId     = _id();
    const startedAt = new Date().toISOString();
    const start     = Date.now();

    const run = {
        runId, agentId,
        input:      input.slice(0, 500),
        type:       opts.type || "agent_task",
        status:     "running",
        startedAt,
        completedAt: null,
        durationMs:  null,
        success:     null,
        output:      null,
        error:       null,
        retries:     opts.retryCount || 0,
        retryOf:     opts.retryOf    || null,
    };
    _appendRun(run);

    auditLog.append({ type: "dispatch", runId, agentId, input: input.slice(0, 200) });

    // Route via runtimeOrchestrator
    let orchestrator;
    try {
        orchestrator = require("../../agents/runtime/runtimeOrchestrator.cjs");
    } catch (e) {
        run.status = "failed"; run.error = "Orchestrator unavailable: " + e.message;
        run.completedAt = new Date().toISOString(); run.durationMs = Date.now() - start;
        _saveRuns(_runs);
        return { runId, success: false, output: null, error: run.error, durationMs: run.durationMs };
    }

    try {
        const agentCtx = `[Agent: ${agentId}] `;
        const result   = await orchestrator.dispatch(agentCtx + input, {
            timeoutMs: opts.timeoutMs || 30_000,
            retries:   0,
            meta:      { agentId },
        });

        const durationMs = Date.now() - start;
        run.status      = result.success ? "completed" : "failed";
        run.success     = result.success;
        run.output      = (result.reply || result.output || "").slice(0, 1000);
        run.error       = result.error || null;
        run.durationMs  = durationMs;
        run.completedAt = new Date().toISOString();
        _saveRuns(_runs);

        execLog.append({
            agentId, taskType: run.type, taskId: runId,
            success: run.success, durationMs,
            input: input.slice(0, 120), output: (run.output || "").slice(0, 120),
        });
        auditLog.append({ type: run.success ? "complete" : "failed", runId, agentId, durationMs });

        return { runId, success: run.success, output: run.output, durationMs, error: run.error };

    } catch (err) {
        const durationMs = Date.now() - start;
        run.status      = "failed";
        run.success     = false;
        run.error       = err.message;
        run.durationMs  = durationMs;
        run.completedAt = new Date().toISOString();
        _saveRuns(_runs);

        execLog.append({ agentId, taskType: run.type, taskId: runId, success: false, durationMs, error: err.message });
        auditLog.append({ type: "failed", runId, agentId, error: err.message });
        logger.error(`[AgentExecutionEngine] ${agentId} task failed: ${err.message}`);
        return { runId, success: false, output: null, durationMs, error: err.message };
    }
}

/** Retry a failed run. */
async function retryTask(runId) {
    const run = _runs.find(r => r.runId === runId);
    if (!run) throw new Error(`Run ${runId} not found`);
    if (run.status === "running") throw new Error("Run is still in progress");
    return executeTask(run.agentId, run.input, {
        type:       run.type,
        retryOf:    runId,
        retryCount: (run.retries || 0) + 1,
    });
}

/** Get execution history for one agent (or all if agentId omitted). */
function getHistory(agentId, { limit = 50, offset = 0, status } = {}) {
    let rows = agentId ? _runs.filter(r => r.agentId === agentId) : _runs;
    if (status) rows = rows.filter(r => r.status === status);
    rows = [...rows].reverse(); // newest first

    const total     = rows.length;
    const succeeded = rows.filter(r => r.success === true).length;
    const failed    = rows.filter(r => r.success === false).length;
    const avgMs     = rows.length
        ? Math.round(rows.reduce((s, r) => s + (r.durationMs || 0), 0) / rows.length)
        : 0;

    return {
        runs:    rows.slice(offset, offset + limit),
        total,
        stats:   { succeeded, failed, successRate: total ? Math.round(succeeded / total * 100) : 0, avgMs },
    };
}

/** Get failure records only. */
function getFailures(agentId, { limit = 50 } = {}) {
    let rows = _runs.filter(r => r.success === false || r.status === "failed");
    if (agentId) rows = rows.filter(r => r.agentId === agentId);
    rows = [...rows].reverse();

    // Pattern grouping: cluster by first-50-char error message
    const patterns = new Map();
    for (const r of rows) {
        const key = (r.error || "unknown").slice(0, 50);
        const p = patterns.get(key) || { pattern: key, count: 0, lastSeen: null, agentIds: new Set() };
        p.count++;
        p.lastSeen = r.completedAt || r.startedAt;
        p.agentIds.add(r.agentId);
        patterns.set(key, p);
    }

    return {
        failures: rows.slice(0, limit),
        patterns: Array.from(patterns.values()).map(p => ({ ...p, agentIds: Array.from(p.agentIds) }))
            .sort((a, b) => b.count - a.count),
        total: rows.length,
    };
}

/** List registered agents with live stats from run history. */
function listAgents() {
    return BUILTIN_AGENTS.map(a => {
        const runs      = _runs.filter(r => r.agentId === a.id);
        const success   = runs.filter(r => r.success === true).length;
        const failed    = runs.filter(r => r.success === false).length;
        const lastRun   = runs.length ? runs[runs.length - 1] : null;
        return {
            ...a,
            totalRuns:   runs.length,
            succeeded:   success,
            failed,
            successRate: runs.length ? Math.round(success / runs.length * 100) : null,
            lastRunAt:   lastRun?.completedAt || null,
            lastStatus:  lastRun?.status      || "idle",
        };
    });
}

/** Get one agent's full profile. */
function getAgent(agentId) {
    const def = BUILTIN_AGENTS.find(a => a.id === agentId);
    if (!def) return null;
    const { runs, total, stats } = getHistory(agentId, { limit: 200 });
    return { ...def, history: runs, totalRuns: total, stats };
}

module.exports = { executeTask, retryTask, getHistory, getFailures, listAgents, getAgent };
