"use strict";
/**
 * Phase 445 — Operational Search + Command Memory
 *
 * Search across: execution history, failures, recoveries, workflows,
 * validation results. Command recall, workflow reuse, pattern lookup.
 *
 * All reads — no state mutation.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

/**
 * Search execution history.
 * @param {string} query
 * @param {number} limit
 * @returns {Array}
 */
function searchHistory(query, limit = 20) {
    const history = _tryRequire("./executionHistory.cjs");
    if (!history) return [];
    const lower = (query || "").toLowerCase();
    const all   = history.recent(200);
    return all
        .filter(e => !lower || JSON.stringify(e).toLowerCase().includes(lower))
        .slice(0, limit);
}

/**
 * Search forensics log for failures/recoveries.
 * @param {string} query
 * @param {string} [type]   — filter by forensic type
 * @param {number} limit
 */
function searchFailures(query, type = null, limit = 20) {
    const forensics = _tryRequire("./runtimeForensics.cjs");
    if (!forensics) return [];
    const lower = (query || "").toLowerCase();
    return forensics.query({ type, limit: 200 })
        .filter(e => !lower || JSON.stringify(e).toLowerCase().includes(lower))
        .slice(0, limit);
}

/**
 * Search engineering sessions.
 * @param {string} query
 * @param {number} limit
 */
function searchSessions(query, limit = 10) {
    const sm = _tryRequire("./engineeringSession.cjs");
    if (!sm) return [];
    const lower = (query || "").toLowerCase();
    return sm.list({ limit: 20 })
        .filter(s => !lower || s.goal.toLowerCase().includes(lower))
        .slice(0, limit);
}

/**
 * Search knowledge memory for fixes, chains, patterns.
 * @param {string} query
 * @param {string} [kind]
 * @param {number} limit
 */
function searchKnowledge(query, kind = null, limit = 20) {
    const km = _tryRequire("./engineeringKnowledgeMemory.cjs");
    if (!km) return [];
    return km.query({ kind, search: query, limit });
}

/**
 * Search recovery memory for validated paths and repair sequences.
 * @param {string} query
 * @param {number} limit
 */
function searchRecoveries(query, limit = 20) {
    const rm = _tryRequire("./executionRecoveryMemory.cjs");
    if (!rm) return [];
    const lower = (query || "").toLowerCase();
    return rm.query({ limit: 200 })
        .filter(e => !lower || JSON.stringify(e).toLowerCase().includes(lower))
        .slice(0, limit);
}

/**
 * Unified search across all operational data stores.
 * @param {string} query
 * @param {number} limit  — per-source limit
 * @returns {{ history, failures, sessions, knowledge, recoveries }}
 */
function searchAll(query, limit = 10) {
    return {
        history:    searchHistory(query, limit),
        failures:   searchFailures(query, null, limit),
        sessions:   searchSessions(query, limit),
        knowledge:  searchKnowledge(query, null, limit),
        recoveries: searchRecoveries(query, limit),
    };
}

/**
 * Recall commands matching a pattern (from history).
 * @param {string} pattern
 * @param {number} limit
 * @returns {string[]}
 */
function recallCommands(pattern, limit = 10) {
    const history = _tryRequire("./executionHistory.cjs");
    if (!history) return [];
    const lower = (pattern || "").toLowerCase();
    return history.recent(200)
        .map(e => e.input || e.cmd || "")
        .filter(cmd => cmd && (!lower || cmd.toLowerCase().includes(lower)))
        .filter((cmd, i, arr) => arr.indexOf(cmd) === i) // dedupe
        .slice(0, limit);
}

/**
 * Suggest workflows that match a goal description.
 * Draws from: productivity chains, debugging flows, deployment flows, chain planner.
 * @param {string} goalText
 * @returns {Array<{ name, source, goal }>}
 */
function suggestWorkflows(goalText) {
    const lower   = (goalText || "").toLowerCase();
    const results = [];

    const prod = _tryRequire("./productivityChains.cjs");
    if (prod) {
        const c = prod.suggest(goalText);
        if (c) results.push({ name: c.name, source: "productivity", goal: c.goal });
    }

    const debug = _tryRequire("./debuggingFlows.cjs");
    if (debug) {
        const d = debug.planDebug(goalText);
        if (d?.flow) results.push({ name: d.flowName, source: "debugging", goal: d.flow.goal });
    }

    const deploy = _tryRequire("./deploymentRecoveryFlows.cjs");
    if (deploy) {
        const r = deploy.planRecovery(goalText);
        if (r?.flow) results.push({ name: r.flowName, source: "deployment", goal: r.flow.goal });
    }

    const planner = _tryRequire("./executionChainPlanner.cjs");
    if (planner) {
        const chain = planner.planChain(goalText);
        if (chain) results.push({ name: chain.name, source: "chain-planner", goal: chain.goal });
    }

    // Dedupe by name
    const seen = new Set();
    return results.filter(r => { if (seen.has(r.name)) return false; seen.add(r.name); return true; });
}

// ── Phase 484 extensions ──────────────────────────────────────────────────────

/**
 * Search workflow library (built-ins + custom).
 * @param {string} query
 * @param {{ category?: string, tag?: string, limit?: number }} opts
 */
function searchWorkflows(query, { category, tag, limit = 10 } = {}) {
    const lib = _tryRequire("./workflowLibrary.cjs");
    if (!lib) return suggestWorkflows(query).slice(0, limit);
    return lib.searchWorkflows(query, { limit }).filter(w =>
        (!category || w.category === category) &&
        (!tag      || w.tags.includes(tag))
    );
}

/**
 * Look up execution replays by goal or session ID.
 * @param {string} query
 * @param {number} limit
 */
function searchReplays(query, limit = 10) {
    const replay = _tryRequire("./executionReplayEngine.cjs");
    if (!replay) return [];
    const lower = (query || "").toLowerCase();
    const all   = replay.list ? replay.list({ limit: 100 }) : [];
    return all
        .filter(r => !lower || (r.goal || "").toLowerCase().includes(lower) || (r.sessionId || "").includes(lower))
        .slice(0, limit)
        .map(r => ({
            id:        r.id,
            sessionId: r.sessionId,
            goal:      r.goal,
            state:     r.state,
            stepCount: Array.isArray(r.steps) ? r.steps.length : 0,
            createdAt: r.createdAt,
        }));
}

/**
 * Search deployment pipeline runs.
 * @param {string} query   — matches pipeline name or run state
 * @param {{ state?: string, pipeline?: string, limit?: number }} opts
 */
function searchDeployments(query, { state, pipeline, limit = 10 } = {}) {
    const dp = _tryRequire("./deploymentPipeline.cjs");
    if (!dp) return [];
    const lower = (query || "").toLowerCase();
    return dp.listRuns({ pipeline, state, limit: 100 })
        .filter(r => !lower || r.pipeline.includes(lower) || r.state.includes(lower))
        .slice(0, limit)
        .map(r => ({
            id:               r.id,
            pipeline:         r.pipeline,
            state:            r.state,
            approved:         r.approved,
            rollbackTriggered: r.rollbackTriggered,
            createdAt:        r.createdAt,
        }));
}

/**
 * Look up known failure patterns from failure intelligence.
 * @param {string} query
 * @param {number} limit
 */
function searchFailurePatterns(query, limit = 10) {
    const fi = _tryRequire("./failureIntelligence.cjs");
    if (fi && fi.query) {
        return fi.query({ search: query, limit });
    }
    // Fallback: search forensics log for failures
    return searchFailures(query, "failure", limit);
}

/**
 * Comprehensive search across ALL operational data sources.
 * Phase 484 unified search — more complete than original searchAll.
 */
function searchEverything(query, { limit = 5 } = {}) {
    return {
        workflows:       searchWorkflows(query,        { limit }),
        replays:         searchReplays(query,           limit),
        deployments:     searchDeployments(query,      { limit }),
        sessions:        searchSessions(query,          limit),
        failures:        searchFailures(query, null,    limit),
        failurePatterns: searchFailurePatterns(query,   limit),
        recoveries:      searchRecoveries(query,        limit),
        knowledge:       searchKnowledge(query, null,   limit),
        history:         searchHistory(query,           limit),
        query,
        ts:              new Date().toISOString(),
    };
}

module.exports = {
    searchAll, searchHistory, searchFailures, searchSessions,
    searchKnowledge, searchRecoveries, recallCommands, suggestWorkflows,
    // Phase 484
    searchWorkflows, searchReplays, searchDeployments,
    searchFailurePatterns, searchEverything,
};
