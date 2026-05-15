"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const reg  = require("../../agents/runtime/capability/capabilityRegistry.cjs");
const pol  = require("../../agents/runtime/capability/capabilityPolicies.cjs");
const perm = require("../../agents/runtime/capability/capabilityPermissions.cjs");
const con  = require("../../agents/runtime/capability/capabilityContracts.cjs");
const tele = require("../../agents/runtime/capability/capabilityTelemetry.cjs");
const pers = require("../../agents/runtime/capability/capabilityPersistence.cjs");

const _noop = () => ({});

// ── capabilityRegistry ────────────────────────────────────────────────

describe("capabilityRegistry", () => {
    afterEach(() => reg.reset());

    describe("register", () => {
        it("registers a capability and returns registered:true", () => {
            const r = reg.register({ id: "test.cap", policy: "readonly", handler: _noop });
            assert.ok(r.registered);
            assert.equal(r.id, "test.cap");
            assert.equal(r.version, 1);
        });

        it("throws when id is missing", () => {
            assert.throws(() => reg.register({ policy: "readonly", handler: _noop }), /id is required/);
        });

        it("throws when handler is missing", () => {
            assert.throws(() => reg.register({ id: "x", policy: "readonly" }), /handler/);
        });

        it("throws when policy is missing", () => {
            assert.throws(() => reg.register({ id: "x", handler: _noop }), /policy/);
        });

        it("re-registering same id bumps version", () => {
            reg.register({ id: "cap.v", policy: "readonly", handler: _noop });
            const r = reg.register({ id: "cap.v", policy: "readonly", handler: _noop });
            assert.equal(r.version, 2);
        });

        it("stores registeredAt timestamp", () => {
            reg.register({ id: "cap.ts", policy: "readonly", handler: _noop });
            assert.ok(!isNaN(Date.parse(reg.get("cap.ts").registeredAt)));
        });
    });

    describe("unregister", () => {
        it("unregisters an existing capability", () => {
            reg.register({ id: "cap.rm", policy: "readonly", handler: _noop });
            const r = reg.unregister("cap.rm");
            assert.ok(r.unregistered);
            assert.equal(reg.get("cap.rm"), null);
        });

        it("returns not_found for unknown id", () => {
            const r = reg.unregister("ghost");
            assert.ok(!r.unregistered);
            assert.equal(r.reason, "not_found");
        });
    });

    describe("get", () => {
        it("returns null for unknown capability", () => {
            assert.equal(reg.get("nope"), null);
        });

        it("returns capability after registration", () => {
            reg.register({ id: "cap.get", policy: "readonly", handler: _noop });
            const c = reg.get("cap.get");
            assert.equal(c.id, "cap.get");
        });
    });

    describe("list + discover", () => {
        it("list returns all capabilities", () => {
            reg.register({ id: "a", policy: "readonly",   handler: _noop });
            reg.register({ id: "b", policy: "shell_execute", handler: _noop });
            assert.equal(reg.list().length, 2);
        });

        it("list filters by policy", () => {
            reg.register({ id: "a", policy: "readonly",      handler: _noop });
            reg.register({ id: "b", policy: "shell_execute", handler: _noop });
            const r = reg.list({ policy: "readonly" });
            assert.equal(r.length, 1);
            assert.equal(r[0].id, "a");
        });

        it("list filters by tag", () => {
            reg.register({ id: "a", policy: "readonly", tags: ["fs"],  handler: _noop });
            reg.register({ id: "b", policy: "readonly", tags: ["git"], handler: _noop });
            assert.equal(reg.list({ tag: "fs" }).length, 1);
        });

        it("discover returns ids", () => {
            reg.register({ id: "x", policy: "readonly", handler: _noop });
            assert.ok(reg.discover().includes("x"));
        });

        it("discover filters by policy", () => {
            reg.register({ id: "r", policy: "readonly",   handler: _noop });
            reg.register({ id: "s", policy: "shell_execute", handler: _noop });
            const ids = reg.discover("readonly");
            assert.ok(ids.includes("r"));
            assert.ok(!ids.includes("s"));
        });
    });
});

// ── capabilityPolicies ────────────────────────────────────────────────

describe("capabilityPolicies", () => {
    describe("POLICIES", () => {
        it("exports 5 policies", () => {
            const expected = ["restricted","readonly","workspace_write","shell_execute","network_access"];
            for (const p of expected) assert.ok(p in pol.POLICIES, `missing: ${p}`);
        });

        it("levels are ordered correctly", () => {
            assert.ok(pol.getLevel("restricted") < pol.getLevel("readonly"));
            assert.ok(pol.getLevel("readonly")   < pol.getLevel("workspace_write"));
            assert.ok(pol.getLevel("workspace_write") < pol.getLevel("shell_execute"));
            assert.ok(pol.getLevel("shell_execute")   < pol.getLevel("network_access"));
        });
    });

    describe("isValidPolicy", () => {
        it("returns true for known policies", () => {
            for (const p of ["restricted","readonly","workspace_write","shell_execute","network_access"]) {
                assert.ok(pol.isValidPolicy(p), `should be valid: ${p}`);
            }
        });

        it("returns false for unknown policy", () => {
            assert.ok(!pol.isValidPolicy("admin"));
        });
    });

    describe("canEscalate", () => {
        it("same policy is allowed", () => {
            assert.ok(pol.canEscalate("readonly", "readonly"));
        });

        it("lower policy cannot escalate to higher", () => {
            assert.ok(!pol.canEscalate("readonly", "shell_execute"));
        });

        it("higher policy can call lower", () => {
            assert.ok(pol.canEscalate("shell_execute", "readonly"));
        });
    });

    describe("getAllowedOps + isOpAllowed", () => {
        it("readonly allows 'read'", () => {
            assert.ok(pol.isOpAllowed("read", "readonly"));
        });

        it("readonly does not allow 'exec'", () => {
            assert.ok(!pol.isOpAllowed("exec", "readonly"));
        });

        it("shell_execute allows 'exec'", () => {
            assert.ok(pol.isOpAllowed("exec", "shell_execute"));
        });

        it("restricted allows no ops", () => {
            assert.equal(pol.getAllowedOps("restricted").length, 0);
        });

        it("network_access allows 'install'", () => {
            assert.ok(pol.isOpAllowed("install", "network_access"));
        });
    });
});

// ── capabilityPermissions ─────────────────────────────────────────────

describe("capabilityPermissions", () => {
    afterEach(() => perm.reset());

    describe("createContext", () => {
        it("returns a context with id", () => {
            const ctx = perm.createContext();
            assert.ok(typeof ctx.id === "string");
        });

        it("defaults to null allowlist, empty denylist, network_access maxPolicy", () => {
            const ctx = perm.createContext();
            assert.equal(ctx.allowlist,  null);
            assert.deepEqual(ctx.denylist, []);
            assert.equal(ctx.maxPolicy,  "network_access");
        });
    });

    describe("isAllowed", () => {
        it("allows when no allowlist and not denylisted", () => {
            const ctx = perm.createContext();
            const r = perm.isAllowed("some.cap", ctx);
            assert.ok(r.allowed);
        });

        it("blocks denylisted capability", () => {
            const ctx = perm.createContext({ denylist: ["bad.cap"] });
            const r = perm.isAllowed("bad.cap", ctx);
            assert.ok(!r.allowed);
            assert.equal(r.reason, "denylisted");
        });

        it("blocks when not in allowlist", () => {
            const ctx = perm.createContext({ allowlist: ["allowed.cap"] });
            const r = perm.isAllowed("other.cap", ctx);
            assert.ok(!r.allowed);
            assert.equal(r.reason, "not_allowlisted");
        });

        it("allows capability in allowlist", () => {
            const ctx = perm.createContext({ allowlist: ["ok.cap"] });
            const r = perm.isAllowed("ok.cap", ctx);
            assert.ok(r.allowed);
        });

        it("blocks capability whose policy exceeds maxPolicy", () => {
            const ctx = perm.createContext({ maxPolicy: "readonly" });
            const r = perm.isAllowed("some.cap", ctx, "shell_execute");
            assert.ok(!r.allowed);
            assert.equal(r.reason, "policy_exceeds_context");
        });

        it("returns no_context when context is null", () => {
            const r = perm.isAllowed("x", null);
            assert.ok(!r.allowed);
            assert.equal(r.reason, "no_context");
        });
    });

    describe("validateEscalation", () => {
        it("same policy is allowed", () => {
            assert.ok(perm.validateEscalation("readonly", "readonly").allowed);
        });

        it("escalation from lower to higher is blocked", () => {
            const r = perm.validateEscalation("readonly", "shell_execute");
            assert.ok(!r.allowed);
            assert.ok(r.reason.includes("escalation_blocked"));
        });

        it("descalation is allowed", () => {
            assert.ok(perm.validateEscalation("network_access", "readonly").allowed);
        });

        it("invalid policy returns error reason", () => {
            const r = perm.validateEscalation("unknown", "readonly");
            assert.ok(!r.allowed);
            assert.ok(r.reason.includes("invalid_from_policy"));
        });
    });
});

// ── capabilityContracts ───────────────────────────────────────────────

describe("capabilityContracts", () => {
    describe("defineContract", () => {
        it("returns object with all DEFAULT_CONTRACT keys", () => {
            const c = con.defineContract({});
            for (const k of Object.keys(con.DEFAULT_CONTRACT)) {
                assert.ok(k in c, `missing key: ${k}`);
            }
        });

        it("overrides defaults with provided spec", () => {
            const c = con.defineContract({ timeout: 9999, rollbackSupport: true });
            assert.equal(c.timeout,         9999);
            assert.ok(c.rollbackSupport);
        });

        it("merges retryPolicy instead of replacing", () => {
            const c = con.defineContract({ retryPolicy: { maxRetries: 5 } });
            assert.equal(c.retryPolicy.maxRetries,       5);
            assert.ok("backoffMs" in c.retryPolicy);
        });
    });

    describe("validateInput", () => {
        it("passes when all required fields present", () => {
            const c = con.defineContract({ inputSchema: { cmd: { required: true, type: "string" } } });
            assert.ok(con.validateInput(c, { cmd: "echo hi" }).valid);
        });

        it("fails when required field is missing", () => {
            const c = con.defineContract({ inputSchema: { cmd: { required: true } } });
            const r = con.validateInput(c, {});
            assert.ok(!r.valid);
            assert.ok(r.errors.some(e => e.includes("cmd")));
        });

        it("fails on type mismatch", () => {
            const c = con.defineContract({ inputSchema: { n: { required: true, type: "number" } } });
            const r = con.validateInput(c, { n: "not-a-number" });
            assert.ok(!r.valid);
        });

        it("passes with empty schema and any input", () => {
            const c = con.defineContract({ inputSchema: {} });
            assert.ok(con.validateInput(c, { anything: true }).valid);
        });
    });

    describe("validateOutput", () => {
        it("fails when required output field is missing", () => {
            const c = con.defineContract({ outputSchema: { result: { required: true } } });
            const r = con.validateOutput(c, {});
            assert.ok(!r.valid);
        });

        it("passes when all required output fields present", () => {
            const c = con.defineContract({ outputSchema: { result: { required: true, type: "string" } } });
            assert.ok(con.validateOutput(c, { result: "ok" }).valid);
        });
    });
});

// ── capabilityTelemetry ───────────────────────────────────────────────

describe("capabilityTelemetry", () => {
    afterEach(() => tele.reset());

    it("exports 4 event names", () => {
        const expected = ["capability_started","capability_completed","capability_failed","capability_blocked"];
        for (const e of expected) assert.ok(tele.EVENTS.includes(e), `missing: ${e}`);
    });

    it("emitted event appears in log", () => {
        tele.emit("capability_started", { capabilityId: "x" });
        const log = tele.getLog();
        assert.equal(log.length, 1);
        assert.equal(log[0].event, "capability_started");
        assert.ok("ts" in log[0]);
    });

    it("handler is called on matching event", () => {
        let called = false;
        tele.on("capability_completed", () => { called = true; });
        tele.emit("capability_completed", {});
        assert.ok(called);
    });

    it("off removes handler", () => {
        let count = 0;
        const fn = () => count++;
        tele.on("capability_failed", fn);
        tele.off("capability_failed", fn);
        tele.emit("capability_failed", {});
        assert.equal(count, 0);
    });

    it("handler errors do not crash", () => {
        tele.on("capability_blocked", () => { throw new Error("boom"); });
        assert.doesNotThrow(() => tele.emit("capability_blocked", {}));
    });

    it("clearLog empties log but keeps handlers", () => {
        let called = false;
        tele.on("capability_started", () => { called = true; });
        tele.emit("capability_started", {});
        tele.clearLog();
        assert.deepEqual(tele.getLog(), []);
        tele.emit("capability_started", {});
        assert.ok(called);
    });
});

// ── capabilityPersistence ─────────────────────────────────────────────

describe("capabilityPersistence", () => {
    afterEach(() => pers.reset());

    it("getHistory returns empty array for unknown capability", () => {
        assert.deepEqual(pers.getHistory("ghost"), []);
    });

    it("record + getHistory roundtrip", () => {
        pers.record("cap.a", { input: {}, success: true, policy: "readonly", durationMs: 10 });
        const h = pers.getHistory("cap.a");
        assert.equal(h.length, 1);
        assert.ok(h[0].success);
        assert.ok("ts" in h[0]);
        assert.equal(h[0].capabilityId, "cap.a");
    });

    it("getUsage counts per capability", () => {
        pers.record("cap.a", { success: true });
        pers.record("cap.a", { success: true });
        pers.record("cap.b", { success: false });
        const u = pers.getUsage();
        assert.equal(u["cap.a"], 2);
        assert.equal(u["cap.b"], 1);
    });

    it("getFailures returns only failed entries", () => {
        pers.record("cap.a", { success: true  });
        pers.record("cap.a", { success: false, failureReason: "err" });
        const f = pers.getFailures();
        assert.equal(f.length, 1);
        assert.equal(f[0].failureReason, "err");
    });

    it("getPolicyDecisions returns entries with policyDecision set", () => {
        pers.record("cap.a", { success: false, policyDecision: "blocked" });
        pers.record("cap.a", { success: true });
        const d = pers.getPolicyDecisions();
        assert.equal(d.length, 1);
        assert.equal(d[0].policyDecision, "blocked");
    });
});
