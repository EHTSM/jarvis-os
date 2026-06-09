"use strict";
/**
 * Phase 678 — Workflow Strategy Coordination
 *
 * Execution order optimization, stabilization chain prioritization,
 * replay-safe workflow coordination, bottleneck identification,
 * safer execution path suggestions.
 * PREVENTS: recursive growth, unsafe branching, hidden orchestration.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

// ── Execution order optimization ──────────────────────────────────────────────

function optimizeExecutionOrder(workflows = []) {
    if (!workflows.length) return { ok: false, error: "No workflows provided" };

    const scored = workflows.map(w => {
        let priority = 50;
        if (w.critical)          priority += 30;
        if (w.hasBlocker)        priority += 20;
        if (w.depth <= 2)        priority += 10;
        if (w.depth >= 6)        priority -= 15;
        if (w.retryCount >= 3)   priority -= 10;
        if (w.replayable)        priority += 5;
        if (w.validated)         priority += 8;
        return { ...w, priority: Math.max(0, Math.min(100, priority)) };
    }).sort((a, b) => b.priority - a.priority);

    // Detect if any workflow depends on another and reorder
    const dae = _tryRequire("./dependencyAwareExecution.cjs");
    let depOrder = null;
    if (dae && workflows.some(w => w.graphName)) {
        try {
            const graphName = workflows.find(w => w.graphName)?.graphName;
            if (graphName) depOrder = dae.getExecutionOrder(graphName);
        } catch {}
    }

    return {
        ok:       true,
        optimized: scored,
        primary:   scored[0],
        depOrder:  depOrder?.order || null,
        explainer: `Optimized ${scored.length} workflows — primary: '${scored[0]?.id || "unknown"}' (priority=${scored[0]?.priority})`,
    };
}

// ── Stabilization chain prioritization ───────────────────────────────────────

function prioritizeStabilizationChains(context = {}) {
    const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
    let steps = null;
    if (arc) { try { steps = arc.prioritizeStabilization(context); } catch {} }

    const odp = _tryRequire("./operationalDecisionPrioritization.cjs");
    let ranked = null;
    if (odp) { try { ranked = odp.rankStabilizationPaths(context); } catch {} }

    return {
        ok:            true,
        stabilizationSteps: steps?.steps || [],
        rankedPaths:        ranked?.ranked || [],
        primary:            ranked?.primary || null,
        approvalRequired:   steps?.approvalRequired || ranked?.approvalRequired || false,
        explainer:          `Stabilization: ${steps?.steps?.length || 0} steps, primary path='${ranked?.primary?.id || "none"}'`,
    };
}

// ── Replay-safe workflow coordination ─────────────────────────────────────────

function coordinateReplaySafeWorkflows(workflows = []) {
    const safe     = [];
    const unsafe   = [];

    workflows.forEach(w => {
        const issues = [];
        if (w.depth >= 8)           issues.push("depth-at-limit");
        if (w.noReplayId)           issues.push("no-replay-id");
        if (w.hasStateMutation && !w.approved) issues.push("unapproved-mutation");
        if (w.duplicateRisk)        issues.push("duplicate-risk");

        if (issues.length === 0) safe.push({ ...w, replaySafe: true });
        else                     unsafe.push({ ...w, replaySafe: false, issues });
    });

    return {
        ok:          true,
        safe,
        unsafe,
        safeCount:   safe.length,
        unsafeCount: unsafe.length,
        approvalRequired: unsafe.some(w => w.issues.includes("unapproved-mutation")),
        explainer:   `Replay-safe: ${safe.length}/${workflows.length} workflows safe`,
    };
}

// ── Bottleneck identification ─────────────────────────────────────────────────

function identifyWorkflowBottlenecks(workflows = []) {
    const bottlenecks = [];

    workflows.forEach(w => {
        const reasons = [];
        if (w.avgDurationMs > 30000)   reasons.push({ factor: "slow-execution",     ms: w.avgDurationMs });
        if (w.retryCount >= 3)         reasons.push({ factor: "repeated-retries",   count: w.retryCount });
        if (w.blockedByDependency)     reasons.push({ factor: "dep-blocked",        dep: w.blockedByDependency });
        if (w.depth >= 5)              reasons.push({ factor: "deep-chain",         depth: w.depth });
        if (w.approvalPending)         reasons.push({ factor: "approval-pending" });

        if (reasons.length > 0) {
            bottlenecks.push({
                id:        w.id,
                reasons,
                severity:  reasons.length >= 3 ? "high" : reasons.length >= 2 ? "medium" : "low",
                suggestion: _bottleneckSuggestion(reasons),
            });
        }
    });

    bottlenecks.sort((a, b) => { const o = { high: 0, medium: 1, low: 2 }; return o[a.severity] - o[b.severity]; });

    return {
        ok:           true,
        bottlenecks,
        count:        bottlenecks.length,
        high:         bottlenecks.filter(b => b.severity === "high").length,
        recommendation: bottlenecks.length > 0
            ? `${bottlenecks.length} bottleneck(s) found — address '${bottlenecks[0]?.id}' first`
            : "No bottlenecks detected",
    };
}

function _bottleneckSuggestion(reasons) {
    if (reasons.some(r => r.factor === "dep-blocked"))      return "Resolve blocking dependency first";
    if (reasons.some(r => r.factor === "slow-execution"))   return "Add checkpoint and split into smaller steps";
    if (reasons.some(r => r.factor === "repeated-retries")) return "Add circuit breaker and exponential backoff";
    if (reasons.some(r => r.factor === "deep-chain"))       return "Flatten chain into sequential independent tasks";
    if (reasons.some(r => r.factor === "approval-pending")) return "Escalate approval request to operator";
    return "Review workflow configuration";
}

// ── Safer execution path suggestions ─────────────────────────────────────────

function suggestSaferExecutionPaths(workflows = [], { trustScore = 65 } = {}) {
    const suggestions = [];

    workflows.forEach(w => {
        const alts = [];

        if ((w.depth || 0) >= 5)
            alts.push({ suggestion: "flatten-chain",    description: "Break into sequential tasks with validation between", confidence: 85 });
        if (!w.approvalRequired && (w.risky || w.modifiesSharedState))
            alts.push({ suggestion: "add-approval-gate", description: "Add operator approval before risky step", confidence: 90 });
        if (w.noCheckpoint)
            alts.push({ suggestion: "add-checkpoint",   description: "Persist state after each significant step", confidence: 80 });
        if (trustScore < 50 && w.autonomous)
            alts.push({ suggestion: "reduce-autonomy",  description: "Require operator review given low trust score", confidence: 75 });

        if (alts.length > 0) {
            alts.sort((a, b) => b.confidence - a.confidence);
            suggestions.push({ id: w.id, alternatives: alts, primary: alts[0] });
        }
    });

    return {
        ok:          true,
        suggestions,
        count:       suggestions.length,
        explainer:   suggestions.length > 0
            ? `${suggestions.length} workflow(s) have safer alternatives`
            : "All workflows appear safe",
    };
}

// ── Workflow strategy summary ─────────────────────────────────────────────────

function workflowStrategySummary(workflows = [], context = {}) {
    const order       = optimizeExecutionOrder(workflows);
    const stabilize   = prioritizeStabilizationChains(context);
    const bottlenecks = identifyWorkflowBottlenecks(workflows);

    return {
        ok:           true,
        optimizedOrder: order.primary?.id || null,
        bottleneckCount: bottlenecks.count,
        stabilizationPath: stabilize.primary?.id || null,
        approvalRequired: stabilize.approvalRequired,
        summary: `Workflow strategy: primary='${order.primary?.id || "none"}' bottlenecks=${bottlenecks.count} stabilize='${stabilize.primary?.id || "none"}'`,
    };
}

module.exports = { optimizeExecutionOrder, prioritizeStabilizationChains, coordinateReplaySafeWorkflows, identifyWorkflowBottlenecks, suggestSaferExecutionPaths, workflowStrategySummary };
