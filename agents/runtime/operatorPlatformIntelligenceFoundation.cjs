"use strict";
/**
 * Phase 750 — Operator Platform Intelligence Foundation
 *
 * Entry point for the 736-750 operator platform intelligence range.
 * Outputs: signal aggregation, intelligence surface, cross-phase health,
 * adaptive context, alert filtering, decision support, pattern recognition,
 * workflow orchestration, health projection, context switching, stress test,
 * audit, UX quality, and foundation continuity.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MODULES_750 = [
    { name: "platformSignalAggregation",         phase: 736 },
    { name: "operatorIntelligenceSurface",        phase: 737 },
    { name: "crossPhaseIntelligence",             phase: 738 },
    { name: "adaptiveOperatorContext",            phase: 739 },
    { name: "intelligentAlertFiltering",          phase: 740 },
    { name: "platformDecisionSupport",            phase: 741 },
    { name: "runtimePatternRecognition",          phase: 742 },
    { name: "operatorWorkflowOrchestration",      phase: 743 },
    { name: "platformHealthProjection",           phase: 744 },
    { name: "intelligentContextSwitching",        phase: 745 },
    { name: "platformIntelligenceStressTest",     phase: 746 },
    { name: "operatorIntelligenceAudit",          phase: 747 },
    { name: "platformIntelligenceUX",             phase: 748 },
    { name: "platformIntelligenceResilience",     phase: 749 },
    { name: "operatorPlatformIntelligenceFoundation", phase: 750 },
];

function moduleHealth750() {
    const results = MODULES_750.map(m => {
        if (m.phase === 750) return { name: m.name, phase: m.phase, loaded: true, self: true };
        const mod = _tryRequire(`./${m.name}.cjs`);
        return { name: m.name, phase: m.phase, loaded: mod !== null };
    });
    const loaded = results.filter(r => r.loaded).length;
    const total  = results.length;
    return { ok: loaded === total, loaded, total, modules: results, summary: `Module health: ${loaded}/${total}` };
}

function platformHealth750() {
    const resilience = _tryRequire("./platformIntelligenceResilience.cjs");
    if (!resilience) return { ok: false, error: "platformIntelligenceResilience unavailable" };

    const report = resilience.platformIntelligenceResilienceReport();

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

function capabilities750() {
    const audit = _tryRequire("./operatorIntelligenceAudit.cjs");
    let auditResult = null;
    if (audit) { try { auditResult = audit.runOperatorIntelligenceAudit(); } catch {} }

    const stress = _tryRequire("./platformIntelligenceStressTest.cjs");
    let stressResult = null;
    if (stress) { try { stressResult = stress.runAll(); } catch {} }

    const ux = _tryRequire("./platformIntelligenceUX.cjs");
    let uxReport = null;
    if (ux) { try { uxReport = ux.intelligenceUXReport(); } catch {} }

    return {
        ok:          auditResult?.ok !== false && stressResult?.ok !== false,
        safetyAudit: auditResult  ? { ok: auditResult.ok,  passed: auditResult.passed,  total: auditResult.total,  critical: auditResult.critical }  : null,
        stressTest:  stressResult ? { ok: stressResult.ok, passed: stressResult.passed, total: stressResult.total, score: stressResult.score }        : null,
        ux:          uxReport     ? { score: uxReport.avgScore, calmness: uxReport.calmness?.level } : null,
        summary:     `Capabilities: audit=${auditResult?.ok ? "PASS" : "FAIL"} stress=${stressResult?.ok ? "PASS" : "FAIL"}`,
    };
}

function intelligenceQuality() {
    const psa = _tryRequire("./platformSignalAggregation.cjs");
    const cpi = _tryRequire("./crossPhaseIntelligence.cjs");
    const ois = _tryRequire("./operatorIntelligenceSurface.cjs");
    const php = _tryRequire("./platformHealthProjection.cjs");
    const rpr = _tryRequire("./runtimePatternRecognition.cjs");

    let signalTotal = 0, crossPhaseOk = false, surfaceLevel = "unknown", projectionOk = false, patternCount = 0;

    if (psa) { try { const r = psa.aggregateSignals(); signalTotal = r.total; } catch {} }
    if (cpi) { try { const r = cpi.crossPhaseHealthReport(); crossPhaseOk = r.ok !== false; } catch {} }
    if (ois) { try { const r = ois.intelligenceSurfaceReport(); surfaceLevel = r.health?.level || "unknown"; } catch {} }
    if (php) { try { const r = php.projectHealthOutlook(); projectionOk = r.ok !== false; } catch {} }
    if (rpr) { try { const r = rpr.detectPatterns(); patternCount = r.total; } catch {} }

    return {
        ok:             true,
        signalTotal,
        crossPhaseOk,
        surfaceLevel,
        projectionOk,
        patternCount,
        summary:        `Intelligence quality: signals=${signalTotal} cross-phase=${crossPhaseOk} surface=${surfaceLevel} patterns=${patternCount}`,
    };
}

function fullPlatformHealth750() {
    const modules  = moduleHealth750();
    const platform = platformHealth750();
    const caps     = capabilities750();
    const quality  = intelligenceQuality();

    const prev735 = _tryRequire("./operatorProductMaturityFoundation.cjs");
    let prevOk = false;
    if (prev735) { try { const h = prev735.fullPlatformHealth735(); prevOk = h.ok !== false; } catch {} }

    const healthy = modules.ok && platform.ok && caps.ok;

    return {
        ok:      healthy,
        healthy,
        modules: { loaded: modules.loaded, total: modules.total },
        platform: { ok: platform.ok, criticalCount: platform.criticalCount },
        capabilities: { auditOk: caps.safetyAudit?.ok, stressTestOk: caps.stressTest?.ok },
        quality: { signalTotal: quality.signalTotal, surfaceLevel: quality.surfaceLevel },
        prev735: prevOk,
        status:  healthy ? "HEALTHY" : "DEGRADED",
        summary: `Phase 736-750 foundation: ${healthy ? "HEALTHY" : "DEGRADED"} — modules=${modules.loaded}/${modules.total} platform=${platform.ok ? "OK" : "DEGRADED"} prev735=${prevOk}`,
    };
}

module.exports = { moduleHealth750, platformHealth750, capabilities750, intelligenceQuality, fullPlatformHealth750 };
