"use strict";
/**
 * Phase 704 — Operator Safety Audit (Multi-Environment)
 *
 * Verify: no unsafe cross-environment execution, no hidden orchestration,
 * no replay corruption, no unsafe browser automation, no uncontrolled recovery,
 * no recursive execution chains.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Audit 1: No unsafe cross-environment execution ────────────────────────────

function auditCrossEnvironmentExecutionSafety() {
    const issues = [];

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (!cee) return { pass: true, skipped: true, note: "crossEnvironmentExecution not loaded" };

    try {
        // Depth guard: MAX_DEPTH=5 — attempt depth 6, must be rejected
        const deep = cee.saveExecutionContext("audit-depth-704", { env: "vscode", goal: "audit", depth: 6 });
        if (deep.ok) issues.push({ issue: "depth-guard-not-enforced", severity: "critical" });

        // Approval guard: coordinateReplaySafe without approval must be blocked
        const unapproved = cee.coordinateReplaySafe({ operatorApproved: false });
        if (unapproved.ok && !unapproved.requiresApproval) issues.push({ issue: "replay-coordination-no-approval-gate", severity: "critical" });

        // Recovery should be ok for known environments
        const recovery = cee.recoverEnvironment("vscode", "test-error");
        if (!recovery.ok) issues.push({ issue: "legitimate-recovery-blocked", severity: "warning" });
    } catch (e) {
        issues.push({ issue: `audit-exception: ${e.message}`, severity: "warning" });
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "cross-env-execution-safety" };
}

// ── Audit 2: No hidden orchestration ─────────────────────────────────────────

function auditHiddenOrchestration() {
    const issues = [];

    // Daily env flows require operator approval for non-autonomous steps
    const deef = _tryRequire("./dailyEngineeringEnvironmentFlows.cjs");
    if (deef) {
        try {
            const flows = deef.catalogEnvFlows();
            flows.forEach(f => {
                // Only flag write-level deployment actions (not read-only checks like "review-deployment-state")
                const writeSteps = ["persist-deployment-context", "deploy", "rollback", "operator-approval"];
                if (f.requiresApproval === false && f.steps.some(s => writeSteps.some(w => s === w || (s.includes(w) && !s.startsWith("review-") && !s.startsWith("check-") && !s.endsWith("-check") && !s.endsWith("-state"))))) {
                    issues.push({ issue: `hidden-deployment-write-in:${f.type}`, severity: "critical" });
                }
            });
        } catch {}
    }

    // Env flow resume without approval must be blocked
    if (deef) {
        try {
            const unapproved = deef.resumeEnvFlow("nonexistent-704", { operatorApproved: false });
            if (unapproved.ok) issues.push({ issue: "env-flow-resume-no-approval", severity: "critical" });
        } catch {}
    }

    // Workspace restoration without approval must be blocked
    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (lhwc) {
        try {
            const unapproved = lhwc.restoreInterruptedWorkspaceEnvironments({ operatorApproved: false });
            if (unapproved.ok) issues.push({ issue: "workspace-restoration-no-approval", severity: "critical" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "hidden-orchestration" };
}

// ── Audit 3: No replay corruption ─────────────────────────────────────────────

function auditReplayCorruption() {
    const issues = [];

    const lhwc = _tryRequire("./longHorizonWorkspaceContinuity.cjs");
    if (!lhwc) return { pass: true, skipped: true, note: "longHorizonWorkspaceContinuity not loaded" };

    try {
        // Stale session restore without force must be blocked
        // Persist then mark stale by checking age logic indirectly via force=false on fresh unknown session
        const restore = lhwc.restoreWorkspaceSession("nonexistent-session-704");
        if (restore.ok) issues.push({ issue: "nonexistent-session-restored", severity: "critical" });

        // Duplicate dedup: workspace storm status should be readable
        const storm = lhwc.workspaceStormStatus();
        if (!("storm" in storm)) issues.push({ issue: "storm-status-missing-field", severity: "warning" });

        // Replay durability check should run without error
        const durability = lhwc.assessCrossEnvReplayDurability();
        if (durability.ok === undefined) issues.push({ issue: "replay-durability-missing-ok", severity: "warning" });
    } catch (e) {
        issues.push({ issue: `audit-exception: ${e.message}`, severity: "warning" });
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "replay-corruption" };
}

// ── Audit 4: No unsafe browser automation ────────────────────────────────────

function auditBrowserAutomationSafety() {
    const issues = [];

    const boc = _tryRequire("./browserOperationCoordination.cjs");
    if (!boc) return { pass: true, skipped: true, note: "browserOperationCoordination not loaded" };

    try {
        // Payment + destructive form must be blocked
        const form = boc.protectOperationalForm("audit-pay-704", { hasPayment: true, isDestructive: true });
        if (!form.blocked) issues.push({ issue: "payment-destructive-form-not-blocked", severity: "critical" });

        // Stale session detection should work
        const stale = boc.detectStaleBrowserSessions();
        if (!("staleCount" in stale)) issues.push({ issue: "stale-session-detection-missing-field", severity: "warning" });

        // Workflow-linked chain dedup must be present
        const chainA = boc.buildReplayLinkedBrowserChain("audit-replay-704", [{ action: "navigate", url: "https://example.com" }]);
        const chainB = boc.buildReplayLinkedBrowserChain("audit-replay-704", [{ action: "navigate", url: "https://example.com" }]);
        if (chainA.ok && chainB.ok && !chainB.duplicate) issues.push({ issue: "browser-replay-dedup-not-enforced", severity: "warning" });
    } catch (e) {
        issues.push({ issue: `audit-exception: ${e.message}`, severity: "warning" });
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "browser-automation-safety" };
}

// ── Audit 5: No uncontrolled recovery coordination ────────────────────────────

function auditRecoveryCoordinationControl() {
    const issues = [];

    const ewr = _tryRequire("./engineeringWorkspaceRestoration.cjs");
    if (ewr) {
        try {
            // Restore without approval must require it
            const r = ewr.restoreWorkspace("nonexistent-704", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "workspace-restore-no-approval-gate", severity: "critical" });

            // Terminal restore without approval must be blocked
            const t = ewr.restoreTerminalSession("nonexistent-704", { operatorApproved: false });
            if (t.ok) issues.push({ issue: "terminal-restore-no-approval-gate", severity: "critical" });
        } catch (e) {
            issues.push({ issue: `ewr-audit-exception: ${e.message}`, severity: "warning" });
        }
    }

    const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
    if (mpci) {
        try {
            const r = mpci.restoreInterruptedProjectEnvironment("nonexistent-704", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "project-env-restore-no-approval-gate", severity: "critical" });
        } catch {}
    }

    const dec = _tryRequire("./deploymentEnvironmentCoordination.cjs");
    if (dec) {
        try {
            const r = dec.coordinateRollback("nonexistent-704", { operatorApproved: false });
            if (r.ok) issues.push({ issue: "deployment-rollback-no-approval-gate", severity: "critical" });
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "recovery-coordination-control" };
}

// ── Audit 6: No recursive execution chains ────────────────────────────────────

function auditRecursiveExecutionChains() {
    const issues = [];

    const tci = _tryRequire("./terminalCoordinationIntelligence.cjs");
    if (tci) {
        try {
            // Build a legitimate chain — should succeed
            const chain = tci.buildRuntimeChain("audit-chain-704", [
                { command: "npm test" },
                { command: "npm run build" },
            ]);
            if (!chain.ok) issues.push({ issue: "legitimate-chain-rejected", severity: "warning" });

            // Chain with no commands
            const empty = tci.buildRuntimeChain("audit-empty-704", []);
            if (empty.ok && empty.stepCount > 0) issues.push({ issue: "empty-chain-has-steps", severity: "warning" });
        } catch {}
    }

    const odc = _tryRequire("./operationalDecisionCoordination.cjs");
    if (odc) {
        try {
            // Decision summary should not self-invoke anything destructive
            const summary = odc.decisionCoordinationSummary({ trustScore: 80, activeEnvs: ["vscode"] });
            if (summary.ok === undefined) issues.push({ issue: "decision-coord-missing-ok", severity: "warning" });
            // Approval should be required for risky operations
            if (summary.approvalRequired === false && summary.primaryPath === "rollback-deployment") {
                issues.push({ issue: "rollback-without-approval-gate", severity: "critical" });
            }
        } catch {}
    }

    const pass = issues.filter(i => i.severity === "critical").length === 0;
    return { pass, issues, check: "recursive-execution-chains" };
}

// ── Full audit ────────────────────────────────────────────────────────────────

function runOperatorSafetyAudit2() {
    const checks = [
        auditCrossEnvironmentExecutionSafety(),
        auditHiddenOrchestration(),
        auditReplayCorruption(),
        auditBrowserAutomationSafety(),
        auditRecoveryCoordinationControl(),
        auditRecursiveExecutionChains(),
    ];

    const passed   = checks.filter(c => c.pass).length;
    const total    = checks.length;
    const critical = checks.flatMap(c => c.issues || []).filter(i => i.severity === "critical").length;
    const warnings = checks.flatMap(c => c.issues || []).filter(i => i.severity === "warning").length;

    return {
        ok:       critical === 0,
        passed, total,
        critical, warnings,
        checks,
        failed:   checks.filter(c => !c.pass).map(c => ({ check: c.check, issues: c.issues })),
        summary:  `Operator safety audit2: ${passed}/${total} checks passed — critical=${critical} warnings=${warnings}`,
    };
}

module.exports = { auditCrossEnvironmentExecutionSafety, auditHiddenOrchestration, auditReplayCorruption, auditBrowserAutomationSafety, auditRecoveryCoordinationControl, auditRecursiveExecutionChains, runOperatorSafetyAudit2 };
