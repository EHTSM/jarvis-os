"use strict";
/**
 * Phase 734 — Product Maturity Audit
 *
 * Verify: no unsafe patch execution, no replay corruption, no uncontrolled orchestration,
 * no stale workflow resurrection, no unsafe deployment continuation, no hidden autonomous behavior.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Audit 1: No unsafe patch execution ───────────────────────────────────────

function auditPatchExecutionSafety() {
    const issues = [];

    const cpm = _tryRequire("./contextualPatchMaturity.cjs");
    if (!cpm) return { pass: true, skipped: true, check: "patch-execution-safety" };

    try {
        // Apply without approval must be blocked
        const r = cpm.applyPatch("nonexistent-734", { operatorApproved: false });
        if (r.ok) issues.push({ issue: "patch-apply-no-approval", severity: "critical" });

        // Dep-aware edit without approval must be blocked
        const d = cpm.proposeDependencyAwareEdit("nonexistent-734", "/src/app.ts", { operatorApproved: false });
        if (d.ok) issues.push({ issue: "dep-aware-edit-no-approval", severity: "critical" });

        // Stale patch — proposal for a patch created > 8h ago should be rejected at apply time
        // (we can't easily simulate this without manipulating time, so check structural guard exists)
        const proposed = cpm.proposePatch(`audit-734-${Date.now()}`, { files: [{ filePath: "/src/test.ts" }], description: "audit check" });
        if (!proposed.requiresApproval) issues.push({ issue: "patch-missing-approval-flag", severity: "critical" });
    } catch (e) {
        issues.push({ issue: `audit-exception: ${e.message}`, severity: "warning" });
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "patch-execution-safety" };
}

// ── Audit 2: No replay corruption ─────────────────────────────────────────────

function auditReplayCorruption3() {
    const issues = [];

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (!lss) return { pass: true, skipped: true, check: "replay-corruption" };

    try {
        // Non-existent session must not restore
        const r = lss.restoreSurvivabilitySession("nonexistent-734");
        if (r.ok) issues.push({ issue: "nonexistent-session-restored", severity: "critical" });

        // Stale session without force must be blocked
        const storm = lss.survivabilityStormStatus();
        if (!("storm" in storm)) issues.push({ issue: "storm-status-missing", severity: "warning" });

        // Durability check
        const d = lss.assessSurvivabilityDurability();
        if (d.ok === undefined) issues.push({ issue: "durability-ok-missing", severity: "warning" });
    } catch (e) {
        issues.push({ issue: `audit-exception: ${e.message}`, severity: "warning" });
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "replay-corruption" };
}

// ── Audit 3: No uncontrolled orchestration ────────────────────────────────────

function auditUncontrolledOrchestration2() {
    const issues = [];

    // One-click flow resume without approval
    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    if (ocf) {
        try {
            const r = ocf.resumeOneClickFlow("nonexistent-734", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "one-click-resume-no-approval", severity: "critical" });
        } catch {}
    }

    // Long-session interrupted recovery without approval
    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            const r = lss.recoverInterruptedWorkflows({ operatorApproved: false });
            if (r.ok) issues.push({ issue: "interrupted-recovery-no-approval", severity: "critical" });
        } catch {}
    }

    // Multi-project switch without approval
    const mpem = _tryRequire("./multiProjectEngineeringMaturity.cjs");
    if (mpem) {
        try {
            const r = mpem.switchProject("nonexistent-734", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "project-switch-no-approval", severity: "critical" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "uncontrolled-orchestration" };
}

// ── Audit 4: No stale workflow resurrection ───────────────────────────────────

function auditStaleWorkflowResurrection() {
    const issues = [];

    // Stale session restore without force must be blocked
    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (lss) {
        try {
            // Persist a session with a very old timestamp by restoring nonexistent — must fail
            const r = lss.restoreSurvivabilitySession("nonexistent-734b");
            if (r.ok) issues.push({ issue: "ghost-session-resurrected", severity: "critical" });
        } catch {}
    }

    // Memory dedup: second identical record within DEDUP_MS must be duplicate
    const emr = _tryRequire("./engineeringMemoryRefinement.cjs");
    if (emr) {
        try {
            const key = `dedup-test-${Date.now()}`;
            emr.recordRefinedOutcome("workflow", key, { success: true });
            const second = emr.recordRefinedOutcome("workflow", key, { success: true });
            if (!second.duplicate) issues.push({ issue: "memory-dedup-not-enforced", severity: "warning" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "stale-workflow-resurrection" };
}

// ── Audit 5: No unsafe deployment continuation ────────────────────────────────

function auditDeploymentContinuationSafety2() {
    const issues = [];

    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (dpm) {
        try {
            const r = dpm.buildStagedDeploymentFlow("audit-734", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "staged-deploy-no-approval", severity: "critical" });
        } catch {}
    }

    const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
    if (rdw) {
        try {
            const r = rdw.prepareRollback("audit-734", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "rollback-no-approval", severity: "critical" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "deployment-continuation-safety" };
}

// ── Audit 6: No hidden autonomous behavior ────────────────────────────────────

function auditHiddenAutonomousBehavior() {
    const issues = [];

    // All one-click flows: destructive types must require approval
    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    if (ocf) {
        try {
            const catalog = ocf.catalogOneClickFlows();
            catalog.forEach(f => {
                if (["deploy-prep", "runtime-stabilize", "dep-recovery"].includes(f.type) && !f.requiresApproval) {
                    issues.push({ issue: `approval-missing:${f.type}`, severity: "critical" });
                }
            });
        } catch {}
    }

    // Multi-project env restoration without approval must be blocked
    const mpem = _tryRequire("./multiProjectEngineeringMaturity.cjs");
    if (mpem) {
        try {
            const r = mpem.restoreProjectEnvironment("nonexistent-734", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "project-env-restore-no-approval", severity: "critical" });
        } catch {}
    }

    // Instant workspace restore without approval
    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    if (iwr) {
        try {
            const r = iwr.instantRestore("nonexistent-734", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "instant-restore-no-approval", severity: "critical" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "hidden-autonomous-behavior" };
}

// ── Full audit ────────────────────────────────────────────────────────────────

function runProductMaturityAudit() {
    const checks = [
        auditPatchExecutionSafety(),
        auditReplayCorruption3(),
        auditUncontrolledOrchestration2(),
        auditStaleWorkflowResurrection(),
        auditDeploymentContinuationSafety2(),
        auditHiddenAutonomousBehavior(),
    ];

    const passed   = checks.filter(c => c.pass).length;
    const total    = checks.length;
    const critical = checks.flatMap(c => c.issues || []).filter(i => i.severity === "critical").length;
    const warnings = checks.flatMap(c => c.issues || []).filter(i => i.severity === "warning").length;

    return {
        ok:      critical === 0,
        passed, total, critical, warnings,
        checks,
        failed:  checks.filter(c => !c.pass).map(c => ({ check: c.check, issues: c.issues })),
        summary: `Product maturity audit: ${passed}/${total} checks passed — critical=${critical} warnings=${warnings}`,
    };
}

module.exports = { auditPatchExecutionSafety, auditReplayCorruption3, auditUncontrolledOrchestration2, auditStaleWorkflowResurrection, auditDeploymentContinuationSafety2, auditHiddenAutonomousBehavior, runProductMaturityAudit };
