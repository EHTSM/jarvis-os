#!/usr/bin/env node
"use strict";
/**
 * PHASE 5 — Local Production Burn-In
 * Orchestrates all stress phases and produces a single pass/fail report.
 *
 * Usage:
 *   node tests/stress/05-burnin.cjs [--base=http://localhost:5050]
 *
 * Requires the server to be running for Phase 1 (HTTP tests).
 * All other phases run offline against local modules.
 */

const { execSync } = require("child_process");
const path         = require("path");

const BASE = (() => {
    const arg = process.argv.find(a => a.startsWith("--base="));
    return arg ? arg.slice(7) : "http://localhost:5050";
})();

const ROOT = path.join(__dirname, "../..");

// ── Phase definitions ────────────────────────────────────────────────────────

const PHASES = [
    {
        id:   "01",
        name: "HTTP Stress",
        file: "tests/stress/01-http-stress.test.cjs",
        desc: "Burst HTTP load on all endpoints — error rate + p95 latency",
        env:  { BASE_URL: BASE }
    },
    {
        id:   "02",
        name: "Queue Pressure",
        file: "tests/stress/02-queue-pressure.test.cjs",
        desc: "Concurrent queue writes, integrity checks, health report shape"
    },
    {
        id:   "03",
        name: "Memory Stability",
        file: "tests/stress/03-memory-stability.test.cjs",
        desc: "Heap growth monitoring over repeated module operations",
        nodeFlags: "--expose-gc"
    },
    {
        id:   "04",
        name: "Recovery Simulation",
        file: "tests/stress/04-recovery-simulation.test.cjs",
        desc: "File corruption recovery, emergency stop/resume cycles, adapter error handling"
    },
];

// ── Runner ───────────────────────────────────────────────────────────────────

const WIDTH = 72;

function banner(text) {
    const pad = Math.max(0, WIDTH - text.length - 4);
    const l   = Math.floor(pad / 2);
    const r   = pad - l;
    console.log("\n" + "─".repeat(WIDTH));
    console.log("  " + " ".repeat(l) + text + " ".repeat(r) + "  ");
    console.log("─".repeat(WIDTH));
}

function parseTestOutput(output) {
    const passMatch = output.match(/\bpass\s*[:\-]?\s*(\d+)/i);
    const failMatch = output.match(/\bfail\s*[:\-]?\s*(\d+)/i);
    const pass = passMatch ? parseInt(passMatch[1], 10) : null;
    const fail = failMatch ? parseInt(failMatch[1], 10) : null;
    return { pass, fail };
}

async function runPhase(phase) {
    const label = `Phase ${phase.id} — ${phase.name}`;
    console.log(`\n▶  ${label}`);
    console.log(`   ${phase.desc}`);

    const start  = Date.now();
    const env    = { ...process.env, ...(phase.env || {}) };
    const file   = path.join(ROOT, phase.file);
    let   output = "";
    let   error  = false;
    let   parsed = { pass: null, fail: null };

    try {
        const flags = phase.nodeFlags ? `${phase.nodeFlags} ` : "";
        output = execSync(`node ${flags}--test "${file}"`, {
            cwd:     ROOT,
            env,
            timeout: 120_000,
            encoding: "utf8",
            stdio:   "pipe"
        });
        parsed = parseTestOutput(output);
        // node:test exits 0 even with failures; check parsed fail count
        if (parsed.fail !== null && parsed.fail > 0) error = true;
    } catch (e) {
        output = (e.stdout || "") + (e.stderr || "");
        parsed = parseTestOutput(output);
        error  = true;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const status  = error ? "FAIL" : "PASS";
    const colour  = error ? "\x1b[31m" : "\x1b[32m";
    const reset   = "\x1b[0m";

    console.log(`   ${colour}${status}${reset}  ${elapsed}s` +
        (parsed.pass !== null ? `  pass:${parsed.pass}` : "") +
        (parsed.fail !== null ? `  fail:${parsed.fail}` : ""));


    if (error) {
        const lines = output.trim().split("\n");
        const failLines = lines.filter(l => /✗|not ok|fail/i.test(l)).slice(0, 8);
        if (failLines.length) {
            console.log("\n   First failures:");
            failLines.forEach(l => console.log("     " + l.trim()));
        }
    }

    return { id: phase.id, name: phase.name, passed: !error, elapsed, testPass: parsed.pass, testFail: parsed.fail };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    banner("JARVIS MVP — Stability Burn-In Suite");
    console.log(`  Server: ${BASE}`);
    console.log(`  Node:   ${process.version}`);
    console.log(`  Date:   ${new Date().toISOString()}`);

    const results = [];
    for (const phase of PHASES) {
        const r = await runPhase(phase);
        results.push(r);
    }

    // ── Summary ───────────────────────────────────────────────────────────

    banner("Burn-In Results");

    let allPass = true;
    for (const r of results) {
        const icon  = r.passed ? "✓" : "✗";
        const color = r.passed ? "\x1b[32m" : "\x1b[31m";
        const reset = "\x1b[0m";
        const stats = (r.testPass !== null ? ` (pass:${r.testPass}` : "") +
                      (r.testFail !== null ? ` fail:${r.testFail})` : r.testPass !== null ? ")" : "");
        console.log(`  ${color}${icon}${reset} Phase ${r.id} — ${r.name.padEnd(22)} ${r.elapsed}s${stats}`);
        if (!r.passed) allPass = false;
    }

    const passCount = results.filter(r => r.passed).length;
    const failCount = results.filter(r => !r.passed).length;

    console.log("\n" + "─".repeat(WIDTH));
    const verdict = allPass ? "\x1b[32mALL PHASES PASSED\x1b[0m" : `\x1b[31m${failCount} PHASE(S) FAILED\x1b[0m`;
    console.log(`  ${verdict}   ${passCount}/${results.length} phases`);
    console.log("─".repeat(WIDTH) + "\n");

    if (!allPass) {
        console.log("Tip: Run individual phase file for full output:");
        for (const r of results.filter(r => !r.passed)) {
            console.log(`  node --test ${PHASES.find(p => p.id === r.id)?.file}`);
        }
        console.log();
    }

    process.exit(allPass ? 0 : 1);
}

main().catch(e => {
    console.error("Burn-in runner crashed:", e.message);
    process.exit(1);
});
