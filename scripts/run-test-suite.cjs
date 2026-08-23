"use strict";
/**
 * Mission 42 — test-only isolation for tests/runtime and tests/security.
 *
 * Root cause (Mission 41 audit, re-confirmed live this mission): Node's
 * `node --test` runner isolates each test FILE into its own OS process by
 * default (`--test-isolation=process`) and runs multiple such processes
 * concurrently (up to os.availableParallelism()). A small number of test
 * files call missionMemory.cjs's mutating API (createMission/updateMission/
 * etc., directly or via missionOrchestrator.cjs) against the real, shared
 * data/missions.json. missionMemory.cjs's own read-modify-write cycle has
 * no cross-process coordination (Mission 41: proven, reproducible lost-
 * update race), so when two of these files' child processes run at the same
 * time, one process's mission write can silently vanish — a false test
 * failure with nothing wrong in the code under test.
 *
 * This script does NOT touch missionMemory.cjs or any production code. It
 * only changes HOW the existing test files are invoked: the small set of
 * files that mutate real mission state run sequentially (one OS process at
 * a time, so there is never a second writer to race against), while every
 * other file in the suite keeps running with Node's normal parallel
 * isolation, unaffected.
 *
 * Usage: node scripts/run-test-suite.cjs <runtime|security>
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// Files confirmed (Mission 42 audit) to call missionMemory.cjs's mutating
// API — directly, or indirectly via missionOrchestrator.cjs's
// createManual()/_queue() (which itself calls missionMemory.createMission).
// Read-only mission consumers (getMission/listMissions/getMissionStats) are
// NOT included — only files that WRITE to the shared data/missions.json
// need serialization, since Node's single-threaded event loop already makes
// same-process calls safe (Mission 41 §6) and read-only calls have nothing
// to lose to a concurrent writer beyond a normal transient read, which none
// of these tests assert an exact-count invariant against.
const MISSION_MUTATING = {
    runtime: [
        "tests/runtime/10-c10-cross-system-closure.test.cjs",
        "tests/runtime/40-mission-dedup-and-recovery.test.cjs",
        "tests/runtime/approval-queue-engine.test.cjs",
        "tests/runtime/mission-orchestrator-nodetypes.test.cjs",
    ],
    security: [
        "tests/security/13-mission-memory-race-verification.cjs",
        "tests/security/18-mission-runtime-lifecycle.cjs",
        "tests/security/52-runtime-stability-fixes.cjs",
    ],
};

const SUITES = {
    runtime: {
        dir: "tests/runtime",
        glob: (f) => f.endsWith(".test.cjs"),
    },
    security: {
        dir: "tests/security",
        glob: (f) => /^\d/.test(f) && f.endsWith(".cjs"),
    },
};

function run(args) {
    const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit" });
    if (result.error) throw result.error;
    return result.status ?? 1;
}

function main() {
    const suiteName = process.argv[2];
    const suite = SUITES[suiteName];
    if (!suite) {
        console.error(`Usage: node scripts/run-test-suite.cjs <${Object.keys(SUITES).join("|")}>`);
        process.exit(2);
    }

    const mutating = new Set(MISSION_MUTATING[suiteName].map((p) => path.join(ROOT, p)));
    const allFiles = fs.readdirSync(path.join(ROOT, suite.dir))
        .filter(suite.glob)
        .map((f) => path.join(ROOT, suite.dir, f))
        .sort();

    // Sanity check: every file this script intends to serialize must still
    // exist. If one was renamed/removed, fail loudly rather than silently
    // serializing nothing (which would quietly reintroduce the race).
    for (const m of mutating) {
        if (!allFiles.includes(m)) {
            console.error(`[run-test-suite] Expected mission-mutating file not found: ${path.relative(ROOT, m)}`);
            console.error(`[run-test-suite] It may have been renamed or removed — update MISSION_MUTATING in this script.`);
            process.exit(2);
        }
    }

    const parallelFiles = allFiles.filter((f) => !mutating.has(f));
    const serialFiles = allFiles.filter((f) => mutating.has(f));

    console.log(`[run-test-suite] ${suiteName}: ${parallelFiles.length} file(s) parallel, ${serialFiles.length} file(s) serialized (mission-store writers)`);

    // Parallel group first — unaffected by this change, same behavior as
    // the previous single `node --test <glob>` invocation for these files.
    const parallelStatus = parallelFiles.length
        ? run(["--test", ...parallelFiles])
        : 0;

    // Serialized group — one OS process at a time (--test-concurrency=1),
    // so no two of these files' real writes to data/missions.json can ever
    // overlap in wall-clock time.
    const serialStatus = serialFiles.length
        ? run(["--test", "--test-concurrency=1", ...serialFiles])
        : 0;

    process.exit(parallelStatus !== 0 || serialStatus !== 0 ? 1 : 0);
}

main();
