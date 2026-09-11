"use strict";
/**
 * electron-perf-validate.cjs — measures real startup time and memory usage
 * of the packaged Electron app across multiple cold-start runs, producing
 * an averaged, honest report (not a single cherry-picked sample).
 *
 * Usage: node scripts/electron-perf-validate.cjs <path-to-app-executable> [runs]
 */
const { spawn } = require("child_process");
const { execSync } = require("child_process");

const appPath = process.argv[2];
const runs = parseInt(process.argv[3] || "3", 10);
if (!appPath) {
    console.error("Usage: node electron-perf-validate.cjs <path-to-app-executable> [runs]");
    process.exit(1);
}

const SETTLE_MS = 5000;   // let the process finish its startup sequence
const SAMPLE_MS = 500;

function runOnce(n) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const child = spawn(appPath, [], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
            stdio: ["ignore", "ignore", "ignore"],
        });
        delete child.spawnargs; // no-op, just avoids accidental env leakage in logs

        let firstAliveMs = null;
        const samples = [];
        const sampleInterval = setInterval(() => {
            if (!child.pid) return;
            try {
                const out = execSync(`ps -o rss= -p ${child.pid}`, { encoding: "utf8" }).trim();
                const rssKb = parseInt(out, 10);
                if (Number.isFinite(rssKb)) {
                    if (firstAliveMs === null) firstAliveMs = Date.now() - t0;
                    samples.push(Math.round(rssKb / 1024));
                }
            } catch { /* process may not exist yet or just exited */ }
        }, SAMPLE_MS);

        setTimeout(() => {
            clearInterval(sampleInterval);
            const result = {
                run: n,
                firstAliveMs,
                peakMb: samples.length ? Math.max(...samples) : null,
                finalMb: samples.length ? samples[samples.length - 1] : null,
                sampleCount: samples.length,
            };
            try { child.kill("SIGTERM"); } catch {}
            setTimeout(() => {
                try { child.kill("SIGKILL"); } catch {}
                resolve(result);
            }, 1500);
        }, SETTLE_MS);
    });
}

async function main() {
    console.log(`[perf-validate] Running ${runs} cold-start measurements against: ${appPath}\n`);
    const results = [];
    for (let i = 1; i <= runs; i++) {
        console.log(`[perf-validate] Run ${i}/${runs}...`);
        const r = await runOnce(i);
        console.log(`  firstAliveMs=${r.firstAliveMs} peakMb=${r.peakMb} finalMb=${r.finalMb} samples=${r.sampleCount}`);
        results.push(r);
        // Brief pause between runs so each is a genuine cold start, not
        // overlapping with the previous run's teardown.
        await new Promise(r2 => setTimeout(r2, 2000));
    }

    const validRuns = results.filter(r => r.firstAliveMs !== null);
    const avgFirstAlive = validRuns.length ? Math.round(validRuns.reduce((a, r) => a + r.firstAliveMs, 0) / validRuns.length) : null;
    const avgPeak = validRuns.length ? Math.round(validRuns.reduce((a, r) => a + r.peakMb, 0) / validRuns.length) : null;
    const avgFinal = validRuns.length ? Math.round(validRuns.reduce((a, r) => a + r.finalMb, 0) / validRuns.length) : null;

    console.log(`\n${"=".repeat(50)}`);
    console.log(`Performance Validation Summary (${validRuns.length}/${runs} successful runs)`);
    console.log(`  Avg time-to-first-resident-sample: ${avgFirstAlive}ms`);
    console.log(`  Avg peak RSS during startup window: ${avgPeak}MB`);
    console.log(`  Avg RSS after ${SETTLE_MS}ms settle: ${avgFinal}MB`);
    console.log(`${"=".repeat(50)}`);
    console.log(JSON.stringify({ runs: results, avgFirstAlive, avgPeak, avgFinal }, null, 2));

    process.exit(validRuns.length === runs ? 0 : 1);
}
main();
