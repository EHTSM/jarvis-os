"use strict";
const { LIMITS, ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");

const AGENT = "globalAutomationEngine";

const ACTION_TYPES  = ["compute","notify","schedule","integrate","transform","analyse","report","optimise"];
const ACTION_STATUS = ["queued","running","completed","failed","cancelled","blocked"];

// ── Execute a set of approved actions ────────────────────────────
// This is called ONLY after safety + ethics approval is confirmed.
function executeActions({ executionId, actions = [], loopDepth = 0, concurrentCount = 0, approvedBy, approvalRef }) {
    if (!Array.isArray(actions) || actions.length === 0) return fail(AGENT, "actions array required");
    if (!approvedBy) return blocked(AGENT, "Execution requires approvedBy field — must pass safety/ethics pipeline first");
    if (isKillSwitchActive()) return killed(AGENT);

    // Hard limits — cannot be overridden
    if (loopDepth >= LIMITS.MAX_EXECUTION_LOOPS) {
        return blocked(AGENT, `Max execution loop depth (${LIMITS.MAX_EXECUTION_LOOPS}) reached. Aborting to prevent runaway execution.`);
    }
    if (concurrentCount >= LIMITS.MAX_CONCURRENT_TASKS) {
        return blocked(AGENT, `Max concurrent tasks (${LIMITS.MAX_CONCURRENT_TASKS}) reached. Queue actions when capacity frees.`);
    }
    if (actions.length > LIMITS.MAX_CONCURRENT_TASKS) {
        return blocked(AGENT, `Batch size ${actions.length} exceeds max concurrent tasks (${LIMITS.MAX_CONCURRENT_TASKS}). Split into smaller batches.`);
    }

    const results = actions.map(action => {
        if (!ACTION_TYPES.includes(action.type)) {
            return { actionId: uid("act"), ...action, status: "failed", error: `Unknown action type '${action.type}'`, executedAt: NOW() };
        }
        // Simulate execution (real integrations hook in via routeToLayer)
        const success = Math.random() > 0.05; // 95% simulated success rate
        return {
            actionId:   uid("act"),
            type:       action.type,
            payload:    action.payload || {},
            status:     success ? "completed" : "failed",
            output:     success ? `${action.type} executed successfully` : null,
            error:      success ? null : `Simulated transient failure — retry eligible`,
            durationMs: Math.round(50 + Math.random() * 500),
            executedAt: NOW()
        };
    });

    const succeeded = results.filter(r => r.status === "completed").length;
    const failed    = results.filter(r => r.status === "failed").length;

    const execution = {
        executionId:   executionId || uid("exec"),
        approvedBy,
        approvalRef:   approvalRef || null,
        loopDepth,
        actionsTotal:  actions.length,
        succeeded,
        failed,
        results,
        overallStatus: failed === 0 ? "completed" : succeeded === 0 ? "failed" : "partial",
        executedAt:    NOW()
    };

    const log = load("execution_log", []);
    log.push({ executionId: execution.executionId, actionsTotal: actions.length, succeeded, failed, executedAt: execution.executedAt });
    flush("execution_log", log.slice(-2000));

    ultimateLog(AGENT, "actions_executed", { executionId: execution.executionId, succeeded, failed, loopDepth }, failed > 0 ? "WARN" : "INFO");
    return ok(AGENT, execution, execution.overallStatus === "completed" ? "approved" : "partial");
}

// ── Schedule a future action ─────────────────────────────────────
function scheduleAction({ action, scheduledFor, approvedBy }) {
    if (!action || !scheduledFor || !approvedBy) return fail(AGENT, "action, scheduledFor, and approvedBy are required");
    if (isKillSwitchActive()) return killed(AGENT);

    const scheduled = {
        scheduleId:   uid("sch"),
        action,
        scheduledFor,
        approvedBy,
        status:       "scheduled",
        scheduledAt:  NOW()
    };

    const queue = load("scheduled_actions", []);
    queue.push(scheduled);
    flush("scheduled_actions", queue.slice(-500));

    ultimateLog(AGENT, "action_scheduled", { scheduleId: scheduled.scheduleId, scheduledFor, approvedBy }, "INFO");
    return ok(AGENT, scheduled);
}

// ── Get execution history ────────────────────────────────────────
function getExecutionLog({ limit = 20 }) {
    const log = load("execution_log", []);
    return ok(AGENT, { total: log.length, recent: log.slice(-limit), actionTypes: ACTION_TYPES });
}

module.exports = { executeActions, scheduleAction, getExecutionLog, ACTION_TYPES };
