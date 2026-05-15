"use strict";
/**
 * gitWorkflow — git operations as plannable workflow steps.
 *
 * Each step has { name, execute(ctx), rollback?(ctx) }.
 * Steps read from / write to ctx for composability.
 *
 * statusStep(opts)           — git status --porcelain → ctx.gitStatus
 * diffStep(opts)             — git diff --stat        → ctx.gitDiff
 * addStep(files, opts)       — git add <files>        (rollback: git reset HEAD)
 * commitStep(message, opts)  — git commit -m          (rollback: git reset --soft HEAD~1)
 * branchStep(name, opts)     — git checkout -b / checkout
 * logStep(n, opts)           — git log --oneline -n   → ctx.gitLog
 * buildGitWorkflow(opts)     — compose steps from option flags
 */

const { execSync } = require("child_process");

function _git(cmd, opts = {}) {
    return execSync(`git ${cmd}`, {
        encoding: "utf8",
        cwd:      opts.cwd || process.cwd(),
        stdio:    ["pipe", "pipe", "pipe"],
    }).trim();
}

function statusStep(opts = {}) {
    return {
        name: "git-status",
        execute: async (ctx) => {
            ctx.gitStatus = _git("status --porcelain", opts);
            return { output: ctx.gitStatus };
        },
    };
}

function diffStep(opts = {}) {
    return {
        name: "git-diff",
        execute: async (ctx) => {
            ctx.gitDiff = _git("diff --stat", opts);
            return { output: ctx.gitDiff };
        },
    };
}

function addStep(files = ".", opts = {}) {
    const target = Array.isArray(files) ? files.join(" ") : files;
    return {
        name: "git-add",
        execute: async (ctx) => {
            _git(`add ${target}`, opts);
            ctx.gitAdded = target;
            return { added: target };
        },
        rollback: async () => {
            try { _git("reset HEAD", opts); } catch { /* ignore */ }
        },
    };
}

function commitStep(message, opts = {}) {
    return {
        name: "git-commit",
        execute: async (ctx) => {
            const msg = (message || ctx.commitMessage || "automated commit")
                .replace(/"/g, '\\"');
            ctx.gitCommit = _git(`commit -m "${msg}"`, opts);
            return { output: ctx.gitCommit };
        },
        rollback: async () => {
            try { _git("reset --soft HEAD~1", opts); } catch { /* ignore */ }
        },
    };
}

function branchStep(name, opts = {}) {
    return {
        name: "git-branch",
        execute: async (ctx) => {
            const branchName = name || ctx.branchName;
            ctx.gitBranch    = branchName;
            try {
                _git(`checkout -b ${branchName}`, opts);
                return { created: branchName };
            } catch {
                _git(`checkout ${branchName}`, opts);
                return { switched: branchName };
            }
        },
    };
}

function logStep(n = 5, opts = {}) {
    return {
        name: "git-log",
        execute: async (ctx) => {
            ctx.gitLog = _git(`log --oneline -${n}`, opts);
            return { log: ctx.gitLog };
        },
    };
}

function buildGitWorkflow(opts = {}) {
    const steps = [];
    if (opts.status) steps.push(statusStep(opts));
    if (opts.diff)   steps.push(diffStep(opts));
    if (opts.add)    steps.push(addStep(opts.add === true ? "." : opts.add, opts));
    if (opts.commit) steps.push(commitStep(opts.commit === true ? undefined : opts.commit, opts));
    if (opts.branch) steps.push(branchStep(opts.branch, opts));
    if (opts.log)    steps.push(logStep(opts.logCount || 5, opts));
    return steps;
}

module.exports = { statusStep, diffStep, addStep, commitStep, branchStep, logStep, buildGitWorkflow };
