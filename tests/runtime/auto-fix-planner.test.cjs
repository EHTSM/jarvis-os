"use strict";
/**
 * Auto-Fix Planner — verification test
 *
 * Scenarios:
 *   1. deploy_regression plan — gitHead present, revert task generated, safe-update pipeline selected
 *   2. database_error plan    — migration task first, service patch task, standard-deploy pipeline
 *   3. route_failure / code_error plan — handler patch task, test-run task, safe-update pipeline
 *   4. external_dependency plan — no redeploy, retry/fallback task, risk=MEDIUM
 *   5. config_error plan      — env patch task, restart task, LOW risk
 *   6. confidence scoring     — inherits RCA confidence, adjusted for target availability
 *   7. listPlans / getPlan / updateStatus — storage, filter, status lifecycle
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Isolated data dir ─────────────────────────────────────────────
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-afp-test-"));

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

// Write synthetic api-manifests for file analysis
const SYNTHETIC_API_MANIFESTS = [
    {
        apiId: "a1", apiMethod: "GET", apiPath: "/api/plans",
        blueprintId: "bp_test", productName: "TestProduct",
        filePaths: {
            featureName:   "plan-management",
            feature:       { name: "Plan Management" },
            routeFile:     "backend/routes/plan-management.js",
            serviceFile:   "backend/services/plan-management.js",
            validatorFile: "backend/validators/plan-management.js",
            migrations:    ["backend/db/migrations/001_plans.sql"],
            tables: [{ name: "plans", columns: ["id","name","price"] }],
        },
    },
    {
        apiId: "a2", apiMethod: "POST", apiPath: "/api/payment",
        blueprintId: "bp_test", productName: "TestProduct",
        filePaths: {
            featureName:   "payment-processing",
            feature:       { name: "Payment Processing" },
            routeFile:     "backend/routes/payment-processing.js",
            serviceFile:   "backend/services/payment-processing.js",
            migrations:    ["backend/db/migrations/002_payments.sql"],
            tables: [{ name: "payments", columns: ["id","amount"] }],
        },
    },
];
const SYNTHETIC_DB_MANIFESTS = [{
    blueprintId: "bp_test",
    tables: [
        { id: "t1", name: "plans",    columns: ["id","name","price"] },
        { id: "t2", name: "payments", columns: ["id","amount"] },
    ],
}];

fs.writeFileSync(path.join(TMP_DIR, "api-manifests.json"),     JSON.stringify(SYNTHETIC_API_MANIFESTS));
fs.writeFileSync(path.join(TMP_DIR, "db-manifests.json"),      JSON.stringify(SYNTHETIC_DB_MANIFESTS));
fs.writeFileSync(path.join(TMP_DIR, "product-manifests.json"), JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "page-manifests.json"),    JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"),         JSON.stringify([]));
fs.writeFileSync(path.join(TMP_DIR, "rca-reports.json"),       JSON.stringify([]));

// ── Engine cache buster ───────────────────────────────────────────
function freshPlanner() {
    [
        require.resolve("../../agents/runtime/rootCauseAnalyzer.cjs"),
        require.resolve("../../agents/runtime/autoFixPlanner.cjs"),
    ].forEach(p => delete require.cache[p]);
    return require("../../agents/runtime/autoFixPlanner.cjs");
}

// ── RCA report factory ────────────────────────────────────────────
// Produces a minimal RcaReport to feed planInline — no need to run the full pipeline
function makeRca(overrides = {}) {
    return {
        rcaId:       "rca_test_" + Date.now(),
        incidentId:  "inc_test_" + Date.now(),
        analyzedAt:  new Date().toISOString(),
        windowMins:  60,
        incident:    { ruleId: "deploy_failed", title: "Deploy failed", severity: "HIGH", status: "open", openedAt: new Date().toISOString() },
        cause:       { category: "deploy_regression", summary: "Deploy regression", detail: "..." },
        confidence:  75,
        deployCorrelation: { correlated: true, deployId: "tel_1", gitHead: "abc1234", deltaMinutes: 5, deployOk: true, phase: "completed" },
        affectedRoutes: [{ path: "/api/plans", total: 4, errorCount: 4, errorRate: 100, topErrorCodes: [{ code: "CRASH", count: 4 }] }],
        affectedFiles:  [
            { filePath: "backend/routes/plan-management.js",   role: "route",   feature: "plan-management" },
            { filePath: "backend/services/plan-management.js", role: "service", feature: "plan-management" },
        ],
        affectedComponents: [
            { type: "feature", name: "Plan Management", detail: "GET /api/plans" },
        ],
        recommendations: [],
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

function reset() {
    fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"), JSON.stringify([]));
    [
        require.resolve("../../agents/runtime/autoFixPlanner.cjs"),
        require.resolve("../../agents/runtime/rootCauseAnalyzer.cjs"),
    ].forEach(p => delete require.cache[p]);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 1: deploy_regression plan
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 1: deploy_regression plan");
reset();
{
    const afp  = freshPlanner();
    const rca  = makeRca({
        cause:       { category: "deploy_regression", summary: "Deploy regression", detail: "..." },
        incident:    { ruleId: "deploy_failed", title: "Deploy failed", severity: "HIGH", status: "open", openedAt: new Date().toISOString() },
        deployCorrelation: { correlated: true, gitHead: "abc1234", deltaMinutes: 5, deployOk: true, phase: "completed" },
    });
    const p = afp.planInline(rca);

    assert("planId assigned",                      p?.planId?.startsWith("plan_"));
    assert("strategy.category = deploy_regression", p?.strategy?.category === "deploy_regression", `got: ${p?.strategy?.category}`);
    assert("strategy.approach = revert-or-fix",    p?.strategy?.approach === "revert-or-fix");
    assert("pipeline = safe-update",               p?.pipeline?.name === "safe-update", `got: ${p?.pipeline?.name}`);
    assert("risk.level = HIGH",                    p?.risk?.level === "HIGH", `got: ${p?.risk?.level}`);
    assert("suggestedChanges non-empty",           p?.suggestedChanges?.length >= 3);
    assert("has investigate task",                 p?.tasks?.some(t => t.type === "investigate"));
    assert("has run_command task for git show",    p?.tasks?.some(t => t.type === "run_command" && t.command?.includes("abc1234")),
        `tasks: ${p?.tasks?.map(t=>t.type+":"+t.title).join(", ")}`);
    assert("has redeploy task",                    p?.tasks?.some(t => t.type === "redeploy"),
        `tasks: ${p?.tasks?.map(t=>t.type).join(", ")}`);
    assert("has verify task at end",               p?.tasks?.[p.tasks.length-1]?.type === "verify");
    assert("tasks have dependsOn chains",          p?.tasks?.some(t => t.dependsOn?.length > 0));
    assert("patch tasks require approval",         p?.tasks?.filter(t=>t.type==="patch_file")
        .every(t => t.approvalRequired === true));
    assert("status = draft",                       p?.status === "draft");
    assert("confidence >= 60",                     (p?.confidence || 0) >= 60, `got: ${p?.confidence}`);
    assert("targetFiles populated",                p?.targetFiles?.length >= 1, `files: ${p?.targetFiles?.length}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 2: database_error plan
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 2: database_error plan");
reset();
{
    const afp = freshPlanner();
    const rca = makeRca({
        cause:       { category: "database_error", summary: "DB error", detail: "..." },
        incident:    { ruleId: "api_error_spike", title: "API error spike", severity: "CRITICAL", status: "open", openedAt: new Date().toISOString() },
        deployCorrelation: { correlated: false },
        affectedRoutes:  [{ path: "/api/plans", total: 5, errorCount: 5, errorRate: 100, topErrorCodes: [{ code: "DB_CONNECTION_FAILED", count: 5 }] }],
        affectedFiles:   [
            { filePath: "backend/routes/plan-management.js",              role: "route",     feature: "plan-management" },
            { filePath: "backend/services/plan-management.js",            role: "service",   feature: "plan-management" },
            { filePath: "backend/db/migrations/001_plans.sql",            role: "migration", feature: "plan-management" },
        ],
        affectedComponents: [
            { type: "table",   name: "plans",    detail: "accessed by /api/plans" },
            { type: "feature", name: "Plan Management", detail: "/api/plans" },
        ],
    });
    const p = afp.planInline(rca);

    assert("strategy.category = database_error",  p?.strategy?.category === "database_error");
    assert("strategy.approach = migration-repair", p?.strategy?.approach === "migration-repair");
    assert("pipeline = standard-deploy",           p?.pipeline?.name === "standard-deploy", `got: ${p?.pipeline?.name}`);
    assert("risk.level >= HIGH (CRITICAL severity)",
        ["HIGH","CRITICAL"].includes(p?.risk?.level), `got: ${p?.risk?.level}`);
    assert("risk.factors mention DB",              p?.risk?.factors?.some(f => /db|schema|downtime/i.test(f)));
    assert("has run_migration task",               p?.tasks?.some(t => t.type === "run_migration"),
        `tasks: ${p?.tasks?.map(t=>t.type).join(", ")}`);
    assert("migration task comes before service patch",
        (() => {
            const migSeq   = p?.tasks?.find(t => t.type === "run_migration")?.seq;
            const patchSeq = p?.tasks?.find(t => t.type === "patch_file" && t.targetFile?.includes("service"))?.seq;
            return migSeq !== undefined && (patchSeq === undefined || migSeq < patchSeq);
        })()
    );
    assert("suggestedChanges mention connectivity or migration",
        p?.suggestedChanges?.some(s => /connect|migration|pool/i.test(s)));
    assert("targetFiles includes migration",       p?.targetFiles?.some(f => f.role === "migration"),
        `files: ${JSON.stringify(p?.targetFiles?.map(f=>f.role))}`);
    assert("targetFiles migration has priority 1", p?.targetFiles?.find(f => f.role === "migration")?.priority === 1);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 3: code_error / route_failure plan
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 3: code_error plan (route failure)");
reset();
{
    const afp = freshPlanner();
    const rca = makeRca({
        cause:       { category: "code_error", summary: "Route 100% failing", detail: "..." },
        incident:    { ruleId: "route_failure", title: "Route /api/plans is failing", severity: "HIGH", status: "open", openedAt: new Date().toISOString() },
        deployCorrelation: { correlated: false },
        affectedRoutes:  [{ path: "/api/plans", total: 3, errorCount: 3, errorRate: 100, topErrorCodes: [{ code: "UNHANDLED_ERROR", count: 3 }] }],
        affectedFiles:   [
            { filePath: "backend/routes/plan-management.js",   role: "route",   feature: "plan-management" },
            { filePath: "backend/services/plan-management.js", role: "service", feature: "plan-management" },
        ],
    });
    const p = afp.planInline(rca);

    assert("strategy.category = code_error",      p?.strategy?.category === "code_error");
    assert("strategy.approach = patch-and-redeploy", p?.strategy?.approach === "patch-and-redeploy");
    assert("pipeline = safe-update",              p?.pipeline?.name === "safe-update");
    assert("has patch_file task for route",       p?.tasks?.some(t => t.type === "patch_file" && t.targetFile?.includes("route")),
        `tasks: ${p?.tasks?.map(t=>`${t.type}:${t.targetFile}`).join(", ")}`);
    assert("has patch_file task for service",     p?.tasks?.some(t => t.type === "patch_file" && t.targetFile?.includes("service")));
    assert("has run_command for tests",           p?.tasks?.some(t => t.type === "run_command" && t.command?.includes("test")));
    assert("patch tasks before test task",
        (() => {
            const pSeqs = p?.tasks?.filter(t => t.type === "patch_file").map(t => t.seq);
            const tSeq  = p?.tasks?.find(t => t.type === "run_command" && t.command?.includes("test"))?.seq;
            return pSeqs?.length > 0 && tSeq && Math.max(...pSeqs) < tSeq;
        })()
    );
    assert("suggestedChanges mention error handling or exception",
        p?.suggestedChanges?.some(s => /error|exception|try.catch/i.test(s)));
    assert("risk.level MEDIUM or HIGH",           ["MEDIUM","HIGH"].includes(p?.risk?.level), `got: ${p?.risk?.level}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 4: external_dependency plan
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 4: external_dependency plan");
reset();
{
    const afp = freshPlanner();
    const rca = makeRca({
        cause:       { category: "external_dependency", summary: "Gateway timeout", detail: "..." },
        incident:    { ruleId: "api_error_spike", title: "API error spike", severity: "MEDIUM", status: "open", openedAt: new Date().toISOString() },
        deployCorrelation: { correlated: false },
        affectedRoutes:  [{ path: "/api/payment", total: 5, errorCount: 4, errorRate: 80, topErrorCodes: [{ code: "GATEWAY_TIMEOUT", count: 4 }] }],
        affectedFiles:   [
            { filePath: "backend/routes/payment-processing.js", role: "route",   feature: "payment-processing" },
            { filePath: "backend/services/payment-processing.js", role: "service", feature: "payment-processing" },
        ],
    });
    const p = afp.planInline(rca);

    assert("strategy.category = external_dependency", p?.strategy?.category === "external_dependency");
    assert("strategy.approach = circuit-break-and-degrade", p?.strategy?.approach === "circuit-break-and-degrade");
    assert("no redeploy pipeline needed",             p?.pipeline === null, `got: ${JSON.stringify(p?.pipeline)}`);
    assert("risk.level = MEDIUM",                     p?.risk?.level === "MEDIUM", `got: ${p?.risk?.level}`);
    assert("has investigate or run_command task",     p?.tasks?.some(t => t.type === "investigate" || t.type === "run_command"));
    assert("suggestedChanges mention retry or circuit",
        p?.suggestedChanges?.some(s => /retry|circuit|fallback|timeout/i.test(s)));
    assert("has verify task",                         p?.tasks?.some(t => t.type === "verify"));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 5: config_error plan
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 5: config_error plan");
reset();
{
    const afp = freshPlanner();
    const rca = makeRca({
        cause:       { category: "config_error", summary: "Missing env var", detail: "..." },
        incident:    { ruleId: "health_degraded", title: "Health degraded", severity: "LOW", status: "open", openedAt: new Date().toISOString() },
        deployCorrelation: { correlated: false },
        affectedRoutes:  [],
        affectedFiles:   [],
    });
    const p = afp.planInline(rca);

    assert("strategy.category = config_error",    p?.strategy?.category === "config_error");
    assert("strategy.approach = env-fix-and-restart", p?.strategy?.approach === "env-fix-and-restart");
    assert("risk.level = LOW",                    p?.risk?.level === "LOW", `got: ${p?.risk?.level}`);
    assert("has patch_file task for .env",        p?.tasks?.some(t => t.type === "patch_file" && t.targetFile === ".env"),
        `tasks: ${p?.tasks?.map(t=>`${t.type}:${t.targetFile}`).join(", ")}`);
    assert("has restart run_command",             p?.tasks?.some(t => t.type === "run_command" && t.command?.includes("restart")));
    assert("suggestedChanges mention env or JWT", p?.suggestedChanges?.some(s => /env|jwt|key/i.test(s)));
    assert("has verify task",                     p?.tasks?.some(t => t.type === "verify"));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 6: Confidence scoring
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 6: Confidence scoring");
reset();
{
    const afp = freshPlanner();

    // High-confidence: RCA=90, deploy correlated with gitHead, 3 target files, many tasks
    const highRca = makeRca({
        confidence: 90,
        deployCorrelation: { correlated: true, gitHead: "deadbeef", deltaMinutes: 2, deployOk: true },
        affectedFiles: [
            { filePath: "backend/routes/plan-management.js",   role: "route",   feature: "plan-management" },
            { filePath: "backend/services/plan-management.js", role: "service", feature: "plan-management" },
            { filePath: "backend/db/migrations/001_plans.sql", role: "migration", feature: "plan-management" },
        ],
    });
    const highPlan = afp.planInline(highRca);
    assert("high-signal plan: confidence >= 90", (highPlan?.confidence || 0) >= 90,
        `got: ${highPlan?.confidence}`);
    assert("high-signal plan: confidence <= 98", (highPlan?.confidence || 0) <= 98);

    // Low-confidence: RCA=30, no corr, no files, no routes
    const lowRca = makeRca({
        confidence: 30,
        cause: { category: "unknown", summary: "Unknown", detail: "..." },
        incident: { ruleId: "health_degraded", severity: "LOW", status: "open", title: "Degraded", openedAt: new Date().toISOString() },
        deployCorrelation: { correlated: false },
        affectedRoutes: [],
        affectedFiles:  [],
    });
    const lowPlan = afp.planInline(lowRca);
    assert("low-signal plan: confidence < 40",   (lowPlan?.confidence || 0) < 40,
        `got: ${lowPlan?.confidence}`);
    assert("low-signal plan: strategy = manual-triage", lowPlan?.strategy?.approach === "manual-triage");
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 7: listPlans / getPlan / updateStatus
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 7: listPlans / getPlan / updateStatus");
reset();
{
    const afp = freshPlanner();

    const rca1 = makeRca({ rcaId: "rca_filter_test_1", incidentId: "inc_filter_1",
        cause: { category: "deploy_regression", summary: "A", detail: "" } });
    const rca2 = makeRca({ rcaId: "rca_filter_test_2", incidentId: "inc_filter_2",
        cause: { category: "database_error",    summary: "B", detail: "" },
        affectedFiles: [{ filePath: "backend/db/migrations/001_plans.sql", role: "migration", feature: "x" }] });

    const p1 = afp.planInline(rca1);
    const p2 = afp.planInline(rca2);

    const all = afp.listPlans({ limit: 10 });
    assert("listPlans returns 2 plans",           all.length >= 2, `got: ${all.length}`);

    const byRca = afp.listPlans({ rcaId: rca1.rcaId });
    assert("listPlans filters by rcaId",          byRca.length === 1 && byRca[0].rcaId === rca1.rcaId);

    const byStatus = afp.listPlans({ status: "draft" });
    assert("listPlans filters by status=draft",   byStatus.length >= 2);

    const fetched = afp.getPlan(p1.planId);
    assert("getPlan returns correct plan",        fetched?.planId === p1.planId);

    const missing = afp.getPlan("plan_nonexistent");
    assert("getPlan null for missing",            missing === null);

    const upd = afp.updateStatus(p1.planId, "approved");
    assert("updateStatus ok",                     upd.ok, upd.error || "");
    assert("status updated to approved",          upd.plan?.status === "approved");

    const invalidUpd = afp.updateStatus(p1.planId, "nonsense");
    assert("updateStatus rejects invalid status", !invalidUpd.ok);

    const planAfterUpd = afp.getPlan(p1.planId);
    assert("approved status persisted",           planAfterUpd?.status === "approved");
}

// ── Restore fs ────────────────────────────────────────────────────
fs.readFileSync  = _origRead;
fs.writeFileSync = _origWrite;
fs.renameSync    = _origRename;
fs.mkdirSync     = _origMkdir;
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }

// ── Results ───────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════");
console.log("AUTO-FIX PLANNER TEST RESULTS");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log("════════════════════════════════════════");

if (failed > 0) { console.error(`\n${failed} assertion(s) failed.`); process.exit(1); }
else            { console.log("\nAll assertions passed."); process.exit(0); }
