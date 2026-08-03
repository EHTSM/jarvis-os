"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

// Boot I4 + I5 the same way backend/server.js does before I3, so
// missionOrchestrator's real completion-time verification gate
// (_runVerificationGate -> executeStage) can find real registered
// capabilities (test_run/git_status) instead of silently falling through
// to the generic "ai" dispatch path, which has no AI provider configured
// in this test environment and always fails.
require("../../backend/services/autonomousExecutionRuntime.cjs").start();
require("../../backend/services/engineeringCapabilities.cjs").register();

const orchestrator = require("../../backend/services/missionOrchestrator.cjs");

function waitFor(predicate, { timeoutMs = 3000, intervalMs = 20 } = {}) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
            if (predicate()) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timed out"));
            setTimeout(tick, intervalMs);
        };
        tick();
    });
}

describe("missionOrchestrator — Phase 9 workflow node types", () => {

    it("NODE_TYPES declares all 14 mission-required node type names", () => {
        for (const t of [
            "Trigger", "Condition", "AgentAction", "SkillExecution", "ToolExecution",
            "ConnectorAction", "Approval", "Wait", "Retry", "Fallback", "Parallel",
            "HumanTask", "Verification", "Completion",
        ]) {
            assert.ok(orchestrator.NODE_TYPES.has(t), `missing node type: ${t}`);
        }
    });

    it("existing 5-stage pipeline stages default to nodeType AgentAction (backward compatible)", () => {
        const mission = orchestrator.createManual({ goal: `test goal ${Date.now()}`, requiresApproval: true });
        for (const stg of mission.stages) {
            assert.equal(stg.nodeType, "AgentAction");
        }
    });

    it("an unrecognized nodeType in extraStages falls back to AgentAction rather than being silently invalid", () => {
        const mission = orchestrator.createManual({
            goal: `test goal ${Date.now()}`,
            requiresApproval: true,
            extraStages: [{ nodeType: "NotARealNodeType", description: "bad node" }],
        });
        const extra = mission.stages[mission.stages.length - 1];
        assert.equal(extra.nodeType, "AgentAction");
    });

    it("a Wait stage transitions to waiting_condition and blocks the mission until resolved", async () => {
        const mission = orchestrator.createManual({
            goal: `wait-node-test-${Date.now()}`,
            skipCapabilities: ["goal_decompose", "task_plan", "validation", "execution", "reporting"],
            extraStages: [{ nodeType: "Wait", description: "wait for external signal", waitCondition: "manual test trigger" }],
        });
        const waitStageId = mission.stages[0].id;

        await waitFor(() => {
            const m = orchestrator.getMission(mission.missionId);
            return m.stages[0].status === "waiting_condition";
        });

        const afterWait = orchestrator.getMission(mission.missionId);
        assert.equal(afterWait.orchStatus, "waiting", "mission should be waiting while the Wait stage is blocking");

        const resolved = orchestrator.resolveBlockingStage(mission.missionId, waitStageId, { outcome: "met" });
        assert.equal(resolved.status, "completed");

        // Autonomous Verification & Regression Certification: _complete() now
        // runs a real verification gate before transitioning to "completed"
        // — this mission's stages are all skipped except the Wait node
        // (nodeType, not a real capability), so it's not code-touching and
        // gets the lightweight git_status check, not the full test suite —
        // still real I/O (a real git subprocess), so a slightly longer
        // timeout than the prior instant hardcoded-pass behavior.
        await waitFor(() => orchestrator.getMission(mission.missionId).orchStatus === "completed", { timeoutMs: 8_000 });
    });

    it("a HumanTask stage transitions to awaiting_human and can be resolved as done or rejected", async () => {
        const mission = orchestrator.createManual({
            goal: `human-task-test-${Date.now()}`,
            skipCapabilities: ["goal_decompose", "task_plan", "validation", "execution", "reporting"],
            extraStages: [{ nodeType: "HumanTask", description: "review this manually", humanTaskInfo: { assignee: "operator" } }],
        });
        const stageId = mission.stages[0].id;

        await waitFor(() => orchestrator.getMission(mission.missionId).stages[0].status === "awaiting_human");

        const resolved = orchestrator.resolveBlockingStage(mission.missionId, stageId, { outcome: "done", output: "reviewed ok" });
        assert.equal(resolved.status, "completed");
        assert.equal(resolved.output, "reviewed ok");
    });

    it("resolveBlockingStage() with outcome:rejected fails the stage (respecting its retry budget)", async () => {
        const mission = orchestrator.createManual({
            goal: `rejected-human-task-${Date.now()}`,
            skipCapabilities: ["goal_decompose", "task_plan", "validation", "execution", "reporting"],
            extraStages: [{ nodeType: "HumanTask", description: "review 2", maxRetries: 0 }],
        });
        const stageId = mission.stages[0].id;
        await waitFor(() => orchestrator.getMission(mission.missionId).stages[0].status === "awaiting_human");

        orchestrator.resolveBlockingStage(mission.missionId, stageId, { outcome: "rejected", reason: "not approved" });
        await waitFor(() => orchestrator.getMission(mission.missionId).orchStatus === "failed");
        const final = orchestrator.getMission(mission.missionId);
        assert.equal(final.stages[0].status, "failed");
    });

    it("resolveBlockingStage() throws for a stage that isn't in a blocking status", () => {
        const mission = orchestrator.createManual({ goal: `not-blocked-${Date.now()}`, requiresApproval: true });
        const stageId = mission.stages[0].id; // pending, not blocking
        assert.throws(() => orchestrator.resolveBlockingStage(mission.missionId, stageId, { outcome: "approved" }));
    });

    it("resolveBlockingStage() throws for an unknown mission or stage", () => {
        assert.throws(() => orchestrator.resolveBlockingStage("not-a-real-mission", "stg_x", { outcome: "approved" }));
    });
});
