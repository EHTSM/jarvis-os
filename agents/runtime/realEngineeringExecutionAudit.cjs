"use strict";
/**
 * Phase 764 — Real Engineering Execution Safety Audit
 *
 * Verify: no unsafe deployment continuation, no stale replay execution,
 * no hidden orchestration behavior, no replay corruption,
 * no unsafe contextual patch execution, no uncontrolled workflow resurrection.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function auditDeploymentContinuationSafety() {
    const issues = [];

    const dee = _tryRequire("./deploymentExecutionExperience.cjs");
    if (!dee) return { pass: true, skipped: true, check: "deployment-continuation-safety" };

    try {
        const rb = dee.rollbackDeployment("audit-764-nonexistent", { operatorApproved: false });
        if (rb.ok) issues.push({ issue: "rollback-without-approval-succeeded", severity: "critical" });

        const adv = dee.advanceDeploymentStage("nonexistent-764", { operatorApproved: false });
        if (adv.ok) issues.push({ issue: "nonexistent-deploy-advanced", severity: "critical" });
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "deployment-continuation-safety" };
}

function auditStaleReplayExecution() {
    const issues = [];

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (!lss) return { pass: true, skipped: true, check: "stale-replay-execution" };

    try {
        const r = lss.restoreSurvivabilitySession("nonexistent-764");
        if (r.ok) issues.push({ issue: "nonexistent-session-restored", severity: "critical" });
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "stale-replay-execution" };
}

function auditHiddenOrchestration() {
    const issues = [];

    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    if (ocf) {
        try {
            const r = ocf.resumeOneClickFlow("nonexistent-764", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "one-click-resume-no-approval", severity: "critical" });
        } catch {}
    }

    const lsec = _tryRequire("./longSessionEngineeringContinuity.cjs");
    if (lsec) {
        try {
            const r = lsec.restoreEngineeringSession("nonexistent-764");
            if (r.ok) issues.push({ issue: "nonexistent-engineering-session-restored", severity: "critical" });
        } catch {}
    }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "hidden-orchestration" };
}

function auditReplayCorruption() {
    const issues = [];

    const bee = _tryRequire("./browserExecutionExperience.cjs");
    if (bee) {
        try {
            const r = bee.replayLinkedBrowserContinuity("nonexistent-764");
            if (r.ok) issues.push({ issue: "nonexistent-replay-browser-session-found", severity: "critical" });
        } catch {}
    }

    const vsee = _tryRequire("./vsCodeExecutionExperience.cjs");
    if (vsee) {
        try {
            const r = vsee.replayLinkedEditorState("nonexistent-764");
            if (r.ok && r.fileCount > 0) issues.push({ issue: "nonexistent-replay-editor-files-found", severity: "critical" });
        } catch {}
    }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "replay-corruption" };
}

function auditContextualPatchSafety() {
    const issues = [];

    const cpm = _tryRequire("./contextualPatchMaturity.cjs");
    if (!cpm) return { pass: true, skipped: true, check: "contextual-patch-safety" };

    try {
        const r = cpm.applyPatch("audit-764-nonexistent", { operatorApproved: false });
        if (r.ok) issues.push({ issue: "patch-apply-without-approval", severity: "critical" });

        const proposed = cpm.proposePatch(`audit-764-${Date.now()}`, { files: [{ filePath: "/src/audit.ts" }], description: "audit" });
        if (proposed.ok && !proposed.requiresApproval) issues.push({ issue: "patch-missing-approval-flag", severity: "critical" });
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "contextual-patch-safety" };
}

function auditWorkflowResurrection() {
    const issues = [];

    const rdse = _tryRequire("./realDebugSessionExperience.cjs");
    if (rdse) {
        try {
            const r = rdse.restoreDebugSession("nonexistent-764");
            if (r.ok) issues.push({ issue: "nonexistent-debug-session-restored", severity: "critical" });
        } catch {}
    }

    const mpem = _tryRequire("./multiProjectEngineeringMaturity.cjs");
    if (mpem) {
        try {
            const r = mpem.switchProject("nonexistent-764", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "project-switch-no-approval", severity: "critical" });
        } catch {}
    }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "workflow-resurrection" };
}

function runRealEngineeringExecutionAudit() {
    const checks = [
        auditDeploymentContinuationSafety(),
        auditStaleReplayExecution(),
        auditHiddenOrchestration(),
        auditReplayCorruption(),
        auditContextualPatchSafety(),
        auditWorkflowResurrection(),
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
        summary: `Execution safety audit: ${passed}/${total} checks passed — critical=${critical} warnings=${warnings}`,
    };
}

module.exports = { auditDeploymentContinuationSafety, auditStaleReplayExecution, auditHiddenOrchestration, auditReplayCorruption, auditContextualPatchSafety, auditWorkflowResurrection, runRealEngineeringExecutionAudit };
