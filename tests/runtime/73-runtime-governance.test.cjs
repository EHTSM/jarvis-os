"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const scheduling  = require("../../agents/runtime/governance/adaptiveSchedulingEngine.cjs");
const admission   = require("../../agents/runtime/governance/executionAdmissionController.cjs");
const qos         = require("../../agents/runtime/governance/qosGovernanceEngine.cjs");
const fairness    = require("../../agents/runtime/governance/executionFairnessCoordinator.cjs");
const shaping     = require("../../agents/runtime/governance/workloadShapingEngine.cjs");
const telemetry   = require("../../agents/runtime/governance/governanceTelemetry.cjs");

// ── adaptiveSchedulingEngine ──────────────────────────────────────────
describe("adaptiveSchedulingEngine", () => {
    beforeEach(() => scheduling.reset());

    it("schedules a workflow and returns scheduled=true", () => {
        const r = scheduling.scheduleWorkflow({ workflowId: "wf-1" });
        assert.equal(r.scheduled, true);
        assert.ok(r.schedId.startsWith("sched-"));
        assert.equal(r.workflowId, "wf-1");
    });

    it("rejects a workflow without workflowId", () => {
        const r = scheduling.scheduleWorkflow({});
        assert.equal(r.scheduled, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("returns current policy in schedule result", () => {
        const r = scheduling.scheduleWorkflow({ workflowId: "wf-2" });
        assert.ok(typeof r.policy === "string");
        assert.ok(scheduling.SCHEDULING_POLICIES.includes(r.policy));
    });

    it("selectSchedulingPolicy picks recovery-priority when recoveries active", () => {
        const r = scheduling.selectSchedulingPolicy({ activeRecoveryCount: 2 });
        assert.equal(r.policy, "recovery-priority");
        assert.equal(r.reason, "active_recovery_detected");
    });

    it("selectSchedulingPolicy picks starvation-safe when starvation detected", () => {
        const r = scheduling.selectSchedulingPolicy({ starvationDetected: true });
        assert.equal(r.policy, "starvation-safe");
        assert.equal(r.reason, "starvation_detected");
    });

    it("selectSchedulingPolicy picks deterministic-fair-share at high pressure", () => {
        const r = scheduling.selectSchedulingPolicy({ currentPressure: 0.85 });
        assert.equal(r.policy, "deterministic-fair-share");
        assert.equal(r.reason, "high_pressure");
    });

    it("selectSchedulingPolicy picks priority-first at medium pressure", () => {
        const r = scheduling.selectSchedulingPolicy({ currentPressure: 0.6 });
        assert.equal(r.policy, "priority-first");
        assert.equal(r.reason, "medium_pressure");
    });

    it("selectSchedulingPolicy picks fifo at nominal pressure", () => {
        const r = scheduling.selectSchedulingPolicy({ currentPressure: 0.1 });
        assert.equal(r.policy, "fifo");
        assert.equal(r.reason, "nominal");
    });

    it("getSchedulingQueue returns sorted by priority-first", () => {
        scheduling.scheduleWorkflow({ workflowId: "wf-low",  priority: 2 });
        scheduling.scheduleWorkflow({ workflowId: "wf-high", priority: 9 });
        scheduling.scheduleWorkflow({ workflowId: "wf-mid",  priority: 5 });
        const q = scheduling.getSchedulingQueue({ policy: "priority-first" });
        assert.equal(q[0].priority, 9);
        assert.equal(q[1].priority, 5);
        assert.equal(q[2].priority, 2);
    });

    it("getSchedulingQueue returns fifo insertion order", () => {
        scheduling.scheduleWorkflow({ workflowId: "wf-a" });
        scheduling.scheduleWorkflow({ workflowId: "wf-b" });
        const q = scheduling.getSchedulingQueue({ policy: "fifo" });
        assert.equal(q[0].workflowId, "wf-a");
        assert.equal(q[1].workflowId, "wf-b");
    });

    it("getSchedulingQueue sorts shortest-job-first by estimatedDuration", () => {
        scheduling.scheduleWorkflow({ workflowId: "wf-long",   estimatedDuration: 300 });
        scheduling.scheduleWorkflow({ workflowId: "wf-short",  estimatedDuration: 50  });
        scheduling.scheduleWorkflow({ workflowId: "wf-medium", estimatedDuration: 150 });
        const q = scheduling.getSchedulingQueue({ policy: "shortest-job-first" });
        assert.equal(q[0].estimatedDuration, 50);
        assert.equal(q[1].estimatedDuration, 150);
        assert.equal(q[2].estimatedDuration, 300);
    });

    it("getSchedulingQueue places recoveryMode workflows first in recovery-priority", () => {
        scheduling.scheduleWorkflow({ workflowId: "wf-normal",   recoveryMode: false, priority: 9 });
        scheduling.scheduleWorkflow({ workflowId: "wf-recovery", recoveryMode: true,  priority: 5 });
        const q = scheduling.getSchedulingQueue({ policy: "recovery-priority" });
        assert.equal(q[0].recoveryMode, true);
        assert.equal(q[1].recoveryMode, false);
    });

    it("getSchedulingQueue starvation-safe sorts by age descending", () => {
        scheduling.scheduleWorkflow({ workflowId: "wf-young" });
        scheduling.scheduleWorkflow({ workflowId: "wf-old"   });
        const q = scheduling.getSchedulingQueue({ policy: "starvation-safe" });
        assert.ok(Array.isArray(q));
    });

    it("getSchedulingQueue isolation-aware sorts by isolationPressure descending", () => {
        scheduling.scheduleWorkflow({ workflowId: "wf-low-iso",  isolationPressure: 0.1 });
        scheduling.scheduleWorkflow({ workflowId: "wf-high-iso", isolationPressure: 0.9 });
        const q = scheduling.getSchedulingQueue({ policy: "isolation-aware" });
        assert.equal(q[0].isolationPressure, 0.9);
    });

    it("getSchedulingQueue deterministic-fair-share sorts by priority-contentionScore", () => {
        scheduling.scheduleWorkflow({ workflowId: "wf-contended", priority: 8, contentionScore: 6 });
        scheduling.scheduleWorkflow({ workflowId: "wf-clean",     priority: 6, contentionScore: 0 });
        const q = scheduling.getSchedulingQueue({ policy: "deterministic-fair-share" });
        assert.equal(q[0].workflowId, "wf-clean"); // score 6 > score 2
    });

    it("reprioritizeWorkflow changes priority of scheduled entry", () => {
        const s = scheduling.scheduleWorkflow({ workflowId: "wf-reprio", priority: 3 });
        const r = scheduling.reprioritizeWorkflow(s.schedId, 8);
        assert.equal(r.reprioritized, true);
        assert.equal(r.oldPriority, 3);
        assert.equal(r.newPriority, 8);
    });

    it("reprioritizeWorkflow fails for unknown schedId", () => {
        const r = scheduling.reprioritizeWorkflow("sched-999", 5);
        assert.equal(r.reprioritized, false);
        assert.equal(r.reason, "schedule_not_found");
    });

    it("detectSchedulingPressure returns low for empty queue", () => {
        const r = scheduling.detectSchedulingPressure();
        assert.equal(r.queueDepth, 0);
        assert.equal(r.pressure, "low");
    });

    it("detectSchedulingPressure includes queueDepth count", () => {
        for (let i = 0; i < 5; i++) scheduling.scheduleWorkflow({ workflowId: `wf-${i}` });
        const r = scheduling.detectSchedulingPressure();
        assert.equal(r.queueDepth, 5);
    });

    it("SCHEDULING_POLICIES exports all 7 policies", () => {
        assert.equal(scheduling.SCHEDULING_POLICIES.length, 7);
    });

    it("getSchedulingQueue filters by status", () => {
        scheduling.scheduleWorkflow({ workflowId: "wf-stat" });
        const q = scheduling.getSchedulingQueue({ status: "scheduled" });
        assert.ok(q.length >= 1);
    });
});

// ── executionAdmissionController ─────────────────────────────────────
describe("executionAdmissionController", () => {
    beforeEach(() => admission.reset());

    it("admits a valid workflow", () => {
        const r = admission.validateAdmission({ workflowId: "wf-1" });
        assert.equal(r.admitted, true);
        assert.ok(r.admId.startsWith("adm-"));
    });

    it("rejects without workflowId", () => {
        const r = admission.validateAdmission({});
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("rejects when concurrency limit exceeded", () => {
        const r = admission.validateAdmission({ workflowId: "wf-x", currentConcurrent: 50 });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "runtime_overloaded");
    });

    it("rejects when queue depth exceeded", () => {
        const r = admission.validateAdmission({ workflowId: "wf-x", currentQueueDepth: 200 });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "queue_depth_exceeded");
    });

    it("rejects when retry burst limit exceeded", () => {
        const r = admission.validateAdmission({ workflowId: "wf-x", currentRetryBurst: 10 });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "retry_burst_limit");
    });

    it("rejects non-recovery workflow when recovery load saturated", () => {
        const r = admission.validateAdmission({
            workflowId: "wf-x", currentRecoveryLoad: 20, recoveryMode: false
        });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "recovery_saturated");
    });

    it("admits recovery workflow even when recovery load saturated", () => {
        const r = admission.validateAdmission({
            workflowId: "wf-x", currentRecoveryLoad: 20, recoveryMode: true
        });
        assert.equal(r.admitted, true);
    });

    it("throttleWorkflow blocks subsequent admission", () => {
        admission.validateAdmission({ workflowId: "wf-t" });
        admission.throttleWorkflow({ workflowId: "wf-t" });
        const r = admission.validateAdmission({ workflowId: "wf-t" });
        assert.equal(r.admitted, false);
        assert.equal(r.reason, "workflow_throttled");
    });

    it("throttleWorkflow requires workflowId", () => {
        const r = admission.throttleWorkflow({});
        assert.equal(r.throttled, false);
    });

    it("rejectWorkflow records rejection", () => {
        const r = admission.rejectWorkflow({ workflowId: "wf-rej", reason: "runtime_overloaded" });
        assert.equal(r.rejected, true);
        assert.ok(r.rejId.startsWith("rej-"));
    });

    it("rejectWorkflow requires workflowId", () => {
        const r = admission.rejectWorkflow({});
        assert.equal(r.rejected, false);
    });

    it("getAdmissionState tracks admitted, throttled, rejected counts", () => {
        admission.validateAdmission({ workflowId: "wf-1" });
        admission.validateAdmission({ workflowId: "wf-2" });
        admission.throttleWorkflow({ workflowId: "wf-1" });
        admission.rejectWorkflow({ workflowId: "wf-3" });
        const s = admission.getAdmissionState();
        assert.equal(s.totalThrottled, 1);
        assert.equal(s.totalRejected,  1);
        assert.ok(s.limits != null);
    });

    it("calculateAdmissionPressure returns low for empty system", () => {
        const r = admission.calculateAdmissionPressure({ currentConcurrent: 0, currentQueueDepth: 0 });
        assert.equal(r.pressure, "low");
        assert.equal(r.score, 0);
    });

    it("calculateAdmissionPressure returns critical near limits", () => {
        const r = admission.calculateAdmissionPressure({ currentConcurrent: 48, currentQueueDepth: 190 });
        assert.equal(r.pressure, "critical");
    });

    it("calculateAdmissionPressure returns medium for moderate load", () => {
        const r = admission.calculateAdmissionPressure({ currentConcurrent: 25, currentQueueDepth: 80 });
        assert.equal(r.pressure, "medium");
    });

    it("REJECTION_REASONS exports an array", () => {
        assert.ok(Array.isArray(admission.REJECTION_REASONS));
        assert.ok(admission.REJECTION_REASONS.length > 0);
    });
});

// ── qosGovernanceEngine ───────────────────────────────────────────────
describe("qosGovernanceEngine", () => {
    beforeEach(() => qos.reset());

    it("assigns a QoS class to a workflow", () => {
        const r = qos.assignQoSClass({ workflowId: "wf-1", qosClass: "high" });
        assert.equal(r.assigned, true);
        assert.ok(r.assignId.startsWith("qos-"));
        assert.equal(r.qosClass, "high");
    });

    it("rejects assignment without workflowId", () => {
        const r = qos.assignQoSClass({ qosClass: "high" });
        assert.equal(r.assigned, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("rejects invalid QoS class", () => {
        const r = qos.assignQoSClass({ workflowId: "wf-1", qosClass: "ultra" });
        assert.equal(r.assigned, false);
        assert.ok(r.reason.startsWith("invalid_qos_class"));
    });

    it("auto-promotes standard to recovery in recoveryMode", () => {
        const r = qos.assignQoSClass({ workflowId: "wf-rec", qosClass: "standard", recoveryMode: true });
        assert.equal(r.qosClass, "recovery");
    });

    it("does not promote non-standard class in recoveryMode", () => {
        const r = qos.assignQoSClass({ workflowId: "wf-rec", qosClass: "critical", recoveryMode: true });
        assert.equal(r.qosClass, "critical");
    });

    it("enforceQoSPolicy returns compliant=true when within latency", () => {
        qos.assignQoSClass({ workflowId: "wf-1", qosClass: "high" });
        const r = qos.enforceQoSPolicy({ workflowId: "wf-1", actualLatencyMs: 100, maxLatencyMs: 200 });
        assert.equal(r.enforced, true);
        assert.equal(r.compliant, true);
        assert.equal(r.violations.length, 0);
    });

    it("enforceQoSPolicy detects latency violation", () => {
        qos.assignQoSClass({ workflowId: "wf-1", qosClass: "critical" });
        const r = qos.enforceQoSPolicy({ workflowId: "wf-1", actualLatencyMs: 500, maxLatencyMs: 100 });
        assert.equal(r.compliant, false);
        assert.equal(r.violations[0].type, "latency_exceeded");
    });

    it("enforceQoSPolicy requires workflowId", () => {
        const r = qos.enforceQoSPolicy({});
        assert.equal(r.enforced, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("enforceQoSPolicy fails for unknown workflow", () => {
        const r = qos.enforceQoSPolicy({ workflowId: "unknown" });
        assert.equal(r.enforced, false);
        assert.equal(r.reason, "assignment_not_found");
    });

    it("calculateQoSPressure returns none for unknown class", () => {
        const r = qos.calculateQoSPressure("ultra");
        assert.equal(r.found, false);
    });

    it("calculateQoSPressure returns none for class with no workflows", () => {
        const r = qos.calculateQoSPressure("critical");
        assert.equal(r.found, true);
        assert.equal(r.pressure, "none");
    });

    it("calculateQoSPressure returns low for compliant workflows", () => {
        qos.assignQoSClass({ workflowId: "wf-1", qosClass: "high" });
        qos.enforceQoSPolicy({ workflowId: "wf-1", actualLatencyMs: 50, maxLatencyMs: 200 });
        const r = qos.calculateQoSPressure("high");
        assert.equal(r.pressure, "low");
    });

    it("getQoSMetrics tracks totalAssignments and byClass", () => {
        qos.assignQoSClass({ workflowId: "wf-1", qosClass: "high" });
        qos.assignQoSClass({ workflowId: "wf-2", qosClass: "critical" });
        const m = qos.getQoSMetrics();
        assert.equal(m.totalAssignments, 2);
        assert.equal(m.byClass.high, 1);
        assert.equal(m.byClass.critical, 1);
    });

    it("getQoSMetrics totalViolations increments on breach", () => {
        qos.assignQoSClass({ workflowId: "wf-1", qosClass: "standard" });
        qos.enforceQoSPolicy({ workflowId: "wf-1", actualLatencyMs: 9999, maxLatencyMs: 100 });
        const m = qos.getQoSMetrics();
        assert.equal(m.totalViolations, 1);
    });

    it("QOS_CLASSES exports all 5 classes", () => {
        assert.equal(qos.QOS_CLASSES.length, 5);
    });

    it("QOS_PRIORITIES assigns higher priority to critical than background", () => {
        assert.ok(qos.QOS_PRIORITIES.critical > qos.QOS_PRIORITIES.background);
    });

    it("recovery class has higher priority than high class", () => {
        assert.ok(qos.QOS_PRIORITIES.recovery > qos.QOS_PRIORITIES.high);
    });
});

// ── executionFairnessCoordinator ──────────────────────────────────────
describe("executionFairnessCoordinator", () => {
    beforeEach(() => fairness.reset());

    it("evaluateFairness with no starvation returns fair=true", () => {
        const r = fairness.evaluateFairness({
            executions: [{ workflowId: "wf-1", priority: 5, waitTimeMs: 100 }],
        });
        assert.equal(r.fair, true);
        assert.equal(r.starvationChains.length, 0);
    });

    it("evaluateFairness detects starvation above threshold", () => {
        const r = fairness.evaluateFairness({
            executions: [{ workflowId: "wf-starved", priority: 3, waitTimeMs: 6000 }],
        });
        assert.equal(r.fair, false);
        assert.equal(r.starvationChains.length, 1);
        assert.equal(r.starvationChains[0].workflowId, "wf-starved");
    });

    it("evaluateFairness does not mark recovery workflows as starved", () => {
        const r = fairness.evaluateFairness({
            executions: [{ workflowId: "wf-rec", waitTimeMs: 8000, recoveryMode: true }],
        });
        assert.equal(r.starvationChains.length, 0);
    });

    it("evaluateFairness detects priority monopolization", () => {
        const r = fairness.evaluateFairness({
            executions: [
                { workflowId: "wf-dom",  priority: 9 },
                { workflowId: "wf-low",  priority: 2 },
            ],
        });
        assert.equal(r.violations.some(v => v.type === "priority_monopolization"), true);
    });

    it("compensateStarvation boosts priority", () => {
        fairness.evaluateFairness({
            executions: [{ workflowId: "wf-starved", waitTimeMs: 7000, priority: 3 }],
        });
        const r = fairness.compensateStarvation({ workflowId: "wf-starved", priorityBoost: 3 });
        assert.equal(r.compensated, true);
        assert.equal(r.newPriority, 6);
        assert.ok(r.adjId.startsWith("adj-"));
    });

    it("compensateStarvation caps priority at 10", () => {
        fairness.evaluateFairness({
            executions: [{ workflowId: "wf-hi", priority: 9, waitTimeMs: 6000 }],
        });
        const r = fairness.compensateStarvation({ workflowId: "wf-hi", priorityBoost: 5 });
        assert.equal(r.compensated, true);
        assert.equal(r.newPriority, 10);
    });

    it("compensateStarvation requires workflowId", () => {
        const r = fairness.compensateStarvation({});
        assert.equal(r.compensated, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("compensateStarvation fails for unknown workflow", () => {
        const r = fairness.compensateStarvation({ workflowId: "nobody" });
        assert.equal(r.compensated, false);
        assert.equal(r.reason, "execution_not_found");
    });

    it("balanceExecutionPriority blends priorities toward average", () => {
        const r = fairness.balanceExecutionPriority([
            { workflowId: "wf-a", priority: 2 },
            { workflowId: "wf-b", priority: 8 },
        ]);
        assert.equal(r.balanced, true);
        assert.equal(r.avgPriority, 5);
    });

    it("balanceExecutionPriority rejects empty array", () => {
        const r = fairness.balanceExecutionPriority([]);
        assert.equal(r.balanced, false);
        assert.equal(r.reason, "no_executions_provided");
    });

    it("getFairnessMetrics tracks starved and compensated counts", () => {
        fairness.evaluateFairness({
            executions: [{ workflowId: "wf-s", waitTimeMs: 9000, priority: 4 }],
        });
        fairness.compensateStarvation({ workflowId: "wf-s" });
        const m = fairness.getFairnessMetrics();
        assert.equal(m.compensatedCount, 1);
        assert.equal(m.totalAdjustments, 1);
    });

    it("STARVATION_THRESHOLD_MS is exported and equals 5000", () => {
        assert.equal(fairness.STARVATION_THRESHOLD_MS, 5000);
    });
});

// ── workloadShapingEngine ─────────────────────────────────────────────
describe("workloadShapingEngine", () => {
    beforeEach(() => shaping.reset());

    it("shapeIncomingWorkload admits up to maxPerWindow", () => {
        const r = shaping.shapeIncomingWorkload({
            workflowIds: ["a","b","c","d","e"],
            maxPerWindow: 3,
            windowMs: 500,
        });
        assert.equal(r.shaped, true);
        assert.equal(r.admitted, 3);
        assert.equal(r.deferred, 2);
        assert.ok(r.shapeId.startsWith("shape-"));
    });

    it("shapeIncomingWorkload admits all when count <= maxPerWindow", () => {
        const r = shaping.shapeIncomingWorkload({
            workflowIds: ["a","b"],
            maxPerWindow: 10,
        });
        assert.equal(r.admitted, 2);
        assert.equal(r.deferred, 0);
        assert.equal(r.pacingMs, 0);
    });

    it("shapeIncomingWorkload sets pacingMs when workflows deferred", () => {
        const r = shaping.shapeIncomingWorkload({
            workflowIds: ["a","b","c"],
            maxPerWindow: 1,
            windowMs: 1000,
        });
        assert.equal(r.pacingMs, 1000);
    });

    it("shapeIncomingWorkload rejects empty workflowIds", () => {
        const r = shaping.shapeIncomingWorkload({ workflowIds: [] });
        assert.equal(r.shaped, false);
        assert.equal(r.reason, "no_workflows_provided");
    });

    it("shapeIncomingWorkload rejects non-array workflowIds", () => {
        const r = shaping.shapeIncomingWorkload({ workflowIds: "not-an-array" });
        assert.equal(r.shaped, false);
    });

    it("smoothExecutionBurst returns smoothed=true for valid burst", () => {
        const r = shaping.smoothExecutionBurst({ burstSize: 20, maxBurstRate: 10, smoothingMs: 500 });
        assert.equal(r.smoothed, true);
        assert.ok(r.burstId.startsWith("burst-"));
        assert.equal(r.deferredCount, 10);
    });

    it("smoothExecutionBurst calculates pacingMs correctly", () => {
        const r = shaping.smoothExecutionBurst({ burstSize: 25, maxBurstRate: 10, smoothingMs: 500 });
        // deferred=15, ceil(15/10)*500 = 1000
        assert.equal(r.pacingMs, 1000);
    });

    it("smoothExecutionBurst defers nothing when burst within rate", () => {
        const r = shaping.smoothExecutionBurst({ burstSize: 5, maxBurstRate: 10, smoothingMs: 500 });
        assert.equal(r.deferredCount, 0);
        assert.equal(r.pacingMs, 0);
    });

    it("smoothExecutionBurst rejects invalid burst size", () => {
        const r = shaping.smoothExecutionBurst({ burstSize: 0 });
        assert.equal(r.smoothed, false);
        assert.equal(r.reason, "invalid_burst_size");
    });

    it("calculateRuntimePressure returns low with no bursts", () => {
        const r = shaping.calculateRuntimePressure();
        assert.equal(r.pressure, "low");
        assert.equal(r.recommendation, "none");
    });

    it("calculateRuntimePressure returns medium with moderate bursts", () => {
        shaping.smoothExecutionBurst({ burstSize: 30 });
        const r = shaping.calculateRuntimePressure();
        assert.ok(["medium","high","critical","low"].includes(r.pressure));
    });

    it("calculateRuntimePressure returns critical with very large bursts", () => {
        shaping.smoothExecutionBurst({ burstSize: 100 });
        const r = shaping.calculateRuntimePressure();
        assert.equal(r.pressure, "critical");
        assert.equal(r.recommendation, "throttle_all");
    });

    it("getWorkloadMetrics reflects burst and window counts", () => {
        shaping.smoothExecutionBurst({ burstSize: 15, maxBurstRate: 10 });
        shaping.shapeIncomingWorkload({ workflowIds: ["a","b","c"], maxPerWindow: 2 });
        const m = shaping.getWorkloadMetrics();
        assert.equal(m.totalBursts, 1);
        assert.equal(m.totalWindows, 1);
        assert.equal(m.totalDeferred, 5);
    });
});

// ── governanceTelemetry ───────────────────────────────────────────────
describe("governanceTelemetry", () => {
    beforeEach(() => telemetry.reset());

    it("recordSchedulingEvent stores event and returns recorded=true", () => {
        const r = telemetry.recordSchedulingEvent({ type: "workflow_scheduled", workflowId: "wf-1", latencyMs: 42 });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("sched-"));
    });

    it("recordSchedulingEvent rejects without type", () => {
        const r = telemetry.recordSchedulingEvent({ workflowId: "wf-1" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "type_required");
    });

    it("recordAdmissionEvent stores event and returns recorded=true", () => {
        const r = telemetry.recordAdmissionEvent({ type: "workflow_admitted", workflowId: "wf-1", admitted: true });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("adm-"));
    });

    it("recordAdmissionEvent rejects without type", () => {
        const r = telemetry.recordAdmissionEvent({});
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "type_required");
    });

    it("recordFairnessEvent stores event and returns recorded=true", () => {
        const r = telemetry.recordFairnessEvent({ type: "starvation_detected", workflowId: "wf-s", starvation: true });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("fair-"));
    });

    it("recordFairnessEvent rejects without type", () => {
        const r = telemetry.recordFairnessEvent({});
        assert.equal(r.recorded, false);
    });

    it("getGovernanceMetrics counts all event types", () => {
        telemetry.recordSchedulingEvent({ type: "scheduled" });
        telemetry.recordSchedulingEvent({ type: "scheduled" });
        telemetry.recordAdmissionEvent({ type: "admitted" });
        telemetry.recordFairnessEvent({ type: "fairness_checked" });
        const m = telemetry.getGovernanceMetrics();
        assert.equal(m.totalSchedulingEvents, 2);
        assert.equal(m.totalAdmissionEvents,  1);
        assert.equal(m.totalFairnessEvents,   1);
    });

    it("getGovernanceMetrics computes avgSchedulingLatencyMs", () => {
        telemetry.recordSchedulingEvent({ type: "s", latencyMs: 100 });
        telemetry.recordSchedulingEvent({ type: "s", latencyMs: 200 });
        const m = telemetry.getGovernanceMetrics();
        assert.equal(m.avgSchedulingLatencyMs, 150);
    });

    it("getGovernanceMetrics computes admissionRejectionRate", () => {
        telemetry.recordAdmissionEvent({ type: "rejected", admitted: false });
        telemetry.recordAdmissionEvent({ type: "admitted", admitted: true });
        telemetry.recordAdmissionEvent({ type: "rejected", admitted: false });
        const m = telemetry.getGovernanceMetrics();
        assert.ok(Math.abs(m.admissionRejectionRate - 0.667) < 0.001);
    });

    it("getGovernanceMetrics counts starvationEvents", () => {
        telemetry.recordFairnessEvent({ type: "starved", starvation: true });
        telemetry.recordFairnessEvent({ type: "starved", starvation: true });
        telemetry.recordFairnessEvent({ type: "ok",      starvation: false });
        const m = telemetry.getGovernanceMetrics();
        assert.equal(m.starvationEvents, 2);
    });

    it("getGovernanceMetrics counts qosEscalations", () => {
        telemetry.recordFairnessEvent({ type: "qos", qosEscalation: true });
        const m = telemetry.getGovernanceMetrics();
        assert.equal(m.qosEscalations, 1);
    });

    it("getGovernanceMetrics counts burstEvents", () => {
        telemetry.recordFairnessEvent({ type: "burst", burstDetected: true });
        telemetry.recordFairnessEvent({ type: "burst", burstDetected: true });
        const m = telemetry.getGovernanceMetrics();
        assert.equal(m.burstEvents, 2);
    });

    it("getGovernanceMetrics counts fairnessCorrections (compensated=true)", () => {
        telemetry.recordFairnessEvent({ type: "comp", compensated: true });
        const m = telemetry.getGovernanceMetrics();
        assert.equal(m.fairnessCorrections, 1);
    });

    it("getPressureAnalytics counts scheduling events by pressure level", () => {
        telemetry.recordSchedulingEvent({ type: "s", pressure: "critical" });
        telemetry.recordSchedulingEvent({ type: "s", pressure: "critical" });
        telemetry.recordSchedulingEvent({ type: "s", pressure: "low"      });
        const p = telemetry.getPressureAnalytics();
        assert.equal(p.critical, 2);
        assert.equal(p.low, 1);
        assert.equal(p.total, 3);
    });

    it("getPressureAnalytics computes criticalRate", () => {
        telemetry.recordSchedulingEvent({ type: "s", pressure: "critical" });
        telemetry.recordSchedulingEvent({ type: "s", pressure: "low"      });
        const p = telemetry.getPressureAnalytics();
        assert.equal(p.criticalRate, 0.5);
    });

    it("getPressureAnalytics returns zero criticalRate with no events", () => {
        const p = telemetry.getPressureAnalytics();
        assert.equal(p.criticalRate, 0);
        assert.equal(p.total, 0);
    });

    it("getPressureAnalytics buckets unknown pressure as unknown", () => {
        telemetry.recordSchedulingEvent({ type: "s", pressure: null });
        const p = telemetry.getPressureAnalytics();
        assert.equal(p.unknown, 1);
    });
});
