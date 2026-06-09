"use strict";
/**
 * Phase 731 — Productivity Maturity Stress Test
 *
 * 8-test validation of 721-730 operator product maturity range.
 */

function _tryRequire(p) { try { return require(p); } catch { return null; } }

const THRESHOLD = 0.75;

const TESTS = [
    {
        name: "one-click-engineering-flows",
        description: "Start flow, advance, interrupt, resume, execute autonomous bundle, catalog",
        run() {
            const ocf = _tryRequire("./oneClickEngineeringFlows.cjs");
            if (!ocf) return { pass: false, reason: "module unavailable" };

            const flow = ocf.startOneClickFlow("startup-restore");
            if (!flow.ok || !flow.runId) return { pass: false, reason: "startOneClickFlow failed" };

            const advanced = ocf.advanceOneClickFlow(flow.runId);
            if (!advanced.ok) return { pass: false, reason: "advance autonomous step failed" };

            const interrupted = ocf.interruptOneClickFlow(flow.runId);
            if (!interrupted.ok) return { pass: false, reason: "interruptOneClickFlow failed" };

            const noApproval = ocf.resumeOneClickFlow(flow.runId, { operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "resume without approval succeeded" };

            const bundle = ocf.executeAutonomousBundle("startup-restore");
            if (!bundle.ok) return { pass: false, reason: "executeAutonomousBundle failed" };
            if (!("autonomousSteps" in bundle)) return { pass: false, reason: "autonomousSteps missing" };

            const catalog = ocf.catalogOneClickFlows();
            if (catalog.length < 4) return { pass: false, reason: "catalog too small" };

            return { pass: true };
        },
    },
    {
        name: "engineering-workspace-ux",
        description: "Readability, calmness, replay nav, deployment vis, project switching",
        run() {
            const ux = _tryRequire("./engineeringWorkspaceUX.cjs");
            if (!ux) return { pass: false, reason: "module unavailable" };

            const readability = ux.workspaceReadabilityIndex();
            if (!("score" in readability)) return { pass: false, reason: "readability score missing" };

            const calmness = ux.workspaceCalmnessScore();
            if (!("level" in calmness)) return { pass: false, reason: "calmness level missing" };

            const replay = ux.replayNavigationSummary();
            if (!("navigable" in replay)) return { pass: false, reason: "navigable missing" };

            const deployment = ux.deploymentVisibilitySummary();
            if (!("trust" in deployment)) return { pass: false, reason: "trust missing from deployment visibility" };

            const projects = ux.multiProjectSwitchSummary();
            if (!("count" in projects)) return { pass: false, reason: "project count missing" };

            const suppressed = ux.suppressWarningOverload([
                { type: "warn", message: "stale session" },
                { type: "warn", message: "stale session" },
                { type: "info", message: "all ok" },
            ]);
            if (suppressed.suppressed < 1) return { pass: false, reason: "warnings not suppressed" };

            return { pass: true };
        },
    },
    {
        name: "repo-intelligence-foundation",
        description: "Symbol index, dep map, repo graph, contextual file targeting, replay link",
        run() {
            const rif = _tryRequire("./repoIntelligenceFoundation.cjs");
            if (!rif) return { pass: false, reason: "module unavailable" };

            const indexed = rif.indexSymbol("getUserById", { filePath: "/src/user.ts", kind: "function", language: "typescript" });
            if (!indexed.ok) return { pass: false, reason: "indexSymbol failed" };

            const lookup = rif.lookupSymbol("getUserById");
            if (lookup.count < 1) return { pass: false, reason: "symbol lookup returned 0" };

            rif.mapDependency("/src/user.ts", "/src/db.ts", { kind: "import" });
            const deps = rif.getDependencies("/src/user.ts", { direction: "outbound" });
            if (deps.count < 1) return { pass: false, reason: "dependency mapping not found" };

            const graph = rif.buildRepoGraph([{ filePath: "/src/user.ts", language: "typescript" }]);
            if (!graph.ok) return { pass: false, reason: "buildRepoGraph failed" };

            const target = rif.targetFilesForContext("user authentication", { language: "typescript" });
            if (!("count" in target)) return { pass: false, reason: "targetFilesForContext count missing" };

            const link = rif.linkRepoToReplay("replay-731", { files: ["/src/user.ts"], symbols: ["getUserById"] });
            if (!link.ok) return { pass: false, reason: "linkRepoToReplay failed" };

            return { pass: true };
        },
    },
    {
        name: "contextual-patch-maturity",
        description: "Propose patch, dep-aware edit, rollback preview, replay chain, approval gates",
        run() {
            const cpm = _tryRequire("./contextualPatchMaturity.cjs");
            if (!cpm) return { pass: false, reason: "module unavailable" };

            const patchUid = `patch-731-${Date.now()}`;
            const replayUid = `replay-731-${Date.now()}`;
            const patch = cpm.proposePatch(patchUid, {
                files: [{ filePath: "/src/user.ts", change: "add null check" }],
                description: "Fix null pointer in getUserById",
            });
            if (!patch.ok) return { pass: false, reason: "proposePatch failed" };
            if (!patch.requiresApproval) return { pass: false, reason: "patch approval gate missing" };

            // Dep-aware edit requires approval
            const noApproval = cpm.proposeDependencyAwareEdit(patchUid, "/src/user.ts", { operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "dep-aware edit without approval succeeded" };

            // Rollback preview
            const rollback = cpm.buildRollbackPreview(patchUid);
            if (!rollback.ok) return { pass: false, reason: "buildRollbackPreview failed" };
            if (!rollback.approvalRequired) return { pass: false, reason: "rollback approval gate missing" };

            // Replay-linked chain
            const chain = cpm.buildReplayLinkedPatchChain(replayUid, [patchUid]);
            if (!chain.ok) return { pass: false, reason: "buildReplayLinkedPatchChain failed" };
            if (!chain.requiresApproval) return { pass: false, reason: "chain approval gate missing" };

            // Apply without approval must fail
            const noApplyApproval = cpm.applyPatch(patchUid, { operatorApproved: false });
            if (noApplyApproval.ok) return { pass: false, reason: "apply without approval succeeded" };

            return { pass: true };
        },
    },
    {
        name: "real-debugging-productivity",
        description: "Diagnose failure, dep repair, replay-guided debug, workflow discovery, recovery chains",
        run() {
            const rdp = _tryRequire("./realDebuggingProductivity.cjs");
            if (!rdp) return { pass: false, reason: "module unavailable" };

            const diagnosis = rdp.diagnoseRuntimeFailure("null pointer exception", { env: "vscode" });
            if (!diagnosis.ok) return { pass: false, reason: "diagnoseRuntimeFailure failed" };
            if (!("phases" in diagnosis)) return { pass: false, reason: "phases missing" };

            const repair = rdp.rapidDependencyRepair("app.ts", { env: "vscode" });
            if (!("steps" in repair)) return { pass: false, reason: "repair steps missing" };

            const workflows = rdp.discoverDebuggingWorkflows({ env: "vscode" });
            if (!("total" in workflows)) return { pass: false, reason: "workflow total missing" };

            const recovery = rdp.assessRecoveryChainUsability("connection refused");
            if (!("usable" in recovery)) return { pass: false, reason: "usable field missing" };

            const summary = rdp.debuggingProductivitySummary("null pointer");
            if (summary.ok === undefined) return { pass: false, reason: "debuggingProductivitySummary missing ok" };

            return { pass: true };
        },
    },
    {
        name: "deployment-productivity-maturity",
        description: "Staged flow, rollback readiness, replay continuity, summary, trust report",
        run() {
            const dpm = _tryRequire("./deploymentProductivityMaturity.cjs");
            if (!dpm) return { pass: false, reason: "module unavailable" };

            // Staged flow without approval must fail
            const noApproval = dpm.buildStagedDeploymentFlow("deploy-731", { operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "staged flow without approval succeeded" };

            const rollback = dpm.rollbackReadinessAssessment("deploy-731");
            if (!("confidence" in rollback)) return { pass: false, reason: "rollback confidence missing" };

            const link = dpm.ensureDeploymentReplayContinuity("deploy-731", "replay-731");
            if (!link.ok) return { pass: false, reason: "ensureDeploymentReplayContinuity failed" };

            const summary = dpm.deploymentProductivitySummary("deploy-731");
            if (!summary.ok) return { pass: false, reason: "deploymentProductivitySummary failed" };
            if (!("trust" in summary)) return { pass: false, reason: "trust missing from summary" };

            const trust = dpm.operationalTrustReport("deploy-731");
            if (!("trustScore" in trust)) return { pass: false, reason: "trustScore missing" };

            return { pass: true };
        },
    },
    {
        name: "long-session-survivability",
        description: "Persist/restore session, storm detection, deployment session, interrupted recovery",
        run() {
            const lss = _tryRequire("./longSessionSurvivability.cjs");
            if (!lss) return { pass: false, reason: "module unavailable" };

            const persisted = lss.persistSurvivabilitySession("stress-731", { goal: "maturity stress test", env: "production", progress: 45 });
            if (!persisted.ok) return { pass: false, reason: "persistSurvivabilitySession failed" };

            const restored = lss.restoreSurvivabilitySession("stress-731");
            if (!restored.ok) return { pass: false, reason: "restoreSurvivabilitySession failed" };
            if (restored.record?.progress !== 45) return { pass: false, reason: "progress mismatch" };

            const storm = lss.survivabilityStormStatus();
            if (!("storm" in storm)) return { pass: false, reason: "storm field missing" };

            const health = lss.survivabilityHealth();
            if (!health.summary) return { pass: false, reason: "health summary missing" };

            const noApproval = lss.recoverInterruptedWorkflows({ operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "interrupted recovery without approval succeeded" };

            const dur = lss.assessSurvivabilityDurability();
            if (!("durable" in dur)) return { pass: false, reason: "durable field missing" };

            return { pass: true };
        },
    },
    {
        name: "multi-project-engineering-maturity",
        description: "Register, switch (approval), replay isolation, contamination check, survivability",
        run() {
            const mpem = _tryRequire("./multiProjectEngineeringMaturity.cjs");
            if (!mpem) return { pass: false, reason: "module unavailable" };

            mpem.registerProject("proj-731-a", { name: "Project A", env: "vscode" });
            mpem.registerProject("proj-731-b", { name: "Project B", env: "terminal" });

            // Switch without approval must fail
            const noApproval = mpem.switchProject("proj-731-a", { operatorApproved: false });
            if (noApproval.ok) return { pass: false, reason: "switch without approval succeeded" };

            // Switch with approval
            const switched = mpem.switchProject("proj-731-a", { operatorApproved: true });
            if (!switched.ok) return { pass: false, reason: "switchProject failed" };

            // Save replay to A
            mpem.saveProjectReplay("proj-731-a", "replay-731-a", { goal: "test" });

            // Replay crossover prevention: replay-731-a belongs to A, B must be blocked
            const crossover = mpem.saveProjectReplay("proj-731-b", "replay-731-a", {});
            if (crossover.ok) return { pass: false, reason: "replay crossover not prevented" };
            if (!crossover.crossover) return { pass: false, reason: "crossover flag missing" };

            // Contamination check
            const contamCheck = mpem.checkWorkflowContamination("proj-731-b");
            if (!("contaminated" in contamCheck)) return { pass: false, reason: "contaminated field missing" };

            // Survivability
            const survivability = mpem.projectWorkflowSurvivability("proj-731-a");
            if (!("summary" in survivability)) return { pass: false, reason: "survivability summary missing" };

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
        summary:   `Phase 721-730 maturity stress test: ${passed}/${total} (${Math.round(score * 100)}%) — ${score >= THRESHOLD ? "PASS" : "FAIL"}`,
    };
}

module.exports = { runAll, TESTS };
