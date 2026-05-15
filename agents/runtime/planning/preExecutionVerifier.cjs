"use strict";
/**
 * preExecutionVerifier — verify all prerequisites before executing a plan.
 *
 * verify(plan, context?)      → Promise<{ passed, checks[], failures[], summary }>
 * verifyFiles(paths[])        → checks[]
 * verifyDependencies(deps[])  → checks[]
 * verifyPorts(ports[])        → Promise<checks[]>
 * verifyPermissions(perms[])  → checks[]   perms = [{ path, mode? }]
 * verifySecrets(envVars[])    → checks[]
 */

const fs  = require("fs");
const net = require("net");

function _portFree(port) {
    return new Promise(resolve => {
        const srv = net.createServer();
        srv.unref();
        srv.once("error", () => resolve(false));
        srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
    });
}

// ── verifyFiles ───────────────────────────────────────────────────────

function verifyFiles(paths = []) {
    return paths.map(p => {
        const exists = fs.existsSync(p);
        return {
            check:   "file_exists",
            target:  p,
            passed:  exists,
            message: exists ? `${p} exists` : `${p} not found`,
        };
    });
}

// ── verifyDependencies ────────────────────────────────────────────────

function verifyDependencies(deps = []) {
    return deps.map(dep => {
        let found = false;
        try { require.resolve(dep); found = true; } catch (_) { /* not installed */ }
        return {
            check:   "dependency_installed",
            target:  dep,
            passed:  found,
            message: found ? `${dep} is resolvable` : `${dep} not found`,
        };
    });
}

// ── verifyPorts (async) ───────────────────────────────────────────────

async function verifyPorts(ports = []) {
    const results = [];
    for (const port of ports) {
        const free = await _portFree(port);
        results.push({
            check:   "port_available",
            target:  port,
            passed:  free,
            message: free ? `Port ${port} is available` : `Port ${port} is in use`,
        });
    }
    return results;
}

// ── verifyPermissions ─────────────────────────────────────────────────

function verifyPermissions(perms = []) {
    return perms.map(perm => {
        const p    = typeof perm === "string" ? perm : perm.path;
        const mode = typeof perm === "object" && perm.mode != null ? perm.mode : fs.constants.R_OK;
        let passed = true;
        let message = `${p} is accessible`;
        try { fs.accessSync(p, mode); } catch (_) {
            passed  = false;
            message = `${p} — permission denied`;
        }
        return { check: "permission_valid", target: p, passed, message };
    });
}

// ── verifySecrets ─────────────────────────────────────────────────────

function verifySecrets(envVars = []) {
    return envVars.map(v => {
        const present = v in process.env && process.env[v] !== "";
        return {
            check:   "secret_present",
            target:  v,
            passed:  present,
            message: present ? `${v} is set` : `${v} is missing or empty`,
        };
    });
}

// ── verify (main, async) ──────────────────────────────────────────────

function _collect(plan, key) {
    const out = [];
    for (const step of (plan.steps ?? [])) {
        for (const item of (step[key] ?? [])) out.push(item);
    }
    return out;
}

async function verify(plan = {}, context = {}) {
    const files   = [...new Set([..._collect(plan, "requiredFiles"),       ...(context.requiredFiles        ?? [])])];
    const deps    = [...new Set([..._collect(plan, "requiredDeps"),         ...(context.requiredDeps         ?? [])])];
    const ports   = [...new Set([..._collect(plan, "requiredPorts"),        ...(context.requiredPorts        ?? [])])];
    const perms   = [..._collect(plan, "requiredPermissions"),              ...(context.requiredPermissions   ?? [])];
    const secrets = [...new Set([..._collect(plan, "requiredEnv"),          ...(context.requiredEnv           ?? [])])];

    const fileChecks   = verifyFiles(files);
    const depChecks    = verifyDependencies(deps);
    const portChecks   = await verifyPorts(ports);
    const permChecks   = verifyPermissions(perms);
    const secretChecks = verifySecrets(secrets);

    const all      = [...fileChecks, ...depChecks, ...portChecks, ...permChecks, ...secretChecks];
    const failures = all.filter(c => !c.passed);

    return {
        passed:   failures.length === 0,
        checks:   all,
        failures,
        summary: {
            total:   all.length,
            passed:  all.length - failures.length,
            failed:  failures.length,
            byType: {
                files:        fileChecks.filter(c => !c.passed).length,
                dependencies: depChecks.filter(c => !c.passed).length,
                ports:        portChecks.filter(c => !c.passed).length,
                permissions:  permChecks.filter(c => !c.passed).length,
                secrets:      secretChecks.filter(c => !c.passed).length,
            },
        },
    };
}

module.exports = { verify, verifyFiles, verifyDependencies, verifyPorts, verifyPermissions, verifySecrets };
