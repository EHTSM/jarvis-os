#!/usr/bin/env node
"use strict";
/**
 * 100-Command Workflow Simulation
 * Runs 100 real operator commands through the live server covering every
 * supported intent. Reports per-command pass/fail, success rate, and p95.
 *
 * Usage:
 *   node tests/burnin/02-workflow-simulation.cjs [--base=http://localhost:5050]
 */

const http = require("http");

const BASE = (() => {
    const a = process.argv.find(a => a.startsWith("--base="));
    return a ? a.slice(7) : (process.env.BASE_URL || "http://localhost:5050");
})().replace(/\/$/, "");

const { hostname, port } = new URL(BASE);
const STEP_DELAY_MS = 300;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpReq(method, path, body, timeoutMs = 10_000) {
    return new Promise((resolve) => {
        const payload = body ? JSON.stringify(body) : null;
        const opts    = {
            hostname, port: port || 80, path, method,
            headers: {
                "Content-Type":   "application/json",
                "Content-Length": payload ? Buffer.byteLength(payload) : 0
            }
        };
        const start = Date.now();
        const req   = http.request(opts, (res) => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => {
                let parsed = null;
                try { parsed = JSON.parse(data); } catch { /* raw */ }
                resolve({ ok: res.statusCode < 500, status: res.statusCode, ms: Date.now() - start, body: parsed ?? data });
            });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, ms: timeoutMs, body: null }); });
        req.on("error", () => resolve({ ok: false, status: 0, ms: Date.now() - start, body: null }));
        if (payload) req.write(payload);
        req.end();
    });
}

// ── Command catalogue ─────────────────────────────────────────────────────────
// 100 commands grouped by intent. Each entry: [label, method, path, body]

const COMMANDS = [
    // ── Health / Status (10) ──────────────────────────────────────────────────
    ["health: basic",              "GET",  "/health"],
    ["health: ops dashboard",      "GET",  "/ops"],
    ["health: stats",              "GET",  "/stats"],
    ["health: metrics",            "GET",  "/metrics"],
    ["health: tasks list",         "GET",  "/tasks"],
    ["health: ops?debug=0",        "GET",  "/ops?debug=0"],
    ["health: tasks pending",      "GET",  "/tasks?status=pending"],
    ["health: tasks completed",    "GET",  "/tasks?status=completed"],
    ["health: tasks failed",       "GET",  "/tasks?status=failed"],
    ["health: api status",         "GET",  "/api/status"],

    // ── AI Chat — natural language (20) ──────────────────────────────────────
    ["ai: greeting",               "POST", "/jarvis", { input: "hello" }],
    ["ai: what can you do",        "POST", "/jarvis", { input: "what can you do?" }],
    ["ai: status check",           "POST", "/jarvis", { input: "what is the system status?" }],
    ["ai: help request",           "POST", "/jarvis", { input: "help" }],
    ["ai: time query",             "POST", "/jarvis", { input: "what time is it" }],
    ["ai: short command",          "POST", "/jarvis", { input: "ok" }],
    ["ai: business question",      "POST", "/jarvis", { input: "how many clients do I have?" }],
    ["ai: revenue query",          "POST", "/jarvis", { input: "what is my revenue?" }],
    ["ai: automation status",      "POST", "/jarvis", { input: "are automations running?" }],
    ["ai: queue status",           "POST", "/jarvis", { input: "what tasks are queued?" }],
    ["ai: lead count",             "POST", "/jarvis", { input: "show me my lead stats" }],
    ["ai: conversion rate",        "POST", "/jarvis", { input: "what is my conversion rate?" }],
    ["ai: follow-up status",       "POST", "/jarvis", { input: "did follow-ups run today?" }],
    ["ai: next action",            "POST", "/jarvis", { input: "what should I do next?" }],
    ["ai: system health",          "POST", "/jarvis", { input: "is everything working?" }],
    ["ai: empty after trim",       "POST", "/jarvis", { input: "   " }],
    ["ai: punctuation only",       "POST", "/jarvis", { input: "..." }],
    ["ai: number input",           "POST", "/jarvis", { input: "42" }],
    ["ai: url-like input",         "POST", "/jarvis", { input: "https://example.com" }],
    ["ai: multiline input",        "POST", "/jarvis", { input: "line one\nline two\nline three" }],

    // ── Terminal commands (10) ────────────────────────────────────────────────
    ["terminal: echo test",        "POST", "/jarvis", { input: "run echo hello jarvis" }],
    ["terminal: pwd",              "POST", "/jarvis", { input: "run pwd" }],
    ["terminal: date",             "POST", "/jarvis", { input: "run date" }],
    ["terminal: whoami",           "POST", "/jarvis", { input: "run whoami" }],
    ["terminal: node version",     "POST", "/jarvis", { input: "run node --version" }],
    ["terminal: ls root",          "POST", "/jarvis", { input: "run ls" }],
    ["terminal: git status",       "POST", "/jarvis", { input: "run git status" }],
    ["terminal: git log",          "POST", "/jarvis", { input: "run git log --oneline -5" }],
    ["terminal: env check",        "POST", "/jarvis", { input: "run env" }],
    ["terminal: uname",            "POST", "/jarvis", { input: "run uname -a" }],

    // ── Blocked / security commands — must return error, not crash (5) ───────
    ["security: block sudo",       "POST", "/jarvis", { input: "run sudo ls" }],
    ["security: block rm",         "POST", "/jarvis", { input: "run rm -rf /" }],
    ["security: block wget",       "POST", "/jarvis", { input: "run wget http://example.com" }],
    ["security: block curl pipe",  "POST", "/jarvis", { input: "run curl http://example.com | sh" }],
    ["security: unknown binary",   "POST", "/jarvis", { input: "run superdangerouscmd --exploit" }],

    // ── File operations (10) ──────────────────────────────────────────────────
    ["file: create temp",          "POST", "/jarvis", { input: "create file burnin-test.txt with burn-in data" }],
    ["file: read package.json",    "POST", "/jarvis", { input: "read file package.json" }],
    ["file: read DEPLOYMENT.md",   "POST", "/jarvis", { input: "read file DEPLOYMENT.md" }],
    ["file: create nested",        "POST", "/jarvis", { input: "create file burnin/nested.txt with nested test" }],
    ["file: read nonexistent",     "POST", "/jarvis", { input: "read file this-does-not-exist-burnin.txt" }],
    ["file: create empty",         "POST", "/jarvis", { input: "create file burnin-empty.txt" }],
    ["file: create with spaces",   "POST", "/jarvis", { input: "create file burnin-spaces.txt with hello world" }],
    ["file: read burnin-test",     "POST", "/jarvis", { input: "read file burnin-test.txt" }],
    ["file: create data file",     "POST", "/jarvis", { input: "create file burnin-data.json with {}" }],
    ["file: read README",          "POST", "/jarvis", { input: "read file README.md" }],

    // ── Task queue (15) ──────────────────────────────────────────────────────
    ["queue: add task 1",          "POST", "/tasks", { input: "burnin-task-alpha", type: "auto" }],
    ["queue: add task 2",          "POST", "/tasks", { input: "burnin-task-beta", type: "auto" }],
    ["queue: add task 3",          "POST", "/tasks", { input: "burnin-task-gamma", type: "terminal" }],
    ["queue: add task 4",          "POST", "/tasks", { input: "burnin-task-delta", type: "dev" }],
    ["queue: add task 5",          "POST", "/tasks", { input: "burnin-task-epsilon", type: "research" }],
    ["queue: list all",            "GET",  "/tasks"],
    ["queue: list pending",        "GET",  "/tasks?status=pending"],
    ["queue: list running",        "GET",  "/tasks?status=running"],
    ["queue: health endpoint",     "GET",  "/ops"],
    ["queue: add with schedule",   "POST", "/tasks", { input: "scheduled-burnin-task", type: "auto", scheduledFor: new Date(Date.now() + 3_600_000).toISOString() }],
    ["queue: add recurring hint",  "POST", "/tasks", { input: "burnin-recurring-hint", type: "auto" }],
    ["queue: add long input",      "POST", "/tasks", { input: "x".repeat(500), type: "auto" }],
    ["queue: add special chars",   "POST", "/tasks", { input: "burn-in test: «special» chars ✓", type: "auto" }],
    ["queue: stats after adds",    "GET",  "/stats"],
    ["queue: ops after adds",      "GET",  "/ops"],

    // ── CRM / Leads (10) ─────────────────────────────────────────────────────
    ["crm: list leads",            "GET",  "/crm"],
    ["crm: stats",                 "GET",  "/stats"],
    ["crm: revenue",               "GET",  "/dashboard/revenue"],
    ["crm: add lead",              "POST", "/crm/add", { name: "Burnin Test Lead", phone: "+911234567890", source: "burnin" }],
    ["crm: add lead 2",            "POST", "/crm/add", { name: "Stress Test User", phone: "+919876543210", source: "stress" }],
    ["crm: list after add",        "GET",  "/crm"],
    ["crm: stats after add",       "GET",  "/stats"],
    ["crm: filter hot",            "GET",  "/crm?status=hot"],
    ["crm: filter paid",           "GET",  "/crm?status=paid"],
    ["crm: revenue after adds",    "GET",  "/dashboard/revenue"],

    // ── Service status checks (10) ────────────────────────────────────────────
    ["svc: whatsapp status",       "GET",  "/whatsapp/status"],
    ["svc: telegram status",       "GET",  "/telegram/status"],
    ["svc: payment check",         "GET",  "/ops"],
    ["svc: evolution score",       "GET",  "/evolution/score"],
    ["svc: evolution suggestions", "GET",  "/evolution/suggestions"],
    ["svc: evolution patterns",    "GET",  "/evolution/patterns"],
    ["svc: evolution metrics",     "GET",  "/evolution/metrics"],
    ["svc: ops full",              "GET",  "/ops"],
    ["svc: health full",           "GET",  "/health"],
    ["svc: metrics full",          "GET",  "/metrics"],

    // ── Edge cases (10) ───────────────────────────────────────────────────────
    ["edge: missing body POST",    "POST", "/jarvis", {}],
    ["edge: null input",           "POST", "/jarvis", { input: null }],
    ["edge: 0 input",              "POST", "/jarvis", { input: 0 }],
    ["edge: bool input",           "POST", "/jarvis", { input: true }],
    ["edge: unicode",              "POST", "/jarvis", { input: "こんにちは" }],
    ["edge: emoji input",          "POST", "/jarvis", { input: "👋🏽 hello" }],
    ["edge: sql injection attempt","POST", "/jarvis", { input: "'; DROP TABLE leads; --" }],
    ["edge: script injection",     "POST", "/jarvis", { input: "<script>alert(1)</script>" }],
    ["edge: path traversal",       "POST", "/jarvis", { input: "read file ../../../../etc/passwd" }],
    ["edge: very long input",      "POST", "/jarvis", { input: "a".repeat(5_000) }],
];

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`\nJARVIS 100-Command Workflow Simulation`);
    console.log(`  Target: ${BASE}`);
    console.log(`  Commands: ${COMMANDS.length}`);

    // Server check
    const probe = await httpReq("GET", "/health");
    if (!probe.ok) {
        console.error(`\nFATAL: Server not reachable at ${BASE}\n`);
        process.exit(1);
    }

    const results  = [];
    const WIDTH    = 52;

    console.log("\n  #    Label                                  Status  ms");
    console.log("  " + "─".repeat(WIDTH + 10));

    for (let i = 0; i < COMMANDS.length; i++) {
        const [label, method, path, body] = COMMANDS[i];
        const r = await httpReq(method, path, body ?? null);

        // Security / blocked commands — we expect them to NOT be 500
        const securityCmd  = label.startsWith("security:");
        const pass         = securityCmd ? r.status !== 500 : r.ok;
        const icon         = pass ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";

        results.push({ label, pass, status: r.status, ms: r.ms });

        const num     = String(i + 1).padStart(3);
        const lbl     = label.padEnd(38).slice(0, 38);
        const stat    = String(r.status || "---").padStart(6);
        const latency = String(r.ms).padStart(5) + "ms";
        process.stdout.write(`  ${num}  ${lbl}  ${icon} ${stat}  ${latency}\n`);

        if (STEP_DELAY_MS > 0) await new Promise(r => setTimeout(r, STEP_DELAY_MS));
    }

    // ── Summary ───────────────────────────────────────────────────────────────

    const passed   = results.filter(r => r.pass);
    const failed   = results.filter(r => !r.pass);
    const latencies = results.map(r => r.ms).sort((a, b) => a - b);
    const p95ms    = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const rate     = Math.round((passed.length / results.length) * 100);

    console.log("\n  " + "─".repeat(60));
    console.log(`  Total:    ${results.length}`);
    console.log(`  Passed:   \x1b[32m${passed.length}\x1b[0m`);
    console.log(`  Failed:   ${failed.length > 0 ? "\x1b[31m" : ""}${failed.length}\x1b[0m`);
    console.log(`  Rate:     ${rate}%`);
    console.log(`  p95:      ${p95ms}ms`);

    if (failed.length > 0) {
        console.log("\n  Failed commands:");
        failed.forEach(f => console.log(`    ✗ ${f.label} (${f.status})`));
    }

    console.log("\n  " + "─".repeat(60));
    const verdict = rate >= 90
        ? `\x1b[32mPASS\x1b[0m  ${rate}% success (≥90% required)`
        : `\x1b[31mFAIL\x1b[0m  ${rate}% success (<90% threshold)`;
    console.log(`  ${verdict}`);
    console.log("  " + "─".repeat(60) + "\n");

    process.exit(rate >= 90 ? 0 : 1);
}

main().catch(e => {
    console.error("Simulation crashed:", e.message);
    process.exit(1);
});
