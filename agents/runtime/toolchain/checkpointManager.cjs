"use strict";

const fs  = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let _checkpoints = new Map();
let _seq = 0;

// ── DJB2 hash for a short string ─────────────────────────────────────
function _djb2(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) { h = ((h << 5) + h) ^ str.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(16).padStart(8, "0");
}

function _fileCount(cwd) {
    try {
        return fs.readdirSync(cwd).length;
    } catch {
        return 0;
    }
}

function _gitStatus(cwd) {
    try {
        const r = spawnSync("git", ["status", "--short"], { cwd, encoding: "utf8", timeout: 3000 });
        return (r.stdout ?? "").trim();
    } catch {
        return "";
    }
}

function _depsHash(cwd) {
    const pkgPath = path.join(cwd, "package.json");
    try {
        const content = fs.readFileSync(pkgPath, "utf8");
        return _djb2(content);
    } catch {
        return null;
    }
}

// ── Public API ────────────────────────────────────────────────────────

function take(executionId, opts = {}) {
    const cwd = opts.cwd ?? process.cwd();
    const id  = `cp-${executionId}-${++_seq}`;
    const checkpoint = {
        id,
        executionId,
        ts:         new Date().toISOString(),
        cwd,
        fileCount:  _fileCount(cwd),
        gitStatus:  _gitStatus(cwd),
        depsHash:   _depsHash(cwd),
    };
    if (!_checkpoints.has(executionId)) _checkpoints.set(executionId, []);
    _checkpoints.get(executionId).push(checkpoint);
    return checkpoint;
}

function getLatest(executionId) {
    const list = _checkpoints.get(executionId) ?? [];
    return list.length > 0 ? list[list.length - 1] : null;
}

function getAll(executionId) {
    return [...(_checkpoints.get(executionId) ?? [])];
}

function compare(cpBefore, cpAfter) {
    if (!cpBefore || !cpAfter) return { changed: false, diffs: [] };
    const diffs = [];
    if (cpBefore.fileCount !== cpAfter.fileCount) {
        diffs.push({ field: "fileCount", before: cpBefore.fileCount, after: cpAfter.fileCount });
    }
    if (cpBefore.gitStatus !== cpAfter.gitStatus) {
        diffs.push({ field: "gitStatus", before: cpBefore.gitStatus, after: cpAfter.gitStatus });
    }
    if (cpBefore.depsHash !== cpAfter.depsHash) {
        diffs.push({ field: "depsHash", before: cpBefore.depsHash, after: cpAfter.depsHash });
    }
    return { changed: diffs.length > 0, diffs };
}

function reset() {
    _checkpoints = new Map();
    _seq = 0;
}

module.exports = { take, getLatest, getAll, compare, reset };
