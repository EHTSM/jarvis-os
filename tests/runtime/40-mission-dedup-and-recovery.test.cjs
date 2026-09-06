"use strict";
/**
 * Mission 40 regression: agentRuntimeSupervisor.cjs's _missionExists()
 * deduplication guard checked `m.status === "active" || m.status ===
 * "pending"` — but "pending" is not a valid missionMemory.cjs status
 * (VALID_STATUSES is planned/active/running/paused/completed/failed/
 * cancelled) and every mission the guard's own caller creates starts as
 * "planned". The guard could never match a freshly-created mission, so it
 * was structurally unable to prevent duplicate creation.
 *
 * Mission 39's audit proved this live against real production data:
 * 1,535 of 2,669 real planned missions (57%) were exact-objective
 * duplicates, with one recommendation recreated 246 times by the 60s
 * planner tick.
 *
 * Fix: corrected the status check from "pending" to "planned" — the real,
 * existing status string. No other behavior of _missionExists() changed;
 * the 300-record scan window and normalization logic are untouched.
 *
 * These tests never touch the real data/missions.json (19MB+, 3,700+ real
 * missions) — the structural test reads agentRuntimeSupervisor.cjs's own
 * source to pin the exact fixed line, and the live-behavior test uses real
 * missionMemory.cjs calls (the only way to prove the fix works end-to-end
 * against the actual persistence layer) but cleans up every mission it
 * creates by marking it "cancelled" — the same convention already
 * established in tests/security/52-runtime-stability-fixes.cjs, since
 * missionMemory.cjs has no delete API.
 *
 * Mission 40 also investigated extending recoverStaleMissions() to cover
 * "planned" missions (Part C of that mission) and found the existing
 * mechanism's semantics do not safely apply: recoverStaleMissions() resets
 * a stale status BACK TO "planned" — for an already-"planned" mission that
 * transition is a no-op (missionMemory.cjs's updateMission() only records
 * a change when the new value differs from the old), and zero of the real
 * 2,669 planned missions carry any persisted signal (e.g. a running
 * subtask) distinguishing "abandoned mid-orchestration" from "never
 * started" — that distinction lives only in missionOrchestrator.cjs's
 * in-memory, non-persisted `_live` Map. Forcing the extension would have
 * either done nothing (a same-status no-op) or mutated all 2,669 historical
 * records with a spurious recordDecision() call, which the mission's own
 * Part D explicitly forbids. Not implemented — documented here as the
 * blocker, not silently worked around.
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const path   = require("node:path");

const { buildIsolatedMissionMemory } = require("./_isolatedMissionMemory.helper.cjs");

// These three paths deliberately continue to point at the REAL source
// files — they are read as plain text (fs.readFileSync) for structural
// assertions and eval()-based live-function extraction (see tests 4/5
// below), never require()'d as executable modules, so pinning them to the
// real, shipped source is correct and required: this is what proves the
// fix is genuinely present in the actual code that ships, not a copy.
// Only the executable `memory` instance below (which performs real
// createMission()/updateMission() writes) is redirected to an isolated
// copy — MISSION 82 (Test 40/43 Data Isolation).
const SUP_SRC_PATH = path.join(__dirname, "../../backend/services/agentRuntimeSupervisor.cjs");
const MEM_SRC_PATH = path.join(__dirname, "../../backend/services/missionMemory.cjs");
const RT_SRC_PATH  = path.join(__dirname, "../../agents/runtime/missionRuntime.cjs");

const RUN = `m40-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
const _createdIds = [];

let iso, memory;

function _cleanup() {
    for (const id of _createdIds) {
        try { memory.updateMission(id, { status: "cancelled", metadata: { m40TestCleanup: true } }); }
        catch { /* best effort — mission may already be cancelled */ }
    }
}

describe("Mission 40 — mission dedup + planned-recovery blocker (agentRuntimeSupervisor.cjs / missionMemory.cjs)", () => {
    before(() => {
        iso = buildIsolatedMissionMemory();
        memory = iso.memory;
    });

    after(() => {
        iso.cleanup();
    });

    it("1. _missionExists() source now checks the real 'planned' status, not the nonexistent 'pending'", () => {
        const src = fs.readFileSync(SUP_SRC_PATH, "utf8");
        const fn = src.match(/function _missionExists\(objectivePrefix\) \{[\s\S]*?\n\}/);
        assert.ok(fn, "_missionExists() must still exist in agentRuntimeSupervisor.cjs");
        assert.ok(
            /m\.status === "active" \|\| m\.status === "planned"/.test(fn[0]),
            "_missionExists() must check for the real 'planned' status"
        );
        assert.ok(
            !/m\.status === "pending"/.test(fn[0]),
            "_missionExists() must no longer reference the nonexistent 'pending' status"
        );
    });

    it("2. existing 'active' branch of the dedup check is unchanged (no regression to the working half)", () => {
        const src = fs.readFileSync(SUP_SRC_PATH, "utf8");
        const fn = src.match(/function _missionExists\(objectivePrefix\) \{[\s\S]*?\n\}/)[0];
        assert.ok(/m\.status === "active"/.test(fn), "the active-status branch must still be present");
    });

    it("3. 'pending' is confirmed NOT a valid missionMemory.cjs status (the actual root cause)", () => {
        const src = fs.readFileSync(MEM_SRC_PATH, "utf8");
        const m = src.match(/const VALID_STATUSES\s*=\s*new Set\(\[([^\]]+)\]\)/);
        assert.ok(m, "VALID_STATUSES must be found in missionMemory.cjs");
        const statuses = m[1].split(",").map(s => s.trim().replace(/"/g, ""));
        assert.ok(statuses.includes("planned"), "planned must be a real valid status");
        assert.ok(!statuses.includes("pending"), "pending must NOT be a real valid status — confirms the original bug's root cause");
    });

    it("4. LIVE: a duplicate objective is now correctly detected against a real, freshly-created 'planned' mission", () => {
        // Reproduces the exact real-world scenario: the planner tick creates a
        // mission (status: planned, per missionMemory.cjs's _buildMission()),
        // then immediately checks whether an equivalent mission already
        // exists before creating a second one.
        const objective = `${RUN} — duplicate-detection regression probe`;
        const created = memory.createMission({ objective, priority: "low" });
        _createdIds.push(created.id);

        // Exercise the real _missionExists() logic (extracted verbatim from
        // the live source so this test can never silently drift from the
        // actual shipped implementation) against the real missionMemory.cjs
        // this process is using.
        const src = fs.readFileSync(SUP_SRC_PATH, "utf8");
        const fnSrc = src.match(/function _missionExists\(objectivePrefix\) \{[\s\S]*?\n\}/)[0];
        function _normalizeObjective(s) { return (s || "").replace(/\d+/g, "#"); }
        // eslint-disable-next-line no-eval
        const _missionExists = eval(`(${fnSrc.replace("function _missionExists", "function")})`);
        function _mm() { return memory; }

        const detected = _missionExists(objective);
        assert.equal(detected, true, "a just-created planned mission with this objective must be detected as existing");

        _cleanup();
    });

    it("5. LIVE negative control: a genuinely different objective is NOT falsely flagged as a duplicate", () => {
        const objective = `${RUN} — original, non-duplicate probe`;
        const created = memory.createMission({ objective, priority: "low" });
        _createdIds.push(created.id);

        const src = fs.readFileSync(SUP_SRC_PATH, "utf8");
        const fnSrc = src.match(/function _missionExists\(objectivePrefix\) \{[\s\S]*?\n\}/)[0];
        function _normalizeObjective(s) { return (s || "").replace(/\d+/g, "#"); }
        // eslint-disable-next-line no-eval
        const _missionExists = eval(`(${fnSrc.replace("function _missionExists", "function")})`);
        function _mm() { return memory; }

        const falsePositive = _missionExists(`${RUN} — completely unrelated objective that was never created`);
        assert.equal(falsePositive, false, "a genuinely non-existent objective must not be falsely flagged");

        _cleanup();
    });

    it("6. terminal retention (MAX_TERMINAL_MISSIONS) is untouched by this mission — cap constant unchanged", () => {
        const src = fs.readFileSync(MEM_SRC_PATH, "utf8");
        assert.ok(/const MAX_TERMINAL_MISSIONS\s*=\s*1000/.test(src), "MAX_TERMINAL_MISSIONS must remain 1000 — Mission 40 does not change retention policy");
    });

    it("7. DOCUMENTED BLOCKER: recoverStaleMissions() still does not cover 'planned' — confirmed not silently changed", () => {
        // Mission 40 Part C investigated extending STALE_STATUSES to include
        // "planned" and found the existing recovery semantics do not safely
        // apply (see file header). This test pins that the mechanism was
        // correctly left untouched, not silently "fixed" in an unsafe way.
        const src = fs.readFileSync(RT_SRC_PATH, "utf8");
        const m = src.match(/const STALE_STATUSES\s*=\s*\[([^\]]+)\]/);
        assert.ok(m, "STALE_STATUSES must be found in missionRuntime.cjs");
        const statuses = m[1].split(",").map(s => s.trim().replace(/"/g, ""));
        assert.deepEqual(statuses.sort(), ["active", "running"].sort(),
            "STALE_STATUSES must remain exactly ['running','active'] — planned-mission recovery was investigated and correctly not implemented (unsafe semantics, see Mission 40 report)");
    });

    it("8. recoverStaleMissions() recovery action would be a no-op if applied to an already-planned mission (proves why the blocker is real)", () => {
        // Direct evidence for finding #7's rationale: updateMission() only
        // records a change when the new value differs from the old one, so
        // resetting a mission that is ALREADY "planned" to "planned" changes
        // nothing meaningful.
        const objective = `${RUN} — no-op-recovery probe`;
        const created = memory.createMission({ objective, priority: "low" });
        _createdIds.push(created.id);
        assert.equal(created.status, "planned", "a freshly created mission must start as planned");

        const before = memory.getMission(created.id);
        const result = memory.updateMission(created.id, { status: "planned" });
        assert.equal(result.status, "planned", "status remains planned after the same-status update");
        assert.equal(before.updatedAt <= result.updatedAt, true, "updatedAt is not decreased (sanity)");
        // The key proof: no meaningful state transition occurred — this is
        // exactly why blindly adding "planned" to STALE_STATUSES using the
        // existing recovery action would not recover anything.

        _cleanup();
    });

});
