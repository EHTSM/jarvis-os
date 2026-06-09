"use strict";
/**
 * Phase 673 — Platform Coordination Resilience
 *
 * Execution continuity, replay survivability, rollback integrity,
 * state coordination, workflow isolation, recovery reliability.
 * Read-mostly aggregation. Bounded. Operator-controlled.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Execution continuity assessment ──────────────────────────────────────────

function assessExecutionContinuity() {
    const signals = [];

    const lhec = _tryRequire("./longHorizonExecutionContinuity.cjs");
    if (lhec) {
        try {
            const health = lhec.continuityHealth();
            if (!health.ok)   signals.push({ factor: "continuity-health",   ok: false, detail: health.warning });
            if (health.storm) signals.push({ factor: "reconnect-storm",     ok: false, severity: "critical" });
        } catch {}
    }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) {
        try {
            const health = lhs.survivabilityHealth();
            if (health.storm) signals.push({ factor: "survivability-storm", ok: false, severity: "critical" });
            if (health.staleSessions > 5) signals.push({ factor: "stale-sessions", ok: false, count: health.staleSessions });
        } catch {}
    }

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const summary = esi.executionStateSummary();
            if (!summary.stable) signals.push({ factor: "execution-unstable", ok: false, warnings: summary.warnings });
        } catch {}
    }

    const continuous = signals.filter(s => s.severity === "critical").length === 0;
    return {
        ok:         continuous,
        continuous,
        signals,
        critical:   signals.filter(s => s.severity === "critical"),
        detail:     continuous ? "Execution continuity maintained" : `${signals.length} continuity signal(s)`,
    };
}

// ── Replay survivability ──────────────────────────────────────────────────────

function assessReplaySurvivability() {
    const pre = _tryRequire("./platformResilienceEvolution.cjs");
    let durability = null;
    if (pre) { try { durability = pre.replayDurabilityReport(); } catch {} }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    let replayDurability = null;
    if (lhs) { try { replayDurability = lhs.assessReplayDurability("platform-check"); } catch {} }

    const durable = (durability?.durable !== false) && (replayDurability?.durable !== false);
    const signals = [
        ...(durability?.signals || []),
        ...(replayDurability?.signals || []),
    ];

    return {
        ok:       durable,
        durable,
        signals:  signals.slice(0, 10),
        critical: signals.filter(s => s.severity === "critical"),
        detail:   durable ? "Replay survivability intact" : `${signals.length} replay signal(s)`,
    };
}

// ── Rollback integrity ────────────────────────────────────────────────────────

function assessRollbackIntegrity(deploymentId = "") {
    const checks = [];

    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae && deploymentId) {
        try {
            const safety = dae.rollbackDependencySafety(deploymentId);
            checks.push({ check: "dependency-safety", ok: safety.safe, detail: safety.detail });
        } catch {}
    }

    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    if (sdc && deploymentId) {
        try {
            const survivability = sdc.deploymentSurvivabilityAnalysis(deploymentId);
            checks.push({ check: "survivability", ok: survivability.rollbackAvailable, detail: `survivability=${survivability.survivability}%` });
        } catch {}
    }

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const summary = arc.recoverySummary({ windowMs: 4 * 60 * 60 * 1000 });
            checks.push({ check: "recovery-health", ok: summary.ok, detail: summary.warning || "clean" });
        } catch {}
    }

    const allOk = checks.every(c => c.ok !== false);
    return {
        ok:       allOk,
        intact:   allOk,
        deploymentId,
        checks,
        failed:   checks.filter(c => !c.ok).map(c => c.check),
        approvalRequired: true,
        detail:   allOk ? "Rollback integrity confirmed" : `Rollback concerns: ${checks.filter(c => !c.ok).map(c => c.check).join(", ")}`,
    };
}

// ── State coordination health ─────────────────────────────────────────────────

function assessStateCoordination() {
    const states = [];

    const ecc = _tryRequire("./engineeringContextCoordination.cjs");
    if (ecc) {
        try {
            const stale = ecc.cleanupStaleContexts({ dryRun: true });
            states.push({ module: "context-coord", staleCount: stale.staleCount, ok: stale.staleCount < 10 });
        } catch {}
    }

    const emc = _tryRequire("./executionMemoryCoordination.cjs");
    if (emc) {
        try {
            const summary = emc.memoryCoordinationSummary();
            states.push({ module: "memory-coord", suppressedCount: summary.suppressedCount, ok: summary.suppressedCount < 20 });
        } catch {}
    }

    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    if (sdc) {
        try {
            const stale = sdc.detectStaleDeploymentReplays();
            states.push({ module: "deploy-coord", staleCount: stale.staleCount, ok: stale.ok });
        } catch {}
    }

    const healthy = states.every(s => s.ok !== false);
    return {
        ok:      healthy,
        healthy,
        states,
        issues:  states.filter(s => !s.ok).map(s => s.module),
        detail:  healthy ? "State coordination healthy" : `State issues: ${states.filter(s => !s.ok).map(s => s.module).join(", ")}`,
    };
}

// ── Workflow isolation assessment ─────────────────────────────────────────────

function assessWorkflowIsolation() {
    const issues = [];

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const patterns = esi.detectUnstablePatterns();
            if (patterns.unstable) issues.push({ factor: "unstable-patterns", count: patterns.patterns.length });
        } catch {}
    }

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const summary = arc.recoverySummary({ windowMs: 2 * 60 * 60 * 1000 });
            if (summary.problematic.length > 0) issues.push({ factor: "stuck-recovery-paths", paths: summary.problematic.map(p => p.path) });
        } catch {}
    }

    const isolated = issues.length === 0;
    return {
        ok:       isolated,
        isolated,
        issues,
        detail:   isolated ? "Workflow isolation intact" : `${issues.length} isolation issue(s)`,
    };
}

// ── Recovery reliability ──────────────────────────────────────────────────────

function assessRecoveryReliability() {
    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    let recoverySummary = null;
    if (arc) { try { recoverySummary = arc.recoverySummary({ windowMs: 8 * 60 * 60 * 1000 }); } catch {} }

    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    let riskLevel = "unknown";
    if (eri) { try { riskLevel = eri.riskSummary({ windowMs: 4 * 60 * 60 * 1000 })?.overall || "unknown"; } catch {} }

    const reliable = (recoverySummary?.ok !== false) && riskLevel !== "high";
    return {
        ok:       reliable,
        reliable,
        riskLevel,
        problematic: recoverySummary?.problematic || [],
        total:    recoverySummary?.total || 0,
        detail:   reliable ? "Recovery reliability confirmed" : `Recovery concerns: risk=${riskLevel}, problematic=${recoverySummary?.problematic?.length || 0}`,
    };
}

// ── Full platform coordination resilience report ──────────────────────────────

function platformCoordinationResilienceReport() {
    const continuity  = assessExecutionContinuity();
    const replay      = assessReplaySurvivability();
    const rollback    = assessRollbackIntegrity();
    const state       = assessStateCoordination();
    const isolation   = assessWorkflowIsolation();
    const recovery    = assessRecoveryReliability();

    const checks = [continuity, replay, rollback, state, isolation, recovery];
    const allOk   = checks.every(c => c.ok !== false);
    const failing  = checks.filter(c => !c.ok).length;

    return {
        ok:           allOk,
        continuity:   { ok: continuity.continuous,   detail: continuity.detail },
        replay:       { ok: replay.durable,           detail: replay.detail },
        rollback:     { ok: rollback.intact,          detail: rollback.detail },
        state:        { ok: state.healthy,            detail: state.detail },
        isolation:    { ok: isolation.isolated,       detail: isolation.detail },
        recovery:     { ok: recovery.reliable,        detail: recovery.detail },
        failingCount: failing,
        summary:      `Platform coordination resilience: ${checks.filter(c => c.ok !== false).length}/6 — ${allOk ? "HEALTHY" : "DEGRADED"}`,
    };
}

module.exports = { assessExecutionContinuity, assessReplaySurvivability, assessRollbackIntegrity, assessStateCoordination, assessWorkflowIsolation, assessRecoveryReliability, platformCoordinationResilienceReport };
