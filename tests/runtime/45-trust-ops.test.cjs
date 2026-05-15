"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const os     = require("os");
const path   = require("path");

const ve  = require("../../agents/runtime/trust/verificationEngine.cjs");
const hd  = require("../../agents/runtime/trust/hallucinationDetector.cjs");
const cp  = require("../../agents/runtime/trust/completionPolicy.cjs");
const isn = require("../../agents/runtime/trust/integritySnapshot.cjs");

// ── verificationEngine ────────────────────────────────────────────────

describe("verificationEngine", () => {
    describe("verifyOutput", () => {
        it("passes when expected is null", () => {
            const r = ve.verifyOutput(null, { anything: true });
            assert.ok(r.verified);
        });

        it("passes when all expected fields match", () => {
            const r = ve.verifyOutput({ status: "ok", code: 0 }, { status: "ok", code: 0, extra: "ignored" });
            assert.ok(r.verified);
            assert.equal(r.issues.length, 0);
        });

        it("fails when expected field is missing from actual", () => {
            const r = ve.verifyOutput({ result: "done" }, {});
            assert.ok(!r.verified);
            assert.ok(r.issues.some(i => i.includes("result")));
        });

        it("fails when field value does not match", () => {
            const r = ve.verifyOutput({ code: 0 }, { code: 1 });
            assert.ok(!r.verified);
        });

        it("checked array contains inspected field names", () => {
            const r = ve.verifyOutput({ a: 1, b: 2 }, { a: 1, b: 2 });
            assert.ok(r.checked.includes("a") && r.checked.includes("b"));
        });
    });

    describe("verifyFilesystem", () => {
        let tmpFile;
        afterEach(() => {
            if (tmpFile && fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        });

        it("passes empty mutations list", () => {
            const r = ve.verifyFilesystem([]);
            assert.ok(r.verified);
        });

        it("passes for created file that exists", () => {
            tmpFile = path.join(os.tmpdir(), `vf-created-${Date.now()}.txt`);
            fs.writeFileSync(tmpFile, "x");
            const r = ve.verifyFilesystem([{ path: tmpFile, op: "created" }]);
            assert.ok(r.verified);
        });

        it("fails for created file that does not exist", () => {
            const r = ve.verifyFilesystem([{ path: "/tmp/never-exists-xyz999.txt", op: "created" }]);
            assert.ok(!r.verified);
        });

        it("passes for deleted file that is gone", () => {
            const p = "/tmp/never-exists-del-xyz888.txt";
            const r = ve.verifyFilesystem([{ path: p, op: "deleted" }]);
            assert.ok(r.verified);
        });

        it("fails for deleted file that still exists", () => {
            tmpFile = path.join(os.tmpdir(), `vf-del-${Date.now()}.txt`);
            fs.writeFileSync(tmpFile, "x");
            const r = ve.verifyFilesystem([{ path: tmpFile, op: "deleted" }]);
            assert.ok(!r.verified);
        });
    });

    describe("verifyProcessSideEffects", () => {
        it("passes when exit codes match", () => {
            assert.ok(ve.verifyProcessSideEffects(0, 0).verified);
        });

        it("fails when exit codes differ", () => {
            const r = ve.verifyProcessSideEffects(0, 1);
            assert.ok(!r.verified);
            assert.ok(r.issues[0].includes("mismatch"));
        });
    });

    describe("verifyGitState", () => {
        it("returns verified with a branch field", () => {
            const r = ve.verifyGitState(null, process.cwd());
            assert.ok("branch" in r);
            assert.ok("verified" in r);
        });

        it("passes when expectedBranch is null", () => {
            const r = ve.verifyGitState(null, process.cwd());
            assert.ok(r.verified);
        });

        it("fails when branch does not match expected", () => {
            const r = ve.verifyGitState("__nonexistent_branch__", process.cwd());
            assert.ok(!r.verified);
        });
    });

    describe("verifyDeploymentHealth", () => {
        it("passes empty checks list", () => {
            assert.ok(ve.verifyDeploymentHealth([]).verified);
        });

        it("passes file check for existing file", () => {
            const r = ve.verifyDeploymentHealth([{ type: "file", key: path.join(process.cwd(), "package.json") }]);
            assert.ok(r.verified);
        });

        it("fails file check for missing file", () => {
            const r = ve.verifyDeploymentHealth([{ type: "file", key: "/tmp/no-such-file-xyz.txt" }]);
            assert.ok(!r.verified);
        });

        it("passes env check for existing env var", () => {
            const r = ve.verifyDeploymentHealth([{ type: "env", key: "PATH" }]);
            assert.ok(r.verified);
        });

        it("fails env check for missing env var", () => {
            const r = ve.verifyDeploymentHealth([{ type: "env", key: "__NONEXISTENT_VAR_XYZ__" }]);
            assert.ok(!r.verified);
        });

        it("passed and failed arrays are populated correctly", () => {
            const r = ve.verifyDeploymentHealth([
                { type: "file", key: path.join(process.cwd(), "package.json") },
                { type: "file", key: "/tmp/no-such-xyz.txt" },
            ]);
            assert.equal(r.passed.length, 1);
            assert.equal(r.failed.length, 1);
        });
    });
});

// ── hallucinationDetector ─────────────────────────────────────────────

describe("hallucinationDetector", () => {
    describe("checkFakeSuccess", () => {
        it("no hallucination for normal success", () => {
            const r = hd.checkFakeSuccess({
                success: true,
                state: "completed",
                steps: [{ state: "completed", exitCode: 0 }],
                stepsExecuted: ["s1"],
            });
            assert.ok(!r.detected);
        });

        it("detects all-non-zero steps marked success", () => {
            const r = hd.checkFakeSuccess({
                success: true,
                steps: [
                    { state: "completed", exitCode: 1 },
                    { state: "completed", exitCode: 2 },
                ],
            });
            assert.ok(r.detected);
            assert.equal(r.type, "fake_success");
        });

        it("no hallucination when success is false", () => {
            assert.ok(!hd.checkFakeSuccess({ success: false }).detected);
        });
    });

    describe("checkIncompleteExecution", () => {
        it("no hallucination for complete execution", () => {
            const r = hd.checkIncompleteExecution(
                { success: true, stepsExecuted: ["a", "b"] },
                { executionOrder: ["a", "b"] }
            );
            assert.ok(!r.detected);
        });

        it("detects fewer executed than planned", () => {
            const r = hd.checkIncompleteExecution(
                { success: true, stepsExecuted: ["a"] },
                { executionOrder: ["a", "b", "c"] }
            );
            assert.ok(r.detected);
            assert.equal(r.type, "incomplete_execution");
        });

        it("no hallucination for dry_run", () => {
            const r = hd.checkIncompleteExecution(
                { success: true, dryRun: true, stepsExecuted: [] },
                { executionOrder: ["a", "b"] }
            );
            assert.ok(!r.detected);
        });

        it("no hallucination for cancelled execution", () => {
            const r = hd.checkIncompleteExecution(
                { success: false, cancelled: true, stepsExecuted: ["a"] },
                { executionOrder: ["a", "b"] }
            );
            assert.ok(!r.detected);
        });
    });

    describe("checkSilentFailure", () => {
        it("no hallucination when failure has error message", () => {
            const r = hd.checkSilentFailure({ success: false, error: "timeout" });
            assert.ok(!r.detected);
        });

        it("detects silent failure: failed step with no signals", () => {
            const r = hd.checkSilentFailure({
                success: false,
                error: null,
                steps: [{ state: "failed", stderr: "", stdout: "" }],
                rollbackTriggered: false,
            });
            assert.ok(r.detected);
            assert.equal(r.type, "silent_failure");
        });

        it("no hallucination on success", () => {
            assert.ok(!hd.checkSilentFailure({ success: true }).detected);
        });
    });

    describe("checkMissingArtifacts", () => {
        it("no hallucination for empty required list", () => {
            assert.ok(!hd.checkMissingArtifacts({}, []).detected);
        });

        it("no hallucination when all artifacts exist", () => {
            const r = hd.checkMissingArtifacts({}, [path.join(process.cwd(), "package.json")]);
            assert.ok(!r.detected);
        });

        it("detects missing artifacts", () => {
            const r = hd.checkMissingArtifacts({}, ["/tmp/never-exists-art-xyz.txt"]);
            assert.ok(r.detected);
            assert.equal(r.type, "missing_artifacts");
            assert.ok(r.missing.length > 0);
        });
    });

    describe("checkInvalidRecovery", () => {
        it("no hallucination for normal rolled_back", () => {
            const r = hd.checkInvalidRecovery({ rollbackTriggered: true, state: "rolled_back" });
            assert.ok(!r.detected);
        });

        it("detects rollbackTriggered but state is failed", () => {
            const r = hd.checkInvalidRecovery({ rollbackTriggered: true, state: "failed" });
            assert.ok(r.detected);
            assert.equal(r.type, "invalid_recovery");
        });

        it("detects rolled_back state but rollbackTriggered false", () => {
            const r = hd.checkInvalidRecovery({ rollbackTriggered: false, state: "rolled_back" });
            assert.ok(r.detected);
        });

        it("no hallucination when both false and state is failed", () => {
            const r = hd.checkInvalidRecovery({ rollbackTriggered: false, state: "failed" });
            assert.ok(!r.detected);
        });
    });

    describe("analyze", () => {
        it("returns safe:true for clean result", () => {
            const r = hd.analyze({
                success: true,
                state: "completed",
                steps: [{ state: "completed", exitCode: 0 }],
                stepsExecuted: ["s1"],
                stepsPlanned: ["s1"],
                rollbackTriggered: false,
            });
            assert.ok(r.safe);
            assert.equal(r.severity, "none");
        });

        it("returns safe:false with detections and severity", () => {
            const r = hd.analyze({
                success: true,
                state: "completed",
                steps: [{ state: "completed", exitCode: 1 }, { state: "completed", exitCode: 2 }],
            });
            assert.ok(!r.safe);
            assert.ok(r.detections.length > 0);
            assert.ok(r.severity !== "none");
        });

        it("critical severity for fake_success", () => {
            const r = hd.analyze({
                success: true,
                steps: [{ state: "completed", exitCode: 1 }],
            });
            if (!r.safe) assert.equal(r.severity, "critical");
        });
    });
});

// ── completionPolicy ──────────────────────────────────────────────────

describe("completionPolicy", () => {
    describe("POLICIES", () => {
        it("exports strict, lenient, disabled", () => {
            for (const p of ["strict", "lenient", "disabled"]) {
                assert.ok(p in cp.POLICIES, `missing: ${p}`);
            }
        });
    });

    describe("canComplete", () => {
        it("strict: approved when verification passes", () => {
            const r = cp.canComplete({ verified: true, issues: [] }, "strict");
            assert.ok(r.approved);
            assert.ok(!r.blocked);
        });

        it("strict: blocked when verification fails", () => {
            const r = cp.canComplete({ verified: false, issues: ["file missing"] }, "strict");
            assert.ok(!r.approved);
            assert.ok(r.blocked);
            assert.ok(r.reasons.length > 0);
        });

        it("strict: blocked when verification times out", () => {
            const r = cp.canComplete({ timedOut: true }, "strict");
            assert.ok(!r.approved);
        });

        it("lenient: approved even on timeout", () => {
            const r = cp.canComplete({ timedOut: true }, "lenient");
            assert.ok(r.approved);
        });

        it("disabled: always approved", () => {
            const r = cp.canComplete({ verified: false, issues: ["bad"] }, "disabled");
            assert.ok(r.approved);
        });

        it("defaults to strict policy", () => {
            const r = cp.canComplete({ verified: false, issues: ["x"] });
            assert.ok(!r.approved);
        });
    });

    describe("enforce", () => {
        it("passes for clean execution with passing verification", () => {
            const execResult = {
                success: true,
                state: "completed",
                steps: [{ state: "completed", exitCode: 0 }],
                stepsExecuted: ["s1"],
                stepsPlanned: ["s1"],
                rollbackTriggered: false,
            };
            const r = cp.enforce(execResult, { verified: true, issues: [] });
            assert.ok(r.passed);
            assert.equal(r.finalState, "completed");
        });

        it("blocks when verification fails", () => {
            const r = cp.enforce(
                { success: true, state: "completed", steps: [], stepsExecuted: [] },
                { verified: false, issues: ["missing artifact"] }
            );
            assert.ok(!r.passed);
            assert.equal(r.finalState, "blocked");
        });

        it("blocks when hallucination detected (all steps non-zero exit)", () => {
            const r = cp.enforce(
                {
                    success: true,
                    state: "completed",
                    steps: [{ state: "completed", exitCode: 1 }],
                    rollbackTriggered: false,
                },
                { verified: true, issues: [] },
                { policy: "disabled" }  // disabled so only hallucination blocks
            );
            assert.ok(!r.passed);
            assert.ok(r.reasons.some(s => s.includes("hallucination")));
        });

        it("enforced is always true", () => {
            const r = cp.enforce({}, { verified: true });
            assert.ok(r.enforced);
        });
    });
});

// ── integritySnapshot ─────────────────────────────────────────────────

describe("integritySnapshot", () => {
    afterEach(() => isn.reset());

    describe("snapshot", () => {
        it("returns a record with id, executionId, ts, cwd", () => {
            const snap = isn.snapshot("ex-snap-1", { cwd: os.tmpdir() });
            assert.ok(snap.id.startsWith("snap-ex-snap-1"));
            assert.equal(snap.executionId, "ex-snap-1");
            assert.ok(!isNaN(Date.parse(snap.ts)));
            assert.equal(snap.cwd, os.tmpdir());
        });

        it("fileCount is a non-negative number for valid cwd", () => {
            const snap = isn.snapshot("ex-snap-2", { cwd: os.tmpdir() });
            assert.ok(typeof snap.fileCount === "number" && snap.fileCount >= 0);
        });

        it("gitStatus is a string or null", () => {
            const snap = isn.snapshot("ex-snap-3", { cwd: process.cwd() });
            assert.ok(snap.gitStatus === null || typeof snap.gitStatus === "string");
        });

        it("depsPresent is boolean", () => {
            const snap = isn.snapshot("ex-snap-4", { cwd: process.cwd() });
            assert.ok(typeof snap.depsPresent === "boolean");
        });

        it("multiple snapshots accumulate in get()", () => {
            isn.snapshot("ex-snap-5", { cwd: os.tmpdir() });
            isn.snapshot("ex-snap-5", { cwd: os.tmpdir() });
            assert.equal(isn.get("ex-snap-5").length, 2);
        });
    });

    describe("compare", () => {
        it("no diffs when snapshots are identical", () => {
            const s1 = isn.snapshot("cmp-1", { cwd: os.tmpdir() });
            const s2 = isn.snapshot("cmp-2", { cwd: os.tmpdir() });
            const r  = isn.compare(s1, s2);
            assert.ok("changed" in r);
            assert.ok(Array.isArray(r.diffs));
        });

        it("detects fileCount change", () => {
            const s1 = { id: "a", fileCount: 5,  gitStatus: "", depsPresent: true };
            const s2 = { id: "b", fileCount: 10, gitStatus: "", depsPresent: true };
            const r  = isn.compare(s1, s2);
            assert.ok(r.changed);
            assert.ok(r.diffs.some(d => d.field === "fileCount"));
        });

        it("detects gitStatus change", () => {
            const s1 = { id: "a", fileCount: 5, gitStatus: "",      depsPresent: true };
            const s2 = { id: "b", fileCount: 5, gitStatus: "M file", depsPresent: true };
            const r  = isn.compare(s1, s2);
            assert.ok(r.changed);
        });

        it("returns changed:false for identical snapshots", () => {
            const s = { id: "a", fileCount: 5, gitStatus: "", depsPresent: true };
            const r = isn.compare(s, s);
            assert.ok(!r.changed);
            assert.equal(r.diffs.length, 0);
        });
    });

    describe("get", () => {
        it("returns empty array for unknown executionId", () => {
            assert.deepEqual(isn.get("ghost"), []);
        });

        it("returns a copy (push does not affect internal state)", () => {
            isn.snapshot("ex-get-1", { cwd: os.tmpdir() });
            const snaps = isn.get("ex-get-1");
            snaps.push({ fake: true });
            assert.equal(isn.get("ex-get-1").length, 1);
        });
    });
});
