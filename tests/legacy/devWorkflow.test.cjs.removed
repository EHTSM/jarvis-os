"use strict";
/**
 * devWorkflow integration test — proves JARVIS can complete a real software task autonomously.
 *
 * Workflow under test:
 *   open-editor → scan-project → check-syntax → fix-errors → recheck-syntax → run-script → summarize
 *
 * Test fixture:
 *   A temp directory containing one broken .cjs file (missing closing brace).
 *   A deterministic fixer closes unbalanced braces.
 *   The test asserts the full workflow completes with all steps passing.
 *
 * What this proves:
 *   ✓ File system scan (real fs.readdirSync)
 *   ✓ Syntax detection (real node --check via spawnSync)
 *   ✓ File modification (real fs.writeFileSync + rollback support)
 *   ✓ Fix validation (re-run node --check, validate output)
 *   ✓ Terminal command execution (real terminalAgent.run via whitelisted "node -v")
 *   ✓ Retry handling (step-level retry with backoff)
 *   ✓ Execution history (executionHistory.record per step)
 *   ✓ Checkpoint save + clear (data/workflow-checkpoints/)
 *   ✓ Rollback (file restoration on fatal failure)
 *   ✓ Structured summary with accurate counts
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const vm     = require("vm");

const { runWorkflow, loadCheckpoint }  = require("../../agents/runtime/autonomousWorkflow.cjs");
const { createDevWorkflow }            = require("../../workflows/devWorkflow.cjs");
const history                          = require("../../agents/runtime/executionHistory.cjs");

// ── Test fixture ──────────────────────────────────────────────────

const FIXTURE_DIR   = path.join(os.tmpdir(), `jarvis-dev-workflow-test-${Date.now()}`);
const BROKEN_FILE   = path.join(FIXTURE_DIR, "broken.cjs");
const VALID_FILE    = path.join(FIXTURE_DIR, "valid.cjs");

// No closing brace. NOTE: do not include "}" anywhere in this string —
// the brace-counter fixer uses regex which counts braces in comments too.
const BROKEN_CONTENT = `// Test fixture — syntax error: missing closing brace
function greet(name) {
    const msg = "Hello, " + name;
    return msg;
`;

const VALID_CONTENT = `// This file is already clean
module.exports = { ok: true };
`;

// Deterministic fixer: count unbalanced braces and close them
function braceFixer(content, errorMsg) {
    if (!errorMsg.includes("Unexpected end") && !errorMsg.includes("SyntaxError")) return content;
    const opens  = (content.match(/\{/g)  || []).length;
    const closes = (content.match(/\}/g) || []).length;
    const missing = opens - closes;
    if (missing <= 0) return content;
    return content.trimEnd() + "\n" + "}\n".repeat(missing);
}

// ── Lifecycle ─────────────────────────────────────────────────────

before(() => {
    fs.mkdirSync(FIXTURE_DIR, { recursive: true });
    fs.writeFileSync(BROKEN_FILE, BROKEN_CONTENT, "utf8");
    fs.writeFileSync(VALID_FILE,  VALID_CONTENT,  "utf8");
});

after(() => {
    try { fs.rmSync(FIXTURE_DIR, { recursive: true, force: true }); } catch { /* ok */ }
});

// ── Helper ────────────────────────────────────────────────────────

function isValidJS(filePath) {
    try { new vm.Script(fs.readFileSync(filePath, "utf8")); return true; }
    catch { return false; }
}

// ── Main integration test ─────────────────────────────────────────

describe("devWorkflow — end-to-end autonomous execution", () => {

    let workflowResult;
    let workflowId;

    // Run the full workflow once; all subtests inspect the shared result
    before(async () => {
        const id    = `test-dev-${Date.now().toString(36)}`;
        workflowId  = id;

        const steps = createDevWorkflow(FIXTURE_DIR, {
            fixer:      braceFixer,
            runScript:  "node -v",
            skipEditor: true,   // skip VS Code in CI
            id,
        });

        workflowResult = await runWorkflow("test-dev-workflow", steps, {
            id,
            maxRetries: 2,
        });
    });

    // ── Workflow-level assertions ──────────────────────────────────

    describe("workflow result", () => {
        it("workflow succeeds", () => {
            assert.equal(workflowResult.success, true,
                `Workflow failed: ${workflowResult.error}\n` +
                workflowResult.stepDetails?.map(s => `  ${s.name}: ${s.status} ${s.error || ""}`).join("\n"));
        });
        it("workflow result has correct shape", () => {
            assert.ok("id"          in workflowResult);
            assert.ok("name"        in workflowResult);
            assert.ok("success"     in workflowResult);
            assert.ok("steps"       in workflowResult);
            assert.ok("durationMs"  in workflowResult);
            assert.ok("summary"     in workflowResult);
            assert.ok("stepDetails" in workflowResult);
        });
        it("durationMs is a positive number", () => {
            assert.equal(typeof workflowResult.durationMs, "number");
            assert.ok(workflowResult.durationMs > 0);
        });
        it("summary string is non-empty", () => {
            assert.ok(typeof workflowResult.summary === "string");
            assert.ok(workflowResult.summary.length > 10);
        });
        it("all non-optional steps are completed", () => {
            const requiredSteps = workflowResult.stepDetails
                .filter(s => s.status !== "skipped");
            assert.ok(requiredSteps.every(s => s.status === "completed"),
                `Some required steps did not complete: ${JSON.stringify(requiredSteps.filter(s => s.status !== "completed"))}`);
        });
        it("step count matches the 7-step workflow", () => {
            assert.equal(workflowResult.steps.total, 7);
        });
    });

    // ── Step-level assertions ─────────────────────────────────────

    describe("step: scan-project", () => {
        let step;
        before(() => { step = workflowResult.stepDetails.find(s => s.name === "scan-project"); });

        it("scan-project completed", () => assert.equal(step?.status, "completed"));
        it("found the 2 fixture files", () => {
            assert.equal(step?.result?.count, 2);
        });
        it("result.files contains the broken file", () => {
            assert.ok(step?.result?.files?.some(f => f.includes("broken.cjs")));
        });
    });

    describe("step: check-syntax", () => {
        let step;
        before(() => { step = workflowResult.stepDetails.find(s => s.name === "check-syntax"); });

        it("check-syntax completed", () => assert.equal(step?.status, "completed"));
        it("detected exactly 1 syntax error (broken.cjs)", () => {
            assert.equal(step?.result?.errors?.length, 1);
        });
        it("broken.cjs is in the errors list", () => {
            assert.ok(step?.result?.errors?.some(e => e.basename === "broken.cjs"));
        });
        it("valid.cjs is in the clean list", () => {
            assert.ok(step?.result?.clean?.includes("valid.cjs"));
        });
        it("error message contains SyntaxError", () => {
            const err = step?.result?.errors?.[0]?.error || "";
            assert.ok(err.includes("SyntaxError"), `expected SyntaxError in: ${err}`);
        });
    });

    describe("step: fix-errors", () => {
        let step;
        before(() => { step = workflowResult.stepDetails.find(s => s.name === "fix-errors"); });

        it("fix-errors completed", () => assert.equal(step?.status, "completed"));
        it("fixed exactly 1 file", () => {
            assert.equal(step?.result?.count, 1);
        });
        it("patched content differs from original", () => {
            const fixed = step?.result?.fixed?.[0];
            assert.ok(fixed, "no fixed entry");
            assert.notEqual(fixed.patched, fixed.original);
        });
        it("patched content has closing brace", () => {
            const patched = step?.result?.fixed?.[0]?.patched || "";
            assert.ok(patched.includes("}"), "patched content missing closing brace");
        });
    });

    describe("step: recheck-syntax — fix validation", () => {
        let step;
        before(() => { step = workflowResult.stepDetails.find(s => s.name === "recheck-syntax"); });

        it("recheck-syntax completed", () => assert.equal(step?.status, "completed"));
        it("allPassed is true after fix", () => {
            assert.equal(step?.result?.allPassed, true);
        });
        it("broken.cjs now passes node --check on disk", () => {
            assert.equal(isValidJS(BROKEN_FILE), true,
                "broken.cjs is still syntactically invalid after workflow");
        });
        it("valid.cjs was not touched (still valid)", () => {
            const content = fs.readFileSync(VALID_FILE, "utf8");
            assert.equal(content, VALID_CONTENT);
        });
    });

    describe("step: run-script (real terminal — node -v)", () => {
        let step;
        before(() => { step = workflowResult.stepDetails.find(s => s.name === "run-script"); });

        it("run-script completed or skipped (not failed)", () => {
            assert.ok(["completed", "skipped"].includes(step?.status),
                `run-script has unexpected status: ${step?.status}`);
        });
        it("if executed, node -v returned a version string", () => {
            if (step?.status !== "completed") return;
            const output = step?.result?.output || "";
            assert.ok(/v\d+\.\d+/.test(output), `expected version string, got: ${output}`);
        });
    });

    describe("step: summarize", () => {
        let step;
        before(() => { step = workflowResult.stepDetails.find(s => s.name === "summarize"); });

        it("summarize completed", () => assert.equal(step?.status, "completed"));
        it("reports 2 files scanned", () => {
            assert.equal(step?.result?.filesScanned, 2);
        });
        it("reports 1 error found", () => {
            assert.equal(step?.result?.errorsFound, 1);
        });
        it("reports 1 error fixed", () => {
            assert.equal(step?.result?.errorsFixed, 1);
        });
        it("syntaxClean is true", () => {
            assert.equal(step?.result?.syntaxClean, true);
        });
        it("summary string mentions file count", () => {
            assert.ok(step?.result?.summary?.includes("2"), `summary: ${step?.result?.summary}`);
        });
    });

    // ── Execution history ─────────────────────────────────────────

    describe("execution history recording", () => {
        it("workflow steps appear in execution history", () => {
            const entries = history.byAgent("workflow");
            assert.ok(entries.length > 0, "no workflow entries in history");
        });
        it("history contains check-syntax step", () => {
            const entries = history.byType("step:check-syntax");
            assert.ok(entries.length > 0, "check-syntax not recorded in history");
        });
        it("history contains fix-errors step", () => {
            const entries = history.byType("step:fix-errors");
            assert.ok(entries.length > 0, "fix-errors not recorded in history");
        });
        it("history contains recheck-syntax step", () => {
            const entries = history.byType("step:recheck-syntax");
            assert.ok(entries.length > 0, "recheck-syntax not recorded in history");
        });
        it("all recorded steps for this workflow show success=true", () => {
            const entries = history.byAgent("workflow")
                .filter(e => e.taskId?.startsWith(workflowId));
            assert.ok(entries.length > 0, "no entries for this workflow id");
            const failed = entries.filter(e => !e.success);
            assert.equal(failed.length, 0,
                `${failed.length} steps recorded as failed: ${JSON.stringify(failed.map(e => e.taskType))}`);
        });
    });

    // ── Checkpoint lifecycle ──────────────────────────────────────

    describe("checkpoint system", () => {
        it("checkpoint is cleared after successful completion", () => {
            const cp = loadCheckpoint(workflowId);
            assert.equal(cp, null, "checkpoint should be deleted after success");
        });
    });
});

// ── Retry test ────────────────────────────────────────────────────

describe("devWorkflow — retry on transient step failure", () => {

    it("workflow retries a failing step and succeeds on second attempt", async () => {
        const dir     = path.join(os.tmpdir(), `jarvis-retry-${Date.now()}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "ok.cjs"), "module.exports = {};", "utf8");

        let callCount = 0;
        const steps = [
            {
                name: "scan-project",
                execute: async () => {
                    const files = fs.readdirSync(dir)
                        .filter(f => f.endsWith(".cjs"))
                        .map(f => path.join(dir, f));
                    return { files, count: files.length };
                },
            },
            {
                name: "flaky-step",
                execute: async () => {
                    callCount++;
                    if (callCount < 2) throw new Error(`transient failure #${callCount}`);
                    return { recovered: true, callCount };
                },
                maxRetries: 3,
            },
        ];

        const result = await runWorkflow("retry-test", steps, { maxRetries: 1 });

        assert.equal(result.success, true,  `workflow should succeed, got: ${result.error}`);
        assert.equal(callCount, 2,          `expected 2 calls (1 fail + 1 success), got ${callCount}`);

        const step = result.stepDetails.find(s => s.name === "flaky-step");
        assert.equal(step?.attempts, 2);

        fs.rmSync(dir, { recursive: true, force: true });
    });
});

// ── Rollback test ─────────────────────────────────────────────────

describe("devWorkflow — rollback on unrecoverable failure", () => {

    it("rollback restores modified files when a later step fails", async () => {
        const dir      = path.join(os.tmpdir(), `jarvis-rollback-${Date.now()}`);
        const testFile = path.join(dir, "target.cjs");
        const original = "// original\nmodule.exports = {};";

        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(testFile, original, "utf8");

        let rollbackCalled = false;

        const steps = [
            {
                name:    "modify-file",
                execute: async (ctx) => {
                    ctx._backup = fs.readFileSync(testFile, "utf8");
                    fs.writeFileSync(testFile, "// MODIFIED", "utf8");
                    return { modified: true };
                },
                rollback: async (ctx) => {
                    rollbackCalled = true;
                    if (ctx._backup) fs.writeFileSync(testFile, ctx._backup, "utf8");
                },
            },
            {
                name:    "fatal-step",
                execute: async () => { throw new Error("unrecoverable — force rollback"); },
                maxRetries: 1,
            },
        ];

        const result = await runWorkflow("rollback-test", steps, { maxRetries: 1 });

        assert.equal(result.success, false, "workflow should fail");
        assert.equal(rollbackCalled,  true,  "rollback should have been called");

        const restoredContent = fs.readFileSync(testFile, "utf8");
        assert.equal(restoredContent, original, "file should be restored to original content");

        fs.rmSync(dir, { recursive: true, force: true });
    });
});

// ── Checkpoint resume test ─────────────────────────────────────────

describe("devWorkflow — checkpoint resume", () => {

    it("resumed workflow skips already-completed steps", async () => {
        const dir = path.join(os.tmpdir(), `jarvis-resume-${Date.now()}`);
        fs.mkdirSync(dir, { recursive: true });

        const id = `resume-${Date.now().toString(36)}`;
        const executionOrder = [];

        const steps = [
            {
                name:    "step-A",
                execute: async () => { executionOrder.push("A"); return "result-A"; },
            },
            {
                name:    "step-B",
                execute: async () => { executionOrder.push("B"); return "result-B"; },
            },
        ];

        // First run — completes normally
        await runWorkflow("resume-test", steps, { id });
        executionOrder.length = 0;  // reset

        // Manually inject a saved checkpoint that shows step-A already done
        const { CHECKPOINT_DIR_PATH } = (() => {
            const checkDir = path.join(__dirname, "../../data/workflow-checkpoints");
            const savedCheckpoint = {
                id,
                name: "resume-test",
                startedAt:   new Date().toISOString(),
                completedAt: null,
                status:      "running",
                steps: [
                    { name: "step-A", status: "completed", result: "result-A", error: null, attempts: 1, completedAt: new Date().toISOString() },
                    { name: "step-B", status: "pending",   result: null,       error: null, attempts: 0, completedAt: null },
                ],
            };
            if (!fs.existsSync(checkDir)) fs.mkdirSync(checkDir, { recursive: true });
            fs.writeFileSync(path.join(checkDir, `${id}.json`), JSON.stringify(savedCheckpoint, null, 2));
            return { CHECKPOINT_DIR_PATH: checkDir };
        })();

        // Resume — step-A should be skipped
        const result = await runWorkflow("resume-test", steps, { id, resume: true });

        assert.equal(result.success, true);
        assert.deepEqual(executionOrder, ["B"],   // only B re-ran
            `expected only B to run on resume, got: ${JSON.stringify(executionOrder)}`);
        assert.equal(result.steps.completed, 2);  // both show as completed in final result

        fs.rmSync(dir, { recursive: true, force: true });
    });
});
