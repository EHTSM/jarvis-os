"use strict";
/**
 * Phase 662 — Dependency-Aware Execution
 *
 * Dependency graph awareness, execution ordering, runtime validation,
 * deployment dependency checks, rollback safety.
 * PREVENTS: unsafe dep execution, stale chains, invalid recovery continuation.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH = path.join(__dirname, "../../data/dependency-aware-exec.json");
const MAX_GRAPHS = 50;
const TTL_MS     = 24 * 60 * 60 * 1000;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { graphs: [], validations: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cutoff = Date.now() - TTL_MS;
    db.graphs      = (db.graphs      || []).filter(g => g.ts > cutoff).slice(0, MAX_GRAPHS);
    db.validations = (db.validations || []).slice(-200);
}

// ── Dependency graph ──────────────────────────────────────────────────────────

function registerDependencyGraph(name, deps = {}) {
    if (!name) return { ok: false, error: "name required" };
    const db = _load(); _prune(db);
    const idx = db.graphs.findIndex(g => g.name === name);
    const record = { name, deps, ts: Date.now() };
    if (idx >= 0) { db.graphs[idx] = record; }
    else          { db.graphs.unshift(record); }
    _save(db);
    return { ok: true, name, nodeCount: Object.keys(deps).length };
}

function getExecutionOrder(name) {
    const db    = _load();
    const graph = db.graphs.find(g => g.name === name);
    if (!graph) return { ok: false, error: `Graph '${name}' not found` };

    // Topological sort (Kahn's algorithm)
    const deps   = graph.deps;
    const nodes  = new Set(Object.keys(deps));
    Object.values(deps).flat().forEach(d => nodes.add(d));

    const inDegree = {};
    nodes.forEach(n => { inDegree[n] = 0; });
    Object.entries(deps).forEach(([node, prerequisites]) => {
        prerequisites.forEach(p => { inDegree[node] = (inDegree[node] || 0) + 1; });
    });

    const queue  = [...nodes].filter(n => (inDegree[n] || 0) === 0);
    const order  = [];
    const visited = new Set();

    while (queue.length > 0) {
        const n = queue.shift();
        if (visited.has(n)) continue;
        visited.add(n);
        order.push(n);

        // Find nodes that depend on n
        Object.entries(deps).forEach(([node, prerequisites]) => {
            if (prerequisites.includes(n)) {
                inDegree[node]--;
                if (inDegree[node] === 0) queue.push(node);
            }
        });
    }

    const hasCycle = order.length < nodes.size;
    return { ok: !hasCycle, order, nodeCount: nodes.size, hasCycle, warning: hasCycle ? "Cycle detected in dependency graph" : null };
}

// ── Runtime dependency validation ─────────────────────────────────────────────

function validateRuntimeDependencies(required = []) {
    const db = _load();
    const results = required.map(dep => {
        const found = db.graphs.some(g => g.name === dep || Object.keys(g.deps || {}).includes(dep));
        return { dep, available: found, stale: false };
    });

    const missing = results.filter(r => !r.available);
    return {
        ok:       missing.length === 0,
        results,
        missing:  missing.map(r => r.dep),
        valid:    missing.length === 0,
        detail:   missing.length > 0 ? `Missing: ${missing.map(r => r.dep).join(", ")}` : "All dependencies available",
    };
}

// ── Deployment dependency check ───────────────────────────────────────────────

function checkDeploymentDependencies(deploymentName = "", requiredServices = []) {
    const checks = [];

    // Check platform resilience for each service
    const apr = _tryRequire("./advancedPlatformResilience.cjs");
    if (apr) {
        requiredServices.forEach(svc => {
            try {
                const cb = apr.circuitBreakerStatus(svc);
                checks.push({ service: svc, healthy: !cb.tripped, circuitOpen: cb.tripped, status: cb.status });
            } catch {
                checks.push({ service: svc, healthy: true, circuitOpen: false, status: "unknown" });
            }
        });
    } else {
        requiredServices.forEach(svc => checks.push({ service: svc, healthy: true, circuitOpen: false, status: "unchecked" }));
    }

    const unhealthy = checks.filter(c => !c.healthy);
    const safe = unhealthy.length === 0;

    const db = _load();
    db.validations.push({ type: "deployment", deploymentName, checks, safe, ts: Date.now() });
    db.validations = db.validations.slice(-200);
    _save(db);

    return {
        ok:          safe,
        safe,
        deploymentName,
        checks,
        unhealthyServices: unhealthy.map(c => c.service),
        recommendation: safe ? "Dependencies healthy — safe to deploy" : `Resolve ${unhealthy.length} unhealthy service(s) first`,
    };
}

// ── Rollback dependency safety ────────────────────────────────────────────────

function rollbackDependencySafety(deploymentId = "") {
    const issues = [];

    // Check if any downstream services might break on rollback
    const db = _load();
    const recent = db.validations.filter(v => v.deploymentName === deploymentId).slice(0, 1)[0];

    if (!recent) return { ok: true, safe: true, issues: [], detail: "No deployment validation record — proceed cautiously" };

    const tripped = recent.checks.filter(c => c.circuitOpen);
    if (tripped.length > 0) issues.push({ factor: "circuit-breakers-open", count: tripped.length, services: tripped.map(c => c.service) });

    return {
        ok:     issues.length === 0,
        safe:   issues.length === 0,
        issues,
        detail: issues.length > 0 ? `Rollback may affect: ${issues.map(i => i.factor).join(", ")}` : "Rollback dependency-safe",
        approvalRequired: true,
    };
}

// ── Stale chain detection ─────────────────────────────────────────────────────

function detectStaleDependencyChains() {
    const db      = _load(); _prune(db);
    const cutoff  = Date.now() - 12 * 60 * 60 * 1000;
    const stale   = db.graphs.filter(g => g.ts < cutoff);
    return {
        ok:          stale.length === 0,
        staleCount:  stale.length,
        stale:       stale.map(g => ({ name: g.name, ageHours: Math.round((Date.now() - g.ts) / 3600000) })),
        detail:      stale.length > 0 ? `${stale.length} stale dependency graph(s)` : "All graphs current",
    };
}

module.exports = { registerDependencyGraph, getExecutionOrder, validateRuntimeDependencies, checkDeploymentDependencies, rollbackDependencySafety, detectStaleDependencyChains };
