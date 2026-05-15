"use strict";
/**
 * goalDecomposer — task → decomposition → dependency extraction → execution ordering → risk → plan.
 *
 * decompose(task)            → { taskId, steps[], dependencies{}, executionOrder[], riskFactors[], plan }
 * buildPlan(task)            → plan object
 * extractDependencies(steps) → { id: [depIds] }
 * topologicalOrder(steps)    → orderedIds[]  (throws on cycle)
 * estimateRisk(steps)        → riskFactors[]
 */

const pr = require("./planningRules.cjs");

// ── extractDependencies ───────────────────────────────────────────────
// Returns sorted dep arrays for full determinism.

function extractDependencies(steps = []) {
    const deps = {};
    for (const step of steps) {
        deps[step.id] = [...new Set(step.dependsOn ?? [])].sort();
    }
    return deps;
}

// ── topologicalOrder ──────────────────────────────────────────────────
// DFS with alphabetic tie-breaking for determinism. Throws on cycles.

function topologicalOrder(steps = []) {
    const deps  = extractDependencies(steps);
    const ids   = steps.map(s => s.id);
    const order = [];
    const state = {};

    function visit(id) {
        if (state[id] === "done")     return;
        if (state[id] === "visiting") throw new Error(`Cyclic dependency at step: ${id}`);
        state[id] = "visiting";
        for (const dep of (deps[id] ?? []).sort()) visit(dep);
        state[id] = "done";
        order.push(id);
    }

    for (const id of [...ids].sort()) {
        if (!state[id]) visit(id);
    }

    return order;
}

// ── estimateRisk ──────────────────────────────────────────────────────

function estimateRisk(steps = []) {
    const factors = [];

    for (const step of steps) {
        if (step.command) {
            const cr = pr.assessCommandRisk(step.command);
            if (!cr.safe) {
                for (const p of cr.patterns) {
                    factors.push({ stepId: step.id, factor: p.label, severity: p.severity, risk: p.risk });
                }
            }
        }

        const depCount = step.dependsOn?.length ?? 0;
        if (depCount >= 3) {
            factors.push({
                stepId:   step.id,
                factor:   "high_dependency_count",
                severity: depCount >= 5 ? "high" : "medium",
                risk:     depCount >= 5 ? 20 : 10,
            });
        }

        if (step.riskLevel && step.riskLevel !== "low") {
            factors.push({
                stepId:   step.id,
                factor:   "explicit_risk_flag",
                severity: step.riskLevel,
                risk:     pr.RISK_WEIGHTS[step.riskLevel] ?? pr.RISK_WEIGHTS.unknown,
            });
        }
    }

    return factors;
}

// ── decompose ─────────────────────────────────────────────────────────

function decompose(task = {}) {
    const validation  = pr.validateTaskStructure(task);
    const steps       = pr.normalizeStepOrder(task.steps ?? []);
    const deps        = extractDependencies(steps);
    const riskFactors = estimateRisk(steps);
    const totalRisk   = Math.min(100, riskFactors.reduce((s, f) => s + (f.risk ?? 0), 0));

    let executionOrder = [];
    let cycleError     = null;
    try {
        executionOrder = topologicalOrder(steps);
    } catch (e) {
        cycleError = e.message;
    }

    const plan = {
        taskId:           task.id,
        taskName:         task.name,
        steps,
        dependencies:     deps,
        executionOrder,
        riskFactors,
        totalRisk,
        feasible:         !cycleError && validation.valid,
        cycleError:       cycleError ?? null,
        validationErrors: validation.errors,
        estimatedMs:      pr.estimateComplexity(steps) * 10,
        createdAt:        new Date().toISOString(),
    };

    return { taskId: task.id, steps, dependencies: deps, executionOrder, riskFactors, plan };
}

function buildPlan(task = {}) {
    return decompose(task).plan;
}

module.exports = { decompose, buildPlan, extractDependencies, topologicalOrder, estimateRisk };
