"use strict";
/**
 * preDeployValidator — comprehensive pre-deployment validation.
 *
 * validate(config)          → { passed, score, checks[], failed[], warnings[] }
 * runChecks(checks[])       → same — run a custom set of { name, fn } checks
 *
 * Built-in check factories:
 *   fileExists(path)        → check object
 *   envVarSet(name)         → check object
 *   portAvailable(port)     → check object (async)
 *   dirWritable(path)       → check object
 *   minFreeMemMB(mb)        → check object
 */

const fs  = require("fs");
const os  = require("os");
const net = require("net");

async function runChecks(checks) {
    const results = [];
    for (const check of checks) {
        try {
            const ok = await Promise.resolve(check.fn());
            results.push({ name: check.name, passed: !!ok, note: check.note });
        } catch (e) {
            results.push({ name: check.name, passed: false, note: e.message });
        }
    }
    const failed   = results.filter(r => !r.passed);
    const warnings = results.filter(r => r.passed && r.note);
    const score    = results.length > 0
        ? Math.round(results.filter(r => r.passed).length / results.length * 100)
        : 100;
    return { passed: failed.length === 0, score, checks: results, failed, warnings };
}

async function validate(config = {}) {
    const checks = [];

    if (config.requiredFiles) {
        for (const f of config.requiredFiles) checks.push(fileExists(f));
    }
    if (config.requiredEnvVars) {
        for (const v of config.requiredEnvVars) checks.push(envVarSet(v));
    }
    if (config.ports) {
        for (const p of config.ports) checks.push(portAvailable(p));
    }
    if (config.writableDirs) {
        for (const d of config.writableDirs) checks.push(dirWritable(d));
    }
    if (config.minFreeMemMB) {
        checks.push(minFreeMemMB(config.minFreeMemMB));
    }
    if (config.checks) {
        checks.push(...config.checks);
    }

    if (checks.length === 0) return { passed: true, score: 100, checks: [], failed: [], warnings: [] };
    return runChecks(checks);
}

// ── Check factories ───────────────────────────────────────────────

function fileExists(filePath) {
    return {
        name: `file_exists:${filePath}`,
        fn:   () => fs.existsSync(filePath),
    };
}

function envVarSet(name) {
    return {
        name: `env_var:${name}`,
        fn:   () => !!process.env[name],
    };
}

function portAvailable(port) {
    return {
        name: `port_available:${port}`,
        fn:   () => new Promise(resolve => {
            const s = net.createServer();
            s.listen(port, "127.0.0.1", () => s.close(() => resolve(true)));
            s.on("error", () => resolve(false));
        }),
    };
}

function dirWritable(dirPath) {
    return {
        name: `dir_writable:${dirPath}`,
        fn:   () => {
            try { fs.accessSync(dirPath, fs.constants.W_OK); return true; }
            catch { return false; }
        },
    };
}

function minFreeMemMB(mb) {
    return {
        name: `min_free_mem:${mb}MB`,
        fn:   () => os.freemem() / 1e6 >= mb,
    };
}

module.exports = { validate, runChecks, fileExists, envVarSet, portAvailable, dirWritable, minFreeMemMB };
