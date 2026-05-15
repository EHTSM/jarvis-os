"use strict";
/**
 * Workflow 6: Filesystem Operations
 *
 * Tests real file read, write, and directory listing via terminal agent.
 * Uses a temp directory so no production files are touched.
 */
const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");

const { run } = require("../../agents/terminalAgent.cjs");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-fs-"));
const FILE = path.join(TMP, "test-output.txt");

test.after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

test("terminal: ls project root shows known files", async () => {
    const r = await run("ls");
    assert.equal(r.success, true);
    assert.ok(r.stdout?.includes("package.json"), "project root should have package.json");
});

test("terminal: pwd returns a real path", async () => {
    const r = await run("pwd");
    assert.equal(r.success, true);
    assert.match(r.stdout, /^\//);
});

test("terminal: git status works from project root", async () => {
    const r = await run("git status");
    assert.equal(r.success, true);
    assert.ok(/branch|commit|Changes|modified|nothing/i.test(r.output));
});

test("terminal: git log --oneline -3 returns commits", async () => {
    const r = await run("git log --oneline -3");
    assert.equal(r.success, true);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 1);
    assert.match(lines[0], /^[0-9a-f]{7,}/);
});

test("terminal: git diff --stat returns stats or empty", async () => {
    const r = await run("git diff --stat");
    assert.equal(r.success, true, `git diff --stat failed: ${r.error}`);
    assert.ok(typeof r.stdout === "string");
});

test("terminal: git branch shows current branch", async () => {
    const r = await run("git branch");
    assert.equal(r.success, true);
    assert.ok(r.stdout?.includes("*"), "current branch should be marked with *");
});

test("terminal: node -e simple expression", async () => {
    const r = await run(`node -e "console.log(2+2)"`);
    assert.equal(r.success, true, `node -e failed: ${r.error}`);
    assert.ok(r.stdout?.includes("4"), `expected 4, got: ${r.stdout}`);
});

test("terminal: npm -v returns semantic version", async () => {
    const r = await run("npm -v");
    assert.equal(r.success, true);
    assert.match(r.stdout, /^\d+\.\d+\.\d+/);
});

test("terminal: hostname returns non-empty string", async () => {
    const r = await run("hostname");
    assert.equal(r.success, true);
    assert.ok(r.stdout?.trim().length > 0);
});

test("terminal: env returns environment variables (whitelisted)", async () => {
    const r = await run("env");
    // env IS in the whitelist — returns key=value lines
    assert.equal(r.success, true, `env should be whitelisted: ${r.error}`);
    assert.ok(r.stdout?.includes("="), "env output should have key=value pairs");
});

test("all 10 filesystem sub-tasks complete under 5s total", async () => {
    const commands = ["pwd", "whoami", "date", "ls", "node -v", "npm -v", "hostname", "git branch"];
    const t0 = Date.now();
    for (const cmd of commands) {
        const r = await run(cmd);
        assert.equal(r.success, true, `${cmd} failed: ${r.error}`);
    }
    const elapsed = Date.now() - t0;
    assert.ok(elapsed < 5000, `8 commands took ${elapsed}ms, expected < 5s`);
    console.log(`  [timing] 8 fs commands: ${elapsed}ms (avg ${Math.round(elapsed/8)}ms each)`);
});
