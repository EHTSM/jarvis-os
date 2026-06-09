"use strict";
/**
 * Phase 727 — Engineering Memory Refinement
 *
 * Recovery-pattern recall, debugging-chain prioritization,
 * deployment-history usefulness, environment-specific workflow recall,
 * replay discoverability. Bounded. Replay-safe. Stale cleanup.
 */

const fs   = require("fs");
const path = require("path");

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const STATE_PATH  = path.join(__dirname, "../../data/eng-memory-refinement.json");
const TTL_MS      = 21 * 24 * 60 * 60 * 1000;
const STALE_TTL   = 7  * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 400;
const DEDUP_MS    = 5  * 60 * 1000;
const SUPPRESS_AT = 3;

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
function _fp(type, key) { return `${type}:${key}`.slice(0, 120); }

function recordRefinedOutcome(type, key, outcome = {}) {
    if (!type || !key) return { ok: false, error: "type and key required" };
    const db  = _load(); _prune(db);
    const fp  = _fp(type, key);
    const now = Date.now();

    const recent = db.entries.find(e => e.fp === fp && (now - e.ts) < DEDUP_MS);
    if (recent) return { ok: true, duplicate: true, fp };

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

// ── Recovery-pattern recall ───────────────────────────────────────────────────

function recallRecoveryPatterns(errorContext = "", { env = null, limit = 5 } = {}) {
    const db = _load(); _prune(db);
    const keyword = errorContext.split(" ")[0]?.toLowerCase() || "";

    const local = db.entries
        .filter(e => e.type === "recovery" && e.outcome?.success && (!env || e.outcome?.env === env) && (!keyword || e.key.toLowerCase().includes(keyword)))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);

    // Also pull from two other memory modules
    const emp = _tryRequire("./engineeringMemoryProductivity.cjs");
    let fromProd = [];
    if (emp) { try { fromProd = emp.suggestRecoveryPattern(errorContext, { env }).suggestions || []; } catch {} }

    const ems = _tryRequire("./engineeringMemoryStrategy.cjs");
    let fromStrategy = [];
    if (ems) { try { fromStrategy = ems.recallStrategyForEnvironment(env || "all")?.slice(0, 3) || []; } catch {} }

    return {
        ok:      true,
        local:   local.map(e => ({ key: e.key, ts: e.ts, env: e.outcome?.env })),
        prod:    fromProd,
        strategy: fromStrategy,
        count:   local.length + fromProd.length,
        detail:  `Recovery recall: ${local.length} local, ${fromProd.length} from productivity, ${fromStrategy.length} from strategy`,
    };
}

// ── Debugging-chain prioritization ───────────────────────────────────────────

function prioritizeDebuggingChains({ env = null, limit = 5 } = {}) {
    const db = _load(); _prune(db);
    const chains = db.entries
        .filter(e => e.type === "debug-chain" && e.outcome?.success && (!env || e.outcome?.env === env))
        .sort((a, b) => {
            const recency = b.ts - a.ts;
            const priority = (b.outcome?.priority || 0) - (a.outcome?.priority || 0);
            return priority !== 0 ? priority : recency;
        })
        .slice(0, limit);

    return { ok: true, chains: chains.map(e => ({ key: e.key, ts: e.ts, env: e.outcome?.env, priority: e.outcome?.priority || 0 })), count: chains.length };
}

// ── Deployment history usefulness ─────────────────────────────────────────────

function usefulDeploymentHistory({ limit = 5 } = {}) {
    const db = _load(); _prune(db);
    const history = db.entries
        .filter(e => e.type === "deployment" && e.outcome?.success)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, limit);

    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    let trustReport = null;
    if (dpm) { try { trustReport = dpm.operationalTrustReport(""); } catch {} }

    return {
        ok:          true,
        history:     history.map(e => ({ key: e.key, ts: e.ts, env: e.outcome?.env, target: e.outcome?.target })),
        count:       history.length,
        trustScore:  trustReport?.trustScore || null,
        trustLevel:  trustReport?.level || "unknown",
        detail:      `Deployment history: ${history.length} entries, trust=${trustReport?.level || "?"}`,
    };
}

// ── Environment-specific workflow recall ─────────────────────────────────────

function recallEnvironmentWorkflows(env = "vscode", { limit = 8 } = {}) {
    const db = _load(); _prune(db);
    const workflows = db.entries
        .filter(e => e.outcome?.env === env && e.outcome?.success)
        .reduce((map, e) => { const k = e.type; map.set(k, (map.get(k) || 0) + 1); return map; }, new Map());

    const ranked = [...workflows.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
        .map(([type, count]) => ({ type, count }));

    // Augment with one-click catalog
    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    let catalog = [];
    if (ocf) { try { catalog = ocf.catalogOneClickFlows().slice(0, 3); } catch {} }

    return { ok: true, env, topWorkflows: ranked, catalog: catalog.map(c => ({ type: c.type, description: c.description })), count: ranked.length };
}

// ── Replay discoverability ────────────────────────────────────────────────────

function refinedReplayDiscoverability({ limit = 10 } = {}) {
    const sources = [];

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) {
        try {
            const list = lhpc.listProductivitySessions({ limit });
            if (list.length) sources.push({ source: "productivity-sessions", count: list.length, entries: list.map(s => ({ id: s.sessionId, goal: s.goal })) });
        } catch {}
    }

    const rif = _tryRequire("./repoIntelligenceFoundation.cjs");
    if (rif) {
        try {
            const graph = rif.repoGraphSummary();
            if (graph.totalFiles > 0) sources.push({ source: "repo-intelligence", count: graph.totalFiles, graphNodes: graph.graphNodes });
        } catch {}
    }

    const total = sources.reduce((s, r) => s + r.count, 0);
    return { ok: true, sources, total, discoverable: total > 0, detail: `Refined replay discoverability: ${total} entries across ${sources.length} source(s)` };
}

// ── Cleanup stale memory ──────────────────────────────────────────────────────

function cleanupStaleMemoryRefinement({ dryRun = false } = {}) {
    const db   = _load();
    const cut  = Date.now() - STALE_TTL;
    const stale = (db.entries || []).filter(e => e.ts < cut).length;
    if (!dryRun) { _prune(db); _save(db); }
    return { ok: true, staleCount: stale, dryRun, detail: `${stale} stale entries${dryRun ? " (dry run)" : " removed"}` };
}

function memoryRefinementStats() {
    const db = _load(); _prune(db);
    const byType = db.entries.reduce((m, e) => { m[e.type] = (m[e.type] || 0) + 1; return m; }, {});
    return { ok: true, total: db.entries.length, suppressed: db.suppressions.length, byType, summary: `Memory refinement: ${db.entries.length} entries, ${db.suppressions.length} suppressed` };
}

module.exports = { recordRefinedOutcome, recallRecoveryPatterns, prioritizeDebuggingChains, usefulDeploymentHistory, recallEnvironmentWorkflows, refinedReplayDiscoverability, cleanupStaleMemoryRefinement, memoryRefinementStats };
