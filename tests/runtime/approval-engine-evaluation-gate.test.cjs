"use strict";
/**
 * Phase 2 (Agent Evaluation, Missions 137-140) regression coverage.
 *
 * Confirmed live gap: approvalEngine.cjs's _resumeExecution() computed
 * healthResult (a real check via executionValidator.validateHealth()) but
 * every downstream branch — evidence outcome, Production Bible write,
 * learning, session status, stats.verified, the returned outcome/ok — keyed
 * off execResult.outcome alone, i.e. "did the tool call report success,"
 * never consulting healthResult. This is exactly the anti-pattern CLAUDE.md
 * §18 and Mission 137-140 name: "an agent must not declare success solely
 * because a tool call returned without error."
 *
 * Stubs executionValidator.cjs and autonomousExecutionEngine.cjs via
 * require-cache override — the same technique tests/runtime/approval-queue-
 * engine.test.cjs already uses for missionMemory.cjs — so this test
 * controls exactly what health check result approvalEngine sees, without
 * touching real workflow execution or the real data/*.json files it uses
 * (approvalQueue/approvalEvidence/executionEvidence run for real, isolated
 * via JARVIS_TEST_DATA_SUFFIX where they support it, otherwise cleaned up
 * afterward the same way the existing approval test file does).
 */
process.env.JARVIS_TEST_DATA_SUFFIX = `test-eval-gate-${Date.now()}`;

const { describe, it, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const aeeAbsPath = require.resolve("../../backend/services/autonomousExecutionEngine.cjs");
const valAbsPath = require.resolve("../../backend/services/executionValidator.cjs");

// Controlled by each test before calling approveAndResume().
let _stubExecOutcome = "success";
let _stubHealthAllPass = true;

require.cache[aeeAbsPath] = {
    id: aeeAbsPath, filename: aeeAbsPath, loaded: true,
    exports: {
        executeWorkflow: async (workflowId) => ({
            ok: true,
            outcome: _stubExecOutcome,
            run: { id: `run_${Date.now()}`, steps: [], servicesInvoked: [] },
            durationMs: 5,
        }),
    },
};
require.cache[valAbsPath] = {
    id: valAbsPath, filename: valAbsPath, loaded: true,
    exports: {
        validateHealth: (workflowId) => ({ ok: true, workflowId, allPass: _stubHealthAllPass, checks: [{ name: "stub_check", pass: _stubHealthAllPass }] }),
    },
};

const approvalEngine = require("../../backend/services/approvalEngine.cjs");
const approvalQueue  = require("../../backend/services/approvalQueue.cjs");

const REAL_WORKFLOW_ID = "wf_deploy_vps_provision"; // real founderWorkRegistry entry, estimatedMinutes: 20

function enqueueRealRequest() {
    const { reqId } = approvalQueue.enqueue({
        workflowId: REAL_WORKFLOW_ID,
        action: "test evaluation gate",
        reason: "test",
        risk: "high", // avoid auto-approval so the test controls the approve step explicitly
    });
    return reqId;
}

describe("approvalEngine — Phase 2 Agent Evaluation gate", () => {

    beforeEach(() => {
        _stubExecOutcome = "success";
        _stubHealthAllPass = true;
    });

    it("baseline: execResult success + health check pass => real success", async () => {
        const reqId = enqueueRealRequest();
        const result = await approvalEngine.approveAndResume(reqId, { approvedBy: "test" });
        assert.equal(result.outcome, "success");
        assert.equal(result.ok, true);
    });

    it("THE FIX: execResult success + health check FAIL => must NOT be reported as success", async () => {
        _stubExecOutcome = "success";
        _stubHealthAllPass = false;
        const reqId = enqueueRealRequest();
        const result = await approvalEngine.approveAndResume(reqId, { approvedBy: "test" });

        // Before the fix: outcome === "success" and ok === true here, purely
        // because execResult.outcome said "success" — healthResult.allPass
        // was computed but never checked. This is the exact live anti-pattern
        // being closed: a tool call reporting no error is not the same as the
        // operation having actually completed successfully.
        assert.notEqual(result.outcome, "success", "must not declare success when the real health check failed");
        assert.equal(result.ok, false, "ok must reflect the verified outcome, not just execResult.ok");
        assert.equal(result.healthCheck.allPass, false, "the health check result itself must still be surfaced for audit");
    });

    it("execResult already failed + health check pass => still failed (no false negative introduced)", async () => {
        _stubExecOutcome = "failed";
        _stubHealthAllPass = true;
        const reqId = enqueueRealRequest();
        const result = await approvalEngine.approveAndResume(reqId, { approvedBy: "test" });
        assert.equal(result.outcome, "failed");
        assert.equal(result.ok, false);
    });

    it("minutesSaved is only credited on a verified success, not a health-check-failed one", async () => {
        _stubExecOutcome = "success";
        _stubHealthAllPass = false;
        const reqId = enqueueRealRequest();
        const result = await approvalEngine.approveAndResume(reqId, { approvedBy: "test" });
        assert.equal(result.minutesSaved, 0, "must not credit minutesSaved for an execution that failed real health verification");
    });

    after(() => {
        delete require.cache[aeeAbsPath];
        delete require.cache[valAbsPath];
    });
});
