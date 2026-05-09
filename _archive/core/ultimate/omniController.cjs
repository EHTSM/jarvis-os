"use strict";

/**
 * omniController — Master Control System for Jarvis OS
 *
 * Pipeline (strictly ordered, cannot be skipped):
 *   1. Kill-switch check          → halt if active
 *   2. Loop + concurrency guard   → enforce hard limits
 *   3. multiSystemIntegrator      → connect relevant layers
 *   4. globalIntelligenceNetwork  → gather insights
 *   5. universalKnowledgeEngine   → process knowledge
 *   6. economyEngine              → evaluate impact
 *   7. safetyLockAI (GATE)        → risk score + block if high risk
 *   8. ethicsMonitor (GATE)       → reject on ethics violation
 *   9. humanAssistController      → assess human handoff need
 *  10. IF approved: globalAutomationEngine → execute actions
 *  11. selfHealingSystem          → post-execution health scan
 *  12. scalingEngine              → performance optimisation
 *  13. universalKnowledgeEngine   → store learned outcome
 *
 * Output: { success, type:"ultimate", decision, actions, status }
 */

const { LIMITS, ultimateLog, isKillSwitchActive, load, flush, uid, NOW, ok, fail, blocked, killed } = require("./_ultimateStore.cjs");
const { guard }                = require("./killSwitchSystem.cjs");
const { gate, checkLoopDepth, checkConcurrency } = require("./safetyLockAI.cjs");
const { validate: ethicsValidate } = require("./ethicsMonitor.cjs");
const { assessHandoff }        = require("./humanAssistController.cjs");
const { connectLayers }        = require("./multiSystemIntegrator.cjs");
const { gatherInsights }       = require("./globalIntelligenceNetwork.cjs");
const { processKnowledge, storeKnowledge } = require("./universalKnowledgeEngine.cjs");
const { evaluateImpact }       = require("./economyEngine.cjs");
const { executeActions }       = require("./globalAutomationEngine.cjs");
const { runHealthScan }        = require("./selfHealingSystem.cjs");
const { optimisePerformance }  = require("./scalingEngine.cjs");

// ── Active task tracker (in-memory for current process) ─────────
let _activeTasks = 0;

// ─────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────
function run({
    goal,
    actions         = [],
    requestedBy     = "system",
    riskFlags       = [],
    adminApproved   = false,
    loopDepth       = 0,
    sensitivityLevel = "moderate",
    context         = {}
}) {
    const runId     = uid("omni");
    const startedAt = NOW();

    // ── STEP 1: Kill-switch check ─────────────────────────────────
    const ks = guard("omniController");
    if (ks) return ks;

    if (!goal) return fail("omniController", "goal is required");

    // ── STEP 2: Hard concurrency + loop guards ────────────────────
    const loopCheck = checkLoopDepth(loopDepth);
    if (!loopCheck.success) return loopCheck;

    const concCheck = checkConcurrency(_activeTasks);
    if (!concCheck.success) return concCheck;

    _activeTasks++;
    ultimateLog("omniController", "run_started", { runId, goal: goal.slice(0,100), loopDepth, requestedBy }, "INFO");

    try {
        // ── STEP 3: Connect system layers ─────────────────────────
        const integration = connectLayers({ requestedLayers: [] });
        const layersAvailable = integration.success ? integration.data.connected : 0;

        // ── STEP 4: Gather intelligence ───────────────────────────
        const intel = gatherInsights({ goal, depth: "standard" });
        const intelSignal = intel.success ? intel.data.overallSignal : "unknown";

        // ── STEP 5: Process knowledge ─────────────────────────────
        const knowledge = processKnowledge({ goal, reasoningMode: "causal" });
        const knowledgeConfidence = knowledge.success ? knowledge.data.confidence : 0;

        // ── STEP 6: Economic impact evaluation ────────────────────
        const economy = evaluateImpact({ goal, actions });
        const economicVerdict = economy.success ? economy.data.verdict : "unknown";

        // ── STEP 7: SAFETY GATE ───────────────────────────────────
        const safetyResult = gate({ action: goal, flags: riskFlags, adminApproved, context });
        if (!safetyResult.success) {
            _activeTasks--;
            ultimateLog("omniController", "SAFETY_GATE_BLOCKED", { runId, goal: goal.slice(0,80), riskScore: safetyResult.riskScore }, "WARN");
            return _buildOutput({ runId, goal, status: "blocked", decision: `Blocked by safety system: ${safetyResult.error}`, actions: [], startedAt, layersAvailable, intelSignal, economicVerdict, blocked: true, blockReason: safetyResult.error });
        }

        // ── STEP 8: ETHICS GATE ───────────────────────────────────
        const ethicsResult = ethicsValidate({ action: goal, context, goal });
        if (!ethicsResult.success) {
            _activeTasks--;
            ultimateLog("omniController", "ETHICS_GATE_BLOCKED", { runId, goal: goal.slice(0,80) }, "WARN");
            return _buildOutput({ runId, goal, status: "blocked", decision: `Blocked by ethics monitor: ${ethicsResult.error}`, actions: [], startedAt, layersAvailable, intelSignal, economicVerdict, blocked: true, blockReason: ethicsResult.error });
        }

        // ── STEP 9: Human handoff assessment ─────────────────────
        const handoff = assessHandoff({ userId: requestedBy, task: goal, sensitivityLevel, confidence_pct: knowledgeConfidence });
        const humanRequired = handoff.success && handoff.data.humanRequired;

        if (humanRequired && !adminApproved) {
            _activeTasks--;
            ultimateLog("omniController", "HUMAN_REVIEW_REQUIRED", { runId, goal: goal.slice(0,80), sensitivityLevel }, "INFO");
            return _buildOutput({
                runId, goal, status: "awaiting_human",
                decision: `Human review required for '${sensitivityLevel}' sensitivity task. Provide adminApproved:true after human sign-off.`,
                actions: [], startedAt, layersAvailable, intelSignal, economicVerdict,
                handoffDetails: handoff.data
            });
        }

        // ── STEP 10: Execute approved actions ─────────────────────
        const actionsToRun = actions.length > 0
            ? actions.slice(0, LIMITS.MAX_CONCURRENT_TASKS)
            : [{ type: "compute", payload: { goal } }];

        const execution = executeActions({
            executionId:   runId,
            actions:       actionsToRun,
            loopDepth,
            concurrentCount: _activeTasks - 1,
            approvedBy:    adminApproved ? "admin" : requestedBy,
            approvalRef:   safetyResult.data?.assessmentId
        });

        // ── STEP 11: Post-execution health scan ───────────────────
        const health = runHealthScan({ subsystems: ["omniController","globalAutomationEngine"] });
        const systemHealthy = health.success && health.data.allHealthy;

        // ── STEP 12: Performance optimisation ────────────────────
        const perf = optimisePerformance({ subsystem: "omniController", objectives: ["latency","throughput"] });

        // ── STEP 13: Store outcome as knowledge ───────────────────
        storeKnowledge({
            topic:   `omniController run: ${goal.slice(0,80)}`,
            content: `Goal executed with status: ${execution.data?.overallStatus || "unknown"}. Economic verdict: ${economicVerdict}. Health: ${systemHealthy ? "healthy" : "degraded"}.`,
            domain:  "system_learning",
            source:  "omniController",
            tags:    ["autonomous_run","goal_execution"]
        });

        _activeTasks--;
        ultimateLog("omniController", "run_complete", { runId, goal: goal.slice(0,80), succeeded: execution.data?.succeeded, failed: execution.data?.failed }, "INFO");

        return _buildOutput({
            runId, goal,
            status:          execution.success ? "approved" : "partial",
            decision:        `Goal '${goal.slice(0,80)}' processed through full safety pipeline. Execution ${execution.data?.overallStatus || "complete"}.`,
            actions:         execution.data?.results || [],
            startedAt,
            layersAvailable,
            intelSignal,
            economicVerdict,
            systemHealthy,
            perfGain_pct:    perf.data?.totalGain_pct,
            pipeline: {
                integration:  integration.success ? "connected" : "partial",
                intelligence: intelSignal,
                knowledge:    `${knowledgeConfidence}% confidence`,
                economy:      economicVerdict,
                safety:       "passed",
                ethics:       "passed",
                handoff:      humanRequired ? "escalated_and_approved" : "automated",
                execution:    execution.data?.overallStatus,
                health:       systemHealthy ? "healthy" : "degraded",
                scaling:      "optimised"
            }
        });

    } catch (err) {
        _activeTasks = Math.max(0, _activeTasks - 1);
        ultimateLog("omniController", "RUN_ERROR", { runId, error: err.message }, "WARN");
        return fail("omniController", `Unexpected error in pipeline: ${err.message}`);
    }
}

// ── Build the standardised output ────────────────────────────────
function _buildOutput({ runId, goal, status, decision, actions, startedAt, layersAvailable, intelSignal, economicVerdict, systemHealthy, perfGain_pct, pipeline, blocked, blockReason, handoffDetails }) {
    return {
        success:    !blocked && status !== "error",
        type:       "ultimate",
        runId,
        decision,
        goal:       goal.slice(0, 200),
        status,
        actions:    actions || [],
        pipeline:   pipeline || {},
        metadata: {
            layersAvailable: layersAvailable || 0,
            intelligenceSignal: intelSignal || "unknown",
            economicVerdict: economicVerdict || "unknown",
            systemHealthy:  systemHealthy !== false,
            perfGain_pct:   perfGain_pct || null,
            blockReason:    blockReason || null,
            handoffDetails: handoffDetails || null,
            limits: {
                maxLoops:       LIMITS.MAX_EXECUTION_LOOPS,
                maxConcurrent:  LIMITS.MAX_CONCURRENT_TASKS,
                maxRiskScore:   LIMITS.MAX_RISK_SCORE
            }
        },
        startedAt,
        completedAt: NOW()
    };
}

// ── Get system overview ───────────────────────────────────────────
function getSystemStatus() {
    return ok("omniController", {
        killSwitchActive: isKillSwitchActive(),
        activeTasks:      _activeTasks,
        limits:           LIMITS,
        pipelineStages:   13,
        description:      "omniController orchestrates the full safety → approval → execution pipeline. Control > Power. Safety > Automation. Human oversight always.",
        statusAt:         NOW()
    });
}

module.exports = { run, getSystemStatus };
