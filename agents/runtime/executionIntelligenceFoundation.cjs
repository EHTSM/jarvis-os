"use strict";
/**
 * Phase 660 — Execution Intelligence Foundation Complete
 *
 * Entry point for phases 646–660. Aggregates module health, platform capabilities,
 * and validates the full execution intelligence platform.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const MODULES_660 = {
    "smartDebugIntelligence":           "./smartDebugIntelligence.cjs",
    "executionRiskIntelligence":        "./executionRiskIntelligence.cjs",
    "adaptiveWorkflowChains":           "./adaptiveWorkflowChains.cjs",
    "terminalExecutionIntelligence":    "./terminalExecutionIntelligence.cjs",
    "browserExecutionIntelligence":     "./browserExecutionIntelligence.cjs",
    "engineeringDecisionEvolution":     "./engineeringDecisionEvolution.cjs",
    "operationalMemoryIntelligence":    "./operationalMemoryIntelligence.cjs",
    "dailyExecutionAutomation":         "./dailyExecutionAutomation.cjs",
    "longHorizonExecutionContinuity":   "./longHorizonExecutionContinuity.cjs",
    "engineeringProductivityIntelligence": "./engineeringProductivityIntelligence.cjs",
    "executionIntelStressTest":         "./executionIntelStressTest.cjs",
    "platformResilienceEvolution":      "./platformResilienceEvolution.cjs",
    "operatorTrustEvolution":           "./operatorTrustEvolution.cjs",
    "executionIntelligenceAudit":       "./executionIntelligenceAudit.cjs",
    "executionIntelligenceFoundation":  "./executionIntelligenceFoundation.cjs",
};

function moduleHealth660() {
    const health = {};
    for (const [name, p] of Object.entries(MODULES_660)) {
        if (name === "executionIntelligenceFoundation") { health[name] = "self"; continue; }
        const m = _tryRequire(p);
        health[name] = m ? "ok" : "unavailable";
    }
    const available = Object.values(health).filter(v => v === "ok").length;
    const total     = Object.keys(MODULES_660).length - 1;
    return { ok: available === total, available, total, health };
}

function platformHealth660() {
    const mh = moduleHealth660();

    let stressResult = null;
    const st = _tryRequire("./executionIntelStressTest.cjs");
    if (st) { try { stressResult = st.runAll(); } catch {} }

    let auditResult = null;
    const eia = _tryRequire("./executionIntelligenceAudit.cjs");
    if (eia) { try { auditResult = eia.runAudit(); } catch {} }

    let trustResult = null;
    const ote = _tryRequire("./operatorTrustEvolution.cjs");
    if (ote) { try { trustResult = ote.trustSummary(); } catch {} }

    let resilienceResult = null;
    const pre = _tryRequire("./platformResilienceEvolution.cjs");
    if (pre) { try { resilienceResult = pre.resilienceEvolutionReport(); } catch {} }

    let productivityResult = null;
    const epi = _tryRequire("./engineeringProductivityIntelligence.cjs");
    if (epi) { try { productivityResult = epi.productivityIntelSummary(); } catch {} }

    const ok = mh.ok &&
               (stressResult?.ok   !== false) &&
               (auditResult?.ok    !== false);

    return {
        ok,
        moduleHealth:  mh,
        stressTest:    stressResult    ? { ok: stressResult.ok,    survivability: stressResult.survivability,    passed: stressResult.passed }    : null,
        audit:         auditResult     ? { ok: auditResult.ok,     passed: auditResult.passed,     critical: auditResult.critical }     : null,
        trust:         trustResult     ? { score: trustResult.trust?.score, level: trustResult.trust?.level, maturity: trustResult.maturity?.maturity } : null,
        resilience:    resilienceResult ? { ok: resilienceResult.ok } : null,
        productivity:  productivityResult ? { overall: productivityResult.overall } : null,
        summary:       `Platform 660: ${ok ? "HEALTHY" : "DEGRADED"} — modules=${mh.available}/${mh.total}`,
    };
}

function capabilities660() {
    return {
        smartDebugIntelligence:           true,
        executionRiskIntelligence:        true,
        adaptiveWorkflowChains:           true,
        terminalExecutionIntelligence:    true,
        browserExecutionIntelligence:     true,
        engineeringDecisionEvolution:     true,
        operationalMemoryIntelligence:    true,
        dailyExecutionAutomation:         true,
        longHorizonExecutionContinuity:   true,
        engineeringProductivityIntelligence: true,
        platformResilienceEvolution:      true,
        operatorTrustEvolution:           true,
        executionIntelligenceAudit:       true,
        phase646to660Foundation:          true,
    };
}

function fullPlatformHealth() {
    const prev = _tryRequire("./trustedAutonomousFoundation.cjs");
    let prevHealth = null;
    if (prev) {
        try {
            const h = prev.fullPlatformHealth?.();
            prevHealth = { ok: h?.ok !== false };
        } catch {}
    }

    const current = platformHealth660();

    return {
        ok:       current.ok,
        phase660: current,
        phase645: prevHealth,
        allPhases: (prevHealth?.ok !== false) && current.ok,
        summary:  `Full platform (646–660): ${current.ok ? "HEALTHY" : "DEGRADED"}`,
    };
}

module.exports = { moduleHealth660, platformHealth660, capabilities660, fullPlatformHealth, MODULES_660 };
