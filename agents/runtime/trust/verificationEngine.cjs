"use strict";
/**
 * verificationEngine — verify execution claims against observable state.
 *
 * verifyOutput(expected, actual)              → VerifyResult
 * verifyFilesystem(mutations)                 → VerifyResult
 *   mutations: [{ path, op: "created"|"modified"|"deleted" }]
 * verifyProcessSideEffects(claimed, actual)   → VerifyResult
 * verifyGitState(expectedBranch, cwd?)        → VerifyResult  (uses git rev-parse)
 * verifyDeploymentHealth(checks)              → VerifyResult
 *   checks: [{ type: "file"|"env"|"exitCode", key, expected? }]
 *
 * VerifyResult: { verified, issues[], checked[] }
 */

const fs            = require("fs");
const { spawnSync } = require("child_process");

// ── verifyOutput ──────────────────────────────────────────────────────

function verifyOutput(expected, actual) {
    if (expected === null || expected === undefined) {
        return { verified: true, issues: [], checked: [] };
    }
    const issues  = [];
    const checked = [];
    for (const [key, val] of Object.entries(expected)) {
        checked.push(key);
        if (actual == null || !(key in actual)) {
            issues.push(`missing field "${key}" in output`);
        } else if (val !== undefined && actual[key] !== val) {
            issues.push(`field "${key}": expected ${JSON.stringify(val)}, got ${JSON.stringify(actual[key])}`);
        }
    }
    return { verified: issues.length === 0, issues, checked };
}

// ── verifyFilesystem ──────────────────────────────────────────────────

function verifyFilesystem(mutations = []) {
    const issues  = [];
    const checked = [];
    for (const { path: p, op } of mutations) {
        checked.push(`${op}:${p}`);
        const exists = fs.existsSync(p);
        if (op === "created"  && !exists) issues.push(`expected "${p}" to exist (created) but not found`);
        if (op === "deleted"  && exists)  issues.push(`expected "${p}" to be deleted but still exists`);
        if (op === "modified" && !exists) issues.push(`expected "${p}" to exist (modified) but not found`);
    }
    return { verified: issues.length === 0, issues, checked };
}

// ── verifyProcessSideEffects ──────────────────────────────────────────

function verifyProcessSideEffects(claimedExitCode, actualExitCode) {
    const issues  = [];
    const checked = ["exitCode"];
    if (claimedExitCode !== actualExitCode) {
        issues.push(`exit code mismatch: claimed ${claimedExitCode}, actual ${actualExitCode}`);
    }
    return { verified: issues.length === 0, issues, checked };
}

// ── verifyGitState ────────────────────────────────────────────────────

function verifyGitState(expectedBranch, cwd = process.cwd()) {
    const issues  = [];
    const checked = ["git_branch"];
    let branch    = null;
    try {
        const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd, encoding: "utf8", timeout: 5_000 });
        branch = (r.stdout ?? "").trim();
        if (r.error || r.status !== 0) {
            issues.push(`git rev-parse failed: ${r.stderr?.trim() ?? "unknown error"}`);
        } else if (expectedBranch && branch !== expectedBranch) {
            issues.push(`expected branch "${expectedBranch}", found "${branch}"`);
        }
    } catch (err) {
        issues.push(`git check error: ${err.message}`);
    }
    return { verified: issues.length === 0, issues, checked, branch };
}

// ── verifyDeploymentHealth ────────────────────────────────────────────

function verifyDeploymentHealth(checks = []) {
    const issues  = [];
    const passed  = [];
    const failed  = [];

    for (const check of checks) {
        const { type, key, expected } = check;
        let ok = false;
        let label = `${type}:${key}`;

        if (type === "file") {
            ok = fs.existsSync(key);
        } else if (type === "env") {
            ok = key in process.env;
            if (ok && expected !== undefined) ok = process.env[key] === expected;
        } else if (type === "exitCode") {
            ok = key === 0 || key === "0";
        } else {
            ok = false;
            issues.push(`unknown check type "${type}"`);
        }

        if (ok) { passed.push(label); }
        else    { failed.push(label); issues.push(`health check failed: ${label}`); }
    }

    return { verified: issues.length === 0, issues, passed, failed };
}

module.exports = { verifyOutput, verifyFilesystem, verifyProcessSideEffects, verifyGitState, verifyDeploymentHealth };
