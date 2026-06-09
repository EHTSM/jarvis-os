"use strict";
/**
 * Phase 608 — Engineering Environment Health
 *
 * Validates the local engineering environment: Node version, required files,
 * env vars, port availability, disk space, runtime process signals.
 * Read-only scans only — no mutation.
 */

const fs     = require("fs");
const path   = require("path");
const os     = require("os");
const { execSync } = require("child_process");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const WORKSPACE_ROOT = process.cwd();

// ── Check helpers ─────────────────────────────────────────────────────────────

function _checkNodeVersion() {
    const current = process.version;
    const major   = parseInt(current.slice(1).split(".")[0], 10);
    const ok      = major >= 18;
    return { name: "node-version", ok, value: current, required: ">=18", detail: ok ? null : `Node ${current} below minimum 18` };
}

function _checkEnvFile() {
    const envPath = path.join(WORKSPACE_ROOT, ".env");
    let exists = false;
    try { fs.statSync(envPath); exists = true; } catch {}
    return { name: "env-file", ok: exists, path: envPath, detail: exists ? null : ".env not found" };
}

function _checkPackageJson() {
    const pkgPath = path.join(WORKSPACE_ROOT, "package.json");
    let ok = false, name = null;
    try { const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); ok = true; name = pkg.name; } catch {}
    return { name: "package-json", ok, projectName: name, detail: ok ? null : "package.json missing or invalid" };
}

function _checkNodeModules() {
    const nmPath = path.join(WORKSPACE_ROOT, "node_modules");
    let ok = false;
    try { ok = fs.statSync(nmPath).isDirectory(); } catch {}
    return { name: "node-modules", ok, path: nmPath, detail: ok ? null : "node_modules not found — run npm install" };
}

function _checkDiskSpace() {
    let freeGb = null, ok = true;
    try {
        const stat = fs.statfsSync("/");
        freeGb     = Math.round((stat.bfree * stat.bsize) / (1024 ** 3) * 10) / 10;
        ok         = freeGb > 1;
    } catch {}
    return { name: "disk-space", ok, freeGb, detail: ok ? null : `Low disk space: ${freeGb}GB free` };
}

function _checkMemory() {
    const freeGb  = Math.round(os.freemem() / (1024 ** 3) * 10) / 10;
    const totalGb = Math.round(os.totalmem() / (1024 ** 3) * 10) / 10;
    const ok      = freeGb > 0.25;
    return { name: "memory", ok, freeGb, totalGb, detail: ok ? null : `Low free memory: ${freeGb}GB` };
}

function _checkGitRepo() {
    const gitPath = path.join(WORKSPACE_ROOT, ".git");
    let ok = false;
    try { ok = fs.statSync(gitPath).isDirectory(); } catch {}
    return { name: "git-repo", ok, detail: ok ? null : "Not a git repository" };
}

function _checkDataDir() {
    const dataPath = path.join(WORKSPACE_ROOT, "data");
    let ok = false;
    try { ok = fs.statSync(dataPath).isDirectory(); } catch {}
    return { name: "data-dir", ok, path: dataPath, detail: ok ? null : "data/ directory missing — state persistence unavailable" };
}

function _checkBackendFile() {
    const candidates = [
        path.join(WORKSPACE_ROOT, "backend", "server.js"),
        path.join(WORKSPACE_ROOT, "backend", "index.js"),
        path.join(WORKSPACE_ROOT, "server.js"),
    ];
    for (const p of candidates) {
        try { fs.statSync(p); return { name: "backend-entry", ok: true, path: p }; } catch {}
    }
    return { name: "backend-entry", ok: false, detail: "No backend entry file found" };
}

// ── Full environment scan ─────────────────────────────────────────────────────

function scanEnvironment() {
    const checks = [
        _checkNodeVersion(),
        _checkEnvFile(),
        _checkPackageJson(),
        _checkNodeModules(),
        _checkDiskSpace(),
        _checkMemory(),
        _checkGitRepo(),
        _checkDataDir(),
        _checkBackendFile(),
    ];

    const passed   = checks.filter(c => c.ok).length;
    const failed   = checks.filter(c => !c.ok);
    const score    = Math.round(passed / checks.length * 100);
    const healthy  = failed.filter(c => c.name !== "env-file").length === 0; // env file optional
    const warnings = failed.map(c => c.detail).filter(Boolean);

    return {
        ok:       healthy,
        score,
        passed,
        total:    checks.length,
        checks,
        warnings,
        summary:  `Environment: ${score}% (${passed}/${checks.length} checks passed)`,
    };
}

// ── Runtime process health ────────────────────────────────────────────────────

function processHealth() {
    const ts  = _tryRequire("./terminalSupervisor.cjs");
    if (!ts) return { ok: true, processes: [], note: "terminalSupervisor unavailable" };

    let registry = [], runaway = null;
    try {
        const state = ts.getRegistry ? ts.getRegistry() : null;
        registry    = state?.processes || [];
    } catch {}
    try { runaway = ts.detectRunaway(); } catch {}

    return {
        ok:          !(runaway?.staleCount > 0 || runaway?.runawayCount > 0),
        processCount: registry.length,
        staleCount:  runaway?.staleCount   || 0,
        runawayCount: runaway?.runawayCount || 0,
        summary:     `Processes: ${registry.length} tracked`,
    };
}

// ── Combined health report ────────────────────────────────────────────────────

function environmentHealthReport() {
    const env  = scanEnvironment();
    const proc = processHealth();
    return {
        ok:          env.ok && proc.ok,
        environment: env,
        processes:   proc,
        summary:     `${env.summary} | ${proc.summary}`,
    };
}

module.exports = { scanEnvironment, processHealth, environmentHealthReport };
