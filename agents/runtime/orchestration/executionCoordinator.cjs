"use strict";
/**
 * executionCoordinator — coordinates workflow sequencing and parallel-safe execution.
 *
 * coordinate(plan, opts)     → CoordinationDecision
 * sequence(plans)            → Plan[]  (topological order)
 * getParallelGroups(plans)   → Plan[][] (groups that can run concurrently)
 * routeExecution(plan, ctx)  → RouteDecision
 */

const osm  = require("./orchestrationStateMachine.cjs");
const tele = require("./orchestrationTelemetry.cjs");

// ── coordinate ────────────────────────────────────────────────────────

function coordinate(plan, opts = {}) {
    const fsm           = osm.create(osm.STATES.QUEUED);
    const classification = opts.classification ?? "safe";
    const rollbackNeeded = opts.rollbackReady  ?? false;
    const sandboxNeeded  = opts.sandboxRequired ?? false;

    // Transition: queued → scheduled
    fsm.transition(osm.STATES.SCHEDULED);

    // Check for throttle
    if (opts.throttled) {
        fsm.transition(osm.STATES.THROTTLED);
        tele.emit("throttling_event", { taskId: plan.taskId ?? plan.id, reason: opts.throttleReason });
        return { state: fsm.state, strategy: "throttled", fsm };
    }

    // Check for isolation
    if (opts.isolated) {
        fsm.transition(osm.STATES.ISOLATED);
        tele.emit("isolation_event", { taskId: plan.taskId ?? plan.id, reason: opts.isolationReason });
        return { state: fsm.state, strategy: "isolated", fsm };
    }

    // Transition: scheduled → running
    fsm.transition(osm.STATES.RUNNING);

    // Determine execution path
    let strategy;
    if (sandboxNeeded || classification === "dangerous" || classification === "destructive") {
        fsm.transition(osm.STATES.SANDBOXED);
        strategy = "sandbox";
    } else if (opts.staged) {
        fsm.transition(osm.STATES.STAGED);
        strategy = "staged";
    } else {
        strategy = opts.strategy ?? "safe";
    }

    tele.emit("scheduling_decision", {
        taskId:   plan.taskId ?? plan.id,
        strategy,
        classification,
        state:    fsm.state,
    });

    return { state: fsm.state, strategy, fsm };
}

// ── sequence ──────────────────────────────────────────────────────────

function sequence(plans = []) {
    // Build adjacency for topological sort based on plan.deps
    const ids    = plans.map(p => p.taskId ?? p.id ?? "unknown");
    const byId   = Object.fromEntries(plans.map(p => [p.taskId ?? p.id ?? "unknown", p]));
    const inDeg  = Object.fromEntries(ids.map(id => [id, 0]));
    const edges  = {};

    for (const id of ids) {
        const plan = byId[id];
        for (const dep of (plan.deps ?? [])) {
            if (byId[dep]) {
                inDeg[id]     = (inDeg[id] ?? 0) + 1;
                edges[dep]    = edges[dep] ?? [];
                edges[dep].push(id);
            }
        }
    }

    const queue  = ids.filter(id => inDeg[id] === 0).sort();
    const result = [];

    while (queue.length > 0) {
        const id = queue.shift();
        result.push(byId[id]);
        for (const next of (edges[id] ?? []).sort()) {
            inDeg[next]--;
            if (inDeg[next] === 0) {
                // insert in sorted order
                const pos = queue.findIndex(q => q > next);
                if (pos === -1) queue.push(next);
                else queue.splice(pos, 0, next);
            }
        }
    }

    // Append any unresolved (cycle guard)
    const placed = new Set(result.map(p => p.taskId ?? p.id ?? "unknown"));
    for (const id of ids) {
        if (!placed.has(id)) result.push(byId[id]);
    }

    return result;
}

// ── getParallelGroups ─────────────────────────────────────────────────

function getParallelGroups(plans = []) {
    // Plans with no deps or all deps already in prior groups can run in parallel
    const groups = [];
    const done   = new Set();

    let remaining = [...plans];
    while (remaining.length > 0) {
        const group = [];
        const next  = [];
        for (const plan of remaining) {
            const deps = plan.deps ?? [];
            if (deps.every(d => done.has(d))) {
                group.push(plan);
            } else {
                next.push(plan);
            }
        }
        if (group.length === 0) {
            // Deadlock guard: push all remaining as one group
            groups.push(next);
            break;
        }
        groups.push(group);
        for (const p of group) done.add(p.taskId ?? p.id ?? "unknown");
        remaining = next;
    }

    return groups;
}

// ── routeExecution ────────────────────────────────────────────────────

function routeExecution(plan, ctx = {}) {
    const classification = ctx.classification ?? "safe";
    const circuitOpen    = ctx.circuitOpen    ?? false;
    const quarantined    = ctx.quarantined    ?? false;
    const rollbackReady  = ctx.rollbackReady  ?? false;

    if (quarantined) {
        return { route: "quarantine", strategy: "sandbox", reason: "quarantined" };
    }
    if (circuitOpen) {
        return { route: "blocked", strategy: null, reason: "circuit_open" };
    }
    if (classification === "destructive") {
        return { route: "sandbox",   strategy: "sandbox",         reason: "destructive_classification" };
    }
    if (classification === "dangerous") {
        return { route: "sandbox",   strategy: "sandbox",         reason: "dangerous_classification" };
    }
    if (rollbackReady && classification === "elevated") {
        return { route: "staged",    strategy: "staged",          reason: "elevated_with_rollback" };
    }
    return { route: "direct", strategy: ctx.strategy ?? "safe", reason: "normal" };
}

module.exports = { coordinate, sequence, getParallelGroups, routeExecution };
