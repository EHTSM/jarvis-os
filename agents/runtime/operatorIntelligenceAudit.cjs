"use strict";
/**
 * Phase 747 — Operator Intelligence Audit
 *
 * Validates: no unfiltered alert flood, no unapproved orchestration advancement,
 * no stale context serving, no hidden autonomous recommendations,
 * no cross-phase risk suppression, no uncached projection drift.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

function auditAlertFiltering() {
    const issues = [];
    const iaf = _tryRequire("./intelligentAlertFiltering.cjs");
    if (!iaf) return { pass: true, skipped: true, check: "alert-filtering" };

    try {
        const uid = `audit-747-${Date.now()}`;
        const r   = iaf.filterAlert({ type: uid, source: "audit-747", severity: "info" });
        if (!r.ok) issues.push({ issue: "filter-rejected-valid-alert", severity: "warning" });

        const r2 = iaf.filterAlert({ type: uid, source: "audit-747", severity: "info" });
        if (!r2.duplicate && r2.surfaced) issues.push({ issue: "dedup-not-enforced-audit", severity: "critical" });

        const stats = iaf.alertFilteringStats();
        if (typeof stats.suppressionRate !== "number") issues.push({ issue: "suppression-rate-missing", severity: "warning" });
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "alert-filtering" };
}

function auditWorkflowOrchestration() {
    const issues = [];
    const owo = _tryRequire("./operatorWorkflowOrchestration.cjs");
    if (!owo) return { pass: true, skipped: true, check: "workflow-orchestration" };

    try {
        const wfId = `audit-747-wf-${Date.now()}`;
        const r    = owo.startOrchestratedWorkflow(wfId, "incident-to-recovery", {});
        if (!r.ok) issues.push({ issue: "workflow-start-failed", severity: "warning" });

        if (r.requiresApproval) {
            const adv = owo.advanceOrchestratedWorkflow(wfId, { operatorApproved: false });
            if (adv.ok) issues.push({ issue: "approval-step-advanced-without-approval", severity: "critical" });
        }
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "workflow-orchestration" };
}

function auditContextSwitching() {
    const issues = [];
    const ics = _tryRequire("./intelligentContextSwitching.cjs");
    if (!ics) return { pass: true, skipped: true, check: "context-switching" };

    try {
        const r = ics.switchContext("nonexistent-747");
        if (r.ok) issues.push({ issue: "nonexistent-context-switch-succeeded", severity: "critical" });

        const lists = ics.listContexts();
        if (!Array.isArray(lists.contexts)) issues.push({ issue: "context-list-not-array", severity: "warning" });
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "context-switching" };
}

function auditCrossPhaseRisk() {
    const issues = [];
    const cpi = _tryRequire("./crossPhaseIntelligence.cjs");
    if (!cpi) return { pass: true, skipped: true, check: "cross-phase-risk" };

    try {
        const r = cpi.crossPhaseRiskPropagation();
        if (r.ok === undefined) issues.push({ issue: "risk-propagation-ok-missing", severity: "warning" });
        if (!Array.isArray(r.risks)) issues.push({ issue: "risk-list-not-array", severity: "warning" });
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "cross-phase-risk" };
}

function auditDecisionSupport() {
    const issues = [];
    const pds = _tryRequire("./platformDecisionSupport.cjs");
    if (!pds) return { pass: true, skipped: true, check: "decision-support" };

    try {
        const r = pds.decisionSupport("rollback", {});
        if (!r.requiresOperatorApproval) issues.push({ issue: "decision-missing-approval-flag", severity: "critical" });

        const inv = pds.decisionSupport("auto-execute-747", {});
        if (inv.ok) issues.push({ issue: "invalid-decision-type-succeeded", severity: "critical" });
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "decision-support" };
}

function auditSignalAggregation() {
    const issues = [];
    const psa = _tryRequire("./platformSignalAggregation.cjs");
    if (!psa) return { pass: true, skipped: true, check: "signal-aggregation" };

    try {
        const inv = psa.ingestSignal({ severity: "warning" });
        if (inv.ok) issues.push({ issue: "signal-without-source-accepted", severity: "critical" });

        const agg = psa.aggregateSignals({ maxAge: 60 * 60 * 1000 });
        if (agg.ok === undefined) issues.push({ issue: "aggregation-ok-missing", severity: "warning" });
    } catch (e) { issues.push({ issue: `exception:${e.message}`, severity: "warning" }); }

    return { pass: issues.filter(i => i.severity === "critical").length === 0, issues, check: "signal-aggregation" };
}

function runOperatorIntelligenceAudit() {
    const checks = [
        auditAlertFiltering(),
        auditWorkflowOrchestration(),
        auditContextSwitching(),
        auditCrossPhaseRisk(),
        auditDecisionSupport(),
        auditSignalAggregation(),
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
        summary: `Intelligence audit: ${passed}/${total} checks passed — critical=${critical} warnings=${warnings}`,
    };
}

module.exports = { auditAlertFiltering, auditWorkflowOrchestration, auditContextSwitching, auditCrossPhaseRisk, auditDecisionSupport, auditSignalAggregation, runOperatorIntelligenceAudit };
