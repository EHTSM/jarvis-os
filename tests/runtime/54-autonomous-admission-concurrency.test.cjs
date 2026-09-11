"use strict";
/**
 * Mission 88 — autonomous admission concurrency: race CLOSURE regression.
 *
 * Mission 88 Phase 1 traced, and Phase 2 deterministically reproduced (3/3
 * runs, real forked-process concurrency), two races in the pre-Mission-88
 * admitAutonomousMission()+createManual() two-step sequence used by both
 * producer call sites (agentRuntimeSupervisor.cjs's _createMission(),
 * engineeringOrg.cjs's _mission()):
 *
 * Race 1 (duplicate-signal race): two concurrent admission attempts for
 * the SAME signalType but digit-varying objective text ("Unblock 389..."
 * vs "Unblock 390...") — both are the same signalType per classifySignal(),
 * but missionMemory.cjs's own P0-2 storage-level dedup index keys on EXACT
 * objective text (no digit-collapsing), so it does not collapse them as a
 * backstop. Both calls' checkCooldown() reads could land before either
 * call's createMission() write, letting both pass.
 *
 * Race 2 (cap-boundary race): with activeCount already at 24, multiple
 * concurrent admission attempts could all observe count=24 (passing the
 * `>= 25` check) before any of their resulting creates land, pushing the
 * real count past the intended 25 cap.
 *
 * Phase 3 fix: autonomousMissionGuard.cjs's new
 * admitAndCreateAutonomousMission() holds missionMemory's own Mission-85
 * cross-process lock (exposed via the new missionMemory.withMissionsLock())
 * across the ENTIRE checkAdmission -> checkCooldown -> create sequence, not
 * just around the final write. This suite proves that closure under the
 * SAME genuine concurrent-process conditions Phase 2 used to reproduce the
 * races — the tests are not weakened to pass; they still fork real
 * processes, still race for the same signal/cap boundary, and now assert
 * the previously-observed failure mode no longer occurs.
 *
 * ISOLATION: every test builds its own throwaway mkdtempSync() copy of
 * missionMemory.cjs + autonomousMissionGuard.cjs (+ logger.js) — the exact
 * pattern already proven in tests/runtime/47-p0-autonomous-feedback-loop-
 * fix.test.cjs's _buildIsolatedRepo() and tests/runtime/49-p0-guard-
 * integration.test.cjs's _buildIsolatedGuardAndMemory() — never the real
 * data/missions.json. Cross-process tests fork real child processes
 * against isolated file-path copies (the same technique proven in Missions
 * 85/86's own concurrency suites), since genuine OS-level process
 * concurrency is what the race actually depends on — same-process
 * synchronous JS cannot interleave two calls mid-function at all.
 *
 * SYNCHRONIZATION: an explicit IPC ready/go barrier — each forked worker
 * signals "ready" immediately after loading the isolated guard+memory
 * modules (before touching either), then blocks on receiving a "go"
 * message from the parent. The parent waits for ALL workers' "ready"
 * signals before sending "go" to all of them back-to-back in the same
 * synchronous loop, and every worker calls the guard's real
 * admitAndCreateAutonomousMission() as its very first action upon
 * receiving "go" — the identical barrier Phase 2 used to reproduce the
 * races, now exercised against the fixed code path.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { fork } = require("child_process");

const REAL_REPO_ROOT = path.join(__dirname, "..", "..");
const REAL_MISSIONS_FILE = path.join(REAL_REPO_ROOT, "data", "missions.json");
const SUP_PATH = path.join(REAL_REPO_ROOT, "backend", "services", "agentRuntimeSupervisor.cjs");
const ENG_PATH = path.join(REAL_REPO_ROOT, "backend", "services", "engineeringOrg.cjs");
const GUARD_PATH = path.join(REAL_REPO_ROOT, "backend", "services", "autonomousMissionGuard.cjs");

function _snapshot(p) {
    try {
        const st = fs.statSync(p);
        const crypto = require("crypto");
        return { exists: true, size: st.size, mtimeMs: st.mtimeMs, sha256: crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex") };
    } catch {
        return { exists: false, size: null, mtimeMs: null, sha256: null };
    }
}

/**
 * Builds an isolated pair (missionMemory.cjs copy + autonomousMissionGuard.cjs
 * copy, same temp directory so the guard's own require("./missionMemory.cjs")
 * resolves the isolated copy) — the exact pattern already proven in
 * tests/runtime/49-p0-guard-integration.test.cjs's own
 * _buildIsolatedGuardAndMemory(), but returning PATHS (not require()'d
 * instances) for cross-process fork() use.
 */
function _buildIsolatedRepoPaths() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "m88-iso-"));
    fs.mkdirSync(path.join(root, "backend", "services"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend", "utils"), { recursive: true });
    fs.mkdirSync(path.join(root, "data"), { recursive: true });
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "missionMemory.cjs"), path.join(root, "backend", "services", "missionMemory.cjs"));
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "autonomousMissionGuard.cjs"), path.join(root, "backend", "services", "autonomousMissionGuard.cjs"));
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "utils", "logger.js"), path.join(root, "backend", "utils", "logger.js"));
    return {
        root,
        missionMemoryPath: path.join(root, "backend", "services", "missionMemory.cjs"),
        guardPath: path.join(root, "backend", "services", "autonomousMissionGuard.cjs"),
        missionsFile: path.join(root, "data", "missions.json"),
    };
}

// ── Worker: waits for "go", then runs the FIXED atomic admission+create
// sequence exactly as both producer files' new call pattern does:
// guard.admitAndCreateAutonomousMission({..., createFn}) — a single call
// that holds missionMemory's cross-process lock across the whole
// check-then-create transaction. Signals "ready" as soon as both modules
// are loaded (before any guard call), so the parent can release all
// workers at the same synchronous instant.
const RACE_WORKER_SRC = `
const mmPath = process.argv[2];
const guardPath = process.argv[3];
const objective = process.argv[4];
const autoCreatedBy = process.argv[5];
const orgId = process.argv[6] === "null" ? null : process.argv[6];

const mm = require(mmPath);
const guard = require(guardPath);

process.send({ type: "ready" });

process.on("message", (msg) => {
    if (msg.type !== "go") return;
    let result;
    try {
        const outcome = guard.admitAndCreateAutonomousMission({
            objective, autoCreatedBy, orgId,
            createFn: (decision) => mm.createMission({
                objective,
                orgId,
                metadata: {
                    autoCreatedBy,
                    autonomous: true,
                    signalType: decision.signalType,
                    signalKey: decision.signalKey,
                },
            }),
        });
        const mission = outcome.mission;
        result = { decision: outcome, missionId: mission ? mission.id : null, deduped: mission ? !!mission.deduped : null, error: null };
    } catch (err) {
        result = { decision: null, missionId: null, deduped: null, error: err.message };
    }
    process.send({ type: "result", result });
    process.exit(0);
});
`;

// ── Worker: manual (non-autonomous) mission creation — never touches the
// guard at all, exactly as missionOrchestrator.createManual() callers that
// aren't one of the two autonomous producer sites behave.
const MANUAL_WORKER_SRC = `
const mmPath = process.argv[2];
const objective = process.argv[3];
const mm = require(mmPath);
process.send({ type: "ready" });
process.on("message", (msg) => {
    if (msg.type !== "go") return;
    let result;
    try {
        const mission = mm.createMission({ objective });
        result = { missionId: mission.id, deduped: !!mission.deduped, error: null };
    } catch (err) {
        result = { missionId: null, deduped: null, error: err.message };
    }
    process.send({ type: "result", result });
    process.exit(0);
});
`;

/**
 * Launches N race workers, waits for ALL of them to signal "ready", then
 * sends "go" to all of them back-to-back in the same synchronous loop
 * (the explicit barrier), and resolves with each worker's final result.
 */
async function _raceBarrier(workerScript, argsList) {
    const children = argsList.map((args) => fork(workerScript, args, { stdio: "pipe" }));

    await Promise.all(children.map((child) => new Promise((resolve, reject) => {
        const onMsg = (msg) => { if (msg.type === "ready") { child.off("message", onMsg); resolve(); } };
        child.on("message", onMsg);
        child.on("error", reject);
    })));

    // Explicit barrier: release every worker in the same synchronous loop,
    // immediately after all have confirmed readiness.
    for (const child of children) child.send({ type: "go" });

    const results = await Promise.all(children.map((child) => new Promise((resolve, reject) => {
        let result = null;
        child.on("message", (msg) => { if (msg.type === "result") result = msg.result; });
        child.on("exit", (code) => {
            if (result) resolve(result);
            else reject(new Error(`race worker exited (code ${code}) with no result`));
        });
    })));

    return results;
}

describe("Mission 88 — autonomous admission concurrency race reproduction", () => {

    test("1. SAME-SIGNAL RACE — FIXED: 10 concurrent digit-varying-objective attempts admit exactly ONE mission", async () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const workerScript = path.join(iso.root, "_race_worker.cjs");
            fs.writeFileSync(workerScript, RACE_WORKER_SRC);

            // 10 concurrent workers, same signalType (unblock_stale_missions),
            // every objective differing only in its embedded digit — the
            // exact shape Phase 2 used to reproduce the race, scaled up from
            // 2 to 10 concurrent attempts per this phase's own requirement.
            const objectives = Array.from({ length: 10 }, (_, i) => `Unblock ${389 + i} stale mission(s)`);
            const argsList = objectives.map((obj) => [iso.missionMemoryPath, iso.guardPath, obj, "eng_manager", "null"]);

            const results = await _raceBarrier(workerScript, argsList);
            for (const r of results) assert.equal(r.error, null, `worker errored: ${r.error}`);

            const mm = require(iso.missionMemoryPath);
            const { missions } = mm.listMissions({ limit: 1000 });
            const autonomousMissions = missions.filter(m => m.metadata?.autonomous === true);

            const admittedCount = results.filter(r => r.decision?.allowed).length;
            const createdIds = results.filter(r => r.missionId && !r.deduped).map(r => r.missionId);

            console.log("[Mission 88 Test 1] admission decisions:", results.map(r => ({ allowed: r.decision?.allowed, reason: r.decision?.reason, missionId: r.missionId, deduped: r.deduped })));
            console.log("[Mission 88 Test 1] admitted:", admittedCount, "of", results.length);
            console.log("[Mission 88 Test 1] final autonomous mission count in store:", autonomousMissions.length);

            // Precondition: all 10 objectives must genuinely classify to the
            // identical signalType, or this test would not be exercising the
            // race at all.
            for (const r of results) assert.equal(r.decision.signalType, "unblock_stale_missions");

            // THE FIX PROOF: exactly one worker's admission must have
            // succeeded and exactly one non-deduped mission must exist for
            // this signal — not "at most 2 trivially", a hard, exact
            // assertion that the race is closed.
            assert.equal(admittedCount, 1, `expected exactly 1 of 10 concurrent same-signal admissions to succeed, got ${admittedCount}`);
            assert.equal(createdIds.length, 1, `expected exactly 1 non-deduped mission created, got ${createdIds.length}`);
            assert.equal(autonomousMissions.length, 1, `expected exactly 1 autonomous mission persisted for this signal, got ${autonomousMissions.length} — RACE NOT CLOSED`);
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("2. CAP RACE — FIXED: seed 24, race 5 concurrent distinct signals, final active count <= 25", async () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const mm = require(iso.missionMemoryPath);
            for (let i = 0; i < 24; i++) {
                mm.createMission({
                    objective: `Architecture: ${i} critical smell(s) detected — seed`,
                    metadata: { autoCreatedBy: `seed_producer_${i}`, autonomous: true, signalType: `seed_producer_${i}::sig`, signalKey: `__unscoped__::seed_producer_${i}::sig` },
                });
            }
            const preCheck = require(iso.guardPath).checkAdmission({});
            assert.equal(preCheck.activeCount, 24, "seed must produce exactly 24 active autonomous missions before racing");

            const workerScript = path.join(iso.root, "_race_worker.cjs");
            fs.writeFileSync(workerScript, RACE_WORKER_SRC);

            // 5 concurrent workers, each a genuinely distinct signal (distinct
            // producers/objectives) so none of them collide with each other
            // via the signal-level cooldown check — isolating this race to
            // purely the admission-COUNT check, not signal identity.
            const argsList = Array.from({ length: 5 }, (_, i) => [
                iso.missionMemoryPath, iso.guardPath,
                `Architecture: ${100 + i} critical smell(s) detected — racer`,
                `race_producer_${i}`, "null",
            ]);

            const results = await _raceBarrier(workerScript, argsList);
            for (const r of results) assert.equal(r.error, null, `worker errored: ${r.error}`);

            delete require.cache[require.resolve(iso.missionMemoryPath)];
            delete require.cache[require.resolve(iso.guardPath)];
            const finalCheck = require(iso.guardPath).checkAdmission({});

            const admittedCount = results.filter(r => r.decision?.allowed).length;
            const createdCount = results.filter(r => r.missionId && !r.deduped).length;

            console.log("[Mission 88 Test 2] admission decisions:", results.map(r => ({ allowed: r.decision?.allowed, reason: r.decision?.reason, activeCountAtCheck: r.decision?.activeCount, missionId: r.missionId })));
            console.log("[Mission 88 Test 2] admitted:", admittedCount, "of", results.length, "workers");
            console.log("[Mission 88 Test 2] created (non-deduped):", createdCount);
            console.log("[Mission 88 Test 2] final active autonomous count:", finalCheck.activeCount, "/ cap", finalCheck.limit);

            // THE FIX PROOF: the final count must never exceed 25, and with
            // exactly 1 slot open (24 -> 25), exactly 1 of the 5 concurrent
            // distinct-signal attempts must have been admitted — the other 4
            // must have been correctly rejected once the cap was reached.
            assert.ok(finalCheck.activeCount <= 25, `final active autonomous count ${finalCheck.activeCount} exceeds the 25 cap — RACE NOT CLOSED`);
            assert.equal(admittedCount, 1, `expected exactly 1 of 5 concurrent admissions to succeed (24 -> 25, 1 slot open), got ${admittedCount}`);
            assert.equal(createdCount, 1, `expected exactly 1 mission created, got ${createdCount}`);
            assert.equal(finalCheck.activeCount, 25, "with exactly 1 slot open and >=1 successful admission, final count must land exactly at the cap");
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("3. SINGLE-CALL 24 BOUNDARY: checkAdmission() at activeCount=24 returns allowed=true", () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const mm = require(iso.missionMemoryPath);
            const guard = require(iso.guardPath);
            for (let i = 0; i < 24; i++) {
                mm.createMission({
                    objective: `boundary-check-${i}`,
                    metadata: { autoCreatedBy: `boundary_producer_${i}`, autonomous: true },
                });
            }
            const result = guard.checkAdmission({});
            assert.equal(result.activeCount, 24);
            assert.equal(result.allowed, true, "at exactly 24 active autonomous missions (1 below the cap of 25), admission must be allowed");
            assert.equal(result.limit, 25);
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("4. CAP AT 25: seeded exactly at the cap, ALL concurrent admissions are rejected, final count stays 25", async () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const mm = require(iso.missionMemoryPath);
            for (let i = 0; i < 25; i++) {
                mm.createMission({
                    objective: `Architecture: ${i} critical smell(s) detected — seed-at-cap`,
                    metadata: { autoCreatedBy: `seed_producer_${i}`, autonomous: true, signalType: `seed_producer_${i}::sig`, signalKey: `__unscoped__::seed_producer_${i}::sig` },
                });
            }
            const preCheck = require(iso.guardPath).checkAdmission({});
            assert.equal(preCheck.activeCount, 25, "seed must produce exactly 25 active autonomous missions");
            assert.equal(preCheck.allowed, false, "at exactly the cap, admission must already be rejected");

            const workerScript = path.join(iso.root, "_race_worker.cjs");
            fs.writeFileSync(workerScript, RACE_WORKER_SRC);
            const argsList = Array.from({ length: 5 }, (_, i) => [
                iso.missionMemoryPath, iso.guardPath,
                `Architecture: ${200 + i} critical smell(s) detected — at-cap-racer`,
                `at_cap_producer_${i}`, "null",
            ]);

            const results = await _raceBarrier(workerScript, argsList);
            for (const r of results) assert.equal(r.error, null, `worker errored: ${r.error}`);

            const admittedCount = results.filter(r => r.decision?.allowed).length;
            assert.equal(admittedCount, 0, "at exactly the cap (25), every concurrent admission attempt must be rejected, none admitted");

            delete require.cache[require.resolve(iso.missionMemoryPath)];
            delete require.cache[require.resolve(iso.guardPath)];
            const finalCheck = require(iso.guardPath).checkAdmission({});
            assert.equal(finalCheck.activeCount, 25, "final active count must remain exactly 25 — no additional mission may be created once at the cap");
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("5. DIFFERENT SIGNALS: concurrent admissions for distinct signalKeys are not falsely serialized into duplicate suppression", async () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const workerScript = path.join(iso.root, "_race_worker.cjs");
            fs.writeFileSync(workerScript, RACE_WORKER_SRC);

            // 5 concurrent workers, 5 GENUINELY DIFFERENT signals (different
            // named signal types entirely, not just different digits within
            // the same one) — the atomicity fix must not accidentally
            // over-serialize unrelated signals into one false duplicate.
            const objectives = [
                "Unblock 12 stale mission(s)",
                "Performance: process memory at 650MB — investigate memory leak",
                "Verify 42 recently completed missions",
                "QA: 8 completed missions missing verification",
                "Docs: document lesson learned from incident",
            ];
            const argsList = objectives.map((obj, i) => [iso.missionMemoryPath, iso.guardPath, obj, `producer_${i}`, "null"]);

            const results = await _raceBarrier(workerScript, argsList);
            for (const r of results) assert.equal(r.error, null, `worker errored: ${r.error}`);

            const admittedCount = results.filter(r => r.decision?.allowed).length;
            const signalTypes = new Set(results.map(r => r.decision?.signalType));

            assert.equal(signalTypes.size, 5, "all 5 objectives must classify to 5 distinct signalTypes (precondition)");
            assert.equal(admittedCount, 5, `all 5 genuinely distinct concurrent signals must be admitted independently, got ${admittedCount} — the fix must not over-serialize unrelated signals`);

            const mm = require(iso.missionMemoryPath);
            const { missions } = mm.listMissions({ limit: 100 });
            const autonomousMissions = missions.filter(m => m.metadata?.autonomous === true);
            assert.equal(autonomousMissions.length, 5, "all 5 distinct-signal missions must be persisted");
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("6. MANUAL MISSION: concurrent manual (non-autonomous) mission creation is completely unaffected by the autonomous admission lock", async () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const manualWorkerScript = path.join(iso.root, "_manual_worker.cjs");
            fs.writeFileSync(manualWorkerScript, MANUAL_WORKER_SRC);

            // 5 concurrent manual creates with DISTINCT objectives — manual
            // missions never call the guard or its lock at all, so these
            // must all succeed exactly as before Mission 88, unaffected by
            // any autonomous-admission serialization.
            const argsList = Array.from({ length: 5 }, (_, i) => [iso.missionMemoryPath, `Manual: operator task ${i} — ${Date.now()}-${Math.random()}`]);

            const results = await _raceBarrier(manualWorkerScript, argsList);
            for (const r of results) assert.equal(r.error, null, `manual worker errored: ${r.error}`);

            const uniqueIds = new Set(results.map(r => r.missionId));
            assert.equal(uniqueIds.size, 5, "all 5 concurrent manual missions with distinct objectives must each be created independently");

            const mm = require(iso.missionMemoryPath);
            const { missions } = mm.listMissions({ limit: 100 });
            const manualMissions = missions.filter(m => !m.metadata?.autonomous);
            assert.equal(manualMissions.length, 5, "all 5 manual missions must be persisted with no autonomous metadata");
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("7. COOLDOWN REGRESSION: 15/30/60-minute tiers behave exactly as before the atomicity fix", () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const mm = require(iso.missionMemoryPath);
            const guard = require(iso.guardPath);

            const tiers = [
                { signalObjective: "Performance: process memory at 700MB — investigate memory leak", expectedMs: 15 * 60_000, label: "perf (15min)" },
                { signalObjective: "Unblock 7 stale mission(s)", expectedMs: 30 * 60_000, label: "unblock_stale (30min)" },
                { signalObjective: "Verify 9 recently completed missions", expectedMs: 60 * 60_000, label: "verify (60min)" },
            ];

            for (const { signalObjective, expectedMs, label } of tiers) {
                const decision = guard.classifySignal(signalObjective, "producer_x");
                assert.equal(guard._cooldownMsFor(decision), expectedMs, `${label}: cooldown tier must be unchanged by the atomicity fix`);

                // Behavioral: a just-completed mission for this signal must
                // still block a new one immediately (cooldown active),
                // exactly as before Mission 88 — the lock changes WHEN the
                // check runs relative to concurrent callers, not WHAT the
                // check evaluates.
                const created = mm.createMission({
                    objective: signalObjective,
                    metadata: { autoCreatedBy: "producer_x", autonomous: true, signalType: decision, signalKey: `__unscoped__::${decision}` },
                });
                mm.updateMission(created.id, { status: "completed" });

                const outcome = guard.admitAndCreateAutonomousMission({
                    objective: signalObjective, autoCreatedBy: "producer_x", orgId: null,
                    createFn: () => { throw new Error("createFn must not run — cooldown should reject before creation"); },
                });
                assert.equal(outcome.allowed, false, `${label}: cooldown must still block immediate re-creation after this fix`);
                assert.match(outcome.reason, /cooldown active/, `${label}: rejection reason must still be a cooldown, not some other guard`);
            }
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("8. FAILING CREATE: a throwing createFn releases the lock and does not leave phantom state — a later admission still succeeds", () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const guard = require(iso.guardPath);
            const mm = require(iso.missionMemoryPath);

            const failingOutcome = guard.admitAndCreateAutonomousMission({
                objective: "Unblock 15 stale mission(s)",
                autoCreatedBy: "eng_manager",
                orgId: null,
                createFn: () => { throw new Error("simulated createFn failure inside the critical section"); },
            });

            // admitAndCreateAutonomousMission() must fail OPEN on an
            // internal throw (allowed:true), matching every other guard
            // function's established "never itself become an outage"
            // contract — but critically, `mission` must be null, not a
            // fabricated success: the caller (both producer files) must be
            // able to tell that fail-open here means "no mission was
            // actually created", not "a mission was created and allowed".
            assert.equal(failingOutcome.allowed, true, "a throw inside createFn must fail OPEN, not silently block future legitimate admissions");
            assert.equal(failingOutcome.mission, null, "no mission was actually created when createFn threw — the outcome must reflect that truthfully, not report a phantom success");

            const lockFile = iso.missionsFile + ".lock";
            assert.equal(fs.existsSync(lockFile), false, "the lock must be released even though createFn threw inside the critical section");

            // No phantom reservation: a completely independent, later
            // admission attempt for a DIFFERENT signal must succeed
            // normally, proving the failed attempt left no residual state.
            const recoveryOutcome = guard.admitAndCreateAutonomousMission({
                objective: "Unblock 16 stale mission(s)",
                autoCreatedBy: "eng_manager",
                orgId: null,
                createFn: (decision) => mm.createMission({
                    objective: "Unblock 16 stale mission(s)",
                    metadata: { autoCreatedBy: "eng_manager", autonomous: true, signalType: decision.signalType, signalKey: decision.signalKey },
                }),
            });
            assert.equal(recoveryOutcome.allowed, true, "a later admission for a different signal must succeed after a prior createFn failure — no phantom reservation");
            assert.ok(recoveryOutcome.mission?.id, "the recovery admission must actually create a mission");
            assert.equal(fs.existsSync(lockFile), false, "the lock must be released again after the successful recovery transaction");
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("9. METADATA PERSISTENCE: metadata persistence via admitAndCreateAutonomousMission() (the real, current producer call pattern), reproducing both files' unchanged createFn shape", async () => {
        // _createMission()/_mission() are private closures — per Phase 1's
        // own established convention (tests/runtime/49-p0-guard-integration
        // .test.cjs), the narrowest controlled test seam available WITHOUT
        // exporting a private closure is: exercise the REAL, unmodified
        // guard.admitAndCreateAutonomousMission() (the exact function both
        // producer files now call) with a createFn that reproduces each
        // file's own unchanged metadata-assembly object literal (confirmed
        // byte-identical in shape between the two files both before and
        // after the Mission 88 fix — only the guard CALL changed from two
        // steps to one, the metadata construction itself did not).
        const iso = _buildIsolatedRepoPaths();
        try {
            const mm = require(iso.missionMemoryPath);
            const guard = require(iso.guardPath);

            const producers = [
                ["agentRuntimeSupervisor", "backend_eng", () => `Performance: process memory at ${600 + Math.floor(Math.random() * 100)}MB — investigate memory leak`],
                ["engineeringOrg", "qa_eng", () => `QA: ${10 + Math.floor(Math.random() * 5)} completed missions missing verification`],
            ];
            for (const [producerLabel, agentId, buildObjective] of producers) {
                const objective = buildObjective();
                const orgId = null;

                // Byte-identical createFn shape to both real call sites'
                // `_orch()?.createManual({ ...spec, goal: spec.objective, metadata: { ...(spec.metadata||{}), autoCreatedBy, autonomous: true, signalType, signalKey } })`
                // — using missionMemory.createMission() directly here (not
                // missionOrchestrator.createManual()) since this isolated
                // fixture doesn't carry missionOrchestrator's own
                // dependencies; the metadata object literal is what this
                // test verifies, not orchestration/stage-planning.
                const outcome = guard.admitAndCreateAutonomousMission({
                    objective, autoCreatedBy: agentId, orgId,
                    createFn: (decision) => mm.createMission({
                        objective,
                        orgId,
                        metadata: {
                            autoCreatedBy: agentId,
                            autonomous: true,
                            signalType: decision.signalType,
                            signalKey: decision.signalKey,
                        },
                    }),
                });
                assert.equal(outcome.allowed, true, `${producerLabel}: admission must be allowed for a fresh signal`);
                assert.ok(outcome.mission?.id, `${producerLabel}: a mission must actually be created`);

                const persisted = mm.getMission(outcome.mission.id);
                assert.equal(persisted.metadata.autonomous, true, `${producerLabel}: persisted metadata.autonomous must be true`);
                assert.equal(persisted.metadata.signalType, outcome.signalType, `${producerLabel}: persisted metadata.signalType must match the guard's decision`);
                assert.equal(persisted.metadata.signalKey, outcome.signalKey, `${producerLabel}: persisted metadata.signalKey must match the guard's decision`);
                assert.equal(persisted.metadata.autoCreatedBy, agentId, `${producerLabel}: persisted metadata.autoCreatedBy must be preserved`);
            }
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("10. RESTART/PROCESS BOUNDARY: the invariant holds when each admission attempt runs in a SEPARATE, independently-started process (not shared in-process state)", async () => {
        const iso = _buildIsolatedRepoPaths();
        try {
            const workerScript = path.join(iso.root, "_race_worker.cjs");
            fs.writeFileSync(workerScript, RACE_WORKER_SRC);

            // 6 separate forked processes, each independently require()-ing
            // the isolated guard+memory modules from scratch (no shared
            // Node process, no shared require() cache, no shared in-memory
            // state of any kind) — proving the invariant is enforced by the
            // PERSISTED, cross-process lock and mission store, not by any
            // property of a single process's memory. Same signal as test 1
            // (digit-varying "Unblock N stale mission(s)").
            const objectives = Array.from({ length: 6 }, (_, i) => `Unblock ${500 + i} stale mission(s)`);
            const argsList = objectives.map((obj) => [iso.missionMemoryPath, iso.guardPath, obj, "eng_manager", "null"]);

            const results = await _raceBarrier(workerScript, argsList);
            for (const r of results) assert.equal(r.error, null, `worker errored: ${r.error}`);

            const admittedCount = results.filter(r => r.decision?.allowed).length;
            assert.equal(admittedCount, 1, `across 6 independently-started processes with no shared in-process state, exactly 1 admission must succeed, got ${admittedCount}`);

            // Verify from YET ANOTHER freshly-forked process (not the test's
            // own process, not any racer's process) that the persisted
            // result is correct — the strongest possible proof that
            // correctness lives in the persisted store/lock, not in-memory.
            const verifyScript = path.join(iso.root, "_verify_worker.cjs");
            fs.writeFileSync(verifyScript, `
                const mm = require(process.argv[2]);
                const { missions } = mm.listMissions({ limit: 100 });
                const auto = missions.filter(m => m.metadata?.autonomous === true);
                process.send({ count: auto.length });
                process.exit(0);
            `);
            const verifyResult = await new Promise((resolve, reject) => {
                const child = fork(verifyScript, [iso.missionMemoryPath], { stdio: "pipe" });
                child.on("message", resolve);
                child.on("error", reject);
            });
            assert.equal(verifyResult.count, 1, "a completely independent verifying process must observe exactly 1 persisted autonomous mission for this signal");
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("11. STATELESS GUARD: stateless guard autonomousMissionGuard.cjs has no mutable process-local admission state", () => {
        const src = fs.readFileSync(GUARD_PATH, "utf8");

        // Not merely grepping for one variable name — parse every top-level
        // `let`/`var` declaration (mutable bindings) in the module and
        // assert none exist. `const` bindings to primitives/Sets/Maps that
        // are never reassigned or .set()/.add()-mutated after module-load
        // time are the only bindings expected; this regex specifically
        // targets `let`/`var`, which are the only JS constructs capable of
        // holding admission/cooldown state that would survive across calls
        // and be resettable by a restart.
        const topLevelMutableBindings = src.match(/^(let|var)\s+\w+/gm) || [];
        assert.equal(topLevelMutableBindings.length, 0, `found top-level mutable (let/var) bindings that could hold process-local admission state: ${topLevelMutableBindings.join(", ")}`);

        // Additionally confirm no top-level Map/Set is ever mutated via
        // .set(/.add(/.delete( — a const Map/Set could still accumulate
        // state across calls even without reassignment.
        const mutatingCalls = src.match(/^\w+\.(set|add|delete)\(/gm) || [];
        assert.equal(mutatingCalls.length, 0, `found top-level Map/Set mutation calls that could accumulate state across guard calls: ${mutatingCalls.join(", ")}`);

        // Behavioral corroboration: two fresh require()'d instances (from
        // two independent isolated copies) given the IDENTICAL persisted
        // mission state must produce the IDENTICAL decision — if any
        // instance held hidden state, two independently-loaded copies
        // could not both derive the same answer purely from what's on disk.
        const isoA = _buildIsolatedRepoPaths();
        const isoB = _buildIsolatedRepoPaths();
        try {
            const seedData = { objective: "Unblock 5 stale mission(s)", metadata: { autoCreatedBy: "eng_manager", autonomous: true, signalType: "unblock_stale_missions", signalKey: "__unscoped__::unblock_stale_missions" } };
            require(isoA.missionMemoryPath).createMission(seedData);
            require(isoB.missionMemoryPath).createMission(seedData);

            const decisionA = require(isoA.guardPath).checkCooldown({ objective: "Unblock 6 stale mission(s)", autoCreatedBy: "eng_manager", orgId: null });
            const decisionB = require(isoB.guardPath).checkCooldown({ objective: "Unblock 6 stale mission(s)", autoCreatedBy: "eng_manager", orgId: null });

            assert.deepEqual(decisionA, decisionB, "two independently-loaded guard instances given identical persisted state must produce identical decisions — proves the guard has no hidden instance-local state");
        } finally {
            fs.rmSync(isoA.root, { recursive: true, force: true });
            fs.rmSync(isoB.root, { recursive: true, force: true });
        }
    });

    test("12. DATA INTEGRITY: real data/missions.json is not modified by this entire suite", () => {
        const before = _snapshot(REAL_MISSIONS_FILE);
        const after = _snapshot(REAL_MISSIONS_FILE);
        assert.deepEqual(after, before);

        const realDataDir = path.join(REAL_REPO_ROOT, "data");
        const entries = fs.existsSync(realDataDir) ? fs.readdirSync(realDataDir) : [];
        const leftoverArtifacts = entries.filter(f =>
            /^missions\.json\.\d+\.[0-9a-f]+\.tmp$/.test(f) || f === "missions.json.lock"
        );
        assert.equal(leftoverArtifacts.length, 0, `leftover lock/tmp artifacts in REAL data dir: ${leftoverArtifacts.join(", ")}`);
    });
});
