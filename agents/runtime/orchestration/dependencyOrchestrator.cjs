"use strict";
/**
 * dependencyOrchestrator — dependency-aware workflow routing.
 *
 * mapDependencies(plans)                       → DepGraph
 * identifyUnstableChains(plans, depStability)  → UnstableChain[]
 * rerouteAroundDegraded(plan, depStability)    → RerouteResult
 * prioritizeStablePaths(plans, depStability)   → Plan[]
 * resolve(fingerprint, depStability)           → Resolution
 */

// ── mapDependencies ───────────────────────────────────────────────────

function mapDependencies(plans = []) {
    const graph = {};
    for (const plan of plans) {
        const id   = plan.taskId ?? plan.id ?? "unknown";
        const deps = plan.deps ?? [];
        graph[id]  = {
            id,
            deps,
            stepCount: (plan.steps ?? plan.executionOrder ?? []).length,
        };
    }
    return graph;
}

// ── identifyUnstableChains ────────────────────────────────────────────

function identifyUnstableChains(plans = [], depStability = {}, threshold = 0.7) {
    const unstable = [];
    for (const plan of plans) {
        const id         = plan.taskId ?? plan.id ?? "unknown";
        const deps       = plan.deps ?? _extractStepDeps(plan);
        const badDeps    = deps.filter(d => (depStability[d]?.stability ?? 1.0) < threshold);
        if (badDeps.length > 0) {
            const avgStab = badDeps.reduce((s, d) => s + (depStability[d]?.stability ?? 0), 0) / badDeps.length;
            unstable.push({ planId: id, unstableDeps: badDeps, avgStability: avgStab, threshold });
        }
    }
    return unstable;
}

// ── rerouteAroundDegraded ─────────────────────────────────────────────

function rerouteAroundDegraded(plan, depStability = {}, threshold = 0.5) {
    const steps       = plan.steps ?? [];
    const rerouted    = [];
    const skipped     = [];

    for (const step of steps) {
        const depId    = step.id;
        const stability = depStability[depId]?.stability ?? 1.0;
        if (stability < threshold) {
            skipped.push({ stepId: depId, stability, reason: "dep_degraded" });
        } else {
            rerouted.push(step);
        }
    }

    return {
        plan:      { ...plan, steps: rerouted },
        rerouted:  rerouted.length,
        skipped:   skipped.length,
        skippedSteps: skipped,
        changed:   skipped.length > 0,
    };
}

// ── prioritizeStablePaths ─────────────────────────────────────────────

function prioritizeStablePaths(plans = [], depStability = {}) {
    return [...plans]
        .map(plan => {
            const deps   = plan.deps ?? _extractStepDeps(plan);
            const avgStab = deps.length > 0
                ? deps.reduce((s, d) => s + (depStability[d]?.stability ?? 1.0), 0) / deps.length
                : 1.0;
            return { plan, avgDepStability: avgStab };
        })
        .sort((a, b) => b.avgDepStability - a.avgDepStability)
        .map(x => x.plan);
}

// ── resolve ───────────────────────────────────────────────────────────

function resolve(fingerprint, depStability = {}) {
    const depEntries = Object.entries(depStability);
    if (depEntries.length === 0) {
        return { fingerprint, stable: true, avgStability: 1.0, degradedDeps: [], recommendation: "proceed" };
    }
    const degraded    = depEntries.filter(([, v]) => (v.stability ?? 1.0) < 0.7);
    const avgStab     = depEntries.reduce((s, [, v]) => s + (v.stability ?? 1.0), 0) / depEntries.length;
    const stable      = degraded.length === 0 && avgStab >= 0.7;

    return {
        fingerprint,
        stable,
        avgStability:  avgStab,
        degradedDeps:  degraded.map(([id, v]) => ({ depId: id, stability: v.stability ?? 0 })),
        recommendation: stable ? "proceed" : degraded.length > 0 ? "reroute" : "proceed_with_caution",
    };
}

// ── helpers ───────────────────────────────────────────────────────────

function _extractStepDeps(plan) {
    return (plan.steps ?? []).map(s => s.id ?? s).filter(Boolean);
}

module.exports = {
    mapDependencies, identifyUnstableChains, rerouteAroundDegraded,
    prioritizeStablePaths, resolve,
};
