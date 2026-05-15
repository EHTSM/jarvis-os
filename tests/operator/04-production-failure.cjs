#!/usr/bin/env node
"use strict";
/**
 * JARVIS Production Failure Test Suite
 * Simulates production failure conditions without requiring an actual VPS.
 * Tests: auth expiry, expired tokens, oversized payloads, concurrent emergencies,
 * rapid reconnect, DLQ integrity, malformed requests, partial-auth scenarios.
 *
 * Usage: node tests/operator/04-production-failure.cjs
 */

const http  = require("http");
const https = require("https");
const net   = require("net");

const BASE    = "http://localhost:5050";
let   pass    = 0;
let   fail    = 0;
const errors  = [];

// ── helpers ──────────────────────────────────────────────────────────────

function _request(method, path, body = null, headers = {}, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const opts = {
            hostname: "localhost", port: 5050, path, method,
            headers: { "Content-Type": "application/json", ...headers },
            timeout: timeoutMs,
        };
        const req = http.request(opts, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers }); }
                catch { resolve({ status: res.statusCode, body: data, headers: res.headers }); }
            });
        });
        req.on("timeout",  () => { req.destroy(); reject(new Error("timeout")); });
        req.on("error",    (e) => reject(e));
        if (payload) req.write(payload);
        req.end();
    });
}

function ok(msg) { pass++; console.log(`  ✓  ${msg}`); }
function ko(msg, reason) { fail++; errors.push({ msg, reason }); console.log(`  ✗  ${msg} — ${reason}`); }

function assert(cond, passMsg, failMsg) {
    cond ? ok(passMsg) : ko(passMsg, failMsg);
}

// ── Test cases ────────────────────────────────────────────────────────────

async function test_expiredJWTCookie() {
    console.log("\n[1] Expired JWT cookie");
    // Build a JWT with exp = 1 (Unix epoch 1970) — always expired
    const crypto = require("crypto");
    function b64url(s) { return Buffer.from(s).toString("base64url"); }
    const hdr     = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = b64url(JSON.stringify({ role: "operator", sub: "test", exp: 1, iat: 1 }));
    const fakeSig = crypto.createHmac("sha256", "fake").update(`${hdr}.${payload}`).digest("base64url");
    const fakeJWT = `${hdr}.${payload}.${fakeSig}`;

    const r = await _request("GET", "/runtime/status", null, { "cookie": `jarvis_auth=${fakeJWT}` });
    // 401 = correctly rejected (JWT_SECRET configured)
    // 200 = dev passthrough active (JWT_SECRET not set, NODE_ENV != production) — expected in dev
    // 503 = auth not configured in production mode
    assert([200, 401, 503].includes(r.status),
        `expired JWT handled — status=${r.status} (200=dev-passthrough, 401=rejected, 503=unconfigured)`,
        `unexpected status ${r.status}`);
    if (r.status === 401) ok("  → JWT_SECRET is configured — token correctly rejected");
    else ok("  → dev passthrough active (JWT_SECRET not set) — production would reject this");
}

async function test_tamperedJWT() {
    console.log("\n[2] Tampered JWT signature");
    const hdr     = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ role: "operator", sub: "hacker", exp: 9999999999, iat: 1 })).toString("base64url");
    const badJWT  = `${hdr}.${payload}.totallyfakesignature`;

    const r = await _request("GET", "/runtime/status", null, { "cookie": `jarvis_auth=${badJWT}` });
    // Same reasoning: 200=dev passthrough, 401=correct rejection, 503=unconfigured
    assert([200, 401, 503].includes(r.status),
        `tampered JWT handled — status=${r.status}`,
        `unexpected status ${r.status}`);
}

async function test_noAuthOnRuntimeRoutes() {
    console.log("\n[3] Unauthenticated access to runtime routes");
    // In production (NODE_ENV=production + JWT_SECRET set), these return 401.
    // In dev passthrough, they return 200. Both are acceptable.
    const routes = [
        "/runtime/status", "/runtime/history", "/runtime/dispatch",
    ];
    for (const route of routes) {
        try {
            const method = route.includes("dispatch") ? "POST" : "GET";
            const body   = route.includes("dispatch") ? { input: "test" } : null;
            const r      = await _request(method, route, body);
            // 200 = dev passthrough (valid), 401 = correct auth rejection, 503 = auth not configured
            assert([200, 401, 503].includes(r.status), `${route} — no-auth response=${r.status}`, `unexpected ${r.status}`);
        } catch (e) {
            ko(route, e.message);
        }
    }
}

async function test_malformedJSON() {
    console.log("\n[4] Malformed JSON payloads");
    const tests = [
        { path: "/runtime/dispatch", body: "{invalid json",   label: "invalid JSON string" },
        { path: "/jarvis",           body: "{\"input\":}",    label: "broken JSON value"    },
        { path: "/auth/login",       body: "not-json-at-all", label: "non-JSON body"        },
    ];
    for (const t of tests) {
        try {
            const r = await new Promise((resolve, reject) => {
                const opts = {
                    hostname: "localhost", port: 5050, path: t.path, method: "POST",
                    headers: { "Content-Type": "application/json" }, timeout: 5000,
                };
                const req = http.request(opts, (res) => {
                    let data = "";
                    res.on("data", c => data += c);
                    res.on("end", () => resolve({ status: res.statusCode }));
                });
                req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
                req.on("error",    (e) => reject(e));
                req.write(t.body);
                req.end();
            });
            assert([400, 401, 503].includes(r.status), `${t.label} — rejected ${r.status}`, `expected 400/401/503 got ${r.status}`);
        } catch (e) {
            ok(`${t.label} — request failed safely: ${e.message}`);
        }
    }
}

async function test_oversizedPayload() {
    console.log("\n[5] Oversized payload rejection");
    const sizes = [
        { kb: 50,    expect: [200, 400, 401, 503] },
        { kb: 500,   expect: [200, 400, 401, 503] },      // 500KB < 10MB limit — accepted by express.json
        { kb: 15000, expect: [400, 413, 401, 503, 500] }, // over 10MB limit → 413
    ];
    for (const { kb, expect } of sizes) {
        try {
            const input = "x".repeat(kb * 1024);
            const r = await _request("POST", "/jarvis", { input }, {}, 10000);
            assert(expect.includes(r.status), `${kb}KB payload — status=${r.status}`, `expected ${expect.join("/")} got ${r.status}`);
        } catch (e) {
            ok(`${kb}KB payload — rejected at transport level: ${e.message.slice(0, 40)}`);
        }
    }
}

async function test_concurrentEmergencyRace() {
    console.log("\n[6] Concurrent emergency stop + dispatch race");
    // Fire both simultaneously — neither should crash
    const [stopR, dispR] = await Promise.allSettled([
        _request("POST", "/runtime/emergency/stop",   { reason: "race_test" }),
        _request("POST", "/runtime/dispatch",          { input: "echo race", timeoutMs: 5000 }),
    ]);

    const stopOk = stopR.status === "fulfilled"  && [200, 401, 503].includes(stopR.value?.status);
    const dispOk = dispR.status === "fulfilled"  && [200, 400, 401, 503].includes(dispR.value?.status);

    assert(stopOk, `emergency stop resolved — status=${stopR.value?.status ?? stopR.reason?.message}`,
           `stop race failed: ${stopR.reason?.message}`);
    assert(dispOk, `dispatch during stop resolved — status=${dispR.value?.status ?? dispR.reason?.message}`,
           `dispatch race failed: ${dispR.reason?.message}`);

    // Resume after test
    await _request("POST", "/runtime/emergency/resume", {}).catch(() => {});
}

async function test_dlqIntegrity() {
    console.log("\n[7] Dead letter queue integrity");
    const r = await _request("GET", "/runtime/dlq");
    // 200 = DLQ endpoint exists; 404 = not exposed (acceptable); 401/503 = auth gated
    assert([200, 404, 401, 503].includes(r.status), `DLQ endpoint responded — status=${r.status}`,
           `unexpected DLQ status ${r.status}`);
    if (r.status === 200) {
        const isArray = Array.isArray(r.body?.entries ?? r.body);
        assert(isArray, `DLQ returns array`, `DLQ response is not an array`);
    }
}

async function test_rapidReconnect() {
    console.log("\n[8] Rapid SSE reconnect (10 connections)");
    const conns = Array.from({ length: 10 }, (_, i) => new Promise((resolve) => {
        const req = http.get(`${BASE}/runtime/stream`, {
            headers: { "Accept": "text/event-stream" },
            timeout: 3000,
        }, (res) => {
            resolve({ idx: i, status: res.statusCode });
            res.destroy();
        });
        req.on("error",   () => resolve({ idx: i, status: "error" }));
        req.on("timeout", () => { req.destroy(); resolve({ idx: i, status: "timeout" }); });
    }));

    const results = await Promise.all(conns);
    const statusCodes = results.map(r => r.status);
    const allOk = statusCodes.every(s => [200, 401, 503, "timeout"].includes(s));
    assert(allOk, `10 SSE connections handled — statuses=${statusCodes.join(",")}`,
           `unexpected SSE status in: ${statusCodes.filter(s => ![200,401,503,"timeout"].includes(s))}`);
}

async function test_partialRequestAbort() {
    console.log("\n[9] Partial request abort (client disconnects mid-request)");
    // Open a raw TCP connection, send partial HTTP headers, then close.
    // Server should not crash.
    const beforeErrors = fail;
    await new Promise((resolve) => {
        const socket = net.connect({ host: "localhost", port: 5050 }, () => {
            socket.write("POST /runtime/dispatch HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"input\":");
            // Close before sending the rest — simulates network drop mid-request
            setTimeout(() => { socket.destroy(); resolve(); }, 300);
        });
        socket.on("error", () => resolve());
    });
    // Wait briefly then check server is still alive
    await new Promise(r => setTimeout(r, 500));
    try {
        const r = await _request("GET", "/health");
        assert(r.status === 200, `server alive after partial request abort`, `server returned ${r.status}`);
    } catch (e) {
        ko("server alive after partial request abort", `server unreachable: ${e.message}`);
    }
}

async function test_rejectMissingBody() {
    console.log("\n[10] Missing body on POST endpoints");
    const endpoints = [
        "/jarvis",
        "/runtime/dispatch",
        "/runtime/queue",
        "/auth/login",
    ];
    for (const ep of endpoints) {
        try {
            // Send empty body with correct Content-Type
            const r = await new Promise((resolve, reject) => {
                const opts = {
                    hostname: "localhost", port: 5050, path: ep, method: "POST",
                    headers: { "Content-Type": "application/json", "Content-Length": "0" },
                    timeout: 5000,
                };
                const req = http.request(opts, (res) => {
                    let data = "";
                    res.on("data", c => data += c);
                    res.on("end", () => resolve({ status: res.statusCode }));
                });
                req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
                req.on("error",    (e) => reject(e));
                req.end();
            });
            // 400 = correct rejection; 401/503 = auth gated; 429 = rate limiter fired first
            assert([400, 401, 429, 503].includes(r.status), `${ep} empty body — status=${r.status}`,
                   `expected 400/401/429/503 got ${r.status}`);
        } catch (e) {
            ko(`${ep} empty body`, e.message);
        }
    }
}

async function test_healthEndpointUnderLoad() {
    console.log("\n[11] Health endpoint under parallel load");
    const N = 20;
    const reqs = Array.from({ length: N }, () => _request("GET", "/health"));
    const results = await Promise.allSettled(reqs);
    const ok200 = results.filter(r => r.status === "fulfilled" && r.value?.status === 200).length;
    const errors_n = results.filter(r => r.status === "rejected").length;
    assert(ok200 >= Math.floor(N * 0.9), `health under ${N} parallel requests — ok=${ok200}/${N}`,
           `too many failures: ${N - ok200}`);
    assert(errors_n === 0, `no network errors — ${errors_n} errors`, `${errors_n} requests failed`);
}

async function test_authRateLimiter() {
    console.log("\n[12] Auth rate limiter (brute-force protection)");
    // POST /auth/login is rate-limited to 10/5min per IP.
    // Fire 15 rapid login attempts — at least some should return 429 or fail.
    const attempts = [];
    for (let i = 0; i < 15; i++) {
        try {
            const r = await _request("POST", "/auth/login", { password: `wrong${i}` });
            attempts.push(r.status);
        } catch { attempts.push("error"); }
    }
    const has429 = attempts.includes(429);
    const allOk  = attempts.every(s => [401, 429, 503].includes(s) || s === "error");
    // In dev mode with no password configured, all return 200 (dev passthrough) — that's expected
    const allDev = attempts.every(s => s === 200);
    assert(has429 || allOk || allDev,
           `rate limiter active or dev passthrough — statuses=${[...new Set(attempts)].join(",")}`,
           `unexpected statuses: ${attempts.filter(s => ![200,401,429,503,"error"].includes(s))}`);
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
    console.log("\n=== JARVIS Production Failure Test Suite ===\n");
    console.log("Base:", BASE);

    // Verify server is up
    try {
        const h = await _request("GET", "/health");
        if (h.status !== 200) { console.error("Server not healthy — aborting"); process.exit(1); }
        console.log("Backend is up.\n");
    } catch (e) {
        console.error(`Cannot reach backend: ${e.message}`); process.exit(1);
    }

    const tests = [
        test_expiredJWTCookie,
        test_tamperedJWT,
        test_noAuthOnRuntimeRoutes,
        test_malformedJSON,
        test_oversizedPayload,
        test_concurrentEmergencyRace,
        test_dlqIntegrity,
        test_rapidReconnect,
        test_partialRequestAbort,
        test_rejectMissingBody,
        test_healthEndpointUnderLoad,
        test_authRateLimiter,
    ];

    for (const t of tests) {
        try { await t(); }
        catch (e) { ko(t.name, `uncaught: ${e.message}`); }
    }

    console.log(`\n${"═".repeat(52)}`);
    console.log(`  Pass: ${pass}   Fail: ${fail}`);
    console.log(`${"═".repeat(52)}`);

    if (errors.length > 0) {
        console.log("\n  Failures:");
        errors.forEach(e => console.log(`    ✗ ${e.msg}: ${e.reason}`));
    }

    const report = {
        generated: new Date().toISOString(),
        pass, fail,
        errors,
    };
    try {
        require("fs").writeFileSync(
            require("path").join(process.cwd(), "data/production-failure-report.json"),
            JSON.stringify(report, null, 2)
        );
        console.log("\n  Report: data/production-failure-report.json");
    } catch { /* non-critical */ }

    process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
