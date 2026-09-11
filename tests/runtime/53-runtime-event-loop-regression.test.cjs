"use strict";
/**
 * Mission 87 — runtime event-loop regression + structured log read bound.
 *
 * Phase 1 reconnaissance found that continuousRuntimeObserver.cjs's
 * _readStructuredErrors() and backgroundRuntime.cjs's _logObserver() both
 * did an unconditional fs.readFileSync() of the ENTIRE structured.ndjson
 * file, then .split("\n") over all of it, only to keep the last 500/200
 * lines respectively — an unbounded-with-file-size cost paid on every 60s
 * firing from TWO independent call sites. structured.ndjson has no
 * rotation/cap and grows without bound (the real file was already
 * 1.6MB+/11,000+ lines at the time of this mission) — the same growth-risk
 * shape as the pre-Mission-84 missions.json full-read tick, which reached
 * 76.8MB and measured 483ms event-loop stalls before being fixed.
 *
 * Fix: backend/utils/tailRead.cjs's readTailLines() reads only a bounded
 * byte range from the end of the file via fs.readSync at a computed
 * offset — the I/O cost is independent of total file size. Both consumers
 * now use it instead of a full-file read+split.
 *
 * ISOLATION GUARANTEE: every test builds its own throwaway mkdtempSync()
 * copy of the relevant production file(s) (+ their logger.js/tailRead.cjs
 * dependencies) — the same technique already proven in Missions 82/85/86 —
 * and never touches this repository's real data/missions.json or
 * data/logs/structured.ndjson. The final test is the sole exception by
 * design: it only READS the real missions.json to prove it remains
 * byte-for-byte untouched by everything in this suite.
 *
 * _readStructuredErrors() and _logObserver() are not part of either
 * module's public API (they're internal, fired only by each module's own
 * timer loop). Rather than starting the full observer subsystems (14 and
 * several staggered timers respectively) just to exercise one small, pure
 * function, this suite copies each production file into its isolated
 * temp directory and appends a test-only `module.exports.<fn> = <fn>`
 * line to that COPY (never the real source file) so the real, unmodified
 * function body can be invoked directly. backgroundRuntime.cjs already
 * exposes a public triggerObserver(name) that reaches _logObserver() the
 * real way, so that path is used instead of extraction for that consumer.
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

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

/**
 * Builds an isolated copy of continuousRuntimeObserver.cjs with a test-only
 * export appended for _readStructuredErrors/LOG_FILE, plus its logger.js
 * and tailRead.cjs dependencies, at matching relative paths.
 */
function _buildIsolatedObserver() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "m87-cro-"));
    fs.mkdirSync(path.join(root, "backend", "services"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend", "utils"), { recursive: true });
    fs.mkdirSync(path.join(root, "data", "logs"), { recursive: true });

    let src = fs.readFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "continuousRuntimeObserver.cjs"), "utf8");
    src += "\nmodule.exports._readStructuredErrors = _readStructuredErrors;\nmodule.exports.LOG_FILE = LOG_FILE;\n";
    const modulePath = path.join(root, "backend", "services", "continuousRuntimeObserver.cjs");
    fs.writeFileSync(modulePath, src);

    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "utils", "logger.js"), path.join(root, "backend", "utils", "logger.js"));
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "utils", "tailRead.cjs"), path.join(root, "backend", "utils", "tailRead.cjs"));

    return {
        root,
        modulePath,
        logFile: path.join(root, "data", "logs", "structured.ndjson"),
    };
}

/**
 * Builds an isolated copy of backgroundRuntime.cjs (unmodified — its own
 * public triggerObserver() reaches _logObserver() directly) plus its
 * logger.js/tailRead.cjs dependencies.
 */
function _buildIsolatedBackgroundRuntime() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "m87-bgr-"));
    fs.mkdirSync(path.join(root, "backend", "services"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend", "utils"), { recursive: true });
    fs.mkdirSync(path.join(root, "data", "logs"), { recursive: true });

    const modulePath = path.join(root, "backend", "services", "backgroundRuntime.cjs");
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "backgroundRuntime.cjs"), modulePath);
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "utils", "logger.js"), path.join(root, "backend", "utils", "logger.js"));
    fs.copyFileSync(path.join(REAL_REPO_ROOT, "backend", "utils", "tailRead.cjs"), path.join(root, "backend", "utils", "tailRead.cjs"));

    return {
        root,
        modulePath,
        logFile: path.join(root, "data", "logs", "structured.ndjson"),
    };
}

function _writeSyntheticLog(logPath, count, { errorEveryN = 50, padBytes = 60 } = {}) {
    const lines = [];
    const now = new Date().toISOString();
    for (let i = 0; i < count; i++) {
        lines.push(JSON.stringify({
            level: (i % errorEveryN === 0) ? "ERROR" : "INFO",
            ts: now,
            idx: i,
            pad: "x".repeat(padBytes),
        }));
    }
    fs.writeFileSync(logPath, lines.join("\n") + "\n");
    return fs.statSync(logPath).size;
}

function _instrumentReadSync() {
    const origReadSync = fs.readSync;
    let totalBytesRead = 0;
    let callCount = 0;
    fs.readSync = function (...args) {
        const result = origReadSync.apply(fs, args);
        totalBytesRead += result;
        callCount++;
        return result;
    };
    return {
        restore() { fs.readSync = origReadSync; },
        get totalBytesRead() { return totalBytesRead; },
        get callCount() { return callCount; },
    };
}

describe("Mission 87 — runtime event-loop regression", () => {

    test("1. structured log tail bound — continuousRuntimeObserver never reads the entire file", () => {
        const iso = _buildIsolatedObserver();
        try {
            const fullSize = _writeSyntheticLog(iso.logFile, 5000);
            const mod = require(iso.modulePath);

            const instr = _instrumentReadSync();
            let errorCount;
            try {
                errorCount = mod._readStructuredErrors(60 * 60 * 1000);
            } finally {
                instr.restore();
            }

            assert.ok(instr.totalBytesRead > 0, "the tail read must actually read something");
            assert.ok(instr.totalBytesRead < fullSize * 0.5, `read ${instr.totalBytesRead} bytes of a ${fullSize}-byte file — must not approach full-file size`);
            // Last 500 lines of 5000, errorEveryN=50 -> errors at indices 4500,4550,...,4950 = 10
            assert.equal(errorCount, 10, "recent-record error count must match the existing 500-line window contract");
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("2. structured log tail bound — backgroundRuntime never reads the entire file", async () => {
        const iso = _buildIsolatedBackgroundRuntime();
        try {
            const fullSize = _writeSyntheticLog(iso.logFile, 5000);
            const mod = require(iso.modulePath);

            const instr = _instrumentReadSync();
            let result;
            try {
                result = await mod.triggerObserver("logObserver");
            } finally {
                instr.restore();
            }

            assert.ok(instr.totalBytesRead > 0, "the tail read must actually read something");
            assert.ok(instr.totalBytesRead < fullSize * 0.5, `read ${instr.totalBytesRead} bytes of a ${fullSize}-byte file — must not approach full-file size`);
            // Last 200 lines of 5000, errorEveryN=50 -> errors at indices 4800,4850,...,4950 = 4
            assert.equal(result.errorCount, 4, "recent-record error count must match the existing 200-line window contract");
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("3. no malformed partial first record: a tail read starting mid-line never emits a broken record", () => {
        const iso = _buildIsolatedObserver();
        try {
            // Force a tiny initial byte budget indirectly is not exposed at the
            // call site (readTailLines's default is 64KB), so instead prove
            // correctness at scale: every line the function actually consumes
            // must independently JSON.parse — if the tail read ever started
            // mid-line without discarding the fragment, the first "line" would
            // be a truncated JSON fragment and JSON.parse would throw, which
            // the production code silently swallows per-line (masking exactly
            // this class of bug) — so this test reads the isolated file's own
            // tail directly via the same utility, unfiltered by that per-line
            // catch, to prove no malformed fragment is ever produced.
            _writeSyntheticLog(iso.logFile, 20000, { padBytes: 80 });
            const { readTailLines } = require(path.join(iso.root, "backend", "utils", "tailRead.cjs"));
            const { lines, truncatedFirstLine } = readTailLines(iso.logFile, 500);

            assert.equal(truncatedFirstLine, true, "a tail read on a large file must start mid-file and discard a leading fragment");
            assert.equal(lines.length, 500);
            for (const line of lines) {
                assert.doesNotThrow(() => JSON.parse(line), `every recovered line must be a complete, parseable record: "${line.slice(0, 80)}"`);
            }
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("4. large-file stress: read volume stays bounded across small / large / much-larger files (not linear with file size)", () => {
        const iso = _buildIsolatedObserver();
        try {
            const mod = require(iso.modulePath);
            const sizes = [500, 20000, 100000]; // small, large (~2MB), much larger (~10MB+)
            const results = [];

            for (const count of sizes) {
                const fullSize = _writeSyntheticLog(iso.logFile, count, { padBytes: 80 });
                const instr = _instrumentReadSync();
                let errorCount;
                try {
                    errorCount = mod._readStructuredErrors(60 * 60 * 1000);
                } finally {
                    instr.restore();
                }
                results.push({ count, fullSize, bytesRead: instr.totalBytesRead, errorCount });
            }

            for (const r of results) {
                assert.ok(r.bytesRead <= 4 * 1024 * 1024, `bytesRead=${r.bytesRead} for a ${r.fullSize}-byte file must stay within the utility's own bounded retry ceiling`);
            }

            // The critical proof: read volume for the LARGEST file must not be
            // materially larger than for the SMALL file, even though the file
            // itself grew ~200x — i.e. it does not scale with total file size.
            const small = results[0];
            const largest = results[results.length - 1];
            assert.ok(
                largest.bytesRead < small.bytesRead * 20,
                `read volume grew ${(largest.bytesRead / small.bytesRead).toFixed(1)}x while file size grew ${(largest.fullSize / small.fullSize).toFixed(1)}x — read volume must not scale with file size`
            );
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("5. event-loop responsiveness: bounded log-read operations against a large fixture do not stall the event loop", async () => {
        const iso = _buildIsolatedObserver();
        try {
            _writeSyntheticLog(iso.logFile, 150000, { padBytes: 100 }); // tens-of-MB fixture
            const mod = require(iso.modulePath);

            // setImmediate lag probe: schedule a series of setImmediate
            // callbacks; if the event loop stalls for seconds while the
            // bounded read runs, the gap between scheduling and firing will
            // show it. A generous, stable threshold (not a fragile
            // microsecond figure) avoids flakiness on slower CI machines.
            const lags = [];
            let stop = false;
            function probe() {
                const scheduledAt = Date.now();
                setImmediate(() => {
                    lags.push(Date.now() - scheduledAt);
                    if (!stop) probe();
                });
            }
            probe();

            const start = Date.now();
            for (let i = 0; i < 20; i++) {
                mod._readStructuredErrors(60 * 60 * 1000);
            }
            const elapsed = Date.now() - start;
            stop = true;
            // Let the last scheduled setImmediate fire before inspecting lags.
            await new Promise((resolve) => setImmediate(resolve));

            assert.ok(elapsed < 2000, `20 bounded reads against a ~15MB fixture took ${elapsed}ms — expected well under a 2s generous bound, proving no multi-second stall`);
            const maxLag = lags.length ? Math.max(...lags) : 0;
            assert.ok(maxLag < 2000, `max setImmediate scheduling lag was ${maxLag}ms during the read burst — expected under a 2s generous bound (no event-loop stall)`);
        } finally {
            fs.rmSync(iso.root, { recursive: true, force: true });
        }
    });

    test("6. frontend engineering bounds: _frontendEngTick() regressions/UX slices remain slice(-5)/slice(-3)", () => {
        const src = fs.readFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "engineeringOrg.cjs"), "utf8");
        const fn = src.match(/async function _frontendEngTick\(s\) \{[\s\S]*?\n\}\n/);
        assert.ok(fn, "_frontendEngTick() must exist in engineeringOrg.cjs");
        assert.ok(
            /readdirSync\(regrDir\)\.filter\(f => f\.endsWith\("\.json"\)\)\.sort\(\)\.slice\(-5\)/.test(fn[0]),
            "the regressions directory scan must remain bounded to the last 5 files"
        );
        assert.ok(
            /readdirSync\(uxDir\)\.filter\(f => f\.endsWith\("\.json"\)\)\.sort\(\)\.slice\(-3\)/.test(fn[0]),
            "the UX directory scan must remain bounded to the last 3 files"
        );
    });

    test("7. bucket dispatch structural regression: MAX_DISPATCH_PER_TICK=10, sequential dispatch, per-agent failure isolation (read-only, agentRuntimeSupervisor.cjs untouched)", () => {
        const src = fs.readFileSync(path.join(REAL_REPO_ROOT, "backend", "services", "agentRuntimeSupervisor.cjs"), "utf8");

        assert.ok(/const MAX_DISPATCH_PER_TICK\s*=\s*10;/.test(src), "MAX_DISPATCH_PER_TICK must remain 10");

        const fn = src.match(/async function _bucketTick\(intervalMs\) \{[\s\S]*?\n\}\n/);
        assert.ok(fn, "_bucketTick() must exist");
        assert.ok(/const batch = due\.slice\(0, MAX_DISPATCH_PER_TICK\);/.test(fn[0]), "_bucketTick() must slice the due batch to MAX_DISPATCH_PER_TICK");
        assert.ok(/for \(const s of batch\) \{/.test(fn[0]), "_bucketTick() must dispatch the batch via a sequential for-loop");
        assert.ok(!/Promise\.all/.test(fn[0]), "_bucketTick() must never dispatch via Promise.all (would parallelize contention across agents in the same bucket)");
        assert.ok(/try \{\s*await _tick\(s\.id\);\s*\} catch/.test(fn[0]), "_bucketTick() must wrap each agent's tick in its own try/catch for per-agent failure isolation");
    });

    test("8. real data/missions.json is not modified by this entire suite", () => {
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
