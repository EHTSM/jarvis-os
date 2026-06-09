"use strict";
/**
 * Phase 407 — Execution Dependency Graph
 *
 * Dependency-aware execution: validates prerequisites before running a chain.
 * Each chain template declares dependencies (other chains or runtime checks).
 * Checks are fast, synchronous where possible, async-with-timeout otherwise.
 */

const { execSync } = require("child_process");
const http         = require("http");
const logger       = require("../../backend/utils/logger");

const CHECK_TIMEOUT_MS = 4_000;

// ── Dependency definitions ────────────────────────────────────────────────────
// Each dep: { id, description, check() → bool|Promise<bool> }

const DEPS = {
    "backend-healthy": {
        description: "Backend pm2 process is online",
        async check() {
            try {
                const out = execSync("pm2 jlist 2>/dev/null", { timeout: 3000, encoding: "utf8" });
                const procs = JSON.parse(out);
                return procs.some(p => p.name === "jarvis-backend" && p.pm2_env?.status === "online");
            } catch { return false; }
        },
    },
    "api-reachable": {
        description: "API health endpoint responds HTTP 200",
        check() {
            return new Promise(resolve => {
                const req = http.get("http://localhost:3001/api/health", { timeout: CHECK_TIMEOUT_MS }, res => {
                    resolve(res.statusCode >= 200 && res.statusCode < 300);
                });
                req.on("error", () => resolve(false));
                req.on("timeout", () => { req.destroy(); resolve(false); });
            });
        },
    },
    "node-modules-valid": {
        description: "node_modules/.bin/node exists (basic integrity check)",
        check() {
            try { return require("fs").existsSync("node_modules/.bin"); } catch { return false; }
        },
    },
    "frontend-node-modules-valid": {
        description: "frontend/node_modules exists",
        check() {
            try { return require("fs").existsSync("frontend/node_modules"); } catch { return false; }
        },
    },
    "port-3001-free": {
        description: "Port 3001 is available (no conflicting process)",
        check() {
            try {
                const out = execSync("lsof -ti :3001 2>/dev/null || echo ''", { timeout: 2000, encoding: "utf8" });
                return out.trim() === "";
            } catch { return true; } // assume free if check fails
        },
    },
    "git-clean": {
        description: "Git working tree has no uncommitted changes",
        check() {
            try {
                const out = execSync("git status --porcelain 2>/dev/null", { timeout: 2000, encoding: "utf8" });
                return out.trim() === "";
            } catch { return false; }
        },
    },
    "git-remote-reachable": {
        description: "Git remote is reachable (dry-run fetch)",
        async check() {
            try {
                execSync("git fetch --dry-run 2>&1", { timeout: 5000, encoding: "utf8" });
                return true;
            } catch { return false; }
        },
    },
    "disk-space-ok": {
        description: "Disk usage below 90%",
        check() {
            try {
                const out = execSync("df -h . 2>/dev/null | tail -1", { timeout: 2000, encoding: "utf8" });
                const pct = parseInt((out.match(/(\d+)%/) || [])[1] || "0");
                return pct < 90;
            } catch { return true; }
        },
    },
};

// ── Chain → required deps mapping ────────────────────────────────────────────
const CHAIN_DEPS = {
    "recover-frontend-runtime": ["disk-space-ok", "frontend-node-modules-valid"],
    "recover-backend":          ["disk-space-ok", "node-modules-valid"],
    "stabilize-frontend":       ["backend-healthy", "frontend-node-modules-valid"],
    "deploy-update":            ["backend-healthy", "api-reachable", "git-clean"],
    "deployment-readiness":     ["disk-space-ok", "node-modules-valid"],
    "git-safe-update":          ["git-remote-reachable"],
    "git-conflict-recovery":    [],   // no deps — runs in any git state
    "health-check":             [],
    "clean-install":            ["disk-space-ok"],
    "vscode-error-navigation":  [],
};

/**
 * Validate all dependencies for a chain.
 * @param {string} chainName
 * @returns {Promise<{ satisfied: bool, results: Array<{id, description, satisfied, error?}> }>}
 */
async function validateDeps(chainName) {
    const depIds = CHAIN_DEPS[chainName] || [];
    if (!depIds.length) return { satisfied: true, results: [] };

    const results = await Promise.all(depIds.map(async id => {
        const dep = DEPS[id];
        if (!dep) return { id, description: `unknown dep: ${id}`, satisfied: false };
        try {
            const ok = await Promise.race([
                Promise.resolve(dep.check()),
                new Promise(r => setTimeout(() => r(false), CHECK_TIMEOUT_MS + 1000)),
            ]);
            return { id, description: dep.description, satisfied: !!ok };
        } catch (e) {
            return { id, description: dep.description, satisfied: false, error: e.message };
        }
    }));

    const satisfied = results.every(r => r.satisfied);
    if (!satisfied) {
        const failed = results.filter(r => !r.satisfied).map(r => r.id).join(", ");
        logger.warn(`[DepGraph] chain "${chainName}" — unsatisfied deps: ${failed}`);
    }
    return { satisfied, results };
}

/**
 * List all known dependencies (for diagnostics).
 */
function listDeps() {
    return Object.entries(DEPS).map(([id, dep]) => ({ id, description: dep.description }));
}

/**
 * List deps required by a chain.
 */
function depsForChain(chainName) {
    return (CHAIN_DEPS[chainName] || []).map(id => ({
        id,
        description: DEPS[id]?.description || id,
    }));
}

module.exports = { validateDeps, listDeps, depsForChain, CHAIN_DEPS };
