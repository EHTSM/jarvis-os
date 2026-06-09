"use strict";
/**
 * Phase 672 — Engineering Productivity Coordination
 *
 * Debugging flow coordination, deployment sequencing, replay navigation,
 * workflow discoverability, operational calmness, readability intelligence.
 * Read-mostly aggregation. Operator-controlled actions.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Debugging flow coordination ───────────────────────────────────────────────

function coordinateDebuggingFlow(errorContext = "", { sessionId = null, trustScore = 65 } = {}) {
    const steps = [];

    // Get debug plan from smart debug intelligence
    const sdi = _tryRequire("./smartDebugIntelligence.cjs");
    if (sdi && errorContext) {
        try {
            const plan = sdi.buildDebugPlan(errorContext);
            if (plan.ok) steps.push(...plan.steps.map(s => ({ source: "smart-debug", ...s })));
        } catch {}
    }

    // Prioritize actions from decision prioritization
    const odp = _tryRequire("./operationalDecisionPrioritization.cjs");
    if (odp && errorContext) {
        try {
            const priority = odp.prioritizeDebuggingActions(errorContext, { trustScore });
            if (priority.ok) steps.push({ source: "decision-priority", action: priority.primary?.action, priority: priority.primary?.adjustedPriority });
        } catch {}
    }

    // Correlate context
    const ecc = _tryRequire("./engineeringContextCoordination.cjs");
    let correlation = null;
    if (ecc && errorContext) {
        try { correlation = ecc.correlateDebuggingSessions(errorContext); } catch {}
    }

    // Choose recovery path
    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    let recoveryPath = null;
    if (arc && errorContext) {
        try { recoveryPath = arc.chooseRecoveryPath(errorContext, { sessionId }); } catch {}
    }

    return {
        ok:           true,
        errorContext: errorContext.slice(0, 100),
        steps:        steps.slice(0, 10),
        correlation,
        recoveryPath: recoveryPath?.chosen || null,
        approvalRequired: recoveryPath?.approvalRequired || false,
        summary:      `Debug coordination: ${steps.length} steps, recovery=${recoveryPath?.chosen?.path || "none"}`,
    };
}

// ── Deployment sequencing ─────────────────────────────────────────────────────

function coordinateDeploymentSequence(deploymentId = "", { operatorApproved = false } = {}) {
    if (!operatorApproved) return { ok: false, requiresApproval: true };

    const sequence = [];

    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    if (dae) {
        try {
            const deps = dae.checkDeploymentDependencies(deploymentId, []);
            sequence.push({ step: "dep-check", ok: deps.ok, detail: deps.recommendation });
        } catch {}
    }

    const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
    if (sdc) {
        try {
            const readiness = sdc.checkDeploymentReadiness(deploymentId);
            sequence.push({ step: "readiness", ok: readiness.ready, detail: readiness.recommendation });
        } catch {}
    }

    const ecc = _tryRequire("./engineeringContextCoordination.cjs");
    if (ecc) {
        try {
            ecc.preserveDeploymentContext(deploymentId, { goal: `deployment sequence for ${deploymentId}` });
            sequence.push({ step: "context-saved", ok: true, detail: "Deployment context preserved" });
        } catch {}
    }

    const allOk = sequence.every(s => s.ok !== false);
    return {
        ok:       allOk,
        deploymentId,
        sequence,
        ready:    allOk,
        blockers: sequence.filter(s => !s.ok).map(s => s.step),
        recommendation: allOk ? "Deployment sequence ready" : `Blockers: ${sequence.filter(s => !s.ok).map(s => s.step).join(", ")}`,
    };
}

// ── Replay navigation ─────────────────────────────────────────────────────────

function navigateReplayHistory(goal = "", { env = null } = {}) {
    const candidates = [];

    const emc = _tryRequire("./executionMemoryCoordination.cjs");
    if (emc) {
        try {
            const matches = emc.prioritizeRepeatedSuccesses(goal, { env });
            candidates.push(...matches.matches.map(m => ({ source: "memory-coord", chainId: m.chainId, hitCount: m.hitCount, goal: m.goal })));
        } catch {}
    }

    const awm = _tryRequire("./autonomousWorkflowMemory.cjs");
    if (awm && goal) {
        try {
            const recalled = awm.recall(goal, { limit: 3 });
            recalled.results.forEach(r => candidates.push({ source: "workflow-memory", ...r }));
        } catch {}
    }

    candidates.sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0) || (b.score || 0) - (a.score || 0));

    return {
        ok:         true,
        goal,
        candidates: candidates.slice(0, 5),
        primary:    candidates[0] || null,
        count:      candidates.length,
    };
}

// ── Workflow discoverability ──────────────────────────────────────────────────

function discoverAvailableWorkflows(goal = "") {
    const workflows = [];

    const dec = _tryRequire("./dailyEngineeringCoordination.cjs");
    if (dec) {
        try {
            const catalog = dec.catalogSequences();
            catalog.forEach(s => {
                const relevant = !goal || s.type.includes(goal.toLowerCase()) || goal.toLowerCase().includes(s.type);
                if (relevant) workflows.push({ type: "engineering-sequence", id: s.type, stepCount: s.stepCount, requiresApproval: s.requiresApproval });
            });
        } catch {}
    }

    const dea = _tryRequire("./dailyExecutionAutomation.cjs");
    if (dea) {
        try {
            const catalog = dea.catalogList();
            (catalog.catalogs || []).forEach(c => {
                const relevant = !goal || c.id.includes(goal.toLowerCase());
                if (relevant) workflows.push({ type: "execution-automation", id: c.id, description: c.description });
            });
        } catch {}
    }

    return {
        ok:        true,
        goal,
        workflows,
        count:     workflows.length,
        primary:   workflows[0] || null,
    };
}

// ── Operational calmness ──────────────────────────────────────────────────────

function operationalCalmnessScore() {
    const factors = [];
    let score = 100;

    const esi = _tryRequire("./executionStateIntelligence.cjs");
    if (esi) {
        try {
            const state = esi.executionStateSummary();
            if (!state.stable)                    { score -= 20; factors.push({ factor: "unstable-execution",  impact: -20 }); }
            if (state.pressure?.level === "high")  { score -= 15; factors.push({ factor: "high-pressure",      impact: -15 }); }
            if (state.interrupted?.count > 0)      { score -= 5 * Math.min(state.interrupted.count, 4); factors.push({ factor: "interrupted-workflows", count: state.interrupted.count, impact: -5 }); }
        } catch {}
    }

    const lhs = _tryRequire("./longHorizonExecutionSurvivability.cjs");
    if (lhs) {
        try {
            const health = lhs.survivabilityHealth();
            if (health.storm) { score -= 25; factors.push({ factor: "reconnect-storm", impact: -25 }); }
        } catch {}
    }

    const eri = _tryRequire("./executionRiskIntelligence.cjs");
    if (eri) {
        try {
            const risk = eri.riskSummary({ windowMs: 4 * 60 * 60 * 1000 });
            if (risk.overall === "high")     { score -= 20; factors.push({ factor: "high-risk",   impact: -20 }); }
            if (risk.overall === "moderate") { score -= 8;  factors.push({ factor: "medium-risk", impact: -8  }); }
        } catch {}
    }

    score = Math.max(0, score);
    const level = score >= 80 ? "calm" : score >= 60 ? "moderate" : "stressed";

    return { ok: true, score, level, factors, summary: `Operational calmness: ${score}/100 (${level})` };
}

// ── Readability intelligence ──────────────────────────────────────────────────

function buildReadabilityReport(context = {}) {
    const sections = [];

    const calmness = operationalCalmnessScore();
    sections.push({ section: "calmness", level: calmness.level, score: calmness.score });

    const ecc = _tryRequire("./engineeringContextCoordination.cjs");
    if (ecc) {
        try {
            const contexts = ecc.listContexts({ limit: 5 });
            sections.push({ section: "active-contexts", count: contexts.length, items: contexts.map(c => ({ id: c.contextId, type: c.type })) });
        } catch {}
    }

    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    if (arc) {
        try {
            const summary = arc.recoverySummary({ windowMs: 4 * 60 * 60 * 1000 });
            sections.push({ section: "recovery-health", ok: summary.ok, problematic: summary.problematic.length });
        } catch {}
    }

    return { ok: true, sections, calmness: calmness.level, summary: `Readability report: ${sections.length} sections, calmness=${calmness.level}` };
}

// ── Full productivity coordination summary ────────────────────────────────────

function productivityCoordinationSummary() {
    const calmness   = operationalCalmnessScore();
    const workflows  = discoverAvailableWorkflows("");
    const replayNav  = navigateReplayHistory("");

    return {
        ok:           true,
        calmness:     { score: calmness.score, level: calmness.level },
        workflows:    { count: workflows.count },
        replayChains: { count: replayNav.count },
        summary:      `Productivity coordination: calmness=${calmness.level} workflows=${workflows.count} replays=${replayNav.count}`,
    };
}

module.exports = { coordinateDebuggingFlow, coordinateDeploymentSequence, navigateReplayHistory, discoverAvailableWorkflows, operationalCalmnessScore, buildReadabilityReport, productivityCoordinationSummary };
