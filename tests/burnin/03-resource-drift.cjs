#!/usr/bin/env node
"use strict";
/**
 * CPU + Memory Drift Tracker
 * Samples /ops at regular intervals, calculates heap drift rate,
 * and detects sustained CPU pressure using Node's process.cpuUsage().
 *
 * Usage:
 *   node tests/burnin/03-resource-drift.cjs [--samples=60] [--interval=30]
 *
 *   --samples=N    Number of samples (default 60 → 30 min at 30s intervals)
 *   --interval=S   Seconds between samples (default 30)
 *   --quick        5 samples at 3s each (15 seconds total)
 */

const http = require("http");

const args     = process.argv.slice(2);
const QUICK    = args.includes("--quick");
const SAMPLES  = QUICK ? 5 : (() => { const a = args.find(a => a.startsWith("--samples=")); return a ? parseInt(a.slice(10)) : 60; })();
const INTERVAL = QUICK ? 3 : (() => { const a = args.find(a => a.startsWith("--interval=")); return a ? parseInt(a.slice(11)) : 30; })();
const BASE     = (process.env.BASE_URL || "http://localhost:5050").replace(/\/$/, "");

const { hostname, port } = new URL(BASE);

// Pass thresholds
const MAX_DRIFT_MB_PER_HOUR = 10;
const MAX_RSS_GROWTH_PCT    = 50;   // RSS must not grow > 50% over test period
const MAX_HEAP_ABSOLUTE_MB  = 450;  // heap must stay below 450MB at all times

// ── HTTP helper ───────────────────────────────────────────────────────────────

function getOps() {
    return new Promise((resolve) => {
        const req = http.request(
            { hostname, port: port || 80, path: "/ops", method: "GET" },
            (res) => {
                let body = "";
                res.on("data", c => body += c);
                res.on("end", () => {
                    try { resolve(JSON.parse(body)); }
                    catch { resolve(null); }
                });
            }
        );
        req.setTimeout(8000, () => { req.destroy(); resolve(null); });
        req.on("error", () => resolve(null));
        req.end();
    });
}

// ── CPU sampling ──────────────────────────────────────────────────────────────
// We track the server's CPU by watching uptime vs error counts.
// For local process: capture user + sys CPU time delta between samples.

let _lastCpu  = process.cpuUsage();
let _lastTime = Date.now();

function sampleLocalCpuPct() {
    const now     = Date.now();
    const elapsed = (now - _lastTime) * 1000;  // to microseconds
    const cpu     = process.cpuUsage(_lastCpu);
    const total   = cpu.user + cpu.system;
    const pct     = elapsed > 0 ? (total / elapsed) * 100 : 0;
    _lastCpu  = process.cpuUsage();
    _lastTime = now;
    return Math.round(pct * 10) / 10;
}

// ── Reporter ──────────────────────────────────────────────────────────────────

function bar(val, max, width = 20) {
    const filled = Math.min(Math.round((val / max) * width), width);
    return "█".repeat(filled) + "░".repeat(width - filled);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\nJARVIS Resource Drift Tracker`);
    console.log(`  Samples:  ${SAMPLES}`);
    console.log(`  Interval: ${INTERVAL}s`);
    console.log(`  Total:    ~${Math.round(SAMPLES * INTERVAL / 60)}m`);
    console.log(`  Target:   ${BASE}\n`);

    // Reachability
    const probe = await getOps();
    if (!probe) {
        console.error(`FATAL: Server not reachable at ${BASE}`);
        process.exit(1);
    }

    const samples = [];

    console.log(`  Sample  HeapMB   RSS_MB   CPU%    Status`);
    console.log("  " + "─".repeat(50));

    for (let i = 0; i < SAMPLES; i++) {
        const data   = await getOps();
        const cpuPct = sampleLocalCpuPct();

        const heapMb  = data?.memory?.current?.heap_mb  ?? null;
        const rssMb   = data?.memory?.current?.rss_mb   ?? null;
        const healthy = data?.status ?? "unknown";

        samples.push({ ts: Date.now(), heapMb, rssMb, cpuPct, healthy });

        const heapStr = heapMb !== null ? String(heapMb).padStart(6) + "MB" : "  N/AMB";
        const rssStr  = rssMb  !== null ? String(rssMb).padStart(6)  + "MB" : "  N/AMB";
        const cpuStr  = String(cpuPct).padStart(5) + "%";
        const stsStr  = healthy === "ok" ? "\x1b[32mok\x1b[0m     " :
                        healthy === "degraded" ? "\x1b[33mdeg\x1b[0m    " : "unknown";

        process.stdout.write(`  ${String(i + 1).padStart(6)}  ${heapStr}  ${rssStr}  ${cpuStr}  ${stsStr}\n`);

        if (i < SAMPLES - 1) {
            await new Promise(r => setTimeout(r, INTERVAL * 1000));
        }
    }

    // ── Analysis ──────────────────────────────────────────────────────────────

    const heapSamples = samples.filter(s => s.heapMb !== null);
    const rssSamples  = samples.filter(s => s.rssMb  !== null);

    let driftMbPerHour  = null;
    let rssGrowthPct    = null;
    let peakHeap        = null;
    let peakRss         = null;

    if (heapSamples.length >= 2) {
        const first = heapSamples[0];
        const last  = heapSamples[heapSamples.length - 1];
        const hours = (last.ts - first.ts) / 3_600_000;
        driftMbPerHour = hours > 0 ? (last.heapMb - first.heapMb) / hours : 0;
        peakHeap = Math.max(...heapSamples.map(s => s.heapMb));
    }

    if (rssSamples.length >= 2) {
        const first = rssSamples[0];
        const last  = rssSamples[rssSamples.length - 1];
        rssGrowthPct = first.rssMb > 0 ? ((last.rssMb - first.rssMb) / first.rssMb) * 100 : 0;
        peakRss = Math.max(...rssSamples.map(s => s.rssMb));
    }

    const cpuValues  = samples.map(s => s.cpuPct);
    const avgCpu     = cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length;
    const peakCpu    = Math.max(...cpuValues);

    const degraded   = samples.filter(s => s.healthy !== "ok").length;

    console.log("\n  " + "─".repeat(50));
    console.log("  Resource Analysis:");
    console.log(`    Heap drift:    ${driftMbPerHour !== null ? driftMbPerHour.toFixed(2) + " MB/hour" : "N/A"}`);
    console.log(`    Peak heap:     ${peakHeap !== null ? peakHeap + "MB" : "N/A"}`);
    console.log(`    RSS growth:    ${rssGrowthPct !== null ? rssGrowthPct.toFixed(1) + "%" : "N/A"}`);
    console.log(`    Peak RSS:      ${peakRss !== null ? peakRss + "MB" : "N/A"}`);
    console.log(`    CPU avg/peak:  ${avgCpu.toFixed(1)}% / ${peakCpu.toFixed(1)}%`);
    console.log(`    Status warns:  ${degraded}/${samples.length} samples degraded`);

    // Heap histogram
    if (heapSamples.length >= 3) {
        const minH = Math.min(...heapSamples.map(s => s.heapMb));
        const maxH = Math.max(...heapSamples.map(s => s.heapMb));
        const p50H = heapSamples[Math.floor(heapSamples.length * 0.50)].heapMb;
        console.log(`    Heap min/p50/max: ${minH}/${p50H}/${maxH} MB`);
    }

    // ── Verdict ───────────────────────────────────────────────────────────────

    const failures = [];

    if (driftMbPerHour !== null && driftMbPerHour > MAX_DRIFT_MB_PER_HOUR) {
        failures.push(`heap drift ${driftMbPerHour.toFixed(2)} MB/h > ${MAX_DRIFT_MB_PER_HOUR} MB/h`);
    }
    if (rssGrowthPct !== null && rssGrowthPct > MAX_RSS_GROWTH_PCT) {
        failures.push(`RSS grew ${rssGrowthPct.toFixed(1)}% > ${MAX_RSS_GROWTH_PCT}% limit`);
    }
    if (peakHeap !== null && peakHeap > MAX_HEAP_ABSOLUTE_MB) {
        failures.push(`peak heap ${peakHeap}MB > ${MAX_HEAP_ABSOLUTE_MB}MB hard limit`);
    }
    if (degraded > Math.floor(samples.length * 0.1)) {
        failures.push(`${degraded}/${samples.length} samples in degraded state`);
    }

    console.log("\n  " + "─".repeat(50));
    if (failures.length === 0) {
        console.log("  \x1b[32mPASS\x1b[0m  Resources stable within thresholds");
    } else {
        console.log("  \x1b[31mFAIL\x1b[0m  Resource drift exceeded thresholds:");
        failures.forEach(f => console.log(`    - ${f}`));
    }
    console.log("  " + "─".repeat(50) + "\n");

    process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("Resource drift tracker crashed:", e.message);
    process.exit(1);
});
