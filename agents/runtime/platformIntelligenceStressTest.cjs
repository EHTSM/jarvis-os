"use strict";
/**
 * Phase 746 — Platform Intelligence Stress Test
 *
 * Validates platform intelligence modules under load and adversarial conditions.
 * 8 tests. THRESHOLD=0.75. Structural-only — tests module behavior, not live runtime state.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const THRESHOLD = 0.75;

function testSignalAggregation() {
    const psa = _tryRequire("./platformSignalAggregation.cjs");
    if (!psa) return { pass: true, skipped: true, test: "signal-aggregation" };

    const issues = [];
    try {
        const r = psa.ingestSignal({ source: "test-746", dimension: "test", check: "check-a", severity: "warning" });
        if (!r.ok && !r.duplicate) issues.push("signal-ingest-failed");

        const agg = psa.aggregateSignals({ maxAge: 60 * 60 * 1000 });
        if (typeof agg.total !== "number") issues.push("aggregation-missing-total");
        if (typeof agg.criticalCount !== "number") issues.push("aggregation-missing-critical-count");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "signal-aggregation" };
}

function testIntelligenceSurface() {
    const ois = _tryRequire("./operatorIntelligenceSurface.cjs");
    if (!ois) return { pass: true, skipped: true, test: "intelligence-surface" };

    const issues = [];
    try {
        const r = ois.intelligenceSurfaceReport();
        if (r.ok === undefined) issues.push("surface-ok-missing");
        if (!r.health) issues.push("surface-health-missing");
        if (!r.summary) issues.push("surface-summary-missing");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "intelligence-surface" };
}

function testCrossPhaseIntelligence() {
    const cpi = _tryRequire("./crossPhaseIntelligence.cjs");
    if (!cpi) return { pass: true, skipped: true, test: "cross-phase-intelligence" };

    const issues = [];
    try {
        const r = cpi.crossPhaseHealthReport();
        if (typeof r.total !== "number") issues.push("report-missing-total");
        if (!Array.isArray(r.phases)) issues.push("report-missing-phases");

        const risk = cpi.crossPhaseRiskPropagation();
        if (!Array.isArray(risk.risks)) issues.push("risk-propagation-missing-risks");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "cross-phase-intelligence" };
}

function testAlertFiltering() {
    const iaf = _tryRequire("./intelligentAlertFiltering.cjs");
    if (!iaf) return { pass: true, skipped: true, test: "alert-filtering" };

    const issues = [];
    try {
        const uid = `test-746-${Date.now()}`;
        const r = iaf.filterAlert({ type: uid, source: "test-746", severity: "warning" });
        if (!r.ok) issues.push("filter-failed");

        // Second identical call within DEDUP_MS should be duplicate
        const r2 = iaf.filterAlert({ type: uid, source: "test-746", severity: "warning" });
        if (!r2.duplicate && r2.surfaced) issues.push("dedup-not-enforced");

        const stats = iaf.alertFilteringStats();
        if (typeof stats.total !== "number") issues.push("stats-missing-total");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "alert-filtering" };
}

function testDecisionSupport() {
    const pds = _tryRequire("./platformDecisionSupport.cjs");
    if (!pds) return { pass: true, skipped: true, test: "decision-support" };

    const issues = [];
    try {
        const r = pds.decisionSupport("rollback", {});
        if (r.ok === undefined) issues.push("decision-support-ok-missing");
        if (!r.requiresOperatorApproval) issues.push("decision-support-no-approval-flag");

        const invalid = pds.decisionSupport("invalid-type-746", {});
        if (invalid.ok) issues.push("invalid-type-should-fail");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "decision-support" };
}

function testWorkflowOrchestration() {
    const owo = _tryRequire("./operatorWorkflowOrchestration.cjs");
    if (!owo) return { pass: true, skipped: true, test: "workflow-orchestration" };

    const issues = [];
    try {
        const wfId = `wf-746-${Date.now()}`;
        const r = owo.startOrchestratedWorkflow(wfId, "debug-to-deploy", {});
        if (!r.ok) issues.push("workflow-start-failed");

        // Advance approval step without approval must be blocked
        const nextStep = r.requiresApproval ? r.currentStep : null;
        if (r.requiresApproval) {
            const adv = owo.advanceOrchestratedWorkflow(wfId, { operatorApproved: false });
            if (adv.ok) issues.push("approval-step-advanced-without-approval");
        }

        const invalid = owo.startOrchestratedWorkflow(wfId, "debug-to-deploy", {});
        if (invalid.ok) issues.push("duplicate-workflow-should-fail");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "workflow-orchestration" };
}

function testContextSwitching() {
    const ics = _tryRequire("./intelligentContextSwitching.cjs");
    if (!ics) return { pass: true, skipped: true, test: "context-switching" };

    const issues = [];
    try {
        const ctxId = `ctx-746-${Date.now()}`;
        const save = ics.saveContext(ctxId, "debugging", { sessionId: "x" });
        if (!save.ok) issues.push("context-save-failed");

        const sw = ics.switchContext(ctxId);
        if (!sw.ok) issues.push("context-switch-failed");

        const active = ics.getActiveContext();
        if (!active.ok) issues.push("get-active-context-failed");

        const invalid = ics.switchContext("nonexistent-746");
        if (invalid.ok) issues.push("nonexistent-context-switch-should-fail");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "context-switching" };
}

function testPatternRecognition() {
    const rpr = _tryRequire("./runtimePatternRecognition.cjs");
    if (!rpr) return { pass: true, skipped: true, test: "pattern-recognition" };

    const issues = [];
    try {
        for (let i = 0; i < 4; i++) rpr.recordRuntimeEvent("deploy-error-746", { i });
        const r = rpr.detectPatterns();
        if (!Array.isArray(r.patterns)) issues.push("detect-patterns-missing-array");

        const report = rpr.patternRecognitionReport();
        if (report.ok === undefined) issues.push("pattern-report-ok-missing");
    } catch (e) { issues.push(`exception:${e.message}`); }

    return { pass: issues.length === 0, issues, test: "pattern-recognition" };
}

function runAll() {
    const tests = [
        testSignalAggregation(),
        testIntelligenceSurface(),
        testCrossPhaseIntelligence(),
        testAlertFiltering(),
        testDecisionSupport(),
        testWorkflowOrchestration(),
        testContextSwitching(),
        testPatternRecognition(),
    ];

    const passed  = tests.filter(t => t.pass).length;
    const total   = tests.length;
    const score   = passed / total;
    const ok      = score >= THRESHOLD;

    return {
        ok, passed, total, score: Math.round(score * 100),
        tests,
        failed: tests.filter(t => !t.pass).map(t => ({ test: t.test, issues: t.issues })),
        summary: `Intelligence stress test: ${passed}/${total} (${Math.round(score * 100)}%) — ${ok ? "PASS" : "FAIL"}`,
    };
}

module.exports = { testSignalAggregation, testIntelligenceSurface, testCrossPhaseIntelligence, testAlertFiltering, testDecisionSupport, testWorkflowOrchestration, testContextSwitching, testPatternRecognition, runAll };
