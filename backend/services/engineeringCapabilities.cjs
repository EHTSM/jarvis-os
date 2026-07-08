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
 * Registered capabilities (12 + override of rollback):
 *   repo_read, repo_index, code_search, file_read,
 *   patch_generate, patch_apply, build_run, test_run,
 *   rollback (override), git_status, git_diff, git_commit
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
    const [status, log, branch] = await Promise.all([
        _sh("git", ["status", "--short"]),
        _sh("git", ["log", "--oneline", "-10"]),
        _sh("git", ["branch", "--show-current"]),
    ]);
    if (!status.ok) return { success: false, error: status.reason || status.stderr.slice(0, 200), output: null };

    const output = JSON.stringify({
        branch:   branch.stdout.trim(),
        status:   _cap(status.stdout),
        recentLog: _cap(log.stdout),
    });
    // Store in memory
    remember("knowledge", { insight: `Repo state: branch=${branch.stdout.trim()} changes=${status.stdout.split("\n").filter(Boolean).length}` },
        { tags: ["repo", "git"], importance: 40 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "repo_read", path: REPO_ROOT, summary: branch.stdout.trim() });
    return { success: true, output, artifacts: [{ type: "repo_state", value: output }], logs: [] };
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

// ── rollback: git reset HEAD to undo staged changes (safe, no history loss) ─
async function _rollback(ctx) {
    const r = await _sh("git", ["reset", "HEAD"]);
    if (!r.ok && !r.stdout.includes("Unstaged")) {
        return { success: false, error: _cap(r.stderr, 200), output: null };
    }
    const status = await _sh("git", ["status", "--short"]);
    const output = JSON.stringify({ reset: true, status: _cap(status.stdout, 500) });
    remember("knowledge", { insight: `Rollback executed: staged changes reset to HEAD` }, { tags: ["rollback", "engineering"], importance: 50 });
    if (ctx.missionId) recordArtifact(ctx.missionId, { type: "rollback", method: "git_reset_HEAD" });
    _getBus()?.emit("execution:rollback:completed", { missionId: ctx.missionId, executionId: ctx.executionId });
    return { success: true, output, artifacts: [{ type: "rollback_result", value: output }], logs: [] };
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
    { name: "rollback",        description: "git reset HEAD to undo staged changes — safe rollback",               handler: _rollback },
    { name: "git_status",      description: "Porcelain git status + recent log",                                   handler: _gitStatus },
    { name: "git_diff",        description: "Git diff --stat (staged or HEAD)",                                    handler: _gitDiff },
    { name: "git_commit",      description: "Approval-aware git commit; requires approved:true in input",          handler: _gitCommit },
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
    return "general";
}

// ── Memory facade exports ──────────────────────────────────────────────────
module.exports = {
    // Lifecycle
    register, getCapabilityMatrix,
    // Unified Memory Access Layer
    remember, recall, searchCode, recordArtifact, getContext,
};
