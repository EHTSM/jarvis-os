"use strict";
/**
 * Phase 671 — Execution Coordination Stress Test
 *
 * 8-test validation of the 661-670 execution coordination range.
 * Tests: priority engine, dependency execution, adaptive recovery,
 * execution state, deployment coordination, context coordination,
 * decision prioritization, memory coordination.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const THRESHOLD = 0.75;

const TESTS = [
    {
        name: "priority-engine",
        description: "Execution priority engine prioritizes workflows correctly",
        run() {
            const epe = _tryRequire("./executionPriorityEngine.cjs");
            if (!epe) return { pass: false, reason: "module unavailable" };

            const result = epe.prioritizeWorkflows({ hasFailures: true, trustScore: 70 });
            if (!result.ok) return { pass: false, reason: "prioritizeWorkflows failed" };
            if (!Array.isArray(result.ranked)) return { pass: false, reason: "ranked not array" };

            const urgency = epe.checkRecoveryUrgency();
            if (!urgency.ok) return { pass: false, reason: "checkRecoveryUrgency failed" };

            return { pass: true };
        },
    },
    {
        name: "dependency-aware-execution",
        description: "Dependency graph register, topological sort, and stale detection",
        run() {
            const dae = _tryRequire("./dependencyAwareExecution.cjs");
            if (!dae) return { pass: false, reason: "module unavailable" };

            const reg = dae.registerDependencyGraph("test-graph-671", { "b": ["a"], "c": ["b"] });
            if (!reg.ok) return { pass: false, reason: "registerDependencyGraph failed" };

            const order = dae.getExecutionOrder("test-graph-671");
            if (!order.ok) return { pass: false, reason: "getExecutionOrder failed" };
            if (order.hasCycle) return { pass: false, reason: "cycle detected in valid graph" };
            if (!order.order.includes("a")) return { pass: false, reason: "topological order missing node a" };

            const stale = dae.detectStaleDependencyChains();
            if (stale.ok === undefined) return { pass: false, reason: "detectStaleDependencyChains missing ok" };

            return { pass: true };
        },
    },
    {
        name: "adaptive-recovery-coordination",
        description: "Recovery path selection, failure suppression, rollback comparison",
        run() {
            const arc = _tryRequire("./adaptiveRecoveryCoordination.cjs");
            if (!arc) return { pass: false, reason: "module unavailable" };

            const chosen = arc.chooseRecoveryPath("connection refused", { sessionId: "test-671" });
            if (!chosen.ok) return { pass: false, reason: "chooseRecoveryPath failed" };
            if (!chosen.chosen?.path) return { pass: false, reason: "no chosen path" };

            const rollback = arc.compareRollbackOptions([
                { id: "snapshot-a", hasSnapshot: true, validatedRecently: true, affectedServices: 1, tested: true },
                { id: "rollback-b", hasSnapshot: false, stale: true, affectedServices: 5 },
            ]);
            if (!rollback.ok) return { pass: false, reason: "compareRollbackOptions failed" };
            if (rollback.recommended?.id !== "snapshot-a") return { pass: false, reason: "wrong rollback recommended" };

            return { pass: true };
        },
    },
    {
        name: "execution-state-intelligence",
        description: "Execution state summary aggregates pressure, replay, degradation",
        run() {
            const esi = _tryRequire("./executionStateIntelligence.cjs");
            if (!esi) return { pass: false, reason: "module unavailable" };

            const pressure = esi.activeWorkflowPressure();
            if (!("pressure" in pressure)) return { pass: false, reason: "pressure field missing" };

            const summary = esi.executionStateSummary();
            if (!("stable" in summary)) return { pass: false, reason: "stable field missing" };
            if (!summary.summary) return { pass: false, reason: "summary string missing" };

            const interrupted = esi.interruptedWorkflowStates();
            if (!("count" in interrupted)) return { pass: false, reason: "interrupted count missing" };

            return { pass: true };
        },
    },
    {
        name: "smart-deployment-coordination",
        description: "Deployment readiness check and phased plan creation",
        run() {
            const sdc = _tryRequire("./smartDeploymentCoordination.cjs");
            if (!sdc) return { pass: false, reason: "module unavailable" };

            const readiness = sdc.checkDeploymentReadiness("stress-test-671");
            if (readiness.ok === undefined) return { pass: false, reason: "readiness ok missing" };

            const plan = sdc.createPhasedDeploymentPlan({ deploymentId: "stress-671", service: "test", version: "1.0" });
            if (!plan.ok) return { pass: false, reason: "createPhasedDeploymentPlan failed" };
            if (plan.phases?.length !== 3) return { pass: false, reason: "expected 3 phases" };

            const stale = sdc.detectStaleDeploymentReplays();
            if (stale.ok === undefined) return { pass: false, reason: "detectStale ok missing" };

            return { pass: true };
        },
    },
    {
        name: "engineering-context-coordination",
        description: "Context save/restore and stale cleanup",
        run() {
            const ecc = _tryRequire("./engineeringContextCoordination.cjs");
            if (!ecc) return { pass: false, reason: "module unavailable" };

            const saved = ecc.saveContext("test-ctx-671", { type: "debug", goal: "stress test 671", notes: "automated" });
            if (!saved.ok) return { pass: false, reason: "saveContext failed" };

            const restored = ecc.restoreContext("test-ctx-671");
            if (!restored.ok) return { pass: false, reason: "restoreContext failed" };
            if (restored.record?.goal !== "stress test 671") return { pass: false, reason: "goal mismatch on restore" };

            const cleanup = ecc.cleanupStaleContexts({ dryRun: true });
            if (!("staleCount" in cleanup)) return { pass: false, reason: "staleCount missing" };

            return { pass: true };
        },
    },
    {
        name: "operational-decision-prioritization",
        description: "Stabilization ranking, debug action priority, risky branch detection",
        run() {
            const odp = _tryRequire("./operationalDecisionPrioritization.cjs");
            if (!odp) return { pass: false, reason: "module unavailable" };

            const stab = odp.rankStabilizationPaths({ pressureLevel: "high", hasFailures: true, trustScore: 60, deploymentActive: true });
            if (!stab.ok) return { pass: false, reason: "rankStabilizationPaths failed" };
            if (!stab.primary?.id) return { pass: false, reason: "no primary path" };

            const debug = odp.prioritizeDebuggingActions("connection refused", { trustScore: 70 });
            if (!debug.ok) return { pass: false, reason: "prioritizeDebuggingActions failed" };

            const risky = odp.identifyRiskyBranches([
                { chainId: "chain-a", depth: 7, retryCount: 4, modifiesSharedState: true },
                { chainId: "chain-b", depth: 2, retryCount: 1 },
            ]);
            if (!risky.ok) return { pass: false, reason: "identifyRiskyBranches failed" };
            if (risky.riskyCount === 0) return { pass: false, reason: "expected at least 1 risky chain" };

            return { pass: true };
        },
    },
    {
        name: "execution-memory-coordination",
        description: "Success/failure recording, suppression, and environment recall",
        run() {
            const emc = _tryRequire("./executionMemoryCoordination.cjs");
            if (!emc) return { pass: false, reason: "module unavailable" };

            const success = emc.recordSuccess("chain-671", { goal: "stress test", env: "test" });
            if (!success.ok) return { pass: false, reason: "recordSuccess failed" };

            const recall = emc.prioritizeRepeatedSuccesses("stress test", { env: "test" });
            if (!recall.ok) return { pass: false, reason: "prioritizeRepeatedSuccesses failed" };

            // Record failures to trigger suppression
            for (let i = 0; i < 3; i++) {
                emc.recordFailure("chain-671-fail", { goal: "fail test", env: "test" });
            }
            const suppressed = emc.isSuppressed("chain-671-fail");
            if (!suppressed) return { pass: false, reason: "suppression not triggered after 3 failures" };

            const summary = emc.memoryCoordinationSummary();
            if (!summary.ok) return { pass: false, reason: "memoryCoordinationSummary failed" };

            return { pass: true };
        },
    },
];

function runAll() {
    const results = TESTS.map(t => {
        let result;
        try   { result = t.run(); }
        catch (e) { result = { pass: false, reason: e.message }; }
        return { name: t.name, description: t.description, ...result };
    });

    const passed = results.filter(r => r.pass).length;
    const total  = results.length;
    const score  = passed / total;

    return {
        ok:       score >= THRESHOLD,
        passed,
        total,
        score:    Math.round(score * 100),
        threshold: Math.round(THRESHOLD * 100),
        results,
        failed:   results.filter(r => !r.pass).map(r => ({ name: r.name, reason: r.reason })),
        summary:  `Phase 661-670 stress test: ${passed}/${total} (${Math.round(score * 100)}%) — ${score >= THRESHOLD ? "PASS" : "FAIL"}`,
    };
}

module.exports = { runAll, TESTS };
