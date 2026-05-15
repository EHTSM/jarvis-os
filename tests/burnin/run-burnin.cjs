#!/usr/bin/env node
"use strict";
/**
 * JARVIS Operator Burn-In Runner
 * Orchestrates all burn-in validation phases.
 *
 * Usage:
 *   node tests/burnin/run-burnin.cjs [--base=URL] [--quick] [--skip=06]
 *
 *   --base=URL    Server base URL (default: http://localhost:5050)
 *   --quick       Use fast/reduced iterations where supported
 *   --skip=N,M    Skip phase numbers, comma-separated (e.g. --skip=01,06)
 *   --only=N      Run only this phase
 *
 * Long-running monitors (Phase 01 = 8h, idle mode = 24h) are listed
 * separately with instructions — they are NOT run by default.
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");

const args   = process.argv.slice(2);
const BASE   = (() => { const a = args.find(a => a.startsWith("--base=")); return a ? a.slice(7) : "http://localhost:5050"; })();
const QUICK  = args.includes("--quick");
const SKIP   = (() => { const a = args.find(a => a.startsWith("--skip=")); return a ? a.slice(7).split(",") : []; })();
const ONLY   = (() => { const a = args.find(a => a.startsWith("--only=")); return a ? a.slice(7) : null; })();
const ROOT   = path.join(__dirname, "../..");
const WIDTH  = 72;

// ── Phase catalogue ───────────────────────────────────────────────────────────

const PHASES = [
    {
        id:   "02",
        name: "Workflow Simulation",
        desc: "100-command real operator workflow — all intents",
        cmd:  (base, quick) => `node tests/burnin/02-workflow-simulation.cjs --base=${base}`,
        requiresServer: true,
        timeout: 120_000,
    },
    {
        id:   "03",
        name: "Resource Drift",
        desc: "Memory + CPU drift — 5 samples at 3s",
        cmd:  (base, quick) => `node tests/burnin/03-resource-drift.cjs --quick`,
        requiresServer: true,
        timeout: 60_000,
    },
    {
        id:   "04",
        name: "Adapter Timeouts",
        desc: "Timeout enforcement, blocked command safety, orphan check",
        cmd:  (base, quick) => `node tests/burnin/04-adapter-timeouts.cjs`,
        requiresServer: true,
        timeout: 60_000,
    },
    {
        id:   "05",
        name: "Frontend Resilience",
        desc: "Disconnect/reconnect, payload shape, high-freq poll",
        cmd:  (base, quick) => `node tests/burnin/05-resilience.cjs --gap=${quick ? 2 : 5}`,
        requiresServer: true,
        timeout: 60_000,
    },
    {
        id:   "06",
        name: "Persistence + Recovery",
        desc: "Queue survival after SIGTERM + SIGKILL on isolated test port",
        cmd:  (base, quick) => `node tests/burnin/06-persistence-recovery.cjs --port=5051`,
        requiresServer: false,  // spawns its own
        timeout: 120_000,
    },
    {
        id:   "07",
        name: "Disk Monitor",
        desc: "Log growth, queue file size, data/ directory limits",
        cmd:  (base, quick) => `node tests/burnin/07-disk-monitor.cjs --base=${base}`,
        requiresServer: false,  // has offline fallback
        timeout: 90_000,
    },
];

// Long-running phases — shown in instructions but not run by default
const LONG_RUNNING = [
    { id: "LR-01", name: "8-Hour Continuous Runtime",
      cmd: "node tests/burnin/01-continuous-runtime.cjs --minutes=480",
      note: "Run overnight. Tracks error rate + memory drift over 8 hours." },
    { id: "LR-02", name: "24-Hour Idle Stability",
      cmd: "node tests/burnin/01-continuous-runtime.cjs --idle --minutes=1440",
      note: "Run over a weekend. Confirms no memory leak at low request rate." },
];

// ── Utilities ─────────────────────────────────────────────────────────────────

function banner(text) {
    const pad = Math.max(0, WIDTH - text.length - 4);
    console.log("\n" + "─".repeat(WIDTH));
    console.log("  " + " ".repeat(Math.floor(pad / 2)) + text);
    console.log("─".repeat(WIDTH));
}

async function checkServer(base) {
    const http = require("http");
    const { hostname, port } = new URL(base);
    return new Promise((resolve) => {
        const req = http.request(
            { hostname, port: port || 80, path: "/health", method: "GET" },
            (res) => { res.resume(); resolve(res.statusCode < 500); }
        );
        req.setTimeout(5000, () => { req.destroy(); resolve(false); });
        req.on("error", () => resolve(false));
        req.end();
    });
}

function runPhase(phase, base, quick) {
    const cmd     = phase.cmd(base, quick);
    const start   = Date.now();
    let   output  = "";
    let   error   = false;

    try {
        output = execSync(cmd, {
            cwd:     ROOT,
            env:     { ...process.env, BASE_URL: base },
            timeout: phase.timeout,
            encoding: "utf8",
            stdio:   "pipe"
        });
    } catch (e) {
        output = (e.stdout || "") + (e.stderr || "");
        error  = true;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    return { passed: !error, elapsed, output };
}

// Parse pass/fail counts from output
function parseCounts(output) {
    const passM = output.match(/Pass:\s*(\d+)/i);
    const failM = output.match(/Fail:\s*(\d+)/i);
    return {
        pass: passM ? parseInt(passM[1]) : null,
        fail: failM ? parseInt(failM[1]) : null
    };
}

// Extract last non-empty line (usually the verdict)
function lastLine(output) {
    return output.trim().split("\n").filter(l => l.trim()).pop() || "";
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    banner("JARVIS Operator Burn-In Validation");
    console.log(`  Server:  ${BASE}`);
    console.log(`  Mode:    ${QUICK ? "quick" : "standard"}`);
    console.log(`  Node:    ${process.version}`);
    console.log(`  Date:    ${new Date().toISOString()}`);

    // Server check
    const serverUp = await checkServer(BASE);
    console.log(`  Server:  ${serverUp ? "\x1b[32mreachable\x1b[0m" : "\x1b[33mnot reachable (server-independent phases will still run)\x1b[0m"}`);

    const phases = PHASES.filter(p => {
        if (ONLY && p.id !== ONLY) return false;
        if (SKIP.includes(p.id))  return false;
        return true;
    });

    const results = [];

    for (const phase of phases) {
        if (phase.requiresServer && !serverUp) {
            console.log(`\n▷  Phase ${phase.id} — ${phase.name}`);
            console.log(`   \x1b[33mSKIPPED\x1b[0m (requires server — start with: node backend/server.js)`);
            results.push({ id: phase.id, name: phase.name, passed: null, elapsed: "0.0", skipped: true });
            continue;
        }

        console.log(`\n▶  Phase ${phase.id} — ${phase.name}`);
        console.log(`   ${phase.desc}`);

        const r      = runPhase(phase, BASE, QUICK);
        const counts = parseCounts(r.output);
        const status = r.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";

        process.stdout.write(`   ${status}  ${r.elapsed}s`);
        if (counts.pass !== null) process.stdout.write(`  pass:${counts.pass}`);
        if (counts.fail !== null) process.stdout.write(`  fail:${counts.fail}`);
        process.stdout.write("\n");

        if (!r.passed) {
            const failLines = r.output.split("\n")
                .filter(l => /✗|FAIL|fail|error|Error/i.test(l))
                .slice(0, 5);
            if (failLines.length) {
                console.log("\n   Failures:");
                failLines.forEach(l => console.log("     " + l.trim()));
            }
        }

        results.push({ id: phase.id, name: phase.name, passed: r.passed, elapsed: r.elapsed, ...counts });
    }

    // ── Results summary ───────────────────────────────────────────────────────

    banner("Burn-In Results");

    for (const r of results) {
        const icon  = r.skipped ? "\x1b[33m-\x1b[0m" :
                      r.passed  ? "\x1b[32m✓\x1b[0m"  : "\x1b[31m✗\x1b[0m";
        const stats = r.pass !== null
            ? ` (pass:${r.pass}${r.fail !== null ? ` fail:${r.fail}` : ""})`
            : r.skipped ? " (skipped — no server)" : "";
        const elapsed = r.skipped ? "" : ` ${r.elapsed}s`;
        console.log(`  ${icon} Phase ${r.id} — ${r.name.padEnd(24)}${elapsed}${stats}`);
    }

    const ran    = results.filter(r => !r.skipped);
    const passed = ran.filter(r => r.passed).length;
    const failed = ran.filter(r => !r.passed).length;
    const skip   = results.filter(r => r.skipped).length;

    console.log("\n" + "─".repeat(WIDTH));
    if (failed === 0 && skip === 0) {
        console.log(`  \x1b[32mALL PHASES PASSED\x1b[0m   ${passed}/${ran.length} phases`);
    } else if (failed === 0) {
        console.log(`  \x1b[33mPASS (with skips)\x1b[0m   ${passed}/${ran.length} ran, ${skip} skipped`);
    } else {
        console.log(`  \x1b[31m${failed} PHASE(S) FAILED\x1b[0m   ${passed}/${ran.length} passed`);
    }
    console.log("─".repeat(WIDTH));

    // ── Long-running monitor instructions ────────────────────────────────────

    console.log("\n  Long-running monitors (run separately — not automated):");
    for (const lr of LONG_RUNNING) {
        console.log(`\n  ${lr.name}`);
        console.log(`    ${lr.note}`);
        console.log(`    $ ${lr.cmd}`);
    }
    console.log();

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
    console.error("Burn-in runner crashed:", e.message);
    process.exit(1);
});
