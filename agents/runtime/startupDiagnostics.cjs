"use strict";
/**
 * startupDiagnostics — system readiness checks run at boot.
 *
 * runDiagnostics()     → { passed, score, checks[], failed[], warnings[], runAt }
 * checkDataDirs()      → check[] — required directories exist (creates if missing)
 * checkMemory()        → check[] — free memory above minimum threshold
 * checkModules()       → check[] — critical runtime modules load cleanly
 * checkNodeVersion()   → check[] — Node.js >= 18
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const REQUIRED_DIRS = [
    "data",
    "data/workflow-checkpoints",
    "agents/runtime",
];

const REQUIRED_MODULES = [
    "./autonomousWorkflow.cjs",
    "./executionPlanner.cjs",
    "./trustScorer.cjs",
    "./anomalyDetector.cjs",
    "./runtimeStabilizer.cjs",
];

const MIN_FREE_MEM_RATIO = 0.05; // warn if less than 5% free

function checkNodeVersion() {
    const [major] = process.versions.node.split(".").map(Number);
    return [{
        check:  "node:version",
        passed: major >= 18,
        note:   `Node.js ${process.versions.node}${major < 18 ? " (requires >= 18)" : ""}`,
    }];
}

function checkDataDirs() {
    const results = [];
    for (const dir of REQUIRED_DIRS) {
        const abs    = path.resolve(process.cwd(), dir);
        const exists = fs.existsSync(abs);
        if (!exists) {
            try {
                fs.mkdirSync(abs, { recursive: true });
                results.push({ check: `dir:${dir}`, passed: true, note: "created" });
            } catch (e) {
                results.push({ check: `dir:${dir}`, passed: false, note: e.message });
            }
        } else {
            results.push({ check: `dir:${dir}`, passed: true });
        }
    }
    return results;
}

function checkMemory() {
    const free  = os.freemem();
    const total = os.totalmem();
    const ratio = free / total;
    return [{
        check:  "memory:free_ratio",
        passed: ratio > MIN_FREE_MEM_RATIO,
        note:   `${(ratio * 100).toFixed(1)}% free (${Math.round(free / 1e6)}MB / ${Math.round(total / 1e6)}MB)`,
    }];
}

function checkModules() {
    const results = [];
    for (const mod of REQUIRED_MODULES) {
        const abs = path.resolve(__dirname, mod);
        try {
            require(abs);
            results.push({ check: `module:${mod}`, passed: true });
        } catch (e) {
            results.push({ check: `module:${mod}`, passed: false, note: e.message });
        }
    }
    return results;
}

function runDiagnostics() {
    const checks = [
        ...checkNodeVersion(),
        ...checkDataDirs(),
        ...checkMemory(),
        ...checkModules(),
    ];

    const failed   = checks.filter(c => !c.passed);
    const warnings = checks.filter(c => c.passed && c.note);
    const score    = Math.round(checks.filter(c => c.passed).length / checks.length * 100);

    return {
        passed:   failed.length === 0,
        score,
        checks,
        failed,
        warnings,
        runAt: new Date().toISOString(),
    };
}

module.exports = { runDiagnostics, checkDataDirs, checkMemory, checkModules, checkNodeVersion };
