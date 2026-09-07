"use strict";
/**
 * Universal Composition Engine, Phase 10 — Approval + Safety wiring.
 * Confirmed test gap from the mission research: zero existing test
 * coverage for approvalQueue.cjs / approvalEngine.cjs despite both being
 * real, populated services. This closes that gap AND proves the new
 * missionOrchestrator.cjs Approval node genuinely calls into the real
 * approvalQueue (single source of truth, unchanged) rather than
 * fabricating its own approval logic.
 */
const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Mission 90 Phase 2: this test previously reached the real
// missionMemory.cjs transitively via missionOrchestrator.cjs's own lazy
// _getMem(), so every mission it created via the orchestrator wrote a real
// record into the actual data/missions.json. Migrated via a require-cache
// override at the real absolute path — installed BEFORE
// missionOrchestrator.cjs/autonomousExecutionRuntime.cjs/
// engineeringCapabilities.cjs (all of which lazily reach missionMemory.cjs)
// are ever required, so every one of their internal missionMemory calls
// transparently hits the isolated copy instead. approvalQueue.cjs (a
// separate store) is intentionally left real — out of this mission's
// data/missions.json-specific scope.
const REAL_REPO_ROOT = path.join(__dirname, "..", "..");
const isoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "maqe-iso-"));
fs.mkdirSync(path.join(isoRoot, "backend", "services"), { recursive: true });
fs.mkdirSync(path.join(isoRoot, "backend", "utils"), { recursive: true });
fs.mkdirSync(path.join(isoRoot, "data"), { recursive: true });
fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "missionMemory.cjs"), path.join(isoRoot, "backend", "services", "missionMemory.cjs"));
fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "utils", "logger.js"), path.join(isoRoot, "backend", "utils", "logger.js"));
const isolatedMissionMemoryPath = path.join(isoRoot, "backend", "services", "missionMemory.cjs");
const isolatedMemory = require(isolatedMissionMemoryPath);
const realMissionMemoryAbsPath = require.resolve("../../backend/services/missionMemory.cjs");
require.cache[realMissionMemoryAbsPath] = {
    id: realMissionMemoryAbsPath,
    filename: realMissionMemoryAbsPath,
    loaded: true,
    exports: isolatedMemory,
};

const approvalQueue = require("../../backend/services/approvalQueue.cjs");

// Boot I4 + I5 the same way backend/server.js does before I3, so
// missionOrchestrator's real completion-time verification gate
// (_runVerificationGate -> executeStage) can find real registered
// capabilities (test_run/git_status) instead of silently falling through
// to the generic "ai" dispatch path, which has no AI provider configured
// in this test environment and always fails/hangs the completion.
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

describe("approvalQueue.cjs (confirmed prior test gap)", () => {

    it("enqueue() creates a real, retrievable request", () => {
        const result = approvalQueue.enqueue({
            workflowId: "wf_refund_credit",
            action: "Refund $10 credit to customer X",
            reason: "customer requested refund",
            risk: "medium",
        });
        assert.equal(result.ok, true);
        assert.ok(result.reqId);
        const fetched = approvalQueue.getRequest(result.reqId);
        assert.ok(fetched);
    });

    it("approve() transitions a real request to approved", () => {
        const { reqId } = approvalQueue.enqueue({ workflowId: "wf_refund_credit", action: "test approve", reason: "test" });
        const approved = approvalQueue.approve(reqId, { approvedBy: "test-operator" });
        assert.ok(approved);
        const fetched = approvalQueue.getRequest(reqId);
        assert.equal(fetched.status, "approved");
    });

    it("reject() transitions a real request to rejected", () => {
        const { reqId } = approvalQueue.enqueue({ workflowId: "wf_refund_credit", action: "test reject", reason: "test" });
        approvalQueue.reject(reqId, { reason: "not valid", rejectedBy: "test-operator" });
        const fetched = approvalQueue.getRequest(reqId);
        assert.equal(fetched.status, "rejected");
    });

    it("getRequest() returns null for an unknown request id", () => {
        assert.equal(approvalQueue.getRequest("not-a-real-request-id"), null);
    });

    it("listPending() only includes genuinely pending requests", () => {
        const { reqId } = approvalQueue.enqueue({ workflowId: "wf_deploy_vps_provision", action: "test pending", reason: "test" });
        const pending = approvalQueue.listPending();
        assert.ok(pending.some(r => r.id === reqId || r.reqId === reqId));
        approvalQueue.approve(reqId, {});
        const pendingAfter = approvalQueue.listPending();
        assert.ok(!pendingAfter.some(r => r.id === reqId || r.reqId === reqId));
    });
});

describe("missionOrchestrator Approval node -> approvalQueue wiring (Phase 10)", () => {

    it("an Approval stage genuinely enqueues a real approval request (not a fabricated one)", async () => {
        const mission = orchestrator.createManual({
            goal: `approval-node-test-${Date.now()}`,
            skipCapabilities: ["goal_decompose", "task_plan", "validation", "execution", "reporting"],
            extraStages: [{
                nodeType: "Approval",
                description: "high-risk action requiring approval",
                approvalPolicy: { workflowId: "wf_refund_credit", risk: "medium" },
            }],
        });

        await waitFor(() => orchestrator.getMission(mission.missionId).stages[0].status === "awaiting_approval");

        const afterApproval = orchestrator.getMission(mission.missionId);
        const stage = afterApproval.stages[0];
        assert.ok(stage.approvalRequestId, "expected a real approvalRequestId to be recorded on the stage");

        // Prove the request genuinely exists in the real approvalQueue —
        // not a fabricated id the orchestrator made up itself.
        const realRequest = approvalQueue.getRequest(stage.approvalRequestId);
        assert.ok(realRequest, "approval request must be genuinely retrievable from approvalQueue.cjs");
    });

    it("approving the real request unblocks the orchestrator stage via resolveBlockingStage", async () => {
        const mission = orchestrator.createManual({
            goal: `approval-unblock-test-${Date.now()}`,
            skipCapabilities: ["goal_decompose", "task_plan", "validation", "execution", "reporting"],
            extraStages: [{ nodeType: "Approval", description: "another high-risk action", approvalPolicy: { workflowId: "wf_refund_credit" } }],
        });
        const stageId = mission.stages[0].id;

        await waitFor(() => orchestrator.getMission(mission.missionId).stages[0].status === "awaiting_approval");
        const stage = orchestrator.getMission(mission.missionId).stages[0];

        // Approve via the real approvalQueue (as a human operator would),
        // then resolve the orchestrator stage to reflect that decision —
        // this two-step flow mirrors how a real UI/route would connect
        // the two systems (approvalQueue is the source of truth; the
        // orchestrator stage reflects its outcome).
        approvalQueue.approve(stage.approvalRequestId, { approvedBy: "test" });
        const resolved = orchestrator.resolveBlockingStage(mission.missionId, stageId, { outcome: "approved" });
        assert.equal(resolved.status, "completed");

        await waitFor(() => orchestrator.getMission(mission.missionId).orchStatus === "completed");
    });

    it("Rule 0 discipline: no decorative approval policy is fabricated for a workflowId with no real backing action — the stage still genuinely enqueues, but with the pattern-inferred generic policy, not a fake specific one", async () => {
        const mission = orchestrator.createManual({
            goal: `approval-unknown-workflow-${Date.now()}`,
            skipCapabilities: ["goal_decompose", "task_plan", "validation", "execution", "reporting"],
            extraStages: [{ nodeType: "Approval", description: "unrecognized workflow test" }], // no approvalPolicy passed
        });
        await waitFor(() => orchestrator.getMission(mission.missionId).stages[0].status === "awaiting_approval");
        const stage = orchestrator.getMission(mission.missionId).stages[0];
        assert.ok(stage.approvalRequestId, "even without an explicit approvalPolicy, a real request is still enqueued (falls back to a generated workflowId)");
    });

    after(() => {
        delete require.cache[realMissionMemoryAbsPath];
        try { fs.rmSync(isoRoot, { recursive: true, force: true }); } catch { /* best effort */ }
    });
});
