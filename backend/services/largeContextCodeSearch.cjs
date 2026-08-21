"use strict";
/**
 * LargeContextCodeSearch
 *
 * Capabilities:
 *   - Million-line repository search (chunked grep + streaming)
 *   - Semantic retrieval (TF-IDF + structural signals)
 *   - Context ranking (BM25-inspired + recency + definition boost)
 *   - Related code discovery (co-occurrence, import graph proximity)
 *
 * No external DB or vector store required — pure grep + in-memory ranking.
 * Operates on pre-indexed data from RepoIntelligenceEngine when available.
 */

const fs   = require("fs");
const path = require("path");
const { execFileSync, spawnSync } = require("child_process");

const INDEX_PATH = path.join(__dirname, "../../data/repo-index.json");

// In-memory cache for the repo index — avoids re-parsing 124MB on every search call.
const _IDX_TTL = 5 * 60_000;
let _idxCache = null, _idxCacheTime = 0;
function _loadIdx() {
    const now = Date.now();
    if (_idxCache && (now - _idxCacheTime) < _IDX_TTL) return _idxCache;
    try { _idxCache = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8")); _idxCacheTime = now; return _idxCache; }
    catch { return { repos: {} }; }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

const SKIP_DIRS = ["node_modules", ".git", "_archive", "dist", "build", "coverage", "out", ".next", "vendor"];
const CODE_EXTS = ["*.js", "*.cjs", "*.mjs", "*.jsx", "*.ts", "*.tsx", "*.py", "*.go", "*.rs", "*.java", "*.c", "*.cpp"];

function _grepArgs(repoPath) {
    const excl = SKIP_DIRS.map(d => `--exclude-dir=${d}`);
    const incl = CODE_EXTS.map(e => `--include=${e}`);
    return { excl, incl, absPath: path.resolve(repoPath || ".") };
}

// Command Injection & Process Execution Deep Security Sweep (2026-08-21):
// this previously built a shell command STRING via execSync, quoting
// `pattern`/`absPath` with JSON.stringify() — which produces a
// double-quoted string, and /bin/sh performs $()/backtick command
// substitution INSIDE double quotes (it only escapes `"` and `\`, not `$`
// or a backtick). Live-reproduced end-to-end via a real HTTP request from
// an ordinary authenticated customer: POST /p25/search with
// repoPath:"$(touch /tmp/PROOF)" executed the substituted command as the
// backend process — full RCE, not merely a bad-argument issue. Fixed by
// switching to execFileSync with a real argument array: grep receives
// each flag/pattern/path as its own argv element with no shell parsing at
// all, so $(), backticks, `;`, `&&`, `|` are all inert data, never syntax.
function _runGrep(pattern, absPath, excl, incl, maxResults = 500) {
    try {
        const args = [
            "-rn",
            ...excl,
            ...incl,
            "-m", String(maxResults),
            "--", pattern, absPath,
        ];
        const raw = execFileSync("grep", args, {
            encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 15000,
            stdio: ["ignore", "pipe", "ignore"], // 2>/dev/null equivalent
        });
        return raw.trim().split("\n").filter(Boolean);
    } catch (e) {
        // grep exits 1 (and execFileSync throws) when there are simply no
        // matches — same as the prior execSync behavior's empty-result path.
        return e.stdout ? String(e.stdout).trim().split("\n").filter(Boolean) : [];
    }
}

function _parseLine(raw, absPath) {
    const m = raw.match(/^(.+?):(\d+):(.+)$/);
    if (!m) return null;
    return {
        file:    path.relative(absPath, m[1]),
        line:    parseInt(m[2]),
        content: m[3].trim(),
    };
}

// ── TF-IDF scorer ─────────────────────────────────────────────────────────────

function _tokenize(text) {
    return text.toLowerCase().match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || [];
}

function _computeTfIdf(docs, queryTerms) {
    const N = docs.length;
    // IDF: how rare is the term across docs
    const df = {};
    for (const doc of docs) {
        const seen = new Set(_tokenize(doc.content));
        for (const t of seen) df[t] = (df[t] || 0) + 1;
    }
    const idf = term => Math.log((N + 1) / ((df[term] || 0) + 1)) + 1;

    return docs.map(doc => {
        const tokens = _tokenize(doc.content);
        const tf     = {};
        for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
        const maxTf  = Math.max(...Object.values(tf), 1);

        let score = 0;
        for (const qt of queryTerms) {
            const tfVal = (tf[qt] || 0) / maxTf;
            score += tfVal * idf(qt);
        }
        return { ...doc, tfidf: Math.round(score * 1000) / 1000 };
    });
}

// ── BM25-inspired ranking ─────────────────────────────────────────────────────

function _bm25Score(doc, queryTerms, avgDocLen, k1 = 1.5, b = 0.75) {
    const tokens = _tokenize(doc.content + " " + doc.file);
    const tf     = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    const docLen = tokens.length;

    let score = 0;
    for (const qt of queryTerms) {
        const tfVal = tf[qt] || 0;
        const bm25  = tfVal * (k1 + 1) / (tfVal + k1 * (1 - b + b * docLen / (avgDocLen || 1)));
        score += bm25;
    }
    return score;
}

// ── Structural signals ────────────────────────────────────────────────────────

function _structuralBoost(result) {
    let boost = 0;
    const c   = result.content;
    // definition lines score higher
    if (/function\s+\w+|class\s+\w+|const\s+\w+\s*=|def\s+\w+|func\s+\w+|fn\s+\w+/.test(c)) boost += 2;
    // exports score higher
    if (/module\.exports|^export/.test(c)) boost += 1;
    // test files score lower for production search
    if (/\.test\.|\.spec\.|__tests__/.test(result.file)) boost -= 1;
    // short content (comment/blank) scores lower
    if (c.length < 15) boost -= 1;
    return boost;
}

// ── Main search ───────────────────────────────────────────────────────────────

function search(query, repoPath, opts = {}) {
    const {
        limit       = 30,
        semantic    = true,
        fileFilter  = null,   // e.g. "*.ts"
        lineContext  = 0,      // extra lines of context around match
        mode        = "all",   // all | definitions | usages
    } = opts;

    const { excl, incl, absPath } = _grepArgs(repoPath);
    const terms   = query.split(/\s+/).filter(Boolean);
    const rawHits = [];

    // run grep for each term (deduped)
    const seen = new Set();
    for (const term of terms) {
        const lines = _runGrep(term, absPath, excl, incl, Math.ceil((limit * 3) / terms.length));
        for (const l of lines) {
            const parsed = _parseLine(l, absPath);
            if (!parsed) continue;
            if (fileFilter && !parsed.file.includes(fileFilter)) continue;
            const key = `${parsed.file}:${parsed.line}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rawHits.push(parsed);
        }
    }

    if (!rawHits.length) return { query, results: [], count: 0, mode };

    // filter by mode
    let filtered = rawHits;
    if (mode === "definitions") {
        filtered = rawHits.filter(r => /function\s+\w+|class\s+\w+|const\s+\w+\s*=|def\s+\w+|func\s+\w+/.test(r.content));
    } else if (mode === "usages") {
        filtered = rawHits.filter(r => !/function\s+\w+|class\s+\w+|const\s+\w+\s*=/.test(r.content));
    }

    // rank
    const avgLen  = filtered.reduce((s, r) => s + r.content.length, 0) / (filtered.length || 1);
    const ranked  = filtered.map(r => ({
        ...r,
        score: _bm25Score(r, terms, avgLen) + _structuralBoost(r),
    }));

    if (semantic) {
        const withTf = _computeTfIdf(ranked, terms);
        for (let i = 0; i < ranked.length; i++) {
            ranked[i].score += (withTf[i].tfidf || 0) * 0.5;
        }
    }

    ranked.sort((a, b) => b.score - a.score);
    const results = ranked.slice(0, limit).map(r => ({
        file:    r.file,
        line:    r.line,
        content: r.content,
        score:   Math.round(r.score * 100) / 100,
    }));

    return { query, results, count: results.length, totalHits: rawHits.length, mode };
}

// ── Related code discovery ────────────────────────────────────────────────────

function findRelated(filePath, repoPath, opts = {}) {
    const absPath  = path.resolve(repoPath || ".");
    const absFile  = path.resolve(filePath);
    const relFile  = path.relative(absPath, absFile);
    const limit    = opts.limit || 10;

    // load index for import graph proximity
    let importNeighbors = [];
    try {
        const idx  = _loadIdx();
        const repo = idx.repos[absPath] || Object.values(idx.repos)[0];
        if (repo?.depGraph) {
            const directImports  = repo.depGraph[relFile] || [];
            const directImporters = Object.entries(repo.depGraph)
                .filter(([, deps]) => deps.includes(relFile))
                .map(([f]) => f);
            importNeighbors = [...new Set([...directImports, ...directImporters])].slice(0, 5);
        }
    } catch { /* no index */ }

    // co-occurrence: find files that share symbol names with this file
    let content = "";
    try { content = fs.readFileSync(absFile, "utf8"); } catch { /* missing file */ }
    const symbols = (content.match(/(?:function|class|const|export)\s+(\w{3,})/g) || [])
        .map(m => m.split(/\s+/)[1]).slice(0, 5);

    const coOccurring = [];
    if (symbols.length) {
        const { excl, incl } = _grepArgs(repoPath);
        const query = symbols.slice(0, 3).join("|");
        try {
            // Same fix as _runGrep() above — execFileSync with an argument
            // array, no shell parsing, query/absPath cannot break out.
            const lines = execFileSync("grep", ["-rln", ...excl, ...incl, "-E", query, absPath], {
                encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 8000,
                stdio: ["ignore", "pipe", "ignore"],
            }).trim().split("\n").filter(Boolean);
            for (const l of lines) {
                const rel = path.relative(absPath, l);
                if (rel !== relFile) coOccurring.push(rel);
            }
        } catch { /* no matches */ }
    }

    const all = [...new Set([...importNeighbors, ...coOccurring])].slice(0, limit);
    return {
        file:             relFile,
        related:          all,
        importNeighbors,
        coOccurring:      coOccurring.slice(0, 5),
        symbols,
    };
}

// ── Context extraction ────────────────────────────────────────────────────────

function extractContext(filePath, lineNum, windowLines = 5) {
    let content;
    try { content = fs.readFileSync(path.resolve(filePath), "utf8"); } catch { return null; }
    const lines  = content.split("\n");
    const start  = Math.max(0, lineNum - 1 - windowLines);
    const end    = Math.min(lines.length, lineNum + windowLines);
    return {
        file:    filePath,
        line:    lineNum,
        context: lines.slice(start, end).map((l, i) => ({
            lineNum: start + i + 1,
            content: l,
            isMatch: start + i + 1 === lineNum,
        })),
    };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function repoStats(repoPath) {
    const absPath = path.resolve(repoPath || ".");
    try {
        const idx  = _loadIdx();
        const repo = idx.repos[absPath] || Object.values(idx.repos)[0];
        if (repo) return { indexed: true, ...repo, files: undefined }; // omit full file map
    } catch { /* no index */ }

    // fallback: live count. Same execFileSync-with-argument-array fix as
    // _runGrep()/findRelated() above — `find | wc -l` is replaced with a
    // single find call (argument array, no shell) and the line count is
    // taken in JS instead of piping through wc, since execFileSync can't
    // express a shell pipeline without reintroducing shell parsing.
    try {
        const notPathArgs = SKIP_DIRS.flatMap(d => ["-not", "-path", `*/${d}/*`]);
        const out = execFileSync("find", [absPath, ...notPathArgs, "-type", "f"], {
            encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
            stdio: ["ignore", "pipe", "ignore"],
        });
        const totalFiles = out.trim() ? out.trim().split("\n").length : 0;
        return { indexed: false, totalFiles };
    } catch { return { indexed: false }; }
}

module.exports = { search, findRelated, extractContext, repoStats };
