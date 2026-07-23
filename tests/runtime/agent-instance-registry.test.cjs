"use strict";
// Universal Composition Engine — Completion Gaps Phase 7 (test fixture
// concurrency reliability): this MUST be set before agentInstanceRegistry
// .cjs (or anything that transitively requires it) is first required —
// gives this test file's process its own isolated
// data/agent-instances.<suffix>.json instead of racing other test files
// that share the plain data/agent-instances.json. Real, previously
// confirmed bug: concurrent test-file processes writing the same
// unlocked JSON file clobbered each other's data, causing intermittent
// failures unrelated to any actual logic defect.
process.env.JARVIS_TEST_DATA_SUFFIX = `test-${process.pid}-${Date.now()}`;

const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(__dirname, `../../data/agent-instances.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`);

// This file is uniquely isolated to this test process — no other test
// file can ever touch it, so no backup/restore is needed, only cleanup.
after(() => { try { fs.unlinkSync(DATA_FILE); } catch {} });

describe("agentInstanceRegistry", () => {
    const instReg = require("../../backend/services/agentInstanceRegistry.cjs");

    describe("register()", () => {
        it("registers a new instance with required fields", () => {
            const inst = instReg.register("crm", "org_test_1", "co_test_1", { goals: ["close deals"] });
            assert.ok(inst.id);
            assert.equal(inst.orgId, "org_test_1");
            assert.equal(inst.companyId, "co_test_1");
            assert.equal(inst.archetypeId, "crm");
            assert.deepEqual(inst.config.goals, ["close deals"]);
            assert.equal(inst.status, "active");
        });
        it("throws when archetypeId is missing", () => {
            assert.throws(() => instReg.register("", "org_x", "co_x", {}));
        });
        it("throws when orgId is missing", () => {
            assert.throws(() => instReg.register("crm", "", "co_x", {}));
        });
        it("never accepts a raw secret field (validated via capabilityContract)", () => {
            assert.throws(() => instReg.register("crm", "org_x", "co_x", { credentialRefs: ["ref_ok"], apiKey: "sk_live_should_be_rejected" }));
        });
    });

    describe("findForOrgAndArchetype() — per-org isolation", () => {
        it("two different orgs get ISOLATED config for the same archetype capability", () => {
            const orgA = `org_iso_a_${Date.now()}`;
            const orgB = `org_iso_b_${Date.now()}`;
            instReg.register("email_send", orgA, "co_a", { goals: ["goal-for-A"], memoryScopeId: "mem_a" });
            instReg.register("email_send", orgB, "co_b", { goals: ["goal-for-B"], memoryScopeId: "mem_b" });

            const foundA = instReg.findForOrgAndArchetype(orgA, "email_send");
            const foundB = instReg.findForOrgAndArchetype(orgB, "email_send");

            assert.ok(foundA, "expected an instance for org A");
            assert.ok(foundB, "expected an instance for org B");
            assert.deepEqual(foundA.config.goals, ["goal-for-A"]);
            assert.deepEqual(foundB.config.goals, ["goal-for-B"]);
            assert.notEqual(foundA.id, foundB.id);
            assert.equal(foundA.config.memoryScopeId, "mem_a");
            assert.equal(foundB.config.memoryScopeId, "mem_b");
        });
        it("returns null when no instance is registered for that org+archetype", () => {
            const found = instReg.findForOrgAndArchetype("org_with_nothing_registered", "totally-unused-capability-xyz");
            assert.equal(found, null);
        });
        it("returns null when orgId or archetypeId is missing", () => {
            assert.equal(instReg.findForOrgAndArchetype(null, "crm"), null);
            assert.equal(instReg.findForOrgAndArchetype("org_x", null), null);
        });
        it("does not return a deactivated instance", () => {
            const inst = instReg.register("terminal", `org_deact_${Date.now()}`, "co_deact", {});
            instReg.deactivate(inst.id);
            const found = instReg.findForOrgAndArchetype(inst.orgId, "terminal");
            assert.equal(found, null);
        });
    });

    describe("listForCompany() / listForOrg()", () => {
        it("lists only instances belonging to the given company", () => {
            const stamp = Date.now();
            instReg.register("crm", `org_list_${stamp}`, `co_list_${stamp}`, {});
            instReg.register("crm", `org_list_${stamp}`, `co_other_${stamp}`, {});
            const list = instReg.listForCompany(`co_list_${stamp}`);
            assert.equal(list.length, 1);
        });
        it("lists all instances belonging to the given org across companies", () => {
            const stamp = Date.now();
            const org = `org_multico_${stamp}`;
            instReg.register("crm", org, `co1_${stamp}`, {});
            instReg.register("email_send", org, `co2_${stamp}`, {});
            const list = instReg.listForOrg(org);
            assert.equal(list.length, 2);
        });
    });
});

describe("executionEngine — Agent Instance overlay wiring", () => {
    const executionEngine = require("../../agents/runtime/executionEngine.cjs");
    const registry = require("../../agents/runtime/agentRegistry.cjs");
    const instReg = require("../../backend/services/agentInstanceRegistry.cjs");

    // taskRouter.resolveCapability() falls back to "ai" for any unmapped
    // task type, so these tests patch it to route their synthetic
    // capability id straight through — isolated to this describe block,
    // restored after each test.
    const router = require("../../agents/runtime/taskRouter.cjs");
    const _originalResolve = router.resolveCapability;

    it("dispatch with ZERO instances registered still works exactly as before (backward compatible)", async () => {
        const cap = `exec-eng-noinst-${Date.now()}`;
        router.resolveCapability = (type) => (type === cap ? cap : _originalResolve(type));
        let receivedCtx = null;
        registry.register({
            id: `agent-${cap}`, capabilities: [cap],
            handler: async (task, ctx) => { receivedCtx = ctx; return { success: true, message: "ok" }; },
        });
        const result = await executionEngine.executeTask({ type: cap, label: "no-org-task" });
        router.resolveCapability = _originalResolve;
        assert.equal(result.success, true);
        assert.equal(receivedCtx.agentInstanceId, undefined, "no instance should be injected when task has no orgId");
    });

    it("a task with orgId set gets the matching instance's config injected into ctx", async () => {
        const cap = `exec-eng-withinst-${Date.now()}`;
        const orgId = `org_exec_${Date.now()}`;
        router.resolveCapability = (type) => (type === cap ? cap : _originalResolve(type));

        let receivedCtx = null;
        registry.register({ id: `agent-${cap}`, capabilities: [cap], handler: async (task, ctx) => { receivedCtx = ctx; return { success: true, message: "ok" }; } });
        const inst = instReg.register(cap, orgId, "co_exec_test", { goals: ["injected-goal"], memoryScopeId: "mem_exec_test" });

        const result = await executionEngine.executeTask({ type: cap, orgId, label: "org-scoped-task" });
        router.resolveCapability = _originalResolve;

        assert.equal(result.success, true);
        assert.equal(receivedCtx.agentInstanceId, inst.id);
        assert.deepEqual(receivedCtx.goals, ["injected-goal"]);
        assert.equal(receivedCtx.memoryScopeId, "mem_exec_test");
    });
});
