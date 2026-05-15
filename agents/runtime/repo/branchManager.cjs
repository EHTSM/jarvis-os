"use strict";
/**
 * branchManager — stateful git branch lifecycle tracking.
 *
 * create(name, opts)             → branch record (runs git checkout -b)
 * checkout(name)                 — switch to existing branch
 * markFailed(name, reason)       — mark branch as failed for recovery
 * markComplete(name)             — mark branch as successfully merged/closed
 * recover(name)                  → { recovered, action, detail } — attempt recovery
 * createCheckpoint(name, data)   — save a rollback point for the branch
 * getCheckpoint(name)            → latest checkpoint data
 * listBranches()                 → all tracked branches
 * listRecoverable()              → failed branches eligible for recovery
 * deleteBranch(name, opts)       — git branch -d (safe) or -D (force)
 * reset()                        — clear in-memory state
 */

const { execSync } = require("child_process");

// name → { name, status, createdAt, failedAt?, failReason?, completedAt?, checkpoints[] }
const _branches    = new Map();
const _checkpoints = new Map();   // name → data[]

const STATUS = { ACTIVE: "active", FAILED: "failed", COMPLETE: "complete", RECOVERING: "recovering" };

function _git(cmd, opts = {}) {
    return execSync(`git ${cmd}`, {
        encoding: "utf8",
        cwd:      opts.cwd || process.cwd(),
        stdio:    ["pipe", "pipe", "pipe"],
    }).trim();
}

function _entry(name) {
    if (!_branches.has(name)) {
        _branches.set(name, {
            name,
            status:      STATUS.ACTIVE,
            createdAt:   new Date().toISOString(),
            failedAt:    null,
            failReason:  null,
            completedAt: null,
        });
    }
    return _branches.get(name);
}

function create(name, opts = {}) {
    const entry = _entry(name);
    if (!opts.skipGit) {
        try {
            _git(`checkout -b ${name}`, opts);
            entry.gitCreated = true;
        } catch (e) {
            // Branch may already exist — try switching
            try { _git(`checkout ${name}`, opts); }
            catch { entry.gitError = e.message; }
        }
    }
    return { ...entry };
}

function checkout(name, opts = {}) {
    _entry(name);
    if (!opts.skipGit) {
        try { _git(`checkout ${name}`, opts); }
        catch (e) { return { ok: false, error: e.message }; }
    }
    return { ok: true, name };
}

function markFailed(name, reason = "unknown") {
    const e = _entry(name);
    e.status     = STATUS.FAILED;
    e.failedAt   = new Date().toISOString();
    e.failReason = reason;
    return { ...e };
}

function markComplete(name) {
    const e = _entry(name);
    e.status      = STATUS.COMPLETE;
    e.completedAt = new Date().toISOString();
    return { ...e };
}

function recover(name, opts = {}) {
    const e = _branches.get(name);
    if (!e || e.status !== STATUS.FAILED) {
        return { recovered: false, action: "nothing", detail: "branch not in failed state" };
    }
    e.status = STATUS.RECOVERING;

    // Check if we have a checkpoint to roll back to
    const cps = _checkpoints.get(name) || [];
    if (cps.length > 0) {
        const latest = cps[cps.length - 1];
        e.status = STATUS.ACTIVE;
        return { recovered: true, action: "restored_checkpoint", detail: latest };
    }

    // Attempt to reset to HEAD without checkpoint
    if (!opts.skipGit) {
        try {
            _git(`checkout ${name}`, opts);
            _git("reset --hard HEAD", opts);
            e.status = STATUS.ACTIVE;
            return { recovered: true, action: "hard_reset", detail: "reset to HEAD" };
        } catch (err) {
            e.status = STATUS.FAILED;
            return { recovered: false, action: "reset_failed", detail: err.message };
        }
    }

    e.status = STATUS.ACTIVE;
    return { recovered: true, action: "simulated_recovery", detail: "skipGit mode" };
}

function createCheckpoint(name, data = {}) {
    _entry(name);
    if (!_checkpoints.has(name)) _checkpoints.set(name, []);
    const cp = { ts: new Date().toISOString(), data };
    _checkpoints.get(name).push(cp);
    return cp;
}

function getCheckpoint(name) {
    const cps = _checkpoints.get(name) || [];
    return cps.length > 0 ? cps[cps.length - 1] : null;
}

function listBranches() {
    return [..._branches.values()];
}

function listRecoverable() {
    return listBranches().filter(b => b.status === STATUS.FAILED);
}

function deleteBranch(name, opts = {}) {
    const flag = opts.force ? "-D" : "-d";
    if (!opts.skipGit) {
        try { _git(`branch ${flag} ${name}`, opts); }
        catch (e) { return { ok: false, error: e.message }; }
    }
    _branches.delete(name);
    _checkpoints.delete(name);
    return { ok: true, name };
}

function reset() { _branches.clear(); _checkpoints.clear(); }

module.exports = {
    create, checkout, markFailed, markComplete, recover,
    createCheckpoint, getCheckpoint,
    listBranches, listRecoverable, deleteBranch,
    reset, STATUS,
};
