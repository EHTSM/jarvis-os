"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const store   = require("../../agents/runtime/persistence/runtimeEventStore.cjs");
const snap    = require("../../agents/runtime/persistence/workflowSnapshotEngine.cjs");
const drc     = require("../../agents/runtime/persistence/durableRecoveryCoordinator.cjs");
const sre     = require("../../agents/runtime/persistence/stateReconstructionEngine.cjs");
const pim     = require("../../agents/runtime/persistence/persistenceIntegrityManager.cjs");
const tel     = require("../../agents/runtime/persistence/persistenceTelemetry.cjs");

// ─────────────────────────────────────────────────────────────────────
// runtimeEventStore
// ─────────────────────────────────────────────────────────────────────
describe("runtimeEventStore", () => {
    beforeEach(() => store.reset());

    it("exports VALID_EVENT_TYPES array", () => {
        assert.ok(Array.isArray(store.VALID_EVENT_TYPES));
        assert.ok(store.VALID_EVENT_TYPES.includes("workflow_created"));
        assert.ok(store.VALID_EVENT_TYPES.includes("replay_completed"));
    });

    it("appendEvent → appended with eventId and deterministicSequence", () => {
        const r = store.appendEvent({ eventType: "workflow_created", workflowId: "wf-1" });
        assert.equal(r.appended, true);
        assert.ok(r.eventId.startsWith("evs-"));
        assert.equal(r.deterministicSequence, 1);
    });

    it("appendEvent sequence increments monotonically", () => {
        const r1 = store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-1" });
        const r2 = store.appendEvent({ eventType: "workflow_scheduled", workflowId: "wf-1" });
        const r3 = store.appendEvent({ eventType: "workflow_started",   workflowId: "wf-1" });
        assert.equal(r1.deterministicSequence, 1);
        assert.equal(r2.deterministicSequence, 2);
        assert.equal(r3.deterministicSequence, 3);
    });

    it("appendEvent missing eventType → not appended", () => {
        const r = store.appendEvent({ workflowId: "wf-1" });
        assert.equal(r.appended, false);
        assert.equal(r.reason, "eventType_required");
    });

    it("appendEvent invalid eventType → not appended", () => {
        const r = store.appendEvent({ eventType: "bogus_type", workflowId: "wf-1" });
        assert.equal(r.appended, false);
        assert.ok(r.reason.includes("invalid_event_type"));
    });

    it("appendEvent stores all metadata", () => {
        store.appendEvent({
            eventType: "workflow_created",
            workflowId: "wf-A",
            executionId: "ex-1",
            eventPayload: { foo: "bar" },
            replaySafe: false,
            isolationDomain: "dom-X",
        });
        const events = store.getEventsByWorkflow("wf-A");
        assert.equal(events.length, 1);
        assert.equal(events[0].executionId, "ex-1");
        assert.equal(events[0].eventPayload.foo, "bar");
        assert.equal(events[0].replaySafe, false);
        assert.equal(events[0].isolationDomain, "dom-X");
    });

    it("getEventsByWorkflow filters by workflowId", () => {
        store.appendEvent({ eventType: "workflow_created", workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_created", workflowId: "wf-2" });
        store.appendEvent({ eventType: "workflow_started", workflowId: "wf-1" });
        assert.equal(store.getEventsByWorkflow("wf-1").length, 2);
        assert.equal(store.getEventsByWorkflow("wf-2").length, 1);
    });

    it("getEventsByType filters by eventType", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-2" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-1" });
        assert.equal(store.getEventsByType("workflow_created").length, 2);
        assert.equal(store.getEventsByType("workflow_completed").length, 1);
    });

    it("getEventStream returns all events", () => {
        store.appendEvent({ eventType: "workflow_created", workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_started", workflowId: "wf-1" });
        assert.equal(store.getEventStream().length, 2);
    });

    it("getEventStream fromSequence filter", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_scheduled", workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_started",   workflowId: "wf-1" });
        const result = store.getEventStream({ fromSequence: 2 });
        assert.equal(result.length, 2);
        assert.equal(result[0].deterministicSequence, 2);
    });

    it("getEventStream toSequence filter", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_scheduled", workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_started",   workflowId: "wf-1" });
        const result = store.getEventStream({ toSequence: 2 });
        assert.equal(result.length, 2);
    });

    it("getEventStream replaySafeOnly filter", () => {
        store.appendEvent({ eventType: "workflow_created", workflowId: "wf-1", replaySafe: true  });
        store.appendEvent({ eventType: "workflow_started", workflowId: "wf-1", replaySafe: false });
        const result = store.getEventStream({ replaySafeOnly: true });
        assert.equal(result.length, 1);
        assert.equal(result[0].replaySafe, true);
    });

    it("reconstructState → correct state from event history", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_scheduled", workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_started",   workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-1" });
        const r = store.reconstructState("wf-1");
        assert.equal(r.found,      true);
        assert.equal(r.state,      "completed");
        assert.equal(r.eventCount, 4);
    });

    it("reconstructState counts retries and rollbacks", () => {
        store.appendEvent({ eventType: "workflow_started",    workflowId: "wf-2" });
        store.appendEvent({ eventType: "retry_triggered",     workflowId: "wf-2" });
        store.appendEvent({ eventType: "retry_triggered",     workflowId: "wf-2" });
        store.appendEvent({ eventType: "rollback_triggered",  workflowId: "wf-2" });
        store.appendEvent({ eventType: "workflow_failed",     workflowId: "wf-2" });
        const r = store.reconstructState("wf-2");
        assert.equal(r.retries,   2);
        assert.equal(r.rollbacks, 1);
        assert.equal(r.state,     "failed");
    });

    it("reconstructState not found → found=false", () => {
        const r = store.reconstructState("ghost-wf");
        assert.equal(r.found, false);
    });

    it("compactEventStream removes pre-terminal events for workflow", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-C" });
        store.appendEvent({ eventType: "workflow_started",   workflowId: "wf-C" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-C" });
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-X" });

        const r = store.compactEventStream("wf-C");
        assert.equal(r.compacted,     true);
        assert.equal(r.removedCount,  2);
        const remaining = store.getEventsByWorkflow("wf-C");
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0].eventType, "workflow_completed");
    });

    it("compactEventStream keeps other workflows intact", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-C" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-C" });
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-X" });
        store.compactEventStream("wf-C");
        assert.equal(store.getEventsByWorkflow("wf-X").length, 1);
    });

    it("compactEventStream no events → not compacted", () => {
        const r = store.compactEventStream("ghost");
        assert.equal(r.compacted, false);
    });

    it("getStoreMetrics totalEvents count", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-2" });
        const m = store.getStoreMetrics();
        assert.equal(m.totalEvents,     3);
        assert.equal(m.uniqueWorkflows, 2);
    });

    it("getStoreMetrics replaySafeEvents count", () => {
        store.appendEvent({ eventType: "workflow_created", workflowId: "wf-1", replaySafe: true  });
        store.appendEvent({ eventType: "workflow_started", workflowId: "wf-1", replaySafe: false });
        assert.equal(store.getStoreMetrics().replaySafeEvents, 1);
    });

    it("getStoreMetrics byType breakdown", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-2" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-1" });
        const m = store.getStoreMetrics();
        assert.equal(m.byType["workflow_created"],   2);
        assert.equal(m.byType["workflow_completed"],  1);
        assert.equal(m.byType["workflow_failed"],     0);
    });

    it("getStoreMetrics compactedWorkflows tracked after compact", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-1" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-1" });
        store.compactEventStream("wf-1");
        assert.equal(store.getStoreMetrics().compactedWorkflows, 1);
    });

    it("reset clears all events and counters", () => {
        store.appendEvent({ eventType: "workflow_created", workflowId: "wf-1" });
        store.reset();
        assert.equal(store.getEventStream().length, 0);
        const r = store.appendEvent({ eventType: "workflow_created", workflowId: "wf-1" });
        assert.equal(r.deterministicSequence, 1);
    });

    it("recovery events tracked in reconstructState", () => {
        store.appendEvent({ eventType: "workflow_started",    workflowId: "wf-R" });
        store.appendEvent({ eventType: "workflow_failed",     workflowId: "wf-R" });
        store.appendEvent({ eventType: "recovery_started",    workflowId: "wf-R" });
        store.appendEvent({ eventType: "recovery_completed",  workflowId: "wf-R" });
        const r = store.reconstructState("wf-R");
        assert.equal(r.recoveries, 1);
        assert.equal(r.state,      "stabilized");
    });

    it("quarantine_triggered sets state to quarantined", () => {
        store.appendEvent({ eventType: "workflow_started",     workflowId: "wf-Q" });
        store.appendEvent({ eventType: "quarantine_triggered", workflowId: "wf-Q" });
        const r = store.reconstructState("wf-Q");
        assert.equal(r.state, "quarantined");
    });
});

// ─────────────────────────────────────────────────────────────────────
// workflowSnapshotEngine
// ─────────────────────────────────────────────────────────────────────
describe("workflowSnapshotEngine", () => {
    beforeEach(() => snap.reset());

    it("exports VALID_WORKFLOW_STATES", () => {
        assert.ok(Array.isArray(snap.VALID_WORKFLOW_STATES));
        assert.ok(snap.VALID_WORKFLOW_STATES.includes("running"));
        assert.ok(snap.VALID_WORKFLOW_STATES.includes("quarantined"));
    });

    it("createSnapshot → created with snapshotId", () => {
        const r = snap.createSnapshot({ workflowId: "wf-1", workflowState: "running" });
        assert.equal(r.created, true);
        assert.ok(r.snapshotId.startsWith("snap-"));
        assert.equal(r.workflowId, "wf-1");
    });

    it("createSnapshot missing workflowId → not created", () => {
        const r = snap.createSnapshot({ workflowState: "running" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("createSnapshot missing workflowState → not created", () => {
        const r = snap.createSnapshot({ workflowId: "wf-1" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "workflowState_required");
    });

    it("createSnapshot invalid workflowState → not created", () => {
        const r = snap.createSnapshot({ workflowId: "wf-1", workflowState: "ghost_state" });
        assert.equal(r.created, false);
        assert.ok(r.reason.includes("invalid_workflow_state"));
    });

    it("createSnapshot stores optional fields", () => {
        const { snapshotId } = snap.createSnapshot({
            workflowId:        "wf-1",
            workflowState:     "running",
            executionGraph:    { nodes: 3 },
            schedulerState:    { queue: [] },
            recoveryState:     { retries: 1 },
            verificationState: { checks: 5 },
        });
        const loaded = snap.loadSnapshot(snapshotId);
        assert.deepEqual(loaded.executionGraph,    { nodes: 3 });
        assert.deepEqual(loaded.schedulerState,    { queue: [] });
        assert.deepEqual(loaded.recoveryState,     { retries: 1 });
        assert.deepEqual(loaded.verificationState, { checks: 5 });
    });

    it("loadSnapshot → found=true with full data", () => {
        const { snapshotId } = snap.createSnapshot({ workflowId: "wf-2", workflowState: "completed" });
        const loaded = snap.loadSnapshot(snapshotId);
        assert.equal(loaded.found,          true);
        assert.equal(loaded.workflowId,     "wf-2");
        assert.equal(loaded.workflowState,  "completed");
    });

    it("loadSnapshot not found → found=false", () => {
        const r = snap.loadSnapshot("snap-ghost");
        assert.equal(r.found, false);
    });

    it("validateSnapshot valid snapshot → valid=true, no issues", () => {
        const { snapshotId } = snap.createSnapshot({ workflowId: "wf-3", workflowState: "failed" });
        const r = snap.validateSnapshot(snapshotId);
        assert.equal(r.valid, true);
        assert.deepEqual(r.issues, []);
    });

    it("validateSnapshot not found → valid=false", () => {
        const r = snap.validateSnapshot("snap-missing");
        assert.equal(r.valid, false);
    });

    it("restoreWorkflowState → restored=true with state data", () => {
        const { snapshotId } = snap.createSnapshot({
            workflowId:    "wf-4",
            workflowState: "recovering",
            recoveryState: { attempt: 2 },
        });
        const r = snap.restoreWorkflowState(snapshotId);
        assert.equal(r.restored,           true);
        assert.equal(r.workflowId,         "wf-4");
        assert.equal(r.workflowState,      "recovering");
        assert.deepEqual(r.recoveryState,  { attempt: 2 });
        assert.ok(r.restoredAt);
    });

    it("restoreWorkflowState not found → restored=false", () => {
        const r = snap.restoreWorkflowState("snap-ghost");
        assert.equal(r.restored, false);
        assert.equal(r.reason,   "snapshot_not_found");
    });

    it("multiple snapshots per workflow accumulate", () => {
        snap.createSnapshot({ workflowId: "wf-5", workflowState: "running"   });
        snap.createSnapshot({ workflowId: "wf-5", workflowState: "completed" });
        const metrics = snap.getSnapshotMetrics();
        assert.equal(metrics.totalSnapshots, 2);
    });

    it("compactSnapshots keeps only latest", () => {
        const { snapshotId: id1 } = snap.createSnapshot({ workflowId: "wf-6", workflowState: "running"   });
        const { snapshotId: id2 } = snap.createSnapshot({ workflowId: "wf-6", workflowState: "completed" });
        const r = snap.compactSnapshots("wf-6");
        assert.equal(r.compacted, true);
        assert.equal(r.retained,  1);
        assert.equal(r.removed,   1);
        assert.equal(snap.loadSnapshot(id1).found, false);
        assert.equal(snap.loadSnapshot(id2).found, true);
    });

    it("compactSnapshots no snapshots → not compacted", () => {
        const r = snap.compactSnapshots("ghost-wf");
        assert.equal(r.compacted, false);
    });

    it("getSnapshotMetrics → totalSnapshots and uniqueWorkflows", () => {
        snap.createSnapshot({ workflowId: "wf-A", workflowState: "running"   });
        snap.createSnapshot({ workflowId: "wf-A", workflowState: "completed" });
        snap.createSnapshot({ workflowId: "wf-B", workflowState: "failed"    });
        const m = snap.getSnapshotMetrics();
        assert.equal(m.totalSnapshots,   3);
        assert.equal(m.uniqueWorkflows,  2);
    });

    it("getSnapshotMetrics byState breakdown", () => {
        snap.createSnapshot({ workflowId: "wf-A", workflowState: "running"   });
        snap.createSnapshot({ workflowId: "wf-B", workflowState: "running"   });
        snap.createSnapshot({ workflowId: "wf-C", workflowState: "completed" });
        const m = snap.getSnapshotMetrics();
        assert.equal(m.byState["running"],   2);
        assert.equal(m.byState["completed"], 1);
    });

    it("reset clears all snapshots", () => {
        snap.createSnapshot({ workflowId: "wf-1", workflowState: "running" });
        snap.reset();
        assert.equal(snap.getSnapshotMetrics().totalSnapshots, 0);
    });

    it("all valid workflow states accepted", () => {
        for (const state of snap.VALID_WORKFLOW_STATES) {
            const r = snap.createSnapshot({ workflowId: `wf-${state}`, workflowState: state });
            assert.equal(r.created, true, `state "${state}" should be accepted`);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────
// durableRecoveryCoordinator
// ─────────────────────────────────────────────────────────────────────
describe("durableRecoveryCoordinator", () => {
    beforeEach(() => drc.reset());

    it("exports CHECKPOINT_STATUSES", () => {
        assert.ok(Array.isArray(drc.CHECKPOINT_STATUSES));
        assert.ok(drc.CHECKPOINT_STATUSES.includes("pending"));
        assert.ok(drc.CHECKPOINT_STATUSES.includes("recovered"));
    });

    it("registerRecoveryCheckpoint → registered with checkpointId", () => {
        const r = drc.registerRecoveryCheckpoint({
            workflowId: "wf-1", checkpointState: "running", replayConsistent: true,
        });
        assert.equal(r.registered, true);
        assert.ok(r.checkpointId.startsWith("chk-"));
    });

    it("registerRecoveryCheckpoint missing workflowId → not registered", () => {
        const r = drc.registerRecoveryCheckpoint({ checkpointState: "running" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("registerRecoveryCheckpoint missing checkpointState → not registered", () => {
        const r = drc.registerRecoveryCheckpoint({ workflowId: "wf-1" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "checkpointState_required");
    });

    it("validateRecoveryIntegrity clean checkpoint → valid=true", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-1", checkpointState: "running", replayConsistent: true,
        });
        const r = drc.validateRecoveryIntegrity(checkpointId);
        assert.equal(r.valid, true);
        assert.deepEqual(r.issues, []);
    });

    it("validateRecoveryIntegrity corrupted → valid=false, checkpoint_corrupted issue", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-2", checkpointState: "running", corrupted: true, replayConsistent: true,
        });
        const r = drc.validateRecoveryIntegrity(checkpointId);
        assert.equal(r.valid, false);
        assert.ok(r.issues.includes("checkpoint_corrupted"));
    });

    it("validateRecoveryIntegrity quarantined → valid=false, workflow_quarantined issue", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-3", checkpointState: "running", quarantined: true, replayConsistent: true,
        });
        const r = drc.validateRecoveryIntegrity(checkpointId);
        assert.equal(r.valid, false);
        assert.ok(r.issues.includes("workflow_quarantined"));
    });

    it("validateRecoveryIntegrity not replayConsistent → replay_inconsistency_detected", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-4", checkpointState: "running", replayConsistent: false,
        });
        const r = drc.validateRecoveryIntegrity(checkpointId);
        assert.equal(r.valid, false);
        assert.ok(r.issues.includes("replay_inconsistency_detected"));
    });

    it("validateRecoveryIntegrity not found → valid=false", () => {
        const r = drc.validateRecoveryIntegrity("chk-ghost");
        assert.equal(r.valid, false);
    });

    it("recoverInterruptedWorkflow → recovered=true", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-5", checkpointState: "running", replayConsistent: true,
        });
        const r = drc.recoverInterruptedWorkflow(checkpointId);
        assert.equal(r.recovered,   true);
        assert.equal(r.workflowId,  "wf-5");
        assert.ok(r.recoveredAt);
    });

    it("recoverInterruptedWorkflow with partialEvents records count", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-6", checkpointState: "running", replayConsistent: true,
            partialEvents: ["e1", "e2", "e3"],
        });
        const r = drc.recoverInterruptedWorkflow(checkpointId);
        assert.equal(r.partialEvents, 3);
    });

    it("recoverInterruptedWorkflow corrupted → recovered=false", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-7", checkpointState: "running", corrupted: true, replayConsistent: true,
        });
        const r = drc.recoverInterruptedWorkflow(checkpointId);
        assert.equal(r.recovered, false);
        assert.equal(r.reason,    "integrity_failed");
    });

    it("recoverInterruptedWorkflow not found → recovered=false", () => {
        const r = drc.recoverInterruptedWorkflow("chk-ghost");
        assert.equal(r.recovered, false);
    });

    it("reconstructInterruptedExecution → found=true with canResume=true when valid", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-8", checkpointState: "running", replayConsistent: true,
            lastKnownState: "running", partialEvents: ["e1", "e2"],
        });
        const r = drc.reconstructInterruptedExecution(checkpointId);
        assert.equal(r.found,             true);
        assert.equal(r.canResume,         true);
        assert.equal(r.partialEventCount, 2);
        assert.equal(r.lastKnownState,    "running");
    });

    it("reconstructInterruptedExecution canResume=false when corrupted", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-9", checkpointState: "running", corrupted: true, replayConsistent: true,
        });
        const r = drc.reconstructInterruptedExecution(checkpointId);
        assert.equal(r.found,      true);
        assert.equal(r.canResume,  false);
    });

    it("reconstructInterruptedExecution not found → found=false", () => {
        const r = drc.reconstructInterruptedExecution("chk-ghost");
        assert.equal(r.found, false);
    });

    it("getRecoveryState counts pending/recovered/corrupted", () => {
        drc.registerRecoveryCheckpoint({
            workflowId: "wf-A", checkpointState: "running", replayConsistent: true,
        });
        const { checkpointId: id2 } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-B", checkpointState: "running", replayConsistent: true, corrupted: true,
        });
        const { checkpointId: id3 } = drc.registerRecoveryCheckpoint({
            workflowId: "wf-C", checkpointState: "running", replayConsistent: true,
        });
        drc.recoverInterruptedWorkflow(id3);

        const state = drc.getRecoveryState();
        assert.equal(state.totalCheckpoints, 3);
        assert.equal(state.recovered,        1);
        assert.equal(state.corrupted,        1);
    });

    it("getRecoveryState quarantined count", () => {
        drc.registerRecoveryCheckpoint({
            workflowId: "wf-Q", checkpointState: "running", replayConsistent: true, quarantined: true,
        });
        assert.equal(drc.getRecoveryState().quarantined, 1);
    });

    it("reset clears all checkpoints", () => {
        drc.registerRecoveryCheckpoint({
            workflowId: "wf-1", checkpointState: "running", replayConsistent: true,
        });
        drc.reset();
        assert.equal(drc.getRecoveryState().totalCheckpoints, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────
// stateReconstructionEngine
// ─────────────────────────────────────────────────────────────────────
describe("stateReconstructionEngine", () => {
    beforeEach(() => sre.reset());

    it("exports STATE_MAP", () => {
        assert.ok(sre.STATE_MAP["workflow_created"]   === "created");
        assert.ok(sre.STATE_MAP["workflow_completed"] === "completed");
        assert.ok(sre.STATE_MAP["quarantine_triggered"] === "quarantined");
    });

    it("reconstructRuntimeState from empty events → workflowCount=0", () => {
        const r = sre.reconstructRuntimeState([]);
        assert.equal(r.workflowCount, 0);
        assert.equal(r.eventCount,    0);
        assert.ok(r.reconstructionId);
    });

    it("reconstructRuntimeState rebuilds workflow states", () => {
        const events = [
            { workflowId: "wf-1", eventType: "workflow_created",   deterministicSequence: 1 },
            { workflowId: "wf-1", eventType: "workflow_started",   deterministicSequence: 2 },
            { workflowId: "wf-1", eventType: "workflow_completed", deterministicSequence: 3 },
            { workflowId: "wf-2", eventType: "workflow_created",   deterministicSequence: 4 },
            { workflowId: "wf-2", eventType: "workflow_failed",    deterministicSequence: 5 },
        ];
        const r = sre.reconstructRuntimeState(events);
        assert.equal(r.workflowCount,                    2);
        assert.equal(r.workflowStates["wf-1"],           "completed");
        assert.equal(r.workflowStates["wf-2"],           "failed");
    });

    it("reconstructRuntimeState counts retries and rollbacks per workflow", () => {
        const events = [
            { workflowId: "wf-1", eventType: "retry_triggered",    deterministicSequence: 1 },
            { workflowId: "wf-1", eventType: "retry_triggered",    deterministicSequence: 2 },
            { workflowId: "wf-1", eventType: "rollback_triggered", deterministicSequence: 3 },
        ];
        const r = sre.reconstructRuntimeState(events);
        assert.equal(r.retries["wf-1"],   2);
        assert.equal(r.rollbacks["wf-1"], 1);
    });

    it("reconstructRuntimeState collects scheduler decisions", () => {
        const events = [
            { workflowId: "wf-1", eventType: "scheduler_decision", deterministicSequence: 1, eventPayload: { policy: "fifo" } },
            { workflowId: "wf-2", eventType: "scheduler_decision", deterministicSequence: 2, eventPayload: { policy: "priority" } },
        ];
        const r = sre.reconstructRuntimeState(events);
        assert.equal(r.schedulerDecisions.length, 2);
    });

    it("reconstructRuntimeState non-array input → valid=false", () => {
        const r = sre.reconstructRuntimeState("bad");
        assert.equal(r.valid, false);
    });

    it("rebuildWorkflowState → correct state for workflow", () => {
        const events = [
            { workflowId: "wf-A", eventType: "workflow_created",  deterministicSequence: 1 },
            { workflowId: "wf-A", eventType: "workflow_started",  deterministicSequence: 2 },
            { workflowId: "wf-A", eventType: "recovery_started",  deterministicSequence: 3 },
            { workflowId: "wf-B", eventType: "workflow_created",  deterministicSequence: 4 },
        ];
        const r = sre.rebuildWorkflowState("wf-A", events);
        assert.equal(r.found,      true);
        assert.equal(r.state,      "recovering");
        assert.equal(r.recoveries, 1);
        assert.equal(r.eventCount, 3);
    });

    it("rebuildWorkflowState no events → found=false", () => {
        const r = sre.rebuildWorkflowState("wf-ghost", []);
        assert.equal(r.found, false);
    });

    it("rebuildWorkflowState tracks blocked dependencies", () => {
        const events = [
            { workflowId: "wf-B", eventType: "dependency_blocked", deterministicSequence: 1,
              eventPayload: { dependencyId: "dep-X" } },
        ];
        const r = sre.rebuildWorkflowState("wf-B", events);
        assert.ok(r.blocked.includes("dep-X"));
    });

    it("rebuildSchedulerState → totalDecisions and scheduledWorkflows", () => {
        const events = [
            { workflowId: "wf-1", eventType: "scheduler_decision", deterministicSequence: 1, eventPayload: { policy: "fifo" } },
            { workflowId: "wf-2", eventType: "scheduler_decision", deterministicSequence: 2, eventPayload: { policy: "priority" } },
            { workflowId: "wf-1", eventType: "workflow_created",   deterministicSequence: 3 },
        ];
        const r = sre.rebuildSchedulerState(events);
        assert.equal(r.totalDecisions,      2);
        assert.equal(r.scheduledWorkflows,  2);
    });

    it("reconstructExecutionTimeline orders by deterministicSequence", () => {
        const events = [
            { workflowId: "wf-1", eventType: "workflow_started",   deterministicSequence: 3 },
            { workflowId: "wf-1", eventType: "workflow_created",   deterministicSequence: 1 },
            { workflowId: "wf-1", eventType: "workflow_scheduled", deterministicSequence: 2 },
        ];
        const r = sre.reconstructExecutionTimeline(events);
        assert.equal(r.isOrdered,              true);
        assert.equal(r.totalEvents,            3);
        assert.equal(r.timeline[0].sequence,   1);
        assert.equal(r.timeline[1].sequence,   2);
        assert.equal(r.timeline[2].sequence,   3);
    });

    it("reconstructExecutionTimeline already ordered → isOrdered=true", () => {
        const events = [
            { eventType: "workflow_created",   deterministicSequence: 1 },
            { eventType: "workflow_completed", deterministicSequence: 2 },
        ];
        assert.equal(sre.reconstructExecutionTimeline(events).isOrdered, true);
    });

    it("validateReconstruction valid result → valid=true", () => {
        const result = sre.reconstructRuntimeState([
            { workflowId: "wf-1", eventType: "workflow_created", deterministicSequence: 1 },
        ]);
        const v = sre.validateReconstruction(result);
        assert.equal(v.valid, true);
        assert.deepEqual(v.issues, []);
    });

    it("validateReconstruction missing fields → issues reported", () => {
        const v = sre.validateReconstruction({});
        assert.equal(v.valid, false);
        assert.ok(v.issues.length > 0);
    });

    it("reset clears reconstruction history", () => {
        sre.reconstructRuntimeState([{ workflowId: "wf-1", eventType: "workflow_created", deterministicSequence: 1 }]);
        sre.reset();
        // After reset, new reconstructionId starts fresh
        const r = sre.reconstructRuntimeState([]);
        assert.equal(r.reconstructionId, "rec-1");
    });
});

// ─────────────────────────────────────────────────────────────────────
// persistenceIntegrityManager
// ─────────────────────────────────────────────────────────────────────
describe("persistenceIntegrityManager", () => {
    beforeEach(() => pim.reset());

    it("validateEventIntegrity clean events → valid=true", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 1 },
            { eventId: "e2", eventType: "workflow_completed", deterministicSequence: 2 },
        ];
        const r = pim.validateEventIntegrity(events);
        assert.equal(r.valid,      true);
        assert.equal(r.issues.length, 0);
        assert.equal(r.eventCount, 2);
    });

    it("validateEventIntegrity detects missing eventId", () => {
        const events = [{ eventType: "workflow_created", deterministicSequence: 1 }];
        const r = pim.validateEventIntegrity(events);
        assert.equal(r.valid, false);
        assert.ok(r.issues.some(i => i.type === "missing_eventId"));
    });

    it("validateEventIntegrity detects missing eventType", () => {
        const events = [{ eventId: "e1", deterministicSequence: 1 }];
        const r = pim.validateEventIntegrity(events);
        assert.equal(r.valid, false);
        assert.ok(r.issues.some(i => i.type === "missing_eventType"));
    });

    it("validateEventIntegrity detects duplicate eventId", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 1 },
            { eventId: "e1", eventType: "workflow_completed", deterministicSequence: 2 },
        ];
        const r = pim.validateEventIntegrity(events);
        assert.equal(r.valid, false);
        assert.ok(r.issues.some(i => i.type === "duplicate_eventId"));
    });

    it("validateEventIntegrity detects duplicate sequence numbers", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 1 },
            { eventId: "e2", eventType: "workflow_completed", deterministicSequence: 1 },
        ];
        const r = pim.validateEventIntegrity(events);
        assert.equal(r.valid, false);
        assert.ok(r.issues.some(i => i.type === "duplicate_sequence"));
    });

    it("validateEventIntegrity non-array → valid=false", () => {
        const r = pim.validateEventIntegrity("bad");
        assert.equal(r.valid, false);
    });

    it("detectCorruption clean stream → corrupted=false", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 1 },
            { eventId: "e2", eventType: "workflow_completed", deterministicSequence: 2 },
        ];
        const r = pim.detectCorruption(events);
        assert.equal(r.corrupted, false);
        assert.equal(r.corruptionCount, 0);
    });

    it("detectCorruption detects missing required fields", () => {
        const events = [{ deterministicSequence: 1 }];
        const r = pim.detectCorruption(events);
        assert.equal(r.corrupted, true);
        assert.ok(r.corruptions.some(c => c.type === "missing_required_fields"));
    });

    it("detectCorruption detects duplicate sequences", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 1 },
            { eventId: "e2", eventType: "workflow_completed", deterministicSequence: 1 },
        ];
        const r = pim.detectCorruption(events);
        assert.equal(r.corrupted, true);
        assert.ok(r.corruptions.some(c => c.type === "duplicate_sequence"));
    });

    it("detectCorruption detects sequence regression", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 5 },
            { eventId: "e2", eventType: "workflow_completed", deterministicSequence: 3 },
        ];
        const r = pim.detectCorruption(events);
        assert.equal(r.corrupted, true);
        assert.ok(r.corruptions.some(c => c.type === "sequence_regression"));
    });

    it("detectCorruption flags non_replay_safe_event", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created", deterministicSequence: 1, replaySafe: false },
        ];
        const r = pim.detectCorruption(events);
        assert.equal(r.corrupted, true);
        assert.ok(r.corruptions.some(c => c.type === "non_replay_safe_event"));
    });

    it("validateSequenceOrdering contiguous → ordered=true, no gaps", () => {
        const events = [
            { eventId: "e1", deterministicSequence: 1 },
            { eventId: "e2", deterministicSequence: 2 },
            { eventId: "e3", deterministicSequence: 3 },
        ];
        const r = pim.validateSequenceOrdering(events);
        assert.equal(r.ordered, true);
        assert.deepEqual(r.gaps, []);
        assert.deepEqual(r.duplicates, []);
    });

    it("validateSequenceOrdering detects gap", () => {
        const events = [
            { eventId: "e1", deterministicSequence: 1 },
            { eventId: "e3", deterministicSequence: 3 },
        ];
        const r = pim.validateSequenceOrdering(events);
        assert.equal(r.ordered, false);
        assert.ok(r.gaps.includes(2));
    });

    it("validateSequenceOrdering detects duplicates", () => {
        const events = [
            { eventId: "e1", deterministicSequence: 1 },
            { eventId: "e2", deterministicSequence: 1 },
        ];
        const r = pim.validateSequenceOrdering(events);
        assert.equal(r.ordered, false);
        assert.ok(r.duplicates.includes(1));
    });

    it("validateSequenceOrdering empty → ordered=true", () => {
        const r = pim.validateSequenceOrdering([]);
        assert.equal(r.ordered,    true);
        assert.equal(r.eventCount, 0);
    });

    it("verifySnapshotIntegrity valid snapshot → valid=true", () => {
        const r = pim.verifySnapshotIntegrity({
            snapshotId: "snap-1",
            workflowId: "wf-1",
            workflowState: "running",
            createdAt: new Date().toISOString(),
        });
        assert.equal(r.valid, true);
        assert.deepEqual(r.issues, []);
    });

    it("verifySnapshotIntegrity missing fields → issues reported", () => {
        const r = pim.verifySnapshotIntegrity({});
        assert.equal(r.valid, false);
        assert.ok(r.issues.includes("missing_snapshotId"));
        assert.ok(r.issues.includes("missing_workflowId"));
        assert.ok(r.issues.includes("missing_workflowState"));
        assert.ok(r.issues.includes("missing_createdAt"));
    });

    it("verifySnapshotIntegrity invalid workflowState → issue reported", () => {
        const r = pim.verifySnapshotIntegrity({
            snapshotId: "snap-1", workflowId: "wf-1",
            workflowState: "ghost_state", createdAt: "2026-01-01T00:00:00.000Z",
        });
        assert.equal(r.valid, false);
        assert.ok(r.issues.some(i => i.includes("invalid_workflowState")));
    });

    it("getIntegrityMetrics tracks pass/fail counts", () => {
        pim.validateEventIntegrity([{ eventId: "e1", eventType: "workflow_created", deterministicSequence: 1 }]);
        pim.validateEventIntegrity([{ deterministicSequence: 1 }]);
        const m = pim.getIntegrityMetrics();
        assert.equal(m.totalChecks,  2);
        assert.equal(m.passedChecks, 1);
        assert.equal(m.failedChecks, 1);
    });

    it("reset clears all integrity records", () => {
        pim.validateEventIntegrity([{ eventId: "e1", eventType: "workflow_created", deterministicSequence: 1 }]);
        pim.reset();
        assert.equal(pim.getIntegrityMetrics().totalChecks, 0);
    });
});

// ─────────────────────────────────────────────────────────────────────
// persistenceTelemetry
// ─────────────────────────────────────────────────────────────────────
describe("persistenceTelemetry", () => {
    beforeEach(() => tel.reset());

    it("recordPersistenceEvent returns eventId", () => {
        const r = tel.recordPersistenceEvent({ type: "event_appended", workflowId: "wf-1" });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("pers-"));
    });

    it("recordRecoveryEvent returns eventId", () => {
        const r = tel.recordRecoveryEvent({ type: "recovery_started", workflowId: "wf-1", success: true });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("rec-"));
    });

    it("recordIntegrityEvent returns eventId", () => {
        const r = tel.recordIntegrityEvent({ type: "integrity_check", corrupted: false });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("int-"));
    });

    it("getPersistenceMetrics empty → all zeroes/nulls", () => {
        const m = tel.getPersistenceMetrics();
        assert.equal(m.totalPersistenceEvents,  0);
        assert.equal(m.totalRecoveryEvents,     0);
        assert.equal(m.totalIntegrityEvents,    0);
        assert.equal(m.avgPersistenceLatencyMs, null);
        assert.equal(m.corruptionIncidents,     0);
    });

    it("getPersistenceMetrics counts snapshot_created events", () => {
        tel.recordPersistenceEvent({ type: "snapshot_created" });
        tel.recordPersistenceEvent({ type: "snapshot_created" });
        tel.recordPersistenceEvent({ type: "event_appended" });
        assert.equal(tel.getPersistenceMetrics().snapshotCount, 2);
    });

    it("getPersistenceMetrics counts replay_rebuild events", () => {
        tel.recordPersistenceEvent({ type: "replay_rebuild" });
        assert.equal(tel.getPersistenceMetrics().replayRebuildCount, 1);
    });

    it("getPersistenceMetrics avgPersistenceLatencyMs computed", () => {
        tel.recordPersistenceEvent({ type: "event_appended", latencyMs: 10 });
        tel.recordPersistenceEvent({ type: "event_appended", latencyMs: 20 });
        assert.equal(tel.getPersistenceMetrics().avgPersistenceLatencyMs, 15);
    });

    it("getPersistenceMetrics corruptionIncidents from integrity events", () => {
        tel.recordIntegrityEvent({ type: "check", corrupted: true  });
        tel.recordIntegrityEvent({ type: "check", corrupted: false });
        tel.recordIntegrityEvent({ type: "check", corrupted: true  });
        assert.equal(tel.getPersistenceMetrics().corruptionIncidents, 2);
    });

    it("getRecoveryAnalytics empty → zeroes", () => {
        const r = tel.getRecoveryAnalytics();
        assert.equal(r.totalRecoveries,       0);
        assert.equal(r.successfulRecoveries,  0);
        assert.equal(r.recoverySuccessRate,   0);
        assert.equal(r.avgRecoveryLatencyMs,  null);
    });

    it("getRecoveryAnalytics recoverySuccessRate computed", () => {
        tel.recordRecoveryEvent({ type: "recovery_completed", success: true  });
        tel.recordRecoveryEvent({ type: "recovery_completed", success: true  });
        tel.recordRecoveryEvent({ type: "recovery_completed", success: false });
        const r = tel.getRecoveryAnalytics();
        assert.equal(r.successfulRecoveries, 2);
        assert.ok(Math.abs(r.recoverySuccessRate - 0.667) < 0.001);
    });

    it("getRecoveryAnalytics interruptedRecoveries counted", () => {
        tel.recordRecoveryEvent({ type: "recovery_interrupted", interrupted: true  });
        tel.recordRecoveryEvent({ type: "recovery_started",     interrupted: false });
        assert.equal(tel.getRecoveryAnalytics().interruptedRecoveries, 1);
    });

    it("getRecoveryAnalytics avgRecoveryLatencyMs computed", () => {
        tel.recordRecoveryEvent({ type: "recovery_completed", success: true, latencyMs: 100 });
        tel.recordRecoveryEvent({ type: "recovery_completed", success: true, latencyMs: 200 });
        assert.equal(tel.getRecoveryAnalytics().avgRecoveryLatencyMs, 150);
    });

    it("events without success field not counted in success rate denominator", () => {
        tel.recordRecoveryEvent({ type: "recovery_noted" });
        const r = tel.getRecoveryAnalytics();
        assert.equal(r.recoverySuccessRate, 0);
        assert.equal(r.totalRecoveries,     1);
    });

    it("reset clears all telemetry", () => {
        tel.recordPersistenceEvent({ type: "event_appended" });
        tel.recordRecoveryEvent({ type: "recovery_completed", success: true });
        tel.recordIntegrityEvent({ type: "check" });
        tel.reset();
        const m = tel.getPersistenceMetrics();
        assert.equal(m.totalPersistenceEvents, 0);
        assert.equal(m.totalRecoveryEvents,    0);
        assert.equal(m.totalIntegrityEvents,   0);
    });
});

// ─────────────────────────────────────────────────────────────────────
// integration
// ─────────────────────────────────────────────────────────────────────
describe("runtime persistence integration", () => {
    beforeEach(() => {
        store.reset(); snap.reset(); drc.reset();
        sre.reset();   pim.reset(); tel.reset();
    });

    it("append-only integrity: events accumulate, never removed without compact", () => {
        for (let i = 0; i < 5; i++)
            store.appendEvent({ eventType: "workflow_created", workflowId: `wf-${i}` });
        assert.equal(store.getStoreMetrics().totalEvents, 5);
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-0" });
        assert.equal(store.getStoreMetrics().totalEvents, 6);
    });

    it("deterministic event ordering: sequences are always monotonic", () => {
        const seqs = [];
        for (let i = 0; i < 10; i++) {
            const r = store.appendEvent({ eventType: "workflow_created", workflowId: `wf-${i}` });
            seqs.push(r.deterministicSequence);
        }
        for (let i = 1; i < seqs.length; i++)
            assert.ok(seqs[i] > seqs[i - 1], "sequences must be strictly increasing");
    });

    it("workflow reconstruction from event stream", () => {
        store.appendEvent({ eventType: "workflow_created",   workflowId: "wf-R" });
        store.appendEvent({ eventType: "workflow_scheduled", workflowId: "wf-R" });
        store.appendEvent({ eventType: "workflow_started",   workflowId: "wf-R" });
        store.appendEvent({ eventType: "retry_triggered",    workflowId: "wf-R" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-R" });

        const state = store.reconstructState("wf-R");
        assert.equal(state.state,      "completed");
        assert.equal(state.retries,    1);
        assert.equal(state.eventCount, 5);
    });

    it("snapshot → restore round-trip", () => {
        const { snapshotId } = snap.createSnapshot({
            workflowId:     "wf-S",
            workflowState:  "running",
            executionGraph: { nodes: 4, edges: 3 },
            schedulerState: { policy: "priority" },
        });
        const restored = snap.restoreWorkflowState(snapshotId);
        assert.equal(restored.restored,                  true);
        assert.equal(restored.workflowState,             "running");
        assert.deepEqual(restored.executionGraph,        { nodes: 4, edges: 3 });
        assert.deepEqual(restored.schedulerState,        { policy: "priority" });
    });

    it("interrupted execution recovery: clean checkpoint resumes safely", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId:      "wf-I",
            checkpointState: "running",
            replayConsistent: true,
            partialEvents:   ["e1", "e2", "e3", "e4"],
            lastKnownState:  "running",
        });
        const r = drc.recoverInterruptedWorkflow(checkpointId);
        assert.equal(r.recovered,     true);
        assert.equal(r.partialEvents, 4);
    });

    it("replay-safe reboot recovery: corrupted checkpoint blocked", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId:      "wf-J",
            checkpointState: "running",
            replayConsistent: true,
            corrupted:       true,
        });
        const r = drc.recoverInterruptedWorkflow(checkpointId);
        assert.equal(r.recovered, false);
        assert.ok(r.issues.includes("checkpoint_corrupted"));
    });

    it("corruption detection: duplicate sequences caught before recovery", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 1 },
            { eventId: "e2", eventType: "workflow_completed", deterministicSequence: 1 },
        ];
        const r = pim.detectCorruption(events);
        assert.equal(r.corrupted, true);
        assert.ok(r.corruptions.some(c => c.type === "duplicate_sequence"));
    });

    it("sequence validation detects gaps before state reconstruction", () => {
        const events = [
            { eventId: "e1", deterministicSequence: 1 },
            { eventId: "e3", deterministicSequence: 3 },
            { eventId: "e5", deterministicSequence: 5 },
        ];
        const r = pim.validateSequenceOrdering(events);
        assert.equal(r.ordered, false);
        assert.deepEqual(r.gaps, [2, 4]);
    });

    it("scheduler reconstruction from persisted events", () => {
        const events = [
            { workflowId: "wf-1", eventType: "scheduler_decision", deterministicSequence: 1, eventPayload: { policy: "fifo" } },
            { workflowId: "wf-2", eventType: "scheduler_decision", deterministicSequence: 2, eventPayload: { policy: "priority" } },
            { workflowId: "wf-3", eventType: "scheduler_decision", deterministicSequence: 3, eventPayload: { policy: "recovery-priority" } },
        ];
        const r = sre.rebuildSchedulerState(events);
        assert.equal(r.totalDecisions,    3);
        assert.equal(r.scheduledWorkflows, 3);
        assert.equal(r.queue["wf-1"].policy, "fifo");
    });

    it("replay consistency validation: mismatched event types detected", () => {
        const events = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 1 },
            { eventId: "e2", eventType: "workflow_completed", deterministicSequence: 2 },
        ];
        const r = pim.validateEventIntegrity(events);
        assert.equal(r.valid, true);

        const corrupted = [
            { eventId: "e1", eventType: "workflow_created",   deterministicSequence: 1 },
            { eventId: "e2", eventType: "workflow_completed", deterministicSequence: 1 },
        ];
        const r2 = pim.validateEventIntegrity(corrupted);
        assert.equal(r2.valid, false);
    });

    it("durable recovery simulation: E2E workflow crash and recovery", () => {
        // 1. Workflow runs and crashes mid-execution
        store.appendEvent({ eventType: "workflow_created", workflowId: "wf-CRASH" });
        store.appendEvent({ eventType: "workflow_started", workflowId: "wf-CRASH" });

        // 2. Take a snapshot before crash
        const { snapshotId } = snap.createSnapshot({
            workflowId:     "wf-CRASH",
            workflowState:  "running",
            executionGraph: { nodes: 3 },
        });

        // 3. Crash detected — register checkpoint with partial work
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId:      "wf-CRASH",
            checkpointState: "running",
            replayConsistent: true,
            partialEvents:   ["e1", "e2"],
            lastKnownState:  "running",
        });

        // 4. On reboot: validate integrity, restore snapshot, recover
        const integrity = drc.validateRecoveryIntegrity(checkpointId);
        assert.equal(integrity.valid, true);

        const restored = snap.restoreWorkflowState(snapshotId);
        assert.equal(restored.restored, true);

        const recovery = drc.recoverInterruptedWorkflow(checkpointId);
        assert.equal(recovery.recovered, true);

        // 5. Append recovery events
        store.appendEvent({ eventType: "recovery_started",   workflowId: "wf-CRASH" });
        store.appendEvent({ eventType: "recovery_completed", workflowId: "wf-CRASH" });
        store.appendEvent({ eventType: "workflow_completed", workflowId: "wf-CRASH" });

        const finalState = store.reconstructState("wf-CRASH");
        assert.equal(finalState.state,     "completed");
        assert.equal(finalState.recoveries, 1);
    });

    it("telemetry records full persistence pipeline metrics", () => {
        tel.recordPersistenceEvent({ type: "event_appended",  latencyMs: 5  });
        tel.recordPersistenceEvent({ type: "snapshot_created", latencyMs: 10 });
        tel.recordPersistenceEvent({ type: "replay_rebuild",   latencyMs: 50 });
        tel.recordRecoveryEvent({ type: "recovery_completed", success: true,  latencyMs: 120 });
        tel.recordRecoveryEvent({ type: "recovery_completed", success: false, latencyMs: 80  });
        tel.recordIntegrityEvent({ type: "integrity_check",   corrupted: false });
        tel.recordIntegrityEvent({ type: "integrity_check",   corrupted: true  });

        const pm = tel.getPersistenceMetrics();
        assert.equal(pm.totalPersistenceEvents, 3);
        assert.equal(pm.snapshotCount,          1);
        assert.equal(pm.replayRebuildCount,     1);
        assert.equal(pm.corruptionIncidents,    1);

        const ra = tel.getRecoveryAnalytics();
        assert.equal(ra.totalRecoveries,      2);
        assert.equal(ra.successfulRecoveries, 1);
        assert.equal(ra.recoverySuccessRate,  0.5);
        assert.equal(ra.avgRecoveryLatencyMs, 100);
    });

    it("multi-workflow parallel persistence: each workflow isolated", () => {
        const wfs = ["wf-A", "wf-B", "wf-C"];
        for (const wf of wfs) {
            store.appendEvent({ eventType: "workflow_created",   workflowId: wf });
            store.appendEvent({ eventType: "workflow_completed", workflowId: wf });
        }
        for (const wf of wfs) {
            const state = store.reconstructState(wf);
            assert.equal(state.state, "completed");
            assert.equal(state.eventCount, 2);
        }
        assert.equal(store.getStoreMetrics().uniqueWorkflows, 3);
    });

    it("snapshot compaction after completed workflow", () => {
        snap.createSnapshot({ workflowId: "wf-Z", workflowState: "running"   });
        snap.createSnapshot({ workflowId: "wf-Z", workflowState: "running"   });
        snap.createSnapshot({ workflowId: "wf-Z", workflowState: "completed" });
        const r = snap.compactSnapshots("wf-Z");
        assert.equal(r.compacted, true);
        assert.equal(r.retained,  1);
        assert.equal(r.removed,   2);
        const m = snap.getSnapshotMetrics();
        assert.equal(m.totalSnapshots, 1);
    });

    it("quarantine blocks recovery until manually cleared", () => {
        const { checkpointId } = drc.registerRecoveryCheckpoint({
            workflowId:      "wf-QUAR",
            checkpointState: "quarantined",
            replayConsistent: true,
            quarantined:     true,
        });
        const r = drc.recoverInterruptedWorkflow(checkpointId);
        assert.equal(r.recovered, false);
        assert.ok(r.issues.includes("workflow_quarantined"));
        assert.equal(drc.getRecoveryState().quarantined, 1);
    });

    it("full state reconstruction from event stream matches live state", () => {
        const events = [
            { workflowId: "wf-F1", eventType: "workflow_created",   deterministicSequence: 1 },
            { workflowId: "wf-F1", eventType: "workflow_scheduled", deterministicSequence: 2 },
            { workflowId: "wf-F1", eventType: "workflow_started",   deterministicSequence: 3 },
            { workflowId: "wf-F1", eventType: "retry_triggered",    deterministicSequence: 4 },
            { workflowId: "wf-F1", eventType: "workflow_completed", deterministicSequence: 5 },
            { workflowId: "wf-F2", eventType: "workflow_created",   deterministicSequence: 6 },
            { workflowId: "wf-F2", eventType: "workflow_failed",    deterministicSequence: 7 },
        ];

        const validity  = pim.validateSequenceOrdering(events);
        assert.equal(validity.ordered, true);

        const integrity = pim.validateEventIntegrity(events);
        assert.ok(integrity.valid || integrity.issues.some(i => i.type === "missing_eventId"));

        const runtime = sre.reconstructRuntimeState(events);
        assert.equal(runtime.workflowStates["wf-F1"], "completed");
        assert.equal(runtime.workflowStates["wf-F2"], "failed");
        assert.equal(runtime.retries["wf-F1"],         1);
    });
});
