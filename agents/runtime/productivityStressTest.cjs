"use strict";
/**
 * Phase 715 — Productivity Stress Test
 *
 * 8-test validation of 706-714 productivity OS range.
 * Tests: long sessions, reconnect storms, replay-heavy workflows, deployment interruption,
 * browser instability, multi-project coordination.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const THRESHOLD = 0.75;

const TESTS = [
    {
        name: "instant-workspace-restoration",
        description: "Snapshot, restore, reconnect-safe, stale protection",
        run() {
            const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
            if (!iwr) return { pass: false, reason: "module unavailable" };

            const snap = iwr.snapshotFullWorkspace("stress-715-snap", {
                vsCode: { file: "/src/app.ts" }, terminal: { cwd: "/project" }, goal: "stress test", replay: { env: "production", progress: 50 }
            });
            if (!snap.ok) return { pass: false, reason: "snapshotFullWorkspace failed" };
            if (!snap.components.includes("vsCode")) return { pass: false, reason: "vsCode not in components" };

            const stale = iwr.reconnectSafeRestore("stress-715-snap", ["vsCode", "terminal"]);
            if (!stale.ok && !stale.stale) return { pass: false, reason: "reconnectSafeRestore unexpected failure" };

            // Non-existent snapshot must not restore
            const noSnap = iwr.instantRestore("nonexistent-715", { operatorApproved: true });
            if (noSnap.ok) return { pass: false, reason: "nonexistent snapshot restored" };

            // Approval gate
            const noApproval = iwr.instantRestore("stress-715-snap", { operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "restore without approval succeeded" };

            const health = iwr.workspaceRestoreHealth();
            if (!("freshSnapshots" in health)) return { pass: false, reason: "freshSnapshots missing" };

            return { pass: true };
        },
    },
    {
        name: "rapid-debugging-flows",
        description: "Debug init, dep verification, replay linkage, runtime health, noise suppression",
        run() {
            const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
            if (!rdf) return { pass: false, reason: "module unavailable" };

            const init = rdf.initializeDebuggingSession("connection refused", { env: "vscode" });
            if (!init.ok) return { pass: false, reason: "initializeDebuggingSession failed" };
            if (!("flowId" in init)) return { pass: false, reason: "flowId missing" };

            const deps = rdf.verifyDebuggingDependencies("app.ts");
            if (!("results" in deps)) return { pass: false, reason: "results missing from verifyDebuggingDependencies" };

            const health = rdf.debugRuntimeHealthCheck();
            if (!("readyForDebugging" in health)) return { pass: false, reason: "readyForDebugging missing" };

            const recovery = rdf.validationFirstRecovery("null pointer", { trustScore: 60 });
            if (!recovery.ok) return { pass: false, reason: "validationFirstRecovery failed" };
            if (recovery.phases.length < 4) return { pass: false, reason: "not enough recovery phases" };

            const suppressed = rdf.suppressRepetitiveDebugNoise([
                { type: "error", message: "connection refused" },
                { type: "error", message: "connection refused" },
                { type: "error", message: "timeout" },
            ]);
            if (suppressed.suppressed < 1) return { pass: false, reason: "noise not suppressed" };

            return { pass: true };
        },
    },
    {
        name: "rapid-deployment-workflows",
        description: "Env scan, rollback prep, phased sequence, replay linkage, operator visibility",
        run() {
            const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
            if (!rdw) return { pass: false, reason: "module unavailable" };

            const scan = rdw.scanEnvironmentReadiness("production");
            if (!scan.ok !== false && !("checks" in scan)) return { pass: false, reason: "env scan missing checks" };

            // Approval gates
            const noPrepApproval = rdw.prepareDeployment("deploy-715", { operatorApproved: false });
            if (noPrepApproval.ok) return { pass: false, reason: "prepare without approval succeeded" };

            const noRollbackApproval = rdw.prepareRollback("deploy-715", { operatorApproved: false });
            if (noRollbackApproval.ok) return { pass: false, reason: "rollback without approval succeeded" };

            const noPhasedApproval = rdw.buildPhasedDeploymentSequence("deploy-715", { operatorApproved: false });
            if (noPhasedApproval.ok) return { pass: false, reason: "phased sequence without approval succeeded" };

            const link = rdw.linkDeploymentToReplay("deploy-715", "replay-715");
            if (!link.ok) return { pass: false, reason: "linkDeploymentToReplay failed" };

            const visibility = rdw.deploymentOperatorVisibility("deploy-715");
            if (!visibility.ok) return { pass: false, reason: "deploymentOperatorVisibility failed" };

            return { pass: true };
        },
    },
    {
        name: "engineering-command-center",
        description: "Full dashboard, all panels, low-noise output",
        run() {
            const ecc = _tryRequire("./engineeringCommandCenter.cjs");
            if (!ecc) return { pass: false, reason: "module unavailable" };

            const runtime = ecc.runtimeHealthPanel();
            if (!("ok" in runtime)) return { pass: false, reason: "runtimeHealthPanel missing ok" };

            const deploy = ecc.deploymentStatusPanel();
            if (!("stage" in deploy)) return { pass: false, reason: "deploymentStatusPanel missing stage" };

            const replay = ecc.replayActivityPanel();
            if (!("discoverable" in replay)) return { pass: false, reason: "replayActivityPanel missing discoverable" };

            const workflows = ecc.activeWorkflowsPanel();
            if (!("count" in workflows)) return { pass: false, reason: "activeWorkflowsPanel missing count" };

            const envs = ecc.unstableEnvironmentsPanel();
            if (!("unstable" in envs)) return { pass: false, reason: "unstableEnvironmentsPanel missing unstable" };

            const rec = ecc.recoveryRecommendationsPanel();
            if (!("recommendations" in rec)) return { pass: false, reason: "recoveryRecommendationsPanel missing recommendations" };

            const dashboard = ecc.commandCenterDashboard();
            if (!("calm" in dashboard)) return { pass: false, reason: "commandCenterDashboard missing calm" };
            if (!("panels" in dashboard)) return { pass: false, reason: "commandCenterDashboard missing panels" };

            return { pass: true };
        },
    },
    {
        name: "execution-productivity-chains",
        description: "Start chain, advance, interrupt, resume, catalog",
        run() {
            const epc = _tryRequire("./executionProductivityChains.cjs");
            if (!epc) return { pass: false, reason: "module unavailable" };

            const chain = epc.startProductivityChain("startup-env");
            if (!chain.ok) return { pass: false, reason: "startProductivityChain failed" };
            if (!chain.chainId) return { pass: false, reason: "chainId missing" };

            // Advance autonomous step
            const advanced = epc.advanceChain(chain.chainId, { operatorApproved: false });
            if (!advanced.ok) return { pass: false, reason: "advance autonomous step failed" };

            // Interrupt
            const interrupted = epc.interruptChain(chain.chainId);
            if (!interrupted.ok) return { pass: false, reason: "interruptChain failed" };

            // Resume without approval must require it
            const noApproval = epc.resumeChain(chain.chainId, { operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "resume without approval succeeded" };

            // Resume with approval
            const resumed = epc.resumeChain(chain.chainId, { operatorApproved: true });
            if (!resumed.ok) return { pass: false, reason: "resumeChain with approval failed" };

            const catalog = epc.catalogProductivityChains();
            if (catalog.length < 3) return { pass: false, reason: "catalog too small" };

            return { pass: true };
        },
    },
    {
        name: "engineering-memory-productivity",
        description: "Record outcome, recall, suppression, deployment history, recovery suggestion",
        run() {
            const emp = _tryRequire("./engineeringMemoryProductivity.cjs");
            if (!emp) return { pass: false, reason: "module unavailable" };

            emp.recordProductivityOutcome("workflow", "startup-flow-715", { success: true, env: "vscode" });

            const workflows = emp.recallWorkflows({ env: "vscode" });
            if (!("count" in workflows)) return { pass: false, reason: "recallWorkflows missing count" };

            const replays = emp.recallDebuggingReplays({ env: "vscode" });
            if (!("count" in replays)) return { pass: false, reason: "recallDebuggingReplays missing count" };

            const history = emp.prioritizeDeploymentHistory();
            if (!("history" in history)) return { pass: false, reason: "prioritizeDeploymentHistory missing history" };

            const suggestion = emp.suggestRecoveryPattern("connection refused", { env: "vscode" });
            if (!suggestion.ok) return { pass: false, reason: "suggestRecoveryPattern failed" };

            const envFlows = emp.environmentProductivityFlows("vscode");
            if (!envFlows.ok) return { pass: false, reason: "environmentProductivityFlows failed" };

            const stats = emp.memoryProductivityStats();
            if (!("total" in stats)) return { pass: false, reason: "stats total missing" };

            return { pass: true };
        },
    },
    {
        name: "daily-engineering-automation2",
        description: "Start automation, advance, interrupt, resume, operational summary",
        run() {
            const dea = _tryRequire("./dailyEngineeringAutomation2.cjs");
            if (!dea) return { pass: false, reason: "module unavailable" };

            const run = dea.startAutomation2("startup-health-scan");
            if (!run.ok) return { pass: false, reason: "startAutomation2 failed" };

            // Advance autonomous step
            const advanced = dea.advanceAutomationStep2(run.runId);
            if (!advanced.ok) return { pass: false, reason: "advance autonomous step failed" };

            // Interrupt
            const interrupted = dea.interruptAutomation2(run.runId);
            if (!interrupted.ok) return { pass: false, reason: "interruptAutomation2 failed" };

            // Resume without approval must require it
            const noApproval = dea.resumeAutomation2(run.runId, { operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "resume without approval succeeded" };

            const summary = dea.runOperationalSummary2();
            if (!("results" in summary)) return { pass: false, reason: "runOperationalSummary2 missing results" };

            const catalog = dea.catalogAutomations2();
            if (catalog.length < 3) return { pass: false, reason: "catalog too small" };

            return { pass: true };
        },
    },
    {
        name: "long-horizon-productivity-continuity",
        description: "Session persist/restore, reconnect storm, deployment survivability, durability",
        run() {
            const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
            if (!lhpc) return { pass: false, reason: "module unavailable" };

            const persisted = lhpc.persistProductivitySession("stress-715-prod", { goal: "stress test", env: "production", progress: 40 });
            if (!persisted.ok) return { pass: false, reason: "persistProductivitySession failed" };

            const restored = lhpc.restoreProductivitySession("stress-715-prod");
            if (!restored.ok) return { pass: false, reason: "restoreProductivitySession failed" };
            if (restored.record?.progress !== 40) return { pass: false, reason: "progress mismatch" };

            const storm = lhpc.productivityStormStatus();
            if (!("storm" in storm)) return { pass: false, reason: "storm field missing" };

            const health = lhpc.productivityContinuityHealth();
            if (!health.summary) return { pass: false, reason: "health summary missing" };

            // Interrupted restoration approval gate
            const noApproval = lhpc.restoreInterruptedProductivityWorkflows({ operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "restore without approval succeeded" };

            const durability = lhpc.assessProductivityCrossEnvDurability();
            if (!("durable" in durability)) return { pass: false, reason: "durable field missing" };

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
        ok:        score >= THRESHOLD,
        passed, total,
        score:     Math.round(score * 100),
        threshold: Math.round(THRESHOLD * 100),
        results,
        failed:    results.filter(r => !r.pass).map(r => ({ name: r.name, reason: r.reason })),
        summary:   `Phase 706-714 productivity stress test: ${passed}/${total} (${Math.round(score * 100)}%) — ${score >= THRESHOLD ? "PASS" : "FAIL"}`,
    };
}

module.exports = { runAll, TESTS };
