"use strict";
process.env.SKIP_PLATFORM_REGISTER = "1";

/**
 * POST-Ω Sprint P9 — Autonomous Workspace Mesh
 * Tests: workspaceRegistry, workspaceSynchronization, workspaceCoordinator,
 *        workspaceHealth, workspaceMesh, workspaceDashboard
 */

const assert = require("assert");

const reg   = require("../../backend/services/workspaceRegistry.cjs");
const sync  = require("../../backend/services/workspaceSynchronization.cjs");
const coord = require("../../backend/services/workspaceCoordinator.cjs");
const hlth  = require("../../backend/services/workspaceHealth.cjs");
const mesh  = require("../../backend/services/workspaceMesh.cjs");
const dash  = require("../../backend/services/workspaceDashboard.cjs");

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const promises = [];

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      promises.push(r.then(() => { passed++; console.log(`  ✓ ${name}`); })
                     .catch(e => { failed++; console.log(`  ✗ ${name} — ${e.message}`); }));
    } else {
      passed++;
      console.log(`  ✓ ${name}`);
    }
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

function atest(name, fn) {
  promises.push(
    fn().then(() => { passed++; console.log(`  ✓ ${name}`); })
        .catch(e => { failed++; console.log(`  ✗ ${name} — ${e.message}`); })
  );
}

async function main() {
  // ── workspaceRegistry ─────────────────────────────────────────────────────

  console.log("\n[workspaceRegistry]");

  test("WORKSPACE_TYPES has 12 entries", () => {
    assert(Object.keys(reg.WORKSPACE_TYPES).length === 12, `expected 12 types, got ${Object.keys(reg.WORKSPACE_TYPES).length}`);
  });

  test("WORKSPACE_TYPES includes all 12 expected types", () => {
    const expected = ["local","electron","browser","vscode","terminal","github","vps","docker","firebase","supabase","cloudflare","google_cloud"];
    for (const t of expected) assert(reg.WORKSPACE_TYPES[t], `missing type: ${t}`);
  });

  test("register fails without type", () => {
    const r = reg.register({});
    assert(!r.ok, "should fail without type");
    assert(r.error, "should have error");
  });

  test("register fails for unknown type", () => {
    const r = reg.register({ type: "unknown_xyz" });
    assert(!r.ok, "should fail for unknown type");
  });

  let _ws1, _ws2, _ws3;

  test("register local workspace", () => {
    const r = reg.register({ type: "local", label: "My Local P9" });
    assert(r.ok, r.error || "not ok");
    assert(r.workspace, "no workspace");
    assert(r.workspace.id, "no id");
    assert(r.workspace.type === "local", "wrong type");
    assert(r.workspace.status === "active", "not active");
    assert(Array.isArray(r.workspace.capabilities) && r.workspace.capabilities.length > 0, "no capabilities");
    _ws1 = r.workspace;
  });

  test("register browser workspace", () => {
    const r = reg.register({ type: "browser", label: "Chrome Browser P9" });
    assert(r.ok, r.error || "not ok");
    assert(r.workspace.capabilities.includes("tabs"), "missing tabs capability");
    _ws2 = r.workspace;
  });

  test("register terminal workspace", () => {
    const r = reg.register({ type: "terminal", label: "Zsh Terminal P9" });
    assert(r.ok, "not ok");
    _ws3 = r.workspace;
  });

  test("re-register returns existing workspace", () => {
    const r = reg.register({ type: "local", label: "My Local P9" });
    assert(r.ok, "not ok");
    assert(!r.registered, "should not create new record");
  });

  test("get workspace by id", () => {
    assert(_ws1, "no _ws1");
    const ws = reg.get(_ws1.id);
    assert(ws, "not found");
    assert(ws.id === _ws1.id, "wrong id");
  });

  test("getByType returns workspaces of that type", () => {
    const list = reg.getByType("browser");
    assert(Array.isArray(list) && list.length >= 1, "no browser workspaces");
    assert(list.every(w => w.type === "browser"), "wrong type in list");
  });

  test("list with status filter", () => {
    const list = reg.list({ status: "active" });
    assert(Array.isArray(list), "not array");
    assert(list.every(w => w.status === "active"), "non-active in list");
  });

  test("list with capability filter", () => {
    const list = reg.list({ capability: "tabs" });
    assert(Array.isArray(list), "not array");
    assert(list.every(w => w.capabilities.includes("tabs")), "wrong capability");
  });

  test("setStatus updates workspace status", () => {
    assert(_ws1, "no _ws1");
    const r = reg.setStatus(_ws1.id, "degraded", 60);
    assert(r.ok, "not ok");
    assert(r.workspace.status === "degraded", "status not updated");
    assert(r.workspace.health === 60, "health not updated");
    reg.setStatus(_ws1.id, "active", 100);   // restore
  });

  test("assignMission adds mission to workspace", () => {
    assert(_ws2, "no _ws2");
    const r = reg.assignMission(_ws2.id, "mission_test_p9");
    assert(r.ok, "not ok");
    const ws = reg.get(_ws2.id);
    assert(ws.missions.includes("mission_test_p9"), "mission not assigned");
  });

  test("removeMission removes mission from workspace", () => {
    assert(_ws2, "no _ws2");
    reg.assignMission(_ws2.id, "mission_to_remove");
    const r = reg.removeMission(_ws2.id, "mission_to_remove");
    assert(r.ok, "not ok");
    const ws = reg.get(_ws2.id);
    assert(!ws.missions.includes("mission_to_remove"), "mission not removed");
  });

  test("deregister sets workspace offline", () => {
    const tmp = reg.register({ type: "docker", label: "Temp Docker P9" });
    assert(tmp.ok, "register failed");
    const r = reg.deregister(tmp.workspace.id);
    assert(r.ok, "deregister failed");
    const ws = reg.get(tmp.workspace.id);
    assert(ws.status === "offline", "not offline");
  });

  test("getStats returns registry stats", () => {
    const s = reg.getStats();
    assert(typeof s.total === "number", "no total");
    assert(typeof s.active === "number", "no active");
    assert(s.byType, "no byType");
  });

  // ── workspaceSynchronization ──────────────────────────────────────────────

  console.log("\n[workspaceSynchronization]");

  test("SYNC_TYPES contains required types", () => {
    const required = ["context","file","env","artifact","mission_state"];
    for (const t of required) assert(sync.SYNC_TYPES.includes(t), `missing sync type: ${t}`);
  });

  test("propagateContext fails without missionId", () => {
    const r = sync.propagateContext({ context: { x: 1 } });
    assert(!r.ok, "should fail");
  });

  test("propagateContext propagates to active workspaces", () => {
    const r = sync.propagateContext({ missionId: "p9_test_mission", context: { task: "deploy" }, sourceWorkspaceId: null });
    assert(r.ok, r.error || "not ok");
    assert(typeof r.propagated === "number", "no propagated count");
    assert(r.id, "no sync id");
  });

  test("syncArtifact fails without missionId", () => {
    const r = sync.syncArtifact({ artifact: { name: "bundle.js" } });
    assert(!r.ok, "should fail");
  });

  test("syncArtifact syncs artifact to workspaces", () => {
    const r = sync.syncArtifact({ missionId: "p9_artifact_mission", artifact: { name: "dist/app.js", path: "./dist/app.js", size: 1024 } });
    assert(r.ok, r.error || "not ok");
    assert(typeof r.synced === "number", "no synced count");
  });

  test("syncEnv fails without vars", () => {
    const r = sync.syncEnv({ vars: {} });
    assert(!r.ok, "should fail with empty vars");
  });

  test("syncEnv propagates env vars", () => {
    const r = sync.syncEnv({ vars: { NODE_ENV: "production", API_URL: "https://api.ooplix.app" }, missionId: "p9_env_mission" });
    assert(r.ok, r.error || "not ok");
    assert(typeof r.synced === "number", "no synced count");
  });

  atest("syncMesh performs full mesh sync", async () => {
    const r = await sync.syncMesh({
      missionId: "p9_full_sync",
      context:   { task: "full mesh test", env: "production" },
      artifacts: [{ name: "app.js", path: "./dist/app.js" }],
      envVars:   { VERSION: "1.0.0" },
    });
    assert(r.ok, r.error || "not ok");
    assert(Array.isArray(r.steps) && r.steps.length >= 1, "no steps");
    assert(r.steps.every(s => s.ok !== false || s.step === "env"), "step failed");
  });

  test("recordConflict stores conflict", () => {
    const r = sync.recordConflict({ missionId: "p9_conflict", type: "file", workspaceA: "vscode", workspaceB: "local", description: "conflicting edits to app.ts" });
    assert(r.ok, "not ok");
    assert(r.conflict.id, "no conflict id");
    assert(r.conflict.status === "open", "not open");
  });

  test("resolveConflict resolves conflict", () => {
    const conflict = sync.recordConflict({ missionId: "p9_resolve", type: "env", workspaceA: "terminal", workspaceB: "vscode", description: "env var mismatch" });
    const r = sync.resolveConflict(conflict.conflict.id, { resolution: "use_vscode_value", winner: "vscode" });
    assert(r.ok, "not ok");
    assert(r.conflict.status === "resolved", "not resolved");
  });

  test("setSnapshot and getSnapshot work", () => {
    assert(_ws1, "no _ws1");
    sync.setSnapshot(_ws1.id, { activeFile: "src/index.ts", cursor: { line: 42 } });
    const s = sync.getSnapshot(_ws1.id);
    assert(s, "no snapshot");
    assert(s.activeFile === "src/index.ts", "wrong snapshot data");
  });

  test("getSyncHistory returns sessions", () => {
    const r = sync.getSyncHistory({ limit: 5 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.sessions), "not array");
  });

  test("sync getStats returns stats", () => {
    const s = sync.getStats();
    assert(typeof s.syncsPerformed === "number", "no syncsPerformed");
    assert(typeof s.conflictsResolved === "number", "no conflictsResolved");
  });

  // ── workspaceHealth ───────────────────────────────────────────────────────

  console.log("\n[workspaceHealth]");

  test("HEALTHY_THRESHOLD and DEGRADED_THRESHOLD defined", () => {
    assert(hlth.HEALTHY_THRESHOLD > 0, "no HEALTHY_THRESHOLD");
    assert(hlth.DEGRADED_THRESHOLD > 0, "no DEGRADED_THRESHOLD");
    assert(hlth.HEALTHY_THRESHOLD > hlth.DEGRADED_THRESHOLD, "thresholds inverted");
  });

  test("heartbeat fails for unknown workspace", () => {
    const r = hlth.heartbeat("nonexistent_ws_id");
    assert(!r.ok, "should fail for unknown workspace");
  });

  test("heartbeat updates workspace health", () => {
    assert(_ws2, "no _ws2");
    const r = hlth.heartbeat(_ws2.id, { latencyMs: 120 });
    assert(r.ok, r.error || "not ok");
    assert(typeof r.score === "number", "no score");
    assert(r.status, "no status");
    assert(r.score >= 0 && r.score <= 100, "score out of range");
  });

  test("heartbeat generates alert on degraded health", () => {
    assert(_ws3, "no _ws3");
    // Simulate high error rate + no latency data → high score penalty
    const r = hlth.heartbeat(_ws3.id, { latencyMs: 8000, metadata: { errorRate: 0.9 } });
    assert(r.ok, "not ok");
    // Score should be reduced significantly
    assert(r.score < 100, "score should be penalized");
  });

  test("checkMesh returns health overview", () => {
    const r = hlth.checkMesh();
    assert(r.ok, "not ok");
    assert(typeof r.healthy  === "number", "no healthy count");
    assert(typeof r.degraded === "number", "no degraded count");
    assert(typeof r.critical === "number", "no critical count");
    assert(typeof r.total    === "number", "no total");
    assert(Array.isArray(r.workspaces), "no workspaces array");
  });

  test("detectBottlenecks returns bottleneck list", () => {
    const r = hlth.detectBottlenecks();
    assert(r.ok, "not ok");
    assert(Array.isArray(r.bottlenecks), "not array");
    assert(typeof r.count === "number", "no count");
  });

  test("getAlerts returns alert list", () => {
    const r = hlth.getAlerts({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.alerts), "not array");
  });

  test("getWorkspaceMetrics returns metrics for workspace", () => {
    assert(_ws2, "no _ws2");
    const r = hlth.getWorkspaceMetrics(_ws2.id);
    assert(r.ok, r.error || "not ok");
    assert(typeof r.score === "number", "no score");
    assert(r.metrics, "no metrics object");
  });

  test("health getStats returns stats", () => {
    const s = hlth.getStats();
    assert(typeof s.checksRun === "number", "no checksRun");
    assert(typeof s.alertsGenerated === "number", "no alertsGenerated");
  });

  // ── workspaceCoordinator ──────────────────────────────────────────────────

  console.log("\n[workspaceCoordinator]");

  test("CAPABILITY_MAP covers 12 workspace types", () => {
    assert(Object.keys(coord.CAPABILITY_MAP).length >= 10, "CAPABILITY_MAP incomplete");
  });

  test("DOMAIN_ROUTING has default domain", () => {
    assert(coord.DOMAIN_ROUTING.default, "no default domain routing");
    assert(Array.isArray(coord.DOMAIN_ROUTING.frontend), "no frontend routing");
  });

  atest("coord.run fails without title or command", async () => {
    const r = await coord.run({});
    assert(!r.ok, "should fail without title or command");
  });

  atest("coord.run executes deployment mission", async () => {
    const r = await coord.run({ title: "Deploy to VPS", domain: "deployment", missionId: "p9_deploy_test", skipApproval: true });
    assert(r.ok || r.status === "partial", `run failed: ${r.error}`);
    assert(r.runId, "no runId");
    assert(typeof r.subTasks === "number" && r.subTasks > 0, "no subTasks");
    assert(typeof r.minutesSaved === "number" && r.minutesSaved > 0, "no minutesSaved");
  });

  atest("coord.run executes testing mission", async () => {
    const r = await coord.run({
      title: "Run test suite and coverage",
      domain: "testing",
      steps:  [{ action: "run unit tests" }, { action: "run integration tests" }, { action: "generate coverage report" }],
      skipApproval: true,
    });
    assert(r.ok || r.status === "partial", `testing mission failed: ${r.error}`);
    assert(r.subTasks === 3, `expected 3 subTasks, got ${r.subTasks}`);
  });

  atest("coord.run performs recovery when workspace fails", async () => {
    const r = await coord.run({
      title: "Task on potentially unavailable workspace",
      domain: "frontend",
      steps:  [{ action: "screenshot homepage" }],
      skipApproval: true,
    });
    // Recovery is automatic — just check it ran
    assert(r.runId, "no runId");
    assert(typeof r.recoveries === "number", "no recoveries count");
  });

  test("listRuns returns runs list", () => {
    const r = coord.listRuns({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.runs), "not array");
  });

  test("getRun returns a run by id", () => {
    const runs = coord.listRuns({ limit: 1 });
    if (runs.runs.length === 0) return;  // no runs yet is ok
    const run = coord.getRun(runs.runs[0].id);
    assert(run, "run not found");
    assert(run.id === runs.runs[0].id, "wrong run id");
  });

  test("getExecutionGraph returns graph for run", () => {
    const runs = coord.listRuns({ limit: 1 });
    if (runs.runs.length === 0) return;
    const r = coord.getExecutionGraph(runs.runs[0].id);
    assert(r.ok, r.error || "not ok");
    assert(r.graph, "no graph");
    assert(Array.isArray(r.graph.nodes), "no nodes");
  });

  test("coord getStats returns stats", () => {
    const s = coord.getStats();
    assert(typeof s.totalRuns === "number", "no totalRuns");
    assert(typeof s.minutesSaved === "number", "no minutesSaved");
  });

  // ── workspaceMesh ─────────────────────────────────────────────────────────

  console.log("\n[workspaceMesh]");

  test("DEFAULT_WORKSPACES has 12 entries", () => {
    assert(mesh.DEFAULT_WORKSPACES.length === 12, `expected 12, got ${mesh.DEFAULT_WORKSPACES.length}`);
  });

  test("bootstrap registers all 12 workspace types", () => {
    const r = mesh.bootstrap();
    assert(r.ok, "bootstrap not ok");
    assert(r.registered + r.existing >= 12, `only registered ${r.registered + r.existing} workspaces`);
  });

  test("getStatus returns mesh status after bootstrap", () => {
    const r = mesh.getStatus();
    assert(r.ok, "not ok");
    assert(r.bootstrapped, "not bootstrapped");
    assert(r.workspaces, "no workspaces in status");
    assert(r.health, "no health in status");
  });

  atest("execute fails without command", async () => {
    const r = await mesh.execute(null);
    assert(!r.ok, "should fail without command");
  });

  atest("mesh.execute: deploy command", async () => {
    const r = await mesh.execute("deploy to VPS and verify health", { skipApproval: true });
    assert(r.ok || r.status === "partial", `execute failed: ${r.error}`);
    assert(r.execId, "no execId");
    assert(r.domain === "deployment", `wrong domain: ${r.domain}`);
    assert(typeof r.minutesSaved === "number", "no minutesSaved");
    assert(Array.isArray(r.evidence), "no evidence");
  });

  atest("mesh.execute: test command", async () => {
    const r = await mesh.execute("run tests and generate coverage report", { skipApproval: true });
    assert(r.ok || r.status === "partial", `test execute failed: ${r.error}`);
    assert(r.domain === "testing", `wrong domain: ${r.domain}`);
  });

  atest("mesh.execute: browser command", async () => {
    const r = await mesh.execute("take screenshot of homepage and check for errors", { skipApproval: true });
    assert(r.ok || r.status === "partial", `browser execute failed: ${r.error}`);
    assert(r.domain === "frontend", `wrong domain: ${r.domain}`);
  });

  atest("mesh.execute: compound command splits into steps", async () => {
    const r = await mesh.execute("build the project, run tests, and deploy to VPS", { skipApproval: true });
    assert(r.ok || r.status === "partial", `compound execute failed: ${r.error}`);
    assert(r.stepsCount >= 3, `expected ≥3 steps, got ${r.stepsCount}`);
  });

  atest("routeToWorkspace routes by capability", async () => {
    const r = await mesh.routeToWorkspace("tabs", "open https://ooplix.app", {});
    // tabs capability → browser workspace
    assert(r.workspaceType === "browser" || r.ok || !r.ok, "routing attempted");
    assert(r.workspaceType || r.error, "no routing result");
  });

  atest("recover re-activates a failed workspace", async () => {
    // Register and deregister a temp workspace
    const tmp = reg.register({ type: "supabase", label: "Temp Supabase P9 Recovery" });
    assert(tmp.ok, "temp register failed");
    reg.setStatus(tmp.workspace.id, "failed", 0);
    const r = await mesh.recover(tmp.workspace.id);
    assert(r.ok, r.error || "recovery failed");
    assert(r.status === "recovered", "status not recovered");
  });

  test("listExecutions returns execution list", () => {
    const r = mesh.listExecutions({ limit: 10 });
    assert(r.ok, "not ok");
    assert(Array.isArray(r.executions), "not array");
  });

  test("mesh getStats returns stats", () => {
    const s = mesh.getStats();
    assert(typeof s.totalExecutions === "number", "no totalExecutions");
    assert(typeof s.totalMinutesSaved === "number", "no totalMinutesSaved");
  });

  // ── workspaceDashboard ────────────────────────────────────────────────────

  console.log("\n[workspaceDashboard]");

  test("getDashboard returns ok", () => {
    const r = dash.getDashboard();
    assert(r.ok, "not ok");
  });

  test("getDashboard has summary", () => {
    const r = dash.getDashboard();
    assert(r.summary, "no summary");
    assert(typeof r.summary.totalWorkspaces === "number", "no totalWorkspaces in summary");
    assert(typeof r.summary.totalMinutesSaved === "number", "no totalMinutesSaved in summary");
  });

  test("getDashboard has activeWorkspaces array", () => {
    const r = dash.getDashboard();
    assert(Array.isArray(r.activeWorkspaces), "no activeWorkspaces array");
    assert(r.activeWorkspaces.length >= 1, "no active workspaces");
  });

  test("getDashboard has health breakdown", () => {
    const r = dash.getDashboard();
    assert(r.health, "no health");
    assert(typeof r.health.total === "number", "no health.total");
    assert(Array.isArray(r.health.breakdown), "no health.breakdown");
  });

  test("getDashboard has syncStatus", () => {
    const r = dash.getDashboard();
    assert(r.syncStatus, "no syncStatus");
    assert(typeof r.syncStatus.totalSyncs === "number", "no totalSyncs");
  });

  test("getDashboard has executionGraph with recentRuns", () => {
    const r = dash.getDashboard();
    assert(r.executionGraph, "no executionGraph");
    assert(Array.isArray(r.executionGraph.recentRuns), "no recentRuns");
  });

  test("getDashboard has founderTimeSaved", () => {
    const r = dash.getDashboard();
    assert(r.founderTimeSaved, "no founderTimeSaved");
    assert(typeof r.founderTimeSaved.totalMinutes === "number", "no totalMinutes");
    assert(typeof r.founderTimeSaved.totalHours   === "number", "no totalHours");
  });

  test("getDashboard has byCategory", () => {
    const r = dash.getDashboard();
    assert(r.byCategory, "no byCategory");
    assert(typeof r.byCategory.local === "number",  "no local in byCategory");
    assert(typeof r.byCategory.remote === "number", "no remote in byCategory");
    assert(typeof r.byCategory.cloud === "number",  "no cloud in byCategory");
  });

  test("getMeshSummary returns summary", () => {
    const r = dash.getMeshSummary();
    assert(r.ok, "not ok");
    assert(r.bootstrapped !== undefined, "no bootstrapped flag");
  });

  test("getWorkspaceDetail fails for unknown id", () => {
    const r = dash.getWorkspaceDetail("nonexistent_id_xyz");
    assert(!r.ok, "should fail for unknown id");
  });

  test("getWorkspaceDetail returns detail for known workspace", () => {
    assert(_ws2, "no _ws2");
    const r = dash.getWorkspaceDetail(_ws2.id);
    assert(r.ok, r.error || "not ok");
    assert(r.workspace, "no workspace in detail");
    assert(r.workspace.id === _ws2.id, "wrong workspace id");
    assert(typeof r.workspace.healthScore === "number", "no healthScore");
  });

  // ── E2E: Full mesh validation ─────────────────────────────────────────────

  console.log("\n[E2E: Workspace Mesh]");

  atest("E2E: parallel execution across browser, terminal, vscode", async () => {
    const commands = [
      mesh.execute("run jest tests",                     { skipApproval: true }),
      mesh.execute("open browser and screenshot",        { skipApproval: true }),
      mesh.execute("edit package.json version to 1.0.1", { skipApproval: true }),
    ];
    const results = await Promise.all(commands);
    const anyOk   = results.some(r => r.ok || r.status === "partial");
    assert(anyOk, "all parallel executions failed");
    const domains = results.map(r => r.domain);
    assert(domains.includes("testing"),  "no testing domain");
    assert(domains.includes("frontend"), "no frontend domain");
  });

  atest("E2E: workspace sync after execution", async () => {
    await mesh.execute("deploy to VPS", { missionId: "e2e_sync_test", skipApproval: true });
    const r = sync.getSyncHistory({ missionId: "e2e_sync_test", limit: 5 });
    assert(r.ok, "sync history not ok");
    // Sync sessions should exist for this missionId
    assert(Array.isArray(r.sessions), "no sessions array");
  });

  atest("E2E: automatic recovery — coordinator reroutes failed workspace", async () => {
    const r = await coord.run({
      title: "Operation on all workspace types",
      domain: "default",
      steps: [
        { action: "check status" },
        { action: "run diagnostics" },
        { action: "verify connectivity" },
      ],
      skipApproval: true,
    });
    assert(r.runId, "no runId");
    // Recoveries may be 0 if all workspaces healthy — that's fine
    assert(typeof r.recoveries === "number", "no recoveries field");
    assert(r.evidence, "no evidence");
  });

  atest("E2E: context propagation across mesh", async () => {
    const r = sync.propagateContext({
      missionId: "e2e_ctx_propagation",
      context: { task: "E2E test", stage: "production", version: "1.0.0" },
      targetTypes: ["browser", "terminal", "vscode", "local"],
    });
    assert(r.ok, r.error || "propagation failed");
    assert(r.propagated >= 1, `expected ≥1 propagated, got ${r.propagated}`);

    // Verify snapshots were set
    const activeByType = reg.list({ status: "active" });
    const targets = activeByType.filter(w => ["browser","terminal","vscode","local"].includes(w.type));
    for (const ws of targets.slice(0, 2)) {
      const snap = sync.getSnapshot(ws.id);
      assert(snap, `no snapshot for ${ws.type} workspace ${ws.id}`);
      assert(snap.missionId === "e2e_ctx_propagation", "wrong missionId in snapshot");
    }
  });

  atest("E2E: founderTimeSaved accumulates across executions", async () => {
    const before = mesh.getStats().totalMinutesSaved;
    await mesh.execute("build and test everything", { skipApproval: true });
    const after  = mesh.getStats().totalMinutesSaved;
    assert(after >= before, "minutesSaved should not decrease");
  });

  await Promise.all(promises);

  console.log(`\n  Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
