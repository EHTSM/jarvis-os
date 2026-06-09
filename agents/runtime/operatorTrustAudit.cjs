"use strict";
/**
 * Phase 643 — Operator Trust Audit
 *
 * Comprehensive trust audit: approval discipline, autonomy safety compliance,
 * signal health, patch trust integrity, decision quality. Surfaces violations and drift.
 * Read-only. No state mutations.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Audit checks ───────────────────────────────────────────────────────────────

function auditApprovalDiscipline() {
    const issues = [];

    // Check autonomous terminal supervision for auto-retry violations
    const ats = _tryRequire("./autonomousTerminalSupervision.cjs");
    if (ats) {
        try {
            const stale = ats.detectStale();
            if (stale.runawayCount > 0) issues.push({ check: "runaway-processes", severity: "critical", detail: `${stale.runawayCount} runaway process(es) detected` });
        } catch {}
    }

    // Check autonomous patch prep for un-approved patches
    const app = _tryRequire("./autonomousPatchPrep.cjs");
    if (app) {
        try {
            const pending = app.listProposals ? app.listProposals({ status: "proposed" }) : null;
            if (pending && pending.count > 5) issues.push({ check: "patch-backlog", severity: "warning", detail: `${pending.count} pending patches — review needed` });
        } catch {}
    }

    // Check browser operations for unblocked submissions
    const abo = _tryRequire("./autonomousBrowserOperations.cjs");
    if (!abo) issues.push({ check: "browser-ops-unavailable", severity: "warning", detail: "autonomousBrowserOperations module not loaded" });

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return {
        ok:     clean,
        check:  "approval-discipline",
        issues,
        clean,
        detail: clean ? "Approval discipline: clean" : `${issues.length} issue(s) found`,
    };
}

function auditAutonomySafety() {
    const issues = [];

    // Trust score gate
    const otl = _tryRequire("./operationalTrustLayer.cjs");
    if (otl) {
        try {
            const gate = otl.gateOperation("deploy");
            if (!gate.allowed && gate.score < 40) issues.push({ check: "trust-critically-low", severity: "critical", detail: `Trust score ${gate.score} — below safe threshold` });
        } catch {}
    }

    // Trust evolution autonomy safety
    const ete = _tryRequire("./executionTrustEvolution.cjs");
    if (ete) {
        try {
            const safety = ete.autonomySafetyScore();
            if (safety.score < 40) issues.push({ check: "autonomy-safety-low", severity: "critical", detail: `Autonomy safety ${safety.score}% — restricted mode recommended` });
            else if (safety.score < 60) issues.push({ check: "autonomy-safety-moderate", severity: "warning", detail: `Autonomy safety ${safety.score}% — monitor closely` });
        } catch {}
    }

    // Check for unsafe runtime
    const edi = _tryRequire("./engineeringDecisionIntelligence.cjs");
    if (edi) {
        try {
            const unsafe = edi.detectUnsafeRuntime();
            if (!unsafe.safe) issues.push({ check: "unsafe-runtime", severity: "critical", detail: `${unsafe.critical} critical signal(s): ${unsafe.warnings.map(w => w.signal).join(", ")}` });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return {
        ok:     clean,
        check:  "autonomy-safety",
        issues,
        clean,
        detail: clean ? "Autonomy safety: clean" : `${issues.length} safety issue(s) found`,
    };
}

function auditPatchTrustIntegrity() {
    const issues = [];

    const apt = _tryRequire("./advancedPatchTrust.cjs");
    if (!apt) {
        return { ok: false, check: "patch-trust-integrity", issues: [{ check: "module-unavailable", severity: "warning", detail: "advancedPatchTrust not loaded" }], clean: false };
    }

    try {
        const conf = apt.executionConfidenceSummary();
        if (!conf.ok) issues.push({ check: "trust-summary-fail", severity: "warning", detail: "Patch trust summary unavailable" });
        else if (conf.autonomousOk === false) issues.push({ check: "autonomous-patches-blocked", severity: "warning", detail: "Autonomous patch execution currently blocked by trust scores" });

        const risks = apt.rollbackRiskIndicators({ windowDays: 7 });
        if (risks.ok && risks.risk === "high") issues.push({ check: "high-rollback-risk", severity: "critical", detail: `High rollback risk: ${risks.detail}` });
    } catch (e) {
        issues.push({ check: "patch-trust-error", severity: "warning", detail: e.message });
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return {
        ok:     clean,
        check:  "patch-trust-integrity",
        issues,
        clean,
        detail: clean ? "Patch trust: clean" : `${issues.length} trust issue(s)`,
    };
}

function auditDecisionQuality() {
    const issues = [];

    const edi = _tryRequire("./engineeringDecisionIntelligence.cjs");
    if (edi) {
        try {
            const history = edi.decisionHistory({ type: "recovery-prioritization", limit: 20 });
            const lowConf = history.filter(d => d.confidence < 55).length;
            if (lowConf > 5) issues.push({ check: "low-confidence-decisions", severity: "warning", detail: `${lowConf} low-confidence recovery decisions in recent history` });

            const unstable = edi.detectUnstableWorkflows();
            if (unstable.unstable) issues.push({ check: "unstable-workflows", severity: "warning", detail: `Unstable workflows: ${unstable.signals.map(s => s.type).join(", ")}` });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return {
        ok:     clean,
        check:  "decision-quality",
        issues,
        clean,
        detail: clean ? "Decision quality: clean" : `${issues.length} decision issue(s)`,
    };
}

function auditMemoryHealth() {
    const issues = [];

    const awm = _tryRequire("./autonomousWorkflowMemory.cjs");
    if (awm) {
        try {
            const s = awm.stats();
            if (s.usage && parseInt(s.usage) >= 90) issues.push({ check: "memory-capacity", severity: "warning", detail: `Workflow memory at ${s.usage} capacity — cleanup recommended` });
        } catch {}
    }

    const lhac = _tryRequire("./longHorizonAutonomousContinuity.cjs");
    if (lhac) {
        try {
            const health = lhac.continuityHealth();
            if (health.storm) issues.push({ check: "reconnect-storm", severity: "critical", detail: "Reconnect storm detected" });
            if (health.staleSessions > 3) issues.push({ check: "stale-sessions", severity: "warning", detail: `${health.staleSessions} stale sessions awaiting cleanup` });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return {
        ok:     clean,
        check:  "memory-health",
        issues,
        clean,
        detail: clean ? "Memory health: clean" : `${issues.length} memory issue(s)`,
    };
}

function auditPlatformResilience() {
    const issues = [];

    const apr = _tryRequire("./advancedPlatformResilience.cjs");
    if (apr) {
        try {
            const wd = apr.watchdogSummary();
            if (wd.pressureScore < 40)    issues.push({ check: "critical-pressure", severity: "critical", detail: `Runtime pressure: ${wd.pressureLevel} (${wd.pressureScore}/100)` });
            else if (wd.pressureScore < 60) issues.push({ check: "high-pressure", severity: "warning", detail: `Elevated pressure: ${wd.pressureLevel}` });
            if (wd.cascadeRisk === "high")  issues.push({ check: "cascade-risk", severity: "critical", detail: "High cascade failure risk" });
            if (wd.trippedBreakers > 0)     issues.push({ check: "tripped-breakers", severity: "warning", detail: `${wd.trippedBreakers} circuit breaker(s) tripped` });
        } catch {}
    }

    const clean = issues.filter(i => i.severity === "critical").length === 0;
    return {
        ok:     clean,
        check:  "platform-resilience",
        issues,
        clean,
        detail: clean ? "Platform resilience: clean" : `${issues.length} resilience issue(s)`,
    };
}

// ── Full audit ────────────────────────────────────────────────────────────────

function runAudit() {
    const checks = [
        auditApprovalDiscipline(),
        auditAutonomySafety(),
        auditPatchTrustIntegrity(),
        auditDecisionQuality(),
        auditMemoryHealth(),
        auditPlatformResilience(),
    ];

    const passed   = checks.filter(c => c.clean).length;
    const total    = checks.length;
    const critical = checks.flatMap(c => c.issues).filter(i => i.severity === "critical").length;
    const warnings = checks.flatMap(c => c.issues).filter(i => i.severity === "warning").length;
    const overallOk = critical === 0;

    return {
        ok:       overallOk,
        passed,
        total,
        critical,
        warnings,
        checks,
        failed:   checks.filter(c => !c.clean).map(c => c.check),
        summary:  `Operator Trust Audit 643: ${passed}/${total} clean — ${critical} critical, ${warnings} warnings`,
    };
}

module.exports = { runAudit, auditApprovalDiscipline, auditAutonomySafety, auditPatchTrustIntegrity, auditDecisionQuality, auditMemoryHealth, auditPlatformResilience };
