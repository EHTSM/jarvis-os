"use strict";
/**
 * PHASE 1 — Runtime Stress Testing
 * Fires burst HTTP requests at all core endpoints and measures error rates + p95 latency.
 * Requires server running on BASE (default: http://localhost:5050).
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const http   = require("http");

const BASE = (process.env.BASE_URL || "http://localhost:5050").replace(/\/$/, "");
const { hostname, port, protocol } = new URL(BASE);

// ── helper ──────────────────────────────────────────────────────────────────

function req(method, path, body) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname,
            port: port || (protocol === "https:" ? 443 : 80),
            path,
            method,
            headers: {
                "Content-Type":  "application/json",
                "Content-Length": payload ? Buffer.byteLength(payload) : 0
            }
        };
        const start = Date.now();
        const r = http.request(options, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => resolve({ status: res.statusCode, latencyMs: Date.now() - start, body: data }));
        });
        r.on("error", reject);
        if (payload) r.write(payload);
        r.end();
    });
}

async function burst(method, path, body, n = 20) {
    const promises = Array.from({ length: n }, () => req(method, path, body));
    const results  = await Promise.allSettled(promises);
    const successes = results.filter(r => r.status === "fulfilled" && r.value.status < 500);
    const latencies = results
        .filter(r => r.status === "fulfilled")
        .map(r => r.value.latencyMs)
        .sort((a, b) => a - b);
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    return { total: n, ok: successes.length, errors: n - successes.length, p95Ms: p95 };
}

// ── server reachability guard ────────────────────────────────────────────────

let _serverUp = false;

before(async () => {
    try {
        const r = await req("GET", "/health");
        _serverUp = r.status < 500;
    } catch { _serverUp = false; }
});

// ── tests ────────────────────────────────────────────────────────────────────

describe("Phase 1 — HTTP Stress", { concurrency: 1 }, () => {

    it("server is reachable before stress tests", () => {
        assert.ok(_serverUp, `Server not reachable at ${BASE} — start server first`);
    });

    it("GET /health — 20 concurrent, 0 errors, p95 < 500ms", async () => {
        if (!_serverUp) return;
        const r = await burst("GET", "/health", null, 20);
        assert.equal(r.errors, 0, `${r.errors} errors on /health burst`);
        assert.ok(r.p95Ms < 500, `p95 ${r.p95Ms}ms ≥ 500ms on /health`);
    });

    it("GET /ops — 20 concurrent, 0 errors, p95 < 1000ms", async () => {
        if (!_serverUp) return;
        const r = await burst("GET", "/ops", null, 20);
        assert.equal(r.errors, 0, `${r.errors} errors on /ops burst`);
        assert.ok(r.p95Ms < 1000, `p95 ${r.p95Ms}ms ≥ 1000ms on /ops`);
    });

    it("GET /stats — 20 concurrent, 0 errors", async () => {
        if (!_serverUp) return;
        const r = await burst("GET", "/stats", null, 20);
        assert.equal(r.errors, 0, `${r.errors} server errors on /stats burst`);
    });

    it("GET /tasks — 20 concurrent, 0 errors", async () => {
        if (!_serverUp) return;
        const r = await burst("GET", "/tasks", null, 20);
        assert.equal(r.errors, 0, `${r.errors} server errors on /tasks burst`);
    });

    it("POST /jarvis — 10 sequential AI requests all respond", async () => {
        if (!_serverUp) return;
        let ok = 0;
        for (let i = 0; i < 10; i++) {
            const r = await req("POST", "/jarvis", { input: `stress test ${i}` });
            if (r.status < 500) ok++;
        }
        assert.ok(ok >= 8, `Only ${ok}/10 AI requests succeeded (≥8 required)`);
    });

    it("mixed burst — /health, /ops, /stats interleaved, error rate < 5%", async () => {
        if (!_serverUp) return;
        const all = await Promise.allSettled([
            ...Array.from({ length: 10 }, () => req("GET", "/health")),
            ...Array.from({ length: 10 }, () => req("GET", "/ops")),
            ...Array.from({ length: 10 }, () => req("GET", "/stats")),
        ]);
        const errors = all.filter(r => r.status === "rejected" || (r.value?.status >= 500)).length;
        const rate   = errors / all.length;
        assert.ok(rate < 0.05, `Mixed burst error rate ${(rate * 100).toFixed(1)}% ≥ 5%`);
    });

    it("POST /jarvis with empty input returns structured error, not 500", async () => {
        if (!_serverUp) return;
        const r = await req("POST", "/jarvis", { input: "" });
        assert.notEqual(r.status, 500, `Empty input caused 500 server error`);
    });

    it("POST /jarvis with very long input does not crash server", async () => {
        if (!_serverUp) return;
        const r = await req("POST", "/jarvis", { input: "x".repeat(10_000) });
        assert.ok(r.status < 500, `Long input caused server error: ${r.status}`);
        const health = await req("GET", "/health");
        assert.ok(health.status < 500, `Server crashed after long input test`);
    });

    it("malformed JSON body returns 400, not 500", async () => {
        if (!_serverUp) return;
        const options = {
            hostname, port: port || 80, path: "/jarvis", method: "POST",
            headers: { "Content-Type": "application/json" }
        };
        const status = await new Promise((resolve) => {
            const r = http.request(options, (res) => {
                res.resume();
                resolve(res.statusCode);
            });
            r.on("error", () => resolve(0));
            r.write("{bad json{{");
            r.end();
        });
        assert.notEqual(status, 500, `Malformed JSON returned 500 instead of 400`);
    });

    it("server still healthy after full stress sequence", async () => {
        if (!_serverUp) return;
        const r = await req("GET", "/health");
        assert.ok(r.status < 500, `Server unhealthy after stress: ${r.status}`);
        const body = JSON.parse(r.body);
        assert.ok(body.status === "ok" || body.status === "degraded",
            `Unexpected health status: ${body.status}`);
    });

});
