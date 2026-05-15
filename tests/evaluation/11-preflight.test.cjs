"use strict";
/**
 * Preflight, simulator, sandbox, and root-cause-graph unit tests.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

const {
    runPreflight, checkNode, checkTool, checkPort, checkPorts, checkEnv, scanSyntax, scanDependencies,
} = require("../../evaluation/preflight.cjs");

const { analyzeStep, simulateWorkflow, guardDestructive } = require("../../evaluation/simulator.cjs");
const { createSandbox, applySandbox, cleanupSandbox, sandboxedRun, copyDir } = require("../../evaluation/sandbox.cjs");
const { RootCauseGraph } = require("../../evaluation/rootCauseGraph.cjs");

// ── Helpers ───────────────────────────────────────────────────────────

function mkTmpDir(files = {}) {
    const dir = path.join(os.tmpdir(), `pf-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(dir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) {
        const abs = path.join(dir, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf8");
    }
    return dir;
}
function rmDir(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ok */ } }

// ── 1. checkNode ──────────────────────────────────────────────────────

describe("checkNode", () => {
    it("passes with current Node version (>= 18)", () => {
        const r = checkNode(18);
        assert.equal(r.ok, true);
        assert.equal(r.blocking, true);
        assert.ok(r.label.includes("Node.js"));
    });

    it("fails when minMajor is impossibly high", () => {
        const r = checkNode(9999);
        assert.equal(r.ok, false);
        assert.equal(r.id, "node");
    });
});

// ── 2. checkTool ─────────────────────────────────────────────────────

describe("checkTool", () => {
    it("npm is available", () => {
        const r = checkTool("npm", ["-v"]);
        assert.equal(r.ok, true);
        assert.ok(r.detail.length > 0, "should return version string");
    });

    it("git is available", () => {
        const r = checkTool("git", ["--version"]);
        assert.equal(r.ok, true);
    });

    it("non-existent binary returns ok=false", () => {
        const r = checkTool("nonexistent-binary-xyz-abc", ["--version"]);
        assert.equal(r.ok, false);
    });
});

// ── 3. checkPort ─────────────────────────────────────────────────────

describe("checkPort", () => {
    it("random high port is free", async () => {
        // Use a port unlikely to be in use
        const r = await checkPort(59871);
        assert.ok("ok" in r);
        assert.ok("label" in r);
    });

    it("result has correct id format", async () => {
        const r = await checkPort(59872);
        assert.equal(r.id, "port:59872");
    });

    it("checkPorts returns one result per port", async () => {
        const results = await checkPorts([59873, 59874]);
        assert.equal(results.length, 2);
    });
});

// ── 4. checkEnv ──────────────────────────────────────────────────────

describe("checkEnv", () => {
    it("passes when required vars exist (PATH always set)", () => {
        const r = checkEnv(["PATH"]);
        assert.equal(r.ok, true);
    });

    it("fails for missing var", () => {
        const r = checkEnv(["JARVIS_NONEXISTENT_ENV_VAR_XYZ"]);
        assert.equal(r.ok, false);
        assert.ok(r.missing.includes("JARVIS_NONEXISTENT_ENV_VAR_XYZ"));
    });

    it("reports both present and missing", () => {
        const r = checkEnv(["PATH", "JARVIS_NONEXISTENT_ENV_VAR_XYZ"]);
        assert.ok(r.present.includes("PATH"));
        assert.ok(r.missing.includes("JARVIS_NONEXISTENT_ENV_VAR_XYZ"));
    });
});

// ── 5. scanSyntax ────────────────────────────────────────────────────

describe("scanSyntax", () => {
    let cleanDir, brokenDir;
    before(() => {
        cleanDir  = mkTmpDir({ "ok.cjs": `"use strict";\nmodule.exports = {};\n` });
        brokenDir = mkTmpDir({ "bad.cjs": `function foo() {\n    return 1;\n` }); // missing }
    });
    after(() => { rmDir(cleanDir); rmDir(brokenDir); });

    it("clean directory returns ok=true", () => {
        const r = scanSyntax(cleanDir);
        assert.equal(r.ok, true);
        assert.equal(r.errors.length, 0);
    });

    it("broken directory returns ok=false with error details", () => {
        const r = scanSyntax(brokenDir);
        assert.equal(r.ok, false);
        assert.equal(r.errors.length, 1);
        assert.equal(r.errors[0].basename, "bad.cjs");
    });

    it("non-existent directory returns ok=false gracefully", () => {
        const r = scanSyntax("/tmp/does-not-exist-jarvis-xyz");
        assert.equal(r.ok, false);
    });

    it("filesChecked reflects actual count", () => {
        const r = scanSyntax(cleanDir);
        assert.equal(r.filesChecked, 1);
    });
});

// ── 6. scanDependencies ───────────────────────────────────────────────

describe("scanDependencies", () => {
    let dir;
    before(() => {
        dir = mkTmpDir({ "package.json": JSON.stringify({ name: "test", dependencies: {} }) });
    });
    after(() => rmDir(dir));

    it("reports hasPkg=true when package.json exists", () => {
        const r = scanDependencies(dir);
        assert.equal(r.hasPkg, true);
    });

    it("reports hasNm=false when node_modules absent", () => {
        const r = scanDependencies(dir);
        assert.equal(r.hasNm, false);
    });

    it("ok=false when node_modules missing", () => {
        const r = scanDependencies(dir);
        assert.equal(r.ok, false);
    });
});

// ── 7. runPreflight ───────────────────────────────────────────────────

describe("runPreflight", () => {
    let dir;
    before(() => { dir = mkTmpDir({ "ok.cjs": `"use strict";\nmodule.exports = {};\n` }); });
    after(() => rmDir(dir));

    it("returns canProceed=true with normal project", async () => {
        const r = await runPreflight(dir, { checkDeps: false, checkSyntaxScan: false });
        assert.equal(r.canProceed, true);
    });

    it("includes node and npm checks by default", async () => {
        const r = await runPreflight(dir, { checkDeps: false, checkSyntaxScan: false });
        assert.ok(r.checks.some(c => c.id === "node"));
        assert.ok(r.checks.some(c => c.id === "npm"));
    });

    it("syntax check finds errors in broken project", async () => {
        const brokenDir = mkTmpDir({ "bad.cjs": `function foo() {` });
        try {
            const r = await runPreflight(brokenDir, { checkDeps: false, checkSyntaxScan: true });
            const syntaxCheck = r.checks.find(c => c.id === "syntax");
            assert.ok(syntaxCheck, "syntax check should be present");
            assert.equal(syntaxCheck.ok, false);
        } finally {
            rmDir(brokenDir);
        }
    });

    it("port check runs when requiredPorts provided", async () => {
        const r = await runPreflight(dir, {
            checkDeps: false, checkSyntaxScan: false, requiredPorts: [59875],
        });
        assert.ok(r.checks.some(c => c.id === "port:59875"));
    });

    it("summary string is non-empty", async () => {
        const r = await runPreflight(dir, { checkDeps: false, checkSyntaxScan: false });
        assert.ok(typeof r.summary === "string" && r.summary.length > 0);
    });
});

// ── 8. analyzeStep ────────────────────────────────────────────────────

describe("analyzeStep — static analysis", () => {
    it("detects write operations", () => {
        const step = { name: "write-step", execute: async () => { require("fs").writeFileSync("/tmp/x", ""); } };
        const r = analyzeStep(step);
        assert.equal(r.writes, true);
    });

    it("detects delete operations → high risk", () => {
        const step = { name: "del-step", execute: async () => { require("fs").rmSync("/tmp/x"); } };
        const r = analyzeStep(step);
        assert.equal(r.deletes, true);
        assert.equal(r.riskLevel, "high");
    });

    it("pure read-only step has low risk", () => {
        const step = { name: "read-step", execute: async () => { require("fs").readFileSync("/tmp/x"); } };
        const r = analyzeStep(step);
        assert.equal(r.riskLevel, "low");
        assert.equal(r.writes, false);
    });

    it("detects hasSimulate flag", () => {
        const step = {
            name: "sim-step",
            execute: async () => {},
            simulate: async () => ({ risk: "low" }),
        };
        const r = analyzeStep(step);
        assert.equal(r.hasSimulate, true);
    });

    it("npm install detected as medium risk", () => {
        const step = { name: "install", execute: async () => { require("child_process").spawnSync("npm", ["install"]); } };
        const r = analyzeStep(step);
        assert.ok(r.riskLevel === "medium" || r.riskLevel === "high");
    });
});

// ── 9. simulateWorkflow ───────────────────────────────────────────────

describe("simulateWorkflow", () => {
    it("returns step analysis for each step", async () => {
        const steps = [
            { name: "a", execute: async () => {} },
            { name: "b", execute: async () => { require("fs").writeFileSync("/tmp/x", ""); } },
        ];
        const r = await simulateWorkflow(steps);
        assert.equal(r.steps.length, 2);
    });

    it("requiresSandbox=true when high-risk step present", async () => {
        const steps = [{ name: "del", execute: async () => { require("fs").rmSync("/tmp/x", {}); } }];
        const r = await simulateWorkflow(steps);
        assert.equal(r.requiresSandbox, true);
    });

    it("requiresSandbox=false for low-risk-only steps", async () => {
        const steps = [{ name: "clean", execute: async () => {} }];
        const r = await simulateWorkflow(steps);
        assert.equal(r.requiresSandbox, false);
    });

    it("calls step.simulate when present", async () => {
        let simCalled = false;
        const steps = [{
            name: "s",
            execute: async () => {},
            simulate: async () => { simCalled = true; return { willModify: ["x"] }; },
        }];
        const r = await simulateWorkflow(steps);
        assert.equal(simCalled, true);
        assert.deepEqual(r.steps[0].prediction?.willModify, ["x"]);
    });

    it("summary is a non-empty string", async () => {
        const r = await simulateWorkflow([{ name: "x", execute: async () => {} }]);
        assert.ok(typeof r.summary === "string" && r.summary.length > 0);
    });
});

// ── 10. guardDestructive ─────────────────────────────────────────────

describe("guardDestructive", () => {
    it("no-ops in simulation mode", async () => {
        let ran = false;
        const step = guardDestructive({
            name: "d",
            execute: async () => { ran = true; return { done: true }; },
        });
        const result = await step.execute({ _simulationMode: true });
        assert.equal(ran, false);
        assert.equal(result.simulated, true);
    });

    it("executes normally when not in simulation mode", async () => {
        let ran = false;
        const step = guardDestructive({
            name: "d",
            execute: async () => { ran = true; return { done: true }; },
        });
        const result = await step.execute({});
        assert.equal(ran, true);
        assert.equal(result.done, true);
    });
});

// ── 11. Sandbox ───────────────────────────────────────────────────────

describe("sandbox", () => {
    let srcDir;
    before(() => {
        srcDir = mkTmpDir({
            "index.js":       `"use strict";\nmodule.exports = 1;\n`,
            "src/helper.js":  `"use strict";\nmodule.exports = {};\n`,
        });
    });
    after(() => rmDir(srcDir));

    it("createSandbox copies files to a temp directory", async () => {
        const sandbox = await createSandbox(srcDir);
        try {
            assert.ok(fs.existsSync(path.join(sandbox, "index.js")));
            assert.ok(fs.existsSync(path.join(sandbox, "src/helper.js")));
        } finally {
            await cleanupSandbox(sandbox);
        }
    });

    it("modifications in sandbox do not affect source", async () => {
        const sandbox = await createSandbox(srcDir);
        try {
            fs.writeFileSync(path.join(sandbox, "index.js"), '"modified"\n', "utf8");
            const original = fs.readFileSync(path.join(srcDir, "index.js"), "utf8");
            assert.ok(original.includes("module.exports = 1"), "source should be unmodified");
        } finally {
            await cleanupSandbox(sandbox);
        }
    });

    it("applySandbox copies .js files back to source", async () => {
        const sandbox = await createSandbox(srcDir);
        try {
            fs.writeFileSync(path.join(sandbox, "index.js"), '"use strict";\nmodule.exports = 99;\n', "utf8");
            const applied = await applySandbox(sandbox, srcDir);
            assert.ok(applied >= 1);
            const content = fs.readFileSync(path.join(srcDir, "index.js"), "utf8");
            assert.ok(content.includes("99"), "applied content should be from sandbox");
        } finally {
            await cleanupSandbox(sandbox);
            // Restore original
            fs.writeFileSync(path.join(srcDir, "index.js"), `"use strict";\nmodule.exports = 1;\n`, "utf8");
        }
    });

    it("cleanupSandbox removes the directory", async () => {
        const sandbox = await createSandbox(srcDir);
        await cleanupSandbox(sandbox);
        assert.equal(fs.existsSync(sandbox), false);
    });

    it("sandboxedRun applies changes back on success", async () => {
        const testDir = mkTmpDir({ "data.js": `module.exports = 0;\n` });
        try {
            const steps = [{
                name: "modify",
                execute: async (ctx) => {
                    const f = path.join(ctx._projectPath, "data.js");
                    fs.writeFileSync(f, `module.exports = 42;\n`, "utf8");
                    return { modified: true };
                },
            }];
            const r = await sandboxedRun(testDir, "sandbox-test", steps);
            assert.equal(r.success, true);
            assert.ok(r.appliedFiles >= 1);
            const content = fs.readFileSync(path.join(testDir, "data.js"), "utf8");
            assert.ok(content.includes("42"), "changes should be applied back");
        } finally {
            rmDir(testDir);
        }
    });

    it("sandboxedRun does NOT apply on failure", async () => {
        const testDir = mkTmpDir({ "data.js": `module.exports = "original";\n` });
        try {
            const steps = [{
                name: "fail-step",
                execute: async (ctx) => {
                    const f = path.join(ctx._projectPath, "data.js");
                    fs.writeFileSync(f, `module.exports = "modified";\n`, "utf8");
                    throw new Error("step fails after write");
                },
            }];
            const r = await sandboxedRun(testDir, "sandbox-fail-test", steps, { maxRetries: 1 });
            assert.equal(r.success, false);
            assert.equal(r.appliedFiles, 0);
            const content = fs.readFileSync(path.join(testDir, "data.js"), "utf8");
            assert.ok(content.includes("original"), "original should be preserved on failure");
        } finally {
            rmDir(testDir);
        }
    });
});

// ── 12. RootCauseGraph ────────────────────────────────────────────────

describe("RootCauseGraph", () => {
    it("single failure is primary (no incoming edges)", () => {
        const g = new RootCauseGraph();
        g.addFailure("step-a", new Error("fail"), { type: "syntax" });
        assert.equal(g.getPrimary().length, 1);
        assert.equal(g.getCascading().length, 0);
    });

    it("explicitly linked second failure is cascading", () => {
        const g = new RootCauseGraph();
        g.addFailure("install", new Error("dep error"), { type: "dependency" });
        g.addFailure("build",   new Error("build failed"), { type: "process_failure" }, "install");
        assert.equal(g.getPrimary().length,   1);
        assert.equal(g.getCascading().length, 1);
        assert.equal(g.getCascading()[0].causedBy, "install");
    });

    it("temporal heuristic links rapid failures", () => {
        const g = new RootCauseGraph();
        g.addFailure("a", new Error("fail"), { type: "network" });
        g.addFailure("b", new Error("fail"), { type: "network" }); // within 500ms → auto-linked
        assert.equal(g.getCascading().length, 1);
        assert.equal(g.getCascading()[0].reason, "temporal");
    });

    it("fromStepDetails builds graph from workflow result", () => {
        const details = [
            { name: "ok",   status: "completed", attempts: 1, recoveries: 0, error: null },
            { name: "fail", status: "failed",    attempts: 3, recoveries: 1, error: "process error" },
        ];
        const g = RootCauseGraph.fromStepDetails(details);
        assert.equal(g.size, 1);
        assert.equal(g.getPrimary()[0].stepName, "fail");
    });

    it("toJSON includes primary, cascading, edges, total", () => {
        const g = new RootCauseGraph();
        g.addFailure("x", new Error("e"), { type: "timeout" });
        const json = g.toJSON();
        assert.ok("primary"   in json);
        assert.ok("cascading" in json);
        assert.ok("edges"     in json);
        assert.ok("total"     in json);
    });

    it("enrich adds attempts and recoveries to node", () => {
        const g = new RootCauseGraph();
        g.addFailure("s", new Error("e"), { type: "syntax" });
        g.enrich("s", { attempts: 3, recoveries: 2 });
        const node = g.getPrimary()[0];
        assert.equal(node.attempts,   3);
        assert.equal(node.recoveries, 2);
    });
});
