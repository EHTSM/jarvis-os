"use strict";
/**
 * Root Cause Analyzer — verification test
 *
 * Scenarios:
 *   1. Failed deploy → deploy_regression cause, deploy correlation, HIGH confidence
 *   2. API error spike with DB_ERROR codes → database_error refinement, file/table analysis
 *   3. Route failure (100% error rate) → code_error, route analysis, file mapping
 *   4. External dependency (GATEWAY_FAIL on /api/payment) → external_dependency cause
 *   5. Confidence scoring — verify accumulation logic across signals
 *   6. analyzeInline with synthetic manifests — file and component analysis populated
 *   7. listReports / getReport — storage and retrieval
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Isolated data dir ─────────────────────────────────────────────
const TMP_DIR        = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-rca-test-"));
const EVENTS_PATH    = path.join(TMP_DIR, "telemetry.json");
const SUMMARY_PATH   = path.join(TMP_DIR, "telemetry-summary.json");
const INCIDENTS_PATH = path.join(TMP_DIR, "incidents.json");
const RCA_PATH       = path.join(TMP_DIR, "rca-reports.json");

// Manifest files — synthetic data for file/component analysis
const API_MANIFESTS_PATH  = path.join(TMP_DIR, "api-manifests.json");
const DB_MANIFESTS_PATH   = path.join(TMP_DIR, "db-manifests.json");
const PAGE_MANIFESTS_PATH = path.join(TMP_DIR, "page-manifests.json");
const PRODUCT_MANIFESTS_PATH = path.join(TMP_DIR, "product-manifests.json");

// Remap real data dir to TMP_DIR
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
            errorFile:     "backend/middleware/errorHandler.js",
            migrations:    ["backend/db/migrations/001_plans.sql"],
            tables: [{ name: "plans", columns: ["id", "name", "price"] }],
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
            tables: [{ name: "payments", columns: ["id", "amount"] }],
        },
    },
];

const SYNTHETIC_DB_MANIFESTS = [
    {
        blueprintId: "bp_test",
        tables: [
            { id: "t1", name: "plans",    columns: ["id", "name", "price"] },
            { id: "t2", name: "payments", columns: ["id", "amount"] },
        ],
    },
];

const SYNTHETIC_PRODUCT_MANIFESTS = [
    { blueprintId: "bp_test", productName: "TestProduct", status: "assembled" },
];

// Write synthetic manifests to tmp dir
fs.writeFileSync(API_MANIFESTS_PATH,     JSON.stringify(SYNTHETIC_API_MANIFESTS));
fs.writeFileSync(DB_MANIFESTS_PATH,      JSON.stringify(SYNTHETIC_DB_MANIFESTS));
fs.writeFileSync(PAGE_MANIFESTS_PATH,    JSON.stringify([]));
fs.writeFileSync(PRODUCT_MANIFESTS_PATH, JSON.stringify(SYNTHETIC_PRODUCT_MANIFESTS));

// ── Engine loader helper ──────────────────────────────────────────
function freshEngines() {
    [
        require.resolve("../../agents/runtime/telemetryEngine.cjs"),
        require.resolve("../../agents/runtime/incidentEngine.cjs"),
        require.resolve("../../agents/runtime/rootCauseAnalyzer.cjs"),
    ].forEach(p => delete require.cache[p]);
    return {
        tel: require("../../agents/runtime/telemetryEngine.cjs"),
        inc: require("../../agents/runtime/incidentEngine.cjs"),
        rca: require("../../agents/runtime/rootCauseAnalyzer.cjs"),
    };
}

function resetData() {
    try { fs.writeFileSync(EVENTS_PATH,    "[]"); } catch { /* ok */ }
    try { fs.writeFileSync(INCIDENTS_PATH, "[]"); } catch { /* ok */ }
    try { fs.writeFileSync(RCA_PATH,       "[]"); } catch { /* ok */ }
}

// ── Test helpers ──────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
    if (condition) {
        passed++;
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    }
}

function section(name) { console.log(`\n── ${name} ──`); }

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 1: Failed deploy → deploy_regression, deploy correlation
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 1: Failed deploy → deploy_regression");
resetData();
{
    const { tel, inc, rca } = freshEngines();

    // A successful deploy 5 minutes before the incident
    const priorDeployTs = new Date(Date.now() - 5 * 60_000).toISOString();
    const priorEvent = {
        id: "tel_prior_1", type: "deploy", ts: priorDeployTs,
        phase: "completed", action: "reload", ok: true,
        gitHead: "abc1234", elapsedMs: 3000, blueprintId: "bp_test",
    };
    const events = [priorEvent];
    fs.writeFileSync(EVENTS_PATH, JSON.stringify(events));

    // Now record the failure (will _appendEvent which adds to front)
    tel.recordDeploy({ phase: "failed", ok: false, error: "health check timeout", elapsedMs: 45000, blueprintId: "bp_test", productName: "TestProduct" });

    const detection = inc.detect({ windowMins: 60 });
    const incident  = detection.openedList.find(i => i.ruleId === "deploy_failed");
    assert("deploy_failed incident opened", !!incident);

    const report = rca.analyze(incident.incidentId, { windowMins: 60 });

    assert("report returned",              !!report);
    assert("rcaId assigned",               report?.rcaId?.startsWith("rca_"));
    assert("cause.category is deploy_regression", report?.cause?.category === "deploy_regression",
        `got: ${report?.cause?.category}`);
    assert("cause.summary contains deploy",  report?.cause?.summary?.toLowerCase().includes("deploy"));
    assert("confidence >= 50",             (report?.confidence || 0) >= 50, `got: ${report?.confidence}`);
    assert("deployCorrelation.correlated", report?.deployCorrelation?.correlated === true);
    assert("deltaMinutes populated",       typeof report?.deployCorrelation?.deltaMinutes === "number");
    assert("recommendations non-empty",    report?.recommendations?.length >= 1);
    assert("recommendations mention commit or deploy", report?.recommendations?.some(r =>
        r.toLowerCase().includes("commit") || r.toLowerCase().includes("deploy")));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 2: API errors with DB_ERROR codes → database_error refinement
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 2: DB_ERROR codes → database_error cause");
resetData();
{
    const { tel, inc, rca } = freshEngines();

    // Load the error spike
    for (let i = 0; i < 4; i++) {
        tel.recordApiRequest({ method: "GET", path: "/api/plans", statusCode: 500, durationMs: 800, blueprintId: "bp_test" });
        tel.recordApiError({ method: "GET", path: "/api/plans", statusCode: 500, errorCode: "DB_CONNECTION_FAILED", message: "Cannot connect to database", blueprintId: "bp_test" });
    }
    tel.recordApiRequest({ method: "GET", path: "/api/plans", statusCode: 200, durationMs: 50, blueprintId: "bp_test" });

    const detection = inc.detect({ windowMins: 60 });
    // api_error_spike or api_repeated_error should fire
    const incident  = detection.openedList.find(i => i.ruleId === "api_error_spike" || i.ruleId === "api_repeated_error");
    assert("api error incident opened", !!incident, `opened rules: ${detection.openedList.map(i=>i.ruleId).join(", ")}`);

    const report = rca.analyze(incident.incidentId, { windowMins: 60 });

    assert("report returned",             !!report);
    assert("cause.category is database_error", report?.cause?.category === "database_error",
        `got: ${report?.cause?.category}`);
    assert("affectedRoutes includes /api/plans", report?.affectedRoutes?.some(r => r.path === "/api/plans"));
    assert("affectedFiles includes route file",  report?.affectedFiles?.some(f => f.role === "route" || f.role === "service"),
        `files: ${JSON.stringify(report?.affectedFiles?.map(f=>f.filePath))}`);
    assert("affectedFiles includes migration",   report?.affectedFiles?.some(f => f.role === "migration"),
        `files: ${JSON.stringify(report?.affectedFiles?.map(f=>f.filePath))}`);
    assert("affectedComponents includes feature", report?.affectedComponents?.some(c => c.type === "feature"),
        `components: ${JSON.stringify(report?.affectedComponents)}`);
    assert("recommendations mention database",    report?.recommendations?.some(r =>
        r.toLowerCase().includes("database") || r.toLowerCase().includes("connection") || r.toLowerCase().includes("migration")));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 3: Route failure (100% error rate) → code_error + route analysis
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 3: Route 100% failure → code_error");
resetData();
{
    const { tel, inc, rca } = freshEngines();

    // 3 total requests to /api/plans, all fail → triggers route_failure
    for (let i = 0; i < 3; i++) {
        tel.recordApiError({ method: "GET", path: "/api/plans", statusCode: 500, errorCode: "UNHANDLED_ERROR", blueprintId: "bp_test" });
        tel.recordApiRequest({ method: "GET", path: "/api/plans", statusCode: 500, durationMs: 200, blueprintId: "bp_test" });
    }

    const detection = inc.detect({ windowMins: 60 });
    const incident  = detection.openedList.find(i => i.ruleId === "route_failure");
    assert("route_failure incident opened", !!incident, `opened: ${detection.openedList.map(i=>i.ruleId).join(", ")}`);

    const report = rca.analyze(incident.incidentId, { windowMins: 60 });

    assert("report returned",              !!report);
    assert("cause.category is code_error or database_error", ["code_error","database_error"].includes(report?.cause?.category),
        `got: ${report?.cause?.category}`);
    assert("affectedRoutes non-empty",     report?.affectedRoutes?.length >= 1);
    const r = report?.affectedRoutes?.find(r => r.path === "/api/plans");
    assert("/api/plans in affectedRoutes", !!r, `routes: ${report?.affectedRoutes?.map(r=>r.path).join(", ")}`);
    assert("errorRate = 100 on /api/plans", r?.errorRate === 100, `errorRate: ${r?.errorRate}`);
    assert("errorCount >= 3 on /api/plans", (r?.errorCount || 0) >= 3, `errorCount: ${r?.errorCount}`);
    assert("topErrorCodes populated",      r?.topErrorCodes?.length >= 1);
    assert("affectedFiles from manifest",  report?.affectedFiles?.length >= 1,
        `files: ${JSON.stringify(report?.affectedFiles)}`);
    assert("recommendations mention route or handler", report?.recommendations?.some(r =>
        r.toLowerCase().includes("route") || r.toLowerCase().includes("exception") || r.toLowerCase().includes("handler") || r.toLowerCase().includes("100%")));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 4: External dependency — GATEWAY_FAIL on /api/payment
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 4: GATEWAY_FAIL → external_dependency");
resetData();
{
    const { tel, inc, rca } = freshEngines();

    for (let i = 0; i < 4; i++) {
        tel.recordApiError({ method: "POST", path: "/api/payment", statusCode: 502, errorCode: "GATEWAY_TIMEOUT", message: "Payment gateway did not respond", blueprintId: "bp_test" });
        tel.recordApiRequest({ method: "POST", path: "/api/payment", statusCode: 502, durationMs: 5000, blueprintId: "bp_test" });
    }
    tel.recordApiRequest({ method: "POST", path: "/api/payment", statusCode: 200, durationMs: 800, blueprintId: "bp_test" });

    const detection = inc.detect({ windowMins: 60 });
    const incident  = detection.openedList.find(i =>
        i.ruleId === "api_error_spike" || i.ruleId === "api_repeated_error" || i.ruleId === "route_failure"
    );
    assert("error incident opened", !!incident, `opened: ${detection.openedList.map(i=>i.ruleId).join(", ")}`);

    const report = rca.analyze(incident.incidentId, { windowMins: 60 });

    assert("report returned",              !!report);
    assert("cause.category is external_dependency", report?.cause?.category === "external_dependency",
        `got: ${report?.cause?.category}`);
    assert("affectedRoutes includes /api/payment", report?.affectedRoutes?.some(r => r.path === "/api/payment"),
        `routes: ${report?.affectedRoutes?.map(r=>r.path).join(", ")}`);
    assert("recommendations mention external service or gateway", report?.recommendations?.some(r =>
        r.toLowerCase().includes("external") || r.toLowerCase().includes("gateway") || r.toLowerCase().includes("status page")));
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 5: Confidence scoring — multiple signals accumulate
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 5: Confidence scoring — multi-signal accumulation");
resetData();
{
    const { tel, inc, rca } = freshEngines();

    // Max signal scenario:
    // - deploy 3 min before
    // - deploy_failed incident (baseConfidence 55)
    // - errorCode matches cause category
    // - route fully failing
    // - evidence deep

    const priorTs = new Date(Date.now() - 3 * 60_000).toISOString();
    fs.writeFileSync(EVENTS_PATH, JSON.stringify([{
        id: "tel_p", type: "deploy", ts: priorTs,
        phase: "completed", ok: true, gitHead: "deadbeef", elapsedMs: 2000,
        blueprintId: "bp_test",
    }]));

    tel.recordDeploy({ phase: "failed", ok: false, error: "oom", elapsedMs: 60000, blueprintId: "bp_test" });
    for (let i = 0; i < 3; i++) {
        tel.recordApiError({ method: "GET", path: "/api/plans", statusCode: 500, errorCode: "DB_OOM", blueprintId: "bp_test" });
        tel.recordApiRequest({ method: "GET", path: "/api/plans", statusCode: 500, blueprintId: "bp_test" });
    }

    const detection = inc.detect({ windowMins: 60 });
    // Manually bump occurrences by running detect again (dedup updates)
    inc.detect({ windowMins: 60 });

    const deployInc = detection.openedList.find(i => i.ruleId === "deploy_failed");
    assert("deploy_failed incident opened", !!deployInc);

    const report = rca.analyze(deployInc.incidentId, { windowMins: 60 });

    assert("report returned",             !!report);
    // deploy_regression base = 55, deploy correlated +20, failed deploy +5, route full fail +10,
    // errorCode match maybe +10, file found +5, evidence depth +5 → could be up to ~95
    assert("confidence >= 70",            (report?.confidence || 0) >= 70,
        `got: ${report?.confidence}`);
    assert("confidence <= 98",            (report?.confidence || 0) <= 98);
    assert("deployCorrelation.correlated", report?.deployCorrelation?.correlated);
    assert("deployCorrelation.gitHead populated", !!report?.deployCorrelation?.gitHead);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 6: analyzeInline — works without persisted incident
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 6: analyzeInline with synthetic incident");
resetData();
{
    const { tel, rca } = freshEngines();

    tel.recordApiError({ method: "GET", path: "/api/plans", statusCode: 500, errorCode: "DB_CONNECTION_FAILED", blueprintId: "bp_test" });
    tel.recordApiRequest({ method: "GET", path: "/api/plans", statusCode: 500, durationMs: 200, blueprintId: "bp_test" });
    tel.recordApiRequest({ method: "GET", path: "/api/plans", statusCode: 200, durationMs: 40, blueprintId: "bp_test" });

    const syntheticIncident = {
        incidentId:       "inc_synthetic_test",
        fingerprint:      "api_repeated_error|bp_test|GET /api/plans",
        ruleId:           "api_repeated_error",
        title:            "Repeated error on GET /api/plans",
        description:      "DB_CONNECTION_FAILED occurred 3 times",
        severity:         "MEDIUM",
        status:           "open",
        blueprintId:      "bp_test",
        productName:      "TestProduct",
        affectedResource: "GET /api/plans",
        evidence:         [{ key: "GET /api/plans:DB_CONNECTION_FAILED", count: 3 }],
        occurrences:      3,
        openedAt:         new Date().toISOString(),
        updatedAt:        new Date().toISOString(),
        acknowledgedAt:   null,
        resolvedAt:       null,
        notes:            [],
    };

    const report = rca.analyzeInline(syntheticIncident, { windowMins: 60 });

    assert("analyzeInline returns report",       !!report);
    assert("rcaId assigned",                     report?.rcaId?.startsWith("rca_"));
    assert("incidentId matches synthetic",       report?.incidentId === "inc_synthetic_test");
    assert("cause.category refined to database_error", report?.cause?.category === "database_error",
        `got: ${report?.cause?.category}`);
    assert("affectedFiles populated via manifest", report?.affectedFiles?.length >= 1,
        `files: ${JSON.stringify(report?.affectedFiles)}`);
    assert("affectedComponents includes feature", report?.affectedComponents?.some(c => c.type === "feature"),
        `components: ${JSON.stringify(report?.affectedComponents?.slice(0,3))}`);
    assert("report persisted",                   rca.listReports({ incidentId: "inc_synthetic_test" }).length >= 1);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 7: listReports / getReport — storage and retrieval
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 7: listReports / getReport");
resetData();
{
    const { tel, inc, rca } = freshEngines();

    tel.recordDeploy({ phase: "failed", ok: false, error: "crash" });
    tel.recordApiError({ method: "POST", path: "/api/payment", statusCode: 502, errorCode: "GATEWAY_FAIL" });
    tel.recordApiRequest({ method: "POST", path: "/api/payment", statusCode: 502 });
    tel.recordApiRequest({ method: "POST", path: "/api/payment", statusCode: 502 });

    const detection   = inc.detect({ windowMins: 60 });
    const incidents   = detection.openedList;
    assert("at least 1 incident for storage test", incidents.length >= 1);

    // Run RCA on the first 2 incidents
    const toAnalyze = incidents.slice(0, 2);
    const reports   = toAnalyze.map(i => rca.analyze(i.incidentId, { windowMins: 60 })).filter(Boolean);

    assert("analyzed 2 incidents",           reports.length === toAnalyze.length,
        `analyzed: ${reports.length}`);

    const all = rca.listReports({ limit: 10 });
    assert("listReports returns entries",    all.length >= 1);

    const byIncident = rca.listReports({ incidentId: toAnalyze[0].incidentId, limit: 5 });
    assert("listReports filters by incidentId", byIncident.length >= 1);
    assert("filtered reports match incidentId", byIncident.every(r => r.incidentId === toAnalyze[0].incidentId));

    const rcaId = reports[0]?.rcaId;
    const fetched = rca.getReport(rcaId);
    assert("getReport returns the report",   !!fetched, `rcaId: ${rcaId}`);
    assert("getReport rcaId matches",        fetched?.rcaId === rcaId);

    const missing = rca.getReport("rca_nonexistent");
    assert("getReport null for missing id",  missing === null);
}

// ── Restore fs ────────────────────────────────────────────────────
fs.readFileSync  = _origRead;
fs.writeFileSync = _origWrite;
fs.renameSync    = _origRename;
fs.mkdirSync     = _origMkdir;
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }

// ── Results ───────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════");
console.log("ROOT CAUSE ANALYZER TEST RESULTS");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log("════════════════════════════════════════");

if (failed > 0) {
    console.error(`\n${failed} assertion(s) failed.`);
    process.exit(1);
} else {
    console.log("\nAll assertions passed.");
    process.exit(0);
}
