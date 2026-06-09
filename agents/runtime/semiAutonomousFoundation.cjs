"use strict";
/**
 * Phase 630 — Semi-Autonomous Engineering Foundation Complete
 *
 * Single entry-point for phases 616–630 (Semi-Autonomous Engineering Operator).
 * Reports: autonomous workflow maturity, execution trust evolution, deployment
 * survivability, replay ecosystem quality, operator productivity improvements,
 * long-term platform readiness.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MODULES_630 = {
    autonomousDebugChains:          "./autonomousDebugChains.cjs",
    autonomousPatchPrep:            "./autonomousPatchPrep.cjs",
    engineeringGoalExecution:       "./engineeringGoalExecution.cjs",
    autonomousTerminalOrchestration:"./autonomousTerminalOrchestration.cjs",
    autonomousBrowserWorkflows:     "./autonomousBrowserWorkflows.cjs",
    operationalDecisionEngine:      "./operationalDecisionEngine.cjs",
    executionTrustEvolution:        "./executionTrustEvolution.cjs",
    engineeringMemoryEvolution:     "./engineeringMemoryEvolution.cjs",
    dailyEngineeringAutomation:     "./dailyEngineeringAutomation.cjs",
    longHorizonContinuity:          "./longHorizonContinuity.cjs",
    semiAutonomousStressTest:       "./semiAutonomousStressTest.cjs",
    operatorProductivityEvolution:  "./operatorProductivityEvolution.cjs",
    platformSurvivabilityAudit:     "./platformSurvivabilityAudit.cjs",
    dailyDriverValidation:          "./dailyDriverValidation.cjs",
};

function moduleHealth630() {
    const results = {};
    for (const [name, p] of Object.entries(MODULES_630)) {
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

function platformHealth630() {
    const health   = moduleHealth630();
    const stress   = _tryRequire("./semiAutonomousStressTest.cjs");
    const audit    = _tryRequire("./platformSurvivabilityAudit.cjs");
    const ddv      = _tryRequire("./dailyDriverValidation.cjs");
    const ete      = _tryRequire("./executionTrustEvolution.cjs");
    const ope      = _tryRequire("./operatorProductivityEvolution.cjs");

    let stressResult = null, auditResult = null, driverResult = null, trustConf = null, productivity = null;

    if (stress) try { stressResult = stress.runAll(); } catch {}
    if (audit)  try { auditResult  = audit.runAudit(); } catch {}
    if (ddv)    try { driverResult  = ddv.runValidation(); } catch {}
    if (ete)    try { trustConf    = ete.confidenceSummary(); } catch {}
    if (ope)    try { productivity  = ope.productivitySummary(); } catch {}

    // Foundation from 601-615
    const ef615 = _tryRequire("./dailyEngineeringFoundation.cjs");
    let foundation = null;
    if (ef615) try { foundation = ef615.platformHealth615(); } catch {}

    const overallOk = health.healthy
        && (stressResult ? stressResult.survivability  >= 75 : true)
        && (auditResult  ? auditResult.clean           : true)
        && (driverResult ? driverResult.usability      >= 70 : true);

    return {
        platform:    "phases-616-630",
        ok:          overallOk,
        modules:     health,
        stress:      stressResult  ? { passed: stressResult.passed,  total: stressResult.total,  survivability: stressResult.survivability } : null,
        audit:       auditResult   ? { passed: auditResult.passed,   total: auditResult.total,   clean: auditResult.clean }                  : null,
        driver:      driverResult  ? { passed: driverResult.passed,  total: driverResult.total,  usability: driverResult.usability }         : null,
        trust:       trustConf     ? { overall: trustConf.overall,   trend: trustConf.trustTrend }                                          : null,
        productivity: productivity ? { fatigue: productivity.fatigue, summary: productivity.summary }                                       : null,
        foundation:  foundation    ? { ok: foundation.ok, summary: foundation.summary }                                                     : null,
        summary:     _buildSummary(health, stressResult, auditResult, driverResult),
    };
}

function _buildSummary(h, s, a, d) {
    const parts = [`Modules: ${h.available}/${h.total}`];
    if (s) parts.push(`Stress: ${s.survivability}%`);
    if (a) parts.push(`Audit: ${a.passed}/${a.total}`);
    if (d) parts.push(`Driver: ${d.usability}%`);
    return parts.join(" | ");
}

function capabilities630() {
    return [
        { phase: 616, name: "Safe Autonomous Debug Chains",       module: "autonomousDebugChains",          features: ["bounded-depth-8", "interrupt-safe", "operator-visibility", "approval-gates"] },
        { phase: 617, name: "Autonomous Patch Preparation",       module: "autonomousPatchPrep",            features: ["mandatory-approval", "trust-gate", "stale-detection", "dedup"] },
        { phase: 618, name: "Engineering Goal Execution",         module: "engineeringGoalExecution",       features: ["goal-matching", "explain-reasoning", "validate-outcomes", "summary"] },
        { phase: 619, name: "Autonomous Terminal Orchestration",  module: "autonomousTerminalOrchestration",features: ["blocked-patterns", "approval-required", "restart-limits", "checkpoint"] },
        { phase: 620, name: "Autonomous Browser Workflows",       module: "autonomousBrowserWorkflows",     features: ["anti-dedup", "submit-blocked", "interrupt-safe", "auth-continuity"] },
        { phase: 621, name: "Operational Decision Engine",        module: "operationalDecisionEngine",      features: ["recovery-paths", "rollback-recommend", "unsafe-detection", "explainable"] },
        { phase: 622, name: "Execution Trust Evolution",          module: "executionTrustEvolution",        features: ["trust-progression", "autonomy-safety", "daily-snapshot", "confidence-summary"] },
        { phase: 623, name: "Engineering Memory Evolution",       module: "engineeringMemoryEvolution",     features: ["prioritized-recall", "hit-tracking", "stale-pruning", "21-day-ttl"] },
        { phase: 624, name: "Daily Engineering Automation",       module: "dailyEngineeringAutomation",     features: ["5-automations", "replayable", "interrupt-safe", "operator-controlled"] },
        { phase: 625, name: "Long-Horizon Session Continuity",    module: "longHorizonContinuity",          features: ["14-day-ttl", "stale-guard", "reconnect-storm-detect", "dedup-recovery"] },
        { phase: 626, name: "Semi-Autonomous Stress Test",        module: "semiAutonomousStressTest",       features: ["8-tests", "reconnect-storm", "browser-instability", "replay-dedup"] },
        { phase: 627, name: "Operator Productivity Evolution",    module: "operatorProductivityEvolution",  features: ["debug-speed", "deploy-flow", "replay-readability", "fatigue-score"] },
        { phase: 628, name: "Platform Survivability Audit",       module: "platformSurvivabilityAudit",     features: ["7-checks", "no-runaway", "no-hidden-patch", "approval-discipline"] },
        { phase: 629, name: "Daily-Driver Engineering Validation",module: "dailyDriverValidation",          features: ["7-scenarios", "usability-score", "workflow-trust", "productivity"] },
        { phase: 630, name: "Semi-Autonomous Foundation Complete",module: "semiAutonomousFoundation",       features: ["full-health-616-630", "capabilities", "combined-571-630-view"] },
    ];
}

/**
 * Combined health report for the full 571–630 platform.
 */
function fullPlatformHealth() {
    const h615 = (() => { try { return _tryRequire("./dailyEngineeringFoundation.cjs")?.fullPlatformHealth(); } catch {} return null; })();
    const h630 = platformHealth630();

    return {
        platform:     "phases-571-630",
        ok:           (h615?.ok !== false) && h630.ok,
        phase571_615: h615 ? { ok: h615.ok, summary: h615.summary } : null,
        phase616_630: { ok: h630.ok, summary: h630.summary },
        summary:      [h615?.summary, h630.summary].filter(Boolean).join(" // "),
    };
}

module.exports = { moduleHealth630, platformHealth630, capabilities630, fullPlatformHealth };
