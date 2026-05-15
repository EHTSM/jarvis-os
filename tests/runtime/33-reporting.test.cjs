"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const br = require("../../agents/runtime/benchmark/benchmarkReporter.cjs");

// ── Sample fixtures ───────────────────────────────────────────────────

const PASSING = {
    name: "syntax-repair", category: "node-repair",
    successRate: 1.0, repairRate: 1.0, flipRate: 0, avgMs: 12, totalRuns: 10,
    score: { completion: 100, repairRate: 100, stability: 100, reproducibility: 100, rollbackSuccess: 100, composite: 100 },
    runs: Array(10).fill({ success: true, repaired: true }),
};
const FAILING = {
    name: "docker-build", category: "build",
    successRate: 0.2, repairRate: 0.3, flipRate: 0.6, avgMs: 250, totalRuns: 10,
    score: { completion: 20, repairRate: 30, stability: 40, reproducibility: 40, rollbackSuccess: 30, composite: 32 },
    runs: Array(10).fill({ success: false, repaired: false }),
};
const UNSTABLE = {
    name: "flaky-deploy", category: "deployment",
    successRate: 0.4, repairRate: 0.5, flipRate: 0.7, avgMs: 100, totalRuns: 10,
    score: { composite: 45 },
    runs: Array(10).fill({ success: false }),
};

// ── generateReport ────────────────────────────────────────────────────

describe("benchmarkReporter — generateReport", () => {
    it("returns required top-level fields", () => {
        const r = br.generateReport([PASSING, FAILING]);
        assert.ok("generatedAt"      in r);
        assert.ok("scenarioCount"    in r);
        assert.ok("totalRuns"        in r);
        assert.ok("summary"          in r);
        assert.ok("table"            in r);
        assert.ok("failureCategories" in r);
        assert.ok("repairRanking"    in r);
        assert.ok("unstableWorkflows" in r);
    });
    it("scenarioCount matches input length", () => {
        const r = br.generateReport([PASSING, FAILING]);
        assert.equal(r.scenarioCount, 2);
    });
    it("totalRuns sums all scenario runs", () => {
        const r = br.generateReport([PASSING, FAILING]);
        assert.equal(r.totalRuns, 20);
    });
    it("summary has avgSuccessRate", () => {
        const r = br.generateReport([PASSING, FAILING]);
        assert.ok("avgSuccessRate" in r.summary);
    });
    it("empty input returns zero counts", () => {
        const r = br.generateReport([]);
        assert.equal(r.scenarioCount, 0);
        assert.equal(r.totalRuns,     0);
    });
    it("unstableWorkflows lists high-flipRate scenarios", () => {
        const r = br.generateReport([PASSING, UNSTABLE]);
        assert.ok(r.unstableWorkflows.some(w => w.name === "flaky-deploy"));
    });
    it("passing scenario not in unstableWorkflows", () => {
        const r = br.generateReport([PASSING]);
        assert.ok(!r.unstableWorkflows.some(w => w.name === "syntax-repair"));
    });
});

// ── formatTable ───────────────────────────────────────────────────────

describe("benchmarkReporter — formatTable", () => {
    it("returns a string", () => {
        assert.ok(typeof br.formatTable([PASSING]) === "string");
    });
    it("includes scenario name", () => {
        const t = br.formatTable([PASSING]);
        assert.ok(t.includes("syntax-repair"));
    });
    it("includes headers", () => {
        const t = br.formatTable([PASSING]);
        assert.ok(t.includes("Scenario"));
        assert.ok(t.includes("Success%"));
    });
    it("returns fallback for empty input", () => {
        assert.ok(br.formatTable([]).includes("no results"));
    });
    it("each row shows success rate as percent", () => {
        const t = br.formatTable([PASSING]);
        assert.ok(t.includes("100%"));
    });
});

// ── topFailures ───────────────────────────────────────────────────────

describe("benchmarkReporter — topFailures", () => {
    it("returns array", () => {
        assert.ok(Array.isArray(br.topFailures([FAILING])));
    });
    it("each entry has category, count, rate", () => {
        const f = br.topFailures([FAILING]);
        assert.ok("category" in f[0]);
        assert.ok("count"    in f[0]);
        assert.ok("rate"     in f[0]);
    });
    it("sorted by count descending", () => {
        const results = [
            { ...FAILING, totalRuns: 10, category: "build",  successRate: 0 },
            { ...PASSING, totalRuns: 5,  category: "repair", successRate: 1 },
        ];
        const f = br.topFailures(results);
        assert.ok(f[0].count >= f[f.length - 1].count);
    });
    it("respects n limit", () => {
        const results = Array(10).fill(null).map((_, i) => ({
            ...FAILING,
            category: `cat-${i}`,
            name:     `s-${i}`,
        }));
        const f = br.topFailures(results, 3);
        assert.ok(f.length <= 3);
    });
    it("rate is 0–1", () => {
        const f = br.topFailures([FAILING]);
        for (const entry of f) {
            assert.ok(entry.rate >= 0 && entry.rate <= 1);
        }
    });
    it("empty input returns empty array", () => {
        assert.deepEqual(br.topFailures([]), []);
    });
});

// ── repairEffectivenessRanking ────────────────────────────────────────

describe("benchmarkReporter — repairEffectivenessRanking", () => {
    it("returns array sorted by repairRate desc", () => {
        const ranked = br.repairEffectivenessRanking([PASSING, FAILING]);
        assert.ok(ranked[0].repairRate >= ranked[ranked.length - 1].repairRate);
    });
    it("each entry has name, repairRate, successRate, composite", () => {
        const ranked = br.repairEffectivenessRanking([PASSING]);
        assert.ok("name"        in ranked[0]);
        assert.ok("repairRate"  in ranked[0]);
        assert.ok("successRate" in ranked[0]);
        assert.ok("composite"   in ranked[0]);
    });
    it("empty input returns empty array", () => {
        assert.deepEqual(br.repairEffectivenessRanking([]), []);
    });
    it("higher repairRate scenario ranks first", () => {
        const ranked = br.repairEffectivenessRanking([FAILING, PASSING]);
        assert.equal(ranked[0].name, "syntax-repair");
    });
});

// ── detectUnstable ────────────────────────────────────────────────────

describe("benchmarkReporter — detectUnstable", () => {
    it("returns stable scenario as empty list", () => {
        const r = br.detectUnstable([PASSING]);
        assert.deepEqual(r, []);
    });
    it("returns unstable scenario", () => {
        const r = br.detectUnstable([UNSTABLE]);
        assert.ok(r.some(w => w.name === "flaky-deploy"));
    });
    it("each entry has name, flipRate, successRate, verdict", () => {
        const r = br.detectUnstable([UNSTABLE]);
        assert.ok("name"        in r[0]);
        assert.ok("flipRate"    in r[0]);
        assert.ok("successRate" in r[0]);
        assert.ok("verdict"     in r[0]);
    });
    it("sorted by flipRate descending", () => {
        const r = br.detectUnstable([FAILING, UNSTABLE]);
        for (let i = 1; i < r.length; i++) {
            assert.ok(r[i - 1].flipRate >= r[i].flipRate);
        }
    });
    it("custom threshold is respected", () => {
        // PASSING has flipRate 0, should not appear even with low threshold
        const r = br.detectUnstable([PASSING], 0.0);
        assert.ok(r.every(w => w.successRate < br.UNRELIABLE_SUCCESS_THRESHOLD || w.flipRate > 0));
    });
    it("UNSTABLE_FLIP_THRESHOLD constant is exported", () => {
        assert.ok(typeof br.UNSTABLE_FLIP_THRESHOLD === "number");
    });
});

// ── exportMarkdown ────────────────────────────────────────────────────

describe("benchmarkReporter — exportMarkdown", () => {
    it("returns a non-empty string", () => {
        const report = br.generateReport([PASSING, FAILING]);
        const md     = br.exportMarkdown(report);
        assert.ok(typeof md === "string" && md.length > 0);
    });
    it("contains # Benchmark Report header", () => {
        const report = br.generateReport([PASSING]);
        assert.ok(br.exportMarkdown(report).includes("# Benchmark Report"));
    });
    it("contains ## Summary section", () => {
        const report = br.generateReport([PASSING]);
        assert.ok(br.exportMarkdown(report).includes("## Summary"));
    });
    it("contains failure categories when present", () => {
        const report = br.generateReport([FAILING]);
        const md     = br.exportMarkdown(report);
        assert.ok(md.includes("Failure Categories") || md.includes("build"));
    });
    it("mentions unstable workflows when present", () => {
        const report = br.generateReport([UNSTABLE]);
        const md     = br.exportMarkdown(report);
        assert.ok(md.includes("Unstable") || md.includes("flaky-deploy"));
    });
    it("generated markdown includes generatedAt timestamp", () => {
        const report = br.generateReport([PASSING]);
        const md     = br.exportMarkdown(report);
        assert.ok(md.includes("Generated:"));
    });
});
