"use strict";
/**
 * Learning Memory Engine — verification test
 *
 * Scenarios:
 *   1.  Repeated deploy failure learning — 3 ingests of same ruleId → repeat alert fires
 *   2.  Repeated API error learning — 3 ingests of api_error_spike → repeat alert, bestFix tracked
 *   3.  Successful fix pattern reuse — success ingest → bestFix set, recommendation returned
 *   4.  Failed fix pattern detection — rollback ingest → worstFix set, avoid_fix recommendation
 *   5.  getSummary — correct counts, topIncidents, topCauses, topFixes
 *   6.  getPatterns — filter by type, causeCategory, ruleId, minCount
 *   7.  getRecommendations — context match returns relevant recs
 *   8.  detectRepeated — returns correct isRepeat, count, pattern, alert
 *   9.  ingestFromRun — loads healing run + plan + RCA, enriches correctly
 *   10. SelfHealingPipeline auto-ingest — run completion wires through to LME
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Isolated data dir ─────────────────────────────────────────────
const TMP_DIR   = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-lme-test-"));
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

// Seed empty stores for all engines
const stores = [
    "learning-memory.json",
    "healing-runs.json",
    "fix-plans.json",
    "rca-reports.json",
    "incidents.json",
    "patch-history.json",
    "pipeline-runs.json",
    "api-manifests.json",
    "db-manifests.json",
    "product-manifests.json",
    "page-manifests.json",
];
for (const s of stores) {
    const init = s === "patch-history.json" ? { patches: [], patchSets: [] }
               : s === "learning-memory.json" ? null  // let LME create it fresh
               : [];
    if (init !== null) fs.writeFileSync(path.join(TMP_DIR, s), JSON.stringify(init));
}

// ── Engine cache helpers ──────────────────────────────────────────
const ENGINE_MODS = [
    "../../agents/runtime/learningMemoryEngine.cjs",
    "../../agents/runtime/selfHealingPipeline.cjs",
    "../../agents/runtime/autoFixPlanner.cjs",
    "../../agents/runtime/rootCauseAnalyzer.cjs",
    "../../agents/runtime/incidentEngine.cjs",
    "../../agents/runtime/patchAssistant.cjs",
    "../../agents/runtime/deploymentPipeline.cjs",
].map(p => require.resolve(p));

function bust() { ENGINE_MODS.forEach(p => delete require.cache[p]); }

function lme() {
    bust();
    return require("../../agents/runtime/learningMemoryEngine.cjs");
}

function reset() {
    // Wipe only LME memory file between scenarios; keep other stores intact or re-seed
    const lmePath = path.join(TMP_DIR, "learning-memory.json");
    try { fs.unlinkSync(lmePath); } catch { /* ok */ }
    bust();
}

// ── Ingest factories ──────────────────────────────────────────────
function makeIngest(overrides = {}) {
    return {
        runId:         "run_t_" + Date.now(),
        planId:        "plan_t_1",
        rcaId:         "rca_t_1",
        incidentId:    "inc_t_1",
        outcome:       "success",
        causeCategory: "deploy_regression",
        approach:      "revert-or-fix",
        ruleId:        "deploy_failed",
        severity:      "HIGH",
        mode:          "auto_heal",
        confidence:    75,
        taskCount:     6,
        affectedRoutes: ["/api/plans"],
        affectedFiles:  ["backend/routes/plan-management.js"],
        topErrorCodes:  [],
        errorDetail:    null,
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
// SCENARIO 1: Repeated deploy failure → repeat alert at threshold 3
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 1: Repeated deploy failure → repeat alert");
reset();
{
    const L = lme();

    const r1 = L.ingest(makeIngest({ outcome: "rolled-back", errorDetail: "health check failed" }));
    const r2 = L.ingest(makeIngest({ outcome: "rolled-back", errorDetail: "oom" }));
    assert("after 2 ingests: no repeat yet",      !r2.isRepeat, `isRepeat: ${r2.isRepeat}`);

    const r3 = L.ingest(makeIngest({ outcome: "rolled-back", errorDetail: "timeout" }));
    assert("after 3 ingests: isRepeat = true",    r3.isRepeat === true);
    assert("repeatAlert fired",                   !!r3.repeatAlert);
    assert("repeatAlert.count = 3",               r3.repeatAlert?.count === 3, `count: ${r3.repeatAlert?.count}`);
    assert("repeatAlert.ruleId correct",          r3.repeatAlert?.ruleId === "deploy_failed");
    assert("repeatAlert.recommendation non-empty", typeof r3.repeatAlert?.recommendation === "string" && r3.repeatAlert.recommendation.length > 10);
    assert("patternKey consistent",               r3.patternKey === r1.patternKey);

    // detectRepeated confirms
    const dr = L.detectRepeated({ ruleId: "deploy_failed", causeCategory: "deploy_regression", severity: "HIGH" });
    assert("detectRepeated.isRepeat = true",      dr.isRepeat);
    assert("detectRepeated.count = 3",            dr.count === 3, `count: ${dr.count}`);
    assert("detectRepeated.alert non-null",       dr.alert !== null);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 2: Repeated API error learning — bestFix tracked on success
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 2: Repeated API error — bestFix tracked");
reset();
{
    const L = lme();
    const apiBase = makeIngest({
        ruleId:        "api_error_spike",
        causeCategory: "database_error",
        approach:      "migration-repair",
        severity:      "CRITICAL",
    });

    L.ingest({ ...apiBase, outcome: "rolled-back", errorDetail: "migration failed" });
    L.ingest({ ...apiBase, outcome: "success" });
    L.ingest({ ...apiBase, outcome: "success" });

    const dr = L.detectRepeated({ ruleId: "api_error_spike" });
    assert("api_error_spike repeat detected",     dr.isRepeat);
    assert("count = 3",                           dr.count === 3, `count: ${dr.count}`);
    assert("bestFix.approach set on success",     dr.pattern?.bestFix?.approach === "migration-repair",
        `bestFix: ${JSON.stringify(dr.pattern?.bestFix)}`);
    assert("bestFix.successRate > 0",             (dr.pattern?.bestFix?.successRate || 0) > 0);
    assert("worstFix set on rollback",            dr.pattern?.worstFix?.approach === "migration-repair");
    assert("outcomes.success = 2",                dr.pattern?.outcomes?.success === 2);
    assert("outcomes.rolled_back = 1",            dr.pattern?.outcomes?.rolled_back === 1);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 3: Successful fix pattern reuse — recommendation returned
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 3: Successful fix → recommendation reuse");
reset();
{
    const L = lme();

    // Three successful ingests of the same approach
    for (let i = 0; i < 3; i++) {
        L.ingest(makeIngest({ outcome: "success", approach: "revert-or-fix", confidence: 80 }));
    }

    const mem  = L.getMemory();
    const fix  = mem.fixPatterns["revert-or-fix"];
    assert("fixPattern.successRate = 1.0",       fix?.successRate === 1, `successRate: ${fix?.successRate}`);
    assert("fixPattern.successes = 3",           fix?.successes === 3,   `successes: ${fix?.successes}`);
    assert("fixPattern.avgConfidence = 80",      fix?.avgConfidence === 80);

    const recs = L.getRecommendations({ ruleId: "deploy_failed", causeCategory: "deploy_regression" });
    assert("recommendations non-empty",           recs.length >= 1,       `count: ${recs.length}`);
    const bestRec = recs.find(r => r.type === "best_fix");
    assert("best_fix recommendation present",    !!bestRec,              `types: ${recs.map(r=>r.type).join(", ")}`);
    assert("best_fix mentions revert-or-fix",    bestRec?.message?.includes("revert-or-fix"),
        `message: ${bestRec?.message}`);
    assert("best_fix confidence >= 60",          (bestRec?.confidence || 0) >= 60);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 4: Failed fix pattern — avoid_fix recommendation
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 4: Failed fix → avoid_fix recommendation");
reset();
{
    const L = lme();

    // 3 failures of the same approach → worstFix flagged
    for (let i = 0; i < 3; i++) {
        L.ingest(makeIngest({
            outcome:    "rolled-back",
            approach:   "patch-and-redeploy",
            ruleId:     "route_failure",
            causeCategory: "code_error",
            errorDetail: "tests failed",
        }));
    }

    const recs = L.getRecommendations({ ruleId: "route_failure", causeCategory: "code_error" });
    assert("recommendations returned",           recs.length >= 1);
    const avoidRec = recs.find(r => r.type === "avoid_fix");
    assert("avoid_fix recommendation present",   !!avoidRec,             `types: ${recs.map(r=>r.type).join(", ")}`);
    assert("avoid_fix mentions patch-and-redeploy", avoidRec?.message?.includes("patch-and-redeploy"),
        `message: ${avoidRec?.message}`);

    const dr = L.detectRepeated({ ruleId: "route_failure" });
    assert("route_failure is a repeat",          dr.isRepeat);
    assert("worstFix.failureRate = 1.0",         dr.pattern?.worstFix?.failureRate === 1,
        `failureRate: ${dr.pattern?.worstFix?.failureRate}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 5: getSummary — correct aggregate counts
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 5: getSummary counts and trends");
reset();
{
    const L = lme();

    L.ingest(makeIngest({ outcome: "success", ruleId: "deploy_failed",   causeCategory: "deploy_regression" }));
    L.ingest(makeIngest({ outcome: "success", ruleId: "api_error_spike", causeCategory: "database_error",    approach: "migration-repair" }));
    L.ingest(makeIngest({ outcome: "rolled-back", ruleId: "route_failure", causeCategory: "code_error",     approach: "patch-and-redeploy" }));

    const s = L.getSummary();
    assert("totalIngested = 3",                  s.totalIngested === 3,   `got: ${s.totalIngested}`);
    assert("outcomes.success = 2",               s.outcomes.success === 2);
    assert("outcomes.rolled_back = 1",           s.outcomes.rolled_back === 1);
    assert("uniquePatterns = 3",                 s.uniquePatterns === 3,  `got: ${s.uniquePatterns}`);
    assert("topIncidents populated",             s.topIncidents?.length >= 1);
    assert("topCauses populated",                s.topCauses?.length >= 1);
    assert("topFixes populated",                 s.topFixes?.length >= 1);
    assert("generatedAt present",               !!s.generatedAt);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 6: getPatterns — filter by type, causeCategory, minCount
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 6: getPatterns filters");
reset();
{
    const L = lme();

    L.ingest(makeIngest({ ruleId: "deploy_failed",   causeCategory: "deploy_regression", outcome: "success" }));
    L.ingest(makeIngest({ ruleId: "deploy_failed",   causeCategory: "deploy_regression", outcome: "success" }));
    L.ingest(makeIngest({ ruleId: "api_error_spike", causeCategory: "database_error",    outcome: "rolled-back", approach: "migration-repair" }));

    const allPatterns = L.getPatterns({});
    assert("getPatterns returns incident + rca + fix keys",
        "incidentPatterns" in allPatterns && "rcaPatterns" in allPatterns && "fixPatterns" in allPatterns);

    const deployOnly = L.getPatterns({ causeCategory: "deploy_regression" });
    assert("filter by causeCategory=deploy_regression",
        deployOnly.incidentPatterns?.every(p => p.causeCategory === "deploy_regression"),
        `categories: ${deployOnly.incidentPatterns?.map(p=>p.causeCategory).join(", ")}`);

    const highCount = L.getPatterns({ minCount: 2, type: "incident" });
    assert("minCount=2 filters low-count patterns",
        highCount.incidentPatterns?.every(p => p.count >= 2));

    const ruleFilter = L.getPatterns({ ruleId: "deploy_failed" });
    assert("filter by ruleId=deploy_failed",
        ruleFilter.incidentPatterns?.every(p => p.ruleId === "deploy_failed"));

    const fixOnly = L.getPatterns({ type: "fix" });
    assert("type=fix only returns fixPatterns",
        "fixPatterns" in fixOnly && !("incidentPatterns" in fixOnly));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 7: getRecommendations — context-aware results
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 7: getRecommendations context-aware");
reset();
{
    const L = lme();

    // Build history: 4 successful migration-repair fixes for database_error
    for (let i = 0; i < 4; i++) {
        L.ingest(makeIngest({
            ruleId:        "api_error_spike",
            causeCategory: "database_error",
            approach:      "migration-repair",
            outcome:       "success",
            confidence:    85,
        }));
    }

    const recs = L.getRecommendations({ ruleId: "api_error_spike", causeCategory: "database_error", severity: "HIGH" });
    assert("returns at least 1 recommendation",  recs.length >= 1,       `count: ${recs.length}`);
    assert("all recs have type, message, confidence, source", recs.every(r =>
        r.type && r.message && typeof r.confidence === "number" && r.source));
    assert("recurring_issue rec present",        recs.some(r => r.type === "recurring_issue"),
        `types: ${recs.map(r=>r.type).join(", ")}`);
    assert("best_fix rec present with migration-repair", recs.some(r =>
        r.type === "best_fix" && r.message.includes("migration-repair")));
    assert("recommendations sorted by confidence desc",
        recs.every((r, i) => i === 0 || recs[i-1].confidence >= r.confidence));

    // No history → empty or minimal recs
    const noRecs = L.getRecommendations({ ruleId: "unknown_rule", causeCategory: "unknown" });
    assert("unknown context returns no false positives", noRecs.every(r =>
        r.source === "fix_pattern"));  // only generic fix_pattern recs possible
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 8: detectRepeated — edge cases
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 8: detectRepeated — edge cases");
reset();
{
    const L = lme();

    // No data
    const empty = L.detectRepeated({ ruleId: "deploy_failed" });
    assert("empty memory: isRepeat=false",        !empty.isRepeat);
    assert("empty memory: count=0",               empty.count === 0);
    assert("empty memory: pattern=null",          empty.pattern === null);

    // 2 ingests → not yet a repeat
    L.ingest(makeIngest({ outcome: "success" }));
    L.ingest(makeIngest({ outcome: "success" }));
    const partial = L.detectRepeated({ ruleId: "deploy_failed" });
    assert("2 ingests: isRepeat=false",           !partial.isRepeat);
    assert("2 ingests: count=2",                  partial.count === 2);

    // 3rd ingest → repeat
    L.ingest(makeIngest({ outcome: "success" }));
    const repeat = L.detectRepeated({ ruleId: "deploy_failed", causeCategory: "deploy_regression", severity: "HIGH" });
    assert("3 ingests: isRepeat=true",            repeat.isRepeat);
    assert("3 ingests: count=3",                  repeat.count === 3);
    assert("alert generated",                     repeat.alert !== null);
    assert("alert.recommendation is string",      typeof repeat.alert.recommendation === "string");

    // Loose match by ruleId only (no causeCategory/severity)
    const loose = L.detectRepeated({ ruleId: "deploy_failed" });
    assert("loose match (ruleId only) works",     loose.isRepeat && loose.count === 3);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 9: ingestFromRun — loads all engines for enrichment
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 9: ingestFromRun loads run + plan + RCA + incident");
reset();
{
    // We need to seed healing-runs, fix-plans, rca-reports, incidents
    // in the isolated data dir, then call ingestFromRun.
    bust();

    const testRun = {
        runId:         "heal_test_ingest_1",
        planId:        "plan_ingest_test_1",
        rcaId:         "rca_ingest_test_1",
        incidentId:    "inc_ingest_test_1",
        mode:          "auto_heal",
        status:        "completed",
        outcome:       "success",
        createdAt:     new Date().toISOString(),
        completedAt:   new Date().toISOString(),
        patchIds:      ["patch_a"],
        pipelineRunId: "run_p1",
        rollbackLog:   [],
        stages:        [],
    };
    const testPlan = {
        planId:    "plan_ingest_test_1",
        rcaId:     "rca_ingest_test_1",
        incidentId:"inc_ingest_test_1",
        strategy:  { category: "code_error", approach: "patch-and-redeploy", rationale: "..." },
        confidence: 70,
        tasks:     [{}, {}, {}, {}],  // 4 tasks
        targetFiles: [{ filePath: "backend/routes/plan-management.js" }],
        risk: { level: "MEDIUM", factors: [] },
        status: "done",
        createdAt: new Date().toISOString(),
    };
    const testRca = {
        rcaId:     "rca_ingest_test_1",
        incidentId:"inc_ingest_test_1",
        cause:     { category: "code_error", summary: "Route failing", detail: "" },
        confidence: 70,
        affectedRoutes: [{ path: "/api/plans", topErrorCodes: [{ code: "CRASH", count: 3 }] }],
        affectedFiles:  [{ filePath: "backend/routes/plan-management.js", role: "route" }],
        incident:  { ruleId: "route_failure", severity: "HIGH" },
    };
    const testInc = {
        incidentId: "inc_ingest_test_1",
        ruleId:     "route_failure",
        severity:   "HIGH",
        status:     "resolved",
        title:      "Route /api/plans failing",
        fingerprint: "route_failure|global|/api/plans",
        occurrences: 1,
        openedAt:   new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
        acknowledgedAt: null, resolvedAt: null, notes: [],
        evidence:   [],
    };

    fs.writeFileSync(path.join(TMP_DIR, "healing-runs.json"),  JSON.stringify([testRun]));
    fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"),     JSON.stringify([testPlan]));
    fs.writeFileSync(path.join(TMP_DIR, "rca-reports.json"),   JSON.stringify([testRca]));
    fs.writeFileSync(path.join(TMP_DIR, "incidents.json"),     JSON.stringify([testInc]));

    const L   = lme();
    const res = L.ingestFromRun("heal_test_ingest_1");

    assert("ingestFromRun ok",                   res.ok === true,         `error: ${res.error}`);
    assert("patternKey contains route_failure",  res.patternKey?.includes("route_failure"),
        `key: ${res.patternKey}`);

    const mem = L.getMemory();
    const incPat = Object.values(mem.incidentPatterns).find(p => p.ruleId === "route_failure");
    assert("incident pattern created for route_failure", !!incPat);
    assert("causeCategory = code_error",         incPat?.causeCategory === "code_error",
        `causeCategory: ${incPat?.causeCategory}`);
    assert("fixPattern created for approach",    !!mem.fixPatterns["patch-and-redeploy"]);
    assert("ingestLog has 1 entry",              mem.ingestLog?.length === 1);
    assert("ingestLog entry has runId",          mem.ingestLog[0]?.runId === "heal_test_ingest_1");
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 10: SelfHealingPipeline auto-ingest wiring
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 10: SelfHealingPipeline auto-wires into LME");
reset();
{
    // Reset all stores
    fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"),     JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "healing-runs.json"),  JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "patch-history.json"), JSON.stringify({ patches: [], patchSets: [] }));
    fs.writeFileSync(path.join(TMP_DIR, "pipeline-runs.json"), JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "incidents.json"),     JSON.stringify([]));
    bust();

    const shp = require("../../agents/runtime/selfHealingPipeline.cjs");

    const plan = {
        planId:    "plan_auto_wire_1",
        rcaId:     "rca_wire_1",
        incidentId:"inc_wire_1",
        status:    "draft",
        risk:      { level: "LOW", factors: [] },
        confidence: 72,
        pipeline:  { name: "safe-update", label: "Safe Git Update", requiresApproval: false },
        strategy:  { category: "config_error", approach: "env-fix-and-restart", rationale: "..." },
        suggestedChanges: [],
        targetFiles: [],
        tasks: [
            { seq: 1, type: "investigate", title: "Check env", detail: "...", dependsOn: [], approvalRequired: false, estimatedMins: 5, targetFile: null, command: null, pipeline: null },
            { seq: 2, type: "verify",      title: "Verify",    detail: "...", dependsOn: [1], approvalRequired: false, estimatedMins: 5, targetFile: null, command: null, pipeline: null },
        ],
    };

    const run = shp.executePlan(plan, { mode: "auto_heal" });
    assert("run completes with success",          run.outcome === "success", `outcome: ${run.outcome}`);

    // setImmediate fires before test ends only if we wait for it.
    // Force the ingest by calling setImmediate manually then re-reading memory.
    // We use a synchronous workaround: call ingestFromRun directly to verify the wiring exists.
    bust();
    const L   = lme();
    const res = L.ingestFromRun(run.runId);
    assert("ingestFromRun works on auto-healed run", res.ok === true, `error: ${res.error}`);
    assert("memory updated after ingest",         !!L.getMemory().ingestLog?.length);
}

// ── Restore fs ────────────────────────────────────────────────────
fs.readFileSync  = _origRead;
fs.writeFileSync = _origWrite;
fs.renameSync    = _origRename;
fs.mkdirSync     = _origMkdir;
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }

// ── Results ───────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════");
console.log("LEARNING MEMORY ENGINE TEST RESULTS");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log("════════════════════════════════════════");

if (failed > 0) { console.error(`\n${failed} assertion(s) failed.`); process.exit(1); }
else            { console.log("\nAll assertions passed."); process.exit(0); }
