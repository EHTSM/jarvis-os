"use strict";
/**
 * Phase 712 — Engineering Memory Productivity
 *
 * Workflow recall, debugging replay recall, deployment history prioritization,
 * recovery-pattern suggestion, environment-specific productivity flows.
 * Bounded storage. Replay-safe persistence. Duplicate suppression.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH   = path.join(__dirname, "../../data/eng-memory-productivity.json");
const TTL_MS       = 21 * 24 * 60 * 60 * 1000;
const STALE_TTL    = 7  * 24 * 60 * 60 * 1000;
const MAX_ENTRIES  = 300;
const DEDUP_MS     = 5  * 60 * 1000;
const SUPPRESS_AT  = 3;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { entries: [], suppressions: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - TTL_MS;
    db.entries      = (db.entries      || []).filter(e => e.ts > cut).slice(0, MAX_ENTRIES);
    db.suppressions = (db.suppressions || []).filter(s => s.ts > cut);
}
function _fingerprint(type, key) { return `${type}:${key}`.slice(0, 120); }

// ── Record outcome ────────────────────────────────────────────────────────────

function recordProductivityOutcome(type, key, outcome = {}) {
    if (!type || !key) return { ok: false, error: "type and key required" };
    const db  = _load(); _prune(db);

    const fp  = _fingerprint(type, key);
    const now = Date.now();

    // Dedup
    const recent = db.entries.find(e => e.fp === fp && (now - e.ts) < DEDUP_MS);
    if (recent) return { ok: true, duplicate: true, fp };

    // Auto-suppress after SUPPRESS_AT failures
    const failCount = db.entries.filter(e => e.fp === fp && !e.outcome?.success).length;
    if (!outcome.success && failCount >= SUPPRESS_AT) {
        const already = db.suppressions.some(s => s.fp === fp);
        if (!already) { db.suppressions.push({ fp, type, key, suppressedAt: now, ts: now }); _save(db); }
        return { ok: true, suppressed: true, fp };
    }

    db.entries.unshift({ fp, type, key, outcome, ts: now });
    _save(db);
    return { ok: true, fp };
}

// ── Workflow recall ───────────────────────────────────────────────────────────

function recallWorkflows({ env = null, limit = 10 } = {}) {
    const db = _load(); _prune(db);
    const entries = db.entries
        .filter(e => e.type === "workflow" && (!env || e.outcome?.env === env) && e.outcome?.success)
        .slice(0, limit);
    return { ok: true, entries: entries.map(e => ({ key: e.key, env: e.outcome?.env, ts: e.ts })), count: entries.length };
}

// ── Debugging replay recall ───────────────────────────────────────────────────

function recallDebuggingReplays({ env = null, limit = 5 } = {}) {
    const db = _load(); _prune(db);

    // From memory store
    const local = db.entries
        .filter(e => e.type === "debug-replay" && (!env || e.outcome?.env === env) && e.outcome?.success)
        .slice(0, limit);

    // From strategy memory
    const ems = _tryRequire("./engineeringMemoryStrategy.cjs");
    let strategyReplays = [];
    if (ems) {
        try { strategyReplays = (ems.recallStrategyForEnvironment(env || "all") || []).slice(0, 3); } catch {}
    }

    return {
        ok:      true,
        local:   local.map(e => ({ key: e.key, ts: e.ts })),
        strategy: strategyReplays,
        count:   local.length + strategyReplays.length,
    };
}

// ── Deployment history prioritization ────────────────────────────────────────

function prioritizeDeploymentHistory({ limit = 5 } = {}) {
    const db = _load(); _prune(db);
    const deployEntries = db.entries
        .filter(e => e.type === "deployment" && e.outcome?.success)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    let patterns = null;
    if (dse) {
        try { patterns = dse.operationalRiskReport(); } catch {}
    }

    return {
        ok:       true,
        history:  deployEntries.map(e => ({ key: e.key, ts: e.ts, env: e.outcome?.env })),
        patterns: patterns ? { riskLevel: patterns.riskLevel } : null,
        count:    deployEntries.length,
    };
}

// ── Recovery pattern suggestion ───────────────────────────────────────────────

function suggestRecoveryPattern(errorContext = "", { env = null } = {}) {
    const db = _load(); _prune(db);

    // Find successful recovery entries for this error type
    const keyword = errorContext.split(" ")[0]?.toLowerCase() || "";
    const matches = db.entries
        .filter(e => e.type === "recovery" && e.outcome?.success && (e.key.includes(keyword) || keyword === ""))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 3);

    // Also check adaptive recovery
    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    let adaptive = null;
    if (arc) {
        try { adaptive = arc.chooseRecoveryPath(errorContext); } catch {}
    }

    return {
        ok:          true,
        suggestions: matches.map(e => ({ key: e.key, ts: e.ts })),
        adaptive:    adaptive ? { path: adaptive.chosen?.path, confidence: adaptive.chosen?.confidence } : null,
        count:       matches.length,
        detail:      `Recovery suggestions: ${matches.length} from memory, adaptive=${adaptive?.ok ? "available" : "unavailable"}`,
    };
}

// ── Environment-specific productivity flows ───────────────────────────────────

function environmentProductivityFlows(env = "vscode") {
    const db = _load(); _prune(db);

    const flows = db.entries
        .filter(e => e.outcome?.env === env && e.outcome?.success)
        .reduce((map, e) => {
            const k = e.type;
            if (!map.has(k)) map.set(k, 0);
            map.set(k, map.get(k) + 1);
            return map;
        }, new Map());

    const topFlows = [...flows.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([type, count]) => ({ type, count }));

    // Chain catalog for env
    const epc = _tryRequire("./executionProductivityChains.cjs");
    let catalog = [];
    if (epc) { try { catalog = epc.catalogProductivityChains().slice(0, 3); } catch {} }

    return {
        ok:       true,
        env,
        topFlows,
        catalog:  catalog.map(c => ({ type: c.type, description: c.description })),
        detail:   `Env flows for ${env}: ${topFlows.length} patterns, ${catalog.length} chains available`,
    };
}

// ── Cleanup stale ─────────────────────────────────────────────────────────────

function cleanupStaleProductivityMemory({ dryRun = false } = {}) {
    const db    = _load();
    const cut   = Date.now() - STALE_TTL;
    const stale = db.entries.filter(e => e.ts < cut);
    if (!dryRun) { _prune(db); _save(db); }
    return { ok: true, staleCount: stale.length, dryRun, detail: `${stale.length} stale entries${dryRun ? " (dry run)" : " removed"}` };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function memoryProductivityStats() {
    const db = _load(); _prune(db);
    const types = db.entries.reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m; }, {});
    return {
        ok:          true,
        total:       db.entries.length,
        suppressed:  db.suppressions.length,
        byType:      types,
        summary:     `Memory productivity: ${db.entries.length} entries, ${db.suppressions.length} suppressed`,
    };
}

module.exports = { recordProductivityOutcome, recallWorkflows, recallDebuggingReplays, prioritizeDeploymentHistory, suggestRecoveryPattern, environmentProductivityFlows, cleanupStaleProductivityMemory, memoryProductivityStats };
