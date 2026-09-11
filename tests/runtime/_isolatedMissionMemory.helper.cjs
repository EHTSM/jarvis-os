"use strict";
/**
 * Shared test-isolation helper for missionMemory.cjs.
 *
 * MISSION 82 (Test 40/43 Data Isolation): tests/runtime/40-mission-dedup-
 * and-recovery.test.cjs and tests/runtime/43-mission-storage-dedup.test.cjs
 * previously required the real backend/services/missionMemory.cjs directly,
 * so every memory.createMission()/updateMission() call in those files wrote
 * real records into the actual data/missions.json — cleaned up afterward by
 * marking each created record "cancelled" (missionMemory.cjs has no delete
 * API), but never removed, so they accumulate permanently across every run
 * (confirmed live: 123 such records already present in the real dataset
 * before this fix, spanning 2026-08-23 through 2026-09-03).
 *
 * This helper reuses the exact mkdtempSync + module-copy pattern already
 * proven in the packaged Mission 82C/P0/P1 regression suites
 * (tests/46-atomic-write-race-fix.test.cjs's own _buildIsolatedRepo(),
 * byte-for-byte the same technique): copy missionMemory.cjs and its one
 * real dependency (backend/utils/logger.js) into a throwaway temp
 * directory at matching relative paths, then require() the COPY instead of
 * the real module. missionMemory.cjs resolves its own data file via
 * `path.join(__dirname, "../../data/missions.json")` — an unmodified copy
 * of the file, running from a different __dirname, therefore resolves to
 * an isolated data/missions.json inside the temp directory, never the real
 * one. No production code is touched or forked to achieve this — the
 * copied file's behavior is byte-identical to the real one.
 *
 * Extracted into a shared helper (rather than duplicated a 4th and 5th
 * time, as the 3 packaged test files already do independently) because
 * this mission explicitly permits "one shared test isolation helper IF
 * clearly beneficial" and two real, simultaneous consumers (40 and 43)
 * make that bar met here.
 *
 * Usage:
 *   const { buildIsolatedMissionMemory } = require("./_isolatedMissionMemory.helper.cjs");
 *   const iso = buildIsolatedMissionMemory();
 *   const memory = iso.memory; // use exactly like the real module
 *   // ... test body ...
 *   iso.cleanup(); // removes the entire temp directory
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const REAL_REPO_ROOT = path.join(__dirname, "..", "..");

/**
 * buildIsolatedMissionMemory()
 * Returns { memory, root, missionsFile, cleanup() }.
 * `memory` is a require()'d COPY of the real missionMemory.cjs module,
 * loaded from an isolated temp directory — same public API, same
 * behavior, writes only to its own isolated data/missions.json.
 */
function buildIsolatedMissionMemory() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mm-iso-"));
    fs.mkdirSync(path.join(root, "backend", "services"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend", "utils"), { recursive: true });
    fs.mkdirSync(path.join(root, "data"), { recursive: true });

    const missionMemoryPath = path.join(root, "backend", "services", "missionMemory.cjs");
    fs.copyFileSync(
        path.join(REAL_REPO_ROOT, "backend", "services", "missionMemory.cjs"),
        missionMemoryPath
    );
    fs.copyFileSync(
        path.join(REAL_REPO_ROOT, "backend", "utils", "logger.js"),
        path.join(root, "backend", "utils", "logger.js")
    );

    // Each call gets a genuinely fresh require() — the isolated copy lives
    // at a unique temp path every time, so Node's own module cache never
    // returns a stale instance across separate buildIsolatedMissionMemory()
    // calls within the same test process.
    const memory = require(missionMemoryPath);

    return {
        memory,
        root,
        missionMemoryPath,
        missionsFile: path.join(root, "data", "missions.json"),
        cleanup() {
            delete require.cache[require.resolve(missionMemoryPath)];
            try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
        },
    };
}

module.exports = { buildIsolatedMissionMemory };
