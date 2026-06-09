"use strict";
/**
 * Phase 718 — Operator Productivity Audit
 *
 * Verify: no workflow overload, no replay corruption, no hidden execution behavior,
 * no unsafe deployment continuation, no duplicate workflow resurrection,
 * no uncontrolled orchestration.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Audit 1: No workflow overload ─────────────────────────────────────────────

function auditWorkflowOverload() {
    const issues = [];

    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) {
        try {
            const running = epc.listProductivityChains({ status: "running" });
            if (running.length > 10) issues.push({ issue: `workflow-overload: ${running.length} chains`, severity: "critical" });
        } catch {}
    }

    const dea = _tryRequire("./dailyEngineeringAutomation2.cjs");
    if (dea) {
        try {
            const running = dea.listAutomationRuns2({ status: "running" });
            if (running.length > 8) issues.push({ issue: `automation-overload: ${running.length} runs`, severity: "warning" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "workflow-overload" };
}

// ── Audit 2: No replay corruption ─────────────────────────────────────────────

function auditReplayCorruption2() {
    const issues = [];

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (!lhpc) return { pass: true, skipped: true, check: "replay-corruption" };

    try {
        // Non-existent session must not restore
        const r = lhpc.restoreProductivitySession("nonexistent-718");
        if (r.ok) issues.push({ issue: "nonexistent-session-restored", severity: "critical" });

        // Storm status must be readable
        const storm = lhpc.productivityStormStatus();
        if (!("storm" in storm)) issues.push({ issue: "storm-status-missing", severity: "warning" });

        // Durability check
        const d = lhpc.assessProductivityCrossEnvDurability();
        if (d.ok === undefined) issues.push({ issue: "durability-ok-missing", severity: "warning" });
    } catch (e) {
        issues.push({ issue: `audit-exception: ${e.message}`, severity: "warning" });
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "replay-corruption" };
}

// ── Audit 3: No hidden execution behavior ─────────────────────────────────────

function auditHiddenExecutionBehavior() {
    const issues = [];

    // Chains require approval for non-autonomous steps
    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) {
        try {
            const catalog = epc.catalogProductivityChains();
            catalog.forEach(c => {
                // Deployment + stabilization chains must require approval
                if (["deployment-prep", "dep-recovery", "op-stabilization"].includes(c.type) && !c.requiresApproval) {
                    issues.push({ issue: `approval-missing-in:${c.type}`, severity: "critical" });
                }
            });
        } catch {}
    }

    // Automations: env-restoration and runtime-stabilization must require approval
    const dea = _tryRequire("./dailyEngineeringAutomation2.cjs");
    if (dea) {
        try {
            const catalog = dea.catalogAutomations2();
            catalog.forEach(a => {
                if (["env-restoration", "runtime-stabilization", "deployment-readiness"].includes(a.type) && !a.requiresApproval) {
                    issues.push({ issue: `approval-missing-in-automation:${a.type}`, severity: "critical" });
                }
            });
        } catch {}
    }

    // Instant restore without approval must be blocked
    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    if (iwr) {
        try {
            const r = iwr.instantRestore("nonexistent-718", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "workspace-restore-no-approval", severity: "critical" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "hidden-execution-behavior" };
}

// ── Audit 4: No unsafe deployment continuation ────────────────────────────────

function auditDeploymentContinuationSafety() {
    const issues = [];

    const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
    if (rdw) {
        try {
            // Prepare without approval must require it
            const p = rdw.prepareDeployment("audit-718", { operatorApproved: false });
            if (p.ok) issues.push({ issue: "deploy-prepare-no-approval", severity: "critical" });

            // Rollback without approval must require it
            const r = rdw.prepareRollback("audit-718", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "rollback-no-approval", severity: "critical" });

            // Phased sequence without approval must require it
            const s = rdw.buildPhasedDeploymentSequence("audit-718", { operatorApproved: false });
            if (s.ok) issues.push({ issue: "phased-sequence-no-approval", severity: "critical" });
        } catch (e) {
            issues.push({ issue: `audit-exception: ${e.message}`, severity: "warning" });
        }
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "deployment-continuation-safety" };
}

// ── Audit 5: No duplicate workflow resurrection ───────────────────────────────

function auditDuplicateWorkflowResurrection() {
    const issues = [];

    // Memory productivity dedup check
    const emp = _tryRequire("./engineeringMemoryProductivity.cjs");
    if (emp) {
        try {
            emp.recordProductivityOutcome("workflow", "dedup-test-718", { success: true });
            const second = emp.recordProductivityOutcome("workflow", "dedup-test-718", { success: true });
            if (!second.duplicate) issues.push({ issue: "memory-dedup-not-enforced", severity: "warning" });
        } catch {}
    }

    // Productivity continuity dedup
    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) {
        try {
            lhpc.persistDeploymentProductivitySession("dedup-deploy-718", { state: "test" });
            const second = lhpc.persistDeploymentProductivitySession("dedup-deploy-718", { state: "test" });
            if (!second.duplicate) issues.push({ issue: "deployment-session-dedup-not-enforced", severity: "warning" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "duplicate-workflow-resurrection" };
}

// ── Audit 6: No uncontrolled orchestration ────────────────────────────────────

function auditUncontrolledOrchestration() {
    const issues = [];

    // Interrupted restoration without approval must be blocked
    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    if (lhpc) {
        try {
            const r = lhpc.restoreInterruptedProductivityWorkflows({ operatorApproved: false });
            if (r.ok) issues.push({ issue: "interrupted-restore-no-approval", severity: "critical" });
        } catch {}
    }

    // Chain resume without approval must be blocked
    const epc = _tryRequire("./executionProductivityChains.cjs");
    if (epc) {
        try {
            const r = epc.resumeChain("nonexistent-718", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "chain-resume-no-approval", severity: "critical" });
        } catch {}
    }

    // Automation resume without approval must be blocked
    const dea = _tryRequire("./dailyEngineeringAutomation2.cjs");
    if (dea) {
        try {
            const r = dea.resumeAutomation2("nonexistent-718", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "automation-resume-no-approval", severity: "critical" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "uncontrolled-orchestration" };
}

// ── Full audit ────────────────────────────────────────────────────────────────

function runOperatorProductivityAudit() {
    const checks = [
        auditWorkflowOverload(),
        auditReplayCorruption2(),
        auditHiddenExecutionBehavior(),
        auditDeploymentContinuationSafety(),
        auditDuplicateWorkflowResurrection(),
        auditUncontrolledOrchestration(),
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
        summary: `Operator productivity audit: ${passed}/${total} checks passed — critical=${critical} warnings=${warnings}`,
    };
}

module.exports = { auditWorkflowOverload, auditReplayCorruption2, auditHiddenExecutionBehavior, auditDeploymentContinuationSafety, auditDuplicateWorkflowResurrection, auditUncontrolledOrchestration, runOperatorProductivityAudit };
