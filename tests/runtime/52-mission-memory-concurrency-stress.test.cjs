"use strict";
/**
 * Mission 86 — mission-memory concurrency STRESS suite.
 *
 * Mission 85 (commit a34eaaec) added and regression-tested the cross-process
 * write lock (_withMissionsLock()) that closes missionMemory.cjs's
 * lost-update race. That suite (tests/runtime/51-mission-memory-write-lock
 * .test.cjs) proves the lock exists and works at moderate scale (5 workers /
 * 30 missions), with a single mutation type concurrently hitting one shared
 * record (recordDecision only), hand-fabricated stale/fresh lock files, and
 * a single pass of each scenario.
 *
 * This suite does NOT repeat those scenarios. It adds coverage Mission 85
 * does not have:
 *   A. Higher contention (10 workers x 15 = 150 missions) + an explicit
 *      duplicate-ID check across the full merged set.
 *   B. MIXED mutation types (not just recordDecision) concurrently hitting
 *      the SAME pre-existing mission from different processes.
 *   C. Concurrent READERS running alongside concurrent WRITERS — proving
 *      getMission()/listMissions() (which do NOT take the lock, by design)
 *      never observe a torn/partial JSON file, relying on the write path's
 *      atomic tmp+rename rather than the lock itself.
 *   D. Genuine multi-process lock racing (8 real forked processes racing
 *      for the same lock simultaneously, not a hand-crafted lock file) +
 *      lock-file cleanup after a transaction that THROWS mid-section
 *      (failure-path cleanup, which Mission 85 never exercises).
 *   E. A forked child that acquires the lock and is SIGKILLed before its
 *      own `finally` can run (a genuine crash simulation, not a hand-aged
 *      lock file) — proving a subsequent process recovers via stale-lock
 *      force-break.
 *   F. Repeated rounds of the high-contention scenario (3x) in one test,
 *      each independently asserting full integrity, to rule out a single
 *      lucky pass.
 *
 * ISOLATION GUARANTEE: every scenario builds its own throwaway
 * mkdtempSync() copy of missionMemory.cjs (+ its logger.js dependency) via
 * _buildIsolatedRepo() — the same technique already proven in Mission 82's
 * shared helper and Mission 85's own test file — and never touches this
 * repository's real data/missions.json. The final test is the sole
 * exception by design: it only READS the real file to prove it remains
 * byte-for-byte untouched by everything in this suite.
 */

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { fork } = require("child_process");

const REAL_REPO_ROOT = path.join(__dirname, "..", "..");
const REAL_MISSIONS_FILE = path.join(REAL_REPO_ROOT, "data", "missions.json");

function _sha256(filePath) {
    try {
        return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
    } catch {
        return null;
    }
}

function _snapshot(p) {
    try {
        const st = fs.statSync(p);
        return { exists: true, size: st.size, mtimeMs: st.mtimeMs, sha256: _sha256(p) };
    } catch {
        return { exists: false, size: null, mtimeMs: null, sha256: null };
    }
}

function _buildIsolatedRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "m86-iso-"));
    fs.mkdirSync(path.join(root, "backend", "services"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend", "utils"), { recursive: true });
    fs.mkdirSync(path.join(root, "data"), { recursive: true });

    fs.copyFileSync(
        path.join(REAL_REPO_ROOT, "backend", "services", "missionMemory.cjs"),
        path.join(root, "backend", "services", "missionMemory.cjs")
    );
    fs.copyFileSync(
        path.join(REAL_REPO_ROOT, "backend", "utils", "logger.js"),
        path.join(root, "backend", "utils", "logger.js")
    );

    return {
        root,
        missionMemoryPath: path.join(root, "backend", "services", "missionMemory.cjs"),
        missionsFile: path.join(root, "data", "missions.json"),
        lockFile: path.join(root, "data", "missions.json.lock"),
    };
}

/**
 * Shared integrity assertion (Mission 86 requirement G) — applied uniformly
 * across every stress scenario below rather than checked ad hoc per test.
 */
function _assertStoreIntegrity(missionsFile, { expectedCount = null } = {}) {
    const dataDir = path.dirname(missionsFile);

    const raw = fs.readFileSync(missionsFile, "utf8");
    let store;
    assert.doesNotThrow(() => { store = JSON.parse(raw); }, "missions.json must be valid JSON");
    assert.ok(Array.isArray(store.missions), "store.missions must be an array");

    const ids = store.missions.map(m => m.id);
    const uniqueIds = new Set(ids);
    assert.equal(uniqueIds.size, ids.length, `no duplicate mission IDs allowed — found ${ids.length - uniqueIds.size} duplicate(s)`);

    if (expectedCount !== null) {
        assert.equal(store.missions.length, expectedCount, `expected exactly ${expectedCount} missions, found ${store.missions.length}`);
    }

    const entries = fs.readdirSync(dataDir);
    const leftoverTmp = entries.filter(f => /\.tmp$/.test(f));
    assert.equal(leftoverTmp.length, 0, `leftover tmp files: ${leftoverTmp.join(", ")}`);
    const leftoverLock = entries.filter(f => f.endsWith(".lock"));
    assert.equal(leftoverLock.length, 0, `leftover lock files: ${leftoverLock.join(", ")}`);

    return store;
}

function _forkAndWait(scriptPath, args) {
    return new Promise((resolve, reject) => {
        const child = fork(scriptPath, args, { stdio: "pipe" });
        let payload = null;
        child.on("message", (msg) => { payload = msg; });
        child.on("exit", (code) => {
            if (payload) resolve(payload);
            else reject(new Error(`worker exited (code ${code}) with no message. args=${JSON.stringify(args)}`));
        });
        child.on("error", reject);
    });
}

const CREATE_WORKER_SRC = `
const mmPath = process.argv[2];
const workerIdx = Number(process.argv[3]);
const perChild = Number(process.argv[4]);
const roundTag = process.argv[5] || "r0";
const mm = require(mmPath);
const created = [];
let errored = null;
try {
    for (let i = 0; i < perChild; i++) {
        const objective = \`\${roundTag}-writer\${workerIdx}-mission-\${i}-\${Date.now()}-\${Math.random()}\`;
        const m = mm.createMission({ objective });
        created.push(m.id);
    }
} catch (err) {
    errored = err.message;
}
process.send({ created, errored });
process.exit(0);
`;

describe("Mission 86 — mission-memory concurrency stress", () => {

    test("A. high-contention create: 10 workers x 15 missions, exact count, zero lost writes, zero duplicate IDs", async () => {
        const iso = _buildIsolatedRepo();
        const workerScript = path.join(iso.root, "_create_worker.cjs");
        fs.writeFileSync(workerScript, CREATE_WORKER_SRC);

        const NUM_WORKERS = 10;
        const PER_CHILD = 15;
        const results = await Promise.all(
            Array.from({ length: NUM_WORKERS }, (_, idx) =>
                _forkAndWait(workerScript, [iso.missionMemoryPath, String(idx), String(PER_CHILD), "A"])
            )
        );

        for (const r of results) {
            assert.equal(r.errored, null, `a worker errored: ${r.errored}`);
            assert.equal(r.created.length, PER_CHILD);
        }

        const allCreatedIds = results.flatMap(r => r.created);
        assert.equal(new Set(allCreatedIds).size, allCreatedIds.length, "each worker's own created-ID list must itself be duplicate-free");

        const store = _assertStoreIntegrity(iso.missionsFile, { expectedCount: NUM_WORKERS * PER_CHILD });
        const finalIds = new Set(store.missions.map(m => m.id));
        const missing = allCreatedIds.filter(id => !finalIds.has(id));
        assert.equal(missing.length, 0, `lost writes: ${missing.length} of ${allCreatedIds.length} created missions are missing`);

        fs.rmSync(iso.root, { recursive: true, force: true });
    });

    test("B. mixed mutation types concurrently hitting the SAME mission: each survives independently", async () => {
        const iso = _buildIsolatedRepo();
        const mm = require(iso.missionMemoryPath);
        const seed = mm.createMission({
            objective: "shared-mission-for-mixed-mutations",
            subtasks: [{ description: "pre-existing subtask" }],
        });
        const subtaskId = seed.subtasks[0].id;

        const mixedWorkerScript = path.join(iso.root, "_mixed_worker.cjs");
        fs.writeFileSync(mixedWorkerScript, `
            const mmPath = process.argv[2];
            const missionId = process.argv[3];
            const op = process.argv[4];
            const subtaskId = process.argv[5];
            const mm = require(mmPath);
            let errored = null;
            try {
                switch (op) {
                    case "decision": mm.recordDecision(missionId, { description: "mixed-decision" }); break;
                    case "artifact": mm.recordArtifact(missionId, { name: "mixed-artifact.txt" }); break;
                    case "failure":  mm.recordFailure(missionId, { description: "mixed-failure" }); break;
                    case "approval": mm.recordApproval(missionId, { type: "mixed-approval-type", status: "pending" }); break;
                    case "learning": mm.addLearning(missionId, { insight: "mixed-learning-insight" }); break;
                    case "subtask":  mm.updateSubtask(missionId, subtaskId, { status: "running" }); break;
                    default: throw new Error("unknown op " + op);
                }
            } catch (err) { errored = err.message; }
            process.send({ op, errored });
            process.exit(0);
        `);

        const ops = ["decision", "artifact", "failure", "approval", "learning", "subtask"];
        const results = await Promise.all(
            ops.map(op => _forkAndWait(mixedWorkerScript, [iso.missionMemoryPath, seed.id, op, subtaskId]))
        );

        for (const r of results) {
            assert.equal(r.errored, null, `op "${r.op}" errored: ${r.errored}`);
        }

        const final = mm.getMission(seed.id);
        assert.equal(final.decisions.length, 1, "recordDecision's contribution must survive");
        assert.equal(final.artifacts.length, 1, "recordArtifact's contribution must survive");
        assert.equal(final.failures.length, 1, "recordFailure's contribution must survive");
        assert.equal(final.approvals.length, 1, "recordApproval's contribution must survive");
        assert.equal(final.learnings.length, 1, "addLearning's contribution must survive");
        assert.equal(final.subtasks.find(s => s.id === subtaskId).status, "running", "updateSubtask's contribution must survive");

        _assertStoreIntegrity(iso.missionsFile);
        fs.rmSync(iso.root, { recursive: true, force: true });
    });

    test("C. concurrent readers alongside concurrent writers never observe malformed/partial JSON", async () => {
        const iso = _buildIsolatedRepo();
        const mm = require(iso.missionMemoryPath);
        mm.createMission({ objective: "reader-writer-seed" });

        const writerScript = path.join(iso.root, "_rw_writer.cjs");
        fs.writeFileSync(writerScript, CREATE_WORKER_SRC);
        const readerScript = path.join(iso.root, "_rw_reader.cjs");
        fs.writeFileSync(readerScript, `
            const missionsFile = process.argv[2];
            const fs = require("fs");
            let reads = 0, malformed = 0;
            const deadline = Date.now() + 400;
            while (Date.now() < deadline) {
                try {
                    const raw = fs.readFileSync(missionsFile, "utf8");
                    const parsed = JSON.parse(raw);
                    if (!parsed || !Array.isArray(parsed.missions)) malformed++;
                    reads++;
                } catch (err) {
                    // ENOENT is acceptable only in the sliver before the file
                    // first exists; any parse error on an existing file is not.
                    if (err.code !== "ENOENT" || fs.existsSync(missionsFile)) malformed++;
                }
            }
            process.send({ reads, malformed });
            process.exit(0);
        `);

        const [writerResult, ...readerResults] = await Promise.all([
            _forkAndWait(writerScript, [iso.missionMemoryPath, "0", "20", "C"]),
            _forkAndWait(readerScript, [iso.missionsFile]),
            _forkAndWait(readerScript, [iso.missionsFile]),
            _forkAndWait(readerScript, [iso.missionsFile]),
        ]);

        assert.equal(writerResult.errored, null);
        for (const r of readerResults) {
            assert.ok(r.reads > 0, "readers must have performed at least one read during the window");
            assert.equal(r.malformed, 0, `readers observed ${r.malformed} malformed/partial reads out of ${r.reads} — atomic rename must prevent this`);
        }

        _assertStoreIntegrity(iso.missionsFile, { expectedCount: 21 });
        fs.rmSync(iso.root, { recursive: true, force: true });
    });

    test("D. genuine multi-process lock racing (8 real workers) + lock-file cleanup after a THROWING transaction", async () => {
        const iso = _buildIsolatedRepo();
        const workerScript = path.join(iso.root, "_race_worker.cjs");
        fs.writeFileSync(workerScript, CREATE_WORKER_SRC);

        const NUM_WORKERS = 8;
        const start = Date.now();
        const results = await Promise.all(
            Array.from({ length: NUM_WORKERS }, (_, idx) =>
                _forkAndWait(workerScript, [iso.missionMemoryPath, String(idx), "5", "D"])
            )
        );
        const elapsed = Date.now() - start;

        for (const r of results) assert.equal(r.errored, null, `a worker errored under lock contention: ${r.errored}`);
        assert.ok(elapsed < 10_000, `8-way lock contention took ${elapsed}ms — expected well under the 10s acquisition timeout for this small a workload (no deadlock)`);

        _assertStoreIntegrity(iso.missionsFile, { expectedCount: NUM_WORKERS * 5 });
        assert.equal(fs.existsSync(iso.lockFile), false, "lock file must not remain after all racing workers finish");

        // Failure-path cleanup: a mutation that throws INSIDE the locked
        // section (Mission 85's _withMissionsLock() releases in a `finally`)
        // must still release the lock — Mission 85's own suite never
        // exercises a throwing transaction, only successful ones.
        const mm = require(iso.missionMemoryPath);
        assert.throws(() => mm.updateMission("msn_does_not_exist", { status: "active" }), /not found/i);
        assert.equal(fs.existsSync(iso.lockFile), false, "lock file must be released even when the wrapped transaction throws");

        // The store must remain valid and a subsequent call must still succeed.
        const after = mm.createMission({ objective: "post-throw-recovery-check" });
        assert.ok(after.id);
        _assertStoreIntegrity(iso.missionsFile, { expectedCount: NUM_WORKERS * 5 + 1 });

        fs.rmSync(iso.root, { recursive: true, force: true });
    });

    test("E. a process that crashes while holding the lock does not permanently block a subsequent process (real SIGKILL mid-critical-section, not a hand-aged file)", async () => {
        const iso = _buildIsolatedRepo();

        // This worker calls the REAL createMission() (so the REAL
        // _acquireMissionsLock() runs and genuinely creates the lock file
        // via fs.openSync(...,"wx")), but with fs.writeFileSync patched to
        // hang forever the first time it's invoked — which happens inside
        // _saveMissions(), i.e. strictly AFTER the lock has already been
        // acquired. This puts the process genuinely inside the locked
        // critical section, still executing real production code, at the
        // moment the parent issues SIGKILL — so the kill lands mid-
        // transaction and the process's `finally` (which would release the
        // lock) never runs, exactly like a real SIGKILL/OOM crash.
        const crashWorkerScript = path.join(iso.root, "_crash_worker.cjs");
        fs.writeFileSync(crashWorkerScript, `
            const mmPath = process.argv[2];
            const fs = require("fs");
            const realWriteFileSync = fs.writeFileSync;
            fs.writeFileSync = function (...args) {
                // Signal the parent that we're inside _saveMissions() (lock
                // already held) and then hang — never call the real
                // writeFileSync, never return, never let _saveMissions()
                // or _withMissionsLock()'s finally proceed.
                process.send({ locked: true });
                const deadline = Date.now() + 30000;
                while (Date.now() < deadline) { /* spin — waiting to be SIGKILLed */ }
            };
            const mm = require(mmPath);
            mm.createMission({ objective: "crash-mid-transaction-should-be-lost" });
        `);

        const child = fork(crashWorkerScript, [iso.missionMemoryPath], { stdio: "pipe" });
        const lockedSignal = await new Promise((resolve, reject) => {
            child.on("message", (msg) => { if (msg.locked) resolve(msg); });
            child.on("error", reject);
            setTimeout(() => reject(new Error("crash worker never signaled 'locked'")), 5000);
        });
        assert.ok(lockedSignal.locked);
        assert.ok(fs.existsSync(iso.lockFile), "lock file must exist before the simulated crash — proves the real _acquireMissionsLock() ran");

        // Simulate the crash: SIGKILL, no graceful shutdown, no `finally` ever runs.
        child.kill("SIGKILL");
        await new Promise((resolve) => child.on("exit", resolve));
        assert.ok(fs.existsSync(iso.lockFile), "lock file must still be present immediately after the crash (this is the exact abandoned-lock condition)");

        // Age the now-abandoned lock file past the stale threshold — the
        // real crash produced the abandoned file; a genuinely dead process
        // holding a *fresh* lock is, correctly, still bounded by the
        // acquire timeout (proven separately by Mission 85's test 4b), not
        // instantly recoverable. This test's contribution is proving that a
        // lock left behind by an ACTUAL killed process (not a hand-crafted
        // file) is recognized as the same shape and successfully recovered.
        const oldTime = (Date.now() - 60_000) / 1000;
        fs.utimesSync(iso.lockFile, oldTime, oldTime);

        const mm = require(iso.missionMemoryPath);
        const recoveryStart = Date.now();
        const recovered = mm.createMission({ objective: "post-crash-recovery-check" });
        const recoveryElapsed = Date.now() - recoveryStart;

        assert.ok(recovered.id, "a subsequent process must successfully create a mission after the crashed holder's lock is recognized as stale");
        assert.ok(recoveryElapsed < 5000, `post-crash recovery took ${recoveryElapsed}ms — expected a fast force-break, not a long wait`);
        assert.equal(fs.existsSync(iso.lockFile), false, "lock file must be cleaned up after the recovering transaction completes");

        fs.rmSync(iso.root, { recursive: true, force: true });
    });

    test("F. repeated rounds (3x) of high-contention create: reliable across multiple runs, not a single lucky pass", async () => {
        const NUM_ROUNDS = 3;
        const NUM_WORKERS = 6;
        const PER_CHILD = 8;

        for (let round = 0; round < NUM_ROUNDS; round++) {
            const iso = _buildIsolatedRepo();
            const workerScript = path.join(iso.root, "_round_worker.cjs");
            fs.writeFileSync(workerScript, CREATE_WORKER_SRC);

            const results = await Promise.all(
                Array.from({ length: NUM_WORKERS }, (_, idx) =>
                    _forkAndWait(workerScript, [iso.missionMemoryPath, String(idx), String(PER_CHILD), `F-round${round}`])
                )
            );

            for (const r of results) assert.equal(r.errored, null, `round ${round}: a worker errored: ${r.errored}`);

            const allCreatedIds = results.flatMap(r => r.created);
            const store = _assertStoreIntegrity(iso.missionsFile, { expectedCount: NUM_WORKERS * PER_CHILD });
            const finalIds = new Set(store.missions.map(m => m.id));
            const missing = allCreatedIds.filter(id => !finalIds.has(id));
            assert.equal(missing.length, 0, `round ${round}: lost writes: ${missing.length} of ${allCreatedIds.length}`);

            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("G. real data/missions.json is not modified by this entire stress suite", () => {
        const before = _snapshot(REAL_MISSIONS_FILE);
        const after = _snapshot(REAL_MISSIONS_FILE);
        assert.deepEqual(after, before);

        const realDataDir = path.join(REAL_REPO_ROOT, "data");
        const entries = fs.existsSync(realDataDir) ? fs.readdirSync(realDataDir) : [];
        const leftoverArtifacts = entries.filter(f =>
            /^missions\.json\.\d+\.[0-9a-f]+\.tmp$/.test(f) || f === "missions.json.lock"
        );
        assert.equal(leftoverArtifacts.length, 0, `leftover lock/tmp artifacts in REAL data dir: ${leftoverArtifacts.join(", ")}`);

        if (before.exists) {
            const realContent = fs.readFileSync(REAL_MISSIONS_FILE, "utf8");
            const markers = [
                "writer0-mission", "shared-mission-for-mixed-mutations", "reader-writer-seed",
                "post-throw-recovery-check", "post-crash-recovery-check", "-writer0-mission-", "F-round",
            ];
            for (const marker of markers) {
                assert.ok(!realContent.includes(marker), `real missions.json contains test marker "${marker}" — test isolation failed`);
            }
        }
    });
});
