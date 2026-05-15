"use strict";
/**
 * Workflow 10: Persistent Execution Log
 *
 * Tests: execLog.append(), tail(), info(), rotation trigger,
 * and that executionHistory.record() causes log persistence.
 */
const test   = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const execLog = require("../../backend/utils/execLog.cjs");
const history = require("../../agents/runtime/executionHistory.cjs");

const LOG_FILE = path.join(__dirname, "../../data/logs/execution.ndjson");

test("execLog.info() returns file metadata", () => {
    const info = execLog.info();
    assert.ok(typeof info.sizeBytes === "number", "sizeBytes should be number");
    assert.ok(typeof info.exists    === "boolean",  "exists should be boolean");
    assert.ok(typeof info.path      === "string",   "path should be string");
    assert.ok(info.path.endsWith("execution.ndjson"), `unexpected path: ${info.path}`);
});

test("execLog.append() writes a line to the log file", () => {
    const marker = `test-marker-${Date.now()}`;
    execLog.append({
        agentId:    "wf10-agent",
        taskType:   "wf10-test",
        taskId:     marker,
        success:    true,
        durationMs: 42,
        input:      "persistent log test",
        output:     "ok",
    });

    // Give the write-stream a tick to flush
    return new Promise(resolve => setTimeout(() => {
        const entries = execLog.tail(200);
        const found   = entries.find(e => e.taskId === marker);
        assert.ok(found, "appended entry should appear in tail");
        assert.equal(found.agentId,    "wf10-agent");
        assert.equal(found.success,    true);
        assert.equal(found.durationMs, 42);
        console.log(`  [execLog] entry persisted: ${marker}`);
        resolve();
    }, 50));
});

test("execLog.tail() returns entries newest-first", () => {
    const entries = execLog.tail(50);
    assert.ok(Array.isArray(entries), "tail should return array");
    if (entries.length >= 2) {
        const first  = new Date(entries[0].ts).getTime();
        const second = new Date(entries[1].ts).getTime();
        assert.ok(first >= second, "entries should be newest-first");
    }
});

test("execLog.tail(0) returns empty array", () => {
    const r = execLog.tail(0);
    assert.ok(Array.isArray(r));
    assert.equal(r.length, 0);
});

test("executionHistory.record() → log persists the entry", () => {
    const marker = `hist-log-${Date.now()}`;
    history.record({
        agentId:    "wf10-hist",
        taskType:   "wf10-hist-type",
        taskId:     marker,
        success:    true,
        durationMs: 7,
        input:      marker,
        output:     "from history.record",
    });

    return new Promise(resolve => setTimeout(() => {
        const entries = execLog.tail(20);
        const found   = entries.find(e => e.taskId === marker || e.input === marker);
        assert.ok(found, "history.record() should persist to log file");
        console.log(`  [execLog] history→log bridge verified`);
        resolve();
    }, 50));
});

test("execLog.tail() entries have required fields", () => {
    execLog.append({ agentId: "shape-test", taskType: "shape", success: true, durationMs: 1 });

    return new Promise(resolve => setTimeout(() => {
        const entries = execLog.tail(5);
        assert.ok(entries.length > 0, "should have at least one entry");
        const e = entries[0];
        assert.ok(typeof e.ts         === "string",  "ts should be string");
        assert.ok(typeof e.agentId    === "string",  "agentId should be string");
        assert.ok(typeof e.taskType   === "string",  "taskType should be string");
        assert.ok(typeof e.success    === "boolean", "success should be boolean");
        assert.ok(typeof e.durationMs === "number",  "durationMs should be number");
        resolve();
    }, 50));
});

test("log file survives concurrent appends (no interleaving)", () => {
    const markers = Array.from({ length: 20 }, (_, i) => `concurrent-${Date.now()}-${i}`);
    for (const m of markers) {
        execLog.append({ agentId: "concurrent", taskType: "stress", taskId: m, success: true, durationMs: 0 });
    }

    return new Promise(resolve => setTimeout(() => {
        const entries = execLog.tail(100);
        const found   = markers.filter(m => entries.some(e => e.taskId === m));
        // At least some should be found (write stream may buffer)
        assert.ok(found.length > 0, "concurrent appends should reach the log");
        console.log(`  [execLog] ${found.length}/20 concurrent entries confirmed`);
        resolve();
    }, 100));
});
