"use strict";
/**
 * Phase 723 — Repo Intelligence Foundation
 *
 * Symbol indexing, dependency mapping, repo graph awareness,
 * contextual file targeting, replay-linked repo continuity.
 * Bounded indexing. Stale-index cleanup. Lightweight graph persistence.
 */

const fs   = require("fs");
const path = require("path");

const STATE_PATH  = path.join(__dirname, "../../data/repo-intelligence.json");
const TTL_MS      = 48 * 60 * 60 * 1000;
const STALE_MS    = 24 * 60 * 60 * 1000;
const MAX_SYMBOLS = 500;
const MAX_FILES   = 200;
const MAX_DEPS    = 300;

function _load() {
    try { return JSON.parse(fs.readFileSync(STATE_PATH, "utf8")); }
    catch { return { symbols: [], files: [], deps: [], graph: {}, replays: [] }; }
}
function _save(db) {
    try { fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true }); fs.writeFileSync(STATE_PATH, JSON.stringify(db, null, 2)); } catch {}
}
function _prune(db) {
    const cut = Date.now() - TTL_MS;
    db.symbols = (db.symbols || []).filter(s => s.ts > cut).slice(0, MAX_SYMBOLS);
    db.files   = (db.files   || []).filter(f => f.ts > cut).slice(0, MAX_FILES);
    db.deps    = (db.deps    || []).filter(d => d.ts > cut).slice(0, MAX_DEPS);
    db.replays = (db.replays || []).filter(r => r.ts > cut).slice(0, 50);
}

// ── Symbol indexing ───────────────────────────────────────────────────────────

function indexSymbol(name, { filePath = "", kind = "function", language = "js", lineNumber = null } = {}) {
    if (!name) return { ok: false, error: "name required" };
    const db  = _load(); _prune(db);
    const idx = db.symbols.findIndex(s => s.name === name && s.filePath === filePath);
    const record = { name, filePath, kind, language, lineNumber, ts: Date.now() };
    if (idx >= 0) { db.symbols[idx] = record; } else { db.symbols.unshift(record); }
    _save(db);
    return { ok: true, name, filePath, kind };
}

function lookupSymbol(name) {
    const db = _load();
    const matches = db.symbols.filter(s => s.name === name || s.name.includes(name));
    return { ok: true, matches, count: matches.length };
}

function searchSymbols({ kind = null, language = null, filePath = null, limit = 20 } = {}) {
    const db = _load(); _prune(db);
    const results = db.symbols
        .filter(s => (!kind || s.kind === kind) && (!language || s.language === language) && (!filePath || s.filePath.includes(filePath)))
        .slice(0, limit);
    return { ok: true, results, count: results.length };
}

// ── Dependency mapping ────────────────────────────────────────────────────────

function mapDependency(fromFile, toFile, { kind = "import", weight = 1 } = {}) {
    if (!fromFile || !toFile) return { ok: false, error: "fromFile and toFile required" };
    const db  = _load(); _prune(db);
    const key = `${fromFile}→${toFile}`;
    const idx = db.deps.findIndex(d => d.key === key);
    const record = { key, fromFile, toFile, kind, weight, ts: Date.now() };
    if (idx >= 0) { db.deps[idx] = record; } else { db.deps.unshift(record); }
    _save(db);
    return { ok: true, key };
}

function getDependencies(filePath, { direction = "outbound" } = {}) {
    const db = _load();
    const deps = direction === "outbound"
        ? db.deps.filter(d => d.fromFile === filePath)
        : db.deps.filter(d => d.toFile   === filePath);
    return { ok: true, filePath, direction, deps, count: deps.length };
}

// ── Repo graph awareness ──────────────────────────────────────────────────────

function buildRepoGraph(files = []) {
    const db = _load(); _prune(db);

    // Register files
    files.forEach(f => {
        const idx = db.files.findIndex(x => x.filePath === f.filePath);
        const record = { filePath: f.filePath, language: f.language || "unknown", size: f.size || 0, ts: Date.now() };
        if (idx >= 0) { db.files[idx] = record; } else { db.files.unshift(record); }
    });

    // Build lightweight adjacency from deps
    const graph = {};
    db.deps.forEach(d => {
        if (!graph[d.fromFile]) graph[d.fromFile] = [];
        if (!graph[d.fromFile].includes(d.toFile)) graph[d.fromFile].push(d.toFile);
    });
    db.graph = graph;
    _save(db);

    return { ok: true, fileCount: db.files.length, depCount: db.deps.length, graphNodes: Object.keys(graph).length };
}

function repoGraphSummary() {
    const db = _load();
    const totalFiles   = (db.files   || []).length;
    const totalSymbols = (db.symbols || []).length;
    const totalDeps    = (db.deps    || []).length;
    const graphNodes   = Object.keys(db.graph || {}).length;
    return { ok: true, totalFiles, totalSymbols, totalDeps, graphNodes, detail: `Repo graph: ${totalFiles} files, ${totalSymbols} symbols, ${totalDeps} deps, ${graphNodes} graph nodes` };
}

// ── Contextual file targeting ─────────────────────────────────────────────────

function targetFilesForContext(goal = "", { language = null, maxFiles = 5 } = {}) {
    const db = _load(); _prune(db);
    const keywords = goal.toLowerCase().split(/\s+/).filter(k => k.length > 3);

    const scored = db.files.map(f => {
        let score = 0;
        keywords.forEach(k => { if (f.filePath.toLowerCase().includes(k)) score += 10; });
        if (language && f.language === language) score += 5;
        return { ...f, score };
    }).filter(f => f.score > 0).sort((a, b) => b.score - a.score).slice(0, maxFiles);

    return { ok: true, files: scored, count: scored.length, goal, detail: `${scored.length} contextual file(s) for: "${goal}"` };
}

// ── Replay-linked repo continuity ─────────────────────────────────────────────

function linkRepoToReplay(replayId, { files = [], symbols = [] } = {}) {
    if (!replayId) return { ok: false, error: "replayId required" };
    const db  = _load(); _prune(db);
    const idx = db.replays.findIndex(r => r.replayId === replayId);
    const record = { replayId, files, symbols, ts: Date.now() };
    if (idx >= 0) { db.replays[idx] = record; } else { db.replays.unshift(record); }
    _save(db);
    return { ok: true, replayId, fileCount: files.length, symbolCount: symbols.length };
}

function recallRepoForReplay(replayId) {
    const db     = _load();
    const record = db.replays.find(r => r.replayId === replayId);
    if (!record) return { ok: false, error: "No repo context for this replay" };
    const ageMs = Date.now() - record.ts;
    const stale = ageMs > STALE_MS;
    return { ok: !stale, replayId, files: record.files, symbols: record.symbols, stale, ageMs, warning: stale ? "Repo replay context stale" : null };
}

// ── Stale index cleanup ───────────────────────────────────────────────────────

function cleanupStaleRepoIndex({ dryRun = false } = {}) {
    const db   = _load();
    const cut  = Date.now() - STALE_MS;
    const staleSymbols = (db.symbols || []).filter(s => s.ts < cut).length;
    const staleFiles   = (db.files   || []).filter(f => f.ts < cut).length;
    const staleDeps    = (db.deps    || []).filter(d => d.ts < cut).length;
    if (!dryRun) { _prune(db); _save(db); }
    return { ok: true, staleSymbols, staleFiles, staleDeps, dryRun, detail: `Stale: ${staleSymbols} symbols, ${staleFiles} files, ${staleDeps} deps${dryRun ? " (dry run)" : " removed"}` };
}

module.exports = { indexSymbol, lookupSymbol, searchSymbols, mapDependency, getDependencies, buildRepoGraph, repoGraphSummary, targetFilesForContext, linkRepoToReplay, recallRepoForReplay, cleanupStaleRepoIndex };
