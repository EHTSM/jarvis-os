/**
 * Version Control Agent — executes git operations safely.
 */

const { execSync } = require("child_process");
const fs           = require("fs");
const path         = require("path");

const GITIGNORE = `node_modules/\n.env\n.env.*\ndist/\ncoverage/\n*.log\n.DS_Store\n`;

function _exec(cmd, cwd) {
    return execSync(cmd, { cwd, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function _safe(cmd, cwd) {
    try   { return { success: true,  output: _exec(cmd, cwd) }; }
    catch (e) { return { success: false, error: e.stderr?.toString().trim() || e.message }; }
}

function _isGitRepo(dir) {
    return fs.existsSync(path.join(dir, ".git"));
}

async function gitInit(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (_isGitRepo(dir)) return { success: true, message: "Already a git repo", path: dir };
    const r = _safe("git init", dir);
    if (!r.success) return r;
    fs.writeFileSync(path.join(dir, ".gitignore"), GITIGNORE);
    return { success: true, message: "Git initialized", path: dir };
}

async function gitStatus(dir) {
    if (!_isGitRepo(dir)) return { success: false, error: "Not a git repository" };
    const status = _safe("git status --short",      dir);
    const branch = _safe("git branch --show-current", dir);
    const log    = _safe("git log --oneline -5",     dir);
    return {
        success: true,
        branch:  branch.output || "main",
        clean:   !status.output?.trim(),
        changes: status.output?.split("\n").filter(Boolean) || [],
        recent:  log.output?.split("\n").filter(Boolean)    || []
    };
}

async function gitCommit(dir, message = "Jarvis auto-commit") {
    if (!_isGitRepo(dir)) return { success: false, error: "Not a git repository" };
    _safe("git add .", dir);
    const status = _safe("git status --short", dir);
    if (!status.output?.trim()) return { success: true, message: "Nothing to commit" };
    const msg = message.replace(/"/g, "'");
    return _safe(`git commit -m "${msg}"`, dir);
}

async function gitLog(dir, limit = 10) {
    if (!_isGitRepo(dir)) return { success: false, error: "Not a git repository" };
    const r = _safe(`git log --oneline -${limit}`, dir);
    return { success: r.success, commits: r.output?.split("\n").filter(Boolean) || [] };
}

async function gitBranch(dir, name) {
    return _safe(`git checkout -b ${name}`, dir);
}

async function run(task) {
    const p      = task.payload || {};
    const action = p.action || task.type;
    const dir    = p.projectPath || p.path || process.cwd();

    switch (action) {
        case "git_init":    return gitInit(dir);
        case "git_commit":  return gitCommit(dir, p.message);
        case "git_status":  return gitStatus(dir);
        case "git_log":     return gitLog(dir, p.limit || 10);
        case "git_branch":  return gitBranch(dir, p.branchName || "feature/new");
        default:            return gitStatus(dir);
    }
}

module.exports = { run, gitInit, gitStatus, gitCommit, gitLog, gitBranch };
