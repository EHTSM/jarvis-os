"use strict";
/**
 * integritySnapshot — capture and compare execution environment state.
 *
 * snapshot(executionId, opts?)   → Promise<SnapshotRecord>
 *   opts: { cwd?, includeGit?, includeEnv?, includeFs? }
 *
 * compare(snap1, snap2)          → { changed, diffs: [{field, before, after}] }
 * get(executionId)               → SnapshotRecord[] (all for that execution)
 * reset()
 *
 * SnapshotRecord: { id, executionId, ts, cwd, fileCount, gitStatus, envKeys, depsPresent }
 */

const fs            = require("fs");
const path          = require("path");
const { spawnSync } = require("child_process");

const _store = new Map();   // executionId → SnapshotRecord[]
let   _seq   = 0;

// ── snapshot ──────────────────────────────────────────────────────────

function snapshot(executionId, opts = {}) {
    const cwd         = opts.cwd        ?? process.cwd();
    const includeGit  = opts.includeGit ?? true;
    const includeEnv  = opts.includeEnv ?? true;
    const includeFs   = opts.includeFs  ?? true;

    const record = {
        id:          `snap-${executionId}-${++_seq}`,
        executionId,
        ts:          new Date().toISOString(),
        cwd,
        fileCount:   null,
        gitStatus:   null,
        envKeys:     null,
        depsPresent: null,
    };

    // Filesystem: count entries in cwd
    if (includeFs) {
        try {
            record.fileCount = fs.readdirSync(cwd).length;
        } catch (_) { record.fileCount = -1; }
    }

    // Git: short status
    if (includeGit) {
        try {
            const r = spawnSync("git", ["status", "--short"], { cwd, encoding: "utf8", timeout: 5_000 });
            record.gitStatus = r.status === 0 ? (r.stdout ?? "").trim() : null;
        } catch (_) { record.gitStatus = null; }
    }

    // Env: capture key count and selected safe keys
    if (includeEnv) {
        const safeKeys = ["NODE_ENV", "NODE_VERSION", "PATH", "SHELL"];
        record.envKeys = safeKeys.filter(k => k in process.env);
    }

    // Deps: check package.json exists
    const pkgPath = path.join(cwd, "package.json");
    record.depsPresent = fs.existsSync(pkgPath);

    if (!_store.has(executionId)) _store.set(executionId, []);
    _store.get(executionId).push(record);
    return record;
}

// ── compare ───────────────────────────────────────────────────────────

function compare(snap1, snap2) {
    const fields = ["fileCount", "gitStatus", "depsPresent"];
    const diffs  = [];
    for (const field of fields) {
        if (snap1[field] !== snap2[field]) {
            diffs.push({ field, before: snap1[field], after: snap2[field] });
        }
    }
    return { changed: diffs.length > 0, diffs };
}

// ── get / reset ───────────────────────────────────────────────────────

function get(executionId)  { return [...(_store.get(executionId) ?? [])]; }
function reset()           { _store.clear(); _seq = 0; }

module.exports = { snapshot, compare, get, reset };
