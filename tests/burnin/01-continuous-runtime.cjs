#!/usr/bin/env node
"use strict";
/**
 * Continuous Runtime Monitor
 * Polls the server at a steady interval for a configurable duration.
 * Tracks error rate, latency drift, and memory growth over time.
 *
 * Usage:
 *   node tests/burnin/01-continuous-runtime.cjs [--minutes=480] [--idle]
 *
 *   --minutes=N   Total run duration (default: 480 = 8 hours)
 *   --idle        Low-frequency idle mode (1 req/min instead of 1 req/10s)
 *   --quick       2-minute quick validation run
 *
 * Exit 0 = pass, 1 = fail (error rate or memory growth exceeded thresholds)
 */

const http = require("http");

// ── Config ────────────────────────────────────────────────────────────────────

const args        = process.argv.slice(2);
const QUICK       = args.includes("--quick");
const IDLE        = args.includes("--idle");
const MINUTES     = (() => {
    if (QUICK)              return 2;
    const a = args.find(a => a.startsWith("--minutes="));
    if (a) return parseFloat(a.slice(10));
    const b = args.find(a => a.startsWith("--hours="));
    if (b) return parseFloat(b.slice(8)) * 60;
    return IDLE ? 1440 : 480;  // 24h idle, 8h standard
})();

const BASE        = (process.env.BASE_URL || "http://localhost:5050").replace(/\/$/, "");
const INTERVAL_MS = IDLE ? 60_000 : 10_000;
const ERROR_RATE_LIMIT  = 0.05;   // fail if > 5% errors
const MEMORY_DRIFT_LIMIT_MB_PER_HOUR = 10;

const { hostname, port, protocol } = new URL(BASE);

// ── HTTP helper ───────────────────────────────────────────────────────────────

function get(path, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const req   = http.request(
            { hostname, port: port || 80, path, method: "GET" },
            (res) => {
                let body = "";
                res.on("data", c => body += c);
                res.on("end", () => resolve({
                    ok:     res.statusCode < 500,
                    status: res.statusCode,
                    ms:     Date.now() - start,
                    body
                }));
            }
        );
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, ms: timeoutMs, body: "" }); });
        req.on("error", () => resolve({ ok: false, status: 0, ms: Date.now() - start, body: "" }));
        req.end();
    });
}

// ── Reporting ─────────────────────────────────────────────────────────────────

function hms(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`;
}

function p95(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.95)];
}

function printProgress(elapsed, total, stats) {
    const pct  = Math.round((elapsed / total) * 100);
    const bar  = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
    const rate = stats.total > 0 ? ((stats.errors / stats.total) * 100).toFixed(1) : "0.0";
    process.stdout.write(
        `\r[${bar}] ${pct}%  req:${stats.total}  err:${stats.errors}(${rate}%)  p95:${p95(stats.latencies)}ms  mem:${stats.lastMemMb}MB`
    );
}

// ── Sampling ──────────────────────────────────────────────────────────────────

let _memSamples   = [];
let _memStartTime = null;

async function sampleMemory() {
    const r = await get("/ops");
    if (!r.ok) return null;
    try {
        const data = JSON.parse(r.body);
        const mb   = data?.memory?.current?.heap_mb ?? null;
        if (mb !== null) {
            if (_memSamples.length === 0) _memStartTime = Date.now();
            _memSamples.push({ ts: Date.now(), mb });
        }
        return mb;
    } catch { return null; }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function main() {
    const mode = IDLE ? "idle" : QUICK ? "quick" : "standard";
    console.log(`\nJARVIS Continuous Runtime Monitor`);
    console.log(`  Mode:     ${mode}`);
    console.log(`  Duration: ${MINUTES < 60 ? MINUTES + "m" : (MINUTES / 60).toFixed(1) + "h"}`);
    console.log(`  Interval: ${INTERVAL_MS / 1000}s`);
    console.log(`  Target:   ${BASE}`);

    // Reachability check
    console.log("\nChecking server reachability...");
    const probe = await get("/health");
    if (!probe.ok) {
        console.error(`\nFATAL: Server not reachable at ${BASE} (${probe.status})`);
        console.error("Start the server before running burn-in tests.\n");
        process.exit(1);
    }
    console.log(`Server reachable. Status: ${probe.status}. Starting monitor...\n`);

    const startTs   = Date.now();
    const endTs     = startTs + MINUTES * 60_000;
    const stats     = { total: 0, errors: 0, latencies: [], lastMemMb: 0 };
    const snapshots = [];  // periodic summaries every 10 minutes

    let lastSnapshotMin = 0;
    let tick = 0;

    while (Date.now() < endTs) {
        const elapsed = Date.now() - startTs;

        // Health check every tick
        const h = await get("/health");
        stats.total++;
        if (!h.ok) stats.errors++;
        stats.latencies.push(h.ms);

        // Memory sample every 5 ticks
        if (tick % 5 === 0) {
            const mb = await sampleMemory();
            if (mb !== null) stats.lastMemMb = mb;
        }

        // Periodic snapshot every 10 minutes
        const elapsedMin = Math.floor(elapsed / 60_000);
        if (elapsedMin > 0 && elapsedMin % 10 === 0 && elapsedMin !== lastSnapshotMin) {
            lastSnapshotMin = elapsedMin;
            snapshots.push({
                min:    elapsedMin,
                errors: stats.errors,
                total:  stats.total,
                p95ms:  p95(stats.latencies),
                memMb:  stats.lastMemMb
            });
        }

        printProgress(elapsed, MINUTES * 60_000, stats);
        tick++;

        // Sleep until next interval, but cap at remaining time
        const remaining = endTs - Date.now();
        if (remaining <= 0) break;
        await new Promise(r => setTimeout(r, Math.min(INTERVAL_MS, remaining)));
    }

    // ── Final report ──────────────────────────────────────────────────────────

    console.log("\n\n" + "─".repeat(60));
    console.log("Continuous Runtime Report");
    console.log("─".repeat(60));
    console.log(`  Duration:    ${hms(Date.now() - startTs)}`);
    console.log(`  Total reqs:  ${stats.total}`);
    console.log(`  Errors:      ${stats.errors} (${stats.total > 0 ? ((stats.errors / stats.total) * 100).toFixed(2) : 0}%)`);
    console.log(`  p95 latency: ${p95(stats.latencies)}ms`);
    console.log(`  Final heap:  ${stats.lastMemMb}MB`);

    // Memory drift analysis
    let driftMbPerHour = null;
    if (_memSamples.length >= 2) {
        const first    = _memSamples[0];
        const last     = _memSamples[_memSamples.length - 1];
        const hours    = (last.ts - first.ts) / 3_600_000;
        driftMbPerHour = hours > 0 ? (last.mb - first.mb) / hours : 0;
        console.log(`  Mem drift:   ${driftMbPerHour.toFixed(2)} MB/hour (start:${first.mb}MB → end:${last.mb}MB)`);
    }

    // Periodic snapshots
    if (snapshots.length > 0) {
        console.log("\n  10-minute snapshots:");
        for (const s of snapshots) {
            const rate = ((s.errors / s.total) * 100).toFixed(1);
            console.log(`    t=${String(s.min).padStart(4)}m  err:${rate}%  p95:${s.p95ms}ms  heap:${s.memMb}MB`);
        }
    }

    // Pass/fail verdict
    const errorRate = stats.total > 0 ? stats.errors / stats.total : 0;
    const failures  = [];
    if (errorRate > ERROR_RATE_LIMIT) {
        failures.push(`error rate ${(errorRate * 100).toFixed(2)}% exceeded ${ERROR_RATE_LIMIT * 100}% limit`);
    }
    if (driftMbPerHour !== null && driftMbPerHour > MEMORY_DRIFT_LIMIT_MB_PER_HOUR) {
        failures.push(`memory drift ${driftMbPerHour.toFixed(2)} MB/h exceeded ${MEMORY_DRIFT_LIMIT_MB_PER_HOUR} MB/h limit`);
    }

    console.log("\n" + "─".repeat(60));
    if (failures.length === 0) {
        console.log("  \x1b[32mPASS\x1b[0m  Runtime stable for full duration");
    } else {
        console.log("  \x1b[31mFAIL\x1b[0m  Stability thresholds exceeded:");
        failures.forEach(f => console.log(`    - ${f}`));
    }
    console.log("─".repeat(60) + "\n");

    process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("\nMonitor crashed:", e.message);
    process.exit(1);
});
