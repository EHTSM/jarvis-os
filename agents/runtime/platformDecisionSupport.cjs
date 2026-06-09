"use strict";
/**
 * Phase 741 — Platform Decision Support
 *
 * Provides structured decision-support recommendations for common operator
 * scenarios: rollback, deploy-continue, incident-response, workflow-resume.
 * All recommendations require operator acknowledgment before action.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const DECISION_TYPES = ["rollback", "deploy-continue", "incident-response", "workflow-resume", "debug-escalate"];

function assessRollbackReadiness(deploymentId = "") {
    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (!dpm) return { ok: false, recommended: false, confidence: "unknown", reason: "deployment module unavailable" };

    try {
        const r = dpm.rollbackReadinessAssessment(deploymentId);
        return {
            ok:          true,
            recommended: !r.rollbackReady ? false : r.confidence === "high",
            confidence:  r.confidence,
            rollbackReady: r.rollbackReady,
            checks:      r.checks,
            reason:      r.rollbackReady ? `Rollback ready (confidence=${r.confidence})` : "Rollback conditions not met",
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function assessDeployContinue(deploymentId = "") {
    const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
    if (!dpm) return { ok: false, recommended: false, reason: "deployment module unavailable" };

    try {
        const trust = dpm.operationalTrustReport(deploymentId);
        const recommended = trust.trustScore >= 70;
        return {
            ok:          true,
            recommended,
            trustScore:  trust.trustScore,
            level:       trust.level,
            reason:      `Trust score=${trust.trustScore} (${trust.level}) — ${recommended ? "safe to continue" : "resolve issues first"}`,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function assessIncidentResponse() {
    const ois = _tryRequire("./operatorIntelligenceSurface.cjs");
    if (!ois) return { ok: false, priority: "unknown", actions: [] };

    try {
        const surface = ois.intelligenceSurfaceReport();
        const priority = surface.health.critical > 0 ? "critical" : surface.health.warnings > 2 ? "high" : "normal";

        const actions = [];
        if (surface.actionQueue?.topActions) {
            surface.actionQueue.topActions.forEach(a => actions.push({ action: a.action, priority: a.priority }));
        }

        return {
            ok:       true,
            priority,
            critical: surface.health.critical,
            warnings: surface.health.warnings,
            actions:  actions.slice(0, 5),
            reason:   `Incident priority=${priority} critical=${surface.health.critical}`,
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function assessWorkflowResume(sessionId) {
    if (!sessionId) return { ok: false, error: "sessionId required" };

    const lss = _tryRequire("./longSessionSurvivability.cjs");
    if (!lss) return { ok: false, reason: "survivability module unavailable" };

    try {
        const r = lss.restoreSurvivabilitySession(sessionId);
        if (!r.ok) return { ok: false, recommended: false, reason: r.error || "session not restorable" };

        const stale = r.session?.age > 8 * 60 * 60 * 1000;
        return {
            ok:          true,
            recommended: !stale,
            stale,
            reason:      stale ? "Session is stale (>8h) — verify before resuming" : "Session restorable",
        };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

function decisionSupport(type, params = {}) {
    if (!DECISION_TYPES.includes(type)) {
        return { ok: false, error: `Unknown decision type '${type}'. Valid: ${DECISION_TYPES.join(", ")}` };
    }

    let assessment;
    if (type === "rollback")          assessment = assessRollbackReadiness(params.deploymentId);
    else if (type === "deploy-continue")  assessment = assessDeployContinue(params.deploymentId);
    else if (type === "incident-response") assessment = assessIncidentResponse();
    else if (type === "workflow-resume")  assessment = assessWorkflowResume(params.sessionId);
    else if (type === "debug-escalate") {
        const rdb = _tryRequire("./realDebuggingProductivity.cjs");
        assessment = rdb ? { ok: true, recommended: true, reason: "Escalate to real debugging flow" } : { ok: false, reason: "debugging module unavailable" };
    }

    return {
        ok:         assessment.ok,
        type,
        assessment,
        requiresOperatorApproval: true,
        summary:    `Decision support [${type}]: ${assessment.reason || "see assessment"}`,
    };
}

function decisionSupportSummary() {
    return {
        ok:           true,
        supportedTypes: DECISION_TYPES,
        note:         "All decisions require operator approval before execution",
        summary:      `Decision support: ${DECISION_TYPES.length} decision types available`,
    };
}

module.exports = { assessRollbackReadiness, assessDeployContinue, assessIncidentResponse, assessWorkflowResume, decisionSupport, decisionSupportSummary };
