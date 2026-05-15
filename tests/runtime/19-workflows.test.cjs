"use strict";
const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

const gw  = require("../../agents/runtime/workflows/gitWorkflow.cjs");
const fep = require("../../agents/runtime/workflows/fileEditPipeline.cjs");
const dl  = require("../../agents/runtime/workflows/debuggingLoop.cjs");
const ds  = require("../../agents/runtime/workflows/deploymentSimulator.cjs");

// ── gitWorkflow — step builders (structure only, no side-effect execution) ──

describe("gitWorkflow — step structure", () => {
    it("statusStep returns step with name and execute", () => {
        const s = gw.statusStep();
        assert.equal(s.name, "git-status");
        assert.equal(typeof s.execute, "function");
    });
    it("diffStep returns step", () => {
        const s = gw.diffStep();
        assert.equal(s.name, "git-diff");
        assert.equal(typeof s.execute, "function");
    });
    it("addStep returns step with rollback", () => {
        const s = gw.addStep(".");
        assert.equal(s.name,    "git-add");
        assert.equal(typeof s.execute,  "function");
        assert.equal(typeof s.rollback, "function");
    });
    it("commitStep returns step with rollback", () => {
        const s = gw.commitStep("feat: test");
        assert.equal(s.name,    "git-commit");
        assert.equal(typeof s.execute,  "function");
        assert.equal(typeof s.rollback, "function");
    });
    it("branchStep returns step", () => {
        const s = gw.branchStep("test-branch");
        assert.equal(s.name, "git-branch");
        assert.equal(typeof s.execute, "function");
    });
    it("logStep returns step", () => {
        const s = gw.logStep(5);
        assert.equal(s.name, "git-log");
        assert.equal(typeof s.execute, "function");
    });
});

describe("gitWorkflow — buildGitWorkflow", () => {
    it("empty opts returns no steps", () => {
        assert.equal(gw.buildGitWorkflow({}).length, 0);
    });
    it("status:true adds status step", () => {
        const steps = gw.buildGitWorkflow({ status: true });
        assert.equal(steps.length, 1);
        assert.equal(steps[0].name, "git-status");
    });
    it("multiple opts compose correctly", () => {
        const steps = gw.buildGitWorkflow({ status: true, diff: true, log: true });
        assert.equal(steps.length, 3);
        assert.equal(steps[0].name, "git-status");
        assert.equal(steps[1].name, "git-diff");
        assert.equal(steps[2].name, "git-log");
    });
    it("status + log steps return known names", () => {
        const steps = gw.buildGitWorkflow({ status: true, log: true });
        const names = steps.map(s => s.name);
        assert.ok(names.includes("git-status"));
        assert.ok(names.includes("git-log"));
    });
});

describe("gitWorkflow — read-only execution (git log/status in real repo)", () => {
    it("statusStep.execute succeeds in a git repo", async () => {
        const s   = gw.statusStep();
        const ctx = {};
        const r   = await s.execute(ctx);
        assert.ok("output" in r);
        assert.ok(typeof ctx.gitStatus === "string");
    });
    it("logStep.execute returns git log output", async () => {
        const s   = gw.logStep(3);
        const ctx = {};
        const r   = await s.execute(ctx);
        assert.ok("log" in r);
        assert.ok(typeof ctx.gitLog === "string");
    });
});

// ── fileEditPipeline ──────────────────────────────────────────────────────

const TMP = os.tmpdir();

describe("fileEditPipeline — backupStep", () => {
    it("creates a .bak file for existing file", async () => {
        const p = path.join(TMP, `fp-test-${Date.now()}.txt`);
        fs.writeFileSync(p, "original", "utf8");
        const ctx = {};
        const r   = await fep.backupStep(p).execute(ctx);
        assert.ok(r.backup.includes(".bak."));
        assert.ok(fs.existsSync(r.backup));
        fs.unlinkSync(p);
        fs.unlinkSync(r.backup);
    });
    it("skips gracefully for non-existent file", async () => {
        const ctx = {};
        const r   = await fep.backupStep("/tmp/does-not-exist-xyz.txt").execute(ctx);
        assert.equal(r.skipped, true);
    });
});

describe("fileEditPipeline — editStep", () => {
    it("applies patchFn to file content", async () => {
        const p = path.join(TMP, `fp-edit-${Date.now()}.txt`);
        fs.writeFileSync(p, "hello", "utf8");
        const ctx = {};
        await fep.editStep(p, (c) => c + " world").execute(ctx);
        assert.equal(fs.readFileSync(p, "utf8"), "hello world");
        fs.unlinkSync(p);
    });
    it("returns bytesDelta", async () => {
        const p = path.join(TMP, `fp-delta-${Date.now()}.txt`);
        fs.writeFileSync(p, "abc", "utf8");
        const ctx = {};
        const r   = await fep.editStep(p, () => "abcde").execute(ctx);
        assert.equal(r.bytesDelta, 2);
        fs.unlinkSync(p);
    });
    it("rollback restores original content", async () => {
        const p = path.join(TMP, `fp-rollback-${Date.now()}.txt`);
        fs.writeFileSync(p, "original", "utf8");
        const ctx  = {};
        const step = fep.editStep(p, () => "modified");
        await step.execute(ctx);
        assert.equal(fs.readFileSync(p, "utf8"), "modified");
        await step.rollback(ctx);
        assert.equal(fs.readFileSync(p, "utf8"), "original");
        fs.unlinkSync(p);
    });
    it("creates file if not existing", async () => {
        const p = path.join(TMP, `fp-new-${Date.now()}.txt`);
        const ctx = {};
        await fep.editStep(p, () => "created").execute(ctx);
        assert.equal(fs.readFileSync(p, "utf8"), "created");
        fs.unlinkSync(p);
    });
});

describe("fileEditPipeline — restoreStep", () => {
    it("restores from backup and deletes bak file", async () => {
        const p   = path.join(TMP, `fp-restore-${Date.now()}.txt`);
        fs.writeFileSync(p, "original", "utf8");
        const ctx = {};
        await fep.backupStep(p).execute(ctx);
        fs.writeFileSync(p, "modified", "utf8");
        await fep.restoreStep(p).execute(ctx);
        assert.equal(fs.readFileSync(p, "utf8"), "original");
        fs.unlinkSync(p);
    });
    it("skips gracefully when no backup", async () => {
        const ctx = {};
        const r   = await fep.restoreStep("/tmp/no-bak.txt").execute(ctx);
        assert.equal(r.skipped, true);
    });
});

describe("fileEditPipeline — buildEditPipeline", () => {
    it("returns backup + edit steps by default", () => {
        const steps = fep.buildEditPipeline([{ path: "/tmp/x.txt", patchFn: c => c }]);
        assert.ok(steps.some(s => s.name.startsWith("backup:")));
        assert.ok(steps.some(s => s.name.startsWith("edit:")));
    });
    it("backup:false skips backup steps", () => {
        const steps = fep.buildEditPipeline(
            [{ path: "/tmp/x.txt", patchFn: c => c }],
            { backup: false }
        );
        assert.ok(!steps.some(s => s.name.startsWith("backup:")));
    });
    it("verify adds verification step", () => {
        const steps = fep.buildEditPipeline(
            [{ path: "/tmp/x.txt", patchFn: c => c }],
            { verify: () => ({ ok: true }) }
        );
        assert.ok(steps.some(s => s.name === "verify-edits"));
    });
});

// ── debuggingLoop ─────────────────────────────────────────────────────────

describe("debuggingLoop — classifyError", () => {
    it("classifies SyntaxError as syntax", () => {
        assert.equal(dl.classifyError("SyntaxError: unexpected token"), "syntax");
    });
    it("classifies module not found as missing", () => {
        assert.equal(dl.classifyError("Cannot find module './foo'"), "missing");
    });
    it("classifies ENOENT as missing", () => {
        assert.equal(dl.classifyError("ENOENT: no such file or directory"), "missing");
    });
    it("classifies TypeError as type", () => {
        assert.equal(dl.classifyError("TypeError: is not a function"), "type");
    });
    it("classifies permission denied as permission", () => {
        assert.equal(dl.classifyError("EACCES: permission denied"), "permission");
    });
    it("classifies timeout as timeout", () => {
        assert.equal(dl.classifyError("request timed out after 5000ms"), "timeout");
    });
    it("classifies network error", () => {
        assert.equal(dl.classifyError("ECONNREFUSED: connection refused"), "network");
    });
    it("unknown errors classified as unknown", () => {
        assert.equal(dl.classifyError("something completely weird"), "unknown");
    });
});

describe("debuggingLoop — steps execute correctly", () => {
    it("diagnoseStep sets ctx.errorType and ctx.diagnosis", async () => {
        const ctx = {};
        await dl.diagnoseStep("SyntaxError: bad token").execute(ctx);
        assert.equal(ctx.errorType, "syntax");
        assert.ok(ctx.diagnosis.type === "syntax");
    });
    it("fixStep sets ctx.fixApplied based on errorType", async () => {
        const ctx = { errorType: "syntax" };
        await dl.fixStep().execute(ctx);
        assert.equal(ctx.fixApplied, "syntax_correction");
    });
    it("fixStep handles unknown errorType", async () => {
        const ctx = { errorType: "unknown" };
        await dl.fixStep().execute(ctx);
        assert.equal(ctx.fixApplied, "logged_for_review");
    });
    it("verifyStep passes when fixApplied is set", async () => {
        const ctx = { fixApplied: "syntax_correction" };
        const r   = await dl.verifyStep().execute(ctx);
        assert.equal(r.verified, true);
    });
    it("verifyStep throws when no fix was applied", async () => {
        await assert.rejects(() => dl.verifyStep().execute({}), /no_fix_was_applied/);
    });
    it("verifyStep calls custom verifyFn", async () => {
        const ctx = { fixApplied: "x" };
        const r   = await dl.verifyStep(() => true).execute(ctx);
        assert.equal(r.verified, true);
    });
    it("custom verifyFn returning false causes throw", async () => {
        await assert.rejects(() => dl.verifyStep(() => false).execute({}), /fix_verification_failed/);
    });
});

describe("debuggingLoop — buildDebuggingLoop", () => {
    it("returns 3 steps by default", () => {
        const steps = dl.buildDebuggingLoop({ errorMsg: "TypeError: x" });
        assert.equal(steps.length, 3);
    });
    it("step names are diagnose, apply-fix, verify-fix", () => {
        const steps = dl.buildDebuggingLoop({ errorMsg: "err" });
        assert.equal(steps[0].name, "diagnose");
        assert.equal(steps[1].name, "apply-fix");
        assert.equal(steps[2].name, "verify-fix");
    });
    it("extraSteps appended", () => {
        const steps = dl.buildDebuggingLoop({}, {
            extraSteps: [{ name: "extra", execute: async () => ({}) }],
        });
        assert.equal(steps.length, 4);
        assert.equal(steps[3].name, "extra");
    });
    it("full loop runs end-to-end for syntax error", async () => {
        const steps = dl.buildDebuggingLoop({ errorMsg: "SyntaxError: bad" });
        const ctx   = {};
        for (const step of steps) await step.execute(ctx);
        assert.equal(ctx.errorType,  "syntax");
        assert.equal(ctx.fixApplied, "syntax_correction");
    });
});

// ── deploymentSimulator ───────────────────────────────────────────────────

describe("deploymentSimulator — preflightStep", () => {
    it("passes when all checks succeed", async () => {
        const step = ds.preflightStep([
            { name: "check-a", fn: () => true },
            { name: "check-b", fn: () => true },
        ]);
        const ctx = {};
        const r   = await step.execute(ctx);
        assert.equal(r.passed, 2);
        assert.equal(r.failed, 0);
    });
    it("throws when a check fails", async () => {
        const step = ds.preflightStep([
            { name: "check-ok",  fn: () => true },
            { name: "check-bad", fn: () => false },
        ]);
        await assert.rejects(() => step.execute({}), /preflight failed/);
    });
    it("stores results in ctx.preflightResults", async () => {
        const step = ds.preflightStep([{ name: "c", fn: () => true }]);
        const ctx  = {};
        await step.execute(ctx);
        assert.ok(Array.isArray(ctx.preflightResults));
    });
});

describe("deploymentSimulator — buildStep / testStep / rolloutStep / healthCheckStep", () => {
    it("buildStep uses custom buildFn", async () => {
        const step = ds.buildStep(async () => ({ artifact: "app.tar.gz" }));
        const ctx  = {};
        const r    = await step.execute(ctx);
        assert.equal(r.artifact, "app.tar.gz");
    });
    it("buildStep simulates when no buildFn", async () => {
        const ctx = {};
        const r   = await ds.buildStep().execute(ctx);
        assert.equal(r.simulated, true);
    });
    it("buildStep rollback clears buildOutput", async () => {
        const step = ds.buildStep();
        const ctx  = {};
        await step.execute(ctx);
        await step.rollback(ctx);
        assert.equal(ctx.buildOutput, null);
    });
    it("testStep passes when zero failures", async () => {
        const step = ds.testStep(() => ({ passed: 5, failed: 0 }));
        const r    = await step.execute({});
        assert.equal(r.passed, 5);
    });
    it("testStep throws when tests fail", async () => {
        const step = ds.testStep(() => ({ passed: 3, failed: 2 }));
        await assert.rejects(() => step.execute({}), /2 test/);
    });
    it("rolloutStep sets ctx.rolloutState to complete", async () => {
        const step = ds.rolloutStep();
        const ctx  = {};
        await step.execute(ctx);
        assert.equal(ctx.rolloutState, "complete");
    });
    it("rolloutStep rollback sets rolloutState to rolled-back", async () => {
        const step = ds.rolloutStep();
        const ctx  = {};
        await step.execute(ctx);
        await step.rollback(ctx);
        assert.equal(ctx.rolloutState, "rolled-back");
    });
    it("healthCheckStep passes when healthy", async () => {
        const step = ds.healthCheckStep(() => ({ healthy: true }));
        const r    = await step.execute({});
        assert.equal(r.healthy, true);
    });
    it("healthCheckStep throws when unhealthy", async () => {
        const step = ds.healthCheckStep(() => ({ healthy: false }));
        await assert.rejects(() => step.execute({}), /health check/);
    });
});

describe("deploymentSimulator — buildDeploymentWorkflow", () => {
    it("returns 4 default steps (build, test, rollout, health)", () => {
        const steps = ds.buildDeploymentWorkflow({});
        assert.equal(steps.length, 4);
    });
    it("preflight added when checks provided", () => {
        const steps = ds.buildDeploymentWorkflow({
            checks: [{ name: "ok", fn: () => true }],
        });
        assert.equal(steps.length, 5);
        assert.equal(steps[0].name, "deployment-preflight");
    });
    it("build:false skips build step", () => {
        const steps = ds.buildDeploymentWorkflow({ build: false });
        assert.ok(!steps.some(s => s.name === "deployment-build"));
    });
    it("full simulated pipeline executes end-to-end", async () => {
        const steps = ds.buildDeploymentWorkflow({});
        const ctx   = {};
        for (const step of steps) await step.execute(ctx);
        assert.equal(ctx.rolloutState, "complete");
        assert.ok(ctx.healthCheckResult.healthy);
    });
});
