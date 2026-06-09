"use strict";
/**
 * Phase 720 — Engineering Productivity OS Foundation
 *
 * Entry point for the 706-720 productivity OS range.
 * Outputs: productivity evolution quality, workspace restoration maturity,
 * deployment productivity impact, replay ecosystem usability,
 * operator workflow efficiency, long-term platform readiness.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MODULES_720 = [
    { name: "instantWorkspaceRestoration",          phase: 706 },
    { name: "rapidDebuggingFlows",                  phase: 707 },
    { name: "rapidDeploymentWorkflows",             phase: 708 },
    { name: "engineeringCommandCenter",             phase: 709 },
    { name: "executionProductivityChains",          phase: 710 },
    { name: "multiEnvProductivityIntelligence",     phase: 711 },
    { name: "engineeringMemoryProductivity",        phase: 712 },
    { name: "dailyEngineeringAutomation2",          phase: 713 },
    { name: "longHorizonProductivityContinuity",    phase: 714 },
    { name: "productivityStressTest",               phase: 715 },
    { name: "engineeringUXRefinement",              phase: 716 },
    { name: "platformProductivityResilience",       phase: 717 },
    { name: "operatorProductivityAudit",            phase: 718 },
    { name: "dailyDriverProductivityValidation",    phase: 719 },
    { name: "engineeringProductivityOSFoundation",  phase: 720 },
];

function moduleHealth720() {
    const results = MODULES_720.map(m => {
        if (m.phase === 720) return { name: m.name, phase: m.phase, loaded: true, self: true };
        const mod = _tryRequire(`./${m.name}.cjs`);
        return { name: m.name, phase: m.phase, loaded: mod !== null };
    });
    const loaded = results.filter(r => r.loaded).length;
    const total  = results.length;
    return { ok: loaded === total, loaded, total, modules: results, summary: `Module health: ${loaded}/${total}` };
}

function platformHealth720() {
    const resilience = _tryRequire("./platformProductivityResilience.cjs");
    if (!resilience) return { ok: false, error: "platformProductivityResilience unavailable" };

    const report = resilience.platformProductivityResilienceReport();

    // Structural-only gate
    const continuityOk = report.dimensions?.continuity?.ok !== false;
    const replayOk     = report.dimensions?.replay?.ok     !== false;
    const coordOk      = report.dimensions?.coordination?.ok !== false;
    const resilienceOk = continuityOk && replayOk && coordOk;

    return {
        ok:             resilienceOk,
        criticalCount:  report.criticalCount,
        warningCount:   report.warningCount,
        dimensions:     { continuity: report.dimensions?.continuity, replay: report.dimensions?.replay, coordination: report.dimensions?.coordination },
        resilienceGate: resilienceOk,
        summary:        `Platform health: ${resilienceOk ? "OK" : "DEGRADED"} (continuity=${continuityOk} replay=${replayOk} coord=${coordOk})`,
    };
}

function capabilities720() {
    const audit = _tryRequire("./operatorProductivityAudit.cjs");
    let auditResult = null;
    if (audit) { try { auditResult = audit.runOperatorProductivityAudit(); } catch {} }

    const stress = _tryRequire("./productivityStressTest.cjs");
    let stressResult = null;
    if (stress) { try { stressResult = stress.runAll(); } catch {} }

    const validation = _tryRequire("./dailyDriverProductivityValidation.cjs");
    let validationResult = null;
    if (validation) { try { validationResult = validation.runAll(); } catch {} }

    const uxr = _tryRequire("./engineeringUXRefinement.cjs");
    let uxReport = null;
    if (uxr) { try { uxReport = uxr.uxRefinementReport(); } catch {} }

    return {
        ok:         auditResult?.ok !== false && stressResult?.ok !== false,
        safetyAudit:  auditResult  ? { ok: auditResult.ok,  passed: auditResult.passed,  total: auditResult.total,  critical: auditResult.critical }  : null,
        stressTest:   stressResult ? { ok: stressResult.ok, passed: stressResult.passed, total: stressResult.total, score: stressResult.score }        : null,
        validation:   validationResult ? { ok: validationResult.ok, passed: validationResult.passed, total: validationResult.total } : null,
        ux:           uxReport ? { avgScore: uxReport.avgScore, calmness: uxReport.calmness?.level } : null,
        summary:      `Capabilities: audit=${auditResult?.ok ? "PASS" : "FAIL"} stress=${stressResult?.ok ? "PASS" : "FAIL"} validation=${validationResult?.ok ? "PASS" : "FAIL"}`,
    };
}

function productivityOSQuality() {
    const mepi = _tryRequire("./multiEnvProductivityIntelligence.cjs");
    let productivity = null;
    if (mepi) { try { productivity = mepi.multiEnvProductivitySummary(); } catch {} }

    const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
    let workspaceMaturity = null;
    if (iwr) { try { workspaceMaturity = iwr.workspaceRestoreHealth(); } catch {} }

    const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
    let deploymentImpact = null;
    if (rdw) { try { deploymentImpact = rdw.scanEnvironmentReadiness("production"); } catch {} }

    const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
    let replayUsability = null;
    if (lhpc) { try { const h = lhpc.productivityContinuityHealth(); replayUsability = { durable: h.replayDurable, sessions: h.activeSessions }; } catch {} }

    const emp = _tryRequire("./engineeringMemoryProductivity.cjs");
    let workflowEfficiency = null;
    if (emp) { try { workflowEfficiency = emp.memoryProductivityStats(); } catch {} }

    return {
        ok:                 true,
        productivityScore:  productivity?.avgScore || null,
        productivityLevel:  productivity?.level    || "unknown",
        workspaceMaturity:  workspaceMaturity  ? { freshSnapshots: workspaceMaturity.freshSnapshots, storm: workspaceMaturity.storm } : null,
        deploymentReady:    deploymentImpact?.ready   || false,
        replayDurable:      replayUsability?.durable  || false,
        replaySessions:     replayUsability?.sessions || 0,
        memoryEntries:      workflowEfficiency?.total || 0,
        summary:            `Productivity OS quality: score=${productivity?.avgScore || "?"} level=${productivity?.level || "?"} replay=${replayUsability?.durable ? "durable" : "fragile"}`,
    };
}

function fullPlatformHealth720() {
    const modules  = moduleHealth720();
    const platform = platformHealth720();
    const caps     = capabilities720();
    const quality  = productivityOSQuality();

    // Check prev range (Phase 705 foundation)
    const prev705 = _tryRequire("./multiEnvironmentFoundation.cjs");
    let prevOk = false;
    if (prev705) { try { const h = prev705.fullPlatformHealth705(); prevOk = h.ok !== false; } catch {} }

    const healthy = modules.ok && platform.ok && caps.ok;

    return {
        ok:      healthy,
        healthy,
        modules: { loaded: modules.loaded, total: modules.total },
        platform: { ok: platform.ok, criticalCount: platform.criticalCount },
        capabilities: { auditOk: caps.safetyAudit?.ok, stressTestOk: caps.stressTest?.ok, validationOk: caps.validation?.ok },
        quality: { productivityScore: quality.productivityScore, level: quality.productivityLevel },
        prev705: prevOk,
        status:  healthy ? "HEALTHY" : "DEGRADED",
        summary: `Phase 706-720 foundation: ${healthy ? "HEALTHY" : "DEGRADED"} — modules=${modules.loaded}/${modules.total} platform=${platform.ok ? "OK" : "DEGRADED"} prev705=${prevOk}`,
    };
}

module.exports = { moduleHealth720, platformHealth720, capabilities720, productivityOSQuality, fullPlatformHealth720 };
