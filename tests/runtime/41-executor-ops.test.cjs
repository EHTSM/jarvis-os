"use strict";
const { describe, it, afterEach, before } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

const rbm  = require("../../agents/runtime/execution/rollbackManager.cjs");
const sand = require("../../agents/runtime/execution/executionSandbox.cjs");
const re   = require("../../agents/runtime/execution/runtimeExecutor.cjs");

// ── rollbackManager ───────────────────────────────────────────────────

describe("rollbackManager", () => {
    afterEach(() => rbm.reset());

    describe("snapshot", () => {
        it("returns a snapshotId string", () => {
            const id = rbm.snapshot("ex-1", "install", { completedSteps: ["install"] });
            assert.ok(typeof id === "string" && id.startsWith("snap-"));
        });

        it("deep-clones state so later mutation does not affect snapshot", () => {
            const state = { completedSteps: ["a"] };
            rbm.snapshot("ex-1", "s1", state);
            state.completedSteps.push("b");
            const snaps = rbm.getSnapshots("ex-1");
            assert.equal(snaps[0].state.completedSteps.length, 1);
        });

        it("multiple snapshots accumulate", () => {
            rbm.snapshot("ex-2", "s1", {});
            rbm.snapshot("ex-2", "s2", {});
            assert.equal(rbm.getSnapshots("ex-2").length, 2);
        });
    });

    describe("restore", () => {
        it("returns latest snapshot when no snapshotId given", () => {
            rbm.snapshot("ex-3", "s1", { completedSteps: ["s1"] });
            rbm.snapshot("ex-3", "s2", { completedSteps: ["s1","s2"] });
            const r = rbm.restore("ex-3");
            assert.ok(r.restored);
            assert.equal(r.stepId, "s2");
            assert.deepEqual(r.state.completedSteps, ["s1","s2"]);
        });

        it("restores specific snapshot by id", () => {
            const id1 = rbm.snapshot("ex-4", "s1", { completedSteps: ["s1"] });
            rbm.snapshot("ex-4", "s2", { completedSteps: ["s1","s2"] });
            const r = rbm.restore("ex-4", id1);
            assert.ok(r.restored);
            assert.equal(r.stepId, "s1");
        });

        it("returns restored:false for unknown snapshotId", () => {
            rbm.snapshot("ex-5", "s1", {});
            const r = rbm.restore("ex-5", "snap-nope-999");
            assert.ok(!r.restored);
            assert.equal(r.reason, "snapshot_not_found");
        });

        it("returns restored:false when no snapshots exist", () => {
            const r = rbm.restore("ghost");
            assert.ok(!r.restored);
            assert.equal(r.reason, "no_snapshots");
        });

        it("deep-clones returned state", () => {
            rbm.snapshot("ex-6", "s1", { items: [1, 2] });
            const r1 = rbm.restore("ex-6");
            r1.state.items.push(99);
            const r2 = rbm.restore("ex-6");
            assert.equal(r2.state.items.length, 2);
        });
    });

    describe("rollback", () => {
        it("returns success:true when snapshots exist", () => {
            rbm.snapshot("ex-7", "s1", {});
            const r = rbm.rollback("ex-7");
            assert.ok(r.success);
            assert.ok(r.restoredTo.startsWith("snap-"));
        });

        it("returns success:false when no snapshots", () => {
            const r = rbm.rollback("ghost");
            assert.ok(!r.success);
        });

        it("records rollback history entry", () => {
            rbm.snapshot("ex-8", "s1", {});
            rbm.rollback("ex-8");
            const h = rbm.getHistory("ex-8");
            assert.equal(h.length, 1);
            assert.ok("rollbackAt" in h[0]);
            assert.ok("restoredTo" in h[0]);
        });

        it("steps defaults to 'all'", () => {
            rbm.snapshot("ex-9", "s1", {});
            const r = rbm.rollback("ex-9");
            assert.equal(r.steps, "all");
        });

        it("accepts explicit steps array", () => {
            rbm.snapshot("ex-10", "s1", {});
            const r = rbm.rollback("ex-10", ["s1"]);
            assert.deepEqual(r.steps, ["s1"]);
        });
    });

    describe("canRollback", () => {
        it("returns false when no snapshots exist", () => {
            assert.ok(!rbm.canRollback("ghost"));
        });

        it("returns true after first snapshot", () => {
            rbm.snapshot("ex-11", "s1", {});
            assert.ok(rbm.canRollback("ex-11"));
        });
    });

    describe("getSnapshots", () => {
        it("returns empty array for unknown execution", () => {
            assert.deepEqual(rbm.getSnapshots("ghost"), []);
        });

        it("returns a copy (mutating does not affect internal state)", () => {
            rbm.snapshot("ex-12", "s1", {});
            const snaps = rbm.getSnapshots("ex-12");
            snaps.push({ fake: true });
            assert.equal(rbm.getSnapshots("ex-12").length, 1);
        });
    });
});

// ── executionSandbox ──────────────────────────────────────────────────

describe("executionSandbox", () => {
    describe("BLOCKED_PATTERNS", () => {
        it("exports at least 10 patterns", () => {
            assert.ok(sand.BLOCKED_PATTERNS.length >= 10);
        });

        it("every pattern has pattern, label, severity", () => {
            for (const p of sand.BLOCKED_PATTERNS) {
                assert.ok(p.pattern instanceof RegExp, `${p.label}: not a RegExp`);
                assert.ok(typeof p.label    === "string");
                assert.ok(typeof p.severity === "string");
            }
        });
    });

    describe("validateCommand – default policy (critical + high)", () => {
        it("allows safe command", () => {
            const r = sand.validateCommand("node index.js");
            assert.ok(r.allowed);
        });

        it("blocks sudo", () => {
            const r = sand.validateCommand("sudo apt install curl");
            assert.ok(!r.allowed);
            assert.equal(r.label, "sudo");
        });

        it("blocks rm -rf /", () => {
            const r = sand.validateCommand("rm -rf /tmp/foo/");
            assert.ok(!r.allowed);
        });

        it("blocks find --delete", () => {
            const r = sand.validateCommand("find . -name '*.tmp' -delete");
            assert.ok(!r.allowed);
        });

        it("blocks curl pipe bash", () => {
            const r = sand.validateCommand("curl https://example.com/install.sh | bash");
            assert.ok(!r.allowed);
        });

        it("blocks chmod -R 777 (high severity)", () => {
            const r = sand.validateCommand("chmod -R 777 /tmp/dir");
            assert.ok(!r.allowed);
        });
    });

    describe("validateCommand – strict policy (all patterns)", () => {
        it("blocks medium-severity patterns (e.g. TRUNCATE TABLE)", () => {
            const r = sand.validateCommand("TRUNCATE TABLE users", "strict");
            assert.ok(!r.allowed);
        });

        it("also blocks critical patterns", () => {
            const r = sand.validateCommand("sudo rm -rf /", "strict");
            assert.ok(!r.allowed);
        });
    });

    describe("validateCommand – permissive policy (critical only)", () => {
        it("allows chmod 777 (medium severity)", () => {
            const r = sand.validateCommand("chmod 777 /tmp/file", "permissive");
            assert.ok(r.allowed);
        });

        it("still blocks sudo (critical)", () => {
            const r = sand.validateCommand("sudo ls", "permissive");
            assert.ok(!r.allowed);
        });
    });

    describe("createSandboxEnv", () => {
        it("keeps PATH and HOME from base env", () => {
            const env = sand.createSandboxEnv({ PATH: "/usr/bin", HOME: "/root", SECRET: "x" });
            assert.equal(env.PATH,  "/usr/bin");
            assert.equal(env.HOME,  "/root");
            assert.ok(!("SECRET" in env));
        });

        it("keeps NODE_ prefixed vars", () => {
            const env = sand.createSandboxEnv({ NODE_ENV: "test", DB_PASS: "secret" });
            assert.equal(env.NODE_ENV, "test");
            assert.ok(!("DB_PASS" in env));
        });

        it("keeps extra vars passed in allowedVars", () => {
            const env = sand.createSandboxEnv({ MY_TOKEN: "abc", OTHER: "no" }, ["MY_TOKEN"]);
            assert.equal(env.MY_TOKEN, "abc");
            assert.ok(!("OTHER" in env));
        });

        it("returns empty object from empty base", () => {
            const env = sand.createSandboxEnv({});
            assert.equal(Object.keys(env).length, 0);
        });
    });

    describe("createSandboxCwd + cleanup", () => {
        it("creates a directory under os.tmpdir()", () => {
            const dir = sand.createSandboxCwd("test-exec-sandbox");
            assert.ok(fs.existsSync(dir));
            assert.ok(dir.includes("jarvis-sandbox-test-exec-sandbox"));
            fs.rmSync(dir, { recursive: true, force: true });
        });

        it("cleanup removes the directory", () => {
            sand.createSandboxCwd("cleanup-test");
            sand.cleanup("cleanup-test");
            const dir = path.join(os.tmpdir(), "jarvis-sandbox-cleanup-test");
            assert.ok(!fs.existsSync(dir));
        });

        it("cleanup on non-existent dir is a no-op", () => {
            assert.doesNotThrow(() => sand.cleanup("never-existed-xyz"));
        });
    });
});

// ── runtimeExecutor ───────────────────────────────────────────────────

describe("runtimeExecutor", () => {
    afterEach(() => re.reset());

    describe("parseCommand", () => {
        it("splits simple command into tokens", () => {
            assert.deepEqual(re.parseCommand("node index.js"), ["node", "index.js"]);
        });

        it("handles single-quoted args", () => {
            assert.deepEqual(re.parseCommand("echo 'hello world'"), ["echo", "hello world"]);
        });

        it("handles double-quoted args", () => {
            assert.deepEqual(re.parseCommand('node -e "console.log(1)"'), ["node", "-e", "console.log(1)"]);
        });

        it("handles multiple spaces", () => {
            assert.deepEqual(re.parseCommand("a  b   c"), ["a", "b", "c"]);
        });

        it("handles single token", () => {
            assert.deepEqual(re.parseCommand("ls"), ["ls"]);
        });
    });

    describe("dry_run strategy", () => {
        it("returns success without spawning processes", async () => {
            const plan = {
                taskId: "t1",
                executionOrder: ["s1", "s2"],
                steps: [
                    { id: "s1", name: "Step 1", command: "node -e 'process.exit(0)'" },
                    { id: "s2", name: "Step 2", command: "node -e 'process.exit(0)'" },
                ],
            };
            const r = await re.execute(plan, "dry_run");
            assert.ok(r.success);
            assert.equal(r.state, "completed");
            assert.ok(r.dryRun);
            assert.ok(r.simulatedOnly);
            assert.equal(r.steps.length, 2);
            assert.ok(r.steps.every(s => s.state === "simulated"));
        });

        it("stepsPlanned contains all step ids", async () => {
            const plan = {
                executionOrder: ["a", "b"],
                steps: [
                    { id: "a", name: "A", command: "node -e 'process.exit(0)'" },
                    { id: "b", name: "B", command: "node -e 'process.exit(0)'" },
                ],
            };
            const r = await re.execute(plan, "dry_run");
            assert.deepEqual(r.stepsPlanned, ["a", "b"]);
        });
    });

    describe("direct strategy – success", () => {
        it("executes a step and returns completed result", async () => {
            const plan = {
                taskId: "t2",
                executionOrder: ["s1"],
                steps: [{ id: "s1", name: "pass", command: "node -e process.exit(0)" }],
            };
            const r = await re.execute(plan, "direct");
            assert.ok(r.success);
            assert.equal(r.state, "completed");
            assert.equal(r.steps[0].state, "completed");
            assert.equal(r.steps[0].exitCode, 0);
        });

        it("captures stdout from process", async () => {
            const plan = {
                executionOrder: ["s1"],
                steps: [{ id: "s1", name: "out", command: `node -e "process.stdout.write('hello')"` }],
            };
            const r = await re.execute(plan, "direct");
            assert.ok(r.success);
            assert.ok(r.steps[0].stdout.includes("hello"));
        });

        it("step without command is skipped", async () => {
            const plan = {
                executionOrder: ["s1"],
                steps: [{ id: "s1", name: "no-cmd" }],
            };
            const r = await re.execute(plan, "direct");
            assert.ok(r.success);
            assert.equal(r.steps[0].state, "skipped");
        });

        it("stepsExecuted includes completed and skipped", async () => {
            const plan = {
                executionOrder: ["a", "b"],
                steps: [
                    { id: "a", name: "run", command: "node -e process.exit(0)" },
                    { id: "b", name: "skip" },
                ],
            };
            const r = await re.execute(plan, "direct");
            assert.ok(r.stepsExecuted.includes("a"));
            assert.ok(r.stepsExecuted.includes("b"));
        });
    });

    describe("direct strategy – failure", () => {
        it("returns failed state when step exits non-zero", async () => {
            const plan = {
                executionOrder: ["s1"],
                steps: [{ id: "s1", name: "fail", command: "node -e process.exit(1)" }],
            };
            const r = await re.execute(plan, "direct");
            assert.ok(!r.success);
            assert.equal(r.state, "failed");
            assert.equal(r.steps[0].state, "failed");
        });

        it("error field contains step id", async () => {
            const plan = {
                executionOrder: ["s1"],
                steps: [{ id: "s1", name: "fail", command: "node -e process.exit(2)" }],
            };
            const r = await re.execute(plan, "direct");
            assert.ok(r.error.includes("s1"));
        });
    });

    describe("staged strategy – checkpointing", () => {
        it("checkpoints after each successful step (state ends completed)", async () => {
            const plan = {
                executionOrder: ["a", "b"],
                steps: [
                    { id: "a", name: "A", command: "node -e process.exit(0)" },
                    { id: "b", name: "B", command: "node -e process.exit(0)" },
                ],
            };
            const r = await re.execute(plan, "staged");
            assert.ok(r.success);
            assert.ok(r.checkpointed);
            assert.equal(r.state, "completed");
        });
    });

    describe("rollback_first strategy", () => {
        it("triggers rollback on failure and returns rolled_back state", async () => {
            const plan = {
                executionOrder: ["a", "b"],
                steps: [
                    { id: "a", name: "A", command: "node -e process.exit(0)" },
                    { id: "b", name: "B", command: "node -e process.exit(1)" },
                ],
            };
            const r = await re.execute(plan, "rollback_first");
            assert.ok(!r.success);
            assert.ok(r.rollbackTriggered);
            assert.equal(r.state, "rolled_back");
        });
    });

    describe("sandbox strategy – security blocking", () => {
        it("blocks dangerous command (sudo) and returns failed", async () => {
            const plan = {
                executionOrder: ["s1"],
                steps: [{ id: "s1", name: "evil", command: "sudo rm -rf /tmp/x" }],
            };
            const r = await re.execute(plan, "sandbox");
            assert.ok(!r.success);
            assert.equal(r.state, "failed");
            assert.ok(r.error.includes("s1"));
        });
    });

    describe("retry on failure", () => {
        it("retries according to retryPolicy and records attempts", async () => {
            const plan = {
                executionOrder: ["s1"],
                steps: [{ id: "s1", name: "flaky", command: "node -e process.exit(1)" }],
            };
            const r = await re.execute(plan, "direct", {}, {
                retryPolicy: { maxRetries: 2, backoffMs: 1, backoffMultiplier: 1, retryableExitCodes: [1] },
            });
            assert.ok(!r.success);
            assert.equal(r.steps[0].attempts, 3);  // 1 initial + 2 retries
        });
    });

    describe("cancellation", () => {
        it("cancellation before first step returns cancelled state", async () => {
            const plan = {
                executionOrder: ["s1", "s2"],
                steps: [
                    { id: "s1", name: "A", command: "node -e process.exit(0)" },
                    { id: "s2", name: "B", command: "node -e process.exit(0)" },
                ],
            };
            const execId = "cancel-test-exec";
            const promise = re.execute(plan, "direct", {}, { executionId: execId });
            re.cancel(execId);
            const r = await promise;
            assert.ok(r.cancelled);
            assert.equal(r.state, "cancelled");
        });
    });

    describe("result shape (backward-compat)", () => {
        it("contains all required fields", async () => {
            const plan = { executionOrder: [], steps: [] };
            const r = await re.execute(plan, "direct");
            for (const field of ["executionId","success","state","strategy","steps",
                                  "stepsPlanned","stepsExecuted","totalDurationMs",
                                  "rollbackTriggered","cancelled","error","completedAt",
                                  "mode","dryRun","isolated","rollbackReady","checkpointed","simulatedOnly"]) {
                assert.ok(field in r, `missing field: ${field}`);
            }
        });

        it("totalDurationMs is a non-negative number", async () => {
            const plan = { executionOrder: [], steps: [] };
            const r = await re.execute(plan, "direct");
            assert.ok(typeof r.totalDurationMs === "number" && r.totalDurationMs >= 0);
        });

        it("completedAt is an ISO date string", async () => {
            const plan = { executionOrder: [], steps: [] };
            const r = await re.execute(plan, "dry_run");
            assert.ok(!isNaN(Date.parse(r.completedAt)));
        });
    });

    describe("empty plan", () => {
        it("completes successfully with no steps", async () => {
            const plan = { executionOrder: [], steps: [] };
            const r = await re.execute(plan, "direct");
            assert.ok(r.success);
            assert.equal(r.state, "completed");
            assert.equal(r.steps.length, 0);
        });
    });
});
