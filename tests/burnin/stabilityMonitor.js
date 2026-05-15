"use strict";
/**
 * Stability Monitor
 *
 * Long-running runtime health sampler. Measures every INTERVAL_MS:
 *   - Heap + RSS memory
 *   - Event loop lag (actual vs expected timer fire)
 *   - CPU usage delta
 *   - File descriptor count
 *   - HTTP health endpoint latency
 *
 * Writes periodic JSON snapshots. On completion produces a structured
 * result object that burninRunner.js uses for report generation.
 *
 * Usage (standalone):
 *   node tests/burnin/stabilityMonitor.js [--minutes=N] [--idle] [--quick]
 *
 *   --minutes=N   Duration (default 480 = 8h). --idle default = 1440 = 24h.
 *   --idle        Low-frequency mode: 1 sample/min, no HTTP pressure
 *   --quick       5 samples at 2s each (10s total — for CI validation)
 *   --base=URL    Server base URL (default http://localhost:5050)
 *   --snapshot-dir=path  Override snapshot output dir
 */

const http       = require("http");
const fs         = require("fs");
const path       = require("path");
const { execSync } = require("child_process");

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT     = path.join(__dirname, "../..");
const _args    = process.argv.slice(2);

const QUICK    = _args.includes("--quick");
const IDLE     = _args.includes("--idle");

const MINUTES  = (() => {
    if (QUICK) return 10 / 60;  // 10 seconds
    const a = _args.find(a => a.startsWith("--minutes="));
    if (a) return parseFloat(a.slice(10));
    const b = _args.find(a => a.startsWith("--hours="));
    if (b) return parseFloat(b.slice(8)) * 60;
    return IDLE ? 1440 : 480;
})();

const BASE         = (_args.find(a => a.startsWith("--base="))?.slice(7) ?? (process.env.BASE_URL || "http://localhost:5050")).replace(/\/$/, "");
const INTERVAL_MS  = QUICK ? 2000 : IDLE ? 60_000 : 10_000;
const SNAP_DIR     = _args.find(a => a.startsWith("--snapshot-dir="))?.slice(15) ?? path.join(ROOT, "data");
const SNAP_FILE    = path.join(SNAP_DIR, "stability-snapshots.json");
const SNAP_EVERY   = QUICK ? 2 : 5;   // write snapshot file every N samples

// Thresholds
const LAG_WARN_MS          = 100;
const LAG_CRITICAL_MS      = 500;
const HEAP_DRIFT_PER_HOUR  = 10;    // MB/hr
const FD_GROWTH_LIMIT      = 50;    // max FD increase over run
const CPU_SPIKE_PCT        = 80;    // CPU% that counts as a spike
const ERROR_RATE_LIMIT     = 0.05;

// ── HTTP helper ───────────────────────────────────────────────────────────────

const { hostname, port } = (() => { try { return new URL(BASE); } catch { return { hostname: "localhost", port: "5050" }; } })();

function httpGet(urlPath, timeoutMs = 6000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const req   = http.request(
            { hostname, port: port || 80, path: urlPath, method: "GET" },
            (res) => {
                let body = "";
                res.on("data", c => body += c);
                res.on("end", () => {
                    let parsed = null;
                    try { parsed = JSON.parse(body); } catch { /* raw */ }
                    resolve({ ok: res.statusCode < 500, ms: Date.now() - start, body: parsed });
                });
            }
        );
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, ms: timeoutMs, body: null }); });
        req.on("error", () => resolve({ ok: false, ms: timeoutMs, body: null }));
        req.end();
    });
}

// ── Event loop lag ────────────────────────────────────────────────────────────
// Schedule a timer for INTERVAL_LAG_MS; actual fire delay - expected = lag.

const INTERVAL_LAG_MS = 100;
let   _lagExpected     = Date.now() + INTERVAL_LAG_MS;
let   _lagCurrent      = 0;

const _lagTimer = setInterval(() => {
    const now  = Date.now();
    _lagCurrent = Math.max(0, now - _lagExpected);
    _lagExpected = now + INTERVAL_LAG_MS;
}, INTERVAL_LAG_MS);
_lagTimer.unref();

// ── CPU tracking ──────────────────────────────────────────────────────────────

let _cpuLast     = process.cpuUsage();
let _cpuTimeLast = Date.now();

function sampleCpu() {
    const now     = Date.now();
    const elapsed = (now - _cpuTimeLast) * 1000; // → microseconds
    const usage   = process.cpuUsage(_cpuLast);
    const pct     = elapsed > 0 ? +((usage.user + usage.system) / elapsed * 100).toFixed(1) : 0;
    _cpuLast     = process.cpuUsage();
    _cpuTimeLast = now;
    return pct;
}

// ── File descriptor count ─────────────────────────────────────────────────────

function fdCount() {
    // Linux: /proc/self/fd
    try {
        return fs.readdirSync("/proc/self/fd").length;
    } catch { /* not Linux */ }
    // macOS: lsof
    try {
        const out = execSync(`lsof -p ${process.pid} 2>/dev/null | wc -l`, { encoding: "utf8", timeout: 3000 });
        return parseInt(out.trim(), 10) - 1; // subtract header line
    } catch { return -1; }
}

// ── Snapshot I/O ──────────────────────────────────────────────────────────────

function _writeSnapshots(samples) {
    try {
        const tmp = SNAP_FILE + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify({ ts: new Date().toISOString(), count: samples.length, samples }, null, 2));
        fs.renameSync(tmp, SNAP_FILE);
    } catch { /* non-critical — monitor keeps running */ }
}

// ── Sample collector ──────────────────────────────────────────────────────────

async function collectSample(idx) {
    const ts     = Date.now();
    const mem    = process.memoryUsage();
    const heapMb = +(mem.heapUsed  / 1_048_576).toFixed(1);
    const rssMb  = +(mem.rss       / 1_048_576).toFixed(1);
    const lag    = _lagCurrent;
    const cpu    = sampleCpu();
    const fds    = fdCount();

    let httpMs   = -1;
    let httpOk   = null;
    let remoteHeap = null;

    if (!IDLE || idx % 6 === 0) {  // idle mode: only HTTP every 6 samples
        const r = await httpGet("/ops");
        httpOk  = r.ok;
        httpMs  = r.ms;
        remoteHeap = r.body?.memory?.current?.heap_mb ?? null;
    }

    return { idx, ts, heapMb, rssMb, lagMs: lag, cpuPct: cpu, fds, httpMs, httpOk, remoteHeap };
}

// ── Analysis ──────────────────────────────────────────────────────────────────

function analyse(samples, startTs, endTs) {
    const heapArr  = samples.map(s => s.heapMb);
    const rssArr   = samples.map(s => s.rssMb);
    const lagArr   = samples.map(s => s.lagMs);
    const cpuArr   = samples.map(s => s.cpuPct);
    const fdsValid = samples.filter(s => s.fds >= 0).map(s => s.fds);
    const httpSam  = samples.filter(s => s.httpOk !== null);

    const avg  = arr => arr.length ? +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 0;
    const max  = arr => arr.length ? Math.max(...arr) : 0;
    const min  = arr => arr.length ? Math.min(...arr) : 0;
    const p95  = arr => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)]; };

    // Linear heap drift (simple least squares)
    let driftMbPerHour = 0;
    if (heapArr.length >= 2) {
        const n   = heapArr.length;
        const xs  = samples.map((_, i) => i);
        const xm  = avg(xs);
        const ym  = avg(heapArr);
        const num = xs.reduce((acc, x, i) => acc + (x - xm) * (heapArr[i] - ym), 0);
        const den = xs.reduce((acc, x) => acc + Math.pow(x - xm, 2), 0);
        const slopePerSample = den > 0 ? num / den : 0;
        const samplesPerHour = 3600_000 / INTERVAL_MS;
        driftMbPerHour = +(slopePerSample * samplesPerHour).toFixed(2);
    }

    const durationHours = (endTs - startTs) / 3_600_000;
    const httpErrors    = httpSam.filter(s => !s.httpOk).length;
    const errorRate     = httpSam.length > 0 ? httpErrors / httpSam.length : 0;
    const cpuSpikes     = cpuArr.filter(c => c >= CPU_SPIKE_PCT).length;
    const lagSpikes     = lagArr.filter(l => l >= LAG_CRITICAL_MS).length;
    const lagWarns      = lagArr.filter(l => l >= LAG_WARN_MS && l < LAG_CRITICAL_MS).length;
    const fdGrowth      = fdsValid.length >= 2 ? fdsValid[fdsValid.length - 1] - fdsValid[0] : 0;

    const failures = [];
    if (driftMbPerHour > HEAP_DRIFT_PER_HOUR)      failures.push(`heap drift ${driftMbPerHour} MB/hr > ${HEAP_DRIFT_PER_HOUR} MB/hr limit`);
    if (errorRate > ERROR_RATE_LIMIT)               failures.push(`HTTP error rate ${(errorRate * 100).toFixed(1)}% > ${ERROR_RATE_LIMIT * 100}% limit`);
    if (lagSpikes > 5)                              failures.push(`${lagSpikes} critical event loop lag spikes (≥${LAG_CRITICAL_MS}ms)`);
    if (fdGrowth > FD_GROWTH_LIMIT)                 failures.push(`FD count grew ${fdGrowth} (> ${FD_GROWTH_LIMIT} limit — potential leak)`);
    if (max(heapArr) > 450)                         failures.push(`peak heap ${max(heapArr)}MB exceeded 450MB hard limit`);

    return {
        duration: { hours: +durationHours.toFixed(2), sampleCount: samples.length },
        memory: {
            heap: { min: min(heapArr), max: max(heapArr), avg: avg(heapArr), driftMbPerHour },
            rss:  { min: min(rssArr),  max: max(rssArr),  avg: avg(rssArr)  }
        },
        eventLoop: {
            avgLagMs: avg(lagArr), p95LagMs: p95(lagArr), maxLagMs: max(lagArr),
            warnCount: lagWarns, spikeCount: lagSpikes
        },
        cpu: { avg: avg(cpuArr), max: max(cpuArr), spikeCount: cpuSpikes },
        fds: { start: fdsValid[0] ?? -1, end: fdsValid[fdsValid.length - 1] ?? -1, growth: fdGrowth },
        http: {
            sampleCount: httpSam.length, errors: httpErrors,
            errorRate: +(errorRate * 100).toFixed(2),
            avgMs: avg(httpSam.map(s => s.httpMs)), p95Ms: p95(httpSam.map(s => s.httpMs))
        },
        passed: failures.length === 0,
        failures
    };
}

// ── Main run loop ─────────────────────────────────────────────────────────────

async function run() {
    const startTs  = Date.now();
    const endTs    = startTs + MINUTES * 60_000;
    const samples  = [];
    const mode     = QUICK ? "quick" : IDLE ? "idle" : "standard";

    if (require.main === module) {
        console.log(`\nStability Monitor — ${mode} mode`);
        console.log(`  Duration: ${MINUTES < 1 ? (MINUTES * 60).toFixed(0) + "s" : MINUTES + "m"}`);
        console.log(`  Interval: ${INTERVAL_MS / 1000}s`);
        console.log(`  Target:   ${BASE}`);
        console.log(`  Snapshots → ${SNAP_FILE}\n`);
        console.log("  #     HeapMB   RSS_MB  LagMs  CPU%  FDs  HTTP_ms  Status");
        console.log("  " + "─".repeat(60));
    }

    let idx = 0;

    while (Date.now() < endTs) {
        const sample = await collectSample(idx++);
        samples.push(sample);

        if (require.main === module) {
            const lag  = String(sample.lagMs).padStart(5);
            const heap = String(sample.heapMb).padStart(6);
            const rss  = String(sample.rssMb).padStart(6);
            const cpu  = String(sample.cpuPct).padStart(4);
            const fds  = sample.fds >= 0 ? String(sample.fds).padStart(4) : "  —";
            const hms  = sample.httpMs >= 0 ? String(sample.httpMs).padStart(7) : "     —";
            const ok   = sample.httpOk === null ? " " :
                         sample.httpOk ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
            const warn = sample.lagMs >= LAG_CRITICAL_MS ? " \x1b[31m!LAG\x1b[0m" :
                         sample.lagMs >= LAG_WARN_MS      ? " \x1b[33m~lag\x1b[0m" : "";
            process.stdout.write(`  ${String(idx).padStart(3)}  ${heap}MB  ${rss}MB ${lag}ms ${cpu}%  ${fds}  ${hms}ms  ${ok}${warn}\n`);
        }

        if (idx % SNAP_EVERY === 0) _writeSnapshots(samples);

        const remaining = endTs - Date.now();
        if (remaining <= 0) break;
        await new Promise(r => setTimeout(r, Math.min(INTERVAL_MS, remaining)));
    }

    _writeSnapshots(samples);
    clearInterval(_lagTimer);

    const result = analyse(samples, startTs, Date.now());

    if (require.main === module) {
        console.log("\n  " + "─".repeat(60));
        console.log("  Analysis:");
        console.log(`    Heap drift:       ${result.memory.heap.driftMbPerHour} MB/hr (min:${result.memory.heap.min} max:${result.memory.heap.max} MB)`);
        console.log(`    Event loop lag:   avg:${result.eventLoop.avgLagMs}ms  p95:${result.eventLoop.p95LagMs}ms  max:${result.eventLoop.maxLagMs}ms`);
        console.log(`    CPU:              avg:${result.cpu.avg}%  max:${result.cpu.max}%  spikes:${result.cpu.spikeCount}`);
        console.log(`    File descriptors: ${result.fds.start} → ${result.fds.end} (Δ${result.fds.growth})`);
        console.log(`    HTTP error rate:  ${result.http.errorRate}%  p95:${result.http.p95Ms}ms`);
        console.log(`    Lag spikes:       warns:${result.eventLoop.warnCount}  critical:${result.eventLoop.spikeCount}`);

        console.log("\n  " + "─".repeat(60));
        if (result.passed) {
            console.log("  \x1b[32mPASS\x1b[0m  Runtime stable for full duration");
        } else {
            console.log("  \x1b[31mFAIL\x1b[0m  Stability thresholds exceeded:");
            result.failures.forEach(f => console.log(`    - ${f}`));
        }
        console.log("  " + "─".repeat(60) + "\n");
        process.exit(result.passed ? 0 : 1);
    }

    return { samples, analysis: result };
}

// ── Export for burninRunner.js ─────────────────────────────────────────────────

module.exports = { run, analyse, fdCount, sampleCpu, INTERVAL_MS, SNAP_FILE };

// Run standalone
if (require.main === module) {
    run().catch(e => { console.error("Monitor crashed:", e.message); process.exit(1); });
}
