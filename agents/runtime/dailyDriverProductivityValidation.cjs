"use strict";
/**
 * Phase 719 — Daily-Driver Productivity Validation
 *
 * 7-scenario validation: real debugging, deployment workflows, runtime recovery,
 * browser operations, replay-heavy sessions, multi-project coordination.
 * Measures: daily usability, productivity improvements, workflow trust, execution survivability.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const USABILITY_THRESHOLD = 0.85;

const SCENARIOS = [
    {
        name: "real-debugging-session",
        description: "Initialize debug session, verify deps, use replay, suppress noise",
        run() {
            const rdf = _tryRequire("./rapidDebuggingFlows.cjs");
            if (!rdf) return { pass: false, reason: "rapidDebuggingFlows unavailable" };

            const init = rdf.initializeDebuggingSession("null pointer exception", { env: "vscode" });
            if (!init.ok || !init.flowId) return { pass: false, reason: "debug init failed" };
            if (!init.checks.length) return { pass: false, reason: "no checks performed" };

            const deps = rdf.verifyDebuggingDependencies("app.ts");
            if (!("results" in deps)) return { pass: false, reason: "dep verification missing results" };

            const recovery = rdf.validationFirstRecovery("null pointer", { trustScore: 70 });
            if (!recovery.ok || recovery.phases.length < 4) return { pass: false, reason: "recovery phases insufficient" };

            const noise = rdf.suppressRepetitiveDebugNoise([
                { type: "warn", message: "module not found" },
                { type: "warn", message: "module not found" },
                { type: "info", message: "build complete" },
            ]);
            if (noise.suppressed < 1) return { pass: false, reason: "noise not suppressed" };

            return { pass: true };
        },
    },
    {
        name: "deployment-workflow",
        description: "Env scan, approval gates, phased sequence, operator visibility",
        run() {
            const rdw = _tryRequire("./rapidDeploymentWorkflows.cjs");
            if (!rdw) return { pass: false, reason: "rapidDeploymentWorkflows unavailable" };

            const scan = rdw.scanEnvironmentReadiness("production");
            if (!("checks" in scan)) return { pass: false, reason: "env scan missing checks" };

            // All destructive operations must require approval
            if (rdw.prepareDeployment("dd-719", { operatorApproved: false }).ok) return { pass: false, reason: "deploy prepared without approval" };
            if (rdw.prepareRollback("dd-719", { operatorApproved: false }).ok)   return { pass: false, reason: "rollback prepared without approval" };

            const visibility = rdw.deploymentOperatorVisibility("dd-719");
            if (!visibility.ok) return { pass: false, reason: "operator visibility failed" };

            const link = rdw.linkDeploymentToReplay("dd-719", "replay-dd-719");
            if (!link.ok) return { pass: false, reason: "replay linkage failed" };

            return { pass: true };
        },
    },
    {
        name: "runtime-recovery",
        description: "Command center dashboard, recovery recommendations, stabilization chain",
        run() {
            const ecc = _tryRequire("./engineeringCommandCenter.cjs");
            if (!ecc) return { pass: false, reason: "engineeringCommandCenter unavailable" };

            const dashboard = ecc.commandCenterDashboard();
            if (!("calm" in dashboard)) return { pass: false, reason: "calm field missing" };
            if (!("panels" in dashboard)) return { pass: false, reason: "panels missing" };

            const rec = ecc.recoveryRecommendationsPanel();
            if (!("recommendations" in rec)) return { pass: false, reason: "recommendations missing" };

            const epc = _tryRequire("./executionProductivityChains.cjs");
            if (epc) {
                const chain = epc.startProductivityChain("op-stabilization");
                if (!chain.ok) return { pass: false, reason: "stabilization chain failed to start" };
                // First step is autonomous
                const advanced = epc.advanceChain(chain.chainId);
                if (!advanced.ok) return { pass: false, reason: "advance autonomous step failed" };
            }

            return { pass: true };
        },
    },
    {
        name: "browser-operations",
        description: "Auth session, form protection, stale detection",
        run() {
            const boc = _tryRequire("./browserOperationCoordination.cjs");
            if (!boc) return { pass: false, reason: "browserOperationCoordination unavailable" };

            boc.registerAuthSession("dd-browser-719", { url: "https://app.example.com", user: "test" });
            const cont = boc.checkAuthContinuity("dd-browser-719");
            if (!cont.ok) return { pass: false, reason: "auth continuity check failed" };

            const form = boc.protectOperationalForm("pay-dd-719", { hasPayment: true, isDestructive: true });
            if (!form.blocked) return { pass: false, reason: "payment form not blocked" };

            const stale = boc.detectStaleBrowserSessions();
            if (!("staleCount" in stale)) return { pass: false, reason: "staleCount missing" };

            return { pass: true };
        },
    },
    {
        name: "replay-heavy-session",
        description: "Persist, restore, discoverability, UX refinement replay navigation",
        run() {
            const lhpc = _tryRequire("./longHorizonProductivityContinuity.cjs");
            if (!lhpc) return { pass: false, reason: "longHorizonProductivityContinuity unavailable" };

            lhpc.persistProductivitySession("dd-replay-719", { goal: "daily driver test", env: "vscode", progress: 55 });
            const restored = lhpc.restoreProductivitySession("dd-replay-719");
            if (!restored.ok) return { pass: false, reason: "session not restored" };
            if (restored.record?.progress !== 55) return { pass: false, reason: "progress mismatch" };

            const uxr = _tryRequire("./engineeringUXRefinement.cjs");
            if (uxr) {
                const nav = uxr.replayNavigationQuality();
                if (!("total" in nav)) return { pass: false, reason: "replay navigation total missing" };
            }

            const list = lhpc.listProductivitySessions({ limit: 5 });
            if (!list.some(s => s.sessionId === "dd-replay-719")) return { pass: false, reason: "session not in list" };

            return { pass: true };
        },
    },
    {
        name: "multi-project-coordination",
        description: "Save/restore project context, productivity flows per env",
        run() {
            const mpci = _tryRequire("./multiProjectContextIntelligence.cjs");
            if (!mpci) return { pass: false, reason: "multiProjectContextIntelligence unavailable" };

            mpci.saveProjectContext("proj-dd-719", "workflow:daily", { goal: "daily driver test", type: "workflow" });
            const ctx = mpci.getProjectContext("proj-dd-719", "workflow:daily");
            if (!ctx.ok || ctx.context?.goal !== "daily driver test") return { pass: false, reason: "project context mismatch" };

            const emp = _tryRequire("./engineeringMemoryProductivity.cjs");
            if (emp) {
                emp.recordProductivityOutcome("workflow", "proj-dd-719-flow", { success: true, env: "vscode" });
                const flows = emp.environmentProductivityFlows("vscode");
                if (!flows.ok) return { pass: false, reason: "environmentProductivityFlows failed" };
            }

            const projects = mpci.listProjects();
            if (projects.length === 0) return { pass: false, reason: "no projects listed" };

            return { pass: true };
        },
    },
    {
        name: "workspace-instant-restore",
        description: "Snapshot, reconnect-safe check, health report, UX calmness",
        run() {
            const iwr = _tryRequire("./instantWorkspaceRestoration.cjs");
            if (!iwr) return { pass: false, reason: "instantWorkspaceRestoration unavailable" };

            iwr.snapshotFullWorkspace("dd-snap-719", { vsCode: { file: "/app.ts" }, terminal: { cwd: "/project" }, goal: "daily driver", replay: { env: "vscode", progress: 70 } });

            const reconnect = iwr.reconnectSafeRestore("dd-snap-719", ["vsCode", "terminal"]);
            if (!("available" in reconnect)) return { pass: false, reason: "reconnectSafeRestore missing available" };

            const health = iwr.workspaceRestoreHealth();
            if (!("freshSnapshots" in health)) return { pass: false, reason: "freshSnapshots missing" };

            const uxr = _tryRequire("./engineeringUXRefinement.cjs");
            if (uxr) {
                const calmness = uxr.operationalCalmnessIndex();
                if (!("score" in calmness)) return { pass: false, reason: "calmness score missing" };
            }

            return { pass: true };
        },
    },
];

function runAll() {
    const results = SCENARIOS.map(s => {
        let result;
        try   { result = s.run(); }
        catch (e) { result = { pass: false, reason: e.message }; }
        return { name: s.name, description: s.description, ...result };
    });

    const passed = results.filter(r => r.pass).length;
    const total  = results.length;
    const score  = passed / total;

    return {
        ok:        score >= USABILITY_THRESHOLD,
        passed, total,
        score:     Math.round(score * 100),
        threshold: Math.round(USABILITY_THRESHOLD * 100),
        results,
        failed:    results.filter(r => !r.pass).map(r => ({ name: r.name, reason: r.reason })),
        summary:   `Daily-driver productivity validation: ${passed}/${total} (${Math.round(score * 100)}%) — ${score >= USABILITY_THRESHOLD ? "PASS" : "FAIL"}`,
    };
}

module.exports = { runAll, SCENARIOS };
