"use strict";
/**
 * PHASE 4 — Recovery & Failure Simulation
 * Injects failures into queue, adapters, and emergency governor,
 * then verifies the system recovers without data loss.
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path   = require("path");
const fs     = require("fs");

const tq       = require("../../agents/taskQueue.cjs");
const governor = require("../../agents/runtime/control/runtimeEmergencyGovernor.cjs");
const supervisor = require("../../agents/runtime/adapters/executionAdapterSupervisor.cjs");

const QUEUE_FILE = path.join(__dirname, "../../data/task-queue.json");

// ── helpers ──────────────────────────────────────────────────────────────────

function addTemp(label) {
    return tq.addTask({ input: `recovery-test-${label}-${Date.now()}`, type: "auto" });
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("Phase 4 — Recovery & Failure Simulation", { concurrency: 1 }, () => {

    // ── Queue file recovery ─────────────────────────────────────────────────

    it("queue recovers from corrupted file — returns empty array, not crash", () => {
        const backup = fs.existsSync(QUEUE_FILE) ? fs.readFileSync(QUEUE_FILE) : null;
        try {
            fs.writeFileSync(QUEUE_FILE, "{corrupt: not json{{");
            const all = tq.getAll();
            assert.ok(Array.isArray(all), "getAll() should return [] on corrupt file, not throw");
        } finally {
            if (backup) fs.writeFileSync(QUEUE_FILE, backup);
            else fs.writeFileSync(QUEUE_FILE, "[]");
        }
    });

    it("queue recovers from missing file — returns empty array", () => {
        const backup = fs.existsSync(QUEUE_FILE) ? fs.readFileSync(QUEUE_FILE) : null;
        try {
            fs.unlinkSync(QUEUE_FILE);
            const all = tq.getAll();
            assert.ok(Array.isArray(all), "getAll() should return [] when file missing");
        } finally {
            if (backup) fs.writeFileSync(QUEUE_FILE, backup);
            else fs.writeFileSync(QUEUE_FILE, "[]");
        }
    });

    it("new tasks can be added immediately after corrupt-file recovery", () => {
        const backup = fs.existsSync(QUEUE_FILE) ? fs.readFileSync(QUEUE_FILE) : null;
        let task;
        try {
            fs.writeFileSync(QUEUE_FILE, "not-json");
            assert.doesNotThrow(() => {
                task = tq.addTask({ input: "post-corruption-task", type: "auto" });
            }, "addTask() threw after file corruption");
            assert.ok(task?.id, "addTask() returned no ID after corruption recovery");
        } finally {
            if (task) tq.deleteTask(task.id);
            if (backup) fs.writeFileSync(QUEUE_FILE, backup);
            else fs.writeFileSync(QUEUE_FILE, "[]");
        }
    });

    it("recoverStale() rescues tasks stuck in 'running' for > 2 hours", () => {
        const stale1 = addTemp("stale-a");
        const stale2 = addTemp("stale-b");
        const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
        tq.update(stale1.id, { status: "running", startedAt: twoHoursAgo });
        tq.update(stale2.id, { status: "running", startedAt: twoHoursAgo });

        tq.recoverStale();

        const all = tq.getAll();
        const a   = all.find(t => t.id === stale1.id);
        const b   = all.find(t => t.id === stale2.id);
        assert.ok(a, "stale task A missing after recoverStale");
        assert.ok(b, "stale task B missing after recoverStale");
        assert.notEqual(a.status, "running", "stale task A still 'running' after recover");
        assert.notEqual(b.status, "running", "stale task B still 'running' after recover");

        tq.deleteTask(stale1.id);
        tq.deleteTask(stale2.id);
    });

    // ── Emergency governor cycle ────────────────────────────────────────────

    it("emergency stop → resume cycle completes without errors", () => {
        const stopResult = governor.declareEmergency({
            authorityLevel: "governor",
            reason:         "recovery-test-stop",
            level:          "critical"
        });
        assert.ok(
            stopResult.declared || stopResult.reason === "emergency_already_active",
            `Emergency stop failed: ${JSON.stringify(stopResult)}`
        );

        const resumeResult = governor.resolveEmergency({
            authorityLevel: "governor",
            resolution:     "recovery-test-resume"
        });
        assert.ok(
            resumeResult.resolved !== false,
            `Emergency resume failed: ${JSON.stringify(resumeResult)}`
        );

        assert.equal(governor.isEmergencyActive(), false, "Emergency still active after resolve");
    });

    it("double emergency declare is idempotent — no crash", () => {
        governor.declareEmergency({ authorityLevel: "governor", reason: "double-test", level: "critical" });
        assert.doesNotThrow(() => {
            governor.declareEmergency({ authorityLevel: "governor", reason: "double-test-2", level: "critical" });
        }, "Double declare threw an exception");
        governor.resolveEmergency({ authorityLevel: "governor", resolution: "cleanup" });
    });

    it("double resolve is idempotent — no crash", () => {
        assert.doesNotThrow(() => {
            governor.resolveEmergency({ authorityLevel: "governor", resolution: "double-resolve-1" });
            governor.resolveEmergency({ authorityLevel: "governor", resolution: "double-resolve-2" });
        }, "Double resolve threw an exception");
    });

    it("low-authority emergency declare is rejected, not thrown", () => {
        const result = governor.declareEmergency({
            authorityLevel: "operator",
            reason:         "unauthorized-test",
            level:          "critical"
        });
        assert.equal(result.declared, false, "Low-authority declare should return declared:false");
        assert.equal(governor.isEmergencyActive(), false, "Emergency active after rejected low-auth declare");
    });

    // ── Adapter failure recovery ────────────────────────────────────────────

    it("supervisor handles unknown adapterType gracefully — no uncaught throw", async () => {
        let result;
        await assert.doesNotReject(async () => {
            result = await supervisor.routeExecution({
                adapterType: "nonexistent_adapter_xyz",
                command:     "run",
            });
        }, "supervisor threw on unknown adapterType instead of returning error record");
        assert.ok(result, "supervisor returned null on unknown adapter");
    });

    it("supervisor: blocked terminal command returns receipt, does not throw", async () => {
        let record;
        await assert.doesNotReject(async () => {
            record = await supervisor.routeExecution({
                adapterType: "terminal",
                command:     "rm -rf /tmp/jarvis-test-delete-me",
            });
        }, "supervisor threw on potentially blocked command");
        assert.ok(record, "supervisor returned null for terminal command");
    });

    it("filesystem read of non-existent file returns error receipt, not throw", async () => {
        let record;
        await assert.doesNotReject(async () => {
            record = await supervisor.routeExecution({
                adapterType: "filesystem",
                command:     "read",
                filePath:    "/nonexistent/path/that/cannot/exist.txt"
            });
        }, "supervisor threw on missing-file read");
        assert.ok(record, "supervisor returned null on missing-file read");
    });

    // ── Queue integrity after simulated failure burst ───────────────────────

    it("queue integrity intact after 20 rapid fail+recover cycles", () => {
        const ids = [];
        for (let i = 0; i < 20; i++) {
            const t = addTemp(`fail-cycle-${i}`);
            ids.push(t.id);
            tq.update(t.id, { status: "failed", lastError: "simulated failure" });
        }
        const all = tq.getAll();
        assert.ok(Array.isArray(all), "getAll() broken after fail cycles");
        const raw = fs.readFileSync(QUEUE_FILE, "utf8");
        assert.doesNotThrow(() => JSON.parse(raw), "Queue file invalid JSON after fail cycles");
        for (const id of ids) tq.deleteTask(id);
    });

});
