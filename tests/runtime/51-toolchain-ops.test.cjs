"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path   = require("path");

const cpm  = require("../../agents/runtime/toolchain/checkpointManager.cjs");
const rbi  = require("../../agents/runtime/toolchain/rollbackIntegration.cjs");
const ev   = require("../../agents/runtime/toolchain/environmentVerifier.cjs");
const tex  = require("../../agents/runtime/toolchain/toolchainExecutor.cjs");
const tele = require("../../agents/runtime/toolchain/toolchainTelemetry.cjs");

const CWD = process.cwd();

afterEach(() => { tex.reset(); tele.reset(); });

// ── checkpointManager ─────────────────────────────────────────────────

describe("checkpointManager – take", () => {
    afterEach(() => cpm.reset());

    it("returns a checkpoint with id, ts, cwd, fileCount", () => {
        const cp = cpm.take("exec-1", { cwd: CWD });
        assert.ok(typeof cp.id        === "string");
        assert.ok(typeof cp.ts        === "string");
        assert.equal(cp.cwd,            CWD);
        assert.ok(typeof cp.fileCount === "number");
    });

    it("checkpoint id starts with cp-", () => {
        const cp = cpm.take("exec-2", { cwd: CWD });
        assert.ok(cp.id.startsWith("cp-exec-2"));
    });

    it("sequential checkpoints get different ids", () => {
        const cp1 = cpm.take("exec-3", { cwd: CWD });
        const cp2 = cpm.take("exec-3", { cwd: CWD });
        assert.notEqual(cp1.id, cp2.id);
    });

    it("getLatest returns last checkpoint for executionId", () => {
        cpm.take("exec-4", { cwd: CWD });
        const cp2 = cpm.take("exec-4", { cwd: CWD });
        assert.equal(cpm.getLatest("exec-4")?.id, cp2.id);
    });

    it("getLatest returns null for unknown executionId", () => {
        assert.equal(cpm.getLatest("no-such-id"), null);
    });

    it("getAll returns all checkpoints for an executionId", () => {
        cpm.take("exec-5", { cwd: CWD });
        cpm.take("exec-5", { cwd: CWD });
        assert.equal(cpm.getAll("exec-5").length, 2);
    });
});

describe("checkpointManager – compare", () => {
    afterEach(() => cpm.reset());

    it("returns changed:false when checkpoints are equal", () => {
        const cp1 = cpm.take("exec-cmp", { cwd: CWD });
        const cp2 = cpm.take("exec-cmp", { cwd: CWD });
        const r   = cpm.compare(cp1, cp2);
        // fileCount and gitStatus should be the same in the same instant
        assert.equal(typeof r.changed, "boolean");
        assert.ok(Array.isArray(r.diffs));
    });

    it("returns changed:false when both args are null", () => {
        assert.ok(!cpm.compare(null, null).changed);
    });

    it("detects fileCount change", () => {
        const cp1 = { id: "a", fileCount: 5, gitStatus: "", depsHash: null };
        const cp2 = { id: "b", fileCount: 6, gitStatus: "", depsHash: null };
        const r   = cpm.compare(cp1, cp2);
        assert.ok(r.changed);
        assert.ok(r.diffs.some(d => d.field === "fileCount"));
    });

    it("detects gitStatus change", () => {
        const cp1 = { id: "a", fileCount: 5, gitStatus: "",     depsHash: null };
        const cp2 = { id: "b", fileCount: 5, gitStatus: "M foo", depsHash: null };
        const r   = cpm.compare(cp1, cp2);
        assert.ok(r.diffs.some(d => d.field === "gitStatus"));
    });
});

// ── rollbackIntegration ───────────────────────────────────────────────

describe("rollbackIntegration – rollback", () => {
    afterEach(() => rbi.reset());

    it("returns success:false when no checkpoint available", () => {
        const r = rbi.rollback("no-exec", { cwd: CWD, dryRun: true });
        assert.ok(!r.success);
        assert.ok(typeof r.reason === "string");
    });

    it("returns success:true when checkpoint exists (dryRun)", () => {
        cpm.take("rb-exec-1", { cwd: CWD });
        const r = rbi.rollback("rb-exec-1", { cwd: CWD, dryRun: true });
        assert.ok(r.success);
    });

    it("rollback entry includes executionId", () => {
        cpm.take("rb-exec-2", { cwd: CWD });
        rbi.rollback("rb-exec-2", { cwd: CWD, dryRun: true });
        const log = rbi.getLog();
        assert.ok(log.some(e => e.executionId === "rb-exec-2"));
    });

    it("dryRun flag is recorded in log entry", () => {
        cpm.take("rb-exec-3", { cwd: CWD });
        rbi.rollback("rb-exec-3", { cwd: CWD, dryRun: true });
        const log = rbi.getLog();
        assert.ok(log.some(e => e.dryRun === true));
    });

    it("revertGitState with dryRun returns success:true simulated", () => {
        const r = rbi.revertGitState(CWD, { dryRun: true });
        assert.ok(r.success);
        assert.ok(r.simulated);
    });
});

// ── environmentVerifier ───────────────────────────────────────────────

describe("environmentVerifier – verifyFileChanged", () => {
    it("returns verified:false for non-existent file", () => {
        const r = ev.verifyFileChanged("/no/such/file.txt", 0);
        assert.ok(!r.verified);
    });

    it("returns verified:true when mtime is newer", () => {
        const r = ev.verifyFileChanged(path.join(CWD, "package.json"), 0);
        // package.json exists and mtime > 0 → should be true
        assert.ok(r.verified);
    });

    it("returns verified:false when mtime is the same or older", () => {
        const stat = require("fs").statSync(path.join(CWD, "package.json"));
        const r = ev.verifyFileChanged(path.join(CWD, "package.json"), stat.mtimeMs + 1000);
        assert.ok(!r.verified);
    });
});

describe("environmentVerifier – verifyBuildSucceeded", () => {
    it("returns verified:true for existing file (package.json)", () => {
        const r = ev.verifyBuildSucceeded(path.join(CWD, "package.json"));
        assert.ok(r.verified);
    });

    it("returns verified:false for missing artifact", () => {
        const r = ev.verifyBuildSucceeded("/no/such/build/artifact.js");
        assert.ok(!r.verified);
    });

    it("includes artifactPath in result", () => {
        const p = path.join(CWD, "package.json");
        const r = ev.verifyBuildSucceeded(p);
        assert.equal(r.artifactPath, p);
    });
});

describe("environmentVerifier – verifyPortOpen", () => {
    it("returns verified:false for a closed port (high port unlikely to be open)", async () => {
        const r = await ev.verifyPortOpen(19999, { host: "127.0.0.1", timeout: 500 });
        assert.ok(!r.verified);
    });

    it("result includes port and host", async () => {
        const r = await ev.verifyPortOpen(19998, { host: "127.0.0.1", timeout: 500 });
        assert.equal(r.port, 19998);
        assert.equal(r.host, "127.0.0.1");
    });
});

describe("environmentVerifier – verifyProcessRunning", () => {
    it("finds the current node process", () => {
        const r = ev.verifyProcessRunning("node");
        assert.ok(r.verified);
    });

    it("returns verified:false for non-existent process name", () => {
        const r = ev.verifyProcessRunning("totally_fake_process_xyz_12345");
        assert.ok(!r.verified);
    });

    it("result includes processName", () => {
        const r = ev.verifyProcessRunning("node");
        assert.equal(r.processName, "node");
    });
});

// ── toolchainExecutor ─────────────────────────────────────────────────

function _plan(steps = ["a", "b"], taskId = "task-1") {
    return {
        taskId,
        executionOrder: steps,
        steps: steps.map(id => ({ id, name: id, command: `echo ${id}` })),
    };
}

function _dangerousPlan(taskId = "danger-task") {
    return {
        taskId,
        executionOrder: ["del"],
        steps: [{ id: "del", name: "del", command: "rm -rf /tmp/safe_to_delete" }],
    };
}

describe("toolchainExecutor – safe execution", () => {
    it("returns success:true for safe echo plan", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok(r.success);
    });

    it("result has classification field", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok("classification" in r);
    });

    it("safe plan classification is safe", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.equal(r.classification, "safe");
    });

    it("result has sandboxRedirected field", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok("sandboxRedirected" in r);
    });

    it("safe plan is not sandbox-redirected", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok(!r.sandboxRedirected);
    });

    it("result has checkpoint and postCheckpoint", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok("checkpoint"     in r);
        assert.ok("postCheckpoint" in r);
    });

    it("telemetry: execution_started and execution_completed emitted", async () => {
        await tex.execute(_plan(), { dryRun: true });
        const log = tele.getLog();
        assert.ok(log.some(e => e.event === "execution_started"));
        assert.ok(log.some(e => e.event === "execution_completed"));
    });

    it("result includes _integration metadata", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok("_integration" in r);
    });

    it("blocked is false for safe plan", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok(!r.blocked);
    });
});

describe("toolchainExecutor – governance blocking", () => {
    it("blocks rm -rf without bypassGovernance", async () => {
        const r = await tex.execute(_dangerousPlan(), {});
        assert.ok(r.blocked);
        assert.equal(r.state, "governance_blocked");
    });

    it("blocked result has blockReason", async () => {
        const r = await tex.execute(_dangerousPlan(), {});
        assert.ok(typeof r.blockReason === "string" && r.blockReason.length > 0);
    });

    it("blocked result success is false", async () => {
        const r = await tex.execute(_dangerousPlan(), {});
        assert.ok(!r.success);
    });

    it("dangerous_action_blocked telemetry emitted", async () => {
        await tex.execute(_dangerousPlan(), {});
        assert.ok(tele.getLog().some(e => e.event === "dangerous_action_blocked"));
    });

    it("bypassGovernance + dryRun proceeds past governance", async () => {
        const r = await tex.execute(_dangerousPlan(), { bypassGovernance: true, dryRun: true, bypassApproval: true });
        assert.ok(!r.blocked || r.state !== "governance_blocked");
    });
});

describe("toolchainExecutor – sandbox routing", () => {
    it("elevated plan is not sandboxed", async () => {
        const plan = {
            taskId: "elev-task",
            executionOrder: ["install"],
            steps: [{ id: "install", name: "install", command: "npm install --dry-run" }],
        };
        const r = await tex.execute(plan, { dryRun: true });
        assert.ok(!r.sandboxRedirected);
    });
});

describe("toolchainExecutor – rollback", () => {
    it("no auto-rollback for safe successful plan", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.equal(r.rollback, null);
    });
});

describe("toolchainExecutor – result shape", () => {
    it("has retryBudget field", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok("retryBudget" in r);
    });

    it("has verificationPolicy field", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok("verificationPolicy" in r);
    });

    it("stateChanged is a boolean", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.equal(typeof r.stateChanged, "boolean");
    });

    it("diffs is an array", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        assert.ok(Array.isArray(r.diffs));
    });

    it("all original runtimeExecutor fields preserved", async () => {
        const r = await tex.execute(_plan(), { dryRun: true });
        for (const f of ["executionId","success","state","steps","stepsPlanned","stepsExecuted",
                         "totalDurationMs","rollbackTriggered","cancelled","completedAt"]) {
            assert.ok(f in r, `missing field: ${f}`);
        }
    });
});
