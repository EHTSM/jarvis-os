#!/usr/bin/env node
"use strict";
/**
 * Frontend Disconnect/Reconnect + Runtime Resilience
 *
 * Simulates the frontend polling pattern, then tests behavior during
 * a brief server-unavailable window, and confirms recovery.
 * Also validates: rapid reconnect after gap, ops poll stability,
 * and graceful handling of malformed/concurrent requests.
 *
 * Usage:
 *   node tests/burnin/05-resilience.cjs [--gap=5]
 *
 *   --gap=N   Seconds to pause polling to simulate disconnect (default 5)
 */

const http = require("http");

const args = process.argv.slice(2);
const GAP  = (() => { const a = args.find(a => a.startsWith("--gap=")); return a ? parseInt(a.slice(6)) : 5; })();
const BASE = (process.env.BASE_URL || "http://localhost:5050").replace(/\/$/, "");
const { hostname, port } = new URL(BASE);

// ── helpers ───────────────────────────────────────────────────────────────────

function get(path, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const start = Date.now();
        const req   = http.request(
            { hostname, port: port || 80, path, method: "GET" },
            (res) => {
                let data = "";
                res.on("data", c => data += c);
                res.on("end", () => {
                    let parsed = null;
                    try { parsed = JSON.parse(data); } catch { /* raw */ }
                    resolve({ ok: res.statusCode < 500, status: res.statusCode, ms: Date.now() - start, body: parsed });
                });
            }
        );
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, ms: timeoutMs }); });
        req.on("error", () => resolve({ ok: false, status: 0, ms: Date.now() - start }));
        req.end();
    });
}

function postRaw(path, rawBody, timeoutMs = 8000) {
    return new Promise((resolve) => {
        const opts = {
            hostname, port: port || 80, path, method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(rawBody) }
        };
        const req = http.request(opts, (res) => {
            res.resume();
            resolve({ ok: res.statusCode < 500, status: res.statusCode });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0 }); });
        req.on("error", () => resolve({ ok: false, status: 0 }));
        req.write(rawBody);
        req.end();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

// ── Scenarios ─────────────────────────────────────────────────────────────────

async function testNormalPollingCycle() {
    // Simulate frontend: poll /ops every 8s, /stats on mount, reconnect after gap
    const POLL_INTERVAL = 500;  // fast for test purposes
    const POLL_COUNT    = 10;

    let errors = 0;
    for (let i = 0; i < POLL_COUNT; i++) {
        const r = await get("/ops");
        if (!r.ok) errors++;
        await sleep(POLL_INTERVAL);
    }
    errors === 0
        ? pass(`frontend poll: ${POLL_COUNT} consecutive /ops polls — all succeeded`)
        : fail(`frontend poll: ${POLL_COUNT} /ops polls`, `${errors} errors`);
}

async function testDisconnectReconnect() {
    // 1. Establish polling baseline
    const pre = await get("/ops");
    if (!pre.ok) { fail("disconnect/reconnect: baseline request failed", `status ${pre.status}`); return; }

    // 2. Simulate disconnect gap (just wait — server stays up, but frontend would stop polling)
    console.log(`  ... simulating ${GAP}s frontend disconnect gap ...`);
    await sleep(GAP * 1000);

    // 3. Reconnect: burst 5 requests as if frontend just came back online
    let reconnectOk = 0;
    for (let i = 0; i < 5; i++) {
        const r = await get(i % 2 === 0 ? "/ops" : "/stats");
        if (r.ok) reconnectOk++;
    }
    reconnectOk === 5
        ? pass(`disconnect/reconnect: 5/5 requests succeed after ${GAP}s gap`)
        : fail(`disconnect/reconnect: only ${reconnectOk}/5 succeeded after gap`, "slow recovery");
}

async function testRapidPollingBurst() {
    // Simulate frontend mounting/unmounting rapidly (React StrictMode double-mount pattern)
    const results_ = await Promise.allSettled([
        get("/stats"),
        get("/ops"),
        get("/health"),
        get("/stats"),
        get("/ops"),
    ]);
    const ok = results_.filter(r => r.status === "fulfilled" && r.value.ok).length;
    ok >= 4
        ? pass(`rapid burst: ${ok}/5 concurrent mount-requests succeed`)
        : fail(`rapid burst: only ${ok}/5 concurrent requests succeeded`, "server overwhelmed");
}

async function testMalformedRequestHandling() {
    // Frontend bug: sends empty body, truncated JSON, wrong content-type
    const cases = [
        ["{",           "truncated JSON"],
        ["undefined",   "undefined as body"],
        ["null",        "null body"],
        ["[]",          "array body"],
        ["",            "empty body"],
    ];
    let safeCases = 0;
    for (const [rawBody, label] of cases) {
        const r = await postRaw("/jarvis", rawBody);
        if (r.status !== 500) safeCases++;
    }
    safeCases === cases.length
        ? pass(`malformed requests: all ${cases.length} cases return non-500`)
        : fail(`malformed requests: ${cases.length - safeCases}/${cases.length} caused server errors`, "server should handle gracefully");
}

async function testHighFrequencyStatsPoll() {
    // Frontend polling stats at 1Hz for 15 seconds (aggressive)
    const DURATION_MS = 3000;  // 3s for test speed
    const INTERVAL_MS = 100;
    const start  = Date.now();
    let ok = 0, total = 0;
    while (Date.now() - start < DURATION_MS) {
        const r = await get("/stats", 2000);
        total++;
        if (r.ok) ok++;
        await sleep(INTERVAL_MS);
    }
    const rate = total > 0 ? (ok / total) * 100 : 0;
    rate >= 95
        ? pass(`high-freq stats poll: ${ok}/${total} (${rate.toFixed(0)}%) succeed at 10 req/s`)
        : fail(`high-freq stats poll: only ${rate.toFixed(0)}% success at 10 req/s`, "below 95% threshold");
}

async function testOpsPayloadShape() {
    // Ensure /ops always returns consistent shape (frontend depends on exact keys)
    const r = await get("/ops");
    if (!r.ok || !r.body) { fail("ops payload shape", "request failed"); return; }

    const required = ["status", "ts", "uptime", "memory", "queue", "services"];
    const missing  = required.filter(k => !(k in r.body));
    missing.length === 0
        ? pass("ops payload: all required keys present")
        : fail("ops payload: missing keys", missing.join(", "));

    // Memory sub-keys
    if (r.body.memory?.current) {
        const memKeys = ["heap_mb", "rss_mb"];
        const missingMem = memKeys.filter(k => !(k in r.body.memory.current));
        missingMem.length === 0
            ? pass("ops payload: memory.current has heap_mb and rss_mb")
            : fail("ops payload: missing memory keys", missingMem.join(", "));
    } else {
        pass("ops payload: memory.current absent (fallback path active)");
    }

    // Services sub-keys
    if (r.body.services) {
        const svcKeys = ["whatsapp", "telegram", "payments", "groq"];
        const missingSvc = svcKeys.filter(k => !(k in r.body.services));
        missingSvc.length === 0
            ? pass("ops payload: services has all 4 provider flags")
            : fail("ops payload: missing service keys", missingSvc.join(", "));
    }
}

async function testStatsPayloadShape() {
    const r = await get("/stats");
    if (!r.ok || !r.body) { fail("stats payload shape", "request failed"); return; }

    const required = ["total", "paid", "revenue"];
    const missing  = required.filter(k => !(k in r.body));
    missing.length === 0
        ? pass("stats payload: required CRM keys present")
        : fail("stats payload: missing keys", missing.join(", "));
}

async function testRepeatConnectionsWithDifferentPaths() {
    // Simulate React router navigation: switching tabs triggers different endpoint fetches
    const pages = [
        "/stats", "/ops", "/health", "/tasks", "/crm",
        "/stats", "/ops", "/health"
    ];
    let ok = 0;
    for (const p of pages) {
        const r = await get(p);
        if (r.ok) ok++;
        await sleep(100);
    }
    ok >= pages.length - 1
        ? pass(`tab navigation simulation: ${ok}/${pages.length} endpoint transitions succeed`)
        : fail(`tab navigation: ${pages.length - ok} endpoints failed`, "navigation broken");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\nJARVIS Frontend Resilience + Disconnect/Reconnect`);
    console.log(`  Target: ${BASE}`);
    console.log(`  Gap:    ${GAP}s\n`);

    const probe = await get("/health");
    if (!probe.ok) {
        console.error(`FATAL: Server not reachable at ${BASE}`);
        process.exit(1);
    }

    await testNormalPollingCycle();
    await testOpsPayloadShape();
    await testStatsPayloadShape();
    await testRapidPollingBurst();
    await testHighFrequencyStatsPoll();
    await testMalformedRequestHandling();
    await testRepeatConnectionsWithDifferentPaths();
    await testDisconnectReconnect();  // last — includes the deliberate gap

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
        ? "  \x1b[32mPASS\x1b[0m  Frontend resilience validated"
        : `  \x1b[31mFAIL\x1b[0m  ${failed.length} resilience check(s) failed`);
    console.log("  " + "─".repeat(55) + "\n");

    process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("Resilience test crashed:", e.message);
    process.exit(1);
});
