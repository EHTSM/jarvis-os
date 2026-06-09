"use strict";
/**
 * Phase 615 — Daily Engineering Foundation Complete
 *
 * Single entry-point for phases 601–615 (Real Daily Engineering Environment).
 * Reports: workflow maturity, trust, survivability, session continuity,
 * bootstrap health, daily audit, resilience.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MODULES_615 = {
    debugWorkflowEngine:          "./debugWorkflowEngine.cjs",
    deployWorkflowEngine:         "./deployWorkflowEngine.cjs",
    vscodeExecutionMaturity:      "./vscodeExecutionMaturity.cjs",
    browserWorkflowMaturity:      "./browserWorkflowMaturity.cjs",
    operationalTrustLayer:        "./operationalTrustLayer.cjs",
    workflowSurvivability:        "./workflowSurvivability.cjs",
    dailyProductivityDashboard:   "./dailyProductivityDashboard.cjs",
    engineeringEnvironmentHealth: "./engineeringEnvironmentHealth.cjs",
    executionReplaySystem:        "./executionReplaySystem.cjs",
    debugSessionContinuity:       "./debugSessionContinuity.cjs",
    deploymentSurvivabilityEngine:"./deploymentSurvivabilityEngine.cjs",
    environmentBootstrapHardening:"./environmentBootstrapHardening.cjs",
    resilienceTest615:            "./resilienceTest615.cjs",
    dailyEngineeringAudit:        "./dailyEngineeringAudit.cjs",
};

function moduleHealth615() {
    const results = {};
    for (const [name, p] of Object.entries(MODULES_615)) {
        results[name] = _tryRequire(p) !== null ? "ok" : "unavailable";
    }
    const available = Object.values(results).filter(v => v === "ok").length;
    return {
        available,
        total:   Object.keys(results).length,
        modules: results,
        healthy: available === Object.keys(results).length,
    };
}

function platformHealth615() {
    const health = moduleHealth615();
    const rt     = _tryRequire("./resilienceTest615.cjs");
    const audit  = _tryRequire("./dailyEngineeringAudit.cjs");
    const trust  = _tryRequire("./operationalTrustLayer.cjs");
    const surv   = _tryRequire("./workflowSurvivability.cjs");

    let resilience = null, auditResult = null, trustScore = null, survivability = null;
    if (rt)    try { resilience  = rt.runAll();           } catch {}
    if (audit) try { auditResult = audit.runAudit();      } catch {}
    if (trust) try { trustScore  = trust.getTrustScore(); } catch {}
    if (surv)  try { survivability = surv.survivabilityScore(); } catch {}

    // Morning briefing
    const dpd = _tryRequire("./dailyProductivityDashboard.cjs");
    let briefing = null;
    if (dpd) try { briefing = dpd.morningBriefing(); } catch {}

    const overallOk = health.healthy
        && (resilience   ? resilience.survivability   >= 75 : true)
        && (trustScore   ? trustScore.score            >= 45 : true)
        && (survivability ? survivability.score        >= 45 : true);

    return {
        platform:     "phases-601-615",
        ok:           overallOk,
        modules:      health,
        resilience:   resilience   ? { passed: resilience.passed,    total: resilience.total,  survivability: resilience.survivability } : null,
        audit:        auditResult  ? { passed: auditResult.passed,   total: auditResult.total, clean: auditResult.clean }                 : null,
        trust:        trustScore   ? { score: trustScore.score,      grade: trustScore.grade }                                            : null,
        survivability: survivability ? { score: survivability.score, grade: survivability.grade }                                         : null,
        briefing,
        summary:      _buildSummary(health, resilience, auditResult, trustScore),
    };
}

function _buildSummary(h, r, a, t) {
    const parts = [`Modules: ${h.available}/${h.total}`];
    if (r) parts.push(`Resilience: ${r.survivability}%`);
    if (a) parts.push(`Audit: ${a.passed}/${a.total}`);
    if (t) parts.push(`Trust: ${t.score}`);
    return parts.join(" | ");
}

function capabilities615() {
    return [
        { phase: 601, name: "Real Debugging Workflow Engine",    module: "debugWorkflowEngine",          features: ["full-lifecycle", "error-ingestion", "root-cause", "auto-plan"] },
        { phase: 602, name: "Real Deployment Workflow Engine",   module: "deployWorkflowEngine",         features: ["preflight", "approval-gate", "rollback", "phase-state"] },
        { phase: 603, name: "VS Code Execution Maturity",        module: "vscodeExecutionMaturity",      features: ["editor-context", "contextual-patch", "launch-configs", "chain-recommend"] },
        { phase: 604, name: "Browser Workflow Maturity",         module: "browserWorkflowMaturity",      features: ["auth-continuity", "extraction-validate", "health-score", "operator-view"] },
        { phase: 605, name: "Operational Trust Layer",           module: "operationalTrustLayer",        features: ["signal-recording", "trust-score", "operation-gating", "overrides"] },
        { phase: 606, name: "Workflow Survivability System",     module: "workflowSurvivability",        features: ["checkpoints", "interrupt-detection", "resume", "stale-detection"] },
        { phase: 607, name: "Daily Productivity Dashboard",      module: "dailyProductivityDashboard",   features: ["morning-briefing", "quick-status", "workflow-suggestions"] },
        { phase: 608, name: "Engineering Environment Health",    module: "engineeringEnvironmentHealth", features: ["env-scan", "process-health", "disk-memory", "git-check"] },
        { phase: 609, name: "Real Execution Replay System",      module: "executionReplaySystem",        features: ["record-replay", "execute-replay", "dedup-guard", "replay-diff"] },
        { phase: 610, name: "Debugging Session Continuity",      module: "debugSessionContinuity",       features: ["save-restore", "hypothesis-tracking", "14-day-ttl"] },
        { phase: 611, name: "Deployment Survivability Engine",   module: "deploymentSurvivabilityEngine",features: ["pre-deploy-snapshot", "phased-deploy", "rollback-recommend"] },
        { phase: 612, name: "Environment Bootstrap Hardening",   module: "environmentBootstrapHardening",features: ["dep-verify", "env-validate", "port-check", "data-dir-init"] },
        { phase: 613, name: "Platform Resilience Test 615",      module: "resilienceTest615",            features: ["8-tests", "survivability-score"] },
        { phase: 614, name: "Daily Engineering Audit",           module: "dailyEngineeringAudit",        features: ["7-checks", "recommendations", "end-of-day-summary"] },
        { phase: 615, name: "Daily Engineering Foundation",      module: "dailyEngineeringFoundation",   features: ["full-health-601-615", "capabilities", "combined-view"] },
    ];
}

/**
 * Combined health report for the full 571–615 platform.
 */
function fullPlatformHealth() {
    const h600 = (() => { try { return _tryRequire("./operatorEngineeringPlatform.cjs")?.fullPlatformHealth(); } catch {} return null; })();
    const h615 = platformHealth615();

    return {
        platform:     "phases-571-615",
        ok:           (h600?.ok !== false) && h615.ok,
        phase571_600: h600 ? { ok: h600.ok, summary: h600.summary } : null,
        phase601_615: { ok: h615.ok, summary: h615.summary },
        summary:      [h600?.summary, h615.summary].filter(Boolean).join(" // "),
    };
}

module.exports = { moduleHealth615, platformHealth615, capabilities615, fullPlatformHealth };
