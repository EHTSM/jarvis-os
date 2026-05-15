"use strict";

const { spawnSync } = require("child_process");
const cpm = require("./checkpointManager.cjs");

let _rollbackLog = [];

function _gitStash(cwd) {
    try {
        const r = spawnSync("git", ["stash"], { cwd, encoding: "utf8", timeout: 5000 });
        return r.status === 0;
    } catch {
        return false;
    }
}

function _gitRevert(commitish, cwd) {
    try {
        const r = spawnSync("git", ["revert", "--no-edit", commitish], { cwd, encoding: "utf8", timeout: 10000 });
        return r.status === 0;
    } catch {
        return false;
    }
}

// ── rollback ─────────────────────────────────────────────────────────

function rollback(executionId, opts = {}) {
    const checkpoint = cpm.getLatest(executionId);
    const cwd        = opts.cwd ?? checkpoint?.cwd ?? process.cwd();
    const dryRun     = opts.dryRun ?? false;

    const entry = {
        executionId,
        ts:          new Date().toISOString(),
        checkpoint:  checkpoint?.id ?? null,
        cwd,
        dryRun,
        actions:     [],
        success:     false,
    };

    if (!checkpoint) {
        entry.reason  = "no checkpoint available";
        entry.success = false;
        _rollbackLog.push(entry);
        return entry;
    }

    if (!dryRun && opts.revertGit) {
        const stashed = _gitStash(cwd);
        entry.actions.push({ type: "git_stash", success: stashed });
    } else if (dryRun) {
        entry.actions.push({ type: "git_stash", success: true, simulated: true });
    }

    entry.success = true;
    _rollbackLog.push(entry);
    return entry;
}

function revertGitState(cwd, opts = {}) {
    if (opts.dryRun) {
        return { success: true, simulated: true };
    }
    const ok = _gitStash(cwd);
    return { success: ok };
}

function getLog()    { return [..._rollbackLog]; }
function reset()     { _rollbackLog = []; cpm.reset(); }

module.exports = { rollback, revertGitState, getLog, reset };
