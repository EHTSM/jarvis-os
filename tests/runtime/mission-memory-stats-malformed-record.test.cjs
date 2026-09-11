#!/usr/bin/env node
"use strict";
/**
 * Mission 76 Micro-Mission 16 — getMissionStats() malformed-record regression.
 *
 * Root cause (Micro-Mission 11/15, live-reproduced via post-omega-p10.test.cjs):
 * getMissionStats() accessed m.subtasks.length / m.deployments.length /
 * m.learnings.length / m.failures.length / m.failures (for..of) with no
 * guard against those fields being undefined. A real out-of-band write
 * bypassing createMission()/_buildMission() (traced to
 * tests/runtime/p18-scientific-discovery.test.cjs's own fixture, which
 * writes minimal mission objects directly into data/missions.json) leaves
 * exactly this shape in the real, shared store today.
 *
 * Fix under test: all 5 accesses now use (m.field || []), mirroring the
 * exact pattern already proven for listMissions()'s search filter
 * (Mission 64).
 *
 * This test uses node:test's built-in fs mocking (mock.method) to point
 * missionMemory.cjs's internal _loadMissions() at an isolated, in-memory
 * fixture — missionMemory.cjs has no JARVIS_TEST_DATA_SUFFIX isolation
 * mechanism (unlike businessDataService.cjs/taskQueue.cjs), and this
 * mission's rules forbid modifying data/missions.json or broadly
 * refactoring missionMemory.cjs to add one, so intercepting fs is the
 * only way to exercise this function's real code path without ever
 * touching the real file. The module is required ONCE, before any mock is
 * installed, so Node's own module loader (which itself calls
 * fs.readFileSync to load .cjs source) never runs through the mock — only
 * calls missionMemory.cjs's own code makes after being loaded are
 * intercepted. A monotonically-increasing mocked mtime per call defeats
 * _loadMissions()'s own mtime-based cache, so each withMockedFs() call
 * reliably re-reads its own fixture rather than serving a stale one.
 *
 * Usage: node --test tests/runtime/mission-memory-stats-malformed-record.test.cjs
 */

const { describe, it, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");

delete require.cache[require.resolve("../../backend/services/missionMemory.cjs")];
const mm = require("../../backend/services/missionMemory.cjs");

const _realStatSync = fs.statSync.bind(fs);
const _realReadFileSync = fs.readFileSync.bind(fs);
let _fakeMtime = 1;

function withMockedFs(fixture, fn) {
    const raw = JSON.stringify(fixture);
    const mtime = ++_fakeMtime; // unique per call — defeats _loadMissions()'s mtime cache
    const statMock = mock.method(fs, "statSync", (p, opts) => {
        if (String(p).endsWith("missions.json")) return { mtimeMs: mtime };
        return _realStatSync(p, opts);
    });
    const readMock = mock.method(fs, "readFileSync", (p, opts) => {
        if (String(p).endsWith("missions.json")) return raw;
        return _realReadFileSync(p, opts);
    });
    try {
        return fn();
    } finally {
        statMock.mock.restore();
        readMock.mock.restore();
    }
}

const FIXTURE = {
    missions: [
        // 1. Valid mission — all fields present, normal shape.
        {
            id: "msn_valid_1", objective: "Valid mission", status: "completed",
            priority: "medium", createdAt: "2026-08-01T00:00:00.000Z",
            completedAt: "2026-08-01T01:00:00.000Z",
            subtasks: [{ description: "step 1" }, { description: "step 2" }],
            deployments: [{ id: "dep_1" }],
            learnings: [{ note: "learned something" }],
            failures: [{ description: "transient", phase: "build" }],
        },
        // 2. Malformed — missing subtasks entirely.
        {
            id: "msn_no_subtasks", objective: "No subtasks field", status: "failed",
            priority: "high", createdAt: "2026-08-02T00:00:00.000Z",
            deployments: [], learnings: [],
            failures: [{ description: "seeded failure", phase: "t60a_seed" }],
        },
        // 3. Malformed — missing failures entirely (a latent instance of the
        // same defect class per Micro-Mission 15's finding — not yet
        // triggered by the real records, but explicitly required by Task 2).
        {
            id: "msn_no_failures", objective: "No failures field", status: "planned",
            priority: "low", createdAt: "2026-08-03T00:00:00.000Z",
            subtasks: [{ description: "only subtask" }],
            deployments: [], learnings: [],
        },
        // 4. Malformed — missing deployments and learnings (matches the real
        // shape found in data/missions.json this session).
        {
            id: "msn_real_shape", objective: "Mission 60A-E test seed — safe to ignore", status: "failed",
            createdAt: "2026-08-04T00:00:00.000Z",
            failures: [{ description: "seeded failure for hypothesis-generation coverage", phase: "t60a_seed_phase" }],
        },
    ],
    lastUpdated: "2026-08-04T00:00:00.000Z",
};

describe("missionMemory.cjs getMissionStats() — malformed-record regression (Micro-Mission 16)", () => {
    afterEach(() => mock.restoreAll());

    it("does not throw against a mix of valid and malformed records", () => {
        withMockedFs(FIXTURE, () => {
            assert.doesNotThrow(() => mm.getMissionStats());
        });
    });

    it("computes correct statistics for the valid record and degrades malformed ones to 0 contribution", () => {
        withMockedFs(FIXTURE, () => {
            const s = mm.getMissionStats();

            assert.equal(s.total, 4, "all 4 fixture records counted");

            // totalSubtasks: msn_valid_1 (2) + msn_no_failures (1) contribute; the
            // other 2 malformed records (missing subtasks) contribute 0, not a crash.
            assert.equal(s.totalSubtasks, 3, `expected 3, got ${s.totalSubtasks}`);

            // totalDeployments: only msn_valid_1 (1) contributes; msn_real_shape has no
            // deployments field at all and must contribute 0, not throw.
            assert.equal(s.totalDeployments, 1, `expected 1, got ${s.totalDeployments}`);

            // totalLearnings: only msn_valid_1 (1) contributes.
            assert.equal(s.totalLearnings, 1, `expected 1, got ${s.totalLearnings}`);

            // failureRate: 3 of 4 records have a non-empty failures array
            // (msn_valid_1, msn_no_subtasks, msn_real_shape); msn_no_failures has
            // none at all and must count as 0 failures, not throw.
            assert.equal(s.failureRate, 0.75, `expected 0.75 (3/4), got ${s.failureRate}`);

            // mostCommonFailurePhases must include the 3 real phases from the 3
            // records that have failures, and must not crash on msn_no_failures's
            // missing field.
            const phases = s.mostCommonFailurePhases.map(p => p.phase);
            assert.ok(phases.includes("build"), "valid record's failure phase present");
            assert.ok(phases.includes("t60a_seed"), "msn_no_subtasks's failure phase present");
            assert.ok(phases.includes("t60a_seed_phase"), "msn_real_shape's failure phase present");
        });
    });

    it("result shape remains compatible with existing callers (all documented fields present, correct types)", () => {
        withMockedFs(FIXTURE, () => {
            const s = mm.getMissionStats();

            assert.equal(typeof s.total, "number");
            assert.equal(typeof s.byStatus, "object");
            assert.equal(typeof s.byPriority, "object");
            assert.ok(s.avgCompletionTimeMs === null || typeof s.avgCompletionTimeMs === "number");
            assert.equal(typeof s.failureRate, "number");
            assert.ok(Array.isArray(s.mostCommonFailurePhases));
            assert.equal(typeof s.totalSubtasks, "number");
            assert.equal(typeof s.totalDeployments, "number");
            assert.equal(typeof s.totalLearnings, "number");
        });
    });

    it("empty mission collection still returns the dedicated zero-state shape, unaffected by the fix", () => {
        withMockedFs({ missions: [], lastUpdated: "2026-08-04T00:00:00.000Z" }, () => {
            const s = mm.getMissionStats();
            assert.equal(s.total, 0);
            assert.equal(s.totalSubtasks, 0);
            assert.equal(s.totalDeployments, 0);
            assert.equal(s.totalLearnings, 0);
            assert.equal(s.failureRate, 0);
            assert.deepEqual(s.mostCommonFailurePhases, []);
        });
    });
});
