"use strict";
/**
 * verificationLayer — post-execution verification that actions actually occurred.
 *
 * Verifies: file changes, command exit codes, browser action outcomes,
 *           port bindings, deployment reachability.
 *
 * createVerificationContext(execId, capType) → VerificationContext
 * recordPreState(execId, state)              → void
 * recordPostState(execId, state)             → void
 * verify(execId, opts)                       → VerificationResult
 * recordVerificationResult(execId, result)   → void
 * getVerificationContext(execId)             → VerificationContext | null
 * getVerificationStats()                     → Stats
 * reset()
 */

const VERIFICATION_STRATEGIES = {
    filesystem: _verifyFilesystem,
    terminal:   _verifyTerminal,
    browser:    _verifyBrowser,
    git:        _verifyGit,
    docker:     _verifyDocker,
    n8n:        _verifyN8n,
    vscode:     _verifyVSCode,
    generic:    _verifyGeneric,
};

// Verification outcome codes
const OUTCOMES = {
    PASSED:    "passed",
    FAILED:    "failed",
    UNCHANGED: "unchanged",   // mutation expected but nothing changed
    PARTIAL:   "partial",     // some checks passed
    SKIPPED:   "skipped",     // no verification configured
};

let _contexts = new Map();   // execId → VerificationContext
let _counter  = 0;

// ── createVerificationContext ─────────────────────────────────────────

function createVerificationContext(execId, capType = "generic") {
    const surface  = _capToSurface(capType);
    const ctx = {
        contextId: `ver-${++_counter}`,
        execId,
        capType,
        surface,
        preState:  null,
        postState: null,
        result:    null,
        strict:    false,
        ts:        new Date().toISOString(),
    };
    _contexts.set(execId, ctx);
    return { contextId: ctx.contextId, execId, surface };
}

function _capToSurface(capType) {
    if (capType.startsWith("fs."))        return "filesystem";
    if (capType.startsWith("terminal."))  return "terminal";
    if (capType.startsWith("browser."))   return "browser";
    if (capType.startsWith("git."))       return "git";
    if (capType.startsWith("docker."))    return "docker";
    if (capType.startsWith("n8n."))       return "n8n";
    if (capType.startsWith("vscode."))    return "vscode";
    return "generic";
}

// ── recordPreState / recordPostState ──────────────────────────────────

function recordPreState(execId, state = {}) {
    const ctx = _contexts.get(execId);
    if (!ctx) return { recorded: false, reason: "context_not_found" };
    ctx.preState = { ...state, recordedAt: new Date().toISOString() };
    return { recorded: true, execId };
}

function recordPostState(execId, state = {}) {
    const ctx = _contexts.get(execId);
    if (!ctx) return { recorded: false, reason: "context_not_found" };
    ctx.postState = { ...state, recordedAt: new Date().toISOString() };
    return { recorded: true, execId };
}

// ── verify ────────────────────────────────────────────────────────────

function verify(execId, opts = {}) {
    const ctx = _contexts.get(execId);
    if (!ctx) return { outcome: OUTCOMES.SKIPPED, reason: "context_not_found", execId };

    if (!ctx.preState && !ctx.postState) {
        return { outcome: OUTCOMES.SKIPPED, reason: "no_states_recorded", execId };
    }

    if (opts.strict != null) ctx.strict = opts.strict;

    const strategy = VERIFICATION_STRATEGIES[ctx.surface] ?? _verifyGeneric;
    const result   = strategy(ctx, opts);
    ctx.result     = result;

    return { ...result, execId, surface: ctx.surface, capType: ctx.capType };
}

// ── _verifyFilesystem ─────────────────────────────────────────────────

function _verifyFilesystem(ctx) {
    const pre  = ctx.preState;
    const post = ctx.postState;

    if (!post) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_post_state" };

    const checks = [];

    // Check: file hash changed (if provided)
    if (pre?.hash != null && post?.hash != null) {
        const changed = pre.hash !== post.hash;
        checks.push({ check: "hash_changed", passed: changed, detail: changed ? "hash differs" : "hash unchanged" });
    }

    // Check: file size changed (if provided)
    if (pre?.size != null && post?.size != null) {
        const changed = pre.size !== post.size;
        checks.push({ check: "size_changed", passed: changed || ctx.strict === false, detail: `${pre.size} → ${post.size}` });
    }

    // Check: file exists (if expected)
    if (post?.exists != null) {
        checks.push({ check: "file_exists", passed: post.exists === true, detail: post.exists ? "file present" : "file missing" });
    }

    if (checks.length === 0) return { outcome: OUTCOMES.SKIPPED, checks, reason: "no_verifiable_fields" };

    const passed = checks.filter(c => c.passed).length;
    const outcome = passed === checks.length ? OUTCOMES.PASSED
                  : passed > 0              ? OUTCOMES.PARTIAL
                  :                           OUTCOMES.UNCHANGED;

    return { outcome, checks, passRate: +(passed / checks.length).toFixed(3) };
}

// ── _verifyTerminal ───────────────────────────────────────────────────

function _verifyTerminal(ctx) {
    const post = ctx.postState;
    if (!post) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_post_state" };

    const checks = [];

    // Exit code check
    if (post.exitCode != null) {
        const ok = post.exitCode === 0;
        checks.push({ check: "exit_code_zero", passed: ok, detail: `exitCode=${post.exitCode}` });
    }

    // Output presence check
    if (post.output != null) {
        const hasOutput = typeof post.output === "string" && post.output.length > 0;
        checks.push({ check: "output_present", passed: hasOutput, detail: hasOutput ? "output present" : "empty output" });
    }

    if (checks.length === 0) return { outcome: OUTCOMES.SKIPPED, checks, reason: "no_verifiable_fields" };
    const passed  = checks.filter(c => c.passed).length;
    const outcome = passed === checks.length ? OUTCOMES.PASSED
                  : passed > 0              ? OUTCOMES.PARTIAL
                  :                           OUTCOMES.FAILED;
    return { outcome, checks, passRate: +(passed / checks.length).toFixed(3) };
}

// ── _verifyBrowser ────────────────────────────────────────────────────

function _verifyBrowser(ctx) {
    const post = ctx.postState;
    if (!post) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_post_state" };

    const checks = [];

    if (post.urlMatches != null) {
        checks.push({ check: "url_matches", passed: post.urlMatches === true, detail: post.currentUrl ?? "" });
    }
    if (post.elementFound != null) {
        checks.push({ check: "element_found", passed: post.elementFound === true, detail: post.selector ?? "" });
    }
    if (post.screenshotCaptured != null) {
        checks.push({ check: "screenshot_captured", passed: post.screenshotCaptured === true });
    }

    if (checks.length === 0) return { outcome: OUTCOMES.SKIPPED, checks, reason: "no_verifiable_fields" };
    const passed  = checks.filter(c => c.passed).length;
    const outcome = passed === checks.length ? OUTCOMES.PASSED : passed > 0 ? OUTCOMES.PARTIAL : OUTCOMES.FAILED;
    return { outcome, checks, passRate: +(passed / checks.length).toFixed(3) };
}

// ── _verifyGit ────────────────────────────────────────────────────────

function _verifyGit(ctx) {
    const pre  = ctx.preState;
    const post = ctx.postState;
    if (!post) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_post_state" };

    const checks = [];
    if (pre?.commitHash != null && post?.commitHash != null) {
        const advanced = pre.commitHash !== post.commitHash;
        checks.push({ check: "head_advanced", passed: advanced, detail: `${pre.commitHash} → ${post.commitHash}` });
    }
    if (post?.staged != null) {
        checks.push({ check: "staged_clean", passed: post.staged === 0, detail: `${post.staged} files staged` });
    }
    if (post?.dirty != null) {
        checks.push({ check: "working_tree_clean", passed: post.dirty === 0, detail: `${post.dirty} dirty files` });
    }

    if (checks.length === 0) return { outcome: OUTCOMES.SKIPPED, checks, reason: "no_verifiable_fields" };
    const passed  = checks.filter(c => c.passed).length;
    const outcome = passed === checks.length ? OUTCOMES.PASSED : passed > 0 ? OUTCOMES.PARTIAL : OUTCOMES.FAILED;
    return { outcome, checks, passRate: +(passed / checks.length).toFixed(3) };
}

// ── _verifyDocker ─────────────────────────────────────────────────────

function _verifyDocker(ctx) {
    const post = ctx.postState;
    if (!post) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_post_state" };

    const checks = [];
    if (post.containerRunning != null) {
        checks.push({ check: "container_running", passed: post.containerRunning === true });
    }
    if (post.portBound != null) {
        checks.push({ check: "port_bound", passed: post.portBound === true, detail: `port ${post.port ?? "unknown"}` });
    }
    if (post.healthCheck != null) {
        checks.push({ check: "health_check_passed", passed: post.healthCheck === true });
    }

    if (checks.length === 0) return { outcome: OUTCOMES.SKIPPED, checks, reason: "no_verifiable_fields" };
    const passed  = checks.filter(c => c.passed).length;
    const outcome = passed === checks.length ? OUTCOMES.PASSED : passed > 0 ? OUTCOMES.PARTIAL : OUTCOMES.FAILED;
    return { outcome, checks, passRate: +(passed / checks.length).toFixed(3) };
}

// ── _verifyN8n ────────────────────────────────────────────────────────

function _verifyN8n(ctx) {
    const post = ctx.postState;
    if (!post) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_post_state" };
    const checks = [];
    if (post.triggered != null)  checks.push({ check: "workflow_triggered", passed: post.triggered === true });
    if (post.executionId != null) checks.push({ check: "execution_id_present", passed: Boolean(post.executionId) });
    if (checks.length === 0) return { outcome: OUTCOMES.SKIPPED, checks, reason: "no_verifiable_fields" };
    const passed = checks.filter(c => c.passed).length;
    const outcome = passed === checks.length ? OUTCOMES.PASSED : passed > 0 ? OUTCOMES.PARTIAL : OUTCOMES.FAILED;
    return { outcome, checks, passRate: +(passed / checks.length).toFixed(3) };
}

// ── _verifyVSCode ─────────────────────────────────────────────────────

function _verifyVSCode(ctx) {
    const post = ctx.postState;
    if (!post) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_post_state" };
    const checks = [];
    if (post.fileSaved != null)  checks.push({ check: "file_saved",    passed: post.fileSaved === true  });
    if (post.taskDone  != null)  checks.push({ check: "task_completed", passed: post.taskDone  === true  });
    if (checks.length === 0) return { outcome: OUTCOMES.SKIPPED, checks, reason: "no_verifiable_fields" };
    const passed = checks.filter(c => c.passed).length;
    const outcome = passed === checks.length ? OUTCOMES.PASSED : passed > 0 ? OUTCOMES.PARTIAL : OUTCOMES.FAILED;
    return { outcome, checks, passRate: +(passed / checks.length).toFixed(3) };
}

// ── _verifyGeneric ────────────────────────────────────────────────────

function _verifyGeneric(ctx) {
    const post = ctx.postState;
    if (!post) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_post_state" };
    const success = post.success ?? post.exitCode === 0 ?? null;
    if (success == null) return { outcome: OUTCOMES.SKIPPED, checks: [], reason: "no_success_field" };
    const checks = [{ check: "success", passed: success === true }];
    return { outcome: success ? OUTCOMES.PASSED : OUTCOMES.FAILED, checks, passRate: success ? 1 : 0 };
}

// ── recordVerificationResult ──────────────────────────────────────────

function recordVerificationResult(execId, result = {}) {
    const ctx = _contexts.get(execId);
    if (ctx) ctx.result = result;
}

// ── getVerificationContext ────────────────────────────────────────────

function getVerificationContext(execId) {
    return _contexts.get(execId) ?? null;
}

// ── getVerificationStats ──────────────────────────────────────────────

function getVerificationStats() {
    const all    = [..._contexts.values()].filter(c => c.result != null);
    const byOutcome = {};
    for (const c of all) {
        const o = c.result?.outcome ?? "unknown";
        byOutcome[o] = (byOutcome[o] ?? 0) + 1;
    }
    const passed = all.filter(c => c.result?.outcome === OUTCOMES.PASSED).length;
    return {
        total:      _contexts.size,
        verified:   all.length,
        byOutcome,
        passRate:   all.length > 0 ? +(passed / all.length).toFixed(3) : 0,
    };
}

// ── reset ─────────────────────────────────────────────────────────────

function reset() {
    _contexts = new Map();
    _counter  = 0;
}

module.exports = {
    OUTCOMES, VERIFICATION_STRATEGIES,
    createVerificationContext, recordPreState, recordPostState,
    verify, recordVerificationResult, getVerificationContext,
    getVerificationStats, reset,
};
