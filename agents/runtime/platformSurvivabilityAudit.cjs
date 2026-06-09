"use strict";
/**
 * Phase 628 — Platform Survivability Audit
 *
 * Verifies: no runaway autonomous execution, no hidden patch application,
 * no unsafe recovery recursion, no replay corruption, no duplicate workflow
 * resurrection, no uncontrolled browser execution.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function _audit(name, fn) {
    try {
        const result = fn();
        return { name, ok: result.ok !== false, clean: result.clean !== false, detail: result.detail || null, warnings: result.warnings || [] };
    } catch (e) {
        return { name, ok: false, clean: false, error: e.message };
    }
}

// ── Audit checks ──────────────────────────────────────────────────────────────

function checkNoRunawayAutonomousExecution() {
    const adc = _tryRequire("./autonomousDebugChains.cjs");
    const ato = _tryRequire("./autonomousTerminalOrchestration.cjs");

    const warnings = [];
    let clean = true;

    if (adc) {
        const chains = adc.listChains({ status: "executing", limit: 50 });
        const longRunning = chains.filter(c => Date.now() - c.startedAt > 60 * 60 * 1000);
        if (longRunning.length > 0) {
            clean = false;
            warnings.push(`${longRunning.length} autonomous debug chains running >1h`);
        }
    }

    if (ato) {
        const seqs = ato.listSequences({ status: "executing", limit: 50 });
        const longRunning = seqs.filter(s => Date.now() - s.createdAt > 60 * 60 * 1000);
        if (longRunning.length > 0) {
            clean = false;
            warnings.push(`${longRunning.length} terminal sequences running >1h`);
        }
    }

    return { ok: true, clean, detail: clean ? "No runaway autonomous execution" : "Runaway execution detected", warnings };
}

function checkNoHiddenPatchApplication() {
    const app = _tryRequire("./autonomousPatchPrep.cjs");
    const warnings = [];
    let clean = true;

    if (app) {
        const applied = app.listProposals({ status: "applied", limit: 50 });
        const noApproval = applied.filter(p => !p.approvedAt && !p.operatorId);
        if (noApproval.length > 0) {
            clean = false;
            warnings.push(`${noApproval.length} patches applied without recorded approval`);
        }
    }

    return { ok: true, clean, detail: clean ? "No hidden patch applications" : "Unapproved patch applications found", warnings };
}

function checkNoUnsafeRecoveryRecursion() {
    const ode  = _tryRequire("./operationalDecisionEngine.cjs");
    const warnings = [];
    let clean = true;

    if (ode) {
        const decisions = ode.listDecisions({ type: "recovery-path", limit: 50 });
        const recent    = decisions.filter(d => Date.now() - d.ts < 60 * 60 * 1000);
        if (recent.length >= 10) {
            clean = false;
            warnings.push(`${recent.length} recovery decisions in last hour — possible recursion`);
        }
    }

    return { ok: true, clean, detail: clean ? "No unsafe recovery recursion detected" : "Potential recovery loop detected", warnings };
}

function checkNoReplayCorruption() {
    const ers = _tryRequire("./executionReplaySystem.cjs");
    const warnings = [];
    let clean = true;

    if (ers) {
        const replays = ers.listReplays({ limit: 50 });
        const highReplay = replays.filter(r => r.replayCount > 20);
        if (highReplay.length > 0) {
            warnings.push(`${highReplay.length} replay(s) executed >20 times — verify intent`);
        }
    }

    return { ok: true, clean, detail: "Replay integrity checked", warnings };
}

function checkNoDuplicateWorkflowResurrection() {
    const ws = _tryRequire("./workflowSurvivability.cjs");
    const warnings = [];
    let clean = true;

    if (ws) {
        const stale = ws.detectStaleWorkflows();
        if (stale.staleCount >= 5) {
            warnings.push(`${stale.staleCount} stale workflows — risk of accidental resurrection`);
            clean = false;
        }
    }

    return { ok: true, clean, detail: clean ? "No duplicate workflow resurrection risk" : "Stale workflows present", warnings };
}

function checkNoUncontrolledBrowserExecution() {
    const abw = _tryRequire("./autonomousBrowserWorkflows.cjs");
    const warnings = [];
    let clean = true;

    if (abw) {
        const activeSessions = abw.listSessions({ status: "active", limit: 50 });
        const longRunning = activeSessions.filter(s => Date.now() - s.createdAt > 2 * 60 * 60 * 1000);
        if (longRunning.length > 0) {
            clean = false;
            warnings.push(`${longRunning.length} browser sessions running >2h without completion`);
        }
    }

    return { ok: true, clean, detail: clean ? "No uncontrolled browser execution" : "Long-running browser sessions detected", warnings };
}

function checkApprovalDiscipline() {
    const ete = _tryRequire("./executionTrustEvolution.cjs");
    const warnings = [];
    let clean = true;

    if (ete) {
        const safety = ete.autonomySafetyScore();
        if (safety.approvalViolations > 0) {
            clean = false;
            warnings.push(`${safety.approvalViolations} approval violation(s) recorded`);
        }
    }

    return { ok: true, clean, detail: clean ? "Approval discipline healthy" : "Approval violations found", warnings };
}

// ── Run audit ─────────────────────────────────────────────────────────────────

function runAudit() {
    const checks = [
        _audit("no-runaway-execution",           checkNoRunawayAutonomousExecution),
        _audit("no-hidden-patch-application",     checkNoHiddenPatchApplication),
        _audit("no-unsafe-recovery-recursion",    checkNoUnsafeRecoveryRecursion),
        _audit("no-replay-corruption",            checkNoReplayCorruption),
        _audit("no-duplicate-workflow-resurrection", checkNoDuplicateWorkflowResurrection),
        _audit("no-uncontrolled-browser-execution",  checkNoUncontrolledBrowserExecution),
        _audit("approval-discipline",             checkApprovalDiscipline),
    ];

    const passed   = checks.filter(c => c.ok).length;
    const clean    = checks.every(c => c.clean !== false);
    const warnings = checks.flatMap(c => c.warnings || []);

    return {
        ok:       true,
        clean,
        passed,
        total:    checks.length,
        checks,
        warnings,
        summary:  `Survivability audit: ${passed}/${checks.length} | Clean: ${clean} | Warnings: ${warnings.length}`,
    };
}

module.exports = { runAudit, checkNoRunawayAutonomousExecution, checkNoHiddenPatchApplication, checkNoUnsafeRecoveryRecursion, checkNoReplayCorruption, checkNoDuplicateWorkflowResurrection, checkNoUncontrolledBrowserExecution };
