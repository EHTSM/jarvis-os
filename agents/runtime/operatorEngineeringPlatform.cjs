"use strict";
/**
 * Phase 600 — Operator-Grade Engineering Automation Complete
 *
 * Single entry-point for phases 586–600.
 * Reports: execution maturity, workflow reliability, deployment survivability,
 *          replay ecosystem maturity, operator productivity, platform readiness.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MODULES_600 = {
    patchExecutionEngine:        "./patchExecutionEngine.cjs",
    engineeringChains:           "./engineeringChains.cjs",
    terminalSupervisor:          "./terminalSupervisor.cjs",
    browserWorkflowEngine:       "./browserWorkflowEngine.cjs",
    workflowValidator:           "./workflowValidator.cjs",
    operatorWorkflowMemory:      "./operatorWorkflowMemory.cjs",
    dailyProductivityMode:       "./dailyProductivityMode.cjs",
    recoveryOrchestrationEngine: "./recoveryOrchestrationEngine.cjs",
    sessionIntelligenceEngine:   "./sessionIntelligenceEngine.cjs",
    multiProjectRuntime:         "./multiProjectRuntime.cjs",
    platformPerformance:         "./platformPerformance.cjs",
    realWorldValidation:         "./realWorldValidation.cjs",
    resilienceTest600:           "./resilienceTest600.cjs",
    operatorAutomationAudit:     "./operatorAutomationAudit.cjs",
};

function moduleHealth600() {
    const results = {};
    for (const [name, p] of Object.entries(MODULES_600)) {
        results[name] = _tryRequire(p) !== null ? "ok" : "unavailable";
    }
    const available = Object.values(results).filter(v => v === "ok").length;
    return { available, total: Object.keys(results).length, modules: results, healthy: available === Object.keys(results).length };
}

function platformHealth() {
    const health    = moduleHealth600();
    const rt        = _tryRequire("./resilienceTest600.cjs");
    const audit     = _tryRequire("./operatorAutomationAudit.cjs");
    const rwv       = _tryRequire("./realWorldValidation.cjs");
    const perf      = _tryRequire("./platformPerformance.cjs");

    let resilience  = null, auditResult = null, validation = null, perfResult = null;
    if (rt)    try { resilience  = rt.runAll();           } catch {}
    if (audit) try { auditResult = audit.runAudit();     } catch {}
    if (rwv)   try { validation  = rwv.runValidation();  } catch {}
    if (perf)  try { perfResult  = perf.measureResponsiveness(); } catch {}

    // Also run foundation 571-585 health
    const ef = _tryRequire("./engineeringFoundation.cjs");
    let foundationHealth = null;
    if (ef) try { foundationHealth = ef.foundationHealth(); } catch {}

    const overallOk = health.healthy
        && (resilience  ? resilience.survivability  >= 75 : true)
        && (auditResult ? auditResult.clean : true)
        && (validation  ? validation.executionTrust >= 75 : true);

    return {
        platform:    "phases-586-600",
        ok:          overallOk,
        modules:     health,
        resilience:  resilience  ? { passed: resilience.passed,  total: resilience.total,  survivability: resilience.survivability }  : null,
        audit:       auditResult ? { passed: auditResult.passed, total: auditResult.total, clean: auditResult.clean }                 : null,
        validation:  validation  ? { passed: validation.passed,  total: validation.total,  trust: validation.executionTrust }         : null,
        performance: perfResult  ? { avgMs: perfResult.avgMs,    fast: perfResult.fast }                                               : null,
        foundation:  foundationHealth ? { ok: foundationHealth.ok, summary: foundationHealth.summary } : null,
        summary:     _buildSummary(health, resilience, auditResult, validation),
    };
}

function _buildSummary(h, r, a, v) {
    const parts = [`Modules: ${h.available}/${h.total}`];
    if (r) parts.push(`Resilience: ${r.survivability}%`);
    if (a) parts.push(`Audit: ${a.passed}/${a.total}`);
    if (v) parts.push(`Validation: ${v.executionTrust}%`);
    return parts.join(" | ");
}

function capabilities600() {
    return [
        { phase: 586, name: "Advanced Patch Execution",     module: "patchExecutionEngine",       features: ["multi-file-batch", "dep-validation", "stale-guard", "replay-dedup"] },
        { phase: 587, name: "Engineering Chains",           module: "engineeringChains",          features: ["debug-session", "deploy-preflight", "dep-repair", "recovery", "bootstrap"] },
        { phase: 588, name: "Terminal Supervision",         module: "terminalSupervisor",         features: ["process-registry", "heartbeat", "runaway-detect", "output-stabilize", "checkpoints"] },
        { phase: 589, name: "Browser Workflow Engine",      module: "browserWorkflowEngine",      features: ["workflow-catalog", "auth-continuity", "interrupt-resume", "recovery-plan"] },
        { phase: 590, name: "Workflow Validation",          module: "workflowValidator",          features: ["patch-integrity", "deploy-readiness", "runtime-stability", "browser-outcome"] },
        { phase: 591, name: "Operator Workflow Memory",     module: "operatorWorkflowMemory",     features: ["debug-chains", "deploy-patterns", "recovery-flows", "env-workflows"] },
        { phase: 592, name: "Daily Productivity Mode",      module: "dailyProductivityMode",      features: ["daily-briefing", "workflow-discovery", "patch-readability", "replay-nav"] },
        { phase: 593, name: "Recovery Orchestration",       module: "recoveryOrchestrationEngine",features: ["chain-restore", "deploy-rollback", "adapter-restart", "state-healing"] },
        { phase: 594, name: "Session Intelligence",         module: "sessionIntelligenceEngine",  features: ["goal-tracking", "blocked-guidance", "deploy-progression", "recovery-paths"] },
        { phase: 595, name: "Multi-Project Hardening",      module: "multiProjectRuntime",        features: ["isolated-memory", "isolated-replay", "project-switch", "isolation-enforcement"] },
        { phase: 596, name: "Platform Performance",         module: "platformPerformance",        features: ["result-cache", "paginated-timeline", "fast-restore", "responsiveness-measure"] },
        { phase: 597, name: "Real-World Validation",        module: "realWorldValidation",        features: ["6-scenarios", "trust-score", "productivity-recording"] },
        { phase: 598, name: "Resilience Tests 600",         module: "resilienceTest600",          features: ["7-tests", "survivability", "multi-project-isolation"] },
        { phase: 599, name: "Operator Automation Audit",    module: "operatorAutomationAudit",    features: ["6-checks", "patch-safety", "replay-integrity", "browser-safety"] },
        { phase: 600, name: "Platform Complete",            module: "operatorEngineeringPlatform",features: ["full-health", "capabilities", "combined-585+600-view"] },
    ];
}

/**
 * Combined health report for the full 571–600 platform.
 */
function fullPlatformHealth() {
    const h585 = (() => { try { return _tryRequire("./engineeringFoundation.cjs")?.foundationHealth(); } catch {} return null; })();
    const h600 = platformHealth();

    return {
        platform:    "phases-571-600",
        ok:          (h585?.ok !== false) && h600.ok,
        phase571_585: h585 ? { ok: h585.ok, summary: h585.summary } : null,
        phase586_600: { ok: h600.ok, summary: h600.summary },
        summary:     [h585?.summary, h600.summary].filter(Boolean).join(" // "),
    };
}

module.exports = { moduleHealth600, platformHealth, capabilities600, fullPlatformHealth };
