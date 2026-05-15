"use strict";
const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const cv = require("../../agents/runtime/configValidator.cjs");
const sd = require("../../agents/runtime/startupDiagnostics.cjs");
const ss = require("../../agents/runtime/safeShutdown.cjs");
const me = require("../../agents/runtime/metricsExporter.cjs");

// ── configValidator ────────────────────────────────────────────────────────

describe("configValidator — valid config", () => {
    it("validate() passes a fully valid config", () => {
        const r = cv.validate(cv.defaults());
        assert.equal(r.valid, true);
        assert.equal(r.errors.length, 0);
    });
    it("defaults() returns an object with all required keys", () => {
        const d = cv.defaults();
        for (const f of cv.REQUIRED_FIELDS) assert.ok(f.key in d, `missing: ${f.key}`);
    });
    it("merge() preserves defaults for missing keys", () => {
        const m = cv.merge({ maxConcurrent: 10 });
        assert.equal(m.maxConcurrent, 10);
        assert.equal(m.maxRetries, cv.defaults().maxRetries);
    });
    it("merge() accepts empty object", () => {
        const m = cv.merge({});
        assert.deepEqual(m, cv.defaults());
    });
});

describe("configValidator — errors", () => {
    it("rejects non-object config", () => {
        assert.equal(cv.validate(null).valid, false);
        assert.equal(cv.validate("str").valid, false);
        assert.equal(cv.validate(42).valid,    false);
    });
    it("error on missing required field", () => {
        const cfg = cv.defaults();
        delete cfg.maxConcurrent;
        const r = cv.validate(cfg);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some(e => e.includes("maxConcurrent")));
    });
    it("error on wrong type for required field", () => {
        const cfg = { ...cv.defaults(), maxRetries: "five" };
        const r = cv.validate(cfg);
        assert.equal(r.valid, false);
        assert.ok(r.errors.some(e => e.includes("maxRetries")));
    });
    it("error when number below min", () => {
        const cfg = { ...cv.defaults(), maxConcurrent: 0 };
        const r = cv.validate(cfg);
        assert.equal(r.valid, false);
    });
    it("error when number above max", () => {
        const cfg = { ...cv.defaults(), maxConcurrent: 9999 };
        const r = cv.validate(cfg);
        assert.equal(r.valid, false);
    });
});

describe("configValidator — warnings", () => {
    it("warns on unknown logLevel value", () => {
        const cfg = { ...cv.defaults(), logLevel: "verbose" };
        const r = cv.validate(cfg);
        assert.equal(r.valid, true);
        assert.ok(r.warnings.some(w => w.includes("logLevel")));
    });
    it("warns on wrong type for optional field", () => {
        const cfg = { ...cv.defaults(), auditEnabled: "yes" };
        const r = cv.validate(cfg);
        assert.equal(r.valid, true);
        assert.ok(r.warnings.some(w => w.includes("auditEnabled")));
    });
});

// ── startupDiagnostics ─────────────────────────────────────────────────────

describe("startupDiagnostics", () => {
    it("runDiagnostics() returns required shape", () => {
        const r = sd.runDiagnostics();
        assert.ok(typeof r.passed  === "boolean");
        assert.ok(typeof r.score   === "number");
        assert.ok(Array.isArray(r.checks));
        assert.ok(Array.isArray(r.failed));
        assert.ok(Array.isArray(r.warnings));
        assert.ok(typeof r.runAt  === "string");
    });
    it("score is 0–100", () => {
        const r = sd.runDiagnostics();
        assert.ok(r.score >= 0 && r.score <= 100);
    });
    it("checkNodeVersion() returns array with a check entry", () => {
        const r = sd.checkNodeVersion();
        assert.ok(Array.isArray(r) && r.length > 0);
        assert.ok(typeof r[0].passed === "boolean");
        assert.ok(r[0].check.startsWith("node:"));
    });
    it("checkMemory() returns array with passed field", () => {
        const r = sd.checkMemory();
        assert.ok(Array.isArray(r) && r.length > 0);
        assert.ok(typeof r[0].passed === "boolean");
    });
    it("checkModules() returns array", () => {
        const r = sd.checkModules();
        assert.ok(Array.isArray(r));
        assert.ok(r.length > 0);
    });
    it("checkDataDirs() returns array", () => {
        const r = sd.checkDataDirs();
        assert.ok(Array.isArray(r));
    });
    it("node >= 18 check passes (we require it to run)", () => {
        const r = sd.checkNodeVersion();
        assert.equal(r[0].passed, true);
    });
});

// ── safeShutdown ───────────────────────────────────────────────────────────

describe("safeShutdown", () => {
    afterEach(() => ss.reset());

    it("isShuttingDown() starts as false", () => {
        assert.equal(ss.isShuttingDown(), false);
    });
    it("shutdownSignal() is null before shutdown", () => {
        assert.equal(ss.shutdownSignal(), null);
    });
    it("onShutdown registers a handler that runs on shutdown()", async () => {
        let called = false;
        ss.onShutdown(() => { called = true; });
        await ss.shutdown("test");
        assert.equal(called, true);
    });
    it("shutdown() returns handlersRun count", async () => {
        ss.onShutdown(() => {});
        ss.onShutdown(() => {});
        const r = await ss.shutdown("test");
        assert.equal(r.handlersRun, 2);
    });
    it("handlers run in priority order (lower first)", async () => {
        const order = [];
        ss.onShutdown(() => order.push("B"), 20, "B");
        ss.onShutdown(() => order.push("A"), 10, "A");
        await ss.shutdown("test");
        assert.deepEqual(order, ["A", "B"]);
    });
    it("isShuttingDown() is true after shutdown", async () => {
        await ss.shutdown("test");
        assert.equal(ss.isShuttingDown(), true);
    });
    it("shutdownSignal() returns reason after shutdown", async () => {
        await ss.shutdown("SIGTERM");
        assert.equal(ss.shutdownSignal(), "SIGTERM");
    });
    it("second shutdown call returns { already: true }", async () => {
        await ss.shutdown("first");
        const r = await ss.shutdown("second");
        assert.equal(r.already, true);
    });
    it("handler error is captured, not thrown", async () => {
        ss.onShutdown(() => { throw new Error("handler_failure"); }, 50, "bad");
        const r = await ss.shutdown("test");
        assert.equal(r.results[0].ok, false);
        assert.ok(r.results[0].error.includes("handler_failure"));
    });
    it("reset() clears handlers and state", async () => {
        ss.onShutdown(() => {});
        await ss.shutdown("test");
        ss.reset();
        assert.equal(ss.isShuttingDown(), false);
        const r = await ss.shutdown("after-reset");
        assert.equal(r.handlersRun, 0);
    });
});

// ── metricsExporter ────────────────────────────────────────────────────────

describe("metricsExporter", () => {
    it("collect() returns required top-level keys", () => {
        const m = me.collect();
        assert.ok("execution"  in m);
        assert.ok("resources"  in m);
        assert.ok("stability"  in m);
        assert.ok("anomalies"  in m);
        assert.ok("trust"      in m);
        assert.ok("collectedAt" in m);
    });
    it("execution fields are present", () => {
        const { execution } = me.collect();
        assert.ok("totalRecords" in execution);
        assert.ok("workflowsRun" in execution);
        assert.ok("queueDepth"   in execution);
    });
    it("resources fields are present", () => {
        const { resources } = me.collect();
        assert.ok("heapUsedMB"  in resources);
        assert.ok("memPressure" in resources);
        assert.ok("cpuLoad"     in resources);
    });
    it("toJSON() returns parseable JSON", () => {
        const json = me.toJSON();
        assert.doesNotThrow(() => JSON.parse(json));
    });
    it("toPrometheus() returns string with #HELP lines", () => {
        const prom = me.toPrometheus();
        assert.ok(typeof prom === "string");
        assert.ok(prom.includes("# HELP"));
        assert.ok(prom.includes("# TYPE"));
    });
    it("toPrometheus() contains jarvis_ prefixed metrics", () => {
        const prom = me.toPrometheus();
        assert.ok(prom.includes("jarvis_"));
    });
    it("memPressure is 0–1", () => {
        const { resources } = me.collect();
        assert.ok(resources.memPressure >= 0 && resources.memPressure <= 1);
    });
});
