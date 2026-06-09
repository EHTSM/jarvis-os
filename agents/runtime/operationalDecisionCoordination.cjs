"use strict";
/**
 * Phase 698 — Operational Decision Coordination
 *
 * Cross-environment execution path prioritization, recovery sequence ranking,
 * deployment strategy comparison, unstable coordination state detection,
 * safer operational flow recommendations.
 * Explainable. Confidence-aware. Bounded autonomy.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Cross-environment execution path prioritization ───────────────────────────

function prioritizeCrossEnvExecutionPaths(context = {}) {
    const { activeEnvs = [], hasFailures = false, trustScore = 65, deploymentActive = false } = context;

    const paths = [
        { id: "validate-all-envs",    confidence: 90, autonomous: true,  envs: ["all"],          safetyLevel: "safe"    },
        { id: "restore-vscode-ctx",   confidence: 80, autonomous: true,  envs: ["vscode"],        safetyLevel: "safe"    },
        { id: "restart-terminal",     confidence: 75, autonomous: true,  envs: ["terminal"],      safetyLevel: "safe"    },
        { id: "refresh-browser-sess", confidence: 70, autonomous: false, envs: ["browser"],       safetyLevel: "caution", requiresApproval: true },
        { id: "pause-deployment",     confidence: 85, autonomous: false, envs: ["deployment"],    safetyLevel: "risky",   requiresApproval: true },
        { id: "rollback-deployment",  confidence: 60, autonomous: false, envs: ["deployment"],    safetyLevel: "risky",   requiresApproval: true },
        { id: "full-env-recovery",    confidence: 50, autonomous: false, envs: ["all"],           safetyLevel: "risky",   requiresApproval: true },
    ];

    const eligible = paths.filter(p => {
        const envMatch = p.envs.includes("all") || p.envs.some(e => activeEnvs.includes(e));
        return envMatch;
    }).map(p => ({
        ...p,
        adjustedConfidence: Math.min(100, p.confidence + (hasFailures && p.safetyLevel !== "safe" ? -10 : 0) - (trustScore < 50 ? 15 : 0)),
    })).sort((a, b) => b.adjustedConfidence - a.adjustedConfidence);

    return {
        ok:       true,
        paths:    eligible,
        primary:  eligible[0] || null,
        approvalRequired: eligible[0]?.requiresApproval || false,
        explainer: eligible[0] ? `Best path: '${eligible[0].id}' (${eligible[0].adjustedConfidence}% confidence)` : "No eligible paths",
    };
}

// ── Recovery sequence ranking ─────────────────────────────────────────────────

function rankCrossEnvRecoverySequences(errorContext = "", { envs = [], trustScore = 65 } = {}) {
    const sequences = [];

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) { try { const r = arc.chooseRecoveryPath(errorContext); if (r.ok) sequences.push({ source: "adaptive", ...r.chosen }); } catch {} }

    const sdp = _tryRequire("./strategicDebugPlanning.cjs");
    if (sdp) { try { const r = sdp.compareDebugRecoveryPaths(errorContext); if (r.ok && r.primary) sequences.push({ source: "strategy", ...r.primary }); } catch {} }

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee && envs.length > 0) {
        envs.forEach(env => {
            try {
                const r = cee.recoverEnvironment(env, errorContext);
                if (r.ok) sequences.push({ source: `env-recovery-${env}`, path: r.plan[0], confidence: r.autonomous ? 70 : 50, env });
            } catch {}
        });
    }

    sequences.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    return {
        ok:       true,
        sequences,
        primary:  sequences[0] || null,
        approvalRequired: sequences[0]?.requiresApproval || sequences[0]?.source?.startsWith("env-recovery") || false,
        explainer: sequences[0] ? `Best recovery: '${sequences[0].path}' via ${sequences[0].source}` : "No recovery sequences available",
    };
}

// ── Deployment strategy comparison ────────────────────────────────────────────

function compareDeploymentStrategies(strategies = []) {
    if (!strategies.length) return { ok: false, error: "No strategies provided" };

    const scored = strategies.map(s => {
        let score = 50;
        if (s.phasedApproach)    score += 20;
        if (s.hasCanary)         score += 15;
        if (s.rollbackAvailable) score += 15;
        if (s.healthChecks)      score += 10;
        if (s.requiresApproval)  score += 5;
        if (s.skipValidation)    score -= 30;
        if (s.autonomous && s.risky) score -= 20;
        return { ...s, score: Math.max(0, Math.min(100, score)) };
    }).sort((a, b) => b.score - a.score);

    return {
        ok:          true,
        ranked:      scored,
        recommended: scored[0],
        worst:       scored[scored.length - 1],
        explainer:   `Recommended: '${scored[0]?.id || "unknown"}' (score=${scored[0]?.score})`,
        approvalRequired: true,
    };
}

// ── Unstable coordination state detection ────────────────────────────────────

function detectUnstableCoordinationStates() {
    const issues = [];

    const cee = _tryRequire("./crossEnvironmentExecution.cjs");
    if (cee) {
        try {
            const summary = cee.crossEnvSummary();
            if (summary.interrupted > 0) issues.push({ factor: "interrupted-cross-env-contexts", count: summary.interrupted });
        } catch {}
    }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) {
        try {
            const storm = lhs.reconnectStormStatus();
            if (storm.storm) issues.push({ factor: "reconnect-storm", count: storm.recentCount, severity: "critical" });
        } catch {}
    }

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const patterns = esi.detectUnstablePatterns();
            if (patterns.unstable) issues.push({ factor: "unstable-execution-patterns", count: patterns.patterns.length });
        } catch {}
    }

    const boc = _tryRequire("./browserOperationCoordination.cjs");
    if (boc) {
        try {
            const stale = boc.detectStaleBrowserSessions();
            if (stale.staleCount > 0) issues.push({ factor: "stale-browser-sessions", count: stale.staleCount });
        } catch {}
    }

    const criticalCount = issues.filter(i => i.severity === "critical").length;
    return {
        ok:       criticalCount === 0,
        issues,
        critical: criticalCount,
        stable:   issues.length === 0,
        recommendation: issues.length > 0
            ? `${issues.length} coordination issue(s) — address critical first`
            : "Coordination states stable",
    };
}

// ── Safer operational flow recommendations ────────────────────────────────────

function recommendSaferOperationalFlows(context = {}) {
    const recommendations = [];
    const { riskLevel = "unknown", trustScore = 65, envCount = 1, deploymentActive = false } = context;

    if (riskLevel === "high" || riskLevel === "critical") {
        recommendations.push({ id: "staged-recovery", description: "Execute recovery in stages with validation between each environment", confidence: 90 });
    }

    if (trustScore < 50) {
        recommendations.push({ id: "increase-approval-gates", description: "Add approval gates for all non-trivial operations until trust recovers", confidence: 85 });
    }

    if (envCount > 3) {
        recommendations.push({ id: "isolate-environments", description: "Coordinate fewer environments simultaneously to reduce complexity", confidence: 80 });
    }

    if (deploymentActive) {
        recommendations.push({ id: "pause-non-critical", description: "Pause non-critical workflows during active deployment", confidence: 75 });
    }

    if (recommendations.length === 0) {
        recommendations.push({ id: "maintain-monitoring", description: "Continue monitoring — no immediate action required", confidence: 95 });
    }

    recommendations.sort((a, b) => b.confidence - a.confidence);
    return {
        ok:           true,
        recommendations,
        primary:      recommendations[0],
        count:        recommendations.length,
        explainer:    `Recommended: '${recommendations[0].id}' (${recommendations[0].confidence}% confidence)`,
    };
}

// ── Decision coordination summary ─────────────────────────────────────────────

function decisionCoordinationSummary(context = {}) {
    const paths    = prioritizeCrossEnvExecutionPaths(context);
    const unstable = detectUnstableCoordinationStates();
    const flows    = recommendSaferOperationalFlows(context);

    return {
        ok:              true,
        primaryPath:     paths.primary?.id || null,
        unstableIssues:  unstable.issues.length,
        recommendation:  flows.primary?.id || null,
        approvalRequired: paths.approvalRequired || unstable.critical > 0,
        summary:         `Decision coord: path='${paths.primary?.id || "none"}' issues=${unstable.issues.length} rec='${flows.primary?.id || "none"}'`,
    };
}

module.exports = { prioritizeCrossEnvExecutionPaths, rankCrossEnvRecoverySequences, compareDeploymentStrategies, detectUnstableCoordinationStates, recommendSaferOperationalFlows, decisionCoordinationSummary };
