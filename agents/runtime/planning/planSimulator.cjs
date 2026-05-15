"use strict";
/**
 * planSimulator — simulate plan execution and detect issues before running.
 *
 * simulate(plan, context?)                      → Promise<{ passed, issues[], blockers[], warnings[], highIssues[], simSummary }>
 * simulateMissingDeps(plan)                     → issues[]
 * simulateCircularChains(plan)                  → issues[]
 * simulateInvalidOrder(plan)                    → issues[]
 * simulateUnsafeCommands(plan)                  → issues[]
 * simulateUnavailableTools(plan, context)       → issues[]
 * simulatePortConflicts(plan, context)          → Promise<issues[]>
 *
 * context.occupiedPorts[]   — bypass real TCP probe for known-occupied ports
 * context.availableTools[]  — tool allowlist (if empty, tool check is skipped)
 */

const net = require("net");
const pr  = require("./planningRules.cjs");

// ── TCP probe ─────────────────────────────────────────────────────────

function _portInUse(port) {
    return new Promise(resolve => {
        const srv = net.createServer();
        srv.unref();
        srv.once("error", () => resolve(true));
        srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(false)));
    });
}

// ── cycle detection (DFS) ─────────────────────────────────────────────

function _detectCycles(deps) {
    const cycles = [];
    const state  = {};

    function dfs(id, path) {
        if (state[id] === "done")     return;
        if (state[id] === "visiting") {
            const start = path.indexOf(id);
            cycles.push([...path.slice(start), id]);
            return;
        }
        state[id] = "visiting";
        for (const dep of (deps[id] ?? []).sort()) dfs(dep, [...path, id]);
        state[id] = "done";
    }

    for (const id of Object.keys(deps).sort()) {
        if (!state[id]) dfs(id, []);
    }
    return cycles;
}

// ── simulateMissingDeps ───────────────────────────────────────────────

function simulateMissingDeps(plan) {
    const issues  = [];
    const stepIds = new Set((plan.steps ?? []).map(s => s.id));

    for (const step of (plan.steps ?? [])) {
        for (const dep of (step.dependsOn ?? [])) {
            if (!stepIds.has(dep)) {
                issues.push({
                    type:     "missing_dependency",
                    stepId:   step.id,
                    dep,
                    severity: "blocker",
                    message:  `Step "${step.id}" depends on unknown step "${dep}"`,
                });
            }
        }
    }
    return issues;
}

// ── simulateCircularChains ────────────────────────────────────────────

function simulateCircularChains(plan) {
    const cycles = _detectCycles(plan.dependencies ?? {});
    return cycles.map(cycle => ({
        type:     "circular_dependency",
        cycle,
        severity: "blocker",
        message:  `Circular dependency: ${cycle.join(" → ")}`,
    }));
}

// ── simulateInvalidOrder ──────────────────────────────────────────────

function simulateInvalidOrder(plan) {
    const order    = plan.executionOrder ?? [];
    const position = {};
    for (let i = 0; i < order.length; i++) position[order[i]] = i;

    const issues = [];
    for (const step of (plan.steps ?? [])) {
        const stepPos = position[step.id] ?? Infinity;
        for (const dep of (step.dependsOn ?? [])) {
            const depPos = position[dep] ?? -1;
            if (depPos > stepPos) {
                issues.push({
                    type:     "invalid_execution_order",
                    stepId:   step.id,
                    dep,
                    severity: "blocker",
                    message:  `Step "${step.id}" appears before dependency "${dep}" in execution order`,
                });
            }
        }
    }
    return issues;
}

// ── simulateUnsafeCommands ────────────────────────────────────────────

function simulateUnsafeCommands(plan) {
    const issues = [];
    for (const step of (plan.steps ?? [])) {
        if (!step.command) continue;
        const result = pr.assessCommandRisk(step.command);
        if (!result.safe) {
            for (const p of result.patterns) {
                const severity = p.severity === "critical" ? "blocker"
                               : p.severity === "high"     ? "high"
                               :                             "warning";
                issues.push({
                    type:     "unsafe_command",
                    stepId:   step.id,
                    pattern:  p.label,
                    severity,
                    message:  `Step "${step.id}" contains unsafe pattern: ${p.label}`,
                });
            }
        }
    }
    return issues;
}

// ── simulateUnavailableTools ──────────────────────────────────────────

function simulateUnavailableTools(plan, context = {}) {
    const available = new Set(context.availableTools ?? []);
    if (available.size === 0) return [];

    const issues = [];
    for (const step of (plan.steps ?? [])) {
        for (const tool of (step.requiredTools ?? [])) {
            if (!available.has(tool)) {
                issues.push({
                    type:     "unavailable_tool",
                    stepId:   step.id,
                    tool,
                    severity: "blocker",
                    message:  `Step "${step.id}" requires tool "${tool}" which is not available`,
                });
            }
        }
    }
    return issues;
}

// ── simulatePortConflicts (async) ─────────────────────────────────────

async function simulatePortConflicts(plan, context = {}) {
    const occupied = new Set(context.occupiedPorts ?? []);
    const issues   = [];

    for (const step of (plan.steps ?? [])) {
        for (const port of (step.requiredPorts ?? [])) {
            const inUse = occupied.has(port) || await _portInUse(port);
            if (inUse) {
                issues.push({
                    type:     "port_conflict",
                    stepId:   step.id,
                    port,
                    severity: "blocker",
                    message:  `Step "${step.id}" requires port ${port} which is in use`,
                });
            }
        }
    }
    return issues;
}

// ── simulate (main) ───────────────────────────────────────────────────

async function simulate(plan, context = {}) {
    const depIssues   = simulateMissingDeps(plan);
    const cycleIssues = simulateCircularChains(plan);
    const orderIssues = simulateInvalidOrder(plan);
    const cmdIssues   = simulateUnsafeCommands(plan);
    const toolIssues  = simulateUnavailableTools(plan, context);
    const portIssues  = await simulatePortConflicts(plan, context);

    const all      = [...depIssues, ...cycleIssues, ...orderIssues, ...cmdIssues, ...toolIssues, ...portIssues];
    const blockers = all.filter(i => i.severity === "blocker");
    const warnings = all.filter(i => i.severity === "warning");
    const highIssues = all.filter(i => i.severity === "high");

    return {
        passed:   blockers.length === 0,
        issues:   all,
        blockers,
        warnings,
        highIssues,
        simSummary: {
            totalIssues:  all.length,
            blockerCount: blockers.length,
            warningCount: warnings.length,
            highCount:    highIssues.length,
            checksRun:    6,
        },
    };
}

module.exports = {
    simulate,
    simulateMissingDeps,
    simulateCircularChains,
    simulateInvalidOrder,
    simulateUnsafeCommands,
    simulateUnavailableTools,
    simulatePortConflicts,
};
