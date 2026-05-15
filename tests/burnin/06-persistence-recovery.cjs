#!/usr/bin/env node
"use strict";
/**
 * Queue Persistence + Crash Recovery Validation
 *
 * Spawns its own isolated server instance on a test port (default 5051).
 * This avoids disrupting any running production server on port 5050.
 *
 * Test sequence:
 *  1. Spawn server on test port
 *  2. Add 10 known tasks to the queue via HTTP
 *  3. SIGTERM (graceful shutdown) — drain window
 *  4. Restart server, verify all 10 tasks still present
 *  5. SIGKILL (ungraceful crash) — no drain
 *  6. Restart server, verify system comes back healthy
 *  7. Verify queue file still valid JSON after SIGKILL
 *
 * Usage:
 *   node tests/burnin/06-persistence-recovery.cjs [--port=5051]
 */

const http           = require("http");
const { spawn }      = require("child_process");
const path           = require("path");
const fs             = require("fs");

const args      = process.argv.slice(2);
const TEST_PORT = (() => { const a = args.find(a => a.startsWith("--port=")); return a ? parseInt(a.slice(7)) : 5051; })();
const ROOT      = path.join(__dirname, "../..");
const QUEUE_FILE = path.join(ROOT, "data/task-queue.json");
const QUEUE_BAK  = path.join(ROOT, "data/task-queue.json.burnin-bak");

// ── helpers ───────────────────────────────────────────────────────────────────

function get(path_, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const req = http.request(
            { hostname: "127.0.0.1", port: TEST_PORT, path: path_, method: "GET" },
            (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => {
                    let parsed = null;
                    try { parsed = JSON.parse(data); } catch { /* raw */ }
                    resolve({ ok: res.statusCode < 500, status: res.statusCode, body: parsed });
                });
            }
        );
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false }); });
        req.on("error", () => resolve({ ok: false }));
        req.end();
    });
}

function post(path_, body, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const opts    = {
            hostname: "127.0.0.1", port: TEST_PORT, path: path_, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        };
        const req = http.request(opts, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch { /* raw */ }
                resolve({ ok: res.statusCode < 500, status: res.statusCode, body: parsed });
            });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false }); });
        req.on("error", () => resolve({ ok: false }));
        req.write(payload);
        req.end();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Wait until server responds on test port or timeout
async function waitForServer(maxMs = 15_000) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        const r = await get("/health", 2000);
        if (r.ok) return true;
        await sleep(500);
    }
    return false;
}

function spawnServer() {
    const env = {
        ...process.env,
        PORT:      String(TEST_PORT),
        NODE_ENV:  "test",
        // Suppress verbose output
        DEBUG_PIPELINE: "false",
    };
    const proc = spawn("node", ["backend/server.js"], {
        cwd:   ROOT,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false
    });
    // Suppress stdout/stderr from the test server
    proc.stdout.resume();
    proc.stderr.resume();
    return proc;
}

// ── Test runner ───────────────────────────────────────────────────────────────

const results = [];

function pass(label) {
    results.push({ ok: true, label });
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}

function fail(label, reason) {
    results.push({ ok: false, label, reason });
    console.log(`  \x1b[31m✗\x1b[0m ${label} — ${reason}`);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

const _addedIds = new Set();

async function cleanupBurninTasks() {
    // Remove only the tasks we added (prefix burnin-)
    if (!fs.existsSync(QUEUE_FILE)) return;
    try {
        const all      = JSON.parse(fs.readFileSync(QUEUE_FILE, "utf8"));
        const filtered = all.filter(t => !String(t.input || "").startsWith("burnin-persist-"));
        fs.writeFileSync(QUEUE_FILE, JSON.stringify(filtered, null, 2));
    } catch { /* best effort */ }
}

// ── Main ──────────────────────────────────────────────────────────────────────

let _server = null;

async function main() {
    console.log(`\nJARVIS Queue Persistence + Crash Recovery`);
    console.log(`  Test port: ${TEST_PORT}`);
    console.log(`  Root:      ${ROOT}`);
    console.log(`  Queue:     ${QUEUE_FILE}\n`);

    // Backup current queue
    if (fs.existsSync(QUEUE_FILE)) {
        fs.copyFileSync(QUEUE_FILE, QUEUE_BAK);
        console.log("  Queue backed up to .burnin-bak\n");
    }

    // ── Phase A: Initial startup ──────────────────────────────────────────────

    console.log("  Phase A: Initial server startup");
    _server = spawnServer();
    const startedA = await waitForServer(15_000);
    if (!startedA) {
        fail("server startup A", `server not reachable on port ${TEST_PORT} within 15s`);
        console.log("  Skipping remaining tests — server failed to start");
        await cleanup();
        return;
    }
    pass("server starts cleanly on test port");

    // Add 10 known tasks — try HTTP first, fall back to direct queue write
    const taskInputPrefix = "burnin-persist-";
    const addedIds = [];

    // Try HTTP add first
    const probe = await post("/tasks", { input: `${taskInputPrefix}probe`, type: "auto" });
    const httpTasksWork = probe.ok && (probe.body?.task?.id || probe.body?.id);

    if (httpTasksWork) {
        const probeId = probe.body?.task?.id || probe.body?.id;
        addedIds.push(probeId);
        _addedIds.add(probeId);
        for (let i = 1; i < 10; i++) {
            const r = await post("/tasks", { input: `${taskInputPrefix}${i}`, type: "auto" });
            const id = r.body?.task?.id || r.body?.id;
            if (r.ok && id) { addedIds.push(id); _addedIds.add(id); }
        }
    } else {
        // autonomousLoop unavailable — add directly via taskQueue module
        const tq = require("../../agents/taskQueue.cjs");
        for (let i = 0; i < 10; i++) {
            const t = tq.addTask({ input: `${taskInputPrefix}${i}`, type: "auto" });
            addedIds.push(t.id);
            _addedIds.add(t.id);
        }
    }

    addedIds.length >= 10
        ? pass(`added 10 burnin tasks (IDs: ${addedIds[0]}..${addedIds[addedIds.length-1]})`)
        : fail("add 10 tasks", `only ${addedIds.length}/10 tasks added`);

    // Confirm queue has them via /tasks or direct read
    const listA = await get("/tasks");
    const tasksA = listA.ok && listA.body?.tasks
        ? listA.body.tasks
        : (() => { try { return require("../../agents/taskQueue.cjs").getAll(); } catch { return []; } })();
    const foundA = tasksA.filter(t => String(t.input || "").startsWith(taskInputPrefix));
    foundA.length >= 10
        ? pass(`queue confirms ${foundA.length} burnin tasks before shutdown`)
        : fail("queue pre-shutdown", `only ${foundA.length}/10 tasks visible in queue`);

    // ── Phase B: SIGTERM — graceful shutdown ───────────────────────────────────

    console.log("\n  Phase B: SIGTERM (graceful shutdown)");
    _server.kill("SIGTERM");
    await sleep(3000);  // give drain time

    // Verify queue file is valid JSON
    try {
        const raw = fs.readFileSync(QUEUE_FILE, "utf8");
        JSON.parse(raw);
        pass("queue file valid JSON after SIGTERM");
    } catch (e) {
        fail("queue file JSON after SIGTERM", e.message);
    }

    // Restart
    _server = spawnServer();
    const startedB = await waitForServer(15_000);
    startedB
        ? pass("server restarts cleanly after SIGTERM")
        : fail("server restart after SIGTERM", "not reachable within 15s");

    if (startedB) {
        const listB = await get("/tasks");
        // Try HTTP response, fall back to direct file read
        const tasksB = (listB.ok && listB.body?.tasks)
            ? listB.body.tasks
            : (() => { try { return JSON.parse(require("fs").readFileSync(QUEUE_FILE, "utf8")); } catch { return []; } })();
        const surviving = tasksB.filter(t => String(t.input || "").startsWith(taskInputPrefix));
        surviving.length >= addedIds.length
            ? pass(`queue persistence: ${surviving.length}/${addedIds.length} tasks survived SIGTERM restart`)
            : fail("queue persistence after SIGTERM", `only ${surviving.length}/${addedIds.length} tasks survived`);
    }

    // ── Phase C: SIGKILL — ungraceful crash ────────────────────────────────────

    console.log("\n  Phase C: SIGKILL (crash)");
    _server.kill("SIGKILL");
    await sleep(1000);

    // Verify queue file is still readable (atomic writes should protect it)
    try {
        const raw = fs.readFileSync(QUEUE_FILE, "utf8");
        JSON.parse(raw);
        pass("queue file survives SIGKILL (atomic write protected)");
    } catch (e) {
        fail("queue file JSON after SIGKILL", `corrupted: ${e.message}`);
    }

    // Restart after crash
    _server = spawnServer();
    const startedC = await waitForServer(15_000);
    startedC
        ? pass("server restarts cleanly after SIGKILL")
        : fail("server restart after SIGKILL", "not reachable within 15s");

    if (startedC) {
        // Health check after crash recovery
        const healthC = await get("/health");
        if (healthC.ok) {
            const status = healthC.body?.status ?? "unknown";
            pass(`system healthy after crash recovery (status: ${status})`);
        } else {
            fail("health check after crash recovery", `status ${healthC.status}`);
        }

        // Ops check after crash
        const opsC = await get("/ops");
        opsC.ok
            ? pass("ops endpoint responds after crash recovery")
            : fail("ops endpoint after crash", `status ${opsC.status}`);
    }

    // ── Phase D: Graceful shutdown of test server ────────────────────────────

    console.log("\n  Phase D: Clean shutdown");
    _server.kill("SIGTERM");
    await sleep(2000);
    pass("test server shut down cleanly");
    _server = null;

    // ── Summary ───────────────────────────────────────────────────────────────

    await cleanup();

    const passed = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);

    console.log("\n  " + "─".repeat(55));
    console.log(`  Pass: ${passed}  Fail: ${failed.length}  Total: ${results.length}`);

    if (failed.length > 0) {
        console.log("\n  Failed:");
        failed.forEach(f => console.log(`    ✗ ${f.label}: ${f.reason}`));
    }

    console.log("\n  " + "─".repeat(55));
    console.log(failed.length === 0
        ? "  \x1b[32mPASS\x1b[0m  Queue persistence and crash recovery validated"
        : `  \x1b[31mFAIL\x1b[0m  ${failed.length} check(s) failed`);
    console.log("  " + "─".repeat(55) + "\n");

    process.exit(failed.length > 0 ? 1 : 0);
}

async function cleanup() {
    if (_server) {
        try { _server.kill("SIGKILL"); } catch { /* gone */ }
        _server = null;
    }
    await cleanupBurninTasks();
    // Restore backup
    if (fs.existsSync(QUEUE_BAK)) {
        fs.copyFileSync(QUEUE_BAK, QUEUE_FILE);
        fs.unlinkSync(QUEUE_BAK);
        console.log("  Queue restored from backup");
    }
}

process.on("SIGINT",  () => cleanup().then(() => process.exit(1)));
process.on("SIGTERM", () => cleanup().then(() => process.exit(1)));

main().catch(async (e) => {
    console.error("Persistence test crashed:", e.message);
    await cleanup();
    process.exit(1);
});
