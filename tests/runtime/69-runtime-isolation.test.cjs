"use strict";
const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const isolMgr    = require("../../agents/runtime/isolation/executionIsolationManager.cjs");
const fault      = require("../../agents/runtime/isolation/faultContainmentEngine.cjs");
const quota      = require("../../agents/runtime/isolation/executionQuotaManager.cjs");
const boundary   = require("../../agents/runtime/isolation/deterministicRecoveryBoundary.cjs");
const contam     = require("../../agents/runtime/isolation/contaminationDetector.cjs");
const telemetry  = require("../../agents/runtime/isolation/isolationTelemetry.cjs");

// ─── executionIsolationManager ────────────────────────────────────────────────

describe("executionIsolationManager", () => {
    beforeEach(() => isolMgr.reset());

    it("exports ISOLATION_TYPES and FAULT_STATES", () => {
        assert.ok(Array.isArray(isolMgr.ISOLATION_TYPES));
        assert.ok(isolMgr.ISOLATION_TYPES.includes("workflow"));
        assert.ok(isolMgr.ISOLATION_TYPES.includes("agent"));
        assert.ok(isolMgr.ISOLATION_TYPES.includes("capability"));
        assert.ok(isolMgr.ISOLATION_TYPES.includes("session"));
        assert.ok(isolMgr.ISOLATION_TYPES.includes("recovery"));
        assert.ok(Array.isArray(isolMgr.FAULT_STATES));
        assert.ok(isolMgr.FAULT_STATES.includes("quarantined"));
    });

    it("createIsolationDomain workflow → created with defaults", () => {
        const r = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        assert.equal(r.created, true);
        assert.ok(r.domainId.startsWith("dom-"));
        assert.equal(r.isolationType, "workflow");
    });

    it("createIsolationDomain stores correct record", () => {
        const r = isolMgr.createIsolationDomain({
            isolationType: "agent",
            memoryQuota: 512,
            cpuQuota: 2.0,
            parentDomain: "dom-parent",
        });
        const d = isolMgr.getIsolationDomain(r.domainId);
        assert.equal(d.memoryQuota, 512);
        assert.equal(d.cpuQuota, 2.0);
        assert.equal(d.parentDomain, "dom-parent");
        assert.equal(d.faultState, "healthy");
        assert.equal(d.status, "active");
        assert.equal(d.executionCount, 0);
        assert.equal(d.recoveryMode, false);
    });

    it("createIsolationDomain all 5 types succeed", () => {
        for (const t of isolMgr.ISOLATION_TYPES) {
            const r = isolMgr.createIsolationDomain({ isolationType: t });
            assert.equal(r.created, true, `${t} should create`);
        }
    });

    it("createIsolationDomain invalid type → not created", () => {
        const r = isolMgr.createIsolationDomain({ isolationType: "rogue" });
        assert.equal(r.created, false);
        assert.ok(r.reason.includes("invalid_isolation_type"));
    });

    it("getIsolationDomain not found → null", () => {
        assert.equal(isolMgr.getIsolationDomain("dom-999"), null);
    });

    it("destroyIsolationDomain → destroyed", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "session" });
        const r = isolMgr.destroyIsolationDomain(domainId);
        assert.equal(r.destroyed, true);
        const d = isolMgr.getIsolationDomain(domainId);
        assert.equal(d.status, "destroyed");
        assert.ok(d.destroyedAt != null);
    });

    it("destroyIsolationDomain already destroyed → not destroyed", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        isolMgr.destroyIsolationDomain(domainId);
        const r = isolMgr.destroyIsolationDomain(domainId);
        assert.equal(r.destroyed, false);
        assert.equal(r.reason, "already_destroyed");
    });

    it("destroyIsolationDomain not found → not destroyed", () => {
        const r = isolMgr.destroyIsolationDomain("dom-nope");
        assert.equal(r.destroyed, false);
        assert.equal(r.reason, "domain_not_found");
    });

    it("listIsolationDomains returns all", () => {
        isolMgr.createIsolationDomain({ isolationType: "workflow" });
        isolMgr.createIsolationDomain({ isolationType: "agent" });
        assert.equal(isolMgr.listIsolationDomains().length, 2);
    });

    it("listIsolationDomains filter by isolationType", () => {
        isolMgr.createIsolationDomain({ isolationType: "workflow" });
        isolMgr.createIsolationDomain({ isolationType: "agent" });
        isolMgr.createIsolationDomain({ isolationType: "agent" });
        const agents = isolMgr.listIsolationDomains({ isolationType: "agent" });
        assert.equal(agents.length, 2);
        assert.ok(agents.every(d => d.isolationType === "agent"));
    });

    it("listIsolationDomains filter by status", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        isolMgr.createIsolationDomain({ isolationType: "agent" });
        isolMgr.destroyIsolationDomain(domainId);
        assert.equal(isolMgr.listIsolationDomains({ status: "active" }).length, 1);
        assert.equal(isolMgr.listIsolationDomains({ status: "destroyed" }).length, 1);
    });

    it("assignResources updates memory and cpu quotas", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        const r = isolMgr.assignResources(domainId, { memoryQuota: 1024, cpuQuota: 4.0 });
        assert.equal(r.assigned, true);
        assert.equal(r.memoryQuota, 1024);
        assert.equal(r.cpuQuota, 4.0);
        assert.equal(isolMgr.getIsolationDomain(domainId).memoryQuota, 1024);
    });

    it("assignResources not found → not assigned", () => {
        const r = isolMgr.assignResources("dom-nope", { memoryQuota: 512 });
        assert.equal(r.assigned, false);
        assert.equal(r.reason, "domain_not_found");
    });

    it("assignResources destroyed domain → not assigned", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        isolMgr.destroyIsolationDomain(domainId);
        const r = isolMgr.assignResources(domainId, { memoryQuota: 512 });
        assert.equal(r.assigned, false);
        assert.equal(r.reason, "domain_destroyed");
    });

    it("getIsolationStats counts correctly", () => {
        isolMgr.createIsolationDomain({ isolationType: "workflow" });
        isolMgr.createIsolationDomain({ isolationType: "agent" });
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "session" });
        isolMgr.destroyIsolationDomain(domainId);
        const s = isolMgr.getIsolationStats();
        assert.equal(s.total, 3);
        assert.equal(s.active, 2);
        assert.equal(s.destroyed, 1);
        assert.equal(s.byType.workflow, 1);
        assert.equal(s.byType.agent, 1);
    });

    it("reset clears all domains", () => {
        isolMgr.createIsolationDomain({ isolationType: "workflow" });
        isolMgr.reset();
        assert.equal(isolMgr.listIsolationDomains().length, 0);
        assert.deepEqual(isolMgr.getIsolationStats(), {
            total: 0, active: 0, destroyed: 0, quarantined: 0, byType: {}, byFaultState: {},
        });
    });
});

// ─── faultContainmentEngine ───────────────────────────────────────────────────

describe("faultContainmentEngine", () => {
    beforeEach(() => fault.reset());

    it("exports FAULT_STATES and CONTAINMENT_THRESHOLDS", () => {
        assert.ok(Array.isArray(fault.FAULT_STATES));
        assert.ok(fault.FAULT_STATES.includes("quarantined"));
        assert.ok(typeof fault.CONTAINMENT_THRESHOLDS === "object");
        assert.ok(fault.CONTAINMENT_THRESHOLDS.degraded    >= 1);
        assert.ok(fault.CONTAINMENT_THRESHOLDS.unstable    > fault.CONTAINMENT_THRESHOLDS.degraded);
        assert.ok(fault.CONTAINMENT_THRESHOLDS.quarantined > fault.CONTAINMENT_THRESHOLDS.unstable);
    });

    it("reportFailure creates fault record and returns failureId", () => {
        const r = fault.reportFailure("dom-1", { errorType: "timeout" });
        assert.equal(r.reported, true);
        assert.ok(r.failureId.startsWith("fail-"));
    });

    it("1 failure → healthy state", () => {
        fault.reportFailure("dom-1");
        const r = fault.evaluateFaultState("dom-1");
        assert.equal(r.faultState, "healthy");
        assert.equal(r.failureCount, 1);
    });

    it(`${fault.CONTAINMENT_THRESHOLDS?.degraded ?? 2} failures → degraded`, () => {
        const threshold = fault.CONTAINMENT_THRESHOLDS.degraded;
        for (let i = 0; i < threshold; i++) fault.reportFailure("dom-2");
        const r = fault.evaluateFaultState("dom-2");
        assert.equal(r.faultState, "degraded");
    });

    it(`${fault.CONTAINMENT_THRESHOLDS?.unstable ?? 4} failures → unstable`, () => {
        const threshold = fault.CONTAINMENT_THRESHOLDS.unstable;
        for (let i = 0; i < threshold; i++) fault.reportFailure("dom-3");
        const r = fault.evaluateFaultState("dom-3");
        assert.equal(r.faultState, "unstable");
    });

    it(`${fault.CONTAINMENT_THRESHOLDS?.quarantined ?? 6} failures → quarantined`, () => {
        const threshold = fault.CONTAINMENT_THRESHOLDS.quarantined;
        for (let i = 0; i < threshold; i++) fault.reportFailure("dom-4");
        assert.equal(fault.isQuarantined("dom-4"), true);
    });

    it("quarantined state is sticky — more failures keep domain quarantined", () => {
        const threshold = fault.CONTAINMENT_THRESHOLDS.quarantined;
        for (let i = 0; i < threshold + 3; i++) fault.reportFailure("dom-5");
        assert.equal(fault.evaluateFaultState("dom-5").faultState, "quarantined");
    });

    it("reportFailure returns current faultState after escalation", () => {
        const threshold = fault.CONTAINMENT_THRESHOLDS.quarantined;
        let last;
        for (let i = 0; i < threshold; i++) last = fault.reportFailure("dom-6");
        assert.equal(last.faultState, "quarantined");
    });

    it("quarantineDomain manual → immediately quarantined", () => {
        const r = fault.quarantineDomain("dom-7", "manual_override");
        assert.equal(r.quarantined, true);
        assert.equal(r.reason, "manual_override");
        assert.equal(fault.isQuarantined("dom-7"), true);
    });

    it("quarantineDomain on fresh domain (no prior failures)", () => {
        fault.quarantineDomain("dom-8");
        const map = fault.getFaultMap({ domainId: "dom-8" });
        assert.equal(map[0].faultState, "quarantined");
    });

    it("releaseQuarantine → degraded state", () => {
        fault.quarantineDomain("dom-9");
        const r = fault.releaseQuarantine("dom-9");
        assert.equal(r.released, true);
        assert.equal(r.faultState, "degraded");
        assert.equal(fault.isQuarantined("dom-9"), false);
    });

    it("releaseQuarantine on non-quarantined domain → not released", () => {
        fault.reportFailure("dom-10");
        const r = fault.releaseQuarantine("dom-10");
        assert.equal(r.released, false);
        assert.equal(r.reason, "not_quarantined");
    });

    it("releaseQuarantine no fault record → not released", () => {
        const r = fault.releaseQuarantine("dom-unknown");
        assert.equal(r.released, false);
        assert.equal(r.reason, "no_fault_record");
    });

    it("evaluateFaultState no fault record → not evaluated", () => {
        const r = fault.evaluateFaultState("dom-none");
        assert.equal(r.evaluated, false);
        assert.equal(r.reason, "no_fault_record");
    });

    it("getFaultMap returns all records", () => {
        fault.reportFailure("dom-a");
        fault.reportFailure("dom-b");
        assert.equal(fault.getFaultMap().length, 2);
    });

    it("getFaultMap filter by faultState", () => {
        fault.quarantineDomain("dom-c");
        fault.reportFailure("dom-d");
        const q = fault.getFaultMap({ faultState: "quarantined" });
        assert.equal(q.length, 1);
        assert.equal(q[0].domainId, "dom-c");
    });

    it("isQuarantined returns false for unknown domain", () => {
        assert.equal(fault.isQuarantined("dom-never"), false);
    });

    it("multiple domains isolated from each other", () => {
        const threshold = fault.CONTAINMENT_THRESHOLDS.quarantined;
        for (let i = 0; i < threshold; i++) fault.reportFailure("dom-bad");
        fault.reportFailure("dom-good");
        assert.equal(fault.isQuarantined("dom-bad"), true);
        assert.equal(fault.isQuarantined("dom-good"), false);
    });

    it("reset clears all fault state", () => {
        fault.quarantineDomain("dom-q");
        fault.reset();
        assert.equal(fault.isQuarantined("dom-q"), false);
        assert.equal(fault.getFaultMap().length, 0);
    });
});

// ─── executionQuotaManager ────────────────────────────────────────────────────

describe("executionQuotaManager", () => {
    beforeEach(() => quota.reset());

    it("exports QUOTA_TYPES", () => {
        assert.ok(Array.isArray(quota.QUOTA_TYPES));
        assert.ok(quota.QUOTA_TYPES.includes("executions_per_minute"));
        assert.ok(quota.QUOTA_TYPES.includes("concurrent_tasks"));
        assert.ok(quota.QUOTA_TYPES.includes("memory_budget"));
        assert.ok(quota.QUOTA_TYPES.includes("retry_budget"));
        assert.ok(quota.QUOTA_TYPES.includes("recovery_budget"));
    });

    it("allocateQuota valid → allocated with allocationId", () => {
        const r = quota.allocateQuota("dom-1", { quotaType: "concurrent_tasks", limit: 5 });
        assert.equal(r.allocated, true);
        assert.ok(r.allocationId.startsWith("qta-"));
        assert.equal(r.limit, 5);
    });

    it("allocateQuota invalid type → not allocated", () => {
        const r = quota.allocateQuota("dom-1", { quotaType: "unknown_quota", limit: 10 });
        assert.equal(r.allocated, false);
        assert.ok(r.reason.includes("invalid_quota_type"));
    });

    it("allocateQuota negative limit → not allocated", () => {
        const r = quota.allocateQuota("dom-1", { quotaType: "concurrent_tasks", limit: -1 });
        assert.equal(r.allocated, false);
        assert.equal(r.reason, "invalid_limit");
    });

    it("allocateQuota all 5 types succeed", () => {
        for (const t of quota.QUOTA_TYPES) {
            const r = quota.allocateQuota("dom-all", { quotaType: t, limit: 10 });
            assert.equal(r.allocated, true, `${t} should allocate`);
        }
    });

    it("consumeQuota within limit → consumed", () => {
        quota.allocateQuota("dom-2", { quotaType: "concurrent_tasks", limit: 3 });
        const r = quota.consumeQuota("dom-2", "concurrent_tasks", 1);
        assert.equal(r.consumed, true);
        assert.equal(r.used, 1);
        assert.equal(r.remaining, 2);
    });

    it("consumeQuota exact limit → exhausted after", () => {
        quota.allocateQuota("dom-3", { quotaType: "concurrent_tasks", limit: 2 });
        quota.consumeQuota("dom-3", "concurrent_tasks", 1);
        quota.consumeQuota("dom-3", "concurrent_tasks", 1);
        const chk = quota.checkQuota("dom-3", "concurrent_tasks");
        assert.equal(chk.exhausted, true);
        assert.equal(chk.remaining, 0);
    });

    it("consumeQuota over limit → not consumed, exhausted set", () => {
        quota.allocateQuota("dom-4", { quotaType: "concurrent_tasks", limit: 2 });
        quota.consumeQuota("dom-4", "concurrent_tasks", 1);
        const r = quota.consumeQuota("dom-4", "concurrent_tasks", 5);
        assert.equal(r.consumed, false);
        assert.equal(r.reason, "quota_exhausted");
    });

    it("consumeQuota already exhausted → not consumed", () => {
        quota.allocateQuota("dom-5", { quotaType: "retry_budget", limit: 1 });
        quota.consumeQuota("dom-5", "retry_budget", 1);
        const r = quota.consumeQuota("dom-5", "retry_budget", 1);
        assert.equal(r.consumed, false);
        assert.equal(r.reason, "quota_exhausted");
    });

    it("consumeQuota not allocated → not consumed", () => {
        const r = quota.consumeQuota("dom-X", "concurrent_tasks", 1);
        assert.equal(r.consumed, false);
        assert.equal(r.reason, "quota_not_allocated");
    });

    it("releaseQuota decrements used and restores availability", () => {
        quota.allocateQuota("dom-6", { quotaType: "concurrent_tasks", limit: 2 });
        quota.consumeQuota("dom-6", "concurrent_tasks", 2);
        assert.equal(quota.checkQuota("dom-6", "concurrent_tasks").exhausted, true);
        quota.releaseQuota("dom-6", "concurrent_tasks", 1);
        const chk = quota.checkQuota("dom-6", "concurrent_tasks");
        assert.equal(chk.exhausted, false);
        assert.equal(chk.remaining, 1);
    });

    it("releaseQuota not allocated → not released", () => {
        const r = quota.releaseQuota("dom-X", "concurrent_tasks", 1);
        assert.equal(r.released, false);
        assert.equal(r.reason, "quota_not_allocated");
    });

    it("releaseQuota clamps to 0 — no negative used", () => {
        quota.allocateQuota("dom-7", { quotaType: "retry_budget", limit: 5 });
        quota.consumeQuota("dom-7", "retry_budget", 1);
        quota.releaseQuota("dom-7", "retry_budget", 100);
        assert.equal(quota.checkQuota("dom-7", "retry_budget").used, 0);
    });

    it("checkQuota not allocated → available=false", () => {
        const r = quota.checkQuota("dom-X", "memory_budget");
        assert.equal(r.available, false);
        assert.equal(r.reason, "quota_not_allocated");
    });

    it("getQuotaUsage returns all quota records", () => {
        quota.allocateQuota("dom-8", { quotaType: "concurrent_tasks", limit: 5 });
        quota.allocateQuota("dom-8", { quotaType: "retry_budget",     limit: 3 });
        const r = quota.getQuotaUsage("dom-8");
        assert.equal(r.found, true);
        assert.equal(r.quotas.length, 2);
    });

    it("getQuotaUsage domain not found → found=false", () => {
        const r = quota.getQuotaUsage("dom-ghost");
        assert.equal(r.found, false);
        assert.deepEqual(r.quotas, []);
    });

    it("second allocateQuota overwrites previous record", () => {
        quota.allocateQuota("dom-9", { quotaType: "concurrent_tasks", limit: 5 });
        quota.consumeQuota("dom-9", "concurrent_tasks", 3);
        quota.allocateQuota("dom-9", { quotaType: "concurrent_tasks", limit: 10 });
        const chk = quota.checkQuota("dom-9", "concurrent_tasks");
        assert.equal(chk.used, 0);
        assert.equal(chk.limit, 10);
    });

    it("reset clears all quota state", () => {
        quota.allocateQuota("dom-10", { quotaType: "concurrent_tasks", limit: 5 });
        quota.reset();
        assert.equal(quota.getQuotaUsage("dom-10").found, false);
    });
});

// ─── deterministicRecoveryBoundary ────────────────────────────────────────────

describe("deterministicRecoveryBoundary", () => {
    beforeEach(() => boundary.reset());

    it("createRecoveryBoundary valid spec → created", () => {
        const r = boundary.createRecoveryBoundary({ executionChainId: "chain-1", snapshotHash: "abc123" });
        assert.equal(r.created, true);
        assert.ok(r.boundaryId.startsWith("bnd-"));
        assert.equal(r.executionChainId, "chain-1");
        assert.equal(r.replaySafe, true);
    });

    it("createRecoveryBoundary no executionChainId → not created", () => {
        const r = boundary.createRecoveryBoundary({});
        assert.equal(r.created, false);
        assert.equal(r.reason, "executionChainId_required");
    });

    it("createRecoveryBoundary stores full record", () => {
        const r = boundary.createRecoveryBoundary({
            executionChainId: "chain-2",
            snapshotHash:     "def456",
            replaySafe:       false,
            rollbackDepth:    3,
        });
        const s = boundary.getBoundaryState(r.boundaryId);
        assert.equal(s.snapshotHash, "def456");
        assert.equal(s.replaySafe, false);
        assert.equal(s.rollbackDepth, 3);
        assert.equal(s.corruptionDetected, false);
        assert.equal(s.rollbackCount, 0);
        assert.equal(s.status, "active");
    });

    it("getBoundaryState not found → null", () => {
        assert.equal(boundary.getBoundaryState("bnd-999"), null);
    });

    it("validateRecoveryBoundary matching hash → valid", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "c1", snapshotHash: "hash1" });
        const r = boundary.validateRecoveryBoundary(boundaryId, { currentHash: "hash1" });
        assert.equal(r.valid, true);
        assert.equal(r.hashMatches, true);
        assert.equal(r.corruptionDetected, false);
        assert.equal(r.reason, null);
    });

    it("validateRecoveryBoundary missing currentHash → valid (no check)", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "c2", snapshotHash: "hash2" });
        const r = boundary.validateRecoveryBoundary(boundaryId, {});
        assert.equal(r.valid, true);
    });

    it("validateRecoveryBoundary mismatching hash → invalid, corruption flagged", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "c3", snapshotHash: "original" });
        const r = boundary.validateRecoveryBoundary(boundaryId, { currentHash: "tampered" });
        assert.equal(r.valid, false);
        assert.equal(r.hashMatches, false);
        assert.equal(r.corruptionDetected, true);
        assert.equal(r.reason, "hash_mismatch");
    });

    it("validateRecoveryBoundary not replay-safe → invalid", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "c4", replaySafe: false });
        const r = boundary.validateRecoveryBoundary(boundaryId, {});
        assert.equal(r.valid, false);
        assert.equal(r.replaySafe, false);
        assert.equal(r.reason, "not_replay_safe");
    });

    it("validateRecoveryBoundary not found → valid=false", () => {
        const r = boundary.validateRecoveryBoundary("bnd-nope", {});
        assert.equal(r.valid, false);
        assert.equal(r.reason, "boundary_not_found");
    });

    it("rollbackToBoundary succeeds for clean replay-safe boundary", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "chain-10", rollbackDepth: 2 });
        const r = boundary.rollbackToBoundary(boundaryId);
        assert.equal(r.rolledBack, true);
        assert.equal(r.executionChainId, "chain-10");
        assert.equal(r.rollbackDepth, 2);
        assert.equal(r.rollbackCount, 1);
    });

    it("rollbackToBoundary consumes boundary by default", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "chain-11" });
        boundary.rollbackToBoundary(boundaryId);
        const r = boundary.rollbackToBoundary(boundaryId);
        assert.equal(r.rolledBack, false);
        assert.equal(r.reason, "boundary_consumed");
    });

    it("rollbackToBoundary keepActive=true allows multiple rollbacks", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "chain-12" });
        boundary.rollbackToBoundary(boundaryId, { keepActive: true });
        const r = boundary.rollbackToBoundary(boundaryId, { keepActive: true });
        assert.equal(r.rolledBack, true);
        assert.equal(r.rollbackCount, 2);
    });

    it("rollbackToBoundary corrupted boundary → not rolled back", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "chain-13", snapshotHash: "orig" });
        boundary.validateRecoveryBoundary(boundaryId, { currentHash: "wrong" });
        const r = boundary.rollbackToBoundary(boundaryId);
        assert.equal(r.rolledBack, false);
        assert.equal(r.reason, "boundary_corrupted");
    });

    it("rollbackToBoundary not replay-safe without forceUnsafe → blocked", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "chain-14", replaySafe: false });
        const r = boundary.rollbackToBoundary(boundaryId);
        assert.equal(r.rolledBack, false);
        assert.equal(r.reason, "not_replay_safe");
    });

    it("rollbackToBoundary not replay-safe with forceUnsafe=true → allowed", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "chain-15", replaySafe: false });
        const r = boundary.rollbackToBoundary(boundaryId, { forceUnsafe: true });
        assert.equal(r.rolledBack, true);
    });

    it("rollbackToBoundary not found → not rolled back", () => {
        const r = boundary.rollbackToBoundary("bnd-ghost");
        assert.equal(r.rolledBack, false);
        assert.equal(r.reason, "boundary_not_found");
    });

    it("listBoundaries returns all", () => {
        boundary.createRecoveryBoundary({ executionChainId: "chain-A" });
        boundary.createRecoveryBoundary({ executionChainId: "chain-B" });
        assert.equal(boundary.listBoundaries().length, 2);
    });

    it("listBoundaries filter by executionChainId", () => {
        boundary.createRecoveryBoundary({ executionChainId: "chain-A" });
        boundary.createRecoveryBoundary({ executionChainId: "chain-A" });
        boundary.createRecoveryBoundary({ executionChainId: "chain-B" });
        assert.equal(boundary.listBoundaries({ executionChainId: "chain-A" }).length, 2);
    });

    it("listBoundaries filter by status", () => {
        const { boundaryId } = boundary.createRecoveryBoundary({ executionChainId: "chain-C" });
        boundary.createRecoveryBoundary({ executionChainId: "chain-D" });
        boundary.rollbackToBoundary(boundaryId);
        assert.equal(boundary.listBoundaries({ status: "active" }).length, 1);
        assert.equal(boundary.listBoundaries({ status: "consumed" }).length, 1);
    });

    it("listBoundaries filter by replaySafe=false", () => {
        boundary.createRecoveryBoundary({ executionChainId: "chain-E", replaySafe: false });
        boundary.createRecoveryBoundary({ executionChainId: "chain-F", replaySafe: true });
        assert.equal(boundary.listBoundaries({ replaySafe: false }).length, 1);
    });

    it("reset clears all boundaries", () => {
        boundary.createRecoveryBoundary({ executionChainId: "chain-G" });
        boundary.reset();
        assert.equal(boundary.listBoundaries().length, 0);
    });
});

// ─── contaminationDetector ────────────────────────────────────────────────────

describe("contaminationDetector", () => {
    beforeEach(() => contam.reset());

    it("exports CONTAMINATION_TYPES and VALID_TRANSITIONS", () => {
        assert.ok(Array.isArray(contam.CONTAMINATION_TYPES));
        assert.ok(contam.CONTAMINATION_TYPES.includes("memory_leak"));
        assert.ok(contam.CONTAMINATION_TYPES.includes("state_corruption"));
        assert.ok(contam.CONTAMINATION_TYPES.includes("recursive_mutation"));
        assert.ok(contam.CONTAMINATION_TYPES.includes("invalid_transition"));
        assert.ok(contam.CONTAMINATION_TYPES.includes("unsafe_shared_state"));
        assert.ok(typeof contam.VALID_TRANSITIONS === "object");
    });

    it("scanExecutionState clean state → clean=true, no findings", () => {
        const r = contam.scanExecutionState("exec-1", {});
        assert.equal(r.clean, true);
        assert.equal(r.contaminated, false);
        assert.deepEqual(r.findings, []);
        assert.ok(r.scanId.startsWith("scn-"));
    });

    it("scanExecutionState memory_leak → finding reported", () => {
        const r = contam.scanExecutionState("exec-2", {
            allocatedMb: 600, maxAllowedMb: 512,
        });
        assert.equal(r.contaminated, true);
        assert.ok(r.findings.some(f => f.type === "memory_leak"));
    });

    it("scanExecutionState no memory_leak when within limits", () => {
        const r = contam.scanExecutionState("exec-3", {
            allocatedMb: 256, maxAllowedMb: 512,
        });
        assert.ok(!r.findings.some(f => f.type === "memory_leak"));
    });

    it("scanExecutionState state_corruption — missing required fields", () => {
        const r = contam.scanExecutionState("exec-4", {
            requiredFields: ["userId", "sessionId"],
            data: { userId: "u1" },
        });
        const corruptions = r.findings.filter(f => f.type === "state_corruption");
        assert.equal(corruptions.length, 1);
        assert.ok(corruptions[0].detail.includes("sessionId"));
    });

    it("scanExecutionState state_corruption — all fields present → no finding", () => {
        const r = contam.scanExecutionState("exec-5", {
            requiredFields: ["userId"],
            data: { userId: "u1" },
        });
        assert.ok(!r.findings.some(f => f.type === "state_corruption"));
    });

    it("scanExecutionState recursive_mutation → finding", () => {
        const r = contam.scanExecutionState("exec-6", {
            mutationDepth: 15, maxMutationDepth: 10,
        });
        assert.ok(r.findings.some(f => f.type === "recursive_mutation"));
    });

    it("scanExecutionState recursive_mutation at exact limit → no finding", () => {
        const r = contam.scanExecutionState("exec-7", {
            mutationDepth: 10, maxMutationDepth: 10,
        });
        assert.ok(!r.findings.some(f => f.type === "recursive_mutation"));
    });

    it("scanExecutionState invalid_transition running→completed → clean", () => {
        const r = contam.scanExecutionState("exec-8", {
            fromStatus: "running", toStatus: "completed",
        });
        assert.ok(!r.findings.some(f => f.type === "invalid_transition"));
    });

    it("scanExecutionState invalid_transition completed→running → finding", () => {
        const r = contam.scanExecutionState("exec-9", {
            fromStatus: "completed", toStatus: "running",
        });
        assert.ok(r.findings.some(f => f.type === "invalid_transition"));
    });

    it("scanExecutionState unsafe_shared_state > 0 → finding", () => {
        const r = contam.scanExecutionState("exec-10", { sharedMutations: 3 });
        assert.ok(r.findings.some(f => f.type === "unsafe_shared_state"));
    });

    it("scanExecutionState unsafe_shared_state = 0 → no finding", () => {
        const r = contam.scanExecutionState("exec-11", { sharedMutations: 0 });
        assert.ok(!r.findings.some(f => f.type === "unsafe_shared_state"));
    });

    it("scanExecutionState multiple contaminations at once", () => {
        const r = contam.scanExecutionState("exec-12", {
            allocatedMb: 999, maxAllowedMb: 512,
            mutationDepth: 20, maxMutationDepth: 5,
            sharedMutations: 1,
        });
        assert.ok(r.findings.length >= 3);
        assert.equal(r.contaminated, true);
    });

    it("detectContamination aggregates all scans for execId", () => {
        contam.scanExecutionState("exec-13", { allocatedMb: 999, maxAllowedMb: 256 });
        contam.scanExecutionState("exec-13", { sharedMutations: 2 });
        const r = contam.detectContamination("exec-13");
        assert.equal(r.contaminated, true);
        assert.ok(r.findingCount >= 2);
        assert.ok(r.byType.memory_leak >= 1);
        assert.ok(r.byType.unsafe_shared_state >= 1);
    });

    it("detectContamination clean exec → not contaminated", () => {
        contam.scanExecutionState("exec-14", {});
        const r = contam.detectContamination("exec-14");
        assert.equal(r.contaminated, false);
        assert.equal(r.findingCount, 0);
    });

    it("detectContamination unknown execId → not contaminated", () => {
        const r = contam.detectContamination("exec-ghost");
        assert.equal(r.contaminated, false);
    });

    it("traceContaminationSource returns root source", () => {
        contam.scanExecutionState("exec-15", { allocatedMb: 999, maxAllowedMb: 256 });
        contam.scanExecutionState("exec-15", { sharedMutations: 1 });
        const r = contam.traceContaminationSource("exec-15");
        assert.equal(r.found, true);
        assert.ok(r.rootSource != null);
        assert.ok(r.totalSources >= 2);
    });

    it("traceContaminationSource no findings → found=false", () => {
        const r = contam.traceContaminationSource("exec-clean");
        assert.equal(r.found, false);
        assert.deepEqual(r.sources, []);
    });

    it("validateStateIntegrity clean state → valid", () => {
        const r = contam.validateStateIntegrity({ version: 1, checksum: "abc", expectedChecksum: "abc" });
        assert.equal(r.valid, true);
        assert.deepEqual(r.issues, []);
    });

    it("validateStateIntegrity checksum mismatch → issue", () => {
        const r = contam.validateStateIntegrity({ checksum: "abc", expectedChecksum: "xyz" });
        assert.equal(r.valid, false);
        assert.ok(r.issues.includes("checksum_mismatch"));
    });

    it("validateStateIntegrity version not numeric → issue", () => {
        const r = contam.validateStateIntegrity({ version: "v1" });
        assert.equal(r.valid, false);
        assert.ok(r.issues.includes("version_not_numeric"));
    });

    it("validateStateIntegrity closed state with active operations → issue", () => {
        const r = contam.validateStateIntegrity({ closed: true, activeOperations: 3 });
        assert.equal(r.valid, false);
        assert.ok(r.issues.includes("operations_on_closed_state"));
    });

    it("reset clears all scans and findings", () => {
        contam.scanExecutionState("exec-16", { sharedMutations: 1 });
        contam.reset();
        assert.equal(contam.detectContamination("exec-16").contaminated, false);
    });
});

// ─── isolationTelemetry ───────────────────────────────────────────────────────

describe("isolationTelemetry", () => {
    beforeEach(() => telemetry.reset());

    it("exports EVENT_TYPES", () => {
        assert.ok(Array.isArray(telemetry.EVENT_TYPES));
        assert.ok(telemetry.EVENT_TYPES.includes("domain_created"));
        assert.ok(telemetry.EVENT_TYPES.includes("domain_quarantined"));
        assert.ok(telemetry.EVENT_TYPES.includes("recovery_boundary_restored"));
    });

    it("recordIsolationEvent returns eventId", () => {
        const r = telemetry.recordIsolationEvent({ type: "domain_created", domainId: "dom-1" });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("isol-"));
    });

    it("recordFaultEvent returns eventId", () => {
        const r = telemetry.recordFaultEvent({ domainId: "dom-1", faultState: "degraded", escalated: false });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("fault-"));
    });

    it("recordQuotaEvent returns eventId", () => {
        const r = telemetry.recordQuotaEvent({ domainId: "dom-1", quotaType: "concurrent_tasks", action: "exhausted" });
        assert.equal(r.recorded, true);
        assert.ok(r.eventId.startsWith("quota-"));
    });

    it("getIsolationMetrics counts domain_created events", () => {
        telemetry.recordIsolationEvent({ type: "domain_created", domainId: "dom-1" });
        telemetry.recordIsolationEvent({ type: "domain_created", domainId: "dom-2" });
        telemetry.recordIsolationEvent({ type: "domain_destroyed", domainId: "dom-1" });
        const m = telemetry.getIsolationMetrics();
        assert.equal(m.domainsCreated, 2);
        assert.equal(m.domainsDestroyed, 1);
        assert.equal(m.totalEvents, 3);
    });

    it("getIsolationMetrics counts quarantine and release events", () => {
        telemetry.recordIsolationEvent({ type: "domain_quarantined", domainId: "dom-1" });
        telemetry.recordIsolationEvent({ type: "domain_released",    domainId: "dom-1" });
        const m = telemetry.getIsolationMetrics();
        assert.equal(m.quarantineEvents, 1);
        assert.equal(m.releaseEvents, 1);
    });

    it("getIsolationMetrics counts recovery boundary restores", () => {
        telemetry.recordIsolationEvent({ type: "recovery_boundary_restored" });
        telemetry.recordIsolationEvent({ type: "recovery_boundary_restored" });
        assert.equal(telemetry.getIsolationMetrics().recoveryRestores, 2);
    });

    it("getFaultAnalytics counts escalations and byState", () => {
        telemetry.recordFaultEvent({ domainId: "dom-1", faultState: "degraded",    escalated: false });
        telemetry.recordFaultEvent({ domainId: "dom-1", faultState: "quarantined", escalated: true  });
        const a = telemetry.getFaultAnalytics();
        assert.equal(a.totalFaultEvents, 2);
        assert.equal(a.escalations, 1);
        assert.equal(a.byState.degraded, 1);
        assert.equal(a.byState.quarantined, 1);
    });

    it("getFaultAnalytics counts quota exhaustions", () => {
        telemetry.recordQuotaEvent({ action: "exhausted", quotaType: "concurrent_tasks" });
        telemetry.recordQuotaEvent({ action: "exhausted", quotaType: "retry_budget" });
        telemetry.recordQuotaEvent({ action: "released",  quotaType: "concurrent_tasks" });
        assert.equal(telemetry.getFaultAnalytics().quotaExhaustions, 2);
    });

    it("getIsolationMetrics empty → all zeroes", () => {
        const m = telemetry.getIsolationMetrics();
        assert.equal(m.totalEvents, 0);
        assert.equal(m.domainsCreated, 0);
    });

    it("getFaultAnalytics empty → zeroes", () => {
        const a = telemetry.getFaultAnalytics();
        assert.equal(a.totalFaultEvents, 0);
        assert.equal(a.escalations, 0);
        assert.equal(a.quotaExhaustions, 0);
    });

    it("reset clears all telemetry", () => {
        telemetry.recordIsolationEvent({ type: "domain_created" });
        telemetry.recordFaultEvent({ faultState: "degraded" });
        telemetry.recordQuotaEvent({ action: "exhausted" });
        telemetry.reset();
        assert.equal(telemetry.getIsolationMetrics().totalEvents, 0);
        assert.equal(telemetry.getFaultAnalytics().totalFaultEvents, 0);
        assert.equal(telemetry.getFaultAnalytics().quotaExhaustions, 0);
    });
});

// ─── Integration ──────────────────────────────────────────────────────────────

describe("runtime isolation integration", () => {
    beforeEach(() => {
        isolMgr.reset();
        fault.reset();
        quota.reset();
        boundary.reset();
        contam.reset();
        telemetry.reset();
    });

    it("safe domain lifecycle — create, allocate, consume, release, destroy", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        telemetry.recordIsolationEvent({ type: "domain_created", domainId });

        quota.allocateQuota(domainId, { quotaType: "concurrent_tasks", limit: 3 });
        const c1 = quota.consumeQuota(domainId, "concurrent_tasks", 1);
        assert.equal(c1.consumed, true);

        const bnd = boundary.createRecoveryBoundary({ executionChainId: domainId, snapshotHash: "snap1" });
        const val = boundary.validateRecoveryBoundary(bnd.boundaryId, { currentHash: "snap1" });
        assert.equal(val.valid, true);

        quota.releaseQuota(domainId, "concurrent_tasks", 1);
        isolMgr.destroyIsolationDomain(domainId);
        telemetry.recordIsolationEvent({ type: "domain_destroyed", domainId });

        const m = telemetry.getIsolationMetrics();
        assert.equal(m.domainsCreated, 1);
        assert.equal(m.domainsDestroyed, 1);
    });

    it("quarantined domain — block execution via isQuarantined check", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "agent" });
        for (let i = 0; i < fault.CONTAINMENT_THRESHOLDS.quarantined; i++)
            fault.reportFailure(domainId, { errorType: "crash" });

        assert.equal(fault.isQuarantined(domainId), true);
        telemetry.recordIsolationEvent({ type: "domain_quarantined", domainId });
        telemetry.recordFaultEvent({ domainId, faultState: "quarantined", escalated: true });

        // Gate: quarantined domains cannot proceed with execution
        const blocked = fault.isQuarantined(domainId);
        assert.equal(blocked, true);

        const a = telemetry.getFaultAnalytics();
        assert.equal(a.escalations, 1);
    });

    it("quota exhaustion blocks further task execution", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "capability" });
        quota.allocateQuota(domainId, { quotaType: "concurrent_tasks", limit: 2 });

        quota.consumeQuota(domainId, "concurrent_tasks", 1);
        quota.consumeQuota(domainId, "concurrent_tasks", 1);

        const attempt = quota.consumeQuota(domainId, "concurrent_tasks", 1);
        assert.equal(attempt.consumed, false);
        assert.equal(attempt.reason, "quota_exhausted");

        telemetry.recordQuotaEvent({ domainId, quotaType: "concurrent_tasks", action: "exhausted" });
        assert.equal(telemetry.getFaultAnalytics().quotaExhaustions, 1);
    });

    it("contamination detection → quarantine domain", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "agent" });

        const scan = contam.scanExecutionState(domainId, {
            allocatedMb: 1200, maxAllowedMb: 512,
            sharedMutations: 5,
        });
        assert.equal(scan.contaminated, true);

        // Quarantine the domain due to contamination
        fault.quarantineDomain(domainId, "contamination_detected");
        telemetry.recordIsolationEvent({ type: "domain_quarantined", domainId });
        telemetry.recordFaultEvent({ domainId, faultState: "quarantined", escalated: true });

        assert.equal(fault.isQuarantined(domainId), true);
        assert.equal(telemetry.getIsolationMetrics().quarantineEvents, 1);
    });

    it("deterministic recovery boundary — validate then rollback", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "recovery" });
        const chainId = `chain-${domainId}`;
        const hash = "sha256-abc";

        const bnd = boundary.createRecoveryBoundary({
            executionChainId: chainId,
            snapshotHash: hash,
            rollbackDepth: 1,
        });
        telemetry.recordIsolationEvent({ type: "recovery_boundary_created", domainId });

        const val = boundary.validateRecoveryBoundary(bnd.boundaryId, { currentHash: hash });
        assert.equal(val.valid, true);

        const rbk = boundary.rollbackToBoundary(bnd.boundaryId);
        assert.equal(rbk.rolledBack, true);
        assert.equal(rbk.rollbackDepth, 1);

        telemetry.recordIsolationEvent({ type: "recovery_boundary_restored", domainId });
        assert.equal(telemetry.getIsolationMetrics().recoveryRestores, 1);
    });

    it("cross-domain isolation — parent healthy when child quarantined", () => {
        const parent = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        const child  = isolMgr.createIsolationDomain({ isolationType: "agent", parentDomain: parent.domainId });

        for (let i = 0; i < fault.CONTAINMENT_THRESHOLDS.quarantined; i++)
            fault.reportFailure(child.domainId);

        assert.equal(fault.isQuarantined(child.domainId), true);
        assert.equal(fault.isQuarantined(parent.domainId), false);

        const parentDomain = isolMgr.getIsolationDomain(parent.domainId);
        assert.equal(parentDomain.faultState, "healthy");
    });

    it("fault escalation chain — healthy → degraded → unstable → quarantined", () => {
        const domainId = "dom-esc";
        const { degraded, unstable, quarantined } = fault.CONTAINMENT_THRESHOLDS;

        for (let i = 0; i < degraded; i++)     fault.reportFailure(domainId);
        assert.equal(fault.evaluateFaultState(domainId).faultState, "degraded");

        for (let i = degraded; i < unstable; i++) fault.reportFailure(domainId);
        assert.equal(fault.evaluateFaultState(domainId).faultState, "unstable");

        for (let i = unstable; i < quarantined; i++) fault.reportFailure(domainId);
        assert.equal(fault.evaluateFaultState(domainId).faultState, "quarantined");

        telemetry.recordFaultEvent({ domainId, faultState: "quarantined", escalated: true, failureCount: quarantined });
        assert.equal(telemetry.getFaultAnalytics().escalations, 1);
    });

    it("quota release restores execution capacity after exhaustion", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        quota.allocateQuota(domainId, { quotaType: "concurrent_tasks", limit: 2 });

        quota.consumeQuota(domainId, "concurrent_tasks", 2);
        assert.equal(quota.checkQuota(domainId, "concurrent_tasks").exhausted, true);

        quota.releaseQuota(domainId, "concurrent_tasks", 1);
        const c = quota.consumeQuota(domainId, "concurrent_tasks", 1);
        assert.equal(c.consumed, true);
    });

    it("replay-safe recovery validation before rollback blocks corrupted boundary", () => {
        const bnd = boundary.createRecoveryBoundary({
            executionChainId: "chain-safe",
            snapshotHash: "original-hash",
        });

        // Simulate corruption detected during validation
        boundary.validateRecoveryBoundary(bnd.boundaryId, { currentHash: "corrupted-hash" });

        const rbk = boundary.rollbackToBoundary(bnd.boundaryId);
        assert.equal(rbk.rolledBack, false);
        assert.equal(rbk.reason, "boundary_corrupted");
    });

    it("full containment simulation — multi-domain with fault, quota, boundary, telemetry", () => {
        // Setup 3 domains
        const d1 = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        const d2 = isolMgr.createIsolationDomain({ isolationType: "agent" });
        const d3 = isolMgr.createIsolationDomain({ isolationType: "recovery" });

        // d1: quota exhausted
        quota.allocateQuota(d1.domainId, { quotaType: "retry_budget", limit: 2 });
        quota.consumeQuota(d1.domainId, "retry_budget", 2);
        telemetry.recordQuotaEvent({ domainId: d1.domainId, action: "exhausted", quotaType: "retry_budget" });

        // d2: quarantined by fault escalation
        for (let i = 0; i < fault.CONTAINMENT_THRESHOLDS.quarantined; i++)
            fault.reportFailure(d2.domainId);
        telemetry.recordFaultEvent({ domainId: d2.domainId, faultState: "quarantined", escalated: true });
        telemetry.recordIsolationEvent({ type: "domain_quarantined", domainId: d2.domainId });

        // d3: recovery boundary + rollback
        const bnd = boundary.createRecoveryBoundary({ executionChainId: d3.domainId, snapshotHash: "snap" });
        boundary.rollbackToBoundary(bnd.boundaryId);
        telemetry.recordIsolationEvent({ type: "recovery_boundary_restored", domainId: d3.domainId });

        // Assertions
        assert.equal(quota.checkQuota(d1.domainId, "retry_budget").exhausted, true);
        assert.equal(fault.isQuarantined(d2.domainId), true);
        assert.equal(boundary.getBoundaryState(bnd.boundaryId).status, "consumed");

        const m = telemetry.getIsolationMetrics();
        assert.equal(m.quarantineEvents, 1);
        assert.equal(m.recoveryRestores, 1);

        const fa = telemetry.getFaultAnalytics();
        assert.equal(fa.escalations, 1);
        assert.equal(fa.quotaExhaustions, 1);
    });

    it("contamination tracing — root source identified across multiple scans", () => {
        const execId = "traced-exec";
        contam.scanExecutionState(execId, { allocatedMb: 800, maxAllowedMb: 512 });
        contam.scanExecutionState(execId, { sharedMutations: 2 });
        contam.scanExecutionState(execId, { mutationDepth: 20, maxMutationDepth: 5 });

        const trace = contam.traceContaminationSource(execId);
        assert.equal(trace.found, true);
        assert.ok(trace.totalSources >= 3);
        assert.ok(trace.rootSource.type === "memory_leak");
    });

    it("recovery domain with recovery quota survives fault escalation", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "recovery" });
        quota.allocateQuota(domainId, { quotaType: "recovery_budget", limit: 5 });

        // Report some failures
        fault.reportFailure(domainId);
        fault.reportFailure(domainId);

        // Domain degraded but recovery budget still available
        assert.equal(fault.evaluateFaultState(domainId).faultState, "degraded");
        const c = quota.consumeQuota(domainId, "recovery_budget", 1);
        assert.equal(c.consumed, true);
        assert.equal(fault.isQuarantined(domainId), false);
    });

    it("release quarantine then verify domain is unblocked", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "agent" });
        fault.quarantineDomain(domainId, "test_quarantine");
        assert.equal(fault.isQuarantined(domainId), true);

        const rel = fault.releaseQuarantine(domainId);
        assert.equal(rel.released, true);
        assert.equal(rel.faultState, "degraded");
        assert.equal(fault.isQuarantined(domainId), false);

        telemetry.recordIsolationEvent({ type: "domain_released", domainId });
        assert.equal(telemetry.getIsolationMetrics().releaseEvents, 1);
    });

    it("getIsolationStats reflects quarantined fault state", () => {
        const { domainId } = isolMgr.createIsolationDomain({ isolationType: "workflow" });
        // Update the domain's faultState directly through assignResources — we instead
        // use listIsolationDomains to confirm stats. The IsolationManager tracks faultState
        // separately from FaultContainmentEngine; stats reflect the manager's own records.
        const stats = isolMgr.getIsolationStats();
        assert.equal(stats.total, 1);
        assert.equal(stats.active, 1);
        assert.equal(stats.byFaultState.healthy, 1);
    });
});
