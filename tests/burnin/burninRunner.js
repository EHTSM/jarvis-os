"use strict";
/**
 * JARVIS Operator Burn-In Runner
 *
 * Orchestrates all burn-in and stability phases, then writes:
 *   tests/burnin/reports/runtimeHealthReport.md
 *   tests/burnin/reports/recoveryValidationReport.md
 *
 * Usage:
 *   node tests/burnin/burninRunner.js [options]
 *
 *   --base=URL        Server URL (default http://localhost:5050)
 *   --quick           Fast mode: reduced iterations, 10s stability monitor
 *   --phases=A,B,C    Run only these phase groups (A=Stability, B=Resilience,
 *                     C=Simulation, D=Resources, E=Recovery) default: all
 *   --no-reports      Skip markdown report generation
 *   --monitor-minutes=N  Override stability monitor duration
 */

const { execSync, spawnSync, spawn } = require("child_process");
const http  = require("http");
const fs    = require("fs");
const path  = require("path");
const os    = require("os");

// ── Paths ─────────────────────────────────────────────────────────────────────

const ROOT        = path.join(__dirname, "../..");
const REPORTS_DIR = path.join(__dirname, "reports");
const BURNIN_DIR  = __dirname;

// ── Args ──────────────────────────────────────────────────────────────────────

const _args         = process.argv.slice(2);
const QUICK         = _args.includes("--quick");
const NO_REPORTS    = _args.includes("--no-reports");
const BASE          = (_args.find(a => a.startsWith("--base="))?.slice(7) ?? (process.env.BASE_URL || "http://localhost:5050")).replace(/\/$/, "");
const PHASES_ARG    = _args.find(a => a.startsWith("--phases="))?.slice(9).toUpperCase().split(",") ?? null;
const MON_MINUTES   = (() => {
    const a = _args.find(a => a.startsWith("--monitor-minutes="));
    if (a) return parseFloat(a.slice(18));
    return QUICK ? 10 / 60 : null; // null = use stabilityMonitor default
})();

const { hostname, port } = (() => { try { return new URL(BASE); } catch { return { hostname: "localhost", port: "5050" }; } })();

// ── Utilities ─────────────────────────────────────────────────────────────────

const W = 72;

function banner(text) {
    const pad = Math.max(0, W - text.length - 4);
    console.log("\n" + "─".repeat(W));
    console.log("  " + " ".repeat(Math.floor(pad / 2)) + text);
    console.log("─".repeat(W));
}

function section(text) {
    console.log(`\n▶  ${text}`);
}

function ok(msg)   { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function info(msg) { console.log(`  \x1b[34m·\x1b[0m ${msg}`); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(urlPath, timeoutMs = 6000) {
    return new Promise((resolve) => {
        const req = http.request({ hostname, port: port || 80, path: urlPath }, (res) => {
            let b = "";
            res.on("data", c => b += c);
            res.on("end", () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ ok: res.statusCode < 500, status: res.statusCode, body: j }); });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ ok: false, status: 0, body: null }); });
        req.on("error", () => resolve({ ok: false, status: 0, body: null }));
        req.end();
    });
}

// Run a child script and capture result
function runScript(scriptPath, extraArgs = [], timeoutMs = 180_000) {
    const start  = Date.now();
    const args   = [scriptPath, `--base=${BASE}`, ...extraArgs];
    if (QUICK) args.push("--quick");

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
        stdout = execSync(`node ${args.map(a => `"${a}"`).join(" ")}`, {
            cwd: ROOT, env: { ...process.env, BASE_URL: BASE },
            timeout: timeoutMs, encoding: "utf8", stdio: "pipe"
        });
    } catch (e) {
        stdout   = e.stdout ?? "";
        stderr   = e.stderr ?? "";
        exitCode = e.status ?? 1;
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    const passed  = exitCode === 0;

    // Parse pass/fail counts from output
    const passMatch = stdout.match(/\bpass[:\s]+(\d+)/i);
    const failMatch = stdout.match(/\bfail[:\s]+(\d+)/i);
    const passCount = passMatch ? parseInt(passMatch[1]) : null;
    const failCount = failMatch ? parseInt(failMatch[1]) : null;

    return { passed, exitCode, elapsed, stdout, stderr, passCount, failCount };
}

// ── Snapshot parser ───────────────────────────────────────────────────────────

function loadStabilitySnapshot() {
    const f = path.join(ROOT, "data/stability-snapshots.json");
    try { return JSON.parse(fs.readFileSync(f, "utf8")); }
    catch { return null; }
}

// ── Phase runners ─────────────────────────────────────────────────────────────

const _results = {};  // phaseKey → { passed, elapsed, detail }

async function phaseA_stability() {
    section("Phase A — Long Runtime + Stability Monitor");

    const monArgs  = [];
    if (MON_MINUTES) monArgs.push(`--minutes=${MON_MINUTES}`);

    info(`Running stability monitor (${MON_MINUTES ? MON_MINUTES + "m" : "default duration"})...`);
    const r = runScript(path.join(BURNIN_DIR, "stabilityMonitor.js"), monArgs, 3_600_000);

    r.passed ? ok(`Stability monitor: PASS (${r.elapsed}s)`) : fail(`Stability monitor: FAIL`);

    const snap   = loadStabilitySnapshot();
    const detail = { script: "stabilityMonitor.js", ...r };
    if (snap?.samples?.length > 0) {
        const monitor = require("./stabilityMonitor.js");
        const analysis = monitor.analyse(snap.samples, snap.samples[0].ts, snap.samples[snap.samples.length - 1].ts);
        detail.analysis = analysis;
        info(`  Heap drift:   ${analysis.memory.heap.driftMbPerHour} MB/hr`);
        info(`  EL avg lag:   ${analysis.eventLoop.avgLagMs}ms  p95:${analysis.eventLoop.p95LagMs}ms`);
        info(`  CPU max:      ${analysis.cpu.max}%  spikes:${analysis.cpu.spikeCount}`);
        info(`  FD growth:    Δ${analysis.fds.growth}`);
        info(`  HTTP errors:  ${analysis.http.errorRate}%`);
    }

    _results.A = { passed: r.passed, elapsed: r.elapsed, label: "Stability Monitor", detail };
}

async function phaseB_resilience() {
    section("Phase B — Process Resilience + Recovery");

    info("Running persistence & crash recovery...");
    const rPersist = runScript(path.join(BURNIN_DIR, "06-persistence-recovery.cjs"), [], 120_000);
    rPersist.passed
        ? ok(`Persistence/crash recovery: PASS (${rPersist.elapsed}s) pass:${rPersist.passCount}`)
        : fail(`Persistence/crash recovery: FAIL pass:${rPersist.passCount} fail:${rPersist.failCount}`);

    info("Running adapter timeouts & orphan check...");
    const rAdapters = runScript(path.join(BURNIN_DIR, "04-adapter-timeouts.cjs"), [], 90_000);
    rAdapters.passed
        ? ok(`Adapter timeouts/orphans: PASS (${rAdapters.elapsed}s)`)
        : fail(`Adapter timeouts/orphans: FAIL`);

    const passed = rPersist.passed && rAdapters.passed;
    _results.B   = {
        passed, elapsed: (parseFloat(rPersist.elapsed) + parseFloat(rAdapters.elapsed)).toFixed(1),
        label: "Resilience", detail: { persistence: rPersist, adapters: rAdapters }
    };
}

async function phaseC_simulation() {
    section("Phase C — 120+ Command Operator Simulation");

    // Run as child process — isolation avoids rate-limit spillover from prior phases
    info("Running 120+ command operator simulation...");
    const r = runScript(path.join(BURNIN_DIR, "operatorSimulationSuite.js"), [], 300_000);

    // Parse per-phase summary lines: "✓ Sequential normal       50/50  (100%)"
    const labelToKey = {
        "Sequential normal": "A", "Concurrent burst": "B",
        "Invalid/blocked": "C", "Rapid no-delay": "D", "Timeout stress": "E"
    };
    const phases = {};
    const summaryRe = /(Sequential normal|Concurrent burst|Invalid\/blocked|Rapid no-delay|Timeout stress)\s+(\d+)\/(\d+)\s+\((\d+)%\)/g;
    for (const m of r.stdout.matchAll(summaryRe)) {
        const key = labelToKey[m[1]] ?? m[1];
        const pass = parseInt(m[2]), total = parseInt(m[3]), rate = parseInt(m[4]);
        phases[key] = { total, pass, fail: total - pass, rateOk: rate >= 90 };
    }

    const phaseLog = Object.entries(phases).map(([k, p]) => `${k}:${p.pass}/${p.total}`).join("  ");

    r.passed
        ? ok(`Operator simulation: PASS  ${phaseLog}`)
        : fail(`Operator simulation: FAIL  ${phaseLog}`);

    _results.C = { passed: r.passed, elapsed: r.elapsed, label: "Operator Simulation", detail: { phases } };
}

async function phaseD_resources() {
    section("Phase D — Resource Stability");

    info("Running disk & log monitor...");
    const rDisk = runScript(path.join(BURNIN_DIR, "07-disk-monitor.cjs"), [], 90_000);
    rDisk.passed
        ? ok(`Disk/log monitor: PASS (${rDisk.elapsed}s)`)
        : fail(`Disk/log monitor: FAIL`);

    info("Running memory stability stress tests...");
    const rMem = runScript(
        path.join(ROOT, "tests/stress/03-memory-stability.test.cjs"),
        [], 60_000
    );
    rMem.passed
        ? ok(`Memory stability: PASS  pass:${rMem.passCount}`)
        : fail(`Memory stability: FAIL  fail:${rMem.failCount}`);

    info("Running queue pressure tests...");
    const rQueue = runScript(
        path.join(ROOT, "tests/stress/02-queue-pressure.test.cjs"),
        [], 60_000
    );
    rQueue.passed
        ? ok(`Queue pressure: PASS  pass:${rQueue.passCount}`)
        : fail(`Queue pressure: FAIL  fail:${rQueue.failCount}`);

    const passed = rDisk.passed && rMem.passed && rQueue.passed;
    _results.D   = {
        passed, elapsed: [rDisk.elapsed, rMem.elapsed, rQueue.elapsed].map(Number).reduce((a, b) => a + b, 0).toFixed(1),
        label: "Resources", detail: { disk: rDisk, memory: rMem, queue: rQueue }
    };
}

async function phaseE_recovery() {
    section("Phase E — Stress Recovery");

    info("Running recovery simulation tests...");
    const rRecov = runScript(
        path.join(ROOT, "tests/stress/04-recovery-simulation.test.cjs"),
        [], 60_000
    );
    rRecov.passed
        ? ok(`Recovery simulation: PASS  pass:${rRecov.passCount}`)
        : fail(`Recovery simulation: FAIL  fail:${rRecov.failCount}`);

    info("Running frontend resilience...");
    const rResil = runScript(path.join(BURNIN_DIR, "05-resilience.cjs"), [], 60_000);
    rResil.passed
        ? ok(`Frontend resilience: PASS`)
        : fail(`Frontend resilience: FAIL`);

    info("Running HTTP stress (offline smoke)...");
    const rHttp = runScript(
        path.join(ROOT, "tests/stress/01-http-stress.test.cjs"),
        [], 60_000
    );
    rHttp.passed
        ? ok(`HTTP stress: PASS  pass:${rHttp.passCount}`)
        : fail(`HTTP stress: FAIL  fail:${rHttp.failCount}`);

    const passed = rRecov.passed && rResil.passed && rHttp.passed;
    _results.E   = {
        passed, elapsed: [rRecov.elapsed, rResil.elapsed, rHttp.elapsed].map(Number).reduce((a, b) => a + b, 0).toFixed(1),
        label: "Recovery", detail: { recovery: rRecov, resilience: rResil, http: rHttp }
    };
}

// ── Report generators ─────────────────────────────────────────────────────────

function generateHealthReport(runMeta) {
    const snap    = loadStabilitySnapshot();
    const A       = _results.A;
    const analysis = A?.detail?.analysis ?? null;

    const now = new Date().toISOString();
    const duration = A?.elapsed ? A.elapsed + "s" : "—";

    let sections = [];

    sections.push(`# JARVIS Runtime Health Report\n`);
    sections.push(`| | |`);
    sections.push(`|---|---|`);
    sections.push(`| **Generated** | ${now} |`);
    sections.push(`| **Node** | ${process.version} |`);
    sections.push(`| **Platform** | ${os.platform()} ${os.release()} |`);
    sections.push(`| **Server** | ${BASE} |`);
    sections.push(`| **Mode** | ${QUICK ? "quick" : "standard"} |`);
    sections.push(`| **Duration** | ${duration} |`);
    sections.push(``);

    // Overall verdict
    const allPassed = Object.values(_results).every(r => r.passed);
    sections.push(`## Overall Status\n`);
    sections.push(`**${allPassed ? "✅ PASS" : "❌ FAIL"}** — ${Object.values(_results).filter(r => r.passed).length}/${Object.keys(_results).length} phases passed\n`);

    // Phase summary table
    sections.push(`## Phase Summary\n`);
    sections.push(`| Phase | Name | Result | Duration |`);
    sections.push(`|---|---|---|---|`);
    for (const [k, v] of Object.entries(_results)) {
        const icon = v.passed ? "✅ PASS" : "❌ FAIL";
        sections.push(`| ${k} | ${v.label} | ${icon} | ${v.elapsed}s |`);
    }
    sections.push(``);

    // Memory analysis
    sections.push(`## Memory Analysis\n`);
    if (analysis) {
        const m = analysis.memory;
        sections.push(`| Metric | Value | Threshold | Status |`);
        sections.push(`|---|---|---|---|`);
        sections.push(`| Heap drift | ${m.heap.driftMbPerHour} MB/hr | < 10 MB/hr | ${m.heap.driftMbPerHour < 10 ? "✅" : "❌"} |`);
        sections.push(`| Peak heap | ${m.heap.max} MB | < 450 MB | ${m.heap.max < 450 ? "✅" : "❌"} |`);
        sections.push(`| Avg heap | ${m.heap.avg} MB | — | — |`);
        sections.push(`| Min heap | ${m.heap.min} MB | — | — |`);
        sections.push(`| Peak RSS | ${m.rss.max} MB | — | — |`);
        sections.push(``);
    } else {
        sections.push(`_Stability monitor did not run or produced no samples._\n`);
    }

    // Event loop
    sections.push(`## Event Loop Health\n`);
    if (analysis) {
        const el = analysis.eventLoop;
        sections.push(`| Metric | Value | Threshold | Status |`);
        sections.push(`|---|---|---|---|`);
        sections.push(`| Avg lag | ${el.avgLagMs} ms | < 100 ms | ${el.avgLagMs < 100 ? "✅" : "❌"} |`);
        sections.push(`| p95 lag | ${el.p95LagMs} ms | < 200 ms | ${el.p95LagMs < 200 ? "✅" : "❌"} |`);
        sections.push(`| Max lag | ${el.maxLagMs} ms | — | — |`);
        sections.push(`| Warn events | ${el.warnCount} | — | — |`);
        sections.push(`| Critical spikes | ${el.spikeCount} | ≤ 5 | ${el.spikeCount <= 5 ? "✅" : "❌"} |`);
        sections.push(``);
    } else {
        sections.push(`_Not measured — run Phase A to capture event loop metrics._\n`);
    }

    // CPU
    sections.push(`## CPU Profile\n`);
    if (analysis) {
        const c = analysis.cpu;
        sections.push(`| Metric | Value |`);
        sections.push(`|---|---|`);
        sections.push(`| Average CPU% | ${c.avg}% |`);
        sections.push(`| Peak CPU% | ${c.max}% |`);
        sections.push(`| Spikes ≥80% | ${c.spikeCount} |`);
        sections.push(``);
    } else {
        sections.push(`_Not measured._\n`);
    }

    // HTTP health
    sections.push(`## HTTP Endpoint Stability\n`);
    if (analysis) {
        const h = analysis.http;
        sections.push(`| Metric | Value | Threshold | Status |`);
        sections.push(`|---|---|---|---|`);
        sections.push(`| Samples | ${h.sampleCount} | — | — |`);
        sections.push(`| Error rate | ${h.errorRate}% | < 5% | ${h.errorRate < 5 ? "✅" : "❌"} |`);
        sections.push(`| Avg latency | ${h.avgMs} ms | — | — |`);
        sections.push(`| p95 latency | ${h.p95Ms} ms | < 1000 ms | ${h.p95Ms < 1000 ? "✅" : "❌"} |`);
        sections.push(``);
    } else {
        sections.push(`_Not measured._\n`);
    }

    // File descriptors
    sections.push(`## File Descriptor Tracking\n`);
    if (analysis) {
        const f = analysis.fds;
        sections.push(`| Metric | Value | Threshold | Status |`);
        sections.push(`|---|---|---|---|`);
        sections.push(`| Start FDs | ${f.start < 0 ? "N/A" : f.start} | — | — |`);
        sections.push(`| End FDs | ${f.end < 0 ? "N/A" : f.end} | — | — |`);
        sections.push(`| Growth | ${f.growth} | < 50 | ${f.growth < 50 ? "✅" : "❌"} |`);
        sections.push(``);
    } else {
        sections.push(`_Not measured._\n`);
    }

    // Operator simulation
    sections.push(`## Operator Simulation Results\n`);
    const C = _results.C;
    if (C?.detail?.phases) {
        const labels = { A: "Sequential normal (50)", B: "Concurrent burst (30)", C: "Invalid/blocked (20)", D: "Rapid no-delay (15)", E: "Timeout stress (5)" };
        sections.push(`| Phase | Commands | Pass | Fail | Rate | Status |`);
        sections.push(`|---|---|---|---|---|---|`);
        for (const [k, p] of Object.entries(C.detail.phases)) {
            if (!p.total) continue;
            const rate = Math.round(p.pass / p.total * 100);
            sections.push(`| ${k} — ${labels[k] || k} | ${p.total} | ${p.pass} | ${p.fail} | ${rate}% | ${p.rateOk ? "✅" : "❌"} |`);
        }
        sections.push(``);
    } else {
        sections.push(`_Simulation not run or results unavailable._\n`);
    }

    // Resource checks
    sections.push(`## Resource Stability\n`);
    const D = _results.D;
    if (D?.detail) {
        sections.push(`| Check | Result |`);
        sections.push(`|---|---|`);
        sections.push(`| Disk/log limits | ${D.detail.disk?.passed ? "✅ Pass" : "❌ Fail"} |`);
        sections.push(`| Memory stability | ${D.detail.memory?.passed ? "✅ Pass" : "❌ Fail"} |`);
        sections.push(`| Queue pressure | ${D.detail.queue?.passed ? "✅ Pass" : "❌ Fail"} |`);
        sections.push(``);
    }

    sections.push(`---`);
    sections.push(`_Report generated by \`tests/burnin/burninRunner.js\`_`);

    return sections.join("\n");
}

function generateRecoveryReport() {
    const now = new Date().toISOString();
    const B   = _results.B;
    const E   = _results.E;

    const lines = [];
    lines.push(`# JARVIS Recovery Validation Report\n`);
    lines.push(`| | |`);
    lines.push(`|---|---|`);
    lines.push(`| **Generated** | ${now} |`);
    lines.push(`| **Node** | ${process.version} |`);
    lines.push(`| **Server** | ${BASE} |`);
    lines.push(``);

    const recoveryPassed = (B?.passed ?? false) && (E?.passed ?? false);
    lines.push(`## Verdict\n`);
    lines.push(`**${recoveryPassed ? "✅ ALL RECOVERY CHECKS PASSED" : "❌ RECOVERY FAILURES DETECTED"}**\n`);

    // SIGTERM / SIGKILL recovery
    lines.push(`## Queue Persistence After Restart\n`);
    const persist = B?.detail?.persistence;
    if (persist) {
        const passCount = persist.passCount ?? "?";
        const failCount = persist.failCount ?? 0;
        lines.push(`| Test | Result |`);
        lines.push(`|---|---|`);
        lines.push(`| Test server startup | ${persist.passed || passCount > 0 ? "✅" : "❌"} |`);
        lines.push(`| 10 tasks added | ${persist.passed ? "✅" : "❌"} |`);
        lines.push(`| SIGTERM: queue valid JSON after shutdown | ${persist.passed ? "✅" : "❌"} |`);
        lines.push(`| SIGTERM: server restarts cleanly | ${persist.passed ? "✅" : "❌"} |`);
        lines.push(`| SIGTERM: all tasks survived restart | ${persist.passed ? "✅" : "❌"} |`);
        lines.push(`| SIGKILL: queue survives crash | ${persist.passed ? "✅" : "❌"} |`);
        lines.push(`| SIGKILL: server restarts cleanly | ${persist.passed ? "✅" : "❌"} |`);
        lines.push(`| SIGKILL: system healthy after crash | ${persist.passed ? "✅" : "❌"} |`);
        lines.push(`| Pass/Fail counts | ${passCount} pass, ${failCount} fail |`);
        lines.push(``);
    } else {
        lines.push(`_Not run._\n`);
    }

    // Adapter timeout recovery
    lines.push(`## Adapter Timeout + Orphan Cleanup\n`);
    const adapters = B?.detail?.adapters;
    if (adapters) {
        lines.push(`| Test | Result |`);
        lines.push(`|---|---|`);
        lines.push(`| sleep 30 timeout enforced (≤20s) | ${adapters.passed ? "✅" : "❌"} |`);
        lines.push(`| sudo blocked, no 500 | ${adapters.passed ? "✅" : "❌"} |`);
        lines.push(`| rm -rf blocked | ${adapters.passed ? "✅" : "❌"} |`);
        lines.push(`| wget/curl blocked | ${adapters.passed ? "✅" : "❌"} |`);
        lines.push(`| Unknown binary blocked | ${adapters.passed ? "✅" : "❌"} |`);
        lines.push(`| No orphan processes leaked | ${adapters.passed ? "✅" : "❌"} |`);
        lines.push(`| Server healthy after stress | ${adapters.passed ? "✅" : "❌"} |`);
        lines.push(`| Pass/Fail | ${adapters.passCount ?? "?"} pass, ${adapters.failCount ?? "?"} fail |`);
        lines.push(``);
    } else {
        lines.push(`_Not run._\n`);
    }

    // Frontend resilience
    lines.push(`## Frontend Disconnect / Reconnect\n`);
    const resil = E?.detail?.resilience;
    if (resil) {
        lines.push(`| Test | Result |`);
        lines.push(`|---|---|`);
        lines.push(`| 10 consecutive /ops polls | ${resil.passed ? "✅" : "❌"} |`);
        lines.push(`| Ops payload shape valid | ${resil.passed ? "✅" : "❌"} |`);
        lines.push(`| Stats payload shape valid | ${resil.passed ? "✅" : "❌"} |`);
        lines.push(`| 5-concurrent mount burst | ${resil.passed ? "✅" : "❌"} |`);
        lines.push(`| High-freq poll (10 req/s) | ${resil.passed ? "✅" : "❌"} |`);
        lines.push(`| Malformed request handling | ${resil.passed ? "✅" : "❌"} |`);
        lines.push(`| Tab navigation simulation | ${resil.passed ? "✅" : "❌"} |`);
        lines.push(`| Disconnect gap + reconnect | ${resil.passed ? "✅" : "❌"} |`);
        lines.push(``);
    } else {
        lines.push(`_Not run._\n`);
    }

    // Recovery simulation (queue file corruption, stale tasks, emergency cycle)
    lines.push(`## Runtime State Recovery\n`);
    const recov = E?.detail?.recovery;
    if (recov) {
        lines.push(`| Test | Result |`);
        lines.push(`|---|---|`);
        lines.push(`| Queue recovers from corrupted file | ${recov.passed ? "✅" : "❌"} |`);
        lines.push(`| Queue recovers from missing file | ${recov.passed ? "✅" : "❌"} |`);
        lines.push(`| Add tasks after corruption | ${recov.passed ? "✅" : "❌"} |`);
        lines.push(`| recoverStale() rescues stuck tasks | ${recov.passed ? "✅" : "❌"} |`);
        lines.push(`| Emergency stop → resume cycle | ${recov.passed ? "✅" : "❌"} |`);
        lines.push(`| Double declare is idempotent | ${recov.passed ? "✅" : "❌"} |`);
        lines.push(`| Low-authority declare rejected | ${recov.passed ? "✅" : "❌"} |`);
        lines.push(`| supervisor graceful unknown adapter | ${recov.passed ? "✅" : "❌"} |`);
        lines.push(`| Pass/Fail | ${recov.passCount ?? "?"} pass, ${recov.failCount ?? "?"} fail |`);
        lines.push(``);
    } else {
        lines.push(`_Not run._\n`);
    }

    // Long-running tests (instructions only — not run automatically)
    lines.push(`## Long-Running Endurance Tests (Manual)\n`);
    lines.push(`These tests require overnight runs. Run them separately:\n`);
    lines.push(`| Test | Command | Duration |`);
    lines.push(`|---|---|---|`);
    lines.push(`| 8-Hour continuous runtime | \`node tests/burnin/01-continuous-runtime.cjs --minutes=480\` | 8 hours |`);
    lines.push(`| 24-Hour idle stability | \`node tests/burnin/01-continuous-runtime.cjs --idle\` | 24 hours |`);
    lines.push(`| Full stability monitor (8h) | \`node tests/burnin/stabilityMonitor.js --minutes=480\` | 8 hours |`);
    lines.push(``);

    lines.push(`---`);
    lines.push(`_Report generated by \`tests/burnin/burninRunner.js\`_`);

    return lines.join("\n");
}

// ── System snapshot ───────────────────────────────────────────────────────────

async function systemSnapshot() {
    const r = await httpGet("/ops");
    return r.body ?? null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    banner("JARVIS Operator Burn-In Validation");
    console.log(`  Server:  ${BASE}`);
    console.log(`  Mode:    ${QUICK ? "quick" : "standard"}`);
    console.log(`  Node:    ${process.version}`);
    console.log(`  Date:    ${new Date().toISOString()}`);

    // Server reachability
    const probe = await httpGet("/health");
    console.log(`  Server:  ${probe.ok ? "\x1b[32mreachable\x1b[0m" : "\x1b[33mnot reachable — process-level tests will still run\x1b[0m"}`);

    const runPhases = PHASES_ARG ?? ["A", "B", "C", "D", "E"];

    // Pre-run snapshot
    const snapshotBefore = probe.ok ? await systemSnapshot() : null;

    // ── Phase execution ───────────────────────────────────────────────────────

    const COOL = QUICK ? 1000 : 3000;  // cooldown between intensive phases

    if (runPhases.includes("A")) { await phaseA_stability();   await sleep(COOL); }
    if (runPhases.includes("B")) { await phaseB_resilience();  await sleep(COOL); }
    if (runPhases.includes("C")) { await phaseC_simulation();  await sleep(COOL); }
    if (runPhases.includes("D")) { await phaseD_resources();   await sleep(COOL); }
    if (runPhases.includes("E")) { await phaseE_recovery(); }

    // Post-run snapshot
    const snapshotAfter = probe.ok ? await systemSnapshot() : null;

    // ── Results summary ───────────────────────────────────────────────────────

    banner("Burn-In Results");

    let allPassed = true;
    for (const [k, r] of Object.entries(_results)) {
        const icon  = r.passed ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
        const label = `Phase ${k} — ${r.label}`.padEnd(30);
        console.log(`  ${icon} ${label}  ${r.elapsed}s`);
        if (!r.passed) allPassed = false;
    }

    if (snapshotBefore && snapshotAfter) {
        const heapBefore = snapshotBefore?.memory?.current?.heap_mb ?? "?";
        const heapAfter  = snapshotAfter?.memory?.current?.heap_mb  ?? "?";
        const statusAfter = snapshotAfter?.status ?? "?";
        console.log(`\n  Server heap: ${heapBefore}MB → ${heapAfter}MB`);
        console.log(`  Server status after burn-in: ${statusAfter === "ok" ? "\x1b[32mok\x1b[0m" : statusAfter}`);
    }

    console.log("\n" + "─".repeat(W));
    console.log(allPassed
        ? `  \x1b[32mALL PHASES PASSED\x1b[0m`
        : `  \x1b[31m${Object.values(_results).filter(r => !r.passed).length} PHASE(S) FAILED\x1b[0m`);
    console.log("─".repeat(W));

    // ── Report generation ─────────────────────────────────────────────────────

    if (!NO_REPORTS) {
        fs.mkdirSync(REPORTS_DIR, { recursive: true });

        const runMeta = { ts: new Date().toISOString(), quick: QUICK, base: BASE };

        const healthMd   = generateHealthReport(runMeta);
        const recoveryMd = generateRecoveryReport();

        const healthPath   = path.join(REPORTS_DIR, "runtimeHealthReport.md");
        const recoveryPath = path.join(REPORTS_DIR, "recoveryValidationReport.md");

        fs.writeFileSync(healthPath,   healthMd);
        fs.writeFileSync(recoveryPath, recoveryMd);

        console.log(`\n  Reports written:`);
        console.log(`    ${path.relative(ROOT, healthPath)}`);
        console.log(`    ${path.relative(ROOT, recoveryPath)}`);
    }

    console.log();
    process.exit(allPassed ? 0 : 1);
}

main().catch(e => {
    console.error("\nBurn-in runner crashed:", e.message);
    process.exit(1);
});
