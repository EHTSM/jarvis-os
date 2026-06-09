"use strict";
/**
 * Phase 359 — Execution Verification Engine
 *
 * Post-execution validation layer. Verifies:
 *   - Command outcome (exit code / success flag)
 *   - Process health (pm2 status for runtime processes)
 *   - Service reachability (health endpoint ping)
 *   - File integrity (existence checks for expected outputs)
 *
 * Prevents false-positive success from the orchestrator.
 * All checks are optional — missing probes degrade gracefully.
 * Max verification time: 10s total.
 */

const { execSync } = require("child_process");
const fs           = require("fs");
const http         = require("http");
const logger       = require("../../backend/utils/logger");

const MAX_VERIFY_MS = 10_000;

function _deadline(ms) {
    return new Promise((_, reject) =>
        setTimeout(() => reject(new Error("verification_timeout")), ms).unref()
    );
}

// ── Individual checks ─────────────────────────────────────────────────────────

/** Verify a pm2 process is online */
function _checkPm2Process(processName) {
    try {
        const out = execSync(`pm2 jlist 2>/dev/null`, { timeout: 4000, encoding: "utf8" });
        const procs = JSON.parse(out);
        const proc  = procs.find(p => p.name === processName);
        if (!proc)  return { ok: false, reason: `${processName} not found in pm2 list` };
        if (proc.pm2_env.status !== "online")
            return { ok: false, reason: `${processName} status=${proc.pm2_env.status}` };
        return { ok: true, pid: proc.pid, uptime: proc.pm2_env.pm_uptime };
    } catch (err) {
        return { ok: false, reason: `pm2 check failed: ${err.message}` };
    }
}

/** Verify a local HTTP health endpoint responds 200 */
function _checkHttpHealth(url, timeoutMs = 3000) {
    return new Promise((resolve) => {
        try {
            const req = http.get(url, { timeout: timeoutMs }, (res) => {
                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300,
                    statusCode: res.statusCode });
            });
            req.on("error", (err) => resolve({ ok: false, reason: err.message }));
            req.on("timeout", () => { req.destroy(); resolve({ ok: false, reason: "http_timeout" }); });
        } catch (err) {
            resolve({ ok: false, reason: err.message });
        }
    });
}

/** Verify a file exists and is non-empty */
function _checkFile(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return { ok: stat.size > 0, size: stat.size };
    } catch {
        return { ok: false, reason: `file not found: ${filePath}` };
    }
}

// ── Main verification entry ───────────────────────────────────────────────────

/**
 * Verify execution outcome.
 *
 * @param {object} result — result object from executionCoordinator/orchestrator
 * @param {object} probes — verification probes to run
 * @param {string[]} [probes.pm2Processes]  — list of pm2 process names to check
 * @param {string[]} [probes.httpEndpoints] — list of URLs to ping
 * @param {string[]} [probes.files]         — list of file paths that must exist
 * @returns {Promise<{ verified, checks, falsePositive, summary }>}
 */
async function verify(result, probes = {}) {
    const checks  = [];
    const startMs = Date.now();

    // 1. Outcome check — was the result itself a success?
    checks.push({
        name:   "execution_outcome",
        ok:     result?.success === true,
        detail: result?.success ? "Command reported success" : (result?.error || "Command reported failure"),
    });

    // 2. Pm2 process health
    if (probes.pm2Processes?.length) {
        for (const name of probes.pm2Processes) {
            if (Date.now() - startMs > MAX_VERIFY_MS - 1000) break;
            const check = _checkPm2Process(name);
            checks.push({ name: `pm2:${name}`, ...check });
        }
    }

    // 3. HTTP health endpoints
    if (probes.httpEndpoints?.length) {
        for (const url of probes.httpEndpoints) {
            if (Date.now() - startMs > MAX_VERIFY_MS - 1000) break;
            try {
                const check = await Promise.race([_checkHttpHealth(url), _deadline(3000)]);
                checks.push({ name: `http:${url}`, ...check });
            } catch {
                checks.push({ name: `http:${url}`, ok: false, reason: "probe_timeout" });
            }
        }
    }

    // 4. File existence checks
    if (probes.files?.length) {
        for (const f of probes.files) {
            checks.push({ name: `file:${f}`, ..._checkFile(f) });
        }
    }

    const allOk       = checks.every(c => c.ok);
    const anyFailed   = checks.some(c => !c.ok);
    // False positive: execution claimed success but post-checks fail
    const falsePositive = result?.success === true && anyFailed;

    const summary = checks.map(c => `${c.ok ? "✓" : "✗"} ${c.name}${c.reason ? ` (${c.reason})` : ""}`).join("\n");

    if (falsePositive) {
        logger.warn(`[Verifier] false-positive detected — orchestrator said success but checks failed:\n${summary}`);
    }

    return { verified: allOk, checks, falsePositive, summary, durationMs: Date.now() - startMs };
}

/**
 * Auto-probe: infer relevant probes from a command string.
 * Lets callers skip manually specifying probes.
 */
function inferProbes(cmd) {
    const probes = { pm2Processes: [], httpEndpoints: [], files: [] };
    if (!cmd) return probes;

    if (/pm2 restart|pm2 start/i.test(cmd)) {
        probes.pm2Processes.push("jarvis-backend");
    }
    if (/npm run build/i.test(cmd)) {
        probes.files.push("frontend/dist/index.html");
    }
    if (/health|api.*status/i.test(cmd)) {
        probes.httpEndpoints.push("http://localhost:3001/api/health");
    }

    return probes;
}

module.exports = { verify, inferProbes };
