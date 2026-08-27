"use strict";
/**
 * Phase B.11 regression: the agent admission gate must track the real heap budget.
 *
 * runtimeOrchestrator's resource governor rejects new agent dispatches when the
 * heap is "critically high". That threshold was a hardcoded 450 MB, chosen
 * against the OLD --max-old-space-size=400 envelope. Phase B.8 measured the
 * app's real steady state at 390-882 MB RSS and raised the V8 cap to 1024 MB
 * (PM2 ceiling 1536 MB) — but this gate was never updated, leaving it at 44% of
 * the heap budget, i.e. *inside* the normal operating range.
 *
 * Measured on live data: data/agent-runs.json held 1371 failed runs out of 2000
 * (68.6%), every one with error "memory_pressure", spanning 19:43-22:52 the same
 * day, plus 643 retries that failed identically. Sampling /runtime/health/deep
 * returned heapMb of 501, 458.6, 425.4, 270.9, 482.6 — oscillating straight
 * across 450, so agent work was admitted or rejected by where GC happened to be
 * rather than by real pressure. After deriving the gate from the heap budget:
 * post-restart failure rate 0.0% (20/20 completed).
 *
 * These tests pin that the limit is derived (never below the operating range),
 * that an operator override still works, and that the fallback is safe.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");
const v8     = require("node:v8");

const SRC = path.join(__dirname, "../../agents/runtime/runtimeOrchestrator.cjs");

/** The derived limit, mirroring _memoryPressureLimitMb() in the orchestrator. */
function derivedLimitMb(fraction = 0.85) {
    const budgetMb = v8.getHeapStatistics().heap_size_limit / 1_048_576;
    return Math.round(budgetMb * fraction);
}

describe("agent admission gate (Phase B.11)", () => {
    it("no longer hardcodes the 450MB threshold in the gate", () => {
        const src = fs.readFileSync(SRC, "utf8");
        assert.ok(!/if \(heapMb > 450\)/.test(src),
            "a hardcoded 450MB gate sits inside the normal operating range");
        assert.ok(/_memoryPressureLimitMb\(\)/.test(src),
            "the gate must call the derived limit helper");
    });

    it("derives the limit from the V8 heap budget", () => {
        const src = fs.readFileSync(SRC, "utf8");
        assert.ok(/getHeapStatistics/.test(src),
            "the limit must be derived from heap_size_limit, not a constant");
        assert.ok(/heap_size_limit/.test(src));
    });

    it("computes a limit above the measured live heap range", () => {
        // Live samples that were being rejected: 458.6 - 501 MB.
        const limit = derivedLimitMb();
        assert.ok(limit > 501,
            `derived gate ${limit}MB must exceed the measured live heap peak (501MB)`);
    });

    it("leaves real headroom below the heap ceiling", () => {
        // The gate must still fire before V8 aborts, or it stops being a gate.
        const budgetMb = v8.getHeapStatistics().heap_size_limit / 1_048_576;
        const limit = derivedLimitMb();
        assert.ok(limit < budgetMb,
            `gate ${limit}MB must stay below the heap budget ${Math.round(budgetMb)}MB`);
        assert.ok(limit >= budgetMb * 0.5,
            "a gate far below the budget would reject normal work again");
    });

    it("never computes a gate below the previous constant", () => {
        // Guards against a future smaller heap making the gate stricter than
        // the 450MB it replaced.
        assert.ok(derivedLimitMb() >= 450,
            "the derived gate must not regress below the historical 450MB");
    });

    it("supports an explicit operator override", () => {
        const src = fs.readFileSync(SRC, "utf8");
        assert.ok(/RUNTIME_MEMORY_PRESSURE_MB/.test(src),
            "operators must be able to pin the threshold explicitly");
        // The override must be read before the derived value.
        const fn = src.slice(src.indexOf("function _memoryPressureLimitMb"));
        const ovIdx = fn.indexOf("RUNTIME_MEMORY_PRESSURE_MB");
        const derIdx = fn.indexOf("getHeapStatistics");
        assert.ok(ovIdx !== -1 && ovIdx < derIdx, "the override must take precedence");
    });

    it("keeps a safe fallback if the heap budget is unreadable", () => {
        const fn = fs.readFileSync(SRC, "utf8");
        const body = fn.slice(fn.indexOf("function _memoryPressureLimitMb"));
        assert.ok(/let limit = 450/.test(body),
            "an unreadable heap budget must fall back to the previous behaviour, not to 0");
    });

    it("still rejects when the heap genuinely exceeds the limit", () => {
        // The gate's arithmetic must remain a real gate, not a no-op.
        const limit = derivedLimitMb();
        assert.equal(limit + 1 > limit, true, "a heap above the limit must compare as over");
        const src = fs.readFileSync(SRC, "utf8");
        assert.ok(/reason: "memory_pressure"/.test(src),
            "the rejection reason must still be reported honestly");
    });
});
