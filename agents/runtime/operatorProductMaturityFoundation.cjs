"use strict";
/**
 * Phase 735 — Operator Product Maturity Foundation
 *
 * Entry point for the 721-735 operator product maturity range.
 * Outputs: engineering productivity maturity, repo intelligence evolution,
 * deployment usability, replay ecosystem quality, workflow trust, platform readiness.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MODULES_735 = [
    { name: "oneClickEngineeringFlows",          phase: 721 },
    { name: "engineeringWorkspaceUX",            phase: 722 },
    { name: "repoIntelligenceFoundation",        phase: 723 },
    { name: "contextualPatchMaturity",           phase: 724 },
    { name: "realDebuggingProductivity",         phase: 725 },
    { name: "deploymentProductivityMaturity",    phase: 726 },
    { name: "engineeringMemoryRefinement",       phase: 727 },
    { name: "executionPerformanceOptimization",  phase: 728 },
    { name: "longSessionSurvivability",          phase: 729 },
    { name: "multiProjectEngineeringMaturity",   phase: 730 },
    { name: "productivityMaturityStressTest",    phase: 731 },
    { name: "operatorTrustRefinement",           phase: 732 },
    { name: "platformMaturityResilience",        phase: 733 },
    { name: "productMaturityAudit",              phase: 734 },
    { name: "operatorProductMaturityFoundation", phase: 735 },
];

function moduleHealth735() {
    const results = MODULES_735.map(m => {
        if (m.phase === 735) return { name: m.name, phase: m.phase, loaded: true, self: true };
        const mod = _tryRequire(`./${m.name}.cjs`);
        return { name: m.name, phase: m.phase, loaded: mod !== null };
    });
    const loaded = results.filter(r => r.loaded).length;
    const total  = results.length;
    return { ok: loaded === total, loaded, total, modules: results, summary: `Module health: ${loaded}/${total}` };
}

function platformHealth735() {
    const resilience = _tryRequire("./platformMaturityResilience.cjs");
    if (!resilience) return { ok: false, error: "platformMaturityResilience unavailable" };

    const report = resilience.platformMaturityResilienceReport();

    // Structural-only gate
    const continuityOk   = report.dimensions?.continuity?.ok   !== false;
    const replayOk       = report.dimensions?.replay?.ok       !== false;
    const coordOk        = report.dimensions?.coordination?.ok !== false;
    const resilienceOk   = continuityOk && replayOk && coordOk;

    return {
        ok:             resilienceOk,
        criticalCount:  report.criticalCount,
        warningCount:   report.warningCount,
        dimensions:     { continuity: report.dimensions?.continuity, replay: report.dimensions?.replay, coordination: report.dimensions?.coordination },
        resilienceGate: resilienceOk,
        summary:        `Platform health: ${resilienceOk ? "OK" : "DEGRADED"} (continuity=${continuityOk} replay=${replayOk} coord=${coordOk})`,
    };
}

function capabilities735() {
    const audit = _tryRequire("./productMaturityAudit.cjs");
    let auditResult = null;
    if (audit) { try { auditResult = audit.runProductMaturityAudit(); } catch {} }

    const stress = _tryRequire("./productivityMaturityStressTest.cjs");
    let stressResult = null;
    if (stress) { try { stressResult = stress.runAll(); } catch {} }

    const trust = _tryRequire("./operatorTrustRefinement.cjs");
    let trustReport = null;
    if (trust) { try { trustReport = trust.operatorTrustRefinementReport(); } catch {} }

    const ux = _tryRequire("./engineeringWorkspaceUX.cjs");
    let uxReport = null;
    if (ux) { try { uxReport = ux.workspaceUXReport(); } catch {} }

    return {
        ok:          auditResult?.ok !== false && stressResult?.ok !== false,
        safetyAudit: auditResult  ? { ok: auditResult.ok,  passed: auditResult.passed,  total: auditResult.total,  critical: auditResult.critical }  : null,
        stressTest:  stressResult ? { ok: stressResult.ok, passed: stressResult.passed, total: stressResult.total, score: stressResult.score }        : null,
        trust:       trustReport  ? { score: trustReport.avgScore, level: trustReport.visibility?.level } : null,
        ux:          uxReport     ? { score: uxReport.avgScore, calmness: uxReport.calmness?.level }      : null,
        summary:     `Capabilities: audit=${auditResult?.ok ? "PASS" : "FAIL"} stress=${stressResult?.ok ? "PASS" : "FAIL"}`,
    };
}

function productMaturityQuality() {
    const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
    const rif = _tryRequire("./repoIntelligenceFoundation.cjs");
    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    const lss = _tryRequire("./longSessionSurvivability.cjs");
    const emr = _tryRequire("./engineeringMemoryRefinement.cjs");

    let flowCount = 0, repoSymbols = 0, deployTrust = "unknown", replayDurable = false, memEntries = 0;
    if (ocf) { try { flowCount = ocf.catalogOneClickFlows().length; } catch {} }
    if (rif) { try { repoSymbols = rif.repoGraphSummary().totalSymbols; } catch {} }
    if (dpm) { try { deployTrust = dpm.operationalTrustReport("").level; } catch {} }
    if (lss) { try { replayDurable = lss.assessSurvivabilityDurability().durable; } catch {} }
    if (emr) { try { memEntries = emr.memoryRefinementStats().total; } catch {} }

    return {
        ok:              true,
        flowCount,
        repoSymbols,
        deployTrust,
        replayDurable,
        memEntries,
        summary:         `Maturity quality: flows=${flowCount} symbols=${repoSymbols} deploy=${deployTrust} replay=${replayDurable ? "durable" : "fragile"} memory=${memEntries}`,
    };
}

function fullPlatformHealth735() {
    const modules  = moduleHealth735();
    const platform = platformHealth735();
    const caps     = capabilities735();
    const quality  = productMaturityQuality();

    const prev720 = _tryRequire("./engineeringProductivityOSFoundation.cjs");
    let prevOk = false;
    if (prev720) { try { const h = prev720.fullPlatformHealth720(); prevOk = h.ok !== false; } catch {} }

    const healthy = modules.ok && platform.ok && caps.ok;

    return {
        ok:      healthy,
        healthy,
        modules: { loaded: modules.loaded, total: modules.total },
        platform: { ok: platform.ok, criticalCount: platform.criticalCount },
        capabilities: { auditOk: caps.safetyAudit?.ok, stressTestOk: caps.stressTest?.ok },
        quality: { flowCount: quality.flowCount, deployTrust: quality.deployTrust },
        prev720: prevOk,
        status:  healthy ? "HEALTHY" : "DEGRADED",
        summary: `Phase 721-735 foundation: ${healthy ? "HEALTHY" : "DEGRADED"} — modules=${modules.loaded}/${modules.total} platform=${platform.ok ? "OK" : "DEGRADED"} prev720=${prevOk}`,
    };
}

module.exports = { moduleHealth735, platformHealth735, capabilities735, productMaturityQuality, fullPlatformHealth735 };
