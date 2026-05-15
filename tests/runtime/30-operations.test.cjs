"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const wte = require("../../agents/runtime/trust/workflowTrustEnforcer.cjs");
const wr  = require("../../agents/runtime/enterprise/workflowRegistry.cjs");

// ── workflowTrustEnforcer — register + getStatus ──────────────────────

describe("workflowTrustEnforcer — register", () => {
    afterEach(() => wte.reset());

    it("register returns record with workflowId", () => {
        const rec = wte.register("wf-reg-1");
        assert.equal(rec.workflowId, "wf-reg-1");
    });
    it("register is idempotent (returns same record)", () => {
        const a = wte.register("wf-idem");
        const b = wte.register("wf-idem");
        assert.equal(a.workflowId, b.workflowId);
    });
    it("getStatus for unregistered workflow auto-registers", () => {
        const s = wte.getStatus("wf-auto");
        assert.ok("trustLevel"    in s);
        assert.ok("throttled"     in s);
        assert.ok("requiresApproval" in s);
    });
});

describe("workflowTrustEnforcer — recordOutcome + trustLevel", () => {
    afterEach(() => wte.reset());

    it("new workflow has monitored trust (null successRate)", () => {
        wte.register("wf-new");
        const s = wte.getStatus("wf-new");
        assert.equal(s.trustLevel, "monitored");
    });
    it("consistent success → autonomous", () => {
        wte.register("wf-auto-trust");
        for (let i = 0; i < 10; i++) wte.recordOutcome("wf-auto-trust", true);
        assert.equal(wte.getStatus("wf-auto-trust").trustLevel, "autonomous");
    });
    it("3 consecutive failures → throttled", () => {
        wte.register("wf-throttle");
        for (let i = 0; i < 3; i++) wte.recordOutcome("wf-throttle", false);
        assert.equal(wte.getStatus("wf-throttle").trustLevel, "throttled");
    });
    it("5 consecutive failures → suspended", () => {
        wte.register("wf-suspend");
        for (let i = 0; i < 5; i++) wte.recordOutcome("wf-suspend", false);
        assert.equal(wte.getStatus("wf-suspend").trustLevel, "suspended");
    });
    it("success resets consecutive fail counter", () => {
        wte.register("wf-reset");
        for (let i = 0; i < 3; i++) wte.recordOutcome("wf-reset", false);
        wte.recordOutcome("wf-reset", true);
        const s = wte.getStatus("wf-reset");
        assert.equal(s.consecutiveFails, 0);
    });
    it("successRate is null before any outcomes", () => {
        wte.register("wf-null-rate");
        assert.equal(wte.getStatus("wf-null-rate").successRate, null);
    });
    it("successRate computed correctly", () => {
        wte.register("wf-rate");
        wte.recordOutcome("wf-rate", true);
        wte.recordOutcome("wf-rate", false);
        const s = wte.getStatus("wf-rate");
        assert.equal(s.successRate, 0.5);
    });
});

describe("workflowTrustEnforcer — canExecute", () => {
    afterEach(() => wte.reset());

    it("autonomous workflow: allowed:true, requiresApproval:false", () => {
        wte.register("wf-can-auto");
        for (let i = 0; i < 10; i++) wte.recordOutcome("wf-can-auto", true);
        const r = wte.canExecute("wf-can-auto");
        assert.equal(r.allowed,          true);
        assert.equal(r.requiresApproval, false);
    });
    it("suspended workflow: allowed:false", () => {
        wte.register("wf-can-susp");
        for (let i = 0; i < 5; i++) wte.recordOutcome("wf-can-susp", false);
        const r = wte.canExecute("wf-can-susp");
        assert.equal(r.allowed, false);
    });
    it("throttled workflow: allowed:true, requiresApproval:true, throttleMs > 0", () => {
        wte.register("wf-can-thr");
        for (let i = 0; i < 3; i++) wte.recordOutcome("wf-can-thr", false);
        const r = wte.canExecute("wf-can-thr");
        assert.equal(r.allowed,          true);
        assert.equal(r.requiresApproval, true);
        assert.ok(r.throttleMs > 0);
    });
    it("result includes reason string", () => {
        wte.register("wf-can-reason");
        const r = wte.canExecute("wf-can-reason");
        assert.ok(typeof r.reason === "string");
    });
});

describe("workflowTrustEnforcer — getStatus fields", () => {
    afterEach(() => wte.reset());

    it("streak is positive after consecutive successes", () => {
        wte.register("wf-streak");
        wte.recordOutcome("wf-streak", true);
        wte.recordOutcome("wf-streak", true);
        assert.ok(wte.getStatus("wf-streak").streak > 0);
    });
    it("streak is negative after consecutive failures", () => {
        wte.register("wf-neg-streak");
        wte.recordOutcome("wf-neg-streak", false);
        wte.recordOutcome("wf-neg-streak", false);
        assert.ok(wte.getStatus("wf-neg-streak").streak < 0);
    });
    it("autonomyLevel is a non-empty string", () => {
        wte.register("wf-auto-level");
        const s = wte.getStatus("wf-auto-level");
        assert.ok(typeof s.autonomyLevel === "string" && s.autonomyLevel.length > 0);
    });
    it("totalRuns increases with each outcome", () => {
        wte.register("wf-total");
        wte.recordOutcome("wf-total", true);
        wte.recordOutcome("wf-total", false);
        assert.equal(wte.getStatus("wf-total").totalRuns, 2);
    });
});

describe("workflowTrustEnforcer — listAll", () => {
    afterEach(() => wte.reset());

    it("listAll returns all registered workflows", () => {
        wte.register("wf-list-a");
        wte.register("wf-list-b");
        const all = wte.listAll();
        assert.ok(all.some(w => w.workflowId === "wf-list-a"));
        assert.ok(all.some(w => w.workflowId === "wf-list-b"));
    });
    it("listAll returns empty array after reset", () => {
        wte.reset();
        assert.deepEqual(wte.listAll(), []);
    });
});

// ── workflowRegistry ──────────────────────────────────────────────────

describe("workflowRegistry — register + get", () => {
    afterEach(() => wr.reset());

    it("register returns record with id, name, owner, tags", () => {
        const rec = wr.register("wf-wr-1", { name: "My WF", owner: "alice", tags: ["prod"] });
        assert.equal(rec.id,   "wf-wr-1");
        assert.equal(rec.name, "My WF");
        assert.equal(rec.owner, "alice");
        assert.ok(rec.tags.includes("prod"));
    });
    it("get returns the registered record", () => {
        wr.register("wf-get-1", { name: "Test" });
        assert.ok(wr.get("wf-get-1") !== null);
    });
    it("get returns null for unknown id", () => {
        assert.equal(wr.get("no-such-wf"), null);
    });
    it("register is idempotent", () => {
        const a = wr.register("wf-idem-wr");
        const b = wr.register("wf-idem-wr");
        assert.equal(a.id, b.id);
    });
    it("id defaults to name when name not provided", () => {
        const rec = wr.register("wf-noname");
        assert.equal(rec.name, "wf-noname");
    });
});

describe("workflowRegistry — tag + untag", () => {
    afterEach(() => wr.reset());

    it("tag adds tag to workflow", () => {
        wr.register("wf-tag-1");
        wr.tag("wf-tag-1", "production");
        assert.ok(wr.get("wf-tag-1").tags.includes("production"));
    });
    it("tag does not duplicate existing tag", () => {
        wr.register("wf-tag-2", { tags: ["prod"] });
        wr.tag("wf-tag-2", "prod");
        assert.equal(wr.get("wf-tag-2").tags.filter(t => t === "prod").length, 1);
    });
    it("untag removes tag", () => {
        wr.register("wf-untag", { tags: ["remove-me"] });
        wr.untag("wf-untag", "remove-me");
        assert.ok(!wr.get("wf-untag").tags.includes("remove-me"));
    });
    it("tag returns false for unknown workflow", () => {
        assert.equal(wr.tag("no-such", "x"), false);
    });
});

describe("workflowRegistry — list", () => {
    afterEach(() => wr.reset());

    it("list returns all workflows when no filter", () => {
        wr.register("wf-la");
        wr.register("wf-lb");
        assert.equal(wr.list().length, 2);
    });
    it("list filters by tag", () => {
        wr.register("wf-t1", { tags: ["prod"] });
        wr.register("wf-t2", { tags: ["dev"]  });
        const prod = wr.list({ tag: "prod" });
        assert.equal(prod.length, 1);
        assert.equal(prod[0].id, "wf-t1");
    });
    it("list filters by owner", () => {
        wr.register("wf-o1", { owner: "alice" });
        wr.register("wf-o2", { owner: "bob"   });
        const alice = wr.list({ owner: "alice" });
        assert.equal(alice.length, 1);
    });
    it("empty list returns empty array", () => {
        assert.deepEqual(wr.list(), []);
    });
});

describe("workflowRegistry — recordActivity + getAuditSummary", () => {
    afterEach(() => wr.reset());

    it("recordActivity auto-registers unknown workflow", () => {
        wr.recordActivity("wf-auto-act", "deploy");
        assert.ok(wr.get("wf-auto-act") !== null);
    });
    it("getAuditSummary returns required fields", () => {
        wr.register("wf-audit", { name: "Audit WF", owner: "ops" });
        wr.recordActivity("wf-audit", "deploy");
        const s = wr.getAuditSummary("wf-audit");
        assert.ok("id"            in s);
        assert.ok("name"          in s);
        assert.ok("owner"         in s);
        assert.ok("tags"          in s);
        assert.ok("registeredAt"  in s);
        assert.ok("lastActivity"  in s);
        assert.ok("activityCount" in s);
    });
    it("activityCount increments with each recordActivity call", () => {
        wr.register("wf-acts");
        wr.recordActivity("wf-acts", "deploy");
        wr.recordActivity("wf-acts", "test");
        assert.equal(wr.getAuditSummary("wf-acts").activityCount, 2);
    });
    it("getAuditSummary returns null for unknown workflow", () => {
        assert.equal(wr.getAuditSummary("no-such-wf"), null);
    });
    it("lastActivity is null before any activity", () => {
        wr.register("wf-no-act");
        assert.equal(wr.getAuditSummary("wf-no-act").lastActivity, null);
    });
});

describe("workflowRegistry — pruneExpired", () => {
    afterEach(() => wr.reset());

    it("pruneExpired returns {pruned, remaining}", () => {
        const r = wr.pruneExpired();
        assert.ok("pruned"    in r);
        assert.ok("remaining" in r);
    });
    it("does not prune workflows without retentionDays", () => {
        wr.register("wf-keep", { name: "Keep" });
        const r = wr.pruneExpired();
        assert.equal(r.pruned.length, 0);
        assert.ok(wr.get("wf-keep") !== null);
    });
    it("does not prune recently registered workflow even with retentionDays", () => {
        wr.register("wf-fresh", { retentionDays: 30 });
        const r = wr.pruneExpired();
        assert.equal(r.pruned.length, 0);
    });
    it("remaining count reflects registry size after prune", () => {
        wr.register("wf-p1");
        wr.register("wf-p2");
        const r = wr.pruneExpired();
        assert.equal(r.remaining, 2);
    });
});
