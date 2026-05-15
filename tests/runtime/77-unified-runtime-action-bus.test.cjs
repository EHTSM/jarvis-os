"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const envelopeManager    = require("../../agents/runtime/action-bus/actionEnvelopeManager.cjs");
const actionRegistry     = require("../../agents/runtime/action-bus/runtimeActionRegistry.cjs");
const routingEngine      = require("../../agents/runtime/action-bus/actionRoutingEngine.cjs");
const eventDispatcher    = require("../../agents/runtime/action-bus/deterministicEventDispatcher.cjs");
const replayCoordinator  = require("../../agents/runtime/action-bus/actionReplayCoordinator.cjs");
const signalBridge       = require("../../agents/runtime/action-bus/executionSignalBridge.cjs");
const unifiedBus         = require("../../agents/runtime/action-bus/unifiedActionBus.cjs");
const telemetryHub       = require("../../agents/runtime/action-bus/actionTelemetryHub.cjs");

// ── actionEnvelopeManager ─────────────────────────────────────────────

describe("actionEnvelopeManager", () => {
    beforeEach(() => envelopeManager.reset());

    it("creates a valid envelope with required fields", () => {
        const r = envelopeManager.createEnvelope({
            workflowId: "wf-1", sourceSubsystem: "scheduler",
            targetSubsystem: "executor", actionType: "execute",
        });
        assert.ok(r.created);
        assert.ok(r.envelope.actionId.startsWith("action-"));
        assert.equal(r.envelope.workflowId, "wf-1");
        assert.equal(r.envelope.sourceSubsystem, "scheduler");
        assert.equal(r.envelope.actionType, "execute");
        assert.equal(r.envelope.lifecycleState, "queued");
    });

    it("rejects envelope creation without workflowId", () => {
        const r = envelopeManager.createEnvelope({ sourceSubsystem: "s", targetSubsystem: "t", actionType: "execute" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "workflowId_required");
    });

    it("rejects envelope creation without sourceSubsystem", () => {
        const r = envelopeManager.createEnvelope({ workflowId: "wf", targetSubsystem: "t", actionType: "execute" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "sourceSubsystem_required");
    });

    it("rejects envelope creation without actionType", () => {
        const r = envelopeManager.createEnvelope({ workflowId: "wf", sourceSubsystem: "s", targetSubsystem: "t" });
        assert.equal(r.created, false);
        assert.equal(r.reason, "actionType_required");
    });

    it("uses provided correlationId", () => {
        const r = envelopeManager.createEnvelope({
            workflowId: "wf", sourceSubsystem: "s", targetSubsystem: "t", actionType: "execute",
            correlationId: "corr-99",
        });
        assert.equal(r.envelope.correlationId, "corr-99");
    });

    it("defaults correlationId to actionId when not provided", () => {
        const r = envelopeManager.createEnvelope({
            workflowId: "wf", sourceSubsystem: "s", targetSubsystem: "t", actionType: "execute",
        });
        assert.equal(r.envelope.correlationId, r.envelope.actionId);
    });

    it("validates a valid envelope", () => {
        const { envelope } = envelopeManager.createEnvelope({
            workflowId: "wf", sourceSubsystem: "s", targetSubsystem: "t", actionType: "execute",
        });
        const v = envelopeManager.validateEnvelope(envelope);
        assert.equal(v.valid, true);
    });

    it("invalidates envelope missing required field", () => {
        const v = envelopeManager.validateEnvelope({ actionId: "x", workflowId: "wf" });
        assert.equal(v.valid, false);
        assert.ok(v.violations.length > 0);
    });

    it("updates lifecycle state via valid transition", () => {
        const { envelope } = envelopeManager.createEnvelope({
            workflowId: "wf", sourceSubsystem: "s", targetSubsystem: "t", actionType: "execute",
        });
        const u = envelopeManager.updateLifecycleState({ actionId: envelope.actionId, newState: "validated" });
        assert.equal(u.updated, true);
        assert.equal(u.newState, "validated");
    });

    it("rejects invalid lifecycle state transition", () => {
        const { envelope } = envelopeManager.createEnvelope({
            workflowId: "wf", sourceSubsystem: "s", targetSubsystem: "t", actionType: "execute",
        });
        const u = envelopeManager.updateLifecycleState({ actionId: envelope.actionId, newState: "completed" });
        assert.equal(u.updated, false);
        assert.ok(u.reason.includes("invalid_transition"));
    });

    it("returns envelope history with state transitions", () => {
        const { envelope } = envelopeManager.createEnvelope({
            workflowId: "wf", sourceSubsystem: "s", targetSubsystem: "t", actionType: "execute",
        });
        envelopeManager.updateLifecycleState({ actionId: envelope.actionId, newState: "validated" });
        const h = envelopeManager.getEnvelopeHistory(envelope.actionId);
        assert.ok(h.length >= 1);
    });

    it("normalizeEnvelope fills missing optional fields with defaults", () => {
        const n = envelopeManager.normalizeEnvelope({
            actionId: "a1", workflowId: "wf", sourceSubsystem: "s",
            targetSubsystem: "t", actionType: "execute", lifecycleState: "queued",
        });
        assert.ok(n.timestamp);
        assert.equal(n.riskClass, "safe");
        assert.equal(n.authorityLevel, "observer");
    });

    it("reset clears all envelope state", () => {
        envelopeManager.createEnvelope({
            workflowId: "wf", sourceSubsystem: "s", targetSubsystem: "t", actionType: "execute",
        });
        envelopeManager.reset();
        // After reset, envelope is gone — history returns empty
        const h = envelopeManager.getEnvelopeHistory("action-1");
        assert.deepEqual(h, []);
    });
});

// ── runtimeActionRegistry ─────────────────────────────────────────────

describe("runtimeActionRegistry", () => {
    beforeEach(() => actionRegistry.reset());

    it("lists all builtin action types after reset", () => {
        const types = actionRegistry.listActionTypes();
        assert.ok(types.length >= 14);
    });

    it("lookupActionType returns builtin 'execute'", () => {
        const r = actionRegistry.lookupActionType("execute");
        assert.equal(r.found, true);
        assert.equal(r.name, "execute");
        assert.equal(r.riskClass, "guarded");
    });

    it("lookupActionType returns found:false for unknown", () => {
        const r = actionRegistry.lookupActionType("nonexistent");
        assert.equal(r.found, false);
    });

    it("validates a known action type", () => {
        const v = actionRegistry.validateActionType("observe");
        assert.equal(v.valid, true);
        assert.ok(v.record);
    });

    it("validates unknown action type as invalid", () => {
        const v = actionRegistry.validateActionType("unknown_type");
        assert.equal(v.valid, false);
    });

    it("registers a custom action type", () => {
        const r = actionRegistry.registerActionType({
            name: "custom_op", riskClass: "guarded", requiredAuthority: "operator",
        });
        assert.equal(r.registered, true);
        assert.equal(r.name, "custom_op");
    });

    it("rejects registration of duplicate action type", () => {
        actionRegistry.registerActionType({ name: "my_op", riskClass: "safe", requiredAuthority: "observer" });
        const r = actionRegistry.registerActionType({ name: "my_op", riskClass: "safe", requiredAuthority: "observer" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "action_type_already_registered");
    });

    it("rejects registration with invalid risk class", () => {
        const r = actionRegistry.registerActionType({ name: "bad_op", riskClass: "ultra", requiredAuthority: "observer" });
        assert.equal(r.registered, false);
        assert.ok(r.reason.includes("invalid_risk_class"));
    });

    it("rejects registration with invalid authority", () => {
        const r = actionRegistry.registerActionType({ name: "bad_op2", riskClass: "safe", requiredAuthority: "superadmin" });
        assert.equal(r.registered, false);
        assert.ok(r.reason.includes("invalid_required_authority"));
    });

    it("rejects registration without name", () => {
        const r = actionRegistry.registerActionType({ riskClass: "safe", requiredAuthority: "observer" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "name_required");
    });

    it("getRegistryMetrics reports totals", () => {
        const m = actionRegistry.getRegistryMetrics();
        assert.ok(m.totalRegistered >= 14);
        assert.ok(m.builtinCount >= 14);
        assert.equal(m.customCount, 0);
    });

    it("getRegistryMetrics counts by risk class", () => {
        const m = actionRegistry.getRegistryMetrics();
        assert.ok(m.byClass.safe > 0);
        assert.ok(m.byClass.critical > 0);
    });

    it("reset restores builtins and removes custom types", () => {
        actionRegistry.registerActionType({ name: "temp_type", riskClass: "safe", requiredAuthority: "observer" });
        actionRegistry.reset();
        const v = actionRegistry.validateActionType("temp_type");
        assert.equal(v.valid, false);
        assert.ok(actionRegistry.listActionTypes().length >= 14);
    });
});

// ── actionRoutingEngine ───────────────────────────────────────────────

describe("actionRoutingEngine", () => {
    beforeEach(() => routingEngine.reset());

    it("registers a valid route", () => {
        const r = routingEngine.registerRoute({
            sourceSubsystem: "scheduler", targetSubsystem: "executor",
        });
        assert.equal(r.registered, true);
        assert.ok(r.routeId.startsWith("route-"));
    });

    it("rejects self-route (source === target)", () => {
        const r = routingEngine.registerRoute({
            sourceSubsystem: "scheduler", targetSubsystem: "scheduler",
        });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "self_route_not_allowed");
    });

    it("rejects route without sourceSubsystem", () => {
        const r = routingEngine.registerRoute({ targetSubsystem: "executor" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "sourceSubsystem_required");
    });

    it("rejects route without targetSubsystem", () => {
        const r = routingEngine.registerRoute({ sourceSubsystem: "scheduler" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "targetSubsystem_required");
    });

    it("routes action to registered target", () => {
        routingEngine.registerRoute({ sourceSubsystem: "scheduler", targetSubsystem: "executor" });
        const r = routingEngine.routeAction({ sourceSubsystem: "scheduler", actionType: "execute" });
        assert.equal(r.routed, true);
        assert.ok(r.destinations.includes("executor"));
    });

    it("returns no_matching_route when no route exists", () => {
        const r = routingEngine.routeAction({ sourceSubsystem: "unknown", actionType: "execute" });
        assert.equal(r.routed, false);
        assert.equal(r.reason, "no_matching_route");
    });

    it("routes to multiple targets from one source", () => {
        routingEngine.registerRoute({ sourceSubsystem: "scheduler", targetSubsystem: "executor" });
        routingEngine.registerRoute({ sourceSubsystem: "scheduler", targetSubsystem: "monitor" });
        const r = routingEngine.routeAction({ sourceSubsystem: "scheduler" });
        assert.equal(r.routed, true);
        assert.equal(r.destinationCount, 2);
    });

    it("deduplicates destinations", () => {
        routingEngine.registerRoute({ sourceSubsystem: "scheduler", targetSubsystem: "executor", actionType: "execute" });
        routingEngine.registerRoute({ sourceSubsystem: "scheduler", targetSubsystem: "executor", actionType: null });
        const r = routingEngine.routeAction({ sourceSubsystem: "scheduler", actionType: "execute" });
        assert.equal(r.destinations.filter(d => d === "executor").length, 1);
    });

    it("validates routing table with no circular routes", () => {
        routingEngine.registerRoute({ sourceSubsystem: "A", targetSubsystem: "B" });
        routingEngine.registerRoute({ sourceSubsystem: "B", targetSubsystem: "C" });
        const v = routingEngine.validateRouting();
        assert.equal(v.valid, true);
        assert.equal(v.circularCount, 0);
    });

    it("detects circular routes", () => {
        routingEngine.registerRoute({ sourceSubsystem: "A", targetSubsystem: "B" });
        routingEngine.registerRoute({ sourceSubsystem: "B", targetSubsystem: "A" });
        const v = routingEngine.validateRouting();
        assert.equal(v.valid, false);
        assert.ok(v.circularCount > 0);
    });

    it("getRoutingTable returns all routes", () => {
        routingEngine.registerRoute({ sourceSubsystem: "X", targetSubsystem: "Y" });
        const t = routingEngine.getRoutingTable();
        assert.equal(t.length, 1);
    });

    it("getRoutingMetrics reports totals", () => {
        routingEngine.registerRoute({ sourceSubsystem: "A", targetSubsystem: "B" });
        routingEngine.routeAction({ sourceSubsystem: "A" });
        const m = routingEngine.getRoutingMetrics();
        assert.equal(m.totalRoutes, 1);
        assert.equal(m.activeRoutes, 1);
        assert.equal(m.totalRoutedActions, 1);
    });

    it("reset clears all routes", () => {
        routingEngine.registerRoute({ sourceSubsystem: "A", targetSubsystem: "B" });
        routingEngine.reset();
        assert.equal(routingEngine.getRoutingTable().length, 0);
    });
});

// ── deterministicEventDispatcher ─────────────────────────────────────

describe("deterministicEventDispatcher", () => {
    beforeEach(() => eventDispatcher.reset());

    it("registers a handler", () => {
        const r = eventDispatcher.registerHandler({ subsystem: "monitor", eventType: "action_complete" });
        assert.equal(r.registered, true);
        assert.ok(r.handlerId.startsWith("handler-"));
    });

    it("rejects registration without subsystem", () => {
        const r = eventDispatcher.registerHandler({ eventType: "x" });
        assert.equal(r.registered, false);
        assert.equal(r.reason, "subsystem_required");
    });

    it("deregisters a handler", () => {
        const { handlerId } = eventDispatcher.registerHandler({ subsystem: "monitor" });
        const d = eventDispatcher.deregisterHandler({ handlerId });
        assert.equal(d.deregistered, true);
    });

    it("deregister fails for unknown handlerId", () => {
        const d = eventDispatcher.deregisterHandler({ handlerId: "h-999" });
        assert.equal(d.deregistered, false);
        assert.equal(d.reason, "handler_not_found");
    });

    it("dispatches event to matching handler", () => {
        let called = false;
        eventDispatcher.registerHandler({ subsystem: "monitor", eventType: "test_event", handlerFn: () => { called = true; } });
        const r = eventDispatcher.dispatchEvent({ eventType: "test_event", payload: {} });
        assert.equal(r.dispatched, true);
        assert.equal(called, true);
    });

    it("wildcard handler receives all events", () => {
        const received = [];
        eventDispatcher.registerHandler({ subsystem: "logger", eventType: "*", handlerFn: ({ eventType }) => received.push(eventType) });
        eventDispatcher.dispatchEvent({ eventType: "alpha" });
        eventDispatcher.dispatchEvent({ eventType: "beta" });
        assert.deepEqual(received, ["alpha", "beta"]);
    });

    it("invokes handlers in FIFO registration order", () => {
        const order = [];
        eventDispatcher.registerHandler({ subsystem: "A", eventType: "ev", handlerFn: () => order.push("A") });
        eventDispatcher.registerHandler({ subsystem: "B", eventType: "ev", handlerFn: () => order.push("B") });
        eventDispatcher.registerHandler({ subsystem: "C", eventType: "ev", handlerFn: () => order.push("C") });
        eventDispatcher.dispatchEvent({ eventType: "ev" });
        assert.deepEqual(order, ["A", "B", "C"]);
    });

    it("catches handler errors and marks outcome as failed", () => {
        eventDispatcher.registerHandler({
            subsystem: "bad",
            eventType: "boom",
            handlerFn: () => { throw new Error("handler_error"); },
        });
        const r = eventDispatcher.dispatchEvent({ eventType: "boom" });
        assert.equal(r.dispatched, true);
        assert.equal(r.results[0].outcome, "failed");
        assert.equal(r.results[0].error, "handler_error");
    });

    it("deregistered handlers do not receive events", () => {
        let called = false;
        const { handlerId } = eventDispatcher.registerHandler({
            subsystem: "x", eventType: "ev", handlerFn: () => { called = true; },
        });
        eventDispatcher.deregisterHandler({ handlerId });
        eventDispatcher.dispatchEvent({ eventType: "ev" });
        assert.equal(called, false);
    });

    it("rejects dispatchEvent without eventType", () => {
        const r = eventDispatcher.dispatchEvent({ payload: {} });
        assert.equal(r.dispatched, false);
        assert.equal(r.reason, "eventType_required");
    });

    it("getDispatchLog returns all dispatch records", () => {
        eventDispatcher.dispatchEvent({ eventType: "e1" });
        eventDispatcher.dispatchEvent({ eventType: "e2" });
        assert.equal(eventDispatcher.getDispatchLog().length, 2);
    });

    it("getDispatchMetrics reports totals", () => {
        eventDispatcher.registerHandler({ subsystem: "a", eventType: "*" });
        eventDispatcher.dispatchEvent({ eventType: "x" });
        const m = eventDispatcher.getDispatchMetrics();
        assert.equal(m.totalDispatches, 1);
        assert.equal(m.totalHandlerInvocations, 1);
    });

    it("reset clears handlers and log", () => {
        eventDispatcher.registerHandler({ subsystem: "a", eventType: "*" });
        eventDispatcher.dispatchEvent({ eventType: "x" });
        eventDispatcher.reset();
        assert.equal(eventDispatcher.getDispatchLog().length, 0);
        assert.equal(eventDispatcher.getDispatchMetrics().activeHandlers, 0);
    });
});

// ── actionReplayCoordinator ───────────────────────────────────────────

describe("actionReplayCoordinator", () => {
    beforeEach(() => replayCoordinator.reset());

    it("records an action for replay", () => {
        const r = replayCoordinator.recordActionForReplay({
            actionId: "a1", actionType: "execute", idempotent: true,
        });
        assert.equal(r.recorded, true);
        assert.ok(r.replayRecordId.startsWith("replay-rec-"));
    });

    it("rejects recording without actionId", () => {
        const r = replayCoordinator.recordActionForReplay({ actionType: "execute" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "actionId_required");
    });

    it("rejects recording without actionType", () => {
        const r = replayCoordinator.recordActionForReplay({ actionId: "a1" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "actionType_required");
    });

    it("rejects duplicate recording of same actionId", () => {
        replayCoordinator.recordActionForReplay({ actionId: "a1", actionType: "execute" });
        const r = replayCoordinator.recordActionForReplay({ actionId: "a1", actionType: "execute" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "already_recorded_for_replay");
    });

    it("replays an idempotent action multiple times", () => {
        replayCoordinator.recordActionForReplay({ actionId: "a1", actionType: "observe", idempotent: true, replayable: true });
        const r1 = replayCoordinator.replayAction({ actionId: "a1" });
        const r2 = replayCoordinator.replayAction({ actionId: "a1" });
        assert.equal(r1.replayed, true);
        assert.equal(r2.replayed, true);
    });

    it("blocks replay of non-idempotent action after first attempt", () => {
        replayCoordinator.recordActionForReplay({ actionId: "a2", actionType: "execute", idempotent: false, replayable: true });
        const r1 = replayCoordinator.replayAction({ actionId: "a2" });
        const r2 = replayCoordinator.replayAction({ actionId: "a2" });
        assert.equal(r1.replayed, true);
        assert.equal(r2.replayed, false);
        assert.equal(r2.reason, "replay_not_idempotent_safe");
    });

    it("blocks replay of non-replayable action", () => {
        replayCoordinator.recordActionForReplay({ actionId: "a3", actionType: "quarantine", replayable: false });
        const r = replayCoordinator.replayAction({ actionId: "a3" });
        assert.equal(r.replayed, false);
        assert.equal(r.reason, "action_not_replayable");
    });

    it("replay returns envelope with new actionId and replayId", () => {
        replayCoordinator.recordActionForReplay({ actionId: "orig", actionType: "observe", idempotent: true, replayable: true });
        const r = replayCoordinator.replayAction({ actionId: "orig" });
        assert.ok(r.replayActionId.startsWith("action-replay-"));
        assert.equal(r.originalActionId, "orig");
        assert.equal(r.envelope.replayId, "orig");
    });

    it("validateReplayIdempotency returns safeToReplay for idempotent action", () => {
        replayCoordinator.recordActionForReplay({ actionId: "i1", actionType: "signal", idempotent: true });
        const v = replayCoordinator.validateReplayIdempotency({ actionId: "i1" });
        assert.equal(v.safeToReplay, true);
        assert.equal(v.idempotent, true);
    });

    it("validateReplayIdempotency returns not safe after first replay of non-idempotent", () => {
        replayCoordinator.recordActionForReplay({ actionId: "ni1", actionType: "execute", idempotent: false, replayable: true });
        replayCoordinator.replayAction({ actionId: "ni1" });
        const v = replayCoordinator.validateReplayIdempotency({ actionId: "ni1" });
        assert.equal(v.safeToReplay, false);
        assert.equal(v.previousAttempts, 1);
    });

    it("getReplayHistory returns all attempts for actionId", () => {
        replayCoordinator.recordActionForReplay({ actionId: "h1", actionType: "telemetry", idempotent: true, replayable: true });
        replayCoordinator.replayAction({ actionId: "h1" });
        replayCoordinator.replayAction({ actionId: "h1" });
        assert.equal(replayCoordinator.getReplayHistory("h1").length, 2);
    });

    it("getReplayMetrics reports totals", () => {
        replayCoordinator.recordActionForReplay({ actionId: "m1", actionType: "observe", idempotent: true, replayable: true });
        replayCoordinator.replayAction({ actionId: "m1" });
        const m = replayCoordinator.getReplayMetrics();
        assert.equal(m.totalRecorded, 1);
        assert.equal(m.totalReplayed, 1);
    });

    it("reset clears all records and attempts", () => {
        replayCoordinator.recordActionForReplay({ actionId: "r1", actionType: "observe" });
        replayCoordinator.reset();
        const m = replayCoordinator.getReplayMetrics();
        assert.equal(m.totalRecorded, 0);
    });
});

// ── executionSignalBridge ─────────────────────────────────────────────

describe("executionSignalBridge", () => {
    beforeEach(() => signalBridge.reset());

    it("emits a valid signal", () => {
        const r = signalBridge.emitSignal({ sourceSubsystem: "executor", signalType: "ready" });
        assert.equal(r.emitted, true);
        assert.ok(r.signalId.startsWith("signal-"));
        assert.equal(r.signalType, "ready");
    });

    it("rejects emit without sourceSubsystem", () => {
        const r = signalBridge.emitSignal({ signalType: "ready" });
        assert.equal(r.emitted, false);
        assert.equal(r.reason, "sourceSubsystem_required");
    });

    it("rejects emit without signalType", () => {
        const r = signalBridge.emitSignal({ sourceSubsystem: "exec" });
        assert.equal(r.emitted, false);
        assert.equal(r.reason, "signalType_required");
    });

    it("rejects invalid signal type", () => {
        const r = signalBridge.emitSignal({ sourceSubsystem: "exec", signalType: "nonexistent" });
        assert.equal(r.emitted, false);
        assert.ok(r.reason.includes("invalid_signal_type"));
    });

    it("emits all 8 valid signal types", () => {
        const { SIGNAL_TYPES } = signalBridge;
        for (const t of SIGNAL_TYPES) {
            signalBridge.reset();
            const r = signalBridge.emitSignal({ sourceSubsystem: "test", signalType: t });
            assert.equal(r.emitted, true, `failed for type: ${t}`);
        }
    });

    it("forwards a signal to target subsystems", () => {
        const { signalId } = signalBridge.emitSignal({ sourceSubsystem: "scheduler", signalType: "degraded" });
        const r = signalBridge.forwardSignal({ signalId, targetSubsystems: ["monitor", "governor"] });
        assert.equal(r.forwarded, true);
        assert.equal(r.targetCount, 2);
        assert.ok(r.forwardId.startsWith("fwd-"));
    });

    it("rejects forward without signalId", () => {
        const r = signalBridge.forwardSignal({ targetSubsystems: ["x"] });
        assert.equal(r.forwarded, false);
        assert.equal(r.reason, "signalId_required");
    });

    it("rejects forward with empty targetSubsystems", () => {
        const { signalId } = signalBridge.emitSignal({ sourceSubsystem: "s", signalType: "ready" });
        const r = signalBridge.forwardSignal({ signalId, targetSubsystems: [] });
        assert.equal(r.forwarded, false);
        assert.equal(r.reason, "targetSubsystems_required");
    });

    it("rejects forward to non-existent signal", () => {
        const r = signalBridge.forwardSignal({ signalId: "signal-999", targetSubsystems: ["a"] });
        assert.equal(r.forwarded, false);
        assert.equal(r.reason, "signal_not_found");
    });

    it("intercepts a signal", () => {
        const { signalId } = signalBridge.emitSignal({ sourceSubsystem: "exec", signalType: "pressure_alert" });
        const r = signalBridge.interceptSignal({ signalId, interceptorId: "gate-1" });
        assert.equal(r.intercepted, true);
        assert.ok(r.interceptId.startsWith("intercept-"));
    });

    it("blocks double-interception of same signal", () => {
        const { signalId } = signalBridge.emitSignal({ sourceSubsystem: "exec", signalType: "failed" });
        signalBridge.interceptSignal({ signalId, interceptorId: "gate-1" });
        const r = signalBridge.interceptSignal({ signalId, interceptorId: "gate-2" });
        assert.equal(r.intercepted, false);
        assert.equal(r.reason, "signal_already_intercepted");
    });

    it("interception applies payload modification", () => {
        const { signalId } = signalBridge.emitSignal({
            sourceSubsystem: "exec", signalType: "governance_block", payload: { original: true },
        });
        signalBridge.interceptSignal({ signalId, interceptorId: "g1", modification: { modified: true } });
        const log = signalBridge.getSignalLog();
        const sig = log.find(s => s.signalId === signalId);
        assert.equal(sig.payload.modified, true);
        assert.equal(sig.payload.original, true);
    });

    it("rejects intercept without signalId", () => {
        const r = signalBridge.interceptSignal({ interceptorId: "g" });
        assert.equal(r.intercepted, false);
        assert.equal(r.reason, "signalId_required");
    });

    it("rejects intercept without interceptorId", () => {
        const { signalId } = signalBridge.emitSignal({ sourceSubsystem: "s", signalType: "ready" });
        const r = signalBridge.interceptSignal({ signalId });
        assert.equal(r.intercepted, false);
        assert.equal(r.reason, "interceptorId_required");
    });

    it("getSignalLog returns all emitted signals", () => {
        signalBridge.emitSignal({ sourceSubsystem: "a", signalType: "ready" });
        signalBridge.emitSignal({ sourceSubsystem: "b", signalType: "failed" });
        assert.equal(signalBridge.getSignalLog().length, 2);
    });

    it("getSignalMetrics reports by type and counts", () => {
        signalBridge.emitSignal({ sourceSubsystem: "a", signalType: "ready" });
        signalBridge.emitSignal({ sourceSubsystem: "b", signalType: "ready" });
        signalBridge.emitSignal({ sourceSubsystem: "c", signalType: "failed" });
        const m = signalBridge.getSignalMetrics();
        assert.equal(m.totalSignals, 3);
        assert.equal(m.byType.ready, 2);
        assert.equal(m.byType.failed, 1);
        assert.equal(m.uniqueSources, 3);
    });

    it("reset clears all signal state", () => {
        signalBridge.emitSignal({ sourceSubsystem: "a", signalType: "ready" });
        signalBridge.reset();
        assert.equal(signalBridge.getSignalLog().length, 0);
        assert.equal(signalBridge.getSignalMetrics().totalSignals, 0);
    });
});

// ── unifiedActionBus ──────────────────────────────────────────────────

describe("unifiedActionBus", () => {
    beforeEach(() => unifiedBus.reset());

    it("subscribes a subsystem to an event type", () => {
        const r = unifiedBus.subscribe({ subsystem: "monitor", eventType: "action_complete" });
        assert.equal(r.subscribed, true);
        assert.ok(r.subscriptionId.startsWith("sub-"));
    });

    it("rejects subscribe without subsystem", () => {
        const r = unifiedBus.subscribe({ eventType: "x" });
        assert.equal(r.subscribed, false);
        assert.equal(r.reason, "subsystem_required");
    });

    it("unsubscribes an active subscription", () => {
        const { subscriptionId } = unifiedBus.subscribe({ subsystem: "monitor" });
        const r = unifiedBus.unsubscribe({ subscriptionId });
        assert.equal(r.unsubscribed, true);
    });

    it("rejects unsubscribe for unknown subscriptionId", () => {
        const r = unifiedBus.unsubscribe({ subscriptionId: "sub-999" });
        assert.equal(r.unsubscribed, false);
        assert.equal(r.reason, "subscription_not_found");
    });

    it("publishes and delivers to matching subscriber", () => {
        let received = null;
        unifiedBus.subscribe({ subsystem: "monitor", eventType: "test_event", handlerFn: (e) => { received = e; } });
        const r = unifiedBus.publish({ sourceSubsystem: "scheduler", eventType: "test_event", payload: { x: 1 } });
        assert.equal(r.published, true);
        assert.ok(r.actionId.startsWith("bus-action-"));
        assert.equal(r.subscriberCount, 1);
        assert.equal(received.payload.x, 1);
    });

    it("rejects publish without sourceSubsystem", () => {
        const r = unifiedBus.publish({ eventType: "x" });
        assert.equal(r.published, false);
        assert.equal(r.reason, "sourceSubsystem_required");
    });

    it("wildcard subscriber receives all event types", () => {
        const events = [];
        unifiedBus.subscribe({ subsystem: "logger", eventType: "*", handlerFn: (e) => events.push(e.eventType) });
        unifiedBus.publish({ sourceSubsystem: "A", eventType: "alpha" });
        unifiedBus.publish({ sourceSubsystem: "B", eventType: "beta" });
        assert.deepEqual(events, ["alpha", "beta"]);
    });

    it("non-matching subscriber does not receive event", () => {
        let called = false;
        unifiedBus.subscribe({ subsystem: "s", eventType: "other_event", handlerFn: () => { called = true; } });
        unifiedBus.publish({ sourceSubsystem: "a", eventType: "some_event" });
        assert.equal(called, false);
    });

    it("unsubscribed handler does not receive event", () => {
        let called = false;
        const { subscriptionId } = unifiedBus.subscribe({
            subsystem: "s", eventType: "*", handlerFn: () => { called = true; },
        });
        unifiedBus.unsubscribe({ subscriptionId });
        unifiedBus.publish({ sourceSubsystem: "a", eventType: "ev" });
        assert.equal(called, false);
    });

    it("catches handler errors and marks delivery failed", () => {
        unifiedBus.subscribe({
            subsystem: "bad", eventType: "*",
            handlerFn: () => { throw new Error("subscriber_error"); },
        });
        const r = unifiedBus.publish({ sourceSubsystem: "a", eventType: "ev" });
        assert.equal(r.published, true);
        assert.equal(r.deliveries[0].outcome, "failed");
        assert.equal(r.deliveries[0].error, "subscriber_error");
    });

    it("delivers to multiple subscribers in FIFO order", () => {
        const order = [];
        unifiedBus.subscribe({ subsystem: "A", eventType: "ev", handlerFn: () => order.push("A") });
        unifiedBus.subscribe({ subsystem: "B", eventType: "ev", handlerFn: () => order.push("B") });
        unifiedBus.subscribe({ subsystem: "C", eventType: "ev", handlerFn: () => order.push("C") });
        unifiedBus.publish({ sourceSubsystem: "src", eventType: "ev" });
        assert.deepEqual(order, ["A", "B", "C"]);
    });

    it("getBusState returns active subscription count", () => {
        unifiedBus.subscribe({ subsystem: "a" });
        unifiedBus.subscribe({ subsystem: "b" });
        const s = unifiedBus.getBusState();
        assert.equal(s.activeSubscriptions, 2);
    });

    it("getBusMetrics reports publish and delivery totals", () => {
        unifiedBus.subscribe({ subsystem: "a", eventType: "*" });
        unifiedBus.publish({ sourceSubsystem: "src", eventType: "x" });
        unifiedBus.publish({ sourceSubsystem: "src", eventType: "y" });
        const m = unifiedBus.getBusMetrics();
        assert.equal(m.totalPublished, 2);
        assert.equal(m.totalDeliveries, 2);
        assert.equal(m.uniqueSources, 1);
    });

    it("getBusMetrics tracks byEventType", () => {
        unifiedBus.publish({ sourceSubsystem: "s", eventType: "alpha" });
        unifiedBus.publish({ sourceSubsystem: "s", eventType: "alpha" });
        unifiedBus.publish({ sourceSubsystem: "s", eventType: "beta" });
        const m = unifiedBus.getBusMetrics();
        assert.equal(m.byEventType.alpha, 2);
        assert.equal(m.byEventType.beta, 1);
    });

    it("reset clears all subscriptions and published records", () => {
        unifiedBus.subscribe({ subsystem: "a" });
        unifiedBus.publish({ sourceSubsystem: "s", eventType: "x" });
        unifiedBus.reset();
        const s = unifiedBus.getBusState();
        assert.equal(s.activeSubscriptions, 0);
        assert.equal(s.publishedCount, 0);
    });
});

// ── actionTelemetryHub ────────────────────────────────────────────────

describe("actionTelemetryHub", () => {
    beforeEach(() => telemetryHub.reset());

    it("records a valid action event", () => {
        const r = telemetryHub.recordActionEvent({
            actionId: "a1", subsystem: "scheduler", category: "publish",
        });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("tel-"));
    });

    it("rejects record without actionId", () => {
        const r = telemetryHub.recordActionEvent({ subsystem: "s", category: "publish" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "actionId_required");
    });

    it("rejects record without subsystem", () => {
        const r = telemetryHub.recordActionEvent({ actionId: "a1", category: "publish" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "subsystem_required");
    });

    it("rejects record without category", () => {
        const r = telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s" });
        assert.equal(r.recorded, false);
        assert.equal(r.reason, "category_required");
    });

    it("rejects record with invalid category", () => {
        const r = telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "unknown_cat" });
        assert.equal(r.recorded, false);
        assert.ok(r.reason.includes("invalid_category"));
    });

    it("records events in all valid categories", () => {
        const { EVENT_CATEGORIES } = telemetryHub;
        for (const cat of EVENT_CATEGORIES) {
            const r = telemetryHub.recordActionEvent({ actionId: `a-${cat}`, subsystem: "test", category: cat });
            assert.equal(r.recorded, true, `failed for category: ${cat}`);
        }
    });

    it("getActionTimeline returns events for a given actionId", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "publish" });
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "dispatch" });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "s", category: "route" });
        const timeline = telemetryHub.getActionTimeline("a1");
        assert.equal(timeline.length, 2);
        assert.ok(timeline.every(e => e.actionId === "a1"));
    });

    it("getActionTimeline returns empty array for unknown actionId", () => {
        assert.deepEqual(telemetryHub.getActionTimeline("unknown"), []);
    });

    it("generateBusReport returns totalEvents and byCategory", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "publish" });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "s", category: "dispatch" });
        telemetryHub.recordActionEvent({ actionId: "a3", subsystem: "s", category: "error" });
        const report = telemetryHub.generateBusReport();
        assert.equal(report.totalEvents, 3);
        assert.equal(report.byCategory.publish, 1);
        assert.equal(report.byCategory.dispatch, 1);
        assert.equal(report.byCategory.error, 1);
    });

    it("generateBusReport computes avgLatencyMs", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "publish", latencyMs: 100 });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "s", category: "dispatch", latencyMs: 200 });
        const report = telemetryHub.generateBusReport();
        assert.equal(report.avgLatencyMs, 150);
        assert.equal(report.maxLatencyMs, 200);
    });

    it("generateBusReport counts unique actions and workflows", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "publish", workflowId: "wf1" });
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "dispatch", workflowId: "wf1" });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "s", category: "route", workflowId: "wf2" });
        const report = telemetryHub.generateBusReport();
        assert.equal(report.uniqueActions, 2);
        assert.equal(report.uniqueWorkflows, 2);
    });

    it("getSubsystemHealth returns healthy when no errors", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "scheduler", category: "publish", outcome: "ok" });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "scheduler", category: "dispatch", outcome: "ok" });
        const h = telemetryHub.getSubsystemHealth("scheduler");
        assert.equal(h.found, true);
        assert.equal(h.health, "healthy");
        assert.equal(h.errorRate, 0);
    });

    it("getSubsystemHealth returns degraded with ~30% errors", () => {
        for (let i = 0; i < 7; i++)
            telemetryHub.recordActionEvent({ actionId: `a${i}`, subsystem: "exec", category: "dispatch", outcome: "ok" });
        for (let i = 7; i < 10; i++)
            telemetryHub.recordActionEvent({ actionId: `a${i}`, subsystem: "exec", category: "error", outcome: "error" });
        const h = telemetryHub.getSubsystemHealth("exec");
        assert.equal(h.found, true);
        assert.equal(h.health, "degraded");
    });

    it("getSubsystemHealth returns critical with 50%+ errors", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "bad", category: "error", outcome: "error" });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "bad", category: "error", outcome: "error" });
        telemetryHub.recordActionEvent({ actionId: "a3", subsystem: "bad", category: "publish", outcome: "ok" });
        const h = telemetryHub.getSubsystemHealth("bad");
        assert.equal(h.health, "critical");
    });

    it("getSubsystemHealth returns not found for unknown subsystem", () => {
        const h = telemetryHub.getSubsystemHealth("phantom");
        assert.equal(h.found, false);
    });

    it("getTelemetryMetrics reports totals and byOutcome", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "publish", outcome: "ok" });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "s", category: "error", outcome: "error" });
        const m = telemetryHub.getTelemetryMetrics();
        assert.equal(m.totalEvents, 2);
        assert.equal(m.byOutcome.ok, 1);
        assert.equal(m.byOutcome.error, 1);
    });

    it("getTelemetryMetrics reports uniqueSubsystems", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s1", category: "publish" });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "s2", category: "dispatch" });
        telemetryHub.recordActionEvent({ actionId: "a3", subsystem: "s1", category: "route" });
        const m = telemetryHub.getTelemetryMetrics();
        assert.equal(m.uniqueSubsystems, 2);
    });

    it("getTelemetryMetrics computes avgLatencyMs", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "publish", latencyMs: 50 });
        telemetryHub.recordActionEvent({ actionId: "a2", subsystem: "s", category: "dispatch", latencyMs: 150 });
        const m = telemetryHub.getTelemetryMetrics();
        assert.equal(m.avgLatencyMs, 100);
        assert.equal(m.latencyRecorded, 2);
    });

    it("reset clears all events", () => {
        telemetryHub.recordActionEvent({ actionId: "a1", subsystem: "s", category: "publish" });
        telemetryHub.reset();
        const m = telemetryHub.getTelemetryMetrics();
        assert.equal(m.totalEvents, 0);
    });
});
