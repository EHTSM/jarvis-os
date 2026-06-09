"use strict";
/**
 * Phase 440 — Engineering Knowledge Memory
 *
 * Persists: known fixes, stable recovery chains, common runtime failures,
 * validated deployment patterns, project-specific operational knowledge.
 *
 * Compressed aggressively — max 150 entries, 60-day TTL.
 * Deduplicated by (type, key) — updating an entry refreshes its timestamp.
 * NO speculative self-learning — only stores operator-confirmed or verified data.
 *
 * File: data/knowledge-memory.json
 */

const fs   = require("fs");
const path = require("path");

const MEM_PATH    = path.join(__dirname, "../../data/knowledge-memory.json");
const MAX_ENTRIES = 150;
const TTL_MS      = 60 * 24 * 60 * 60 * 1000;

const KINDS = ["known-fix", "stable-chain", "runtime-failure", "deployment-pattern", "project-knowledge"];

function _load() {
    try { return JSON.parse(fs.readFileSync(MEM_PATH, "utf8")); }
    catch { return []; }
}

function _save(entries) {
    try {
        const dir = path.dirname(MEM_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(MEM_PATH, JSON.stringify(entries, null, 2));
    } catch {}
}

function _prune(entries) {
    const cutoff = Date.now() - TTL_MS;
    return entries
        .filter(e => e.ts > cutoff)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MAX_ENTRIES);
}

function _upsert(entry) {
    let entries = _load();
    const existIdx = entries.findIndex(e => e.kind === entry.kind && e.key === entry.key);
    if (existIdx >= 0) {
        entries[existIdx] = { ...entries[existIdx], ...entry, ts: Date.now(), updatedAt: Date.now() };
    } else {
        entries.unshift({ ...entry, ts: Date.now() });
    }
    _save(_prune(entries));
}

/**
 * Record a known fix.
 * @param {string} key          — unique problem identifier e.g. "vite-build-oom"
 * @param {string} problem      — what was broken
 * @param {string} fix          — what fixed it
 * @param {string} [chainName]  — chain that resolved it
 */
function recordKnownFix(key, problem, fix, chainName = null) {
    _upsert({ kind: "known-fix", key: key.slice(0, 80), problem: problem.slice(0, 200), fix: fix.slice(0, 300), chainName });
}

/**
 * Record a stable recovery chain (one that reliably resolves an issue class).
 * @param {string} issueClass   — e.g. "frontend-build-failure"
 * @param {string[]} chains     — ordered chain names
 * @param {number} successCount
 */
function recordStableChain(issueClass, chains, successCount = 1) {
    _upsert({ kind: "stable-chain", key: issueClass.slice(0, 80), chains: chains.slice(0, 6), successCount });
}

/**
 * Record a common runtime failure pattern.
 * @param {string} key          — e.g. "backend-oom-crash"
 * @param {string} signature    — what the failure looks like (log snippet or description)
 * @param {string} mitigation   — how to prevent or handle it
 */
function recordRuntimeFailure(key, signature, mitigation) {
    _upsert({ kind: "runtime-failure", key: key.slice(0, 80), signature: signature.slice(0, 300), mitigation: mitigation.slice(0, 300) });
}

/**
 * Record a validated deployment pattern.
 * @param {string} key
 * @param {string} description
 * @param {string[]} steps      — ordered step descriptions
 */
function recordDeploymentPattern(key, description, steps) {
    _upsert({ kind: "deployment-pattern", key: key.slice(0, 80), description: description.slice(0, 200), steps: steps.slice(0, 10) });
}

/**
 * Record project-specific operational knowledge.
 * @param {string} key
 * @param {string} knowledge
 * @param {string} [project]
 */
function recordProjectKnowledge(key, knowledge, project = "jarvis-os") {
    _upsert({ kind: "project-knowledge", key: key.slice(0, 80), knowledge: knowledge.slice(0, 500), project });
}

/**
 * Query the knowledge memory.
 * @param {object} opts
 * @param {string} [opts.kind]
 * @param {string} [opts.search]  — text search across key/problem/description
 * @param {number} [opts.limit]
 */
function query({ kind, search, limit = 30 } = {}) {
    const entries = _prune(_load());
    const lower   = (search || "").toLowerCase();
    return entries
        .filter(e => !kind || e.kind === kind)
        .filter(e => !lower || JSON.stringify(e).toLowerCase().includes(lower))
        .slice(0, Math.min(limit, MAX_ENTRIES));
}

/**
 * Look up a known fix by key.
 * @param {string} key
 * @returns {object|null}
 */
function lookupFix(key) {
    const entries = _prune(_load());
    return entries.find(e => e.kind === "known-fix" && e.key === key) || null;
}

/**
 * Best stable chain for an issue class.
 * @param {string} issueClass
 * @returns {string[]|null}
 */
function bestChainFor(issueClass) {
    const entries = _prune(_load());
    const lower   = issueClass.toLowerCase();
    const match   = entries
        .filter(e => e.kind === "stable-chain" && e.key.toLowerCase().includes(lower))
        .sort((a, b) => (b.successCount || 0) - (a.successCount || 0))[0];
    return match?.chains || null;
}

/** Stats. */
function stats() {
    const entries = _prune(_load());
    const byKind  = {};
    for (const e of entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
    return { total: entries.length, max: MAX_ENTRIES, byKind, ttlDays: 60 };
}

module.exports = {
    recordKnownFix, recordStableChain, recordRuntimeFailure, recordDeploymentPattern, recordProjectKnowledge,
    query, lookupFix, bestChainFor, stats, KINDS,
};
