#!/usr/bin/env node
"use strict";
/**
 * JARVIS Long-Session Stability Test (2-hour compressed simulation)
 * Runs 720 polling cycles (mimics 8s ops poll × 720 = ~96 minutes),
 * interleaved with dispatch, queue, and history operations.
 * Reports heap drift, poll latency drift, and error rate.
 *
 * Usage: node tests/operator/03-long-session.cjs
 * Requires: backend running on localhost:5050
 */

const http = require("http");

const BASE       = "http://localhost:5050";
const CYCLES     = 720;      // 720 × 8s = ~96 min of operator time (run fast)
const BATCH_SIZE = 60;       // print a progress line every 60 cycles
const REPORT_OUT = "data/long-session-report.json";

// ── helpers ──────────────────────────────────────────────────────────────

function _request(method, path, body = null, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: "localhost", port: 5050,
            path, method,
            headers: { "Content-Type": "application/json" },
            timeout: timeoutMs,
        };
        const req = http.request(opts, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on("timeout",  () => { req.destroy(); reject(new Error("timeout")); });
        req.on("error",    (e) => reject(e));
        if (payload) req.write(payload);
        req.end();
    });
}

function _heapMB() {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

function _stats(arr) {
    if (!arr.length) return { avg: 0, p95: 0, min: 0, max: 0, n: 0 };
    const s = [...arr].sort((a, b) => a - b);
    const avg = Math.round(s.reduce((a, b) => a + b, 0) / s.length);
    const p95 = s[Math.floor(s.length * 0.95)] ?? s[s.length - 1];
    return { avg, p95, min: s[0], max: s[s.length - 1], n: s.length };
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
    const startMs    = Date.now();
    console.log(`\n=== JARVIS Long-Session Test (${CYCLES} cycles) ===\n`);

    // Verify server is up
    try {
        const h = await _request("GET", "/health");
        if (h.status !== 200) { console.error("Server not healthy — aborting"); process.exit(1); }
        console.log(`Backend up. Initial heap: ${_heapMB()} MB\n`);
    } catch (e) {
        console.error(`Cannot reach backend: ${e.message}`); process.exit(1);
    }

    // Metrics accumulators
    const opsLatencies      = [];
    const statusLatencies   = [];
    const dispatchLatencies = [];
    const queueLatencies    = [];
    const historyLatencies  = [];
    const heapSamples       = [];  // { cycle, heapMB }
    const errors            = [];  // { cycle, op, err }

    let opsOk = 0, opsFail = 0;
    let dispatchOk = 0, dispatchFail = 0;
    let queueOk = 0, queueFail = 0;

    // Dispatch commands that rotate to prevent caching bias
    const DISPATCH_CMDS = [
        "git status", "list files", "echo hello", "show time",
        "pwd", "echo test", "ls", "show me the date",
    ];

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
        // ── Ops poll (every cycle — simulates 8s interval) ────────────────
        const t0 = Date.now();
        try {
            const r = await _request("GET", "/ops");
            opsLatencies.push(Date.now() - t0);
            r.status === 200 ? opsOk++ : opsFail++;
        } catch (e) {
            opsLatencies.push(Date.now() - t0);
            opsFail++;
            errors.push({ cycle, op: "ops", err: e.message });
        }

        // ── Runtime status poll (every cycle) ─────────────────────────────
        const t1 = Date.now();
        try {
            await _request("GET", "/runtime/status");
            statusLatencies.push(Date.now() - t1);
        } catch { statusLatencies.push(Date.now() - t1); }

        // ── Dispatch (every 10 cycles) ─────────────────────────────────────
        if (cycle % 10 === 0) {
            const cmd = DISPATCH_CMDS[(cycle / 10) % DISPATCH_CMDS.length];
            const t2 = Date.now();
            try {
                const r = await _request("POST", "/runtime/dispatch", { input: cmd, timeoutMs: 10000 });
                dispatchLatencies.push(Date.now() - t2);
                r.status === 200 ? dispatchOk++ : dispatchFail++;
            } catch (e) {
                dispatchLatencies.push(Date.now() - t2);
                dispatchFail++;
                errors.push({ cycle, op: "dispatch", err: e.message });
            }
        }

        // ── Queue enqueue (every 15 cycles) ───────────────────────────────
        if (cycle % 15 === 0) {
            const t3 = Date.now();
            try {
                const r = await _request("POST", "/runtime/queue", { input: "background task", priority: 1 });
                queueLatencies.push(Date.now() - t3);
                r.status === 200 ? queueOk++ : queueFail++;
            } catch (e) {
                queueLatencies.push(Date.now() - t3);
                queueFail++;
                errors.push({ cycle, op: "queue", err: e.message });
            }
        }

        // ── History fetch (every 20 cycles) ───────────────────────────────
        if (cycle % 20 === 0) {
            const t4 = Date.now();
            try {
                await _request("GET", "/runtime/history?n=20");
                historyLatencies.push(Date.now() - t4);
            } catch { historyLatencies.push(Date.now() - t4); }
        }

        // ── Heap sample (every 60 cycles) ─────────────────────────────────
        if (cycle % 60 === 0) {
            const heap = _heapMB();
            heapSamples.push({ cycle, heapMB: heap });
        }

        // ── Progress log ──────────────────────────────────────────────────
        if (cycle % BATCH_SIZE === 0 || cycle === CYCLES) {
            const elapsed = Math.round((Date.now() - startMs) / 1000);
            const ops_s   = _stats(opsLatencies.slice(-BATCH_SIZE));
            const heap    = _heapMB();
            console.log(
                `  [cycle ${String(cycle).padStart(4)}/${CYCLES}]` +
                `  elapsed=${elapsed}s` +
                `  heap=${heap}MB` +
                `  ops avg/p95=${ops_s.avg}/${ops_s.p95}ms` +
                `  errors=${errors.length}`
            );
        }
    }

    // ── Results ───────────────────────────────────────────────────────────
    const totalMs   = Date.now() - startMs;
    const opsStats  = _stats(opsLatencies);
    const rtStats   = _stats(statusLatencies);
    const dspStats  = _stats(dispatchLatencies);
    const queStats  = _stats(queueLatencies);
    const histStats = _stats(historyLatencies);

    // Heap drift: difference between first and last heap sample
    const heapFirst = heapSamples[0]?.heapMB ?? _heapMB();
    const heapLast  = heapSamples[heapSamples.length - 1]?.heapMB ?? _heapMB();
    const heapDrift = heapLast - heapFirst;

    // Error rate
    const totalOps  = opsOk + opsFail + dispatchOk + dispatchFail + queueOk + queueFail;
    const errorRate = totalOps ? ((errors.length / totalOps) * 100).toFixed(2) : "0.00";

    console.log(`\n${"═".repeat(60)}`);
    console.log(`  Long-Session Report — ${CYCLES} cycles in ${Math.round(totalMs / 1000)}s`);
    console.log(`${"─".repeat(60)}`);
    console.log(`  Ops poll         : avg=${opsStats.avg}ms  p95=${opsStats.p95}ms  n=${opsStats.n}`);
    console.log(`  Runtime status   : avg=${rtStats.avg}ms   p95=${rtStats.p95}ms   n=${rtStats.n}`);
    console.log(`  Dispatch         : avg=${dspStats.avg}ms  p95=${dspStats.p95}ms  n=${dspStats.n}`);
    console.log(`  Queue enqueue    : avg=${queStats.avg}ms  p95=${queStats.p95}ms  n=${queStats.n}`);
    console.log(`  History fetch    : avg=${histStats.avg}ms p95=${histStats.p95}ms n=${histStats.n}`);
    console.log(`${"─".repeat(60)}`);
    console.log(`  Heap (first)     : ${heapFirst} MB`);
    console.log(`  Heap (last)      : ${heapLast} MB`);
    console.log(`  Heap drift       : ${heapDrift >= 0 ? "+" : ""}${heapDrift} MB  ${Math.abs(heapDrift) > 50 ? "⚠ WARNING: >50MB drift" : "✓ within bounds"}`);
    console.log(`${"─".repeat(60)}`);
    console.log(`  Ops success rate : ${opsOk}/${opsOk + opsFail} (${opsFail > 0 ? `⚠ ${opsFail} fail` : "✓ 100%"})`);
    console.log(`  Dispatch success : ${dispatchOk}/${dispatchOk + dispatchFail}`);
    console.log(`  Queue success    : ${queueOk}/${queueOk + queueFail}`);
    console.log(`  Total error rate : ${errorRate}%`);

    if (errors.length > 0) {
        console.log(`\n  Errors (first 10):`);
        errors.slice(0, 10).forEach(e => console.log(`    [cycle ${e.cycle}] ${e.op}: ${e.err}`));
    }

    const verdict =
        errors.length === 0 && Math.abs(heapDrift) <= 50
            ? "STABLE"
            : errors.length > 5 || Math.abs(heapDrift) > 100
                ? "UNSTABLE"
                : "MARGINAL";

    console.log(`\n  VERDICT: ${verdict}`);
    console.log(`${"═".repeat(60)}\n`);

    // Write report
    const report = {
        generated: new Date().toISOString(),
        cycles: CYCLES, totalMs,
        verdict,
        latency: {
            ops:      opsStats,
            status:   rtStats,
            dispatch: dspStats,
            queue:    queStats,
            history:  histStats,
        },
        heap: { first: heapFirst, last: heapLast, drift: heapDrift, samples: heapSamples },
        errors: { count: errors.length, rate: errorRate, list: errors.slice(0, 20) },
        successRates: {
            ops:      `${opsOk}/${opsOk + opsFail}`,
            dispatch: `${dispatchOk}/${dispatchOk + dispatchFail}`,
            queue:    `${queueOk}/${queueOk + queueFail}`,
        },
    };
    try {
        require("fs").writeFileSync(
            require("path").join(process.cwd(), REPORT_OUT),
            JSON.stringify(report, null, 2)
        );
        console.log(`  Report: ${REPORT_OUT}`);
    } catch (e) {
        console.warn(`  Report write failed: ${e.message}`);
    }

    process.exit(verdict === "UNSTABLE" ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
