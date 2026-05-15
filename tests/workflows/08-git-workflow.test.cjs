"use strict";
/**
 * Workflow 8: Git Workflow
 *
 * Tests real git operations through the terminal agent:
 * status → log → diff → branch → show. No writes to the repo.
 */
const test   = require("node:test");
const assert = require("node:assert/strict");

const { run } = require("../../agents/terminalAgent.cjs");

test("git status shows branch information", async () => {
    const r = await run("git status");
    assert.equal(r.success, true, `git status failed: ${r.error}`);
    assert.ok(/On branch|HEAD detached/i.test(r.output), `no branch in output: "${r.output?.slice(0, 80)}"`);
});

test("git log returns commit hash and message", async () => {
    const r = await run("git log --oneline -5");
    assert.equal(r.success, true);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 1, "repo should have at least one commit");
    for (const line of lines) {
        assert.match(line, /^[0-9a-f]{7,}/, `line should start with hash: "${line}"`);
    }
    console.log(`  [git] last 5 commits: ${lines.length} lines`);
});

test("git log with author shows committer name", async () => {
    const r = await run("git log --oneline --format='%an' -3");
    assert.equal(r.success, true);
    assert.ok(r.stdout?.trim().length > 0, "should have author names");
});

test("git branch shows at least one branch with *", async () => {
    const r = await run("git branch");
    assert.equal(r.success, true);
    assert.ok(r.stdout?.includes("*"), "active branch should be marked with *");
    console.log(`  [git] branches: ${r.stdout?.trim()}`);
});

test("git diff --stat completes without error", async () => {
    const r = await run("git diff --stat");
    assert.equal(r.success, true, `git diff --stat failed: ${r.error}`);
    // Could be empty (no changes) or show files — both valid
    assert.ok(typeof r.stdout === "string");
});

test("git show HEAD returns commit info", async () => {
    const r = await run("git show HEAD --stat --no-patch");
    assert.equal(r.success, true, `git show HEAD failed: ${r.error}`);
    // Should contain commit hash or author line
    assert.ok(r.output?.length > 0, "should show commit info");
});

test("git log format consistency: timestamps are ISO-like", async () => {
    const r = await run("git log --format='%aI' -3");
    assert.equal(r.success, true);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    for (const line of lines) {
        assert.match(line, /^\d{4}-\d{2}-\d{2}/, `timestamp should be ISO: "${line}"`);
    }
});

test("full git inspection pipeline: status → log → diff → branch", async () => {
    const t0 = Date.now();
    const [s, l, d, b] = await Promise.all([
        run("git status"),
        run("git log --oneline -3"),
        run("git diff --stat"),
        run("git branch"),
    ]);
    const elapsed = Date.now() - t0;

    assert.equal(s.success, true, "git status failed");
    assert.equal(l.success, true, "git log failed");
    assert.equal(d.success, true, "git diff failed");
    assert.equal(b.success, true, "git branch failed");

    // All four in parallel should be faster than serial
    assert.ok(elapsed < 5000, `parallel git pipeline took ${elapsed}ms`);
    console.log(`  [git pipeline] 4 concurrent ops: ${elapsed}ms`);
});
