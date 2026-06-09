"use strict";
/**
 * Phase 612 — Environment Bootstrap Hardening
 *
 * Validates and recovers the engineering environment on startup:
 * dependency verification, env file check, port binding test,
 * data directory initialization, bootstrap plan execution.
 * Idempotent — safe to run repeatedly.
 */

const fs   = require("fs");
const path = require("path");
const net  = require("net");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const WORKSPACE_ROOT = process.cwd();

// ── Port availability check ───────────────────────────────────────────────────

function checkPortAvailable(port) {
    return new Promise(resolve => {
        const server = net.createServer();
        server.unref();
        server.on("error", () => resolve({ port, available: false }));
        server.listen(port, "127.0.0.1", () => {
            server.close(() => resolve({ port, available: true }));
        });
    });
}

async function checkPorts(ports = [3000, 5050, 5173]) {
    const results = await Promise.all(ports.map(checkPortAvailable));
    return results;
}

// ── Data directory initialization ─────────────────────────────────────────────

function ensureDataDir() {
    const dataPath = path.join(WORKSPACE_ROOT, "data");
    try {
        fs.mkdirSync(dataPath, { recursive: true });
        return { ok: true, path: dataPath, created: !fs.statSync(dataPath).birthtime };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

// ── Dependency verification ───────────────────────────────────────────────────

function verifyDependencies() {
    const checks = [];

    // package.json
    const pkgPath = path.join(WORKSPACE_ROOT, "package.json");
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")); checks.push({ name: "package.json", ok: true }); } catch { checks.push({ name: "package.json", ok: false, error: "missing or invalid" }); }

    // node_modules
    try {
        const nmStat = fs.statSync(path.join(WORKSPACE_ROOT, "node_modules"));
        checks.push({ name: "node_modules", ok: nmStat.isDirectory() });
    } catch { checks.push({ name: "node_modules", ok: false, error: "run npm install" }); }

    // package-lock.json
    try {
        fs.statSync(path.join(WORKSPACE_ROOT, "package-lock.json"));
        checks.push({ name: "package-lock.json", ok: true });
    } catch { checks.push({ name: "package-lock.json", ok: false, error: "missing — commit or run npm install" }); }

    const passed = checks.filter(c => c.ok).length;
    return { ok: passed === checks.length, checks, passed, total: checks.length };
}

// ── Env file validation ───────────────────────────────────────────────────────

const REQUIRED_ENV_VARS = ["PORT", "JWT_SECRET", "NODE_ENV"];

function validateEnvFile() {
    const envPath = path.join(WORKSPACE_ROOT, ".env");
    const checks  = [];

    let raw = null;
    try { raw = fs.readFileSync(envPath, "utf8"); } catch {
        return { ok: false, error: ".env not found", checks: [] };
    }

    const defined = new Set(
        raw.split("\n")
            .map(l => l.trim())
            .filter(l => l && !l.startsWith("#") && l.includes("="))
            .map(l => l.split("=")[0].trim())
    );

    REQUIRED_ENV_VARS.forEach(v => {
        checks.push({ name: v, ok: defined.has(v), detail: defined.has(v) ? null : `${v} not set in .env` });
    });

    const passed = checks.filter(c => c.ok).length;
    return { ok: passed === checks.length, checks, passed, total: checks.length };
}

// ── Bootstrap plan ────────────────────────────────────────────────────────────

function bootstrapPlan() {
    const deps    = verifyDependencies();
    const env     = validateEnvFile();
    const dataDir = ensureDataDir();

    const issues  = [];
    if (!deps.ok)  issues.push(...deps.checks.filter(c => !c.ok).map(c => ({ area: "deps",    detail: c.error || c.name })));
    if (!env.ok)   issues.push(...env.checks.filter(c => !c.ok).map(c =>  ({ area: "env",     detail: c.detail || c.name })));
    if (!dataDir.ok) issues.push({ area: "data-dir", detail: dataDir.error });

    const steps = issues.map((issue, i) => ({
        order:  i,
        area:   issue.area,
        detail: issue.detail,
        action: _bootstrapAction(issue.area, issue.detail),
        safe:   true,
    }));

    if (steps.length === 0) {
        steps.push({ order: 0, area: "validation", detail: "All checks passed", action: "No action required", safe: true });
    }

    return {
        ok:           issues.length === 0,
        issueCount:   issues.length,
        steps,
        deps,
        env,
        dataDir,
        summary:      issues.length === 0 ? "Environment healthy — no bootstrap needed" : `${issues.length} issue(s) require attention`,
    };
}

function _bootstrapAction(area, detail) {
    if (area === "deps")     return "Run: npm install";
    if (area === "env")      return `Set ${detail} in .env file`;
    if (area === "data-dir") return "Create data/ directory: mkdir data";
    return "Manual investigation required";
}

// ── Full hardening run ────────────────────────────────────────────────────────

async function runHardening() {
    const plan  = bootstrapPlan();
    const ports = await checkPorts([3000, 5050, 5173]);
    const busyPorts = ports.filter(p => !p.available);

    const eeh  = _tryRequire("./engineeringEnvironmentHealth.cjs");
    let envHealth = null;
    if (eeh) try { envHealth = eeh.scanEnvironment(); } catch {}

    return {
        ok:          plan.ok && busyPorts.length === 0,
        plan,
        ports,
        busyPorts:   busyPorts.map(p => p.port),
        envHealth,
        summary:     `Bootstrap: ${plan.ok ? "OK" : `${plan.issueCount} issues`} | Ports: ${busyPorts.length} busy`,
    };
}

module.exports = { checkPorts, ensureDataDir, verifyDependencies, validateEnvFile, bootstrapPlan, runHardening };
