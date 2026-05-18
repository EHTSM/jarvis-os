"use strict";
/**
 * preflight — validate project environment before workflow execution.
 *
 * Checks:
 *   runtime   — node version, npm, git presence
 *   syntax    — node --check every .js/.cjs/.mjs file in a directory
 *   env       — required environment variable presence
 *   ports     — list of ports: free or occupied
 *   deps      — package.json present, node_modules present
 *
 * Each check returns { id, label, ok, blocking, detail }.
 * canProceed = no blocking check failed.
 */

const fs         = require("fs");
const path       = require("path");
const net        = require("net");
const { spawnSync } = require("child_process");

// ── Runtime checks ────────────────────────────────────────────────────

function checkNode(minMajor = 18) {
    const ver = process.versions.node;
    const major = parseInt(ver.split(".")[0]);
    return {
        id: "node", label: `Node.js >= ${minMajor} (found v${ver})`,
        ok: major >= minMajor, blocking: true,
        detail: `major=${major}`,
    };
}

function checkTool(name, args = ["--version"]) {
    const r = spawnSync(name, args, { encoding: "utf8", timeout: 5_000 });
    const ver = (r.stdout || r.stderr || "").trim().split("\n")[0];
    return {
        id: name, label: `${name} available (${ver || "not found"})`,
        ok: r.status === 0, blocking: false,
        detail: ver,
    };
}

// ── Port checks ───────────────────────────────────────────────────────

function checkPort(port) {
    return new Promise(resolve => {
        const srv = net.createServer();
        srv.once("error", () =>
            resolve({ id: `port:${port}`, label: `port ${port} free`, ok: false, blocking: false, detail: "in use" })
        );
        srv.once("listening", () =>
            srv.close(() =>
                resolve({ id: `port:${port}`, label: `port ${port} free`, ok: true, blocking: false, detail: "available" })
            )
        );
        srv.listen(port, "127.0.0.1");
    });
}

async function checkPorts(ports = []) {
    return Promise.all(ports.map(p => checkPort(p)));
}

// ── Syntax scan ───────────────────────────────────────────────────────

function scanSyntax(dir, opts = {}) {
    if (!fs.existsSync(dir)) return { ok: false, errors: [], filesChecked: 0, detail: "directory not found" };
    const maxDepth = opts.maxDepth ?? 3;
    const files    = _collectJsFiles(dir, maxDepth);
    const errors   = [];
    for (const f of files) {
        const r = spawnSync("node", ["--check", f], { encoding: "utf8", timeout: 5_000 });
        if (r.status !== 0) {
            const lines   = (r.stderr || "").split("\n").map(l => l.trim()).filter(Boolean);
            const errLine = lines.find(l => /SyntaxError|error/i.test(l)) || lines[0] || "unknown error";
            errors.push({ file: f, basename: path.basename(f), error: errLine });
        }
    }
    const ok = errors.length === 0;
    return {
        id:           "syntax",
        label:        ok ? `syntax: ${files.length} file(s) clean` : `syntax: ${errors.length} error(s) in ${files.length} file(s)`,
        ok,
        blocking:     false,
        filesChecked: files.length,
        errors,
        detail:       ok ? "all clean" : errors.map(e => e.basename).join(", "),
    };
}

function _collectJsFiles(dir, depth) {
    const results = [];
    if (depth < 0) return results;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return results; }
    for (const e of entries) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) results.push(..._collectJsFiles(full, depth - 1));
        else if (/\.(js|cjs|mjs)$/.test(e.name)) results.push(full);
    }
    return results;
}

// ── Env checks ────────────────────────────────────────────────────────

function checkEnv(required = []) {
    const missing = required.filter(k => !process.env[k]);
    const ok      = missing.length === 0;
    return {
        id: "env", label: ok ? `env: all ${required.length} var(s) present` : `env: missing ${missing.join(", ")}`,
        ok, blocking: false,
        missing, present: required.filter(k => process.env[k]),
        detail: ok ? "ok" : `missing: ${missing.join(", ")}`,
    };
}

// ── Dependency checks ─────────────────────────────────────────────────

function scanDependencies(projectPath) {
    const pkgFile = path.join(projectPath, "package.json");
    const nmDir   = path.join(projectPath, "node_modules");
    const hasPkg  = fs.existsSync(pkgFile);
    const hasNm   = fs.existsSync(nmDir);

    let missingDeps = [];
    if (hasPkg && hasNm) {
        try {
            const pkg  = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
            const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
            missingDeps = deps.filter(d => !fs.existsSync(path.join(nmDir, d)));
        } catch { /* malformed package.json */ }
    }

    const ok = hasPkg && hasNm && missingDeps.length === 0;
    return {
        id: "deps",
        label: !hasPkg ? "deps: no package.json" : !hasNm ? "deps: node_modules missing" :
               missingDeps.length > 0 ? `deps: ${missingDeps.length} package(s) missing` : "deps: ok",
        ok, blocking: false,
        hasPkg, hasNm, missingDeps,
        detail: missingDeps.length > 0 ? missingDeps.join(", ") : "ok",
    };
}

// ── Full preflight run ────────────────────────────────────────────────

async function runPreflight(projectPath, opts = {}) {
    const {
        requiredPorts   = [],
        requiredEnv     = [],
        minNodeMajor    = 18,
        checkDeps       = true,
        checkSyntaxScan = true,
    } = opts;

    const checks = [];

    // Runtime
    checks.push(checkNode(minNodeMajor));
    if (opts.requireNpm !== false)  checks.push(checkTool("npm",  ["-v"]));
    if (opts.requireGit !== false)  checks.push(checkTool("git",  ["--version"]));

    // Ports
    if (requiredPorts.length > 0) {
        const portResults = await checkPorts(requiredPorts);
        checks.push(...portResults);
    }

    // Env vars
    if (requiredEnv.length > 0) checks.push(checkEnv(requiredEnv));

    // Deps
    if (checkDeps && projectPath) checks.push(scanDependencies(projectPath));

    // Syntax
    if (checkSyntaxScan && projectPath) checks.push(scanSyntax(projectPath));

    const passed     = checks.filter(c => c.ok).length;
    const failed     = checks.filter(c => !c.ok).length;
    const canProceed = !checks.some(c => !c.ok && c.blocking);
    const warnings   = checks.filter(c => !c.ok && !c.blocking);

    return {
        checks,
        passed,
        failed,
        warnings: warnings.map(c => c.label),
        canProceed,
        summary: canProceed
            ? `preflight passed (${passed}/${checks.length} checks ok, ${warnings.length} warning(s))`
            : `preflight BLOCKED — ${checks.filter(c => !c.ok && c.blocking).map(c => c.label).join("; ")}`,
    };
}

module.exports = { runPreflight, checkNode, checkTool, checkPort, checkPorts, checkEnv, scanSyntax, scanDependencies };
