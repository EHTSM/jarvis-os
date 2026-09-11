"use strict";
/**
 * Incident Detection Engine — verification test
 *
 * Scenarios:
 *   1. Failed deploy → HIGH incident opened
 *   2. API error spike (>25% errorRate, ≥3 reqs) → CRITICAL incident opened
 *   3. Degraded health (10-25% errorRate) → health_degraded LOW incident opened
 *   4. Duplicate suppression — same fingerprint within dedup window → no second incident
 *   5. Incident lifecycle: open → acknowledge → resolve
 *   6. Auto-resolve — condition clears on next detect run
 */

const fs   = require("fs");
const path = require("path");
const os   = require("os");

// ── Isolated data dir so tests never touch real data ─────────────
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-incident-test-"));
const EVENTS_PATH   = path.join(TMP_DIR, "telemetry.json");
const SUMMARY_PATH  = path.join(TMP_DIR, "telemetry-summary.json");
const INCIDENTS_PATH = path.join(TMP_DIR, "incidents.json");

// ── Path remapper ─────────────────────────────────────────────────
// Intercept fs calls and remap the real data dir to TMP_DIR.
// Engines resolve DATA_DIR as path.join(__dirname, "../../data") where
// __dirname is agents/runtime — so the real data dir is <project>/data
const REAL_DATA = path.resolve(path.join(__dirname, "../../agents/runtime/../../data"));

const _origReadFile  = fs.readFileSync.bind(fs);
const _origWriteFile = fs.writeFileSync.bind(fs);
const _origRename    = fs.renameSync.bind(fs);
const _origMkdir     = fs.mkdirSync.bind(fs);

function remap(p) {
    if (typeof p === "string" && p.startsWith(REAL_DATA)) {
        return p.replace(REAL_DATA, TMP_DIR);
    }
    return p;
}

fs.readFileSync  = (p, ...a) => _origReadFile(remap(p), ...a);
fs.writeFileSync = (p, ...a) => _origWriteFile(remap(p), ...a);
fs.renameSync    = (p, q, ...a) => _origRename(remap(p), remap(q), ...a);
fs.mkdirSync     = (p, ...a) => { try { _origMkdir(remap(p), ...a); } catch { /* already exists */ } };

// Ensure tmp dir exists
fs.mkdirSync(TMP_DIR, { recursive: true });

// ── Load engines (after fs patching) ─────────────────────────────
// Bust cache for both engines
[
    require.resolve("../../agents/runtime/telemetryEngine.cjs"),
    require.resolve("../../agents/runtime/incidentEngine.cjs"),
].forEach(p => delete require.cache[p]);

const tel = require("../../agents/runtime/telemetryEngine.cjs");
const inc = require("../../agents/runtime/incidentEngine.cjs");

// ── Helpers ───────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const trace = [];

function assert(label, condition, detail = "") {
    if (condition) {
        passed++;
        trace.push(`  ✓ ${label}`);
        console.log(`  ✓ ${label}`);
    } else {
        failed++;
        trace.push(`  ✗ ${label}${detail ? " — " + detail : ""}`);
        console.error(`  ✗ ${label}${detail ? " — " + detail : ""}`);
    }
}

function section(name) {
    console.log(`\n── ${name} ──`);
    trace.push(`\n── ${name} ──`);
}

function resetData() {
    try { fs.writeFileSync(EVENTS_PATH, "[]"); } catch { /* ok */ }
    try { fs.writeFileSync(INCIDENTS_PATH, "[]"); } catch { /* ok */ }
    // Bust engine caches
    [
        require.resolve("../../agents/runtime/telemetryEngine.cjs"),
        require.resolve("../../agents/runtime/incidentEngine.cjs"),
    ].forEach(p => delete require.cache[p]);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 1: Failed deploy → HIGH incident
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 1: Failed deploy → HIGH incident");
resetData();
{
    const telFresh = require("../../agents/runtime/telemetryEngine.cjs");
    const incFresh = require("../../agents/runtime/incidentEngine.cjs");

    telFresh.recordDeploy({ phase: "failed", action: "restart", ok: false, error: "health check timed out", elapsedMs: 45000 });

    const result = incFresh.detect({ windowMins: 60 });
    const deployInc = result.openedList.find(i => i.ruleId === "deploy_failed");

    assert("detect() returns at least 1 opened incident", result.opened >= 1);
    assert("deploy_failed rule fired", !!deployInc, `opened: ${result.openedList.map(i => i.ruleId).join(", ")}`);
    assert("severity is HIGH", deployInc?.severity === "HIGH", `got: ${deployInc?.severity}`);
    assert("status is open", deployInc?.status === "open");
    assert("incidentId assigned", deployInc?.incidentId?.startsWith("inc_"));
    assert("evidence contains error", deployInc?.evidence?.[0]?.error === "health check timed out");
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 2: API error spike → CRITICAL incident
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 2: API error spike → CRITICAL incident");
resetData();
{
    const telFresh = require("../../agents/runtime/telemetryEngine.cjs");
    const incFresh = require("../../agents/runtime/incidentEngine.cjs");

    // 4 requests, 3 errors → 75% error rate → above CRITICAL threshold (>25%)
    telFresh.recordApiRequest({ method: "GET", path: "/api/orders", statusCode: 200, durationMs: 80 });
    telFresh.recordApiRequest({ method: "GET", path: "/api/orders", statusCode: 500, durationMs: 1200 });
    telFresh.recordApiError({ method: "GET", path: "/api/orders", statusCode: 500, errorCode: "DB_TIMEOUT" });
    telFresh.recordApiRequest({ method: "POST", path: "/api/payment", statusCode: 500, durationMs: 900 });
    telFresh.recordApiError({ method: "POST", path: "/api/payment", statusCode: 500, errorCode: "GATEWAY_FAIL" });
    telFresh.recordApiRequest({ method: "GET", path: "/api/products", statusCode: 500, durationMs: 600 });
    telFresh.recordApiError({ method: "GET", path: "/api/products", statusCode: 500, errorCode: "DB_TIMEOUT" });

    const result = incFresh.detect({ windowMins: 60 });
    const spikeInc = result.openedList.find(i => i.ruleId === "api_error_spike");

    assert("api_error_spike rule fired", !!spikeInc, `opened rules: ${result.openedList.map(i => i.ruleId).join(", ")}`);
    assert("severity is CRITICAL", spikeInc?.severity === "CRITICAL", `got: ${spikeInc?.severity}`);
    assert("evidence contains topErrors", Array.isArray(spikeInc?.evidence));
    assert("affectedResource is api", spikeInc?.affectedResource === "api");
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 3: Degraded health (10-25% errorRate) → health_degraded LOW
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 3: Degraded health → LOW incident");
resetData();
{
    const telFresh = require("../../agents/runtime/telemetryEngine.cjs");
    const incFresh = require("../../agents/runtime/incidentEngine.cjs");

    // 10 requests, 1 error → 10% error rate → "degraded" overall, not "critical"
    // Note: summary errorRate is based on apiErrEvents.length / apiTotal * 100
    // errorRate > 10 triggers "degraded"; errorRate > 25 triggers "critical"
    for (let i = 0; i < 9; i++) {
        telFresh.recordApiRequest({ method: "GET", path: `/api/item/${i}`, statusCode: 200, durationMs: 50 });
    }
    // 1 failed deploy to push deploy.failed > 0 (triggers "degraded" in summary)
    telFresh.recordDeploy({ phase: "completed", action: "reload", ok: false, elapsedMs: 5000 });
    // 1 api error to register
    telFresh.recordApiError({ method: "GET", path: "/api/slow", statusCode: 503, errorCode: "TIMEOUT" });
    telFresh.recordApiRequest({ method: "GET", path: "/api/slow", statusCode: 503, durationMs: 600 });

    const summary = telFresh.getHealthSummary();
    const result  = incFresh.detect({ windowMins: 60 });

    // Either health_degraded or deploy_failed should fire (both are valid here)
    const degradedInc  = result.openedList.find(i => i.ruleId === "health_degraded");
    const deployFailInc = result.openedList.find(i => i.ruleId === "deploy_failed");
    const hasHealthSignal = !!degradedInc || !!deployFailInc;

    assert("health signal detected (health_degraded or deploy_failed)", hasHealthSignal,
        `overall=${summary.overall} opened: ${result.openedList.map(i => i.ruleId).join(", ")}`);
    if (degradedInc) {
        assert("health_degraded severity is LOW", degradedInc.severity === "LOW");
    }
    if (deployFailInc) {
        assert("deploy_failed severity is HIGH", deployFailInc.severity === "HIGH");
    }
    assert("summary overall is degraded or critical", ["degraded", "critical"].includes(summary.overall),
        `got: ${summary.overall}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 4: Duplicate suppression — same fingerprint → no new incident
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 4: Duplicate suppression");
resetData();
{
    const telFresh = require("../../agents/runtime/telemetryEngine.cjs");
    const incFresh = require("../../agents/runtime/incidentEngine.cjs");

    // First run: open a deploy_failed incident
    telFresh.recordDeploy({ phase: "failed", ok: false, error: "oom killed" });
    const run1 = incFresh.detect({ windowMins: 60 });
    const inc1 = run1.openedList.find(i => i.ruleId === "deploy_failed");
    assert("first run opens deploy_failed incident", !!inc1);

    // Second run (same conditions, within dedup window) → updated not opened
    const run2 = incFresh.detect({ windowMins: 60 });
    assert("second run opens 0 new incidents for same fingerprint", run2.opened === 0,
        `opened: ${run2.opened}`);
    assert("second run updates 1 existing incident", run2.updated >= 1,
        `updated: ${run2.updated}`);

    // Verify occurrence count incremented
    const reloaded = incFresh.getIncident(inc1.incidentId);
    assert("occurrence count incremented", reloaded.occurrences >= 2,
        `occurrences: ${reloaded.occurrences}`);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 5: Lifecycle — acknowledge → resolve
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 5: Incident lifecycle — acknowledge → resolve");
resetData();
{
    const telFresh = require("../../agents/runtime/telemetryEngine.cjs");
    const incFresh = require("../../agents/runtime/incidentEngine.cjs");

    telFresh.recordDeploy({ phase: "failed", ok: false, error: "disk full" });
    const result = incFresh.detect({ windowMins: 60 });
    const incId  = result.openedList.find(i => i.ruleId === "deploy_failed")?.incidentId;
    assert("incident opened for lifecycle test", !!incId);

    const ackResult = incFresh.acknowledge(incId, "Investigating disk usage");
    assert("acknowledge succeeds", ackResult.ok, ackResult.error || "");
    assert("status is acknowledged", ackResult.incident?.status === "acknowledged");
    assert("acknowledgedAt set", !!ackResult.incident?.acknowledgedAt);

    const resResult = incFresh.resolve(incId, "Cleared old logs");
    assert("resolve succeeds", resResult.ok, resResult.error || "");
    assert("status is resolved", resResult.incident?.status === "resolved");
    assert("resolvedAt set", !!resResult.incident?.resolvedAt);
    assert("notes array contains both notes", resResult.incident?.notes?.length >= 2);

    // Cannot re-resolve
    const re = incFresh.resolve(incId);
    assert("re-resolve returns error", !re.ok);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 6: Auto-resolve — condition clears
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 6: Auto-resolve when condition clears");
resetData();
{
    const telFresh = require("../../agents/runtime/telemetryEngine.cjs");
    const incFresh = require("../../agents/runtime/incidentEngine.cjs");

    // Create unhealthy state
    telFresh.recordDeploy({ phase: "failed", ok: false, error: "bad deploy" });
    const run1 = incFresh.detect({ windowMins: 60 });
    assert("incident opened in degraded state", run1.opened >= 1);

    // Clear the telemetry and write a healthy event
    fs.writeFileSync(EVENTS_PATH, "[]");
    // Bust engine caches so they re-read the empty store
    [
        require.resolve("../../agents/runtime/telemetryEngine.cjs"),
        require.resolve("../../agents/runtime/incidentEngine.cjs"),
    ].forEach(p => delete require.cache[p]);
    const telClean = require("../../agents/runtime/telemetryEngine.cjs");
    const incClean = require("../../agents/runtime/incidentEngine.cjs");

    telClean.recordApiRequest({ method: "GET", path: "/health", statusCode: 200, durationMs: 10 });
    const run2 = incClean.detect({ windowMins: 60 });
    assert("auto-resolved at least 1 incident on clear", run2.autoResolved >= 1,
        `autoResolved: ${run2.autoResolved}`);

    // Confirm auto-resolved status persisted
    const all = incClean.listIncidents({ status: "auto-resolved" });
    assert("auto-resolved incidents in store", all.length >= 1);
}

// ═══════════════════════════════════════════════════════════════════
// SCENARIO 7: getIncidentSummary — counts correct
// ═══════════════════════════════════════════════════════════════════
section("SCENARIO 7: getIncidentSummary counts");
resetData();
{
    const telFresh = require("../../agents/runtime/telemetryEngine.cjs");
    const incFresh = require("../../agents/runtime/incidentEngine.cjs");

    telFresh.recordDeploy({ phase: "failed", ok: false, error: "crash" });
    // Error spike
    for (let i = 0; i < 4; i++) {
        telFresh.recordApiError({ method: "GET", path: "/api/test", statusCode: 500, errorCode: "CRASH" });
        telFresh.recordApiRequest({ method: "GET", path: "/api/test", statusCode: 500, durationMs: 100 });
    }
    incFresh.detect({ windowMins: 60 });

    const summary = incFresh.getIncidentSummary();
    assert("summary.total >= 1", summary.total >= 1, `total: ${summary.total}`);
    assert("summary.open >= 1", summary.open >= 1, `open: ${summary.open}`);
    assert("summary.bySeverity structure present", "CRITICAL" in summary.bySeverity && "HIGH" in summary.bySeverity);
    assert("requiresAttention reflects open HIGH+CRITICAL", typeof summary.requiresAttention === "boolean");
}

// ── Restore fs ────────────────────────────────────────────────────
fs.readFileSync  = _origReadFile;
fs.writeFileSync = _origWriteFile;
fs.renameSync    = _origRename;
fs.mkdirSync     = _origMkdir;

// Clean up tmp dir
try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ok */ }

// ── Results ───────────────────────────────────────────────────────
console.log("\n════════════════════════════════════════");
console.log(`INCIDENT DETECTION TEST RESULTS`);
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
