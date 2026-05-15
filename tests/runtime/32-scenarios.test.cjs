"use strict";
const { describe, it, after } = require("node:test");
const assert = require("node:assert/strict");

const catalog = require("../../agents/runtime/benchmark/scenarioCatalog.cjs");
const tb      = require("../../agents/runtime/benchmark/taskBenchmark.cjs");

// ── catalog structure ─────────────────────────────────────────────────

describe("scenarioCatalog — structure", () => {
    it("getAll returns 10 scenarios", () => {
        assert.equal(catalog.getAll().length, 10);
    });
    it("each scenario has name, category, description, run", () => {
        for (const s of catalog.getAll()) {
            assert.ok(typeof s.name        === "string" && s.name.length > 0,  `${s.name}: name`);
            assert.ok(typeof s.category    === "string" && s.category.length > 0, `${s.name}: category`);
            assert.ok(typeof s.description === "string", `${s.name}: description`);
            assert.ok(typeof s.run         === "function", `${s.name}: run`);
        }
    });
    it("get(name) returns scenario by name", () => {
        const s = catalog.get("syntax-repair");
        assert.ok(s !== null);
        assert.equal(s.name, "syntax-repair");
    });
    it("get(unknown) returns null", () => {
        assert.equal(catalog.get("no-such-scenario"), null);
    });
    it("getByCategory filters correctly", () => {
        const deps = catalog.getByCategory("dependency");
        assert.ok(deps.length >= 1);
        assert.ok(deps.every(s => s.category === "dependency"));
    });
    it("all scenario names are unique", () => {
        const names = catalog.getAll().map(s => s.name);
        assert.equal(new Set(names).size, names.length);
    });
});

// ── individual scenario runs ──────────────────────────────────────────

describe("scenario: syntax-repair", () => {
    after(() => tb.reset());
    it("run() returns success:true and repaired:true", async () => {
        const s = catalog.get("syntax-repair");
        const r = await s.run();
        assert.equal(typeof r.success,   "boolean");
        assert.equal(typeof r.repaired,  "boolean");
        assert.ok(typeof r.durationMs === "number");
        // This scenario is deterministic — always succeeds
        assert.equal(r.success,  true);
        assert.equal(r.repaired, true);
    });
});

describe("scenario: npm-dependency-conflict", () => {
    it("run() returns boolean success and durationMs", async () => {
        const s = catalog.get("npm-dependency-conflict");
        const r = await s.run();
        assert.equal(typeof r.success,  "boolean");
        assert.equal(typeof r.repaired, "boolean");
        assert.ok(typeof r.durationMs === "number");
        assert.equal(r.success, true);
    });
});

describe("scenario: docker-build-recovery", () => {
    it("run() returns success:true (recovers on retry)", async () => {
        const s = catalog.get("docker-build-recovery");
        const r = await s.run();
        assert.equal(r.success,  true);
        assert.equal(r.repaired, true);
        assert.ok(r.retries >= 1);
    });
});

describe("scenario: broken-api-fix", () => {
    it("run() returns success:true after repair", async () => {
        const s = catalog.get("broken-api-fix");
        const r = await s.run();
        assert.equal(r.success,  true);
        assert.equal(r.repaired, true);
    });
});

describe("scenario: runtime-crash-recovery", () => {
    it("run() returns success and a strategy", async () => {
        const s = catalog.get("runtime-crash-recovery");
        const r = await s.run();
        assert.equal(typeof r.success, "boolean");
        assert.ok(typeof r.detail === "string");
    });
});

describe("scenario: git-conflict-recovery", () => {
    it("run() returns recovered branch", async () => {
        const s = catalog.get("git-conflict-recovery");
        const r = await s.run();
        assert.equal(r.success,  true);
        assert.equal(r.repaired, true);
    });
});

describe("scenario: env-config-repair", () => {
    it("run() detects HOME/PATH as present", async () => {
        const s = catalog.get("env-config-repair");
        const r = await s.run();
        assert.equal(r.success,  true);
        assert.ok(r.detail.includes("present=2"));
    });
});

describe("scenario: port-conflict-resolution", () => {
    it("run() resolves a free port in high range", async () => {
        const s = catalog.get("port-conflict-resolution");
        const r = await s.run();
        assert.equal(typeof r.success,  "boolean");
        assert.equal(typeof r.repaired, "boolean");
        assert.ok(r.durationMs >= 0);
        // At least tried the base port
        assert.ok(r.detail.includes("tried="));
    });
});

describe("scenario: failed-deployment-recovery", () => {
    it("run() returns success:true after rollback", async () => {
        const s = catalog.get("failed-deployment-recovery");
        const r = await s.run();
        assert.equal(r.success,  true);
        assert.equal(r.repaired, true);
        assert.ok(r.detail.includes("rolledBack=true"));
    });
});

describe("scenario: dependency-restoration", () => {
    it("run() restores all 3 dependencies", async () => {
        const s = catalog.get("dependency-restoration");
        const r = await s.run();
        assert.equal(r.success,  true);
        assert.equal(r.repaired, true);
        assert.ok(r.detail.includes("restored=3"));
    });
});

// ── deterministic repeat execution ────────────────────────────────────
// Run each scenario 5 times and verify consistent outcomes

describe("deterministic execution — syntax-repair ×5", () => {
    after(() => tb.reset());
    it("succeeds every time (flipRate 0)", async () => {
        const s = catalog.get("syntax-repair");
        const r = await tb.run(() => s.run(), 5);
        assert.equal(r.successRate, 1);
        assert.equal(r.flipRate,    0);
        assert.equal(r.consistency, true);
    });
});

describe("deterministic execution — env-config-repair ×5", () => {
    after(() => tb.reset());
    it("consistent outcome across 5 runs", async () => {
        const s = catalog.get("env-config-repair");
        const r = await tb.run(() => s.run(), 5);
        assert.ok(r.consistency, "env-config-repair should be consistent");
    });
});

describe("deterministic execution — dependency-restoration ×5", () => {
    after(() => tb.reset());
    it("all 5 runs succeed with no variance", async () => {
        const s = catalog.get("dependency-restoration");
        const r = await tb.run(() => s.run(), 5);
        assert.equal(r.successRate, 1);
        assert.equal(r.flipRate,    0);
    });
});

describe("deterministic execution — git-conflict-recovery ×5", () => {
    after(() => tb.reset());
    it("flipRate is 0 across 5 runs", async () => {
        const s = catalog.get("git-conflict-recovery");
        const r = await tb.run(() => s.run(), 5);
        assert.equal(r.flipRate, 0);
    });
});

describe("deterministic execution — failed-deployment-recovery ×3", () => {
    after(() => tb.reset());
    it("always rolls back correctly", async () => {
        const s = catalog.get("failed-deployment-recovery");
        const r = await tb.run(() => s.run(), 3);
        assert.equal(r.successRate, 1);
        assert.equal(r.flipRate,    0);
    });
});

// ── full benchmark run — all 10 scenarios ─────────────────────────────

describe("full benchmark — all 10 scenarios", () => {
    after(() => tb.reset());

    it("benchmark() returns structured metrics for each scenario", async () => {
        for (const s of catalog.getAll()) {
            const r = await tb.benchmark(s, 3);
            assert.ok(typeof r.successRate    === "number", `${s.name}: successRate`);
            assert.ok(typeof r.flipRate       === "number", `${s.name}: flipRate`);
            assert.ok(typeof r.avgMs          === "number", `${s.name}: avgMs`);
            assert.ok(typeof r.repairRate     === "number", `${s.name}: repairRate`);
            assert.ok(r.score                 !== undefined, `${s.name}: score`);
            assert.ok(r.runs.length           === 3,        `${s.name}: runs.length`);
        }
    });

    it("composite score is between 0–100 for all scenarios", async () => {
        for (const s of catalog.getAll()) {
            const r = await tb.benchmark(s, 2);
            assert.ok(r.score.composite >= 0 && r.score.composite <= 100,
                `${s.name}: composite=${r.score.composite}`);
        }
    });
});
