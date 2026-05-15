"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const bm = require("../../agents/runtime/repo/branchManager.cjs");
const cg = require("../../agents/runtime/repo/commitGrouper.cjs");

// ── branchManager ─────────────────────────────────────────────────────────

describe("branchManager — create and track", () => {
    afterEach(() => bm.reset());

    it("create() with skipGit returns a branch record", () => {
        const b = bm.create("feat/test", { skipGit: true });
        assert.equal(b.name,   "feat/test");
        assert.equal(b.status, bm.STATUS.ACTIVE);
        assert.ok(typeof b.createdAt === "string");
    });
    it("listBranches() returns created branches", () => {
        bm.create("a", { skipGit: true });
        bm.create("b", { skipGit: true });
        const list = bm.listBranches();
        assert.ok(list.some(b => b.name === "a"));
        assert.ok(list.some(b => b.name === "b"));
    });
    it("checkout() returns ok:true for tracked branch", () => {
        bm.create("feat/x", { skipGit: true });
        const r = bm.checkout("feat/x", { skipGit: true });
        assert.equal(r.ok, true);
    });
});

describe("branchManager — failure and recovery", () => {
    afterEach(() => bm.reset());

    it("markFailed() sets status to failed", () => {
        bm.create("feat/x", { skipGit: true });
        const r = bm.markFailed("feat/x", "test_error");
        assert.equal(r.status,     bm.STATUS.FAILED);
        assert.equal(r.failReason, "test_error");
    });
    it("markComplete() sets status to complete", () => {
        bm.create("feat/x", { skipGit: true });
        bm.markComplete("feat/x");
        const list = bm.listBranches();
        assert.equal(list.find(b => b.name === "feat/x")?.status, bm.STATUS.COMPLETE);
    });
    it("listRecoverable() returns only failed branches", () => {
        bm.create("ok",   { skipGit: true });
        bm.create("bad",  { skipGit: true });
        bm.markFailed("bad", "err");
        const rec = bm.listRecoverable();
        assert.ok(rec.some(b => b.name === "bad"));
        assert.ok(!rec.some(b => b.name === "ok"));
    });
    it("recover() with checkpoint restores branch", () => {
        bm.create("feat/x", { skipGit: true });
        bm.createCheckpoint("feat/x", { step: 2, files: ["a.js"] });
        bm.markFailed("feat/x", "step_3_failed");
        const r = bm.recover("feat/x", { skipGit: true });
        assert.equal(r.recovered, true);
        assert.equal(r.action,    "restored_checkpoint");
    });
    it("recover() without checkpoint uses hard_reset simulation", () => {
        bm.create("feat/x", { skipGit: true });
        bm.markFailed("feat/x", "err");
        const r = bm.recover("feat/x", { skipGit: true });
        assert.equal(r.recovered, true);
    });
    it("recover() returns recovered=false for non-failed branch", () => {
        bm.create("feat/x", { skipGit: true });
        const r = bm.recover("feat/x", { skipGit: true });
        assert.equal(r.recovered, false);
    });
});

describe("branchManager — checkpoints", () => {
    afterEach(() => bm.reset());

    it("createCheckpoint stores data", () => {
        bm.create("feat/x", { skipGit: true });
        const cp = bm.createCheckpoint("feat/x", { step: 1 });
        assert.deepEqual(cp.data, { step: 1 });
        assert.ok(typeof cp.ts === "string");
    });
    it("getCheckpoint returns latest checkpoint", () => {
        bm.create("feat/x", { skipGit: true });
        bm.createCheckpoint("feat/x", { step: 1 });
        bm.createCheckpoint("feat/x", { step: 2 });
        const cp = bm.getCheckpoint("feat/x");
        assert.deepEqual(cp.data, { step: 2 });
    });
    it("getCheckpoint returns null for branch with no checkpoints", () => {
        bm.create("feat/x", { skipGit: true });
        assert.equal(bm.getCheckpoint("feat/x"), null);
    });
});

describe("branchManager — delete", () => {
    afterEach(() => bm.reset());

    it("deleteBranch removes from list", () => {
        bm.create("del-me", { skipGit: true });
        bm.deleteBranch("del-me", { skipGit: true });
        assert.ok(!bm.listBranches().some(b => b.name === "del-me"));
    });
});

// ── commitGrouper ─────────────────────────────────────────────────────────

describe("commitGrouper — detectType", () => {
    it("detects test files", () => {
        assert.equal(cg.detectType("tests/foo.test.cjs"),           "test");
        assert.equal(cg.detectType("src/__tests__/bar.spec.js"),    "test");
    });
    it("detects docs files", () => {
        assert.equal(cg.detectType("README.md"),      "docs");
        assert.equal(cg.detectType("docs/guide.txt"), "docs");
    });
    it("detects build/CI files", () => {
        assert.equal(cg.detectType(".github/workflows/ci.yml"), "build");
        assert.equal(cg.detectType("Dockerfile"),               "build");
    });
    it("detects chore files", () => {
        assert.equal(cg.detectType("package.json"),      "chore");
        assert.equal(cg.detectType("yarn.lock"),         "chore");
        assert.equal(cg.detectType(".eslintrc.json"),    "chore");
    });
    it("defaults JS files to feat", () => {
        assert.equal(cg.detectType("src/myFeature.js"),   "feat");
        assert.equal(cg.detectType("agents/myAgent.cjs"), "feat");
    });
});

describe("commitGrouper — group", () => {
    it("returns an object with all type keys", () => {
        const g = cg.group([]);
        for (const type of cg.TYPE_ORDER) assert.ok(type in g, `missing key: ${type}`);
    });
    it("groups files by detected type", () => {
        const g = cg.group(["README.md", "package.json", "src/app.js", "tests/app.test.js"]);
        assert.ok(g.docs.includes("README.md"));
        assert.ok(g.chore.includes("package.json"));
        assert.ok(g.test.includes("tests/app.test.js"));
    });
});

describe("commitGrouper — generateMessage", () => {
    it("returns a string", () => {
        const msg = cg.generateMessage("feat", ["src/feature.js"]);
        assert.ok(typeof msg === "string");
        assert.ok(msg.startsWith("feat"));
    });
    it("single file message names the file", () => {
        const msg = cg.generateMessage("fix", ["src/bug.js"]);
        assert.ok(msg.includes("bug.js"));
    });
    it("multi-file message mentions count", () => {
        const msg = cg.generateMessage("refactor", ["a.js", "b.js", "c.js"]);
        assert.ok(msg.includes("3 files") || msg.includes("3"));
    });
});

describe("commitGrouper — buildCommitPlan", () => {
    it("returns array of commit groups", () => {
        const plan = cg.buildCommitPlan(["src/app.js", "tests/app.test.js", "README.md"]);
        assert.ok(Array.isArray(plan));
        assert.ok(plan.length > 0);
    });
    it("each group has type, files, message", () => {
        const plan = cg.buildCommitPlan(["src/app.js"]);
        assert.ok("type"    in plan[0]);
        assert.ok("files"   in plan[0]);
        assert.ok("message" in plan[0]);
    });
    it("fix groups come before feat groups", () => {
        const plan = cg.buildCommitPlan([
            "src/feature.js",
            "fixes/hotfix.js",
        ]);
        const types = plan.map(p => p.type);
        const fixIdx  = types.indexOf("fix");
        const featIdx = types.indexOf("feat");
        if (fixIdx !== -1 && featIdx !== -1) assert.ok(fixIdx < featIdx);
    });
    it("empty files returns empty plan", () => {
        assert.deepEqual(cg.buildCommitPlan([]), []);
    });
});
