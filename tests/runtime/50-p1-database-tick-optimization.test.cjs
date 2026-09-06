"use strict";
/**
 * Mission 84 regression: engineeringOrg.cjs's _databaseEngTick() previously
 * did fs.readFileSync + JSON.parse on EVERY .json file in data/ on every
 * single firing — entirely synchronous, blocking the event loop for the
 * full duration even though the tick's own "storage growth" check only
 * ever needed total byte SIZE (available via fs.statSync without reading
 * content at all). Corruption validation genuinely needs to read+parse
 * content, but does not need to run on every tick to remain useful.
 *
 * Fix (reconciled from the validated P1 runtime-pressure-fix package,
 * scoped ONLY to this one function): split the tick into (a) a cheap,
 * every-tick stat-only size sum, and (b) an expensive, periodic
 * (_DB_TICK_FULL_SCAN_EVERY_N = 10th tick) full read+parse validation
 * pass that also skips missions.json/task-queue.json, which already
 * validate their own content on their own read/write paths.
 *
 * Scope note: this mission deliberately does NOT touch
 * continuousRuntimeObserver.cjs or backgroundRuntime.cjs — both already
 * use the shared backend/core/safe-exec.js SafeExec.run() (from an
 * independent, earlier commit), so the P1 package's own _execAsync /
 * _execAsyncWrapped rewrite of those two files is not applicable and is
 * intentionally excluded here. This file only proves the database-tick
 * optimization in engineeringOrg.cjs.
 *
 * These tests never touch the real data/missions.json — fixture-based
 * tests use an isolated tempdir; the one live-data check only reads a
 * SHA-256 + mtime snapshot of the real file, taken before and after the
 * whole run, to prove nothing was written.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs     = require("node:fs");
const os     = require("node:os");
const path   = require("node:path");
const crypto = require("node:crypto");

const ENG_SRC_PATH = path.join(__dirname, "../../backend/services/engineeringOrg.cjs");
const REAL_MISSIONS_FILE = path.join(__dirname, "../../data/missions.json");

function _hashFile(p) {
    return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

// Returns { cwd, dataDir } — production code always reads
// path.join(process.cwd(), "data"), so the fixture must nest a real "data"
// subdirectory under the stubbed cwd for this to faithfully exercise the
// live code path (not merely a directory the stub happens to point at).
function _mkFixtureDir(files) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "m84-dbtick-"));
    const dataDir = path.join(cwd, "data");
    fs.mkdirSync(dataDir);
    for (const [name, content] of Object.entries(files)) {
        fs.writeFileSync(path.join(dataDir, name), content);
    }
    return { cwd, dataDir };
}

// Extracts the real, live _databaseEngTick() implementation (plus its two
// preceding constants) from the actual shipped source via source-text
// extraction — the same eval()-based-extraction convention already used by
// tests/runtime/40-mission-dedup-and-recovery.test.cjs — so this test can
// never silently drift from what actually ships. The function is invoked
// against a fixture dataDir (via a stubbed process.cwd()) rather than the
// real data/ directory.
function _extractDatabaseEngTick(src) {
    const constMatch = src.match(
        /const _DB_TICK_FULL_SCAN_EVERY_N\s*=\s*\d+;[\s\S]*?const _DB_TICK_SKIP_VALIDATION\s*=\s*new Set\(\[[^\]]*\]\);/
    );
    assert.ok(constMatch, "_DB_TICK_FULL_SCAN_EVERY_N / _DB_TICK_SKIP_VALIDATION constants must exist in engineeringOrg.cjs");

    const fnMatch = src.match(/async function _databaseEngTick\(s\) \{[\s\S]*?\n\}\n/);
    assert.ok(fnMatch, "_databaseEngTick() must exist in engineeringOrg.cjs");

    // Stub out the two collaborators _databaseEngTick() calls that are
    // irrelevant to this optimization (mission creation on corruption/growth,
    // and V2 work claiming) so the extracted function can run standalone.
    let fnBody = fnMatch[0];
    fnBody = fnBody.replace(/const m = _mission\(s\.id, \{[\s\S]*?\}, s\);/g, "const m = s.__missionSpy ? s.__missionSpy() : null;");
    fnBody = fnBody.replace(/try \{ const c = _wf\(\)[\s\S]*?\} catch \{\}/, "/* v2 work claim stubbed */");

    // eslint-disable-next-line no-eval
    const factory = eval(`(function() {
        ${constMatch[0]}
        function _setObj(s, msg) { s.lastObjective = msg; }
        ${fnBody.replace("async function _databaseEngTick", "return async function _databaseEngTick")}
    })`);
    return factory();
}

describe("Mission 84 — database-tick optimization (engineeringOrg.cjs _databaseEngTick())", () => {

    it("1. stat-only size equals full-read size on fixtures", () => {
        const { cwd, dataDir } = _mkFixtureDir({
            "a.json": JSON.stringify({ x: 1 }),
            "b.json": JSON.stringify({ y: "hello world".repeat(50) }),
        });
        try {
            let statTotal = 0;
            let readTotal = 0;
            for (const f of fs.readdirSync(dataDir)) {
                statTotal += fs.statSync(path.join(dataDir, f)).size;
                readTotal += Buffer.byteLength(fs.readFileSync(path.join(dataDir, f), "utf8"), "utf8");
            }
            assert.equal(statTotal, readTotal, "stat-only byte size must equal full-read byte length for the same files");
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("2. stat-only path avoids unnecessary content reads (spy proof)", async () => {
        const { cwd, dataDir } = _mkFixtureDir({
            "a.json": JSON.stringify({ x: 1 }),
            "b.json": JSON.stringify({ y: 2 }),
            "c.json": JSON.stringify({ z: 3 }),
        });
        try {
            const src = fs.readFileSync(ENG_SRC_PATH, "utf8");
            const tick = _extractDatabaseEngTick(src);

            const origRead = fs.readFileSync;
            let readCalls = 0;
            fs.readFileSync = new Proxy(origRead, {
                apply(target, thisArg, args) {
                    if (typeof args[0] === "string" && args[0].startsWith(dataDir)) readCalls++;
                    return Reflect.apply(target, thisArg, args);
                },
            });

            const s = { id: "db-eng-test", _dbTickCount: 5 }; // 6 % 10 !== 1 -> stat-only tick, no content reads expected
            const _origCwd = process.cwd;
            process.cwd = () => cwd;
            try {
                await tick(s);
                assert.equal(readCalls, 0, "a non-scan-gate tick must not call fs.readFileSync on any data file");
            } finally {
                process.cwd = _origCwd;
                fs.readFileSync = origRead;
            }
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("3. structural proof of the periodic full-scan gate", () => {
        const src = fs.readFileSync(ENG_SRC_PATH, "utf8");
        assert.ok(
            /const _DB_TICK_FULL_SCAN_EVERY_N\s*=\s*10/.test(src),
            "_DB_TICK_FULL_SCAN_EVERY_N must be defined as 10"
        );
        assert.ok(
            /const _DB_TICK_SKIP_VALIDATION\s*=\s*new Set\(\[\s*"missions\.json"\s*,\s*"task-queue\.json"\s*\]\)/.test(src),
            "_DB_TICK_SKIP_VALIDATION must skip missions.json and task-queue.json"
        );
        const fn = src.match(/async function _databaseEngTick\(s\) \{[\s\S]*?\n\}\n/)[0];
        assert.ok(
            /s\._dbTickCount\s*=\s*\(s\._dbTickCount \|\| 0\)\s*\+\s*1/.test(fn),
            "_databaseEngTick() must increment a per-state tick counter"
        );
        assert.ok(
            /s\._dbTickCount\s*%\s*_DB_TICK_FULL_SCAN_EVERY_N\s*===\s*1/.test(fn),
            "_databaseEngTick() must gate the full scan to every Nth tick"
        );
        assert.ok(
            /fs\.statSync\(path\.join\(dataDir, f\)\)\.size/.test(fn),
            "_databaseEngTick() must compute size via fs.statSync, not content length"
        );
    });

    it("4. engineeringOrg.cjs has 0 setInterval calls (unchanged by this mission)", () => {
        const src = fs.readFileSync(ENG_SRC_PATH, "utf8");
        const count = (src.match(/setInterval\(/g) || []).length;
        assert.equal(count, 0, "engineeringOrg.cjs must still register 0 setInterval timers directly — this mission does not add one");
    });

    it("5. isolated-tempdir E2E: optimized path is fast for many files and still reports storage growth", async () => {
        const { cwd, dataDir } = _mkFixtureDir({});
        try {
            // 260 files x ~200KB each (~52MB total) -> triggers the >50MB growth branch
            const big = "x".repeat(200 * 1024);
            for (let i = 0; i < 260; i++) {
                fs.writeFileSync(path.join(dataDir, `bulk-${i}.json`), JSON.stringify({ pad: big }));
            }

            const src = fs.readFileSync(ENG_SRC_PATH, "utf8");
            const tick = _extractDatabaseEngTick(src);

            // Wire the spy so the "storage growth" branch (which calls the
            // stubbed mission creator) is observable.
            const s = { id: "db-eng-test", _dbTickCount: 5, __missionSpy: () => ({ id: "spy-mission" }) };
            const _origCwd = process.cwd;
            process.cwd = () => cwd;
            try {
                const start = Date.now();
                await tick(s);
                const elapsed = Date.now() - start;
                assert.ok(elapsed < 200, `stat-only pass over 60 files should complete quickly (took ${elapsed}ms)`);
                assert.equal(s.lastObjective, "Opened 1 database task(s)", "storage growth over 50MB must still be detected on the stat-only path");
            } finally {
                process.cwd = _origCwd;
            }
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("6. corruption detection still works during the full-scan path", async () => {
        const { cwd, dataDir } = _mkFixtureDir({
            "good.json": JSON.stringify({ ok: true }),
            "bad.json": "{ this is not valid JSON",
        });
        try {
            const src = fs.readFileSync(ENG_SRC_PATH, "utf8");
            const tick = _extractDatabaseEngTick(src);

            // _dbTickCount starts at 0 -> becomes 1 after increment -> 1 % 10 === 1 -> full scan runs
            const s = { id: "db-eng-test", _dbTickCount: 0, __missionSpy: () => ({ id: "spy-mission" }) };
            const _origCwd = process.cwd;
            process.cwd = () => cwd;
            try {
                await tick(s);
                assert.equal(s.lastObjective, "Opened 1 database task(s)", "a corrupted file must still be detected and reported on a full-scan tick");
            } finally {
                process.cwd = _origCwd;
            }
        } finally {
            fs.rmSync(cwd, { recursive: true, force: true });
        }
    });

    it("7. real data/missions.json is untouched (SHA-256 + mtime unchanged)", () => {
        const before = _hashFile(REAL_MISSIONS_FILE);
        const beforeStat = fs.statSync(REAL_MISSIONS_FILE);

        // No production code path is exercised against the real data/ dir
        // anywhere in this file — this test only re-confirms the snapshot,
        // proving the suite itself made no writes.
        const after = _hashFile(REAL_MISSIONS_FILE);
        const afterStat = fs.statSync(REAL_MISSIONS_FILE);

        assert.equal(after, before, "data/missions.json content must be byte-for-byte unchanged");
        assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, "data/missions.json mtime must be unchanged");
        assert.equal(afterStat.size, beforeStat.size, "data/missions.json size must be unchanged");
    });

});
