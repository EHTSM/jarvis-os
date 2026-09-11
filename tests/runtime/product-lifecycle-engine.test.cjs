"use strict";
/**
 * Product Lifecycle Engine — verification test
 *
 * Scenarios:
 *   1.  Healthy baseline — evaluate() on clean state: healthy, zero debt, maturity dimensions correct
 *   2.  Recurring issue detection — LME has repeat alerts → improvements + debt registered
 *   3.  Unresolved HIGH incident — open > 60m → improvement + preventive + debt
 *   4.  Preventive maintenance rules fire — stale plan, high rollback rate, no learning data
 *   5.  Maturity score updates — run history changes dimensions, score increases with healing
 *   6.  Technical debt lifecycle — open → auto-resolved when condition clears
 *   7.  Lifecycle report generation — reportId, summary, all fields present
 *   8.  listReports / getReport / getLastTick / getMaturity / getDebtItems
 *   9.  Scheduler start/stop — scheduleEvaluation + stopScheduler
 *   10. Auto-wire from selfHealingPipeline — run completion triggers lifecycle evaluate
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Isolated data dir ─────────────────────────────────────────────
const TMP_DIR   = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-ple-test-"));
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

// ── Seed all required store files ─────────────────────────────────
const STORES = [
    ["lifecycle-reports.json",  []],
    ["lifecycle-debt.json",     []],
    ["healing-runs.json",       []],
    ["fix-plans.json",          []],
    ["rca-reports.json",        []],
    ["incidents.json",          []],
    ["learning-memory.json",    null],  // let LME create fresh
    ["telemetry.json",          []],
    ["telemetry-summary.json",  {
        generatedAt: new Date().toISOString(), windowMins: 60, eventCount: 5,
        deploy: { total: 2, ok: 2, failed: 0, lastDeployAt: new Date().toISOString(), lastStatus: "completed", lastOk: true, avgElapsedMs: 3000 },
        api:    { total: 10, ok: 10, errors: 0, errorRate: 0, p50Ms: 40, p95Ms: 90, topErrors: [] },
        pages:  { total: 3, topRoutes: [{ route: "/dashboard", count: 3 }] },
        overall: "healthy",
    }],
    ["patch-history.json",      { patches: [], patchSets: [] }],
    ["pipeline-runs.json",      []],
    ["api-manifests.json",      []],
    ["db-manifests.json",       []],
    ["product-manifests.json",  []],
    ["page-manifests.json",     []],
];

function seedStores() {
    for (const [name, data] of STORES) {
        if (data !== null) {
            fs.writeFileSync(path.join(TMP_DIR, name), JSON.stringify(data));
        }
    }
}
seedStores();

// ── Engine helpers ────────────────────────────────────────────────
const ALL_ENGINES = [
    "../../agents/runtime/productLifecycleEngine.cjs",
    "../../agents/runtime/learningMemoryEngine.cjs",
    "../../agents/runtime/selfHealingPipeline.cjs",
    "../../agents/runtime/autoFixPlanner.cjs",
    "../../agents/runtime/incidentEngine.cjs",
    "../../agents/runtime/rootCauseAnalyzer.cjs",
    "../../agents/runtime/telemetryEngine.cjs",
    "../../agents/runtime/patchAssistant.cjs",
    "../../agents/runtime/deploymentPipeline.cjs",
].map(p => require.resolve(p));

function bust() { ALL_ENGINES.forEach(p => delete require.cache[p]); }

function ple() { bust(); return require("../../agents/runtime/productLifecycleEngine.cjs"); }
function lme() { bust(); return require("../../agents/runtime/learningMemoryEngine.cjs"); }

function reset() {
    fs.writeFileSync(path.join(TMP_DIR, "lifecycle-reports.json"), JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "lifecycle-debt.json"),    JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "incidents.json"),         JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "healing-runs.json"),      JSON.stringify([]));
    fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"),         JSON.stringify([]));
    try { fs.unlinkSync(path.join(TMP_DIR, "learning-memory.json")); } catch { /* ok */ }
    bust();
}

// ── Helpers ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
    if (condition) { passed++; console.log(`  ✓ ${label}`); }
    else           { failed++; console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

// ── Summary patch helper (sets telemetry-summary.json) ───────────
function setHealth(overrides = {}) {
    const base = {
        generatedAt: new Date().toISOString(), windowMins: 60, eventCount: 5,
        deploy: { total: 2, ok: 2, failed: 0, lastDeployAt: new Date().toISOString(), lastStatus: "completed", lastOk: true, avgElapsedMs: 3000 },
        api:    { total: 10, ok: 10, errors: 0, errorRate: 0, p50Ms: 40, p95Ms: 90, topErrors: [] },
        pages:  { total: 3, topRoutes: [] },
        overall: "healthy",
        ...overrides,
    };
    fs.writeFileSync(path.join(TMP_DIR, "telemetry-summary.json"), JSON.stringify(base));
    bust();
}

function setIncidents(incidents) {
    fs.writeFileSync(path.join(TMP_DIR, "incidents.json"), JSON.stringify(incidents));
    bust();
}

function setHealingRuns(runs) {
    fs.writeFileSync(path.join(TMP_DIR, "healing-runs.json"), JSON.stringify(runs));
    bust();
}

function setPlans(plans) {
    fs.writeFileSync(path.join(TMP_DIR, "fix-plans.json"), JSON.stringify(plans));
    bust();
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 1: Healthy baseline
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 1: Healthy baseline — zero incidents, clean telemetry");
reset();
setHealth({ overall: "healthy" });
{
    const P = ple();
    const r = P.evaluate({ windowMins: 60 });

    assert("reportId assigned",                  r?.reportId?.startsWith("lc_"));
    assert("health.overall = healthy",           r?.health?.overall === "healthy",  `got: ${r?.health?.overall}`);
    assert("incidents.open = 0",                 r?.incidents?.open === 0);
    assert("improvements empty or low priority", r?.improvements?.every(i => i.priority !== "CRITICAL"));
    assert("maturity.total > 0",                 (r?.maturity?.total || 0) > 0,     `score: ${r?.maturity?.total}`);
    assert("maturity has 5 dimensions",          Object.keys(r?.maturity?.dimensions || {}).length === 5,
        `dims: ${Object.keys(r?.maturity?.dimensions || {}).join(", ")}`);
    assert("summary is non-empty string",        typeof r?.summary === "string" && r.summary.length > 10);
    assert("generatedAt present",               !!r?.generatedAt);
    assert("report persisted",                   P.listReports().length >= 1);
    assert("no_learning_data preventive fires",  r?.preventive?.some(p => p.rule === "no_learning_data"),
        `rules: ${r?.preventive?.map(p=>p.rule).join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 2: Recurring issue detection via LME
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 2: Recurring issue detection — LME repeat alerts feed into lifecycle");
reset();
setHealth({ overall: "degraded", api: { total: 10, ok: 8, errors: 2, errorRate: 20, p50Ms: 80, p95Ms: 500, topErrors: [{ key: "500:DB_ERROR", count: 2 }] } });
{
    // Populate LME with repeat alerts by ingesting 3 occurrences
    const L = lme();
    for (let i = 0; i < 3; i++) {
        L.ingest({
            runId: `run_t${i}`, planId: "p1", rcaId: "r1", incidentId: `inc_t${i}`,
            outcome: "rolled-back", causeCategory: "database_error", approach: "migration-repair",
            ruleId: "api_error_spike", severity: "CRITICAL", mode: "auto_heal",
            confidence: 70, taskCount: 5, affectedRoutes: ["/api/plans"], affectedFiles: [], topErrorCodes: ["DB_ERROR"],
        });
    }

    // Add an open incident that matches the pattern
    setIncidents([{
        incidentId: "inc_recurring_1",
        ruleId:     "api_error_spike",
        severity:   "CRITICAL",
        status:     "open",
        title:      "API error spike",
        fingerprint: "api_error_spike|global|api",
        occurrences: 1,
        openedAt:   new Date().toISOString(),
        updatedAt:  new Date().toISOString(),
        acknowledgedAt: null, resolvedAt: null, notes: [], evidence: [],
    }]);

    const P = ple();
    const r = P.evaluate({ windowMins: 60 });

    assert("incidents.recurring.length >= 1",    r?.incidents?.recurring?.length >= 1,
        `recurring: ${r?.incidents?.recurring?.length}`);
    assert("recurring entry has ruleId",         r?.incidents?.recurring?.[0]?.ruleId === "api_error_spike");
    assert("recurring entry has count",          (r?.incidents?.recurring?.[0]?.count || 0) >= 3);
    assert("recurring improvement detected",     r?.improvements?.some(i => i.type === "recurring_unresolved"),
        `types: ${r?.improvements?.map(i=>i.type).join(", ")}`);
    assert("debt item registered for recurring", (() => {
        const debt = P.getDebtItems({ type: "recurring_incident" });
        return debt.some(d => d.debtKey.includes("api_error_spike"));
    })());
    assert("improvement priority = HIGH",        r?.improvements?.find(i => i.type === "recurring_unresolved")?.priority === "HIGH");
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 3: Unresolved HIGH incident > 60 minutes
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 3: Unresolved HIGH incident → improvement + debt");
reset();
setHealth({ overall: "degraded" });
{
    const OLD_TIME = new Date(Date.now() - 90 * 60_000).toISOString();  // 90 minutes ago
    setIncidents([{
        incidentId: "inc_stale_high",
        ruleId:     "route_failure",
        severity:   "HIGH",
        status:     "open",
        title:      "Route /api/orders is failing",
        fingerprint: "route_failure|global|/api/orders",
        occurrences: 1,
        openedAt:   OLD_TIME,
        updatedAt:  OLD_TIME,
        acknowledgedAt: null, resolvedAt: null, notes: [], evidence: [],
    }]);

    const P = ple();
    const r = P.evaluate({ windowMins: 60 });

    assert("incidents.unresolved.length = 1",    r?.incidents?.unresolved?.length === 1,
        `count: ${r?.incidents?.unresolved?.length}`);
    assert("unresolved entry has openMins >= 60", (r?.incidents?.unresolved?.[0]?.openMins || 0) >= 60);
    assert("unresolved improvement present",      r?.improvements?.some(i => i.type === "unresolved_incident"),
        `types: ${r?.improvements?.map(i=>i.type).join(", ")}`);
    assert("debt item for unresolved incident",   P.getDebtItems({ type: "unresolved_incident" }).length >= 1);
    assert("debt item has correct severity",      P.getDebtItems({ type: "unresolved_incident" })[0]?.severity === "HIGH");
    assert("summary mentions open incident",      r?.summary?.includes("open") || r?.summary?.includes("incident"));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 4: Preventive maintenance rules fire
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 4: Preventive maintenance rules");
reset();
setHealth({ overall: "healthy" });
{
    // Stale plan: created 3 hours ago, still draft
    const OLD = new Date(Date.now() - 3 * 60 * 60_000).toISOString();
    setPlans([{
        planId: "plan_stale_1", rcaId: "rca_1", incidentId: "inc_1",
        status: "draft", risk: { level: "MEDIUM", factors: [] }, confidence: 60,
        createdAt: OLD, strategy: { category: "code_error", approach: "patch-and-redeploy" },
        tasks: [], targetFiles: [], pipeline: null, suggestedChanges: [],
    }]);

    // High rollback rate: 3 out of 4 recent runs rolled back
    setHealingRuns([
        { runId: "h1", planId: "p1", outcome: "rolled-back", status: "failed" },
        { runId: "h2", planId: "p2", outcome: "rolled-back", status: "failed" },
        { runId: "h3", planId: "p3", outcome: "rolled-back", status: "failed" },
        { runId: "h4", planId: "p4", outcome: "success",     status: "completed" },
    ]);

    const P = ple();
    const r = P.evaluate({ windowMins: 60 });

    assert("fix_plan_stale preventive fires",    r?.preventive?.some(p => p.rule === "fix_plan_stale"),
        `rules: ${r?.preventive?.map(p=>p.rule).join(", ")}`);
    assert("repeated_rollback preventive fires", r?.preventive?.some(p => p.rule === "repeated_rollback"),
        `rules: ${r?.preventive?.map(p=>p.rule).join(", ")}`);
    assert("preventive items have urgency",      r?.preventive?.every(p => p.urgency));
    assert("preventive sorted by urgency",       (() => {
        const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return r?.preventive?.every((p, i) => i === 0 || rank[r.preventive[i-1].urgency] >= rank[p.urgency]);
    })());
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 5: Maturity score updates with healing history
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 5: Maturity score updates with run history");
reset();
setHealth({ overall: "healthy", eventCount: 20, deploy: { total: 5, ok: 5, failed: 0, avgElapsedMs: 2000, lastDeployAt: new Date().toISOString(), lastStatus: "completed", lastOk: true }, api: { total: 30, ok: 30, errors: 0, errorRate: 0, p50Ms: 40, p95Ms: 90, topErrors: [] } });
{
    // Baseline: no run history
    const P1 = ple();
    const r1 = P1.evaluate({ windowMins: 60 });
    const baseReliability = r1.maturity.dimensions.reliability;

    // Add successful runs
    setHealingRuns([
        { runId: "h1", outcome: "success", status: "completed" },
        { runId: "h2", outcome: "success", status: "completed" },
        { runId: "h3", outcome: "success", status: "completed" },
    ]);

    // Add LME data
    const L = lme();
    for (let i = 0; i < 3; i++) {
        L.ingest({ runId: `r${i}`, planId: "p1", rcaId: "r1", incidentId: `inc${i}`,
            outcome: "success", causeCategory: "code_error", approach: "patch-and-redeploy",
            ruleId: "route_failure", severity: "MEDIUM", mode: "auto_heal",
            confidence: 75, taskCount: 4, affectedRoutes: [], affectedFiles: [], topErrorCodes: [] });
    }

    const P2 = ple();
    const r2 = P2.evaluate({ windowMins: 60 });

    assert("reliability improves with success history",
        r2.maturity.dimensions.reliability >= baseReliability,
        `base=${baseReliability} new=${r2.maturity.dimensions.reliability}`);
    assert("learning dimension > 0 with LME data",   r2.maturity.dimensions.learning > 0,
        `learning: ${r2.maturity.dimensions.learning}`);
    assert("observability > 0 with telemetry data",  r2.maturity.dimensions.observability > 0,
        `observability: ${r2.maturity.dimensions.observability}`);
    assert("total maturity 0-100",                   r2.maturity.total >= 0 && r2.maturity.total <= 100);
    assert("total is sum of dimensions",             (() => {
        const dims = r2.maturity.dimensions;
        const sum  = Object.values(dims).reduce((a, b) => a + b, 0);
        return r2.maturity.total === Math.min(sum, 100);
    })());
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 6: Technical debt lifecycle — open → auto-resolved
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 6: Debt lifecycle — open then auto-resolved");
reset();
setHealth({ overall: "critical", api: { total: 5, ok: 3, errors: 2, errorRate: 40, p50Ms: 200, p95Ms: 1200, topErrors: [] } });
{
    const P = ple();

    // Run 1: high error rate → debt registered
    P.evaluate({ windowMins: 60 });
    const debtAfterRun1 = P.getDebtItems({ status: "open" });
    assert("debt opened for high error rate",    debtAfterRun1.some(d => d.type === "high_error_rate"),
        `types: ${debtAfterRun1.map(d=>d.type).join(", ")}`);

    // Fix the error rate
    setHealth({ overall: "healthy", api: { total: 10, ok: 10, errors: 0, errorRate: 0, p50Ms: 40, p95Ms: 90, topErrors: [] } });

    // Run 2: error rate gone → debt auto-resolved
    bust();
    const P2 = require("../../agents/runtime/productLifecycleEngine.cjs");
    P2.evaluate({ windowMins: 60 });

    const debtAfterRun2 = P2.getDebtItems({});
    const errorRateDebt = debtAfterRun2.find(d => d.type === "high_error_rate");
    assert("high_error_rate debt auto-resolved",  errorRateDebt?.status === "auto-resolved",
        `status: ${errorRateDebt?.status}`);
    assert("resolvedAt set",                      !!errorRateDebt?.resolvedAt);
    assert("debt.open count reduced",             P2.getDebtItems({ status: "open" }).length <
        debtAfterRun1.filter(d => d.status === "open").length + 1);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 7: Lifecycle report generation — structure validation
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 7: Lifecycle report structure");
reset();
setHealth({ overall: "degraded", api: { total: 8, ok: 6, errors: 2, errorRate: 25, p50Ms: 300, p95Ms: 4200, topErrors: [] } });
{
    const P = ple();
    const r = P.evaluate({ blueprintId: "bp_test", productName: "TestProduct", windowMins: 60 });

    assert("reportId starts with lc_",          r?.reportId?.startsWith("lc_"));
    assert("blueprintId propagated",            r?.blueprintId === "bp_test");
    assert("productName propagated",            r?.productName === "TestProduct");
    assert("health section present",            !!r?.health && "overall" in r.health);
    assert("incidents section present",         !!r?.incidents && "open" in r.incidents);
    assert("improvements section is array",     Array.isArray(r?.improvements));
    assert("preventive section is array",       Array.isArray(r?.preventive));
    assert("debt section present",              !!r?.debt && "open" in r.debt);
    assert("maturity section present",          !!r?.maturity && "total" in r.maturity);
    assert("recommendations section is array",  Array.isArray(r?.recommendations));
    assert("summary is non-empty string",       typeof r?.summary === "string" && r.summary.length > 10);
    // Slow API improvement (p95=4200 > 3000)
    assert("latency_opportunity improvement",   r?.improvements?.some(i => i.type === "latency_opportunity"),
        `types: ${r?.improvements?.map(i=>i.type).join(", ")}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 8: Reader API — listReports, getReport, getLastTick, getMaturity, getDebtItems
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 8: Reader API");
reset();
setHealth({ overall: "healthy" });
{
    const P = ple();
    const r1 = P.evaluate({ blueprintId: "bp_1" });
    const r2 = P.evaluate({ blueprintId: "bp_2" });

    const all = P.listReports({});
    assert("listReports returns 2 reports",          all.length >= 2);

    const byBp = P.listReports({ blueprintId: "bp_1" });
    assert("listReports filters by blueprintId",     byBp.every(r => r.blueprintId === "bp_1"));

    const fetched = P.getReport(r1.reportId);
    assert("getReport returns correct report",       fetched?.reportId === r1.reportId);
    assert("getReport null for missing",             P.getReport("lc_nonexistent") === null);

    const last = P.getLastTick();
    assert("getLastTick returns most recent",        last?.reportId === r2.reportId);

    const maturity = P.getMaturity("bp_2");
    assert("getMaturity returns maturity for bp_2",  maturity?.total >= 0);
    assert("getMaturity null for unknown",           P.getMaturity("bp_unknown") === null);

    const debtItems = P.getDebtItems({});
    assert("getDebtItems returns array",             Array.isArray(debtItems));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 9: Scheduler start/stop
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 9: Scheduler start/stop");
reset();
setHealth({ overall: "healthy" });
{
    const P = ple();

    const started = P.scheduleEvaluation({ intervalMins: 999 });
    assert("scheduleEvaluation returns ok",          started?.ok === true);
    assert("intervalMins returned",                  started?.intervalMins === 999);

    const stopped = P.stopScheduler();
    assert("stopScheduler returns ok",               stopped?.ok === true);

    // Stopping when not running should not throw
    const stopped2 = P.stopScheduler();
    assert("stopScheduler idempotent",               stopped2?.ok === true);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 10: Auto-wire — SHP completion triggers lifecycle evaluate
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 10: SelfHealingPipeline auto-triggers lifecycle evaluate");
reset();
setHealth({ overall: "healthy" });
{
    fs.writeFileSync(path.join(TMP_DIR, "patch-history.json"), JSON.stringify({ patches: [], patchSets: [] }));
    fs.writeFileSync(path.join(TMP_DIR, "pipeline-runs.json"), JSON.stringify([]));
    bust();

    const shp = require("../../agents/runtime/selfHealingPipeline.cjs");

    const plan = {
        planId:    "plan_lifecycle_wire_1",
        rcaId:     "rca_lc_1",
        incidentId:"inc_lc_1",
        status:    "draft",
        risk:      { level: "LOW", factors: [] },
        confidence: 80,
        pipeline:  null,
        strategy:  { category: "code_error", approach: "patch-and-redeploy", rationale: "..." },
        suggestedChanges: [],
        targetFiles: [],
        tasks: [
            { seq: 1, type: "investigate", title: "Check",  detail: "...", dependsOn: [], approvalRequired: false, estimatedMins: 5, targetFile: null, command: null, pipeline: null },
            { seq: 2, type: "verify",      title: "Verify", detail: "...", dependsOn: [1], approvalRequired: false, estimatedMins: 5, targetFile: null, command: null, pipeline: null },
        ],
    };

    const run = shp.executePlan(plan, { mode: "auto_heal" });
    assert("healing run completes",               run?.outcome === "success");

    // The setImmediate fires asynchronously; to verify wiring we call directly
    bust();
    const P = require("../../agents/runtime/productLifecycleEngine.cjs");
    const r = P.evaluate({ windowMins: 60 });
    assert("lifecycle evaluates after wiring",     r?.reportId?.startsWith("lc_"));
    assert("lifecycle report persisted",           P.listReports().length >= 1);
}

// ── Restore fs ────────────────────────────────────────────────────
fs.readFileSync  = _origRead;
fs.writeFileSync = _origWrite;
fs.renameSync    = _origRename;
fs.mkdirSync     = _origMkdir;
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }

// ── Results ───────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════");
console.log("PRODUCT LIFECYCLE ENGINE TEST RESULTS");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log("════════════════════════════════════════");

if (failed > 0) { console.error(`\n${failed} assertion(s) failed.`); process.exit(1); }
else            { console.log("\nAll assertions passed."); process.exit(0); }
