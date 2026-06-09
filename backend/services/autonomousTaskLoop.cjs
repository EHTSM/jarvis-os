"use strict";
/**
 * AutonomousTaskLoop — Goal → Task → Agent → Tool → Result → Memory → Improvement
 *
 * Orchestrates the full autonomous execution cycle:
 *   1. Accept a goal
 *   2. Decompose into tasks (rule-based, no extra AI call)
 *   3. Dispatch each task via AgentExecutionEngine
 *   4. Store results in MemoryPersistenceLayer
 *   5. Track learning: success patterns, failure patterns, improvement notes
 *
 * Persists full cycle state to data/autonomous-cycles.json.
 *
 * Public API:
 *   startCycle(goal, opts)          → { cycleId, status: "running" }
 *   getCycle(cycleId)               → CycleRecord
 *   listCycles(opts)                → { cycles[], stats }
 *   cancelCycle(cycleId)            → { cycleId, status: "cancelled" }
 *   getLearningLog(opts)            → { entries[] }
 *   getStats()                      → { totals, successRate, avgCycleDuration }
 */

const fs     = require("fs");
const path   = require("path");
const logger = require("../utils/logger");
const memory = require("./memoryPersistenceLayer.cjs");
const agentEngine = require("./agentExecutionEngine.cjs");

const CYCLE_FILE    = path.join(__dirname, "../../data/autonomous-cycles.json");
const LEARNING_FILE = path.join(__dirname, "../../data/learning-patterns.json");

// ── Persistence ──────────────────────────────────────────────────────────
function _readJson(file, fb) {
    try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fb; }
}
function _writeJson(file, data) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

let _cycles  = _readJson(CYCLE_FILE, []);
// learning-patterns.json may be a legacy {patterns,history,meta} object — extract the history array
const _rawLearning = _readJson(LEARNING_FILE, []);
let _learning = Array.isArray(_rawLearning) ? _rawLearning : (Array.isArray(_rawLearning.history) ? _rawLearning.history : []);
let _seq = _cycles.length;
function _cycleId() { return `cyc_${Date.now()}_${(++_seq).toString(36)}`; }

function _saveCycles()   { try { _writeJson(CYCLE_FILE,    _cycles.slice(-500));   } catch { /* non-fatal */ } }
function _saveLearning() { try { _writeJson(LEARNING_FILE, _learning.slice(-1000)); } catch { /* non-fatal */ } }

// ── Goal → Task decomposition ────────────────────────────────────────────
const TASK_TEMPLATES = {
    sales:    ["Qualify lead and assess fit",         "Draft personalised outreach email",    "Schedule follow-up reminder",  "Update CRM with outcome"],
    marketing:["Analyse campaign performance",        "Draft content for next campaign",       "Schedule distribution",        "Track engagement metrics"],
    seo:      ["Run keyword gap analysis",            "Generate meta tags for top pages",      "Identify backlink opportunities","Report rank changes"],
    support:  ["Categorise incoming ticket",          "Draft resolution response",             "Escalate if unresolved >24h",   "Update knowledge base"],
    research: ["Search primary sources",              "Synthesise findings into brief",        "Identify knowledge gaps",       "Store in memory"],
    dev:      ["Analyse code change requirements",    "Write implementation",                  "Run tests",                     "Open PR for review"],
    devops:   ["Check infra health metrics",          "Identify cost optimisation opportunities","Apply safe auto-remediations","Report incidents"],
    analytics:["Pull raw metrics from data store",   "Calculate KPI deltas",                  "Detect anomalies",              "Generate report"],
    general:  ["Understand the goal context",         "Identify the best agent for the task",  "Execute primary action",        "Store result in memory"],
};

function _agentForGoalType(goalType) {
    const MAP = {
        sales: "sales", marketing: "marketing", seo: "seo", support: "support",
        research: "research", dev: "dev", devops: "devops", analytics: "analytics",
    };
    return MAP[goalType] || "runtime";
}

function _decompose(goal, goalType) {
    const templates = TASK_TEMPLATES[goalType] || TASK_TEMPLATES.general;
    return templates.map((t, i) => ({
        taskId:     `t_${i + 1}`,
        seq:        i + 1,
        input:      t + " — context: " + goal.slice(0, 100),
        agentId:    _agentForGoalType(goalType),
        status:     "pending",
        success:    null,
        output:     null,
        error:      null,
        durationMs: null,
        runId:      null,
        retries:    0,
    }));
}

// ── Cycle execution (async, non-blocking start) ──────────────────────────
async function _runCycle(cycle) {
    cycle.status    = "running";
    cycle.startedAt = new Date().toISOString();
    _saveCycles();

    let allSuccess = true;

    for (const task of cycle.tasks) {
        if (cycle.status === "cancelled") break;

        task.status = "running";
        _saveCycles();

        // Pre-load relevant memory for the agent
        const ctx = memory.recall({ agentId: task.agentId, input: task.input, limit: 5 });
        const enrichedInput = ctx.nodes.length
            ? `${task.input}\n\n[Memory context: ${ctx.nodes.map(n => n.key).join(", ")}]`
            : task.input;

        let result;
        try {
            result = await agentEngine.executeTask(task.agentId, enrichedInput, {
                type: "autonomous_cycle_task",
            });
        } catch (err) {
            result = { success: false, error: err.message, output: null, durationMs: 0, runId: null };
        }

        task.runId      = result.runId   || null;
        task.durationMs = result.durationMs || 0;

        if (result.success) {
            task.status  = "completed";
            task.success = true;
            task.output  = (result.output || "").slice(0, 500);

            // Store result in memory
            memory.save({
                key:        `[Cycle ${cycle.cycleId}] ${task.input.slice(0, 60)}`,
                value:      task.output,
                type:       "insight",
                tags:       [cycle.goalType, task.agentId, "cycle_result"],
                importance: 70,
                confidence: 85,
                agentIds:   [task.agentId],
            });

            _recordLearning("success", cycle, task, result);
        } else {
            task.status  = "failed";
            task.success = false;
            task.error   = result.error || "unknown";
            allSuccess   = false;

            // Retry once automatically
            if (task.retries < 1) {
                task.retries++;
                task.status = "retrying";
                _saveCycles();
                try {
                    const retry = await agentEngine.executeTask(task.agentId, task.input, {
                        type: "autonomous_cycle_task_retry",
                        retryOf: task.runId,
                        retryCount: 1,
                    });
                    if (retry.success) {
                        task.status  = "completed";
                        task.success = true;
                        task.output  = (retry.output || "").slice(0, 500);
                        task.runId   = retry.runId;
                        allSuccess   = allSuccess; // don't flip — already false from first attempt
                        _recordLearning("retry_success", cycle, task, retry);
                    } else {
                        task.status = "failed";
                        _recordLearning("failure", cycle, task, retry);
                    }
                } catch (e) {
                    task.status = "failed";
                    task.error  = e.message;
                    _recordLearning("failure", cycle, task, { error: e.message });
                }
            } else {
                _recordLearning("failure", cycle, task, result);
            }
        }

        _saveCycles();
    }

    if (cycle.status !== "cancelled") {
        const completedTasks = cycle.tasks.filter(t => t.success === true).length;
        const totalTasks     = cycle.tasks.length;
        cycle.completedAt    = new Date().toISOString();
        cycle.durationMs     = Date.now() - new Date(cycle.startedAt).getTime();
        cycle.completedTasks = completedTasks;
        cycle.successRate    = Math.round(completedTasks / totalTasks * 100);
        cycle.status         = completedTasks === totalTasks ? "completed"
                             : completedTasks > 0            ? "partial"
                             : "failed";

        // Final improvement note stored in memory
        memory.save({
            key:        `Cycle summary: ${cycle.goal.slice(0, 60)}`,
            value:      { cycleId: cycle.cycleId, successRate: cycle.successRate, completedTasks, totalTasks },
            type:       "insight",
            tags:       [cycle.goalType, "cycle_summary"],
            importance: 80,
            confidence: 90,
            agentIds:   [],
        });
    }

    _saveCycles();
    logger.info(`[AutonomousTaskLoop] Cycle ${cycle.cycleId} → ${cycle.status} (${cycle.successRate ?? 0}%)`);
}

function _recordLearning(event, cycle, task, result) {
    _learning.push({
        ts:         new Date().toISOString(),
        event,
        cycleId:    cycle.cycleId,
        goalType:   cycle.goalType,
        agentId:    task.agentId,
        taskInput:  task.input.slice(0, 80),
        success:    result.success,
        error:      result.error  || null,
        durationMs: result.durationMs || 0,
    });
    _saveLearning();
}

// ── Public API ───────────────────────────────────────────────────────────

/** Start a new autonomous cycle. Non-blocking — execution runs in background. */
function startCycle(goal, opts = {}) {
    const cycleId  = _cycleId();
    const goalType = opts.goalType || "general";
    const tasks    = _decompose(goal, goalType);

    const cycle = {
        cycleId,
        goal:         goal.slice(0, 500),
        goalType,
        status:       "pending",
        createdAt:    new Date().toISOString(),
        startedAt:    null,
        completedAt:  null,
        durationMs:   null,
        completedTasks: 0,
        successRate:  null,
        tasks,
        source:       opts.source || "api",
    };

    _cycles.push(cycle);
    _saveCycles();

    // Run without awaiting — responds immediately, cycle runs in background
    _runCycle(cycle).catch(err => {
        cycle.status = "failed";
        cycle.error  = err.message;
        _saveCycles();
        logger.error(`[AutonomousTaskLoop] Unhandled cycle error: ${err.message}`);
    });

    return { cycleId, status: "running", tasks: tasks.length };
}

function getCycle(cycleId) {
    return _cycles.find(c => c.cycleId === cycleId) || null;
}

function listCycles({ status, goalType, limit = 50, offset = 0 } = {}) {
    let rows = [..._cycles].reverse();
    if (status)   rows = rows.filter(c => c.status   === status);
    if (goalType) rows = rows.filter(c => c.goalType === goalType);

    const stats = {
        total:     _cycles.length,
        running:   _cycles.filter(c => c.status === "running").length,
        completed: _cycles.filter(c => c.status === "completed").length,
        failed:    _cycles.filter(c => c.status === "failed"   ).length,
        partial:   _cycles.filter(c => c.status === "partial"  ).length,
        avgSuccessRate: (() => {
            const done = _cycles.filter(c => c.successRate !== null);
            return done.length ? Math.round(done.reduce((s, c) => s + c.successRate, 0) / done.length) : 0;
        })(),
    };

    return { cycles: rows.slice(offset, offset + limit), total: rows.length, stats };
}

function cancelCycle(cycleId) {
    const cycle = _cycles.find(c => c.cycleId === cycleId);
    if (!cycle) throw new Error(`Cycle ${cycleId} not found`);
    if (!["pending","running"].includes(cycle.status)) throw new Error("Cycle already finished");
    cycle.status = "cancelled";
    cycle.completedAt = new Date().toISOString();
    _saveCycles();
    return { cycleId, status: "cancelled" };
}

function getLearningLog({ limit = 100, agentId, event } = {}) {
    let rows = [..._learning].reverse();
    if (agentId) rows = rows.filter(r => r.agentId === agentId);
    if (event)   rows = rows.filter(r => r.event   === event);
    return { entries: rows.slice(0, limit), total: rows.length };
}

function getStats() {
    const done = _cycles.filter(c => c.completedAt);
    return {
        totalCycles:   _cycles.length,
        completed:     _cycles.filter(c => c.status === "completed").length,
        failed:        _cycles.filter(c => c.status === "failed").length,
        partial:       _cycles.filter(c => c.status === "partial").length,
        running:       _cycles.filter(c => c.status === "running").length,
        successRate:   done.length ? Math.round(done.reduce((s, c) => s + (c.successRate || 0), 0) / done.length) : 0,
        avgDurationMs: done.length ? Math.round(done.reduce((s, c) => s + (c.durationMs || 0), 0) / done.length) : 0,
        totalLearning: _learning.length,
    };
}

module.exports = { startCycle, getCycle, listCycles, cancelCycle, getLearningLog, getStats };
