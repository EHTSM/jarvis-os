"use strict";
/**
 * Self-Healing Pipeline — verification test
 *
 * Scenarios:
 *   1. code_error  — auto_heal, LOW risk: all stages pass, incident resolved, outcome=success
 *   2. deploy_regression — auto_heal: git tasks pass, patches applied, redeploy pipeline created, success
 *   3. database_error — auto_heal: migration task passes, service patch applied, success
 *   4. approval_required mode — halts at first approval gate, outcome=awaiting-approval
 *   5. approveRun — resume from approval gate, run completes to success
 *   6. Failed verification → rollback: verifyFn returns fail → rollback applied, outcome=rolled-back
 *   7. recommend_only — all stages skipped/proposed, no patches applied, outcome=recommend-only
 *   8. auto_heal blocked on HIGH risk — returns error, no run created
 *   9. listHealingRuns / getHealingRun — storage and retrieval
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Isolated data dir ─────────────────────────────────────────────
const TMP_DIR   = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-shp-test-"));
const REAL_DATA = path.resolve(path.join(__dirname, "../../agents/runtime/../../data"));

const _origRead   = fs.readFileSync.bind(fs);
const _origWrite  = fs.writeFileSync.bind(fs);
const _origRename = fs.renameSync.bind(fs);
const _origMkdir  = fs.mkdirSync.bind(fs);

function remap(p) {
    if (typeof p === "string" && p.startsWith(REAL_DATA)) return p.replace(REAL_DATA, TMP_DIR);
    return p;
}
fs.readFileSync  = (p, ...a) => _origRead(remap(p), ...a);
fs.writeFileSync = (p, ...a) => _origWrite(remap(p), ...a);
fs.renameSync    = (p, q, ...a) => _origRename(remap(p), remap(q), ...a);
fs.mkdirSync     = (p, ...a) => { try { _origMkdir(remap(p), ...a); } catch { /* exists */ } };

fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Synthetic manifests ───────────────────────────────────────────
const SYNTH_API_MANIFESTS = [
    {
        apiId: "a1", apiMethod: "GET", apiPath: "/api/plans",
        blueprintId: "bp_test",
        filePaths: {
            featureName:   "plan-management",
            routeFile:     "backend/routes/plan-management.js",
            serviceFile:   "backend/services/plan-management.js",
            migrations:    ["backend/db/migrations/001_plans.sql"],
        },
    },
];

fs.writeFileSync(path.join(TMP_DIR, "api-manifests.json"),     JSON.stringify(SYNTH_API_MANIFESTS));
fs.writeFileSync(path.join(TMP_DIR, "db-manifests.json"),      JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "product-manifests.json"), JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "page-manifests.json"),    JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"),         JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "healing-runs.json"),      JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "incidents.json"),         JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "patch-history.json"),     JSON.stringify({ patches: [], patchSets: [] }));
fs.writeFileSync(path.join(TMP_DIR, "pipeline-runs.json"),     JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "rca-reports.json"),       JSON.stringify([]));

// ── Engine cache management ───────────────────────────────────────
const ENGINE_PATHS = [
    "../../agents/runtime/autoFixPlanner.cjs",
    "../../agents/runtime/selfHealingPipeline.cjs",
    "../../agents/runtime/patchAssistant.cjs",
    "../../agents/runtime/deploymentPipeline.cjs",
    "../../agents/runtime/incidentEngine.cjs",
    "../../agents/runtime/rootCauseAnalyzer.cjs",
].map(p => require.resolve(p));

function bustCache() {
    ENGINE_PATHS.forEach(p => delete require.cache[p]);
}

function freshEngines() {
    bustCache();
    return {
        afp: require("../../agents/runtime/autoFixPlanner.cjs"),
        shp: require("../../agents/runtime/selfHealingPipeline.cjs"),
        pa:  require("../../agents/runtime/patchAssistant.cjs"),
        dp:  require("../../agents/runtime/deploymentPipeline.cjs"),
        inc: require("../../agents/runtime/incidentEngine.cjs"),
    };
}

function reset() {
    fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"),     JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "healing-runs.json"),  JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "patch-history.json"), JSON.stringify({ patches: [], patchSets: [] }));
    fs.writeFileSync(path.join(TMP_DIR, "pipeline-runs.json"), JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "incidents.json"),     JSON.stringify([]));
    bustCache();
}

// ── Plan factory ──────────────────────────────────────────────────
function makePlan(overrides = {}) {
    return {
        planId:    "plan_test_" + Date.now(),
        rcaId:     "rca_test_1",
        incidentId: "inc_test_1",
        createdAt: new Date().toISOString(),
        status:    "draft",
        risk:      { level: "LOW",    factors: [] },
        confidence: 75,
        pipeline:  { name: "safe-update", label: "Safe Git Update", requiresApproval: false },
        suggestedChanges: ["Fix the handler"],
        strategy:  { category: "code_error", approach: "patch-and-redeploy", rationale: "..." },
        targetFiles: [
            { filePath: "backend/routes/plan-management.js", role: "route",   action: "patch_file",  priority: 3 },
            { filePath: "backend/services/plan-management.js", role: "service", action: "patch_file", priority: 2 },
        ],
        tasks: [
            { seq: 1, type: "investigate",  title: "Review logs",         detail: "Check logs",   dependsOn: [], approvalRequired: false, estimatedMins: 5,  targetFile: null, command: null, pipeline: null },
            { seq: 2, type: "patch_file",   title: "Patch route file",    detail: "Fix handler",  dependsOn: [1], approvalRequired: true, estimatedMins: 15, targetFile: "backend/routes/plan-management.js",   command: null, pipeline: null },
            { seq: 3, type: "patch_file",   title: "Patch service file",  detail: "Fix service",  dependsOn: [2], approvalRequired: true, estimatedMins: 15, targetFile: "backend/services/plan-management.js", command: null, pipeline: null },
            { seq: 4, type: "run_command",  title: "Run tests",           detail: "node --test",  dependsOn: [3], approvalRequired: false, estimatedMins: 10, targetFile: null, command: "node --test tests/runtime/01-taskRouter.test.cjs", pipeline: null },
            { seq: 5, type: "redeploy",     title: "Run safe-update",     detail: "Deploy fix",   dependsOn: [4], approvalRequired: true, estimatedMins: 10, targetFile: null, command: null, pipeline: "safe-update" },
            { seq: 6, type: "verify",       title: "Verify health",       detail: "GET /health",  dependsOn: [5], approvalRequired: false, estimatedMins: 5,  targetFile: null, command: null, pipeline: null },
        ],
        ...overrides,
    };
}

// ── Test helpers ──────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
    if (condition) { passed++; console.log(`  ✓ ${label}`); }
    else           { failed++; console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 1: code_error auto_heal — all stages pass, success
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 1: code_error auto_heal — all stages pass");
reset();
{
    const { shp } = freshEngines();
    const plan = makePlan({
        risk:     { level: "LOW", factors: [] },
        strategy: { category: "code_error", approach: "patch-and-redeploy", rationale: "..." },
    });

    const run = shp.executePlan(plan, { mode: "auto_heal" });

    assert("runId assigned",                         run?.runId?.startsWith("heal_"));
    assert("mode = auto_heal",                       run?.mode === "auto_heal");
    assert("outcome = success",                      run?.outcome === "success",     `got: ${run?.outcome}`);
    assert("status = completed",                     run?.status === "completed");
    assert("all stages passed or skipped",           run?.stages?.every(s => s.status === "passed" || s.status === "skipped"),
        `stages: ${run?.stages?.map(s=>`${s.seq}:${s.status}`).join(", ")}`);
    assert("patchIds populated (patches proposed)",  run?.patchIds?.length >= 1,    `patchIds: ${run?.patchIds?.length}`);
    assert("pipelineRunId assigned (redeploy)",      !!run?.pipelineRunId,           `pipelineRunId: ${run?.pipelineRunId}`);
    assert("completedAt set",                        !!run?.completedAt);
    assert("no rollback log",                        run?.rollbackLog?.length === 0);
    // Internal fields must not leak
    assert("_applyPatches not in public run",        !("_applyPatches" in run));
    assert("_verifyFn not in public run",            !("_verifyFn" in run));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 2: deploy_regression auto_heal — git tasks + patch + redeploy
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 2: deploy_regression auto_heal");
reset();
{
    const { shp } = freshEngines();
    const plan = makePlan({
        risk:     { level: "MEDIUM", factors: ["Revert may require re-testing"] },
        strategy: { category: "deploy_regression", approach: "revert-or-fix", rationale: "..." },
        tasks: [
            { seq: 1, type: "investigate", title: "Review timeline",      detail: "Check logs", dependsOn: [], approvalRequired: false, estimatedMins: 5,  targetFile: null, command: null, pipeline: null },
            { seq: 2, type: "run_command", title: "git show abc1234",     detail: "Inspect commit", dependsOn: [1], approvalRequired: false, estimatedMins: 3, targetFile: null, command: "git show abc1234 --stat", pipeline: null },
            { seq: 3, type: "run_command", title: "git revert abc1234",   detail: "Revert", dependsOn: [2], approvalRequired: true, estimatedMins: 5, targetFile: null, command: "git revert abc1234 --no-edit", pipeline: null },
            { seq: 4, type: "redeploy",    title: "Run safe-update",      detail: "Deploy", dependsOn: [3], approvalRequired: true, estimatedMins: 10, targetFile: null, command: null, pipeline: "safe-update" },
            { seq: 5, type: "verify",      title: "Verify health",        detail: "Check", dependsOn: [4], approvalRequired: false, estimatedMins: 5, targetFile: null, command: null, pipeline: null },
        ],
    });

    const run = shp.executePlan(plan, { mode: "auto_heal" });

    assert("outcome = success",             run?.outcome === "success",   `got: ${run?.outcome}`);
    assert("status = completed",            run?.status === "completed");
    assert("run_command stages passed",     run?.stages?.filter(s => s.type === "run_command").every(s => s.status === "passed"));
    assert("redeploy stage passed",         run?.stages?.find(s => s.type === "redeploy")?.status === "passed",
        `redeploy: ${run?.stages?.find(s=>s.type==="redeploy")?.status}`);
    assert("pipelineRunId set",             !!run?.pipelineRunId);
    assert("pipeline run created in dp",    (() => {
        bustCache();
        const dp = require("../../agents/runtime/deploymentPipeline.cjs");
        const runs = dp.listRuns({ limit: 10 });
        return runs.some(r => r.id === run.pipelineRunId);
    })());
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 3: database_error auto_heal — migration + service patch
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 3: database_error auto_heal");
reset();
{
    const { shp } = freshEngines();
    const plan = makePlan({
        risk:     { level: "MEDIUM", factors: ["DB schema changes may require downtime"] },
        strategy: { category: "database_error", approach: "migration-repair", rationale: "..." },
        tasks: [
            { seq: 1, type: "investigate",    title: "Check DB connectivity", detail: "...", dependsOn: [], approvalRequired: false, estimatedMins: 5,  targetFile: null, command: null, pipeline: null },
            { seq: 2, type: "run_migration",  title: "Apply migration",       detail: "Run migration", dependsOn: [1], approvalRequired: true, estimatedMins: 10, targetFile: "backend/db/migrations/001_plans.sql", command: null, pipeline: null },
            { seq: 3, type: "patch_file",     title: "Add DB error handling", detail: "Wrap DB calls", dependsOn: [2], approvalRequired: true, estimatedMins: 15, targetFile: "backend/services/plan-management.js", command: null, pipeline: null },
            { seq: 4, type: "redeploy",       title: "Run standard-deploy",   detail: "Deploy", dependsOn: [3], approvalRequired: true, estimatedMins: 15, targetFile: null, command: null, pipeline: "standard-deploy" },
            { seq: 5, type: "verify",         title: "Verify health",         detail: "Check", dependsOn: [4], approvalRequired: false, estimatedMins: 5, targetFile: null, command: null, pipeline: null },
        ],
    });

    const run = shp.executePlan(plan, { mode: "auto_heal" });

    assert("outcome = success",             run?.outcome === "success",   `got: ${run?.outcome}`);
    assert("run_migration stage passed",    run?.stages?.find(s => s.type === "run_migration")?.status === "passed");
    assert("patch_file stage passed",       run?.stages?.find(s => s.type === "patch_file")?.status === "passed");
    assert("patchIds populated",            run?.patchIds?.length >= 1);
    assert("pipelineRunId set",             !!run?.pipelineRunId);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 4: approval_required — halts at first approval gate
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 4: approval_required — halts at gate");
reset();
{
    const { shp } = freshEngines();
    const plan = makePlan({ risk: { level: "HIGH", factors: [] } });

    const run = shp.executePlan(plan, { mode: "approval_required" });

    assert("outcome = awaiting-approval",   run?.outcome === "awaiting-approval",  `got: ${run?.outcome}`);
    assert("status = awaiting-approval",    run?.status === "awaiting-approval");
    assert("first stage (investigate) passed", run?.stages?.find(s => s.seq === 1)?.status === "passed",
        `seq1: ${run?.stages?.find(s=>s.seq===1)?.status}`);
    assert("second stage awaiting-approval",   run?.stages?.find(s => s.seq === 2)?.status === "awaiting-approval",
        `seq2: ${run?.stages?.find(s=>s.seq===2)?.status}`);
    assert("run persisted in store",        (() => {
        bustCache();
        const shpFresh = require("../../agents/runtime/selfHealingPipeline.cjs");
        return !!shpFresh.getHealingRun(run.runId);
    })());
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 5: approveRun — resume from approval gate → success
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 5: approveRun resumes to success");
reset();
{
    const { shp, afp } = freshEngines();
    const plan = makePlan({ planId: "plan_approve_test", risk: { level: "HIGH", factors: [] } });
    // Persist the plan so approveRun can load it
    fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"), JSON.stringify([plan]));
    bustCache();
    const shpFresh = require("../../agents/runtime/selfHealingPipeline.cjs");

    // Start — halts at seq 2 (first approvalRequired)
    const halted = shpFresh.executePlan(plan, { mode: "approval_required" });
    assert("halted at approval gate",     halted.outcome === "awaiting-approval", `got: ${halted?.outcome}`);

    // Approve — resumes and completes
    const resumed = shpFresh.approveRun(halted.runId);
    assert("approveRun returns ok",       resumed.ok === true,      `error: ${resumed.error}`);
    assert("outcome = success after approve", resumed.run?.outcome === "success", `got: ${resumed.run?.outcome}`);
    assert("all stages now passed",       resumed.run?.stages?.every(s => s.status === "passed" || s.status === "skipped"),
        `stages: ${resumed.run?.stages?.map(s=>`${s.seq}:${s.status}`).join(", ")}`);
    assert("patchIds populated after approve", resumed.run?.patchIds?.length >= 1);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 6: Failed verification → rollback
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 6: Failed verification → rollback");
reset();
{
    const { shp } = freshEngines();
    // Plan where verify step is the 3rd stage (seq 3)
    const plan = makePlan({
        risk: { level: "LOW", factors: [] },
        tasks: [
            { seq: 1, type: "investigate", title: "Check logs",   detail: "...", dependsOn: [], approvalRequired: false, estimatedMins: 5, targetFile: null, command: null, pipeline: null },
            { seq: 2, type: "patch_file",  title: "Patch route",  detail: "Fix", dependsOn: [1], approvalRequired: false, estimatedMins: 15, targetFile: "backend/routes/plan-management.js", command: null, pipeline: null },
            { seq: 3, type: "verify",      title: "Verify patch", detail: "Run tests", dependsOn: [2], approvalRequired: false, estimatedMins: 5, targetFile: null, command: null, pipeline: null },
        ],
    });

    // verifyFn that always fails
    const verifyFn = () => ({ ok: false, error: "Tests failed: 3 assertions failed" });

    const run = shp.executePlan(plan, {
        mode:     "auto_heal",
        verifyFn,
    });

    assert("outcome = rolled-back",             run?.outcome === "rolled-back",  `got: ${run?.outcome}`);
    assert("status = failed",                   run?.status === "failed",        `got: ${run?.status}`);
    assert("verify stage = failed",             run?.stages?.find(s => s.type === "verify")?.status === "failed",
        `verify: ${run?.stages?.find(s=>s.type==="verify")?.status}`);
    assert("rollbackLog non-empty",             run?.rollbackLog?.length >= 1,   `log: ${run?.rollbackLog}`);
    assert("rolled-back patches logged",        run?.rollbackLog?.some(l => /roll/i.test(l)));

    // Patches should be rolled back in patchAssistant
    bustCache();
    const pa = require("../../agents/runtime/patchAssistant.cjs");
    const patches = pa.listPatches({ sessionId: run.runId, limit: 20 });
    assert("applied patches rolled back in patchAssistant",
        patches.every(p => p.status === "rolled-back" || p.status === "pending"),
        `statuses: ${patches.map(p=>p.status).join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 7: recommend_only — no patches applied
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 7: recommend_only — patches proposed, not applied");
reset();
{
    const { shp } = freshEngines();
    const plan = makePlan({ risk: { level: "CRITICAL", factors: ["critical risk"] } });

    const run = shp.executePlan(plan, { mode: "recommend_only" });

    assert("outcome = recommend-only",      run?.outcome === "recommend-only",  `got: ${run?.outcome}`);
    assert("status = completed",            run?.status === "completed");
    assert("all stages skipped",            run?.stages?.every(s => s.status === "skipped"),
        `stages: ${run?.stages?.map(s=>s.status).join(", ")}`);
    // patchAssistant still received proposals (patchIds set)
    assert("patchIds may have proposals",   Array.isArray(run?.patchIds));

    // Patches must remain pending (not applied)
    bustCache();
    const pa = require("../../agents/runtime/patchAssistant.cjs");
    const patches = pa.listPatches({ sessionId: run.runId, limit: 20 });
    assert("no applied patches in recommend_only",
        patches.every(p => p.status === "pending"),
        `statuses: ${patches.map(p=>p.status).join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 8: auto_heal blocked on HIGH risk
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 8: auto_heal blocked on HIGH/CRITICAL risk");
reset();
{
    const { shp } = freshEngines();
    const highPlan = makePlan({ risk: { level: "HIGH", factors: ["high risk"] } });

    const run = shp.executePlan(highPlan, { mode: "auto_heal" });

    assert("returns error object",  run?.ok === false,    `got: ${JSON.stringify(run)}`);
    assert("error mentions risk",   run?.error?.toLowerCase().includes("risk"),  `error: ${run?.error}`);

    // No run created in storage
    bustCache();
    const shpFresh = require("../../agents/runtime/selfHealingPipeline.cjs");
    const runs     = shpFresh.listHealingRuns({ limit: 10 });
    assert("no run persisted for blocked execute", runs.length === 0, `runs: ${runs.length}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 9: listHealingRuns / getHealingRun
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 9: listHealingRuns / getHealingRun");
reset();
{
    const { shp } = freshEngines();

    const p1 = makePlan({ planId: "plan_list_1", incidentId: "inc_list_1", risk: { level: "LOW", factors: [] } });
    const p2 = makePlan({ planId: "plan_list_2", incidentId: "inc_list_2", risk: { level: "LOW", factors: [] } });

    const r1 = shp.executePlan(p1, { mode: "auto_heal" });
    const r2 = shp.executePlan(p2, { mode: "auto_heal" });

    bustCache();
    const shpFresh = require("../../agents/runtime/selfHealingPipeline.cjs");

    const all = shpFresh.listHealingRuns({ limit: 10 });
    assert("listHealingRuns returns 2",             all.length >= 2, `got: ${all.length}`);

    const byPlan = shpFresh.listHealingRuns({ planId: "plan_list_1" });
    assert("filter by planId works",                byPlan.length === 1 && byPlan[0].planId === "plan_list_1");

    const byOutcome = shpFresh.listHealingRuns({ outcome: "success" });
    assert("filter by outcome=success works",       byOutcome.every(r => r.outcome === "success"));

    const fetched = shpFresh.getHealingRun(r1.runId);
    assert("getHealingRun returns run",             fetched?.runId === r1.runId);

    const missing = shpFresh.getHealingRun("heal_nonexistent");
    assert("getHealingRun null for missing",        missing === null);
}

// ── Restore fs ────────────────────────────────────────────────────
fs.readFileSync  = _origRead;
fs.writeFileSync = _origWrite;
fs.renameSync    = _origRename;
fs.mkdirSync     = _origMkdir;
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }

// ── Results ───────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════");
console.log("SELF-HEALING PIPELINE TEST RESULTS");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log("════════════════════════════════════════");

if (failed > 0) { console.error(`\n${failed} assertion(s) failed.`); process.exit(1); }
else            { console.log("\nAll assertions passed."); process.exit(0); }
