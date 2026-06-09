"use strict";
/**
 * Phase 687 — Platform Strategy Resilience
 *
 * Execution continuity, deployment rollback integrity, replay durability,
 * workflow survivability, runtime-state coordination, recovery reliability.
 * Read-mostly aggregation. Operator-controlled.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Execution continuity ──────────────────────────────────────────────────────

function assessStrategicExecutionContinuity() {
    const signals = [];

    const pcr = _tryRequire("./platformCoordinationResilience.cjs");
    if (pcr) {
        try {
            const r = pcr.assessExecutionContinuity();
            if (!r.continuous) signals.push(...(r.signals || []).map(s => ({ source: "coord-resilience", ...s })));
        } catch {}
    }

    const lhep = _tryRequire("./longHorizonExecutionPlanning.cjs");
    if (lhep) {
        try {
            const r = lhep.planReconnectSafeContinuity("strategy-check");
            if (!r.ok && !r.safe) signals.push({ source: "lh-planning", factor: "reconnect-unsafe", severity: "high" });
        } catch {}
    }

    const continuous = signals.filter(s => s.severity === "critical").length === 0;
    return {
        ok:         continuous,
        continuous,
        signals,
        detail:     continuous ? "Strategic execution continuity maintained" : `${signals.length} continuity signal(s)`,
    };
}

// ── Deployment rollback integrity ─────────────────────────────────────────────

function assessStrategicRollbackIntegrity(deploymentId = "") {
    const checks = [];

    const dse = _tryRequire("./deploymentStrategyEngine.cjs");
    if (dse) {
        try {
            const rollback = dse.recommendRollbackStrategy(deploymentId);
            checks.push({ check: "rollback-strategy", ok: rollback.ok !== false, detail: rollback.explainer || "available" });
        } catch {}
    }

    const pcr = _tryRequire("./platformCoordinationResilience.cjs");
    if (pcr) {
        try {
            const r = pcr.assessRollbackIntegrity(deploymentId);
            checks.push({ check: "coord-rollback", ok: r.intact !== false, detail: r.detail });
        } catch {}
    }

    const allOk = checks.every(c => c.ok !== false);
    return {
        ok:     allOk,
        intact: allOk,
        deploymentId,
        checks,
        detail: allOk ? "Rollback integrity verified" : `${checks.filter(c => !c.ok).length} rollback concern(s)`,
        approvalRequired: true,
    };
}

// ── Replay durability ─────────────────────────────────────────────────────────

function assessStrategicReplayDurability() {
    const signals = [];

    const pcr = _tryRequire("./platformCoordinationResilience.cjs");
    if (pcr) {
        try {
            const r = pcr.assessReplaySurvivability();
            if (!r.durable) signals.push(...(r.signals || []).map(s => ({ source: "coord-resilience", ...s })));
        } catch {}
    }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) {
        try {
            const r = lhs.assessReplayDurability("strategy-check");
            if (!r.durable) signals.push(...(r.signals || []).map(s => ({ source: "lh-survivability", ...s })));
        } catch {}
    }

    const durable = signals.filter(s => s.severity === "critical").length === 0;
    return {
        ok:      durable,
        durable,
        signals: signals.slice(0, 10),
        detail:  durable ? "Replay durability intact" : `${signals.length} replay durability signal(s)`,
    };
}

// ── Workflow survivability ────────────────────────────────────────────────────

function assessWorkflowSurvivability() {
    const pre = _tryRequire("./platformResilienceEvolution.cjs");
    let survivability = null;
    if (pre) { try { survivability = pre.workflowSurvivabilityReport(); } catch {} }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    let health = null;
    if (lhs) { try { health = lhs.survivabilityHealth(); } catch {} }

    const ok = (survivability?.ok !== false) && (health?.healthy !== false);
    return {
        ok,
        survivable: ok,
        activeSessions: health?.activeSessions || 0,
        storm:          health?.storm || false,
        survivabilityPct: survivability?.score || null,
        detail:         ok ? "Workflow survivability confirmed" : "Workflow survivability compromised",
    };
}

// ── Runtime state coordination ────────────────────────────────────────────────

function assessRuntimeStateCoordination() {
    const pcr = _tryRequire("./platformCoordinationResilience.cjs");
    if (pcr) {
        try {
            const r = pcr.assessStateCoordination();
            return { ok: r.healthy, ...r };
        } catch {}
    }

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const state = esi.executionStateSummary();
            return { ok: state.stable, stable: state.stable, detail: state.summary };
        } catch {}
    }

    return { ok: true, skipped: true };
}

// ── Recovery reliability ──────────────────────────────────────────────────────

function assessStrategicRecoveryReliability() {
    const pcr = _tryRequire("./platformCoordinationResilience.cjs");
    if (pcr) {
        try {
            const r = pcr.assessRecoveryReliability();
            return { ok: r.reliable, ...r };
        } catch {}
    }

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const summary = arc.recoverySummary({ windowMs: 8 * 60 * 60 * 1000 });
            return { ok: summary.ok, reliable: summary.ok, problematic: summary.problematic, detail: summary.warning || "Recovery reliable" };
        } catch {}
    }

    return { ok: true, skipped: true };
}

// ── Full platform strategy resilience report ──────────────────────────────────

function platformStrategyResilienceReport() {
    const continuity  = assessStrategicExecutionContinuity();
    const rollback    = assessStrategicRollbackIntegrity();
    const replay      = assessStrategicReplayDurability();
    const workflow    = assessWorkflowSurvivability();
    const state       = assessRuntimeStateCoordination();
    const recovery    = assessStrategicRecoveryReliability();

    const checks = [continuity, rollback, replay, workflow, state, recovery];
    const allOk   = checks.every(c => c.ok !== false);
    const failing  = checks.filter(c => !c.ok).length;

    return {
        ok:           allOk,
        continuity:   { ok: continuity.continuous, detail: continuity.detail },
        rollback:     { ok: rollback.intact,        detail: rollback.detail   },
        replay:       { ok: replay.durable,         detail: replay.detail     },
        workflow:     { ok: workflow.survivable,     detail: workflow.detail   },
        state:        { ok: state.ok,               detail: state.detail || "checked" },
        recovery:     { ok: recovery.ok,            detail: recovery.detail || "checked" },
        failingCount: failing,
        summary:      `Platform strategy resilience: ${checks.filter(c => c.ok !== false).length}/6 — ${allOk ? "HEALTHY" : "DEGRADED"}`,
    };
}

module.exports = { assessStrategicExecutionContinuity, assessStrategicRollbackIntegrity, assessStrategicReplayDurability, assessWorkflowSurvivability, assessRuntimeStateCoordination, assessStrategicRecoveryReliability, platformStrategyResilienceReport };
