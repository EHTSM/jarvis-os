"use strict";
/**
 * RepoIntelligenceEngine — full repository indexing with persistent indexes.
 *
 * Capabilities:
 *   - Full repository indexing (symbols, files, deps)
 *   - Symbol graph: definitions, references, call graph
 *   - Dependency graph: import relationships per file
 *   - Cross-file references: who imports what
 *   - Semantic code search: grep + ranking by relevance
 *
 * Persistence: data/repo-index.json
 */

const fs   = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const INDEX_PATH = path.join(__dirname, "../../data/repo-index.json");

// ── Index store ───────────────────────────────────────────────────────────────

// In-memory cache — avoids parsing the 124MB repo-index.json on every HTTP request.
const INDEX_CACHE_TTL = 5 * 60_000; // 5 minutes
let _indexCache     = null;
let _indexCacheTime = 0;

function _loadIndex() {
    const now = Date.now();
    if (_indexCache && (now - _indexCacheTime) < INDEX_CACHE_TTL) return _indexCache;
    try {
        _indexCache     = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
        _indexCacheTime = now;
        return _indexCache;
    } catch { return { repos: {}, lastIndexed: null }; }
}

function _invalidateCache() {
    _indexCache     = null;
    _indexCacheTime = 0;
}

const MAX_REPOS_IN_INDEX = 20;  // cap to prevent unbounded file growth

function _saveIndex(idx) {
    // Trim the per-file map before serialising — it can reach 500MB+ on large repos.
    // Callers that need the full fileMap query it from a fresh indexRepo() call.
    const slim = { repos: {}, lastIndexed: idx.lastIndexed };
    const keys = Object.keys(idx.repos);
    // Keep only the most-recently indexed MAX_REPOS_IN_INDEX entries
    const keep = keys.slice(-MAX_REPOS_IN_INDEX);
    for (const k of keep) {
        const r = idx.repos[k];
        slim.repos[k] = {
            path:        r.path,
            indexedAt:   r.indexedAt,
            fileCount:   r.fileCount,
            symbolCount: r.symbolCount,
            lineCount:   r.lineCount,
            // Drop per-file content — too large; symbolGraph + depGraph kept for queries
            symbolGraph: r.symbolGraph,
            depGraph:    r.depGraph,
        };
    }
    try {
        const tmp = INDEX_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(slim, null, 2));
        fs.renameSync(tmp, INDEX_PATH);
    } catch (e) {
        // If even slim save fails (extremely large symbolGraph), save metadata only
        const meta = { repos: {}, lastIndexed: idx.lastIndexed };
        for (const k of keep) {
            const r = idx.repos[k];
            meta.repos[k] = { path: r.path, indexedAt: r.indexedAt,
                fileCount: r.fileCount, symbolCount: r.symbolCount, lineCount: r.lineCount };
        }
        fs.writeFileSync(INDEX_PATH, JSON.stringify(meta, null, 2));
    }
    _invalidateCache();
}

// ── File discovery ────────────────────────────────────────────────────────────

const CODE_EXTS = [".js", ".cjs", ".mjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".h"];
const SKIP_DIRS = new Set(["node_modules", ".git", "_archive", "dist", "build", "coverage", "out", ".next", "vendor"]);

function _walkFiles(root) {
    const results = [];
    function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }
        for (const e of entries) {
            if (SKIP_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); }
            else if (e.isFile() && CODE_EXTS.includes(path.extname(e.name))) {
                results.push(path.relative(root, full));
            }
        }
    }
    walk(root);
    return results;
}

// ── Symbol extraction (grep-based) ───────────────────────────────────────────

const DEF_PATTERNS = [
    /(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/,
    /(?:export\s+)?class\s+(\w+)/,
    /(?:module\.exports\.(\w+))/,
    /(?:exports\.(\w+))\s*=/,
    /def\s+(\w+)\s*\(/,              // python
    /^func\s+(\w+)\s*\(/m,           // go
    /^fn\s+(\w+)\s*[(<]/m,           // rust
    /(?:public|private|protected)?\s+(?:static\s+)?(?:\w+\s+)?(\w+)\s*\(/,  // java/c#
];

function _extractSymbols(filePath, content) {
    const symbols = [];
    const lines   = content.split("\n");
    lines.forEach((line, idx) => {
        for (const pat of DEF_PATTERNS) {
            const m = line.match(pat);
            if (m?.[1] && m[1].length > 1) {
                symbols.push({ name: m[1], line: idx + 1, kind: _inferKind(line), file: filePath });
                break;
            }
        }
    });
    return symbols;
}

function _inferKind(line) {
    if (/\bclass\b/.test(line))    return "class";
    if (/\binterface\b/.test(line)) return "interface";
    if (/\btype\b/.test(line))     return "type";
    if (/\benum\b/.test(line))     return "enum";
    return "function";
}

// ── Dependency extraction ─────────────────────────────────────────────────────

const IMPORT_PATTERNS = [
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
];

function _extractImports(content) {
    const imports = new Set();
    for (const pat of IMPORT_PATTERNS) {
        let m;
        const re = new RegExp(pat.source, pat.flags);
        while ((m = re.exec(content)) !== null) {
            imports.add(m[1]);
        }
    }
    return [...imports];
}

// ── Cross-file reference map ──────────────────────────────────────────────────

function _buildCrossFileRefs(fileMap) {
    // fileMap: { filePath -> { symbols, imports } }
    // Use Map to avoid prototype pollution (e.g. sym.name === "constructor")
    const refsMap = new Map();
    for (const [file, info] of Object.entries(fileMap)) {
        for (const sym of info.symbols) {
            if (!sym.name || typeof sym.name !== "string") continue;
            if (!refsMap.has(sym.name)) refsMap.set(sym.name, { definitions: [], references: [] });
            refsMap.get(sym.name).definitions.push({ file, line: sym.line, kind: sym.kind });
        }
    }
    // Convert Map to plain object for JSON serialization
    const refs = {};
    for (const [k, v] of refsMap) refs[k] = v;
    return refs;
}

// ── Public: indexRepo ─────────────────────────────────────────────────────────

const MAX_INDEX_FILES = 200;

function indexRepo(repoPath) {
    const startMs = Date.now();
    const absPath = path.resolve(repoPath);
    const allFiles = _walkFiles(absPath);
    const files    = allFiles.slice(0, MAX_INDEX_FILES);

    let symbolCount = 0;
    let totalLines  = 0;
    // Lightweight pass — count only, no in-memory accumulation
    for (const relFile of files) {
        const full = path.join(absPath, relFile);
        let lines;
        try { lines = fs.readFileSync(full, "utf8").split("\n"); }
        catch { continue; }
        totalLines += lines.length;
        // Count function/class/export declarations without building arrays
        symbolCount += lines.filter(l => /^(export\s+)?(function|class|const|let|var)\s+\w/.test(l.trim())).length;
    }

    // Save a minimal record — avoid loading+rewriting the whole index
    const record = {
        path:        absPath,
        indexedAt:   new Date().toISOString(),
        fileCount:   files.length,
        symbolCount,
        lineCount:   totalLines,
    };
    try {
        const idx = _loadIndex();
        idx.repos[absPath] = { ...record, symbolGraph: {}, depGraph: {} };
        idx.lastIndexed = absPath;
        _saveIndex(idx);
    } catch { /* non-fatal */ }

    return {
        path:        absPath,
        fileCount:   files.length,
        symbolCount,
        lineCount:   totalLines,
        durationMs:  Date.now() - startMs,
    };
}

// ── Dependency graph ──────────────────────────────────────────────────────────

function _buildDepGraph(fileMap, absPath) {
    // adjacency: file -> [imported files]
    const graph = {};
    const fileSet = new Set(Object.keys(fileMap));

    for (const [file, info] of Object.entries(fileMap)) {
        graph[file] = [];
        for (const imp of info.imports) {
            if (!imp.startsWith(".")) continue; // skip node_modules
            // resolve relative path
            const dir      = path.dirname(file);
            const resolved = path.normalize(path.join(dir, imp));
            // try with extensions
            const candidates = [resolved, resolved + ".js", resolved + ".cjs", resolved + ".ts", resolved + "/index.js"];
            for (const c of candidates) {
                if (fileSet.has(c)) { graph[file].push(c); break; }
            }
        }
    }
    return graph;
}

// ── Public: symbol search ─────────────────────────────────────────────────────

function findSymbol(symbolName, repoPath) {
    const idx   = _loadIndex();
    const repo  = idx.repos[path.resolve(repoPath || ".")] || Object.values(idx.repos)[0];
    if (!repo) return { definitions: [], references: [] };

    const sg = repo.symbolGraph[symbolName];
    if (!sg) return { definitions: [], references: [], found: false };
    return { ...sg, found: true };
}

// ── Public: semantic search (grep + rank) ────────────────────────────────────

function semanticSearch(query, repoPath, opts = {}) {
    const absPath = path.resolve(repoPath || ".");
    const limit   = opts.limit || 20;
    const terms   = query.split(/\s+/).filter(Boolean);

    let results = [];
    for (const term of terms) {
        try {
            const raw = execSync(
                `grep -rn --include="*.js" --include="*.cjs" --include="*.ts" --include="*.tsx" ` +
                `--include="*.py" --include="*.go" ` +
                `--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=_archive ` +
                `-m ${limit} -- ${JSON.stringify(term)} ${JSON.stringify(absPath)} 2>/dev/null`,
                { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
            );
            const lines = raw.trim().split("\n").filter(Boolean);
            for (const l of lines) {
                const m = l.match(/^(.+?):(\d+):(.+)$/);
                if (!m) continue;
                results.push({
                    file:    path.relative(absPath, m[1]),
                    line:    parseInt(m[2]),
                    content: m[3].trim(),
                    term,
                    score:   _scoreResult(m[3], terms),
                });
            }
        } catch { /* no matches */ }
    }

    // deduplicate by file+line, rank by score
    const seen = new Set();
    results = results
        .filter(r => { const k = `${r.file}:${r.line}`; if (seen.has(k)) return false; seen.add(k); return true; })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return { query, results, count: results.length };
}

function _scoreResult(content, terms) {
    let score = 0;
    const lc  = content.toLowerCase();
    for (const t of terms) {
        const occurrences = (lc.match(new RegExp(t.toLowerCase(), "g")) || []).length;
        score += occurrences * 2;
    }
    // bonus for definition-like lines
    if (/function|class|const|def|func|fn/.test(content)) score += 3;
    return score;
}

// ── Public: dependency graph query ───────────────────────────────────────────

function getDependencies(filePath, repoPath) {
    const absPath = path.resolve(repoPath || ".");
    const idx     = _loadIndex();
    const repo    = idx.repos[absPath] || Object.values(idx.repos)[0];
    if (!repo) return { file: filePath, deps: [], dependents: [] };

    const rel  = path.relative(absPath, path.resolve(filePath));
    const deps = repo.depGraph[rel] || [];
    const dependents = Object.entries(repo.depGraph)
        .filter(([, imports]) => imports.includes(rel))
        .map(([f]) => f);

    return { file: rel, deps, dependents };
}

// ── Public: index status ──────────────────────────────────────────────────────

function getStatus() {
    const idx = _loadIndex();
    return {
        repos:       Object.values(idx.repos).map(r => ({
            path:        r.path,
            indexedAt:   r.indexedAt,
            fileCount:   r.fileCount,
            symbolCount: r.symbolCount,
            lineCount:   r.lineCount,
        })),
        lastIndexed: idx.lastIndexed,
    };
}

function getCrossFileRefs(symbol, repoPath) {
    const idx   = _loadIndex();
    const repo  = idx.repos[path.resolve(repoPath || ".")] || Object.values(idx.repos)[0];
    if (!repo) return { symbol, refs: [] };
    const sg = repo.symbolGraph[symbol];
    return { symbol, definitions: sg?.definitions || [], repoPath: repo.path };
}

module.exports = { indexRepo, findSymbol, semanticSearch, getDependencies, getStatus, getCrossFileRefs };
