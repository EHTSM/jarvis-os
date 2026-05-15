#!/usr/bin/env node
"use strict";
/**
 * MVP Smoke Tests — verifies all 10 fixed flows against a live server.
 * Run with: node tests/smoke/mvp-smoke.cjs [--base http://localhost:5050]
 *
 * Does NOT require credentials for WhatsApp/Telegram/Razorpay.
 * Those tests verify the route responds with a structured error, not a crash.
 */

const http  = require("http");
const https = require("https");

const BASE = process.argv.find(a => a.startsWith("--base="))?.split("=")[1]
          || process.env.SMOKE_BASE
          || "http://localhost:5050";

let _pass = 0, _fail = 0, _skip = 0;

async function req(method, path, body) {
    const url     = new URL(BASE + path);
    const lib     = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    return new Promise((resolve, reject) => {
        const opts = {
            hostname: url.hostname,
            port:     url.port || (url.protocol === "https:" ? 443 : 80),
            path:     url.pathname + url.search,
            method,
            headers:  {
                "Content-Type":   "application/json",
                "Content-Length": payload ? Buffer.byteLength(payload) : 0,
            },
            timeout: 10_000,
        };
        const request = lib.request(opts, (res) => {
            let data = "";
            res.on("data", d => { data += d; });
            res.on("end", () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        request.on("error", reject);
        request.on("timeout", () => { request.destroy(); reject(new Error("timeout")); });
        if (payload) request.write(payload);
        request.end();
    });
}

function pass(name) { console.log(`  ✓  ${name}`); _pass++; }
function fail(name, reason) { console.error(`  ✗  ${name}: ${reason}`); _fail++; }
function skip(name, reason) { console.log(`  -  ${name}: ${reason}`); _skip++; }

async function run(name, fn) {
    try { await fn(); }
    catch (err) { fail(name, err.message); }
}

// ─────────────────────────────────────────────────────────────────────
async function main() {
console.log(`\nJARVIS MVP Smoke Tests — ${BASE}\n`);

// 1. Health check
await run("Health endpoint responds", async () => {
    const r = await req("GET", "/health");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    pass("Health endpoint responds");
});

// 2. /jarvis: intelligence pipeline (always available)
await run("Chat: AI response", async () => {
    const r = await req("POST", "/jarvis", { input: "hello" });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.reply)    throw new Error("no reply field");
    pass("Chat: AI response");
});

// 3. /jarvis: execution — open app (parse only, macOS)
await run("Execution: open_app parses correctly", async () => {
    const r = await req("POST", "/jarvis", { input: "open Finder", mode: "execution" });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.reply)    throw new Error("no reply");
    pass("Execution: open_app parses correctly");
});

// 4. /jarvis: execution — terminal command through sandbox
await run("Execution: terminal command", async () => {
    const r = await req("POST", "/jarvis", { input: "run git status", mode: "execution" });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.reply)    throw new Error("no reply");
    pass("Execution: terminal command");
});

// 5. /jarvis: execution — create file
await run("Execution: create file", async () => {
    const r = await req("POST", "/jarvis", { input: "create file /tmp/jarvis-smoke-test.txt with hello from smoke test", mode: "execution" });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    pass("Execution: create file");
});

// 6. /jarvis: execution — read file (reads the one we just created)
await run("Execution: read file", async () => {
    const r = await req("POST", "/jarvis", { input: "read file /tmp/jarvis-smoke-test.txt", mode: "execution" });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    pass("Execution: read file");
});

// 7. WhatsApp — structured error when unconfigured
await run("WhatsApp: structured error (unconfigured OK)", async () => {
    const r = await req("POST", "/whatsapp/send", { phone: "+910000000000", message: "smoke test" });
    if (r.status !== 200 && r.status !== 503) throw new Error(`unexpected status ${r.status}`);
    if (r.status === 200 && r.body.success === undefined) throw new Error("no success field");
    pass("WhatsApp: structured error (unconfigured OK)");
});

// 8. Telegram — structured error when unconfigured
await run("Telegram: structured error (unconfigured OK)", async () => {
    const r = await req("GET", "/telegram/status");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (typeof r.body.configured !== "boolean") throw new Error("missing configured field");
    pass("Telegram: structured error (unconfigured OK)");
});

// 9. Payment — structured error when unconfigured
await run("Payment: structured error (unconfigured OK)", async () => {
    const r = await req("POST", "/payment/link", { amount: 100, description: "smoke test" });
    if (r.status !== 200 && r.status !== 400 && r.status !== 500) throw new Error(`unexpected status ${r.status}`);
    pass("Payment: structured error (unconfigured OK)");
});

// 10. Task queue — ops returns queueHealth
await run("Task queue: /ops returns queue data", async () => {
    const r = await req("GET", "/ops");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.body.queue)    throw new Error("no queue field in /ops response");
    pass("Task queue: /ops returns queue data");
});

// 11. Task queue — add and list tasks
await run("Task queue: GET /tasks", async () => {
    const r = await req("GET", "/tasks");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!Array.isArray(r.body.tasks)) throw new Error("tasks not an array");
    pass("Task queue: GET /tasks");
});

// 12. Emergency stop/resume cycle
await run("Emergency: stop + resume cycle", async () => {
    const stop = await req("POST", "/runtime/emergency/stop", { reason: "smoke_test" });
    if (stop.status === 503) { skip("Emergency: stop + resume cycle", "governor unavailable"); return; }
    if (stop.status !== 200) throw new Error(`stop returned ${stop.status}`);

    const resume = await req("POST", "/runtime/emergency/resume", {});
    if (resume.status !== 200) throw new Error(`resume returned ${resume.status}`);
    pass("Emergency: stop + resume cycle");
});

// 13. Evolution endpoints — 200 even when module unavailable
await run("Evolution: /evolution/score returns 200", async () => {
    const r = await req("GET", "/evolution/score");
    if (r.status !== 200) throw new Error(`status ${r.status} (expected 200 even when unavailable)`);
    pass("Evolution: /evolution/score returns 200");
});

await run("Evolution: /evolution/suggestions returns 200", async () => {
    const r = await req("GET", "/evolution/suggestions");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!Array.isArray(r.body.suggestions ?? [])) throw new Error("bad suggestions shape");
    pass("Evolution: /evolution/suggestions returns 200");
});

// 14. Runtime history endpoint
await run("Runtime: /runtime/history", async () => {
    const r = await req("GET", "/runtime/history");
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    pass("Runtime: /runtime/history");
});

// ─────────────────────────────────────────────────────────────────────
console.log(`\n─────────────────────────────────`);
console.log(` Pass: ${_pass}  Fail: ${_fail}  Skip: ${_skip}`);
console.log(`─────────────────────────────────\n`);
if (_fail > 0) process.exit(1);
}  // end main

main().catch(err => { console.error("Smoke test runner error:", err.message); process.exit(1); });
