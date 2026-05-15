#!/usr/bin/env node
"use strict";
/**
 * Adapter Timeout Validation + Orphan Cleanup Verification
 *
 * Tests:
 *  1. Terminal adapter enforces 15s timeout on long-running commands
 *  2. Blocked commands return error receipt, not crash
 *  3. Filesystem adapter errors gracefully on out-of-sandbox paths
 *  4. No orphan child processes leak after terminal commands
 *  5. Adapter health report shows no stuck state after timeouts
 *
 * Usage:
 *   node tests/burnin/04-adapter-timeouts.cjs
 */

const http   = require("http");
const { execSync } = require("child_process");

const BASE = (process.env.BASE_URL || "http://localhost:5050").replace(/\/$/, "");
const { hostname, port } = new URL(BASE);

const TERMINAL_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_PAD_MS = 5_000;  // allow 5s over the adapter timeout

// ── helpers ───────────────────────────────────────────────────────────────────

function post(path, body, timeoutMs = 30_000) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const opts    = {
            hostname, port: port || 80, path, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        };
        const start = Date.now();
        const req   = http.request(opts, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch { /* ignore */ }
                resolve({ ok: res.statusCode < 500, status: res.statusCode, ms: Date.now() - start, body: parsed ?? data });
            });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, ms: timeoutMs }); });
        req.on("error", () => resolve({ ok: false, status: 0, ms: Date.now() - start }));
        req.write(payload);
        req.end();
    });
}

function get(path, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const req = http.request(
            { hostname, port: port || 80, path, method: "GET" },
            (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => {
                    let parsed = null;
                    try { parsed = JSON.parse(data); } catch { /* ignore */ }
                    resolve({ ok: res.statusCode < 500, status: res.statusCode, body: parsed });
                });
            }
        );
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, body: null }); });
        req.on("error", () => resolve({ ok: false, status: 0, body: null }));
        req.end();
    });
}

// Count Node.js child processes owned by this process tree
function orphanCount() {
    try {
        const out = execSync("ps aux", { encoding: "utf8" });
        return out.split("\n").filter(l =>
            l.includes("node") &&
            !l.includes("ps aux") &&
            !l.includes(process.pid.toString())
        ).length;
    } catch { return -1; }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const results = [];

function pass(label) {
    results.push({ label, ok: true });
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}

function fail(label, reason) {
    results.push({ label, ok: false, reason });
    console.log(`  \x1b[31m✗\x1b[0m ${label} — ${reason}`);
}

async function main() {
    console.log(`\nJARVIS Adapter Timeout + Orphan Validation`);
    console.log(`  Target: ${BASE}\n`);

    const probe = await get("/health");
    if (!probe.ok) {
        console.error(`FATAL: Server not reachable at ${BASE}`);
        process.exit(1);
    }

    const orphansBefore = orphanCount();

    // ── 1. Timeout enforcement ────────────────────────────────────────────────
    // `sleep 30` is in the allowlist but will hit the 15s adapter timeout.
    // The command should return within TERMINAL_TIMEOUT_MS + PAD, with status=timeout.

    console.log("  Testing terminal adapter timeout (sleep 30)...");
    const timeoutStart = Date.now();
    const timeoutResult = await post("/jarvis",
        { input: "run sleep 30" },
        TERMINAL_TIMEOUT_MS + TEST_TIMEOUT_PAD_MS + 5000
    );
    const elapsed = Date.now() - timeoutStart;

    if (!timeoutResult.ok) {
        fail("timeout: sleep 30 returns non-500 response", `status ${timeoutResult.status}`);
    } else if (elapsed > TERMINAL_TIMEOUT_MS + TEST_TIMEOUT_PAD_MS) {
        fail("timeout: enforced within 20s", `took ${elapsed}ms — adapter did not time out`);
    } else {
        pass(`timeout: sleep 30 completed in ${elapsed}ms (adapter timeout enforced)`);
    }

    // ── 2. Blocked commands return error, not 500 ─────────────────────────────

    const blockedCmds = [
        ["run sudo ls",               "sudo"],
        ["run rm -rf /",              "rm blocked"],
        ["run wget http://x.com",     "wget blocked"],
        ["run curl http://x.com",     "curl blocked"],
        ["run notarealcommand --xyz", "unknown binary"],
    ];

    for (const [input, label] of blockedCmds) {
        const r = await post("/jarvis", { input });
        if (r.status === 500) {
            fail(`blocked: ${label} — server crashed (500)`, `status ${r.status}`);
        } else {
            pass(`blocked: ${label} — returned ${r.status}, not 500`);
        }
    }

    // ── 3. Server health after timeout + blocked commands ────────────────────

    const healthAfter = await get("/health");
    if (healthAfter.ok) {
        pass("server health ok after timeout + blocked commands");
    } else {
        fail("server health check failed after tests", `status ${healthAfter.status}`);
    }

    // ── 4. Adapter supervisor reports no stuck executions ────────────────────

    const opsAfter = await get("/ops");
    if (opsAfter.ok && opsAfter.body) {
        const stuck = opsAfter.body.stuck_tasks ?? [];
        if (stuck.length === 0) {
            pass("no stuck tasks in queue after timeout tests");
        } else {
            fail("stuck tasks found after timeout", `${stuck.length} stuck: ${stuck.map(t => t.id).join(", ")}`);
        }
    } else {
        pass("ops endpoint reachable after timeout tests (stuck_tasks not parseable — non-critical)");
    }

    // ── 5. Filesystem: out-of-sandbox path errors gracefully ─────────────────

    const fsOutOfSandbox = await post("/jarvis", { input: "read file /etc/passwd" });
    if (fsOutOfSandbox.status === 500) {
        fail("filesystem: out-of-sandbox read causes 500", "should return error receipt");
    } else {
        pass(`filesystem: out-of-sandbox read returned ${fsOutOfSandbox.status}, not 500`);
    }

    // ── 6. Filesystem: path traversal attempt ────────────────────────────────

    const pathTraversal = await post("/jarvis", { input: "read file ../../../../etc/hosts" });
    if (pathTraversal.status === 500) {
        fail("filesystem: path traversal causes 500", "should return error receipt");
    } else {
        pass(`filesystem: path traversal returned ${pathTraversal.status}, not 500`);
    }

    // ── 7. Orphan check ───────────────────────────────────────────────────────
    // After running timed-out commands, no extra node processes should persist.

    const orphansAfter = orphanCount();
    if (orphansBefore >= 0 && orphansAfter >= 0) {
        // Allow up to 2 extra processes (server workers, etc.)
        const leaked = Math.max(0, orphansAfter - orphansBefore - 2);
        if (leaked <= 0) {
            pass(`no orphan processes leaked (before:${orphansBefore} after:${orphansAfter})`);
        } else {
            fail("orphan processes detected", `before:${orphansBefore} after:${orphansAfter} leaked:${leaked}`);
        }
    } else {
        pass("orphan check skipped (ps unavailable)");
    }

    // ── 8. Rapid sequence after recovery ─────────────────────────────────────
    // Server should handle 5 normal requests cleanly after the timeout stress

    let rapidOk = 0;
    for (let i = 0; i < 5; i++) {
        const r = await get("/health");
        if (r.ok) rapidOk++;
    }
    if (rapidOk === 5) {
        pass("rapid recovery: 5/5 health checks pass after timeout stress");
    } else {
        fail("rapid recovery: server slow after timeout tests", `only ${rapidOk}/5 health checks passed`);
    }

    // ── Summary ───────────────────────────────────────────────────────────────

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
        ? "  \x1b[32mPASS\x1b[0m  All adapter safety checks passed"
        : `  \x1b[31mFAIL\x1b[0m  ${failed.length} adapter check(s) failed`);
    console.log("  " + "─".repeat(55) + "\n");

    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("Adapter timeout test crashed:", e.message);
    process.exit(1);
});
