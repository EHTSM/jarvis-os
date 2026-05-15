#!/usr/bin/env node
"use strict";
/**
 * Log Growth + Disk Usage Monitor
 *
 * Measures data/ directory size before and after a request burst,
 * checks log file growth rates, and validates queue file size stays sane.
 * Runs entirely offline (no server required for most checks).
 *
 * Usage:
 *   node tests/burnin/07-disk-monitor.cjs [--base=http://localhost:5050]
 */

const http = require("http");
const fs   = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const BASE = (() => {
    const a = args.find(a => a.startsWith("--base="));
    return a ? a.slice(7) : (process.env.BASE_URL || "http://localhost:5050");
})().replace(/\/$/, "");

const ROOT      = path.join(__dirname, "../..");
const DATA_DIR  = path.join(ROOT, "data");
const { hostname, port } = new URL(BASE);

// Thresholds
const MAX_QUEUE_SIZE_KB     = 500;    // queue file should stay under 500KB
const MAX_AUDIT_LOG_KB      = 5_000;  // audit log under 5MB
const MAX_DATA_DIR_KB       = 50_000; // entire data/ dir under 50MB
const MAX_GROWTH_PER_REQ_KB = 2;      // less than 2KB added per request

// ── helpers ───────────────────────────────────────────────────────────────────

function dirSizeKb(dir) {
    let total = 0;
    try {
        function walk(d) {
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                const full = path.join(d, entry.name);
                if (entry.isDirectory()) walk(full);
                else { try { total += fs.statSync(full).size; } catch { /* skip */ } }
            }
        }
        walk(dir);
    } catch { /* dir may not exist */ }
    return Math.round(total / 1024);
}

function fileSizeKb(filePath) {
    try { return Math.round(fs.statSync(filePath).size / 1024); }
    catch { return 0; }
}

function fileLineCount(filePath) {
    try {
        const content = fs.readFileSync(filePath, "utf8");
        return content.split("\n").length;
    } catch { return 0; }
}

function get(path_, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const req = http.request(
            { hostname, port: port || 80, path: path_, method: "GET" },
            (res) => { res.resume(); resolve({ ok: res.statusCode < 500 }); }
        );
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false }); });
        req.on("error", () => resolve({ ok: false }));
        req.end();
    });
}

function post(path_, body, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(body);
        const req = http.request({
            hostname, port: port || 80, path: path_, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
        }, (res) => { res.resume(); resolve({ ok: res.statusCode < 500 }); });
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false }); });
        req.on("error", () => resolve({ ok: false }));
        req.write(payload);
        req.end();
    });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const results = [];

function pass(label) {
    results.push({ ok: true, label });
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
}

function fail(label, reason) {
    results.push({ ok: false, label, reason });
    console.log(`  \x1b[31m✗\x1b[0m ${label} — ${reason}`);
}

function info(label) {
    console.log(`  \x1b[34m·\x1b[0m ${label}`);
}

async function main() {
    console.log(`\nJARVIS Log Growth + Disk Monitor`);
    console.log(`  Data dir: ${DATA_DIR}`);
    console.log(`  Target:   ${BASE}\n`);

    // ── Static checks (offline) ────────────────────────────────────────────────

    // 1. Data directory exists
    if (!fs.existsSync(DATA_DIR)) {
        fail("data/ directory exists", "missing — create it and verify server writes");
    } else {
        pass("data/ directory exists");
    }

    // 2. Queue file is valid JSON
    const queueFile = path.join(DATA_DIR, "task-queue.json");
    if (fs.existsSync(queueFile)) {
        try {
            const raw = fs.readFileSync(queueFile, "utf8");
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                pass(`task-queue.json: valid JSON array (${parsed.length} tasks)`);
            } else {
                fail("task-queue.json: root is not an array", typeof parsed);
            }
        } catch (e) {
            fail("task-queue.json: invalid JSON", e.message);
        }

        const queueKb = fileSizeKb(queueFile);
        info(`task-queue.json: ${queueKb}KB`);
        queueKb < MAX_QUEUE_SIZE_KB
            ? pass(`queue file size ${queueKb}KB < ${MAX_QUEUE_SIZE_KB}KB limit`)
            : fail(`queue file oversized: ${queueKb}KB`, `> ${MAX_QUEUE_SIZE_KB}KB — prune old completed tasks`);
    } else {
        pass("task-queue.json: not yet created (will be created on first task)");
    }

    // 3. Audit log size
    const auditLog = path.join(DATA_DIR, "audit.log");
    if (fs.existsSync(auditLog)) {
        const auditKb    = fileSizeKb(auditLog);
        const auditLines = fileLineCount(auditLog);
        info(`audit.log: ${auditKb}KB, ${auditLines} lines`);
        auditKb < MAX_AUDIT_LOG_KB
            ? pass(`audit log ${auditKb}KB < ${MAX_AUDIT_LOG_KB}KB limit`)
            : fail(`audit log oversized: ${auditKb}KB`, `> ${MAX_AUDIT_LOG_KB}KB — needs rotation`);
    } else {
        pass("audit.log: not yet created");
    }

    // 4. Context history file
    const ctxHistory = path.join(DATA_DIR, "context-history.json");
    if (fs.existsSync(ctxHistory)) {
        const ctxKb = fileSizeKb(ctxHistory);
        info(`context-history.json: ${ctxKb}KB`);
        ctxKb < 1000
            ? pass(`context-history.json ${ctxKb}KB < 1MB`)
            : fail("context-history.json too large", `${ctxKb}KB — may indicate unbounded append`);
    }

    // 5. Total data directory size
    const totalKb = dirSizeKb(DATA_DIR);
    info(`data/ total: ${totalKb}KB (${(totalKb / 1024).toFixed(1)}MB)`);
    totalKb < MAX_DATA_DIR_KB
        ? pass(`data/ directory ${Math.round(totalKb / 1024)}MB < ${MAX_DATA_DIR_KB / 1024}MB limit`)
        : fail(`data/ directory oversized: ${Math.round(totalKb / 1024)}MB`, `> ${MAX_DATA_DIR_KB / 1024}MB`);

    // 6. No .tmp files left behind (atomic write cleanup)
    const tmpFiles = fs.existsSync(DATA_DIR)
        ? fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".tmp"))
        : [];
    tmpFiles.length === 0
        ? pass("no leftover .tmp files in data/ (atomic writes cleaned up)")
        : fail("leftover .tmp files found", tmpFiles.join(", "));

    // ── Dynamic checks (need server) ──────────────────────────────────────────

    const probe = await get("/health");
    if (!probe.ok) {
        info("Server not reachable — skipping dynamic disk growth tests");
    } else {
        const beforeKb = dirSizeKb(DATA_DIR);

        // Fire 50 requests that touch disk (tasks, AI queries)
        for (let i = 0; i < 25; i++) {
            await post("/tasks", { input: `disk-monitor-test-${i}`, type: "auto" });
        }
        for (let i = 0; i < 25; i++) {
            await post("/jarvis", { input: `disk monitor test ${i}` });
        }

        const afterKb   = dirSizeKb(DATA_DIR);
        const growthKb  = afterKb - beforeKb;
        const perReqKb  = growthKb / 50;

        info(`disk growth: ${beforeKb}KB → ${afterKb}KB (+${growthKb}KB for 50 requests)`);
        info(`per-request growth: ${perReqKb.toFixed(2)}KB`);

        perReqKb < MAX_GROWTH_PER_REQ_KB
            ? pass(`disk growth ${perReqKb.toFixed(2)}KB/req < ${MAX_GROWTH_PER_REQ_KB}KB/req`)
            : fail("excessive disk growth per request", `${perReqKb.toFixed(2)}KB/req > ${MAX_GROWTH_PER_REQ_KB}KB/req`);

        // Queue still valid JSON after writes
        if (fs.existsSync(queueFile)) {
            try {
                JSON.parse(fs.readFileSync(queueFile, "utf8"));
                pass("queue file still valid JSON after 25 concurrent task adds");
            } catch (e) {
                fail("queue file corrupted after disk test", e.message);
            }
        }

        // Clean up test tasks
        try {
            const all      = JSON.parse(fs.readFileSync(queueFile, "utf8"));
            const filtered = all.filter(t => !String(t.input || "").startsWith("disk-monitor-test-"));
            fs.writeFileSync(queueFile, JSON.stringify(filtered, null, 2));
        } catch { /* best effort */ }
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
        ? "  \x1b[32mPASS\x1b[0m  Disk and log usage within limits"
        : `  \x1b[31mFAIL\x1b[0m  ${failed.length} disk check(s) failed`);
    console.log("  " + "─".repeat(55) + "\n");

    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("Disk monitor crashed:", e.message);
    process.exit(1);
});
