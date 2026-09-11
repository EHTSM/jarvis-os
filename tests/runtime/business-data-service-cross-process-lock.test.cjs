#!/usr/bin/env node
"use strict";
/**
 * Mission 76 Micro-Mission 07 — businessDataService.cjs cross-process
 * write-atomicity regression.
 *
 * Root cause (Micro-Mission 06, live-reproduced 3/3 runs): _create()'s
 * read-modify-write cycle (_readStore -> mutate -> _writeStore) had no
 * cross-process coordination. 10 real child processes each calling
 * createLead() once against the same file lost 5-7 of 10 records every
 * run — valid JSON throughout, no corruption, just silent data loss from
 * the classic unlocked read-modify-write race.
 *
 * Fix under test: _create/_update/_remove now wrap their entire
 * read-modify-write-rename cycle in _withLock(), a dependency-free
 * cross-process exclusive lock built on fs.openSync(path, "wx").
 *
 * This test spawns REAL child processes (not Promise.all in one process,
 * which the single-threaded JS event loop would serialize and which would
 * never exercise the actual cross-process race) against an isolated
 * JARVIS_TEST_DATA_SUFFIX store — never the real data/biz-leads.json.
 *
 * Usage: node --test tests/runtime/business-data-service-cross-process-lock.test.cjs
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const N = 10;

function runConcurrentWriters(suffix) {
    const children = [];
    for (let i = 0; i < N; i++) {
        const child = spawn("node", ["-e", `
            process.env.JARVIS_TEST_DATA_SUFFIX = "${suffix}";
            const bds = require("${ROOT}/backend/services/businessDataService.cjs");
            bds.createLead({ name: "lockcheck-${i}", phone: "919${7000000 + i}", orgId: "lockcheck_org" });
        `], { cwd: ROOT, env: { ...process.env, JARVIS_TEST_DATA_SUFFIX: suffix } });
        children.push(new Promise((resolve) => {
            let stderr = "";
            child.stderr.on("data", (d) => { stderr += d; });
            child.on("close", (code) => resolve({ i, code, stderr }));
            child.on("error", (err) => resolve({ i, code: -1, stderr: err.message }));
        }));
    }
    return Promise.all(children);
}

describe("businessDataService.cjs cross-process write lock (Micro-Mission 07 regression)", { concurrency: false }, () => {
    it("live: 10 real concurrent child processes each writing once — all 10 records survive, valid JSON, no duplicates, no orphan files, clean exits", async () => {
        const suffix = `lockcheck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const dataDir = path.join(ROOT, "data");
        const dataFile = path.join(dataDir, `biz-leads.${suffix}.json`);

        try {
            const results = await runConcurrentWriters(suffix);

            const failed = results.filter(r => r.code !== 0);
            assert.equal(failed.length, 0,
                `all ${N} child processes must exit cleanly (code 0) — failures: ${JSON.stringify(failed)}`);

            // Give the filesystem a moment — all children already closed by the time
            // Promise.all resolves, but the final renameSync of the last writer to
            // release the lock may be a few event-loop ticks behind process exit.
            await new Promise(r => setTimeout(r, 100));

            const raw = fs.readFileSync(dataFile, "utf8");
            const store = JSON.parse(raw); // throws if corrupted — implicit validity check

            assert.equal(store.items.length, N,
                `all ${N} writes must survive — got ${store.items.length} (lost ${N - store.items.length})`);

            const names = store.items.map(i => i.name);
            assert.equal(new Set(names).size, N, "no duplicate records must exist");

            for (let i = 0; i < N; i++) {
                assert.ok(names.includes(`lockcheck-${i}`), `record lockcheck-${i} must be present`);
            }

            const orphanTmp = fs.readdirSync(dataDir).filter(f =>
                f.startsWith(`biz-leads.${suffix}.json.`) && f.endsWith(".tmp"));
            assert.deepEqual(orphanTmp, [], "no orphaned .tmp file should remain after clean concurrent writes");

            const orphanLock = fs.readdirSync(dataDir).filter(f => f === `biz-leads.${suffix}.json.lock`);
            assert.deepEqual(orphanLock, [], "the lock file must be released (deleted) after every writer completes — no permanent lock");
        } finally {
            // Cleanup — remove only this test's own isolated file and any leftovers.
            try { fs.unlinkSync(dataFile); } catch {}
            try {
                for (const f of fs.readdirSync(dataDir)) {
                    if (f.startsWith(`biz-leads.${suffix}.`)) {
                        try { fs.unlinkSync(path.join(dataDir, f)); } catch {}
                    }
                }
            } catch {}
        }
    });

    it("unit: a stale lock (mtime older than the staleness threshold) is force-recovered, not a permanent deadlock", () => {
        const suffix = `lockcheck_stale_${Date.now()}`;
        const dataDir = path.join(ROOT, "data");
        const lockPath = path.join(dataDir, `biz-leads.${suffix}.json.lock`);

        try {
            // Simulate an abandoned lock from a crashed writer: create the lock file
            // directly, then backdate its mtime past the module's staleness window.
            fs.writeFileSync(lockPath, "");
            const past = new Date(Date.now() - 15_000); // older than LOCK_STALE_MS (10s)
            fs.utimesSync(lockPath, past, past);

            process.env.JARVIS_TEST_DATA_SUFFIX = suffix;
            delete require.cache[require.resolve("../../backend/services/businessDataService.cjs")];
            const bds = require("../../backend/services/businessDataService.cjs");

            // This must NOT hang or throw a timeout error — the stale lock must be
            // recovered automatically within the module's own retry loop.
            const record = bds.createLead({ name: "stale-lock-recovery-probe", phone: "9190000000", orgId: "lockcheck_org" });
            assert.ok(record && record.name === "stale-lock-recovery-probe", "createLead() must succeed after recovering a stale lock");

            assert.ok(!fs.existsSync(lockPath) || fs.statSync(lockPath).mtimeMs > past.getTime(),
                "the lock must have been replaced by a fresh acquisition, not left in its stale state");
        } finally {
            delete process.env.JARVIS_TEST_DATA_SUFFIX;
            try { fs.unlinkSync(lockPath); } catch {}
            try { fs.unlinkSync(path.join(dataDir, `biz-leads.${suffix}.json`)); } catch {}
        }
    });
});
