"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const la  = require("../../agents/runtime/debug/logAnalyzer.cjs");
const stc = require("../../agents/runtime/debug/stackTraceCluster.cjs");
const rcr = require("../../agents/runtime/debug/rootCauseRanker.cjs");
const ro  = require("../../agents/runtime/debug/repairOrchestrator.cjs");

// ── logAnalyzer ───────────────────────────────────────────────────────────

describe("logAnalyzer — parseLogLine", () => {
    it("extracts level from [ERROR] prefix", () => {
        const r = la.parseLogLine("[ERROR] something went wrong");
        assert.equal(r.level, "error");
    });
    it("extracts level from INFO prefix", () => {
        const r = la.parseLogLine("INFO server started on port 3000");
        assert.equal(r.level, "info");
    });
    it("extracts timestamp", () => {
        const r = la.parseLogLine("2024-01-15T10:30:00Z [INFO] msg");
        assert.ok(r.ts?.startsWith("2024"));
    });
    it("returns message for unstructured line", () => {
        const r = la.parseLogLine("some random text");
        assert.ok(typeof r.message === "string");
    });
    it("handles non-string gracefully", () => {
        const r = la.parseLogLine(null);
        assert.equal(r.level, "unknown");
    });
});

describe("logAnalyzer — extractErrors", () => {
    it("returns array", () => {
        assert.ok(Array.isArray(la.extractErrors([])));
    });
    it("extracts SyntaxError lines", () => {
        const lines = ["SyntaxError: unexpected token at line 5", "INFO all good"];
        const errs  = la.extractErrors(lines);
        assert.ok(errs.some(e => e.type === "syntax_error"));
    });
    it("counts duplicate errors", () => {
        const lines = Array(3).fill("[ERROR] Cannot find module './foo'");
        const errs  = la.extractErrors(lines);
        assert.ok(errs[0].count >= 3);
    });
    it("sorts by count descending", () => {
        const lines = [
            ...Array(5).fill("[ERROR] TypeError: x is not a function"),
            "[ERROR] SyntaxError: bad token",
        ];
        const errs = la.extractErrors(lines);
        assert.ok(errs[0].count >= errs[errs.length - 1].count);
    });
});

describe("logAnalyzer — analyzeLogs", () => {
    it("returns required fields", () => {
        const r = la.analyzeLogs(["INFO start", "[ERROR] TypeError: boom"]);
        assert.ok("errors"     in r);
        assert.ok("warnings"   in r);
        assert.ok("patterns"   in r);
        assert.ok("errorRate"  in r);
        assert.ok("severity"   in r);
        assert.ok("totalLines" in r);
    });
    it("errorRate is 0 for clean logs", () => {
        const r = la.analyzeLogs(["INFO ok", "INFO good"]);
        assert.equal(r.errorRate, 0);
    });
    it("severity is error when errors present", () => {
        const r = la.analyzeLogs(["[ERROR] boom"]);
        assert.ok(["error", "critical"].includes(r.severity));
    });
    it("severity is ok for info-only logs", () => {
        const r = la.analyzeLogs(["INFO start", "INFO stop"]);
        assert.equal(r.severity, "ok");
    });
    it("patterns array is populated for known error types", () => {
        const r = la.analyzeLogs(["SyntaxError: bad token"]);
        assert.ok(r.patterns.some(p => p.name === "syntax_error"));
    });
});

describe("logAnalyzer — summarize", () => {
    it("returns topIssues, severity, errorRate", () => {
        const r = la.summarize(["[ERROR] TypeError: x", "INFO ok"], 3);
        assert.ok("topIssues"  in r);
        assert.ok("severity"   in r);
        assert.ok("errorRate"  in r);
    });
    it("topIssues length <= n", () => {
        const lines = Array(10).fill("[ERROR] err");
        const r     = la.summarize(lines, 3);
        assert.ok(r.topIssues.length <= 3);
    });
});

// ── stackTraceCluster ─────────────────────────────────────────────────────

describe("stackTraceCluster — signature", () => {
    afterEach(() => stc.reset());

    it("returns a string", () => {
        assert.ok(typeof stc.signature("Error\n  at foo (file.js:1:1)") === "string");
    });
    it("two identical traces have the same signature", () => {
        const t = "Error\n  at fn (app.js:10:5)\n  at main (app.js:20:3)";
        assert.equal(stc.signature(t), stc.signature(t));
    });
    it("strips line numbers for normalisation", () => {
        const t1 = "Error\n  at fn (app.js:10:5)";
        const t2 = "Error\n  at fn (app.js:99:1)";
        assert.equal(stc.signature(t1), stc.signature(t2));
    });
    it("non-string input returns stable string", () => {
        assert.ok(typeof stc.signature(null) === "string");
    });
});

describe("stackTraceCluster — add / getClusters", () => {
    afterEach(() => stc.reset());

    it("add() returns a numeric id", () => {
        const id = stc.add("Error\n  at fn (app.js:1:1)");
        assert.ok(typeof id === "number");
    });
    it("identical traces map to same cluster id", () => {
        const t  = "Error\n  at fn (app.js:10:5)\n  at main (app.js:20:3)";
        const id1 = stc.add(t);
        const id2 = stc.add(t);
        assert.equal(id1, id2);
    });
    it("different traces create different clusters", () => {
        const id1 = stc.add("Error\n  at fn (app.js:1:1)");
        const id2 = stc.add("Error\n  at bar (other.js:5:2)");
        assert.notEqual(id1, id2);
    });
    it("getClusters() returns sorted by count desc", () => {
        const t1 = "Error\n  at fn (a.js:1:1)";
        const t2 = "Error\n  at bar (b.js:1:1)";
        stc.add(t1); stc.add(t1); stc.add(t1);
        stc.add(t2);
        const clusters = stc.getClusters();
        assert.ok(clusters[0].count >= clusters[1].count);
    });
    it("topClusters respects n", () => {
        for (let i = 0; i < 10; i++) stc.add(`Error\n  at fn${i} (f.js:1:1)`);
        assert.ok(stc.topClusters(3).length <= 3);
    });
    it("getCluster returns entry by id", () => {
        const id = stc.add("Error\n  at x (x.js:1:1)");
        const c  = stc.getCluster(id);
        assert.ok(c !== null);
        assert.equal(c.id, id);
    });
});

// ── rootCauseRanker ───────────────────────────────────────────────────────

describe("rootCauseRanker — rank", () => {
    it("returns empty array for empty input", () => {
        assert.deepEqual(rcr.rank([]), []);
    });
    it("returns ranked array with required fields", () => {
        const errors = [
            { message: "Cannot find module './foo'", type: "module_not_found", count: 5, lastSeen: new Date().toISOString() },
            { message: "TypeError: x is not a function", type: "type_error",       count: 2, lastSeen: new Date().toISOString() },
        ];
        const ranked = rcr.rank(errors);
        assert.ok(Array.isArray(ranked));
        assert.ok("cause"      in ranked[0]);
        assert.ok("type"       in ranked[0]);
        assert.ok("confidence" in ranked[0]);
        assert.ok("evidence"   in ranked[0]);
    });
    it("module_not_found ranks above type_error at equal count", () => {
        const now = new Date().toISOString();
        const errors = [
            { message: "Cannot find module",   type: "module_not_found", count: 1, lastSeen: now },
            { message: "TypeError: x is null", type: "type_error",       count: 1, lastSeen: now },
        ];
        const ranked = rcr.rank(errors);
        assert.equal(ranked[0].type, "module_not_found");
    });
    it("confidence is 0–1", () => {
        const errors = [{ message: "err", type: "generic_error", count: 1, lastSeen: new Date().toISOString() }];
        const ranked = rcr.rank(errors);
        assert.ok(ranked[0].confidence >= 0 && ranked[0].confidence <= 1);
    });
    it("sorted descending by confidence", () => {
        const errors = [
            { message: "A", type: "module_not_found", count: 1, lastSeen: new Date().toISOString() },
            { message: "B", type: "generic_error",    count: 1, lastSeen: new Date().toISOString() },
        ];
        const ranked = rcr.rank(errors);
        assert.ok(ranked[0].confidence >= ranked[1].confidence);
    });
});

describe("rootCauseRanker — topCause", () => {
    it("returns null for empty input", () => {
        assert.equal(rcr.topCause([]), null);
    });
    it("returns single best cause", () => {
        const errors = [{ message: "err", type: "module_not_found", count: 3, lastSeen: new Date().toISOString() }];
        const top = rcr.topCause(errors);
        assert.ok(top !== null);
        assert.ok("cause" in top);
    });
});

// ── repairOrchestrator ────────────────────────────────────────────────────

describe("repairOrchestrator — planRepairs", () => {
    afterEach(() => ro.reset());

    it("returns array for known error type", () => {
        const plan = ro.planRepairs("syntax_error");
        assert.ok(Array.isArray(plan));
        assert.ok(plan.length > 0);
    });
    it("each plan entry has required fields", () => {
        const plan = ro.planRepairs("type_error");
        assert.ok("repairId"    in plan[0]);
        assert.ok("strategy"    in plan[0]);
        assert.ok("confidence"  in plan[0]);
        assert.ok("estimatedMs" in plan[0]);
    });
    it("sorted by confidence descending", () => {
        const plan = ro.planRepairs("syntax_error");
        for (let i = 1; i < plan.length; i++) {
            assert.ok(plan[i - 1].confidence >= plan[i].confidence);
        }
    });
    it("unknown error type falls back to generic repair", () => {
        const plan = ro.planRepairs("nonexistent_type");
        assert.ok(plan.length > 0);
    });
});

describe("repairOrchestrator — executeRepair", () => {
    afterEach(() => ro.reset());

    it("succeeds when verifyFn returns { passed: true } on first try", async () => {
        const plan   = ro.planRepairs("syntax_error");
        const result = await ro.executeRepair(plan, {}, () => ({ passed: true }));
        assert.equal(result.succeeded,  true);
        assert.equal(result.attempts,   1);
        assert.ok(typeof result.strategy   === "string");
        assert.ok(typeof result.durationMs === "number");
    });
    it("fails when verifyFn always returns { passed: false }", async () => {
        const plan   = ro.planRepairs("syntax_error");
        const result = await ro.executeRepair(plan, {}, () => ({ passed: false }), { maxAttempts: 2 });
        assert.equal(result.succeeded, false);
        assert.equal(result.attempts,  2);
    });
    it("stops after first success", async () => {
        let calls = 0;
        const plan = ro.planRepairs("syntax_error");
        await ro.executeRepair(plan, {}, () => { calls++; return { passed: calls === 1 }; });
        assert.equal(calls, 1);
    });
    it("sets ctx._repairStrategy on each attempt", async () => {
        const plan = ro.planRepairs("type_error");
        const ctx  = {};
        await ro.executeRepair(plan, ctx, (c) => ({ passed: true }));
        assert.ok(typeof ctx._repairStrategy === "string");
    });
});

describe("repairOrchestrator — recordOutcome / getStats", () => {
    afterEach(() => ro.reset());

    it("getStats returns empty object before any records", () => {
        assert.deepEqual(ro.getStats("syntax_error"), {});
    });
    it("recordOutcome updates stats", () => {
        ro.recordOutcome("syntax_error", "syntax_error::syntax-add-brace", true);
        ro.recordOutcome("syntax_error", "syntax_error::syntax-add-brace", false);
        const stats = ro.getStats("syntax_error");
        const entry = Object.values(stats)[0];
        assert.ok(entry.attempts >= 2);
    });
});
