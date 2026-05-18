"use strict";
/**
 * sandbox — isolated execution environment for risky workflow repairs.
 *
 * Creates a temp copy of a project directory, runs a workflow inside it,
 * then either applies changes back (on success) or discards them (on failure).
 *
 * Skips: node_modules, .git, binary files
 * Applies back: source file types only (.js .cjs .mjs .json .ts .env .yaml)
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

const SKIP_DIRS  = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache"]);
const APPLY_EXTS = new Set([".js", ".cjs", ".mjs", ".ts", ".tsx", ".json", ".env", ".yaml", ".yml", ".md"]);
const MAX_FILE_SIZE = 2 * 1024 * 1024; // skip files > 2 MB

// ── Directory operations ──────────────────────────────────────────────

function copyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const srcPath  = path.join(src, e.name);
        const destPath = path.join(dest, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            try {
                const stat = fs.statSync(srcPath);
                if (stat.size <= MAX_FILE_SIZE) fs.copyFileSync(srcPath, destPath);
            } catch { /* skip unreadable files */ }
        }
    }
}

function applyDir(sandboxDir, projectDir) {
    if (!fs.existsSync(sandboxDir)) return 0;
    let applied = 0;
    const entries = fs.readdirSync(sandboxDir, { withFileTypes: true });
    for (const e of entries) {
        if (SKIP_DIRS.has(e.name)) continue;
        const sandboxPath = path.join(sandboxDir, e.name);
        const projectPath = path.join(projectDir, e.name);
        if (e.isDirectory()) {
            if (!fs.existsSync(projectPath)) fs.mkdirSync(projectPath, { recursive: true });
            applied += applyDir(sandboxPath, projectPath);
        } else if (APPLY_EXTS.has(path.extname(e.name).toLowerCase())) {
            fs.copyFileSync(sandboxPath, projectPath);
            applied++;
        }
    }
    return applied;
}

// ── Public API ────────────────────────────────────────────────────────

async function createSandbox(projectPath) {
    const id  = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const dir = path.join(os.tmpdir(), `jarvis-sandbox-${id}`);
    copyDir(projectPath, dir);
    return dir;
}

async function applySandbox(sandboxPath, projectPath) {
    return applyDir(sandboxPath, projectPath);
}

async function cleanupSandbox(sandboxPath) {
    try { fs.rmSync(sandboxPath, { recursive: true, force: true }); } catch { /* ok */ }
}

/**
 * Run a workflow in a sandboxed copy of projectPath.
 *
 * opts:
 *   dryRun      {boolean} — run but never apply changes back
 *   keepSandbox {boolean} — preserve sandbox dir after run (for debugging)
 *   ctx         {object}  — extra workflow context
 *   + any runWorkflow options (maxRetries, id, resume)
 */
async function sandboxedRun(projectPath, workflowName, steps, opts = {}) {
    const { runWorkflow } = require("../agents/runtime/autonomousWorkflow.cjs");
    const sandboxDir = await createSandbox(projectPath);

    const ctx = {
        ...(opts.ctx || {}),
        _projectPath: sandboxDir,
        _originalPath: projectPath,
        _sandboxed: true,
    };

    const runOpts = {
        maxRetries: opts.maxRetries,
        id:         opts.id,
        resume:     opts.resume,
        ctx,
    };

    let result;
    try {
        result = await runWorkflow(workflowName, steps, runOpts);
    } catch (err) {
        await cleanupSandbox(sandboxDir);
        throw err;
    }

    let appliedFiles = 0;
    if (result.success && !opts.dryRun) {
        appliedFiles = await applySandbox(sandboxDir, projectPath);
    }

    if (!opts.keepSandbox) await cleanupSandbox(sandboxDir);
    else result._sandboxPath = sandboxDir;

    return {
        ...result,
        sandboxed:    true,
        dryRun:       opts.dryRun || false,
        appliedFiles,
        sandboxDir:   opts.keepSandbox ? sandboxDir : null,
    };
}

module.exports = { createSandbox, applySandbox, cleanupSandbox, sandboxedRun, copyDir };
