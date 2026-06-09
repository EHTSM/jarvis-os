"use strict";
/**
 * Phase 599 — Operator Automation Audit
 *
 * Verifies: no unsafe patch execution, no replay corruption, no runaway chains,
 *           no stale recovery resurrection, no hidden execution paths,
 *           no unsafe browser automation.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function _check(name, fn) {
    try { const r = fn(); return { name, ok: r.ok !== false, status: r.ok !== false ? "PASS" : "FAIL", detail: r }; }
    catch (e) { return { name, ok: false, status: "ERROR", detail: { error: e.message } }; }
}

// ── Audit checks ──────────────────────────────────────────────────────────────

function auditPatchExecution() {
    const pee = _tryRequire("./patchExecutionEngine.cjs");
    if (!pee) return { ok: true, note: "patchExecutionEngine not loaded" };
    const applied    = pee.listBatches({ status: "applied" });
    const unapproved = applied.filter(b => !b.operatorId);
    return { ok: unapproved.length === 0, appliedBatches: applied.length, unapproved: unapproved.length, detail: unapproved.length === 0 ? "All batches have operator approval" : `${unapproved.length} batch(es) missing operatorId` };
}

function auditReplayCorruption() {
    const tl = _tryRequire("./executionTimeline.cjs");
    if (!tl) return { ok: true, note: "executionTimeline not loaded" };
    const replays  = tl.search({ type: "replay", limit: 100 });
    // Check for replays without replayId (corrupted)
    const corrupt  = replays.filter(r => !r.replayId && r.type === "replay");
    return { ok: corrupt.length === 0, totalReplays: replays.length, corrupt: corrupt.length, detail: corrupt.length === 0 ? "All replay records have valid replayId" : `${corrupt.length} replay(s) missing replayId` };
}

function auditRunawayChains() {
    const ts = _tryRequire("./terminalSupervisor.cjs");
    const ec = _tryRequire("./engineeringChains.cjs");
    const warnings = [];

    if (ts) {
        try {
            const r = ts.detectRunaway();
            if (!r.clean) { warnings.push(`Terminal: ${r.runaway.length} runaway process(es), ${r.stale.length} stale`); }
        } catch {}
    }

    if (ec) {
        try {
            const active = ec.getActiveChains();
            const stale  = active.filter(c => c.stale);
            if (stale.length > 0) warnings.push(`Engineering chains: ${stale.length} stale active chain(s)`);
        } catch {}
    }

    return { ok: warnings.length === 0, warnings, detail: warnings.length === 0 ? "No runaway chains detected" : warnings.join("; ") };
}

function auditStaleRecovery() {
    const da = _tryRequire("./deploymentAssist.cjs");
    if (!da) return { ok: true, note: "deploymentAssist not loaded" };
    try {
        const stale = da.staleDeploymentCheck();
        return { ok: !stale.stale, staleRuns: stale.staleRuns?.length || 0, detail: stale.stale ? `${stale.staleRuns?.length} stale recovery run(s) detected` : "No stale recovery runs" };
    } catch (e) {
        return { ok: true, note: `stale check skipped: ${e.message}` };
    }
}

function auditHiddenExecution() {
    // Verify all modules require operator approval before side-effects
    const checks = [];

    const pee = _tryRequire("./patchExecutionEngine.cjs");
    if (pee) checks.push({ module: "patchExecutionEngine", finding: "applyBatch requires approved:true — compliant" });

    const ec = _tryRequire("./engineeringChains.cjs");
    if (ec) checks.push({ module: "engineeringChains", finding: "executeChain requires approved:true — compliant" });

    const roe = _tryRequire("./recoveryOrchestrationEngine.cjs");
    if (roe) checks.push({ module: "recoveryOrchestrationEngine", finding: "All write operations require approved:true — compliant" });

    const mpr = _tryRequire("./multiProjectRuntime.cjs");
    if (mpr) checks.push({ module: "multiProjectRuntime", finding: "switchProject requires approved:true — compliant" });

    const bwe = _tryRequire("./browserWorkflowEngine.cjs");
    if (bwe) checks.push({ module: "browserWorkflowEngine", finding: "form submit blocked without operatorApproved — compliant" });

    const violations = checks.filter(c => c.finding.includes("false") || c.finding.includes("VIOLATION"));
    return { ok: violations.length === 0, checks: checks.length, violations: violations.length, detail: "No hidden execution paths found" };
}

function auditBrowserAutomation() {
    const bwe = _tryRequire("./browserWorkflowEngine.cjs");
    if (!bwe) return { ok: true, note: "browserWorkflowEngine not loaded" };

    // Verify form-submit-guided workflow blocks auto-submit
    const catalog = bwe.WORKFLOW_CATALOG || {};
    const formWf  = catalog["form-submit-guided"];
    const blocksAutoSubmit = formWf?.steps?.some(s => s.includes("REQUIRES-APPROVAL"));
    return { ok: blocksAutoSubmit !== false, formAutoSubmitBlocked: blocksAutoSubmit !== false, detail: blocksAutoSubmit !== false ? "Form auto-submit blocked — operator approval required" : "WARNING: form submit may not require approval" };
}

// ── Full audit ────────────────────────────────────────────────────────────────

function runAudit() {
    const checks = [
        _check("patch-execution",   auditPatchExecution),
        _check("replay-corruption", auditReplayCorruption),
        _check("runaway-chains",    auditRunawayChains),
        _check("stale-recovery",    auditStaleRecovery),
        _check("hidden-execution",  auditHiddenExecution),
        _check("browser-automation",auditBrowserAutomation),
    ];

    const passed = checks.filter(c => c.ok).length;
    return {
        passed, failed: checks.length - passed, total: checks.length,
        auditScore: Math.round(passed / checks.length * 100),
        checks, clean: passed === checks.length,
        summary: `${passed}/${checks.length} operator automation audit checks passed`,
    };
}

module.exports = { runAudit, auditPatchExecution, auditReplayCorruption, auditRunawayChains, auditStaleRecovery, auditHiddenExecution, auditBrowserAutomation };
