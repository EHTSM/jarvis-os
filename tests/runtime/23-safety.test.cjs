"use strict";
const { describe, it, after, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("fs");
const path   = require("path");
const os     = require("os");

const da  = require("../../agents/runtime/safety/diffAnalyzer.cjs");
const sv  = require("../../agents/runtime/safety/syntaxValidator.cjs");
const cdd = require("../../agents/runtime/safety/circularDepDetector.cjs");
const cmg = require("../../agents/runtime/safety/codeModGuard.cjs");
const fg  = require("../../agents/runtime/security/filesystemGuard.cjs");

// ── diffAnalyzer ──────────────────────────────────────────────────────────

describe("diffAnalyzer — analyzeDiff", () => {
    it("returns zero scores for empty diff", () => {
        const r = da.analyzeDiff("");
        assert.equal(r.riskScore,    0);
        assert.equal(r.filesChanged, 0);
    });
    it("detects changed files from diff header", () => {
        const diff = [
            "diff --git a/src/app.js b/src/app.js",
            "--- a/src/app.js",
            "+++ b/src/app.js",
            "+const x = 1;",
            "-const x = 0;",
        ].join("\n");
        const r = da.analyzeDiff(diff);
        assert.equal(r.filesChanged, 1);
        assert.ok(r.linesAdded   >= 1);
        assert.ok(r.linesRemoved >= 1);
    });
    it("returns higher risk for large volume diff", () => {
        const lines = Array(150).fill("+new line of code;");
        const diff  = "diff --git a/src/big.js b/src/big.js\n--- a/src/big.js\n+++ b/src/big.js\n" + lines.join("\n");
        const r     = da.analyzeDiff(diff);
        assert.ok(r.riskScore > 0);
    });
    it("detects high-risk files in diff", () => {
        const diff = "diff --git a/package.json b/package.json\n--- a/package.json\n+++ b/package.json\n+\"newDep\": \"1.0.0\"";
        const r    = da.analyzeDiff(diff);
        assert.ok(r.highRiskFiles.length > 0);
    });
    it("riskFactors array is present", () => {
        const r = da.analyzeDiff("diff --git a/x.js b/x.js\n+line");
        assert.ok(Array.isArray(r.riskFactors));
    });
});

describe("diffAnalyzer — detectHighRiskFiles / riskLevel", () => {
    it("detects .env as high risk", () => {
        const r = da.detectHighRiskFiles([".env"]);
        assert.ok(r.some(f => f.reason === "environment_config"));
    });
    it("detects auth module as high risk", () => {
        const r = da.detectHighRiskFiles(["src/auth/tokenManager.js"]);
        assert.ok(r.some(f => f.reason === "auth_module"));
    });
    it("normal JS file is not high risk", () => {
        const r = da.detectHighRiskFiles(["src/utils/helpers.js"]);
        assert.equal(r.length, 0);
    });
    it("riskLevel returns correct band", () => {
        assert.equal(da.riskLevel(0),   "low");
        assert.equal(da.riskLevel(25),  "medium");
        assert.equal(da.riskLevel(50),  "high");
        assert.equal(da.riskLevel(75),  "critical");
        assert.equal(da.riskLevel(100), "critical");
    });
});

// ── syntaxValidator ───────────────────────────────────────────────────────

describe("syntaxValidator — validate", () => {
    it("valid JS returns valid:true", () => {
        const r = sv.validate("const x = 1; module.exports = { x };");
        assert.equal(r.valid, true);
        assert.equal(r.errors.length, 0);
    });
    it("invalid JS returns valid:false with error", () => {
        const r = sv.validate("const x = {{{");
        assert.equal(r.valid, false);
        assert.ok(r.errors.length > 0);
        assert.ok(typeof r.errors[0].message === "string");
    });
    it("syntax error includes message", () => {
        const r = sv.validate("function(");
        assert.equal(r.valid, false);
        assert.ok(r.errors[0].message.length > 0);
    });
    it("non-string code returns valid:false", () => {
        const r = sv.validate(null);
        assert.equal(r.valid, false);
    });
    it("warns about console.log", () => {
        const r = sv.validate("console.log('hello');");
        assert.ok(r.warnings.some(w => w.includes("console.log")));
    });
    it("warns about debugger statement", () => {
        const r = sv.validate("debugger;");
        assert.ok(r.warnings.some(w => w.includes("debugger")));
    });
    it("strips shebang before validating", () => {
        const r = sv.validate("#!/usr/bin/env node\nconst x = 1;");
        assert.equal(r.valid, true);
    });
});

describe("syntaxValidator — validateFile", () => {
    const TMP = path.join(os.tmpdir(), `sv-test-${Date.now()}.js`);
    after(() => { try { fs.unlinkSync(TMP); } catch {} });

    it("validates a real JS file", () => {
        fs.writeFileSync(TMP, "const x = 42; module.exports = x;", "utf8");
        const r = sv.validateFile(TMP);
        assert.equal(r.valid, true);
    });
    it("returns valid:false for non-existent file", () => {
        const r = sv.validateFile("/tmp/does-not-exist-xyz.js");
        assert.equal(r.valid, false);
    });
    it("skips unsupported extension", () => {
        const r = sv.validateFile("/tmp/file.py");
        assert.equal(r.valid, true);  // skipped = treated as valid
        assert.ok(r.warnings.some(w => w.includes("unsupported")));
    });
});

// ── circularDepDetector ───────────────────────────────────────────────────

describe("circularDepDetector — detectInFile", () => {
    const TMP = os.tmpdir();

    it("extracts relative requires", () => {
        const f = path.join(TMP, `cdd-a-${Date.now()}.cjs`);
        fs.writeFileSync(f, `const b = require('./cdd-b');\nmodule.exports = {};`, "utf8");
        const r = cdd.detectInFile(f);
        assert.ok(Array.isArray(r.requires));
        fs.unlinkSync(f);
    });
    it("ignores npm module requires", () => {
        const f = path.join(TMP, `cdd-npm-${Date.now()}.cjs`);
        fs.writeFileSync(f, `require('express'); require('lodash');`, "utf8");
        const r = cdd.detectInFile(f);
        assert.equal(r.requires.length, 0);
        fs.unlinkSync(f);
    });
    it("returns error for non-existent file", () => {
        const r = cdd.detectInFile("/tmp/no-such-file.cjs");
        assert.ok(r.errors.length > 0);
    });
});

describe("circularDepDetector — wouldCreateCycle", () => {
    it("returns false when no cycle would be created", () => {
        const graph = { "/a.cjs": ["/b.cjs"], "/b.cjs": [] };
        assert.equal(cdd.wouldCreateCycle("/c.cjs", "/a.cjs", graph), false);
    });
    it("returns true when adding edge creates a cycle", () => {
        const graph = { "/a.cjs": ["/b.cjs"], "/b.cjs": ["/c.cjs"], "/c.cjs": [] };
        // Adding /c → /a would create a → b → c → a cycle
        assert.equal(cdd.wouldCreateCycle("/c.cjs", "/a.cjs", graph), true);
    });
});

describe("circularDepDetector — scan", () => {
    it("scan() returns hasCycles and cycles array for clean entry", () => {
        const f = path.join(os.tmpdir(), `cdd-scan-${Date.now()}.cjs`);
        fs.writeFileSync(f, `module.exports = {};`, "utf8");
        const r = cdd.scan(f);
        assert.ok(typeof r.hasCycles === "boolean");
        assert.ok(Array.isArray(r.cycles));
        fs.unlinkSync(f);
    });
});

// ── codeModGuard ──────────────────────────────────────────────────────────

describe("codeModGuard — checkBefore", () => {
    afterEach(() => fg.reset());

    it("passes clean JS content", () => {
        const r = cmg.checkBefore("/tmp/test-guard.js", "const x = 1;\nmodule.exports = x;");
        assert.equal(r.safe, true);
        assert.equal(r.blockers.length, 0);
    });
    it("blocks invalid JS syntax", () => {
        const r = cmg.checkBefore("/tmp/test-guard.js", "const x = {{{");
        assert.equal(r.safe, false);
        assert.ok(r.blockers.some(b => b.includes("syntax_error")));
    });
    it("blocks writes to restricted filesystem paths", () => {
        const r = cmg.checkBefore(".env", "SECRET=abc");
        assert.equal(r.safe, false);
        assert.ok(r.blockers.some(b => b.includes("filesystem_guard")));
    });
    it("riskScore is a number", () => {
        const r = cmg.checkBefore("/tmp/x.js", "const x = 1;");
        assert.ok(typeof r.riskScore === "number");
    });
    it("warnings array is present", () => {
        const r = cmg.checkBefore("/tmp/x.js", "const x = 1;");
        assert.ok(Array.isArray(r.warnings));
    });
});

describe("codeModGuard — guardedWrite", () => {
    const TMP_PATH = path.join(os.tmpdir(), `guard-write-${Date.now()}.js`);
    after(() => { try { fs.unlinkSync(TMP_PATH); } catch {} });

    it("writes valid JS file", () => {
        const r = cmg.guardedWrite(TMP_PATH, "const x = 42; module.exports = x;");
        assert.equal(r.written, true);
        assert.ok(fs.existsSync(TMP_PATH));
    });
    it("does not write invalid JS", () => {
        const bad = path.join(os.tmpdir(), `guard-bad-${Date.now()}.js`);
        const r   = cmg.guardedWrite(bad, "const x = {{{");
        assert.equal(r.written, false);
        assert.ok(!fs.existsSync(bad));
    });
    it("does not write to restricted path", () => {
        const r = cmg.guardedWrite(".env", "S=1");
        assert.equal(r.written, false);
    });
    it("written:true means file on disk", () => {
        const p = path.join(os.tmpdir(), `guard-ok-${Date.now()}.js`);
        const r = cmg.guardedWrite(p, "module.exports = {};");
        assert.equal(r.written, true);
        assert.ok(fs.existsSync(p));
        fs.unlinkSync(p);
    });
});
