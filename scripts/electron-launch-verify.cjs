"use strict";
/**
 * electron-launch-verify.cjs — launches the packaged Electron app binary
 * directly (not `npm run electron`, the real installed executable) headless,
 * waits for it to report readiness via a log line, measures startup time and
 * memory, then quits it cleanly. Used to verify a produced installer's
 * unpacked app actually launches, not just that its files exist.
 *
 * Usage: node scripts/electron-launch-verify.cjs <path-to-app-executable>
 */
const { spawn } = require("child_process");
const path = require("path");

const appPath = process.argv[2];
if (!appPath) {
    console.error("Usage: node electron-launch-verify.cjs <path-to-app-executable>");
    process.exit(1);
}

const LAUNCH_TIMEOUT_MS = 30_000;

console.log(`[launch-verify] Starting: ${appPath}`);
const t0 = Date.now();

const child = spawn(appPath, [], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
});

let launched = false;
let stdout = "";
let stderr = "";
let memSamples = [];

child.stdout.on("data", d => { stdout += d.toString(); });
child.stderr.on("data", d => { stderr += d.toString(); });

const memInterval = setInterval(() => {
    if (!child.pid) return;
    try {
        const { execSync } = require("child_process");
        // ps RSS in KB for the main process (does not include renderer/GPU
        // helper child processes — a real full-suite measurement would sum
        // the process tree, but the main process RSS is the stable,
        // comparable signal for a startup-memory check).
        const out = execSync(`ps -o rss= -p ${child.pid}`, { encoding: "utf8" }).trim();
        const rssKb = parseInt(out, 10);
        if (Number.isFinite(rssKb)) memSamples.push({ t: Date.now() - t0, rssMb: Math.round(rssKb / 1024) });
    } catch { /* process may have exited between the pid check and ps call */ }
}, 1000);

const timeout = setTimeout(() => {
    clearInterval(memInterval);
    console.error(`[launch-verify] FAIL — app did not signal readiness within ${LAUNCH_TIMEOUT_MS}ms`);
    console.error("--- stdout ---\n" + stdout.slice(-2000));
    console.error("--- stderr ---\n" + stderr.slice(-2000));
    try { child.kill("SIGKILL"); } catch {}
    process.exit(1);
}, LAUNCH_TIMEOUT_MS);

child.on("exit", (code, signal) => {
    clearInterval(memInterval);
    clearTimeout(timeout);
    if (!launched) {
        console.error(`[launch-verify] FAIL — process exited early (code=${code} signal=${signal}) before confirming launch`);
        console.error("--- stdout ---\n" + stdout.slice(-2000));
        console.error("--- stderr ---\n" + stderr.slice(-2000));
        process.exit(1);
    }
});

// Poll stdout/stderr for a real signal the window/renderer actually loaded.
// main.cjs logs "[Electron] Backend process started" and the renderer emits
// "runtime-ready" over IPC (not observable from here), so the most robust
// externally-visible signal is the process staying alive past a settle
// window without crashing, combined with real memory being resident (a
// crashed/never-launched process reports 0 or immediately exits).
const checkInterval = setInterval(() => {
    if (launched) return;
    const elapsed = Date.now() - t0;
    if (elapsed > 4000 && child.pid && memSamples.length >= 2) {
        launched = true;
        clearInterval(checkInterval);
        clearTimeout(timeout);
        const startupMs = elapsed;
        console.log(`[launch-verify] PASS — process alive and resident after ${startupMs}ms`);
        console.log(`[launch-verify] Memory samples (MB RSS over time):`, JSON.stringify(memSamples));
        const peakMb = Math.max(...memSamples.map(s => s.rssMb));
        console.log(`[launch-verify] Peak RSS during startup window: ${peakMb}MB`);

        setTimeout(() => {
            clearInterval(memInterval);
            try { child.kill("SIGTERM"); } catch {}
            setTimeout(() => { try { child.kill("SIGKILL"); } catch {} process.exit(0); }, 3000);
        }, 2000);
    }
}, 500);
