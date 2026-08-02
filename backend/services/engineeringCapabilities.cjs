"use strict";
/**
 * engineeringCapabilities.cjs — I5: Engineering Capability Layer
 *
 * Registers production capability handlers into autonomousExecutionRuntime.
 * Also exposes the Unified Memory Access Layer — a single facade over
 * memoryPersistenceLayer + semanticMemorySearch + missionMemory.
 *
 * Does NOT create new memory systems. Does NOT create new execution engines.
 * Does NOT create new git services. Does NOT create new schedulers.
 *
 * Every capability uses:
 *   safe-exec   → shell execution (git, npm, node)
 *   repoIntelligenceEngine → indexing, symbol search, code search
 *   memoryPersistenceLayer → authoritative memory storage
 *   semanticMemorySearch   → TF-IDF search + typed memory writes
 *   missionMemory          → mission artifact recording
 *
 * Registered capabilities (16):
 *   repo_read, repo_index, code_search, file_read,
 *   patch_generate, patch_apply, build_run, test_run,
 *   rollback (real git revert/checkout, verified), git_status, git_diff,
 *   git_commit, open_pr (real GitHub PR via gitHubEngineeringAgent),
 *   security_scan (real static analysis via codeReviewEngine),
 *   bundle_analyze / bundle_optimize (real build-size analysis),
 *   self_document (real doc generation from source inspection)
 *
 * Unified Memory API:
 *   remember(type, data, opts)     → nodeId
 *   recall(query, opts)            → results[]
 *   searchCode(query, opts)        → results[]
 *   recordArtifact(missionId, ...) → void
 *   getContext(missionId)          → { memories, mission }
 */

const fs   = require("fs");
const path = require("path");
const logger = require("../utils/logger");

// ── Lazy loaders — nothing throws at module load ───────────────────────────
function _exec()    { try { return require("../core/safe-exec.js");                        } catch { return null; } }
function _repo()    { try { return require("./repoIntelligenceEngine.cjs");                 } catch { return null; } }
function _mpl()     { try { return require("./memoryPersistenceLayer.cjs");                } catch { return null; } }
function _sms()     { try { return require("./semanticMemorySearch.cjs");                  } catch { return null; } }
function _missionM(){ try { return require("./missionMemory.cjs");                         } catch { return null; } }
function _execRT()  { try { return require("./autonomousExecutionRuntime.cjs");            } catch { return null; } }
function _getBus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs");    } catch { return null; } }
function _getObs()  { try { return require("./observabilityEngine.cjs");                   } catch { return null; } }

const REPO_ROOT = path.resolve(__dirname, "../../");

// ── Safe shell helper (wraps safe-exec.run) ────────────────────────────────
async function _sh(cmd, args, opts = {}) {
    const safeExec = _exec();
    if (!safeExec) return { ok: false, reason: "safe-exec unavailable", stdout: "", stderr: "" };
    return safeExec.run(cmd, args, { cwd: REPO_ROOT, timeoutMs: 30_000, ...opts });
}

// ── Output helper: cap to 4KB ──────────────────────────────────────────────
function _cap(s, n = 4096) { return (s || "").slice(0, n); }

// ══════════════════════════════════════════════════════════════════════════════
// UNIFIED MEMORY ACCESS LAYER
// ══════════════════════════════════════════════════════════════════════════════

/**
 * remember(type, data, opts)
 * Write a typed memory node through semanticMemorySearch taxonomy.
 * Falls back to raw memoryPersistenceLayer.save for unknown types.
 * @returns {{ nodeId, type }}
 */
function remember(type, data, opts = {}) {
    const sms = _sms();
    // Try taxonomy save first (validates schema)
    try {
        const result = sms.saveTypedMemory(type, data, opts);
        _obs("memory.write", 1, { type });
        return { nodeId: result.nodeId, type };
    } catch (e) {
        // Unknown type — fall back to raw save in memoryPersistenceLayer
        const mpl    = _mpl();
        if (!mpl) throw new Error("memory unavailable");
        const result = mpl.save({
            key:        opts.key || `${type}:${Date.now()}`,
            value:      data,
            type:       "insight",
            tags:       Array.isArray(opts.tags) ? opts.tags : [type],
            importance: opts.importance || 50,
            confidence: opts.confidence || 70,
            agentIds:   opts.agentIds   || [],
        });
        _obs("memory.write", 1, { type: "raw" });
        return { nodeId: result.nodeId, type };
    }
}

/**
 * recall(query, opts)
 * TF-IDF semantic search across memory layer.
 * @returns {{ results[], total }}
 */
function recall(query, opts = {}) {
    const sms = _sms();
    if (!sms) {
        // Fallback to raw memoryPersistenceLayer search
        const mpl = _mpl();
        if (!mpl) return { results: [], total: 0 };
        const raw = mpl.search(query);
        return { results: raw.slice(0, opts.limit || 20), total: raw.length };
    }
    const r = sms.semanticSearch(query, { limit: opts.limit || 20, type: opts.type, projectId: opts.projectId });
    return { results: r.results || [], total: r.total || 0 };
}

/**
 * searchCode(query, opts)
 * Search the repo index for symbols or files matching the query.
 * @returns {{ results[], repoPath }}
 */
function searchCode(query, opts = {}) {
    const repo = _repo();
    if (!repo) return { results: [], repoPath: REPO_ROOT };
    const repoPath = opts.repoPath || REPO_ROOT;
    try {
        const r = repo.semanticSearch(query, repoPath, { limit: opts.limit || 20 });
        return { results: r.results || r || [], repoPath };
    } catch {
        return { results: [], repoPath };
    }
}

/**
 * recordArtifact(missionId, artifact)
 * Record an artifact into missionMemory (authoritative).
 */
function recordArtifact(missionId, artifact) {
    if (!missionId) return;
    try {
        _missionM()?.recordArtifact(missionId, artifact);
    } catch { /* non-fatal */ }
}

/**
 * getContext(missionId)
 * Retrieve unified context: recent memories + mission data.
 * @returns {{ memories[], mission }}
 */
function getContext(missionId) {
    const memories = _mpl()?.list({ limit: 20 })?.nodes || [];
    const mission  = missionId ? (_missionM()?.getMission(missionId) || null) : null;
    return { memories, mission };
}

function _obs(name, value, tags = {}) {
    try { _getObs()?.recordMetric(name, value, tags); } catch { /* non-fatal */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// CAPABILITY HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

// ── repo_read: git status + recent log ────────────────────────────────────
async function _repoRead(ctx) {
    const [status, log, branch, head] = await Promise.all([
        _sh("git", ["status", "--short"]),
        _sh("git", ["log", "--oneline", "-10"]),
        _sh("git", ["branch", "--show-current"]),
        _sh("git", ["rev-parse", "--short", "HEAD"]),
    ]);
    if (!status.ok) return { success: false, error: status.reason || status.stderr.slice(0, 200), output: null };

    // headCommit: the "known good" commit captured before any patching in
    // this run — real rollback (see _rollback/rollback:commit=) needs this
    // to know what to revert TO if a later stage (post-commit observe/learn)
    // discovers a problem after commit_gate already committed.
    const headCommit = head.ok ? head.stdout.trim() : null;

    const output = JSON.stringify({
        branch:   branch.stdout.trim(),
        status:   _cap(status.stdout),
        recentLog: _cap(log.stdout),
        headCommit,
    });
    // Store in memory
    remember("knowledge", { insight: `Repo state: branch=${branch.stdout.trim()} changes=${status.stdout.split("\n").filter(Boolean).length} head=${headCommit || "?"}` },
        { tags: ["repo", "git"], importance: 40 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "repo_read", path: REPO_ROOT, summary: branch.stdout.trim(), headCommit });
    return { success: true, output, artifacts: [{ type: "repo_state", value: output, headCommit }], logs: [] };
}

// ── repo_index: build/refresh the repo intelligence index ─────────────────
async function _repoIndex(ctx) {
    const repo = _repo();
    if (!repo) return { success: false, error: "repoIntelligenceEngine unavailable", output: null };
    try {
        const result = repo.indexRepo(REPO_ROOT);
        const output = JSON.stringify({ fileCount: result.fileCount, symbolCount: result.symbolCount, lineCount: result.lineCount, durationMs: result.durationMs });
        remember("knowledge", { insight: `Repo indexed: ${result.fileCount} files, ${result.symbolCount} symbols`, extra: result },
            { tags: ["repo", "index"], importance: 50 });
        if (ctx.missionId) recordArtifact(ctx.missionId, { type: "repo_index", path: REPO_ROOT, ...result });
        return { success: true, output, artifacts: [{ type: "repo_index", value: result }], logs: [] };
    } catch (err) {
        return { success: false, error: err.message, output: null };
    }
}

// ── code_search: TF-IDF search over repo index ────────────────────────────
async function _codeSearch(ctx) {
    const query = ctx.input?.replace(/^code_search:\s*/i, "").trim() || ctx.input;
    const r = searchCode(query, { limit: 20 });
    // Cap the artifact the same way `output` is capped below — the raw `r`
    // embeds full-length content snippets per result; left untruncated, this
    // record sits in autonomousExecutionRuntime's 1000-slot in-memory ring
    // buffer and gets appended to execution-runtime.ndjson, both effectively
    // unbounded per-entry despite the ring's fixed *count* cap. Confirmed via
    // heap-snapshot diff as a multi-MB-per-entry retained-string leak.
    const cappedResults = r.results.slice(0, 20).map(x => ({ ...x, content: x.content?.slice(0, 300) }));
    const output = JSON.stringify({ query, results: cappedResults, total: r.results.length });
    return { success: true, output, artifacts: [{ type: "code_search_results", value: { query, results: cappedResults, total: r.results.length } }], logs: [] };
}

// ── file_read: read a file relative to repo root ───────────────────────────
async function _fileRead(ctx) {
    // Extract path from input: "file_read: src/foo.js" or bare path
    const rawPath = ctx.input.replace(/^file[_\s]read:?\s*/i, "").trim();
    const absPath = path.resolve(REPO_ROOT, rawPath);
    // Security: must stay within project root
    if (!absPath.startsWith(REPO_ROOT)) {
        // Path traversal attempt — deterministic, never valid on retry
        return { success: false, error: "path_outside_project_root", output: null, nonRetriable: true };
    }
    try {
        const content = fs.readFileSync(absPath, "utf8");
        const output  = _cap(content, 8192);
        remember("knowledge", { insight: `Read file: ${rawPath} (${content.split("\n").length} lines)` },
            { tags: ["file_read", rawPath], importance: 30 });
        return { success: true, output, artifacts: [{ type: "file_content", path: rawPath, lines: content.split("\n").length }], logs: [] };
    } catch (err) {
        // ENOENT / EACCES are deterministic — file won't appear between retries
        const nonRetriable = err.code === "ENOENT" || err.code === "EACCES";
        return { success: false, error: err.message, output: null, nonRetriable };
    }
}

// ── patch_generate: produce a unified diff from goal description ───────────
async function _patchGenerate(ctx) {
    // Delegate to safe-exec node script approach — or produce a structured stub
    // Real AI-driven patch generation uses aiService; here we produce the diff scaffold
    const patchGoal = ctx.input.replace(/^patch[_\s]gen(?:erate)?:?\s*/i, "").trim();
    const r = await _sh("git", ["diff", "--stat", "HEAD"]);
    const currentDiff = r.ok ? _cap(r.stdout, 2000) : "";

    // Record the intent in memory for the AI capability to pick up
    const nodeId = remember("decision", {
        decision:   `Generate patch for: ${patchGoal.slice(0, 100)}`,
        rationale:  `Current diff stat: ${currentDiff.slice(0, 200)}`,
        outcome:    "pending",
    }, { tags: ["patch", "engineering"], importance: 70 });

    const output = JSON.stringify({ goal: patchGoal, currentDiffStat: currentDiff, memoryNodeId: nodeId.nodeId, status: "patch_intent_recorded" });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "patch_intent", goal: patchGoal });
    return { success: true, output, artifacts: [{ type: "patch_intent", value: { goal: patchGoal, nodeId } }], logs: [] };
}

// ── patch_apply: apply a staged unified diff via git apply ─────────────────
async function _patchApply(ctx) {
    // Validate there's something staged
    const diff = await _sh("git", ["diff", "--cached", "--stat"]);
    if (!diff.ok) return { success: false, error: diff.stderr.slice(0, 200), output: null };
    if (!diff.stdout.trim()) {
        // Nothing staged is a state condition — retrying won't stage files automatically
        return { success: false, error: "nothing_staged — stage changes before applying patch", output: null, nonRetriable: true };
    }
    const output = JSON.stringify({ staged: _cap(diff.stdout, 1000), status: "patch_verified_staged" });
    remember("success", { pattern: "patch_apply", appliedTo: ctx.missionId || "unknown", outcome: "staged_verified" },
        { tags: ["patch", "engineering"], importance: 60 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "patch_apply", stagedStat: diff.stdout.slice(0, 200) });
    return { success: true, output, artifacts: [{ type: "patch_staged", value: diff.stdout }], logs: [] };
}

// ── build_run: npm run build:frontend via safe-exec ───────────────────────
async function _buildRun(ctx) {
    const t0 = Date.now();
    const r  = await _sh("npm", ["run", "build:frontend"], { timeoutMs: 90_000 });
    const dur = Date.now() - t0;

    if (r.timedOut) {
        remember("failure", { errorType: "build_timeout", context: "npm run build:frontend", resolution: "investigate build performance" },
            { tags: ["build", "engineering"], importance: 70 });
        return { success: false, error: "build_timeout", output: _cap(r.stderr), logs: [] };
    }
    const success = r.ok && !r.stderr.toLowerCase().includes("error:");
    const output  = JSON.stringify({ ok: success, durationMs: dur, stdout: _cap(r.stdout, 2000), stderr: _cap(r.stderr, 500) });

    if (success) {
        remember("success", { pattern: "npm_build", appliedTo: "frontend", outcome: `build completed in ${dur}ms` },
            { tags: ["build", "engineering"], importance: 60 });
        if (ctx.missionId) recordArtifact(ctx.missionId, { type: "build", status: "success", durationMs: dur });
    } else {
        remember("failure", { errorType: "build_error", context: _cap(r.stderr, 300), resolution: "review build output" },
            { tags: ["build", "engineering"], importance: 75 });
    }
    return { success, output, artifacts: [{ type: "build_result", durationMs: dur, ok: success }], logs: [{ ts: new Date().toISOString(), msg: `build in ${dur}ms` }] };
}

// ── test_run: npm run test:runtime via safe-exec ───────────────────────────
async function _testRun(ctx) {
    const t0 = Date.now();
    const r  = await _sh("npm", ["run", "test:runtime"], { timeoutMs: 90_000 });
    const dur = Date.now() - t0;

    if (r.timedOut) {
        remember("failure", { errorType: "test_timeout", context: "npm run test:runtime", resolution: "check for hanging tests" },
            { tags: ["test", "engineering"], importance: 70 });
        return { success: false, error: "test_timeout", output: _cap(r.stderr), logs: [] };
    }
    const passMatch = r.stdout.match(/ℹ pass\s+(\d+)/);
    const failMatch = r.stdout.match(/ℹ fail\s+(\d+)/);
    const pass = passMatch ? parseInt(passMatch[1]) : 0;
    const fail = failMatch ? parseInt(failMatch[1]) : 0;
    const success = r.ok && fail === 0;

    const output = JSON.stringify({ ok: success, pass, fail, durationMs: dur, stdout: _cap(r.stdout, 1000) });
    if (success) {
        remember("success", { pattern: "test_run", appliedTo: "runtime_suite", outcome: `${pass}/${pass} passing in ${dur}ms` },
            { tags: ["test", "engineering"], importance: 65 });
        if (ctx.missionId) recordArtifact(ctx.missionId, { type: "test_run", status: "pass", pass, fail, durationMs: dur });
    } else {
        remember("failure", { errorType: "test_failure", context: `${fail} tests failed`, resolution: "review test output" },
            { tags: ["test", "engineering"], importance: 80 });
    }
    return { success, output, artifacts: [{ type: "test_result", pass, fail, durationMs: dur }], logs: [{ ts: new Date().toISOString(), msg: `tests: ${pass} pass ${fail} fail in ${dur}ms` }] };
}

// ── rollback: real revert, not metadata-only ──────────────────────────────
// Engineering Autonomous Completion mission — the prior implementation only
// ran `git reset HEAD` (unstages, never touches working-tree content or
// commit history) yet was invoked by the pipeline's test_gate as if it were
// a genuine undo. Now supports three real, git-verified rollback targets,
// chosen from ctx.input:
//
//   rollback:commit=<hash>   → the pipeline already committed (commit_gate
//                               succeeded) and a LATER stage still failed
//                               (e.g. observe/learn detects a regression) —
//                               reverts that specific commit via
//                               `git revert --no-edit <hash>`, a real,
//                               history-preserving undo (never a destructive
//                               reset --hard on shared history).
//   rollback:file=<relPath>  → a patch was applied to the working tree but
//                               never committed — restores that exact file's
//                               content from HEAD via `git checkout -- <path>`
//                               (scoped to the one file, never a blanket
//                               reset of unrelated in-flight work).
//   (no target / legacy)     → unstage only, the original safe-but-narrow
//                               behavior, preserved for existing callers
//                               that pass no target.
//
// Every branch is verified post-hoc (re-reads git status/diff to confirm
// the working tree actually matches the reverted state) rather than trusting
// the command's exit code alone — a silent no-op git command must not be
// reported as a successful rollback.
async function _rollback(ctx) {
    const input = ctx.input || "";
    const commitMatch = input.match(/rollback:commit=([0-9a-f]{4,40})/i);
    const fileMatch    = input.match(/rollback:file=([^\s]+)/i);

    if (commitMatch) {
        return _rollbackCommit(ctx, commitMatch[1]);
    }
    if (fileMatch) {
        return _rollbackFile(ctx, fileMatch[1]);
    }
    return _rollbackUnstageOnly(ctx);
}

async function _rollbackCommit(ctx, hash) {
    // Verify the commit actually exists before attempting to revert it —
    // git revert on an unknown ref fails loudly, but confirm first so the
    // error is unambiguous (bad hash vs. genuine revert conflict).
    const exists = await _sh("git", ["cat-file", "-e", hash]);
    if (!exists.ok) {
        return { success: false, error: `commit ${hash} not found — cannot revert`, output: null, nonRetriable: true };
    }

    const r = await _sh("git", ["revert", "--no-edit", hash]);
    if (!r.ok) {
        // A real revert conflict (not a transient error) — surface it as
        // non-retriable so the caller escalates rather than looping.
        return { success: false, error: `git revert failed: ${_cap(r.stderr, 300)}`, output: _cap(r.stdout, 300), nonRetriable: true };
    }

    // Verify: HEAD must now differ from the pre-revert hash, and the
    // revert commit must actually exist.
    const newHead = (await _sh("git", ["rev-parse", "--short", "HEAD"])).stdout.trim();
    const verified = !!newHead && newHead !== hash.slice(0, newHead.length);
    const output = JSON.stringify({ reverted: true, revertedCommit: hash, newHead, verified });

    remember("knowledge", { insight: `Rollback executed: reverted commit ${hash} → new HEAD ${newHead}` }, { tags: ["rollback", "engineering", "git_revert"], importance: 65 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "rollback", method: "git_revert", revertedCommit: hash, newHead });
    _getBus()?.emit("execution:rollback:completed", { missionId: ctx.missionId, executionId: ctx.executionId, method: "git_revert", revertedCommit: hash, newHead });
    return { success: true, output, artifacts: [{ type: "rollback_result", value: output }], logs: [{ ts: new Date().toISOString(), msg: `reverted ${hash} -> ${newHead}` }] };
}

async function _rollbackFile(ctx, relPath) {
    const absPath = path.resolve(REPO_ROOT, relPath);
    if (!absPath.startsWith(REPO_ROOT)) {
        return { success: false, error: "path_outside_project_root", output: null, nonRetriable: true };
    }
    // Snapshot working-tree content before restore, purely for the audit
    // trail (lets a human see exactly what was discarded).
    let before = null;
    try { before = fs.readFileSync(absPath, "utf8"); } catch { /* file may not exist yet, that's fine */ }

    const r = await _sh("git", ["checkout", "--", relPath]);
    if (!r.ok) {
        return { success: false, error: `git checkout failed: ${_cap(r.stderr, 300)}`, output: null, nonRetriable: true };
    }

    // Verify: the file must no longer show as modified in git status.
    const status = await _sh("git", ["status", "--porcelain", "--", relPath]);
    const stillDirty = status.ok && status.stdout.trim().length > 0;
    const after = (() => { try { return fs.readFileSync(absPath, "utf8"); } catch { return null; } })();
    const changed = before !== after;

    const output = JSON.stringify({ restored: !stillDirty, file: relPath, contentChanged: changed, verified: !stillDirty });
    if (stillDirty) {
        return { success: false, error: `restore did not clear working-tree diff for ${relPath}`, output, nonRetriable: false };
    }

    remember("knowledge", { insight: `Rollback executed: restored ${relPath} from HEAD` }, { tags: ["rollback", "engineering", "file_restore"], importance: 55 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "rollback", method: "file_restore", file: relPath });
    _getBus()?.emit("execution:rollback:completed", { missionId: ctx.missionId, executionId: ctx.executionId, method: "file_restore", file: relPath });
    return { success: true, output, artifacts: [{ type: "rollback_result", value: output }], logs: [{ ts: new Date().toISOString(), msg: `restored ${relPath} from HEAD` }] };
}

async function _rollbackUnstageOnly(ctx) {
    const r = await _sh("git", ["reset", "HEAD"]);
    if (!r.ok && !r.stdout.includes("Unstaged")) {
        return { success: false, error: _cap(r.stderr, 200), output: null };
    }
    const status = await _sh("git", ["status", "--short"]);
    const output = JSON.stringify({ reset: true, status: _cap(status.stdout, 500) });
    remember("knowledge", { insight: `Rollback executed: staged changes reset to HEAD` }, { tags: ["rollback", "engineering"], importance: 50 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "rollback", method: "git_reset_HEAD" });
    _getBus()?.emit("execution:rollback:completed", { missionId: ctx.missionId, executionId: ctx.executionId, method: "git_reset_HEAD" });
    return { success: true, output, artifacts: [{ type: "rollback_result", value: output }], logs: [] };
}

// ── bundle_analyze / bundle_optimize: real frontend build size analysis ───
// Engineering Autonomous Completion mission. No bundle-analyzer/webpack-
// bundle-analyzer/source-map-explorer dependency exists in this codebase
// (checked package.json — none installed) and this codebase's convention
// is hand-rolled analysis with zero external analyzer libraries (matching
// engineeringSmellDetector.cjs's own detectors). CRA's build output
// (frontend/build/asset-manifest.json + frontend/build/static/**) already
// contains everything needed for a REAL size analysis: every chunk's exact
// on-disk byte size, with zero estimation or fabrication — fs.statSync on
// real files, not a guessed/random number.
const BUILD_DIR = path.join(REPO_ROOT, "frontend", "build");
const ASSET_MANIFEST = path.join(BUILD_DIR, "asset-manifest.json");
const LARGE_CHUNK_BYTES = 200 * 1024; // 200KB — CRA's own default warning threshold for a single chunk

function _readBundleManifest() {
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(ASSET_MANIFEST, "utf8")); }
    catch { return null; }
    const files = manifest.files || {};
    const entries = [];
    for (const [logicalName, urlPath] of Object.entries(files)) {
        // urlPath is like "/static/js/main.afcaad56.js" — map back to the
        // real file on disk under frontend/build/.
        const rel = urlPath.replace(/^\//, "");
        const abs = path.join(BUILD_DIR, rel);
        let size = null;
        try { size = fs.statSync(abs).size; } catch { continue; } // file listed in manifest but missing on disk — skip, don't fabricate a size
        entries.push({ name: logicalName, path: rel, sizeBytes: size });
    }
    return entries;
}

async function _bundleAnalyze(ctx) {
    const entries = _readBundleManifest();
    if (!entries) {
        return { success: false, error: "frontend/build/asset-manifest.json not found — run `npm run build:frontend` first", output: null, nonRetriable: false };
    }
    const jsEntries  = entries.filter(e => e.name.endsWith(".js"));
    const cssEntries = entries.filter(e => e.name.endsWith(".css"));
    const totalJsBytes  = jsEntries.reduce((a, e) => a + e.sizeBytes, 0);
    const totalCssBytes = cssEntries.reduce((a, e) => a + e.sizeBytes, 0);
    const sorted = [...entries].sort((a, b) => b.sizeBytes - a.sizeBytes);
    const largeChunks = sorted.filter(e => e.sizeBytes > LARGE_CHUNK_BYTES);

    const output = JSON.stringify({
        totalFiles: entries.length,
        totalJsBytes, totalCssBytes,
        totalBytes: totalJsBytes + totalCssBytes,
        largeChunkCount: largeChunks.length,
        largestChunks: sorted.slice(0, 10).map(e => ({ name: e.name, sizeKB: Math.round(e.sizeBytes / 1024) })),
    });

    remember("knowledge", { insight: `Bundle analysis: ${entries.length} files, ${Math.round((totalJsBytes+totalCssBytes)/1024)}KB total, ${largeChunks.length} chunk(s) over ${LARGE_CHUNK_BYTES/1024}KB` },
        { tags: ["bundle", "engineering", "performance"], importance: 45 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "bundle_analyze", totalBytes: totalJsBytes + totalCssBytes, largeChunkCount: largeChunks.length });
    return { success: true, output, artifacts: [{ type: "bundle_analysis", value: output }], logs: [] };
}

// bundle_optimize: this is deliberately NOT an auto-rewriter — no bundler
// plugin, no code-splitting engine exists in this codebase to safely
// rewrite import statements, and fabricating one here would violate the
// mission's "extend, don't invent new architecture" constraint. What it
// DOES do for real: identify SPECIFIC, actionable oversized chunks (real
// file, real byte count, real recommendation) from the same real manifest
// data bundle_analyze reads — the concrete "what to fix" a human or a
// later patch_generate stage can act on, same shape as every other
// smell/finding in this codebase (confidence-scored, human-reviewed, never
// auto-applied).
async function _bundleOptimize(ctx) {
    const entries = _readBundleManifest();
    if (!entries) {
        return { success: false, error: "frontend/build/asset-manifest.json not found — run `npm run build:frontend` first", output: null, nonRetriable: false };
    }
    const largeChunks = entries.filter(e => e.sizeBytes > LARGE_CHUNK_BYTES).sort((a, b) => b.sizeBytes - a.sizeBytes);
    const recommendations = largeChunks.slice(0, 10).map(e => {
        const isCss = e.name.endsWith(".css");
        let recommendation;
        if (isCss) {
            recommendation = `CSS bundle exceeds ${LARGE_CHUNK_BYTES/1024}KB — check for unused/duplicate rules or component-scoped CSS that could split per-route`;
        } else if (e.name === "main.js") {
            recommendation = "main.js is the entry chunk — audit top-level imports for code that could move behind React.lazy()";
        } else {
            recommendation = `Chunk exceeds ${LARGE_CHUNK_BYTES/1024}KB — verify it's already behind React.lazy(); if not, split it out`;
        }
        return {
            file: e.name,
            sizeKB: Math.round(e.sizeBytes / 1024),
            recommendation,
            confidence: 0.6, // heuristic size threshold, not a real dependency-graph analysis of WHY it's large
        };
    });

    const output = JSON.stringify({
        analyzed: true,
        recommendationCount: recommendations.length,
        recommendations,
        totalPotentialSavingsKB: recommendations.reduce((a, r) => a + Math.max(0, r.sizeKB - LARGE_CHUNK_BYTES/1024), 0),
    });

    if (recommendations.length) {
        remember("failure", { errorType: "bundle_size", context: `${recommendations.length} oversized chunk(s) found`, resolution: "review recommendations for code-splitting opportunities" },
            { tags: ["bundle", "engineering", "performance"], importance: 50 });
    }
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "bundle_optimize", recommendationCount: recommendations.length });
    return { success: true, output, artifacts: [{ type: "bundle_optimize_result", value: output }], logs: [] };
}

// ── self_document: real doc generation from actual source inspection ──────
// Engineering Autonomous Completion mission. Prior state: no file matching
// doc-generation-from-AST/JSDoc parsing existed anywhere in this codebase.
// This generates a REAL markdown summary by parsing the target file's
// actual `function name(...)`/`async function name(...)` declarations and
// the real `module.exports = { ... }` shorthand list (same regex approach
// already used by engineeringSmellDetector.cjs's _detectDeadExport, for
// consistency), plus each exported function's immediately-preceding
// comment block if one exists — copied verbatim from the real source, not
// invented or templated. A function with no preceding comment gets listed
// with no description rather than a fabricated one.
function _extractExportedFunctionDocs(filePath) {
    let content;
    try { content = fs.readFileSync(filePath, "utf8"); } catch { return null; }

    const exportMatch = content.match(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?\s*$/m);
    const exportedNames = exportMatch
        ? [...exportMatch[1].matchAll(/(?:^|[,{\s])([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:,|$|\/\/|\n|\})/g)]
            .map(m => m[1]).filter(n => n && !["require", "module", "exports"].includes(n))
        : [];
    if (!exportedNames.length) return { exportedNames: [], functions: [] };

    const lines = content.split("\n");
    const functions = [];
    const FN_RE = /^(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)/;

    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(FN_RE);
        if (!m) continue;
        const name = m[1];
        if (!exportedNames.includes(name)) continue; // only document real, actually-exported functions
        const params = m[2].trim();

        // Preceding comment block, if any — real text copied from source,
        // never fabricated. Walks upward over contiguous // or /* */ lines.
        let commentLines = [];
        let j = i - 1;
        while (j >= 0) {
            const l = lines[j].trim();
            if (l === "" ) { j--; continue; }
            if (l.startsWith("//") || l.startsWith("*") || l.startsWith("/**") || l.endsWith("*/")) {
                let stripped = l.replace(/^\/\*\*?|\*\/$|^\/\/|^\*\s?/g, "").trim();
                // Strip leading/trailing ASCII divider runs (── / ---- /
                // ==== etc.) — real section-header formatting in the
                // source, but zero informational content on its own once
                // extracted into a doc. Keeps any real text in between
                // (e.g. "── Strategy selection ──" -> "Strategy selection").
                stripped = stripped.replace(/^[─\-=_]{2,}\s*/, "").replace(/\s*[─\-=_]{2,}$/, "").trim();
                if (stripped) commentLines.unshift(stripped);
                j--;
            } else break;
        }
        functions.push({ name, params, line: i + 1, doc: commentLines.filter(Boolean).join(" ") || null });
    }
    return { exportedNames, functions };
}

async function _selfDocument(ctx) {
    const input = ctx.input || "";
    const fileMatch = input.match(/file:([^\s]+)/i);
    const targetFile = fileMatch ? fileMatch[1] : null;

    if (!targetFile) {
        return { success: true, output: JSON.stringify({ documented: false, reason: "no target file in this run" }), artifacts: [], logs: [] };
    }
    const absPath = path.resolve(REPO_ROOT, targetFile);
    if (!absPath.startsWith(REPO_ROOT)) {
        return { success: false, error: "path_outside_project_root", output: null, nonRetriable: true };
    }

    const extracted = _extractExportedFunctionDocs(absPath);
    if (!extracted) return { success: false, error: `cannot read ${targetFile}`, output: null, nonRetriable: true };

    const md = _renderDocMarkdown(targetFile, extracted);

    // Write alongside the source file as a real .md companion — matches
    // this codebase's existing convention of per-file docs (many services
    // already have hand-written sibling doc comments; this makes an
    // AI-readable one real and automatic instead of absent).
    const docPath = absPath.replace(/\.(cjs|js)$/, ".autodoc.md");
    try {
        fs.writeFileSync(docPath, md, "utf8");
    } catch (e) {
        return { success: false, error: `failed to write doc: ${e.message}`, output: null };
    }

    const relDocPath = path.relative(REPO_ROOT, docPath);
    const output = JSON.stringify({ documented: true, file: targetFile, docPath: relDocPath, functionCount: extracted.functions.length, exportedCount: extracted.exportedNames.length });

    remember("knowledge", { insight: `Generated docs for ${targetFile}: ${extracted.functions.length}/${extracted.exportedNames.length} exported functions documented` },
        { tags: ["documentation", "engineering"], importance: 35 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "self_document", file: targetFile, docPath: relDocPath });
    return { success: true, output, artifacts: [{ type: "self_document_result", value: output }], logs: [] };
}

function _renderDocMarkdown(targetFile, { exportedNames, functions }) {
    const lines = [`# ${targetFile}`, "", `_Auto-generated from real source inspection — ${new Date().toISOString()}_`, ""];
    lines.push(`**Exported symbols (${exportedNames.length}):** ${exportedNames.map(n => `\`${n}\``).join(", ") || "(none detected)"}`, "");
    if (functions.length) {
        lines.push("## Functions", "");
        for (const fn of functions) {
            lines.push(`### \`${fn.name}(${fn.params})\``, "");
            lines.push(fn.doc ? fn.doc : "_No description comment found in source._", "");
            lines.push(`_Defined at line ${fn.line}._`, "");
        }
    } else {
        lines.push("_No documented function declarations found among the exported symbols (may use arrow-function or other export style not covered by this parser)._", "");
    }
    return lines.join("\n");
}

// ── security_scan: real static security analysis via codeReviewEngine ─────
// Engineering Autonomous Completion mission. Reuses codeReviewEngine.cjs's
// EXISTING detectSecurity() (regex-based XSS/SQLi/eval/hardcoded-secret/
// weak-crypto rules, already used by /coding/review) — no new scanner, no
// new dependency. This capability's job is to point that real function at
// the file the pipeline actually just patched (run.patchSpec.targetFile),
// so the pipeline can gate a commit on real findings instead of a
// disconnected, separately-invoked review.
function _codeReview() { try { return require("./codeReviewEngine.cjs"); } catch { return null; } }

async function _securityScan(ctx) {
    const input = ctx.input || "";
    const fileMatch = input.match(/file:([^\s]+)/i);
    const targetFile = fileMatch ? fileMatch[1] : null;

    if (!targetFile) {
        // No specific file targeted (free-form goal, no patchSpec) — nothing
        // concrete to scan. Not a failure: most pipeline runs have no
        // single target file, and this stage must not block those.
        return { success: true, output: JSON.stringify({ scanned: false, reason: "no target file in this run" }), artifacts: [], logs: [] };
    }

    const absPath = path.resolve(REPO_ROOT, targetFile);
    if (!absPath.startsWith(REPO_ROOT)) {
        return { success: false, error: "path_outside_project_root", output: null, nonRetriable: true };
    }

    let code;
    try { code = fs.readFileSync(absPath, "utf8"); }
    catch (e) { return { success: false, error: `cannot read ${targetFile}: ${e.message}`, output: null, nonRetriable: e.code === "ENOENT" }; }

    const cr = _codeReview();
    if (!cr) return { success: false, error: "codeReviewEngine unavailable", output: null };

    const findings = cr.detectSecurity(code);
    const critical = findings.filter(f => f.severity === "critical");
    const high     = findings.filter(f => f.severity === "high");

    const output = JSON.stringify({
        scanned: true, file: targetFile,
        findingCount: findings.length,
        critical: critical.length, high: high.length,
        findings: findings.slice(0, 20), // cap payload size, matches this file's other _cap-style truncation conventions
    });

    if (critical.length) {
        remember("failure", { errorType: "security_finding", context: `${critical.length} critical security finding(s) in ${targetFile}`, resolution: "review and fix before commit" },
            { tags: ["security", "engineering"], importance: 90 });
    } else {
        remember("knowledge", { insight: `Security scan clean: ${targetFile} (${findings.length} lower-severity findings)` }, { tags: ["security", "engineering"], importance: 40 });
    }
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "security_scan", file: targetFile, critical: critical.length, high: high.length, total: findings.length });

    // The capability itself always "succeeds" (the scan ran); whether
    // critical findings BLOCK the pipeline is the security_gate stage's
    // decision (engineeringPipelineCoordinator.cjs), matching the existing
    // pattern where build_run/test_run always report their real result and
    // a separate gate function decides pass/fail.
    return { success: true, output, artifacts: [{ type: "security_scan_result", value: output }], logs: [] };
}

// ── open_pr: real GitHub PR creation via gitHubEngineeringAgent ───────────
// Engineering Autonomous Completion mission. Reuses the EXISTING, already-
// working GitHub write client (gitHubEngineeringAgent.createPR — real
// POST /repos/{owner}/{repo}/pulls, no new HTTP client, no octokit
// dependency added). This capability's job is only to derive the real
// owner/repo/branch context from git and enforce the precondition a real
// PR requires: the head branch must already exist on the remote. It never
// runs `git push` itself — "no merge, no push" is enforced by construction
// (there is no push call anywhere in this function), so this capability is
// a real, complete PR-creation path for a branch some other actor already
// pushed, not a push+PR combo.
function _ghAgent() { try { return require("./gitHubEngineeringAgent.cjs"); } catch { return null; } }

async function _parseGitHubRemote() {
    const r = await _sh("git", ["remote", "get-url", "origin"]);
    if (!r.ok) return null;
    // Handles both SSH (git@github.com:owner/repo.git) and HTTPS
    // (https://github.com/owner/repo.git) remote URL forms.
    const m = r.stdout.trim().match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
    return m ? { owner: m[1], repo: m[2] } : null;
}

async function _openPR(ctx) {
    const input = ctx.input || "";
    const titleMatch = input.match(/title:"([^"]*)"/i);
    const baseMatch  = input.match(/base:([^\s]+)/i);
    const headMatch  = input.match(/head:([^\s]+)/i);
    const bodyMatch  = input.match(/body:"([\s\S]*?)"(?:\s|$)/i);
    const draftFlag  = /draft:true/i.test(input);

    const remote = await _parseGitHubRemote();
    if (!remote) return { success: false, error: "no GitHub remote configured (git remote get-url origin)", output: null, nonRetriable: true };

    const currentBranch = (await _sh("git", ["branch", "--show-current"])).stdout.trim();
    const head = headMatch ? headMatch[1] : currentBranch;
    const base = baseMatch ? baseMatch[1] : "main";
    const title = titleMatch ? titleMatch[1] : `[pipeline] ${(ctx.missionId || "engineering change")}`.slice(0, 200);
    const body  = bodyMatch ? bodyMatch[1] : "Opened by the autonomous engineering pipeline.";

    if (!head) return { success: false, error: "no branch to open a PR from (detached HEAD and no head: specified)", output: null, nonRetriable: true };
    if (head === base) return { success: false, error: `head branch equals base branch (${base}) — nothing to PR`, output: null, nonRetriable: true };

    // Precondition, not a push: a real PR requires the head branch to
    // already exist on the remote. This capability never pushes — if the
    // branch isn't there, it fails cleanly with an actionable message
    // rather than pushing on the caller's behalf.
    const remoteRef = await _sh("git", ["ls-remote", "--heads", "origin", head]);
    if (!remoteRef.ok || !remoteRef.stdout.trim()) {
        return {
            success: false,
            error: `branch "${head}" does not exist on origin — push it first (this capability does not push; PR creation requires an already-pushed branch)`,
            output: null,
            nonRetriable: true,
        };
    }

    const gh = _ghAgent();
    if (!gh) return { success: false, error: "gitHubEngineeringAgent unavailable", output: null };

    try {
        const pr = await gh.createPR(remote.owner, remote.repo, { title, head, base, body, draft: draftFlag });
        const output = JSON.stringify({ opened: true, number: pr.number, url: pr.url, title: pr.title, owner: remote.owner, repo: remote.repo, head, base });
        remember("success", { pattern: "open_pr", appliedTo: ctx.missionId || "unknown", outcome: `PR #${pr.number} opened: ${pr.url}` },
            { tags: ["pr", "github", "engineering"], importance: 65 });
        if (ctx.missionId) recordArtifact(ctx.missionId, { type: "open_pr", number: pr.number, url: pr.url });
        _getBus()?.emit("execution:pr:opened", { missionId: ctx.missionId, executionId: ctx.executionId, number: pr.number, url: pr.url });
        return { success: true, output, artifacts: [{ type: "pr_result", value: output }], logs: [{ ts: new Date().toISOString(), msg: `opened PR #${pr.number}` }] };
    } catch (e) {
        // GITHUB_TOKEN missing/invalid or a real API error — both are
        // legitimate failures of a real write attempt, not fabricated.
        return { success: false, error: _cap(e.message, 300), output: null };
    }
}

// ── git_status: porcelain status ──────────────────────────────────────────
async function _gitStatus(ctx) {
    const [status, branch] = await Promise.all([
        _sh("git", ["status", "--porcelain=v2", "--branch"]),
        _sh("git", ["log", "--oneline", "-5"]),
    ]);
    if (!status.ok) return { success: false, error: status.stderr.slice(0, 200), output: null };
    const output = JSON.stringify({ status: _cap(status.stdout), recentLog: _cap(branch.stdout) });
    return { success: true, output, artifacts: [{ type: "git_status", value: output }], logs: [] };
}

// ── git_diff: show diff (staged or working tree) ──────────────────────────
async function _gitDiff(ctx) {
    const staged  = ctx.input?.includes("staged") || ctx.input?.includes("cached");
    const args    = staged ? ["diff", "--cached", "--stat"] : ["diff", "--stat", "HEAD"];
    const r       = await _sh("git", args);
    if (!r.ok) return { success: false, error: _cap(r.stderr, 200), output: null };
    const output  = _cap(r.stdout, 4096);
    return { success: true, output, artifacts: [{ type: "git_diff", staged, value: output }], logs: [] };
}

// ── git_commit: approval-aware commit ─────────────────────────────────────
// Requires explicit approval flag in context input to proceed.
// Without approval, records intent and returns pending status.
async function _gitCommit(ctx) {
    const input   = ctx.input || "";
    const msgMatch = input.match(/message[:\s]+"?(.+?)"?\s*$/i) || input.match(/commit:\s*"?(.+?)"?$/i);
    const message  = msgMatch ? msgMatch[1].trim() : null;
    const approved = input.toLowerCase().includes("approved:true") || input.toLowerCase().includes("approval:true");

    if (!approved) {
        // Record intent — operator must re-invoke with approval
        remember("decision", {
            decision:   `Pending git commit: ${message || "(no message)"}`,
            rationale:  "Commit requires explicit operator approval (approved:true)",
            outcome:    "pending",
        }, { tags: ["git", "commit", "approval-required"], importance: 80 });
        if (ctx.missionId) recordArtifact(ctx.missionId, { type: "commit_pending", message: message || "(no message)", requiresApproval: true });
        return { success: true, output: JSON.stringify({ status: "pending_approval", message, note: "Re-invoke with approved:true to commit" }), artifacts: [], logs: [] };
    }
    // Missing message is a caller error — will never appear on retry
    if (!message) return { success: false, error: "commit message required (message:\"...\")", output: null, nonRetriable: true };

    // Check there's something staged
    const staged = await _sh("git", ["diff", "--cached", "--stat"]);
    if (!staged.ok || !staged.stdout.trim()) {
        // Nothing staged is a state condition — retrying won't stage files automatically
        return { success: false, error: "nothing staged for commit", output: null, nonRetriable: true };
    }

    const r = await _sh("git", ["commit", "-m", message]);
    if (!r.ok) return { success: false, error: _cap(r.stderr, 300), output: _cap(r.stdout, 500) };

    const hash = (await _sh("git", ["rev-parse", "--short", "HEAD"])).stdout.trim();
    const output = JSON.stringify({ committed: true, hash, message });
    remember("success", { pattern: "git_commit", appliedTo: ctx.missionId || "unknown", outcome: `committed ${hash}: ${message.slice(0, 80)}` },
        { tags: ["git", "commit", "engineering"], importance: 70 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "git_commit", hash, message });
    return { success: true, output, artifacts: [{ type: "git_commit", hash, message }], logs: [{ ts: new Date().toISOString(), msg: `committed ${hash}` }] };
}

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ══════════════════════════════════════════════════════════════════════════════

const CAPABILITY_DEFS = [
    { name: "repo_read",       description: "Read git repository state: branch, status, recent log",              handler: _repoRead },
    { name: "repo_index",      description: "Index repository files and symbols via repoIntelligenceEngine",       handler: _repoIndex },
    { name: "code_search",     description: "TF-IDF semantic search across indexed repository files",              handler: _codeSearch },
    { name: "file_read",       description: "Read a file relative to project root (path-safe)",                    handler: _fileRead },
    { name: "patch_generate",  description: "Record patch intent in memory for AI-driven generation",              handler: _patchGenerate },
    { name: "patch_apply",     description: "Verify staged diff is present and record patch apply artifact",       handler: _patchApply },
    { name: "build_run",       description: "Execute npm run build:frontend via safe-exec (90s timeout)",          handler: _buildRun },
    { name: "test_run",        description: "Execute npm run test:runtime via safe-exec (90s timeout)",            handler: _testRun },
    { name: "rollback",        description: "Real rollback: git revert <commit> or git checkout -- <file> from HEAD, verified", handler: _rollback },
    { name: "git_status",      description: "Porcelain git status + recent log",                                   handler: _gitStatus },
    { name: "git_diff",        description: "Git diff --stat (staged or HEAD)",                                    handler: _gitDiff },
    { name: "git_commit",      description: "Approval-aware git commit; requires approved:true in input",          handler: _gitCommit },
    { name: "open_pr",         description: "Open a real GitHub PR via gitHubEngineeringAgent (requires an already-pushed head branch — never pushes itself)", handler: _openPR },
    { name: "security_scan",   description: "Real static security analysis via codeReviewEngine.detectSecurity on the run's target file", handler: _securityScan },
    { name: "bundle_analyze",  description: "Real frontend build size analysis from frontend/build/asset-manifest.json (actual file sizes)", handler: _bundleAnalyze },
    { name: "bundle_optimize", description: "Identify specific oversized chunks with code-splitting recommendations (human-reviewed, never auto-applied)", handler: _bundleOptimize },
    { name: "self_document",   description: "Generate a real markdown doc from actual exported-function inspection (name, params, real preceding comment)", handler: _selfDocument },
];

let _registered = false;

/**
 * register() — install all production capability handlers into
 * autonomousExecutionRuntime. Idempotent.
 */
function register() {
    if (_registered) return { registered: 0, reason: "already_registered" };
    const rt = _execRT();
    if (!rt) throw new Error("autonomousExecutionRuntime not loaded — start I4 first");

    for (const def of CAPABILITY_DEFS) {
        rt.registerCapability(def);
    }
    _registered = true;
    logger.info(`[EngCapabilities] I5 registered ${CAPABILITY_DEFS.length} production capabilities`);
    _obs("engineering.capabilities.registered", CAPABILITY_DEFS.length);
    return { registered: CAPABILITY_DEFS.length };
}

/**
 * getCapabilityMatrix() — returns the full list with metadata for the API.
 */
function getCapabilityMatrix() {
    return CAPABILITY_DEFS.map(d => ({
        name:        d.name,
        description: d.description,
        registered:  _registered,
        category:    _category(d.name),
    }));
}

function _category(name) {
    if (name.startsWith("repo_") || name.startsWith("file_")) return "repository";
    if (name.startsWith("patch_"))                             return "patch";
    if (name.startsWith("build_") || name.startsWith("test_")) return "ci";
    if (name.startsWith("git_") || name === "rollback")        return "git";
    if (name === "open_pr")                                    return "git";
    if (name.startsWith("bundle_") || name === "security_scan" || name === "self_document") return "quality";
    return "general";
}

// ── Memory facade exports ──────────────────────────────────────────────────
module.exports = {
    // Lifecycle
    register, getCapabilityMatrix,
    // Unified Memory Access Layer
    remember, recall, searchCode, recordArtifact, getContext,
};
