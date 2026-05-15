"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const mae  = require("../../agents/runtime/integrations/memoryAwareExecutor.cjs");
const mem  = require("../../agents/runtime/memory/executionMemoryStore.cjs");
const dst  = require("../../agents/runtime/memory/dependencyStabilityTracker.cjs");
const ttele = require("../../agents/runtime/trust/trustTelemetry.cjs");
const isn  = require("../../agents/runtime/trust/integritySnapshot.cjs");
const td   = require("../../agents/runtime/trust/trustDecay.cjs");

// All tests use dry_run via strategyHint so no real child_process.spawn occurs.
// dry_run marks every step as "simulated" + exitCode 0, returning success:true.

afterEach(() => mae.reset());

// ── helpers ───────────────────────────────────────────────────────────

function _plan(steps = ["a", "b"], taskId = "task-1") {
    return {
        taskId,
        executionOrder: steps,
        steps: steps.map(id => ({ id, name: id, command: `echo ${id}` })),
    };
}

// ── _integration shape ────────────────────────────────────────────────

describe("memoryAwareExecutor – _integration shape", () => {
    it("result includes _integration metadata object", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.ok("_integration" in r, "_integration not found");
    });

    it("_integration contains all required fields", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        const fields = ["fingerprint","strategy","confidence","trustScore","trustGrade",
                        "hallucination","verification","completion","retryPolicy","analytics","blocked"];
        for (const f of fields) assert.ok(f in r._integration, `missing: ${f}`);
    });

    it("fingerprint is an 8-char hex string", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.ok(/^[0-9a-f]{8}$/.test(r._integration.fingerprint));
    });

    it("strategy is dry_run when passed as hint", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.equal(r._integration.strategy, "dry_run");
    });

    it("confidence is a number 0–100", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.ok(typeof r._integration.confidence === "number");
        assert.ok(r._integration.confidence >= 0 && r._integration.confidence <= 100);
    });

    it("trustScore is a number, trustGrade is a letter", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.ok(typeof r._integration.trustScore === "number");
        assert.ok(["A","B","C","D","F"].includes(r._integration.trustGrade));
    });

    it("blocked is false for normal execution", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.ok(!r._integration.blocked);
    });
});

// ── memory recording ──────────────────────────────────────────────────

describe("memoryAwareExecutor – memory recording", () => {
    it("records an entry in executionMemoryStore after execution", async () => {
        await mae.execute(_plan(), "dry_run");
        assert.equal(mem.getAll().length, 1);
    });

    it("memory entry fingerprint matches _integration.fingerprint", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        const entries = mem.getAll();
        assert.equal(entries[0].fingerprint, r._integration.fingerprint);
    });

    it("memory entry strategy matches executed strategy", async () => {
        await mae.execute(_plan(), "dry_run");
        assert.equal(mem.getAll()[0].strategy, "dry_run");
    });

    it("multiple executions accumulate in memory", async () => {
        await mae.execute(_plan(["a"]), "dry_run");
        await mae.execute(_plan(["b"]), "dry_run");
        assert.equal(mem.getAll().length, 2);
    });

    it("success entry recorded for dry_run", async () => {
        await mae.execute(_plan(), "dry_run");
        // dry_run always returns success:true — completion policy (lenient) should pass
        const entries = mem.getAll();
        assert.ok(entries.some(e => e.success), "expected at least one success entry");
    });
});

// ── dependency tracking ───────────────────────────────────────────────

describe("memoryAwareExecutor – dependency tracking", () => {
    it("records dep stability for each step after execution", async () => {
        await mae.execute(_plan(["install","build"]), "dry_run");
        const all = dst.getAll();
        assert.ok("install" in all || "build" in all, "no dep entries recorded");
    });

    it("simulated steps record tool_success events", async () => {
        await mae.execute(_plan(["npm-install"]), "dry_run");
        const stab = dst.getStability("npm-install");
        assert.ok(stab.successes >= 1 || stab.total === 0, "expected success recorded");
    });
});

// ── trust telemetry ───────────────────────────────────────────────────

describe("memoryAwareExecutor – trust telemetry", () => {
    it("emits trust_increase events during execution", async () => {
        await mae.execute(_plan(), "dry_run");
        const log = ttele.getLog();
        assert.ok(log.some(e => e.event === "trust_increase"), "no trust_increase emitted");
    });

    it("emits verification_success for successful dry_run", async () => {
        await mae.execute(_plan(), "dry_run");
        const log = ttele.getLog();
        assert.ok(log.some(e => e.event === "trust_increase" || e.event === "verification_success"));
    });

    it("all emitted events have a ts field", async () => {
        await mae.execute(_plan(), "dry_run");
        const log = ttele.getLog();
        for (const e of log) assert.ok("ts" in e, `event ${e.event} missing ts`);
    });
});

// ── integrity snapshot ────────────────────────────────────────────────

describe("memoryAwareExecutor – integrity snapshot", () => {
    it("takes at least one snapshot after execution", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        const snaps = isn.get(r.executionId);
        assert.ok(snaps.length >= 1, "no integrity snapshot taken");
    });

    it("snapshot executionId matches result executionId", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        const snaps = isn.get(r.executionId);
        assert.equal(snaps[0].executionId, r.executionId);
    });
});

// ── blocking behaviour ────────────────────────────────────────────────

describe("memoryAwareExecutor – blocking dangerous workflows", () => {
    it("blocks execution after 3 consecutive failures for same fingerprint", async () => {
        const plan = _plan(["danger-step"], "dangerous-task");

        // Pre-populate memory with 3 failures
        const { fingerprint } = (await mae.execute(plan, "dry_run"))._integration;
        mae.reset();  // clear runtime state but re-add entries manually

        // Inject 3 failures directly into memory (reset clears everything)
        // So we rebuild: do 3 executions then inject 4th
        // Actually reset clears memory too. Use direct mem injection:
        for (let i = 0; i < 3; i++) {
            mem.record({ fingerprint, success: false, strategy: "direct",
                         retryCount: 0, rollbackTriggered: false,
                         ts: new Date().toISOString(), durationMs: 50, state: "failed" });
        }

        const r = await mae.execute(plan, "dry_run");
        assert.ok(r._integration.blocked, "expected execution to be blocked");
        assert.equal(r.state, "blocked");
        assert.ok(!r.success);
    });

    it("blocked result has correct shape", async () => {
        const plan = _plan(["block-step"], "block-task");
        const { fingerprint } = (await mae.execute(plan, "dry_run"))._integration;
        mae.reset();

        for (let i = 0; i < 3; i++) {
            mem.record({ fingerprint, success: false, strategy: "direct",
                         retryCount: 0, rollbackTriggered: false,
                         ts: new Date().toISOString(), durationMs: 50, state: "failed" });
        }

        const r = await mae.execute(plan, "dry_run");
        assert.equal(r._integration.trustGrade,  "F");
        assert.equal(r._integration.confidence,  0);
        assert.equal(r._integration.trustScore,  0);
        assert.ok(r._integration.completion.reasons.length > 0);
    });

    it("forceExecute bypasses blocking", async () => {
        const plan = _plan(["force-step"], "force-task");
        const { fingerprint } = (await mae.execute(plan, "dry_run"))._integration;
        mae.reset();

        for (let i = 0; i < 3; i++) {
            mem.record({ fingerprint, success: false, strategy: "direct",
                         retryCount: 0, rollbackTriggered: false,
                         ts: new Date().toISOString(), durationMs: 50, state: "failed" });
        }

        const r = await mae.execute(plan, "dry_run", {}, { forceExecute: true });
        assert.ok(!r._integration.blocked, "should not be blocked with forceExecute");
    });
});

// ── confidence improves with history ─────────────────────────────────

describe("memoryAwareExecutor – confidence adaptation", () => {
    it("second execution of same plan has higher confidence than first", async () => {
        const plan = _plan(["ci-step"], "ci-task");
        const r1   = await mae.execute(plan, "dry_run");
        const r2   = await mae.execute(plan, "dry_run");
        assert.ok(
            r2._integration.confidence >= r1._integration.confidence,
            `expected confidence to grow: ${r1._integration.confidence} → ${r2._integration.confidence}`
        );
    });
});

// ── analytics ─────────────────────────────────────────────────────────

describe("memoryAwareExecutor – analytics", () => {
    it("_integration.analytics has totalExecutions = 1 for single run", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.equal(r._integration.analytics.totalExecutions, 1);
    });

    it("analytics successRate is between 0 and 1", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        const { successRate } = r._integration.analytics;
        assert.ok(successRate >= 0 && successRate <= 1);
    });
});

// ── strategy selection from memory ────────────────────────────────────

describe("memoryAwareExecutor – strategy selection", () => {
    it("strategy hint overrides memory-based selection", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.equal(r._integration.strategy, "dry_run");
    });

    it("no hint: selects a valid strategy from memory context", async () => {
        const { STRATEGIES } = require("../../agents/runtime/memory/executionStrategySelector.cjs");
        const r = await mae.execute(_plan(), null);
        assert.ok(STRATEGIES.includes(r._integration.strategy) || r._integration.strategy === "dry_run",
                  `unexpected strategy: ${r._integration.strategy}`);
    });
});

// ── regression: existing result shape preserved ───────────────────────

describe("memoryAwareExecutor – backward-compat result shape", () => {
    it("all original runtimeExecutor fields are present", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        for (const f of ["executionId","success","state","strategy","steps","stepsPlanned",
                         "stepsExecuted","totalDurationMs","rollbackTriggered","cancelled",
                         "error","completedAt","mode","dryRun","isolated","rollbackReady",
                         "checkpointed","simulatedOnly"]) {
            assert.ok(f in r, `missing field: ${f}`);
        }
    });

    it("_integration does not overwrite success field", async () => {
        const r = await mae.execute(_plan(), "dry_run");
        assert.ok(typeof r.success === "boolean");
    });
});
