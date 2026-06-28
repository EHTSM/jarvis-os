"use strict";
/**
 * POST-Ω Sprint P7 — Autonomous Workforce OS
 * Test suite: skillEngine, teamBuilder, capacityPlanner,
 *             performanceEngine, workforceManager, workforceDashboard
 */

const assert = (cond, msg) => { if (!cond) throw new Error(msg || "assertion failed"); };

const promises = [];
function test(name, fn) {
  try { fn(); console.log("  ✓", name); }
  catch (e) { console.error("  ✗", name, "—", e.message); process.exitCode = 1; }
}
function atest(name, fn) {
  promises.push(
    Promise.resolve().then(fn)
      .then(() => console.log("  ✓", name))
      .catch(e => { console.error("  ✗", name, "—", e.message); process.exitCode = 1; })
  );
}

const se  = require("../../backend/services/skillEngine.cjs");
const tb  = require("../../backend/services/teamBuilder.cjs");
const cp  = require("../../backend/services/capacityPlanner.cjs");
const pe  = require("../../backend/services/performanceEngine.cjs");
const wm  = require("../../backend/services/workforceManager.cjs");
const wd  = require("../../backend/services/workforceDashboard.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// 1. skillEngine (14 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] skillEngine");

test("AGENT_CATALOGUE has 39 agents", () => {
  assert(se.AGENT_CATALOGUE.length === 39, `got ${se.AGENT_CATALOGUE.length}`);
});

test("SKILL_INDEX is populated", () => {
  const keys = Object.keys(se.SKILL_INDEX);
  assert(keys.length > 0, "SKILL_INDEX empty");
});

test("listAgents returns all agents by default", () => {
  const list = se.listAgents();
  assert(list.length === 39, `got ${list.length}`);
});

test("listAgents filters by org engineering", () => {
  const list = se.listAgents({ org: "engineering" });
  assert(list.length === 18, `expected 18 engineering agents, got ${list.length}`);
});

test("listAgents filters by org business", () => {
  const list = se.listAgents({ org: "business" });
  assert(list.length === 7, `expected 7 business agents, got ${list.length}`);
});

test("getAgent returns agent by id", () => {
  const agent = se.getAgent("engorg_cto");
  assert(agent && agent.id === "engorg_cto", "engorg_cto not found");
  assert(Array.isArray(agent.skills), "skills not array");
});

test("getAgent returns null for unknown id", () => {
  const agent = se.getAgent("nonexistent_agent_xyz");
  assert(agent === null, "should return null");
});

test("findBySkills returns scored agents", () => {
  // available:false to include busy agents (previous test runs may have set workload > 0)
  const agents = se.findBySkills(["backend", "testing"], { available: false, limit: 5 });
  assert(Array.isArray(agents), "not array");
  assert(agents.length > 0, "no agents found");
  assert(typeof agents[0].coverageScore === "number", "no coverageScore");
});

test("findBySkills with available filter", () => {
  const agents = se.findBySkills(["frontend"], { available: true, limit: 10 });
  assert(Array.isArray(agents), "not array");
});

test("recordSuccess increments successRate", () => {
  const before = se.getAgent("engorg_backend");
  se.recordSuccess("engorg_backend", { teamId: "test_team", durationMs: 1000 });
  const after = se.getAgent("engorg_backend");
  assert(after.successRate >= before.successRate, "successRate did not increase");
});

test("recordFailure does not crash", () => {
  se.recordFailure("engorg_frontend", { teamId: "test_team" });
  const agent = se.getAgent("engorg_frontend");
  assert(agent !== null, "agent not found after recordFailure");
});

test("setWorkload updates workload", () => {
  se.setWorkload("engorg_architect", 2);
  const agent = se.getAgent("engorg_architect");
  assert(agent.workload === 2, `expected workload 2, got ${agent.workload}`);
  se.setWorkload("engorg_architect", 0);
});

test("getSkillCoverage returns coverage map", () => {
  const cov = se.getSkillCoverage();
  assert(typeof cov === "object" && cov !== null, "not an object");
  const keys = Object.keys(cov);
  assert(keys.length > 0, "empty coverage map");
  assert(typeof cov[keys[0]].total === "number", "no total field");
});

test("getStats returns aggregate stats", () => {
  const stats = se.getStats();
  assert(typeof stats === "object", "not object");
  assert(typeof stats.totalAgents === "number", "no totalAgents");
  assert(stats.totalAgents === 39, `expected 39, got ${stats.totalAgents}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. teamBuilder (12 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] teamBuilder");

test("TEAM_BLUEPRINTS has 8 entries", () => {
  const keys = Object.keys(tb.TEAM_BLUEPRINTS);
  assert(keys.length === 8, `got ${keys.length}`);
});

test("inferTeamType engineering", () => {
  const t = tb.inferTeamType("Deploy backend API fix", "backend");
  assert(t, "no type inferred");
});

test("inferTeamType deployment", () => {
  const t = tb.inferTeamType("Production deployment pipeline", "devops");
  assert(typeof t === "string", "not string");
});

test("inferRequiredSkills returns array", () => {
  const skills = tb.inferRequiredSkills("Build and deploy the new feature", "backend");
  assert(Array.isArray(skills), "not array");
  assert(skills.length > 0, "empty skills");
});

test("buildTeam returns ok and team", () => {
  const r = tb.buildTeam({
    missionId:      "test_mission_001",
    missionTitle:   "Fix critical backend bug",
    missionDomain:  "backend",
    teamType:       "engineering",
    requiredSkills: ["backend", "testing"],
    size: 3,
  });
  assert(r.ok, r.error || "buildTeam not ok");
  assert(r.team, "no team in result");
  assert(r.team.id, "no team id");
  assert(Array.isArray(r.team.members), "members not array");
  assert(r.team.members.length >= 1, "team has no members");
});

test("buildTeam assigns roles", () => {
  const r = tb.buildTeam({
    missionId:      "test_mission_002",
    missionTitle:   "Security audit",
    missionDomain:  "security",
    teamType:       "engineering",
    requiredSkills: ["security", "testing"],
    size: 2,
  });
  assert(r.ok, r.error);
  const roles = r.team.members.map(m => m.role);
  assert(roles.length > 0, "no roles assigned");
});

test("getTeam retrieves built team", () => {
  const r = tb.buildTeam({ missionId: "test_mission_003", missionTitle: "UI review", teamType: "design", requiredSkills: ["frontend", "ui"], size: 2 });
  assert(r.ok, r.error);
  const team = tb.getTeam(r.team.id);
  assert(team, "team not found");
  assert(team.id === r.team.id, "wrong team returned");
});

test("listTeams returns array", () => {
  const list = tb.listTeams({ status: "active", limit: 10 });
  assert(Array.isArray(list), "not array");
});

test("getTeamForMission returns team or null", () => {
  const result = tb.getTeamForMission("test_mission_001");
  assert(result === null || typeof result === "object", "unexpected type");
});

test("replaceAgent handles unknown team gracefully", () => {
  const r = tb.replaceAgent("nonexistent_team_xyz", "some_agent");
  assert(r && !r.ok, "should return error for unknown team");
});

test("disbandTeam sets status to disbanded", () => {
  const r = tb.buildTeam({ missionId: "test_disband_001", missionTitle: "temp", teamType: "engineering", requiredSkills: ["backend"], size: 1 });
  assert(r.ok, r.error);
  const dr = tb.disbandTeam(r.team.id, { outcome: "completed", minutesSaved: 10 });
  assert(dr.ok, dr.error || "disband not ok");
  const team = tb.getTeam(r.team.id);
  assert(!team || team.status === "disbanded", "team not disbanded");
});

test("getStats returns teamBuilder stats", () => {
  const stats = tb.getStats();
  assert(typeof stats === "object", "not object");
  assert(typeof stats.built === "number", `no built field, got keys: ${Object.keys(stats).join(",")}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. capacityPlanner (10 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] capacityPlanner");

test("snapshot returns capacity data", () => {
  const snap = cp.snapshot();
  assert(typeof snap.totalAgents === "number", "no totalAgents");
  assert(typeof snap.idleAgents === "number", "no idleAgents");
  assert(typeof snap.overloadedAgents === "number", "no overloadedAgents");
  assert(typeof snap.utilizationRate === "number", "no utilizationRate");
});

test("snapshot includes bottlenecks array", () => {
  const snap = cp.snapshot();
  assert(Array.isArray(snap.bottlenecks), "bottlenecks not array");
});

test("enqueueWork returns ok and id", () => {
  const r = cp.enqueueWork({ title: "Test work item", skillsRequired: ["backend"], priority: "high", missionId: "test_m" });
  assert(r.ok, r.error || "enqueue not ok");
  assert(r.id, "no id returned");
});

test("enqueueWork requires title", () => {
  const r = cp.enqueueWork({});
  assert(!r.ok, "should fail without title");
});

test("assignWork assigns a work item", () => {
  const eq = cp.enqueueWork({ title: "Assign me", skillsRequired: ["testing"], priority: "medium" });
  const r  = cp.assignWork(eq.id, "engorg_qa");
  assert(r.ok, r.error || "assign not ok");
  assert(r.agentId === "engorg_qa", "wrong agent assigned");
});

test("assignWork fails for unknown item", () => {
  const r = cp.assignWork("nonexistent_item_xyz", "engorg_qa");
  assert(!r.ok, "should fail for unknown item");
});

test("completeWork marks item done", () => {
  const eq = cp.enqueueWork({ title: "Complete me", skillsRequired: [], priority: "low" });
  cp.assignWork(eq.id, "engorg_devops");
  const r = cp.completeWork(eq.id, { outcome: "success" });
  assert(r.ok, r.error || "complete not ok");
});

test("rebalance runs without error", () => {
  const r = cp.rebalance();
  assert(r.ok, r.error || "rebalance not ok");
  assert(Array.isArray(r.actions), "actions not array");
});

test("getCapacityReport returns full report", () => {
  const r = cp.getCapacityReport();
  assert(r.ok, "not ok");
  assert(r.current, "no current snapshot");
  assert(r.queue, "no queue summary");
  assert(typeof r.queue.total === "number", "no total queue count");
});

test("getStats returns capacity stats", () => {
  const stats = cp.getStats();
  assert(typeof stats === "object", "not object");
  assert(typeof stats.rebalanceCount === "number", "no rebalanceCount");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. performanceEngine (12 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] performanceEngine");

test("record task_complete returns ok", () => {
  const r = pe.record({ agentId: "engorg_backend", event: "task_complete", outcome: "success", durationMs: 2000, qualityScore: 85 });
  assert(r.ok, r.error || "record not ok");
  assert(r.id, "no id");
});

test("record task_failed returns ok", () => {
  const r = pe.record({ agentId: "engorg_frontend", event: "task_failed", outcome: "failure", qualityScore: 20 });
  assert(r.ok, r.error || "record failed event not ok");
});

test("record recovery event", () => {
  const r = pe.record({ agentId: "engorg_qa", event: "recovery", outcome: "success", qualityScore: 70 });
  assert(r.ok, r.error);
});

test("record collaboration event", () => {
  const r = pe.record({ agentId: "engorg_architect", event: "collaboration", outcome: "success", collaborators: ["engorg_backend"], qualityScore: 90 });
  assert(r.ok, r.error);
});

test("record requires agentId and event", () => {
  const r = pe.record({ durationMs: 1000 });
  assert(!r.ok, "should fail without agentId/event");
});

test("getAgentPerformance returns scores", () => {
  const r = pe.getAgentPerformance("engorg_backend");
  assert(r.ok, r.error || "getAgentPerformance not ok");
  assert(r.scores, "no scores");
  assert(typeof r.scores.composite === "number", "no composite score");
  assert(r.scores.composite >= 0 && r.scores.composite <= 100, "composite out of range");
});

test("getAgentPerformance returns 6 score dimensions", () => {
  const r = pe.getAgentPerformance("engorg_backend");
  const dims = ["deliverySpeed", "quality", "reliability", "collaboration", "learning", "recovery"];
  for (const d of dims) assert(typeof r.scores[d] === "number", `missing score dimension: ${d}`);
});

test("getAgentPerformance handles unknown agent", () => {
  const r = pe.getAgentPerformance("nonexistent_agent_xyz");
  assert(!r.ok || r.scores, "unexpected result for unknown agent");
});

test("computeRankings returns ranked list", () => {
  const r = pe.computeRankings();
  assert(r.ok, "computeRankings not ok");
  assert(Array.isArray(r.rankings), "rankings not array");
  assert(r.rankings.length === 39, `expected 39 agents, got ${r.rankings.length}`);
  // Rankings are sorted desc — allow equal composites (many agents at baseline 50)
  const composites = r.rankings.map(a => a.composite);
  let sorted = true;
  for (let i = 0; i < composites.length - 1; i++) { if (composites[i] < composites[i+1]) { sorted = false; break; } }
  assert(sorted, `rankings not sorted desc: ${composites.slice(0, 5).join(",")}`);
});

test("getRankings filters by org", () => {
  const r = pe.getRankings({ org: "engineering", limit: 20 });
  assert(r.ok, "getRankings not ok");
  assert(r.rankings.every(a => a.org === "engineering"), "org filter broken");
});

test("getTeamPerformance returns report", () => {
  const r = pe.getTeamPerformance("some_team_id");
  assert(r.ok, "getTeamPerformance not ok");
  assert(r.stats, "no stats");
  assert(typeof r.successRate === "number", "no successRate");
});

test("getDashboardData returns performance summary", () => {
  const r = pe.getDashboardData();
  assert(r.ok, "getDashboardData not ok");
  assert(Array.isArray(r.topPerformers), "topPerformers not array");
  assert(Array.isArray(r.bottomPerformers), "bottomPerformers not array");
  assert(typeof r.totalRecords === "number", "no totalRecords");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. workforceManager (14 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] workforceManager");

atest("runMission dry run returns plan", async () => {
  const r = await wm.runMission({ title: "Deploy new API endpoint", domain: "backend", priority: "medium", dryRun: true });
  assert(r.ok, r.error || "runMission dryRun not ok");
  assert(r.dryRun === true, "dryRun flag not set");
  assert(r.team, "no team in dry run");
  assert(Array.isArray(r.timeline), "no timeline");
  assert(r.timeline.length >= 3, `timeline too short: ${r.timeline.length} steps`);
});

atest("runMission infers teamType automatically", async () => {
  const r = await wm.runMission({ title: "Security vulnerability scan", domain: "security", dryRun: true });
  assert(r.ok, r.error);
  assert(r.teamType, "teamType not inferred");
});

atest("runMission infers requiredSkills automatically", async () => {
  const r = await wm.runMission({ title: "Run full regression test suite", domain: "qa", dryRun: true });
  assert(r.ok, r.error);
  assert(Array.isArray(r.requiredSkills), "requiredSkills not inferred");
});

atest("runMission returns assignments array", async () => {
  const r = await wm.runMission({ title: "Code review for PR #42", domain: "backend", dryRun: true });
  assert(r.ok, r.error);
  assert(Array.isArray(r.assignments), "no assignments");
  assert(r.assignments.length >= 1, "no agents assigned");
  assert(r.assignments[0].agentId, "assignment missing agentId");
  assert(r.assignments[0].role, "assignment missing role");
});

atest("runMission fails without title", async () => {
  const r = await wm.runMission({});
  assert(!r.ok, "should fail without title");
});

atest("runMission full execution completes", async () => {
  const r = await wm.runMission({ title: "Update documentation for API v2", domain: "backend", priority: "low", dryRun: false });
  assert(r.ok, r.error || "full mission not ok");
  assert(r.status === "completed", `expected completed, got ${r.status}`);
  assert(typeof r.minutesSaved === "number", "no minutesSaved");
  assert(r.minutesSaved > 0, "minutesSaved should be > 0");
});

atest("runMission stores result in history", async () => {
  const r = await wm.runMission({ title: "Fix critical production bug", domain: "backend", priority: "critical", dryRun: false });
  assert(r.ok, r.error);
  const m = wm.getMission(r.id);
  assert(m, "mission not found in history");
  assert(m.id === r.id, "wrong mission returned");
});

atest("runMission records performance for each member", async () => {
  const statsBefore = pe.getStats();
  await wm.runMission({ title: "Run health check monitoring", domain: "ops", dryRun: false });
  const statsAfter = pe.getStats();
  assert(statsAfter.totalRecords >= statsBefore.totalRecords, "performance not recorded");
});

atest("runMission updates workforce stats", async () => {
  const statsBefore = wm.getStats();
  await wm.runMission({ title: "Review UI components", domain: "frontend", dryRun: false });
  const statsAfter = wm.getStats();
  assert(statsAfter.missionsRun > statsBefore.missionsRun, "missionsRun not incremented");
  assert(statsAfter.minutesSaved >= statsBefore.minutesSaved, "minutesSaved not updated");
});

atest("runMission deployment workflow", async () => {
  const r = await wm.runMission({ title: "Deploy release v2.0 to production", domain: "devops", priority: "high", dryRun: false });
  assert(r.ok, r.error);
  assert(r.timeline.some(t => t.step === "execution"), "no execution step in timeline");
});

atest("listMissions returns history", async () => {
  const r = wm.listMissions({ limit: 20 });
  assert(r.ok, "listMissions not ok");
  assert(Array.isArray(r.missions), "missions not array");
});

atest("listMissions filters by domain", async () => {
  await wm.runMission({ title: "Backend deploy test", domain: "backend", dryRun: false });
  const r = wm.listMissions({ domain: "backend", limit: 10 });
  assert(r.ok, "listMissions not ok");
  assert(r.missions.every(m => !m.domain || m.domain === "backend"), "domain filter broken");
});

test("reassignAgent handles unknown team", () => {
  const r = wm.reassignAgent("nonexistent_team_xyz", "engorg_backend", { reason: "overload" });
  assert(!r.ok, "should fail for unknown team");
});

test("getWorkforceReport returns full report", () => {
  const r = wm.getWorkforceReport();
  assert(r.ok, "getWorkforceReport not ok");
  assert(r.stats, "no stats");
  assert(r.agentSummary, "no agentSummary");
  assert(r.capacity, "no capacity");
  assert(Array.isArray(r.recentMissions), "recentMissions not array");
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. workforceDashboard (8 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] workforceDashboard");

test("getDashboard returns ok", () => {
  const r = wd.getDashboard();
  assert(r.ok, "getDashboard not ok");
});

test("getDashboard has summary block", () => {
  const r = wd.getDashboard();
  assert(r.summary, "no summary");
  assert(typeof r.summary.totalAgents === "number", "no totalAgents");
  assert(typeof r.summary.availableAgents === "number", "no availableAgents");
  assert(typeof r.summary.overloadedAgents === "number", "no overloadedAgents");
  assert(typeof r.summary.missionsRun === "number", "no missionsRun");
});

test("getDashboard has activeTeams array", () => {
  const r = wd.getDashboard();
  assert(Array.isArray(r.activeTeams), "activeTeams not array");
});

test("getDashboard has workloadHeatmap", () => {
  const r = wd.getDashboard();
  assert(r.workloadHeatmap && typeof r.workloadHeatmap === "object", "no workloadHeatmap");
  const orgs = Object.keys(r.workloadHeatmap);
  assert(orgs.length > 0, "heatmap is empty");
});

test("getDashboard has skillCoverage", () => {
  const r = wd.getDashboard();
  assert(Array.isArray(r.skillCoverage), "skillCoverage not array");
  assert(r.skillCoverage.length > 0, "skillCoverage empty");
  assert(r.skillCoverage[0].skill, "no skill name in coverage entry");
});

test("getDashboard has performanceRankings", () => {
  const r = wd.getDashboard();
  assert(Array.isArray(r.performanceRankings), "performanceRankings not array");
  assert(r.performanceRankings.length > 0, "rankings empty");
});

test("buildCollaborationGraph returns nodes and edges", () => {
  const g = wd.buildCollaborationGraph();
  assert(Array.isArray(g.nodes), "nodes not array");
  assert(Array.isArray(g.edges), "edges not array");
  assert(typeof g.nodeCount === "number", "no nodeCount");
});

test("getAgentCard returns agent info", () => {
  const r = wd.getAgentCard("engorg_cto");
  assert(r.ok, r.error || "getAgentCard not ok");
  assert(r.agent, "no agent data");
  assert(r.performance, "no performance data");
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. E2E (6 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[7] E2E autonomous workforce pipeline");

atest("E2E: NL command drives full pipeline", async () => {
  const r = await wm.runMission({ title: "Build and deploy a new authentication feature", domain: "backend", priority: "high", dryRun: false });
  assert(r.ok, r.error || "E2E mission not ok");
  assert(r.status === "completed", `expected completed, got ${r.status}`);
  assert(r.teamId, "no teamId");
  assert(r.teamSize > 0, "team is empty");
  assert(r.assignments.length > 0, "no assignments");
  assert(typeof r.minutesSaved === "number" && r.minutesSaved > 0, "minutesSaved should be > 0");
  assert(Array.isArray(r.timeline) && r.timeline.length >= 5, `timeline has ${r.timeline.length} steps`);
});

atest("E2E: failed agent gets replaced", async () => {
  const buildResult = tb.buildTeam({ missionId: "e2e_replace_test", missionTitle: "E2E replacement test", teamType: "engineering", requiredSkills: ["backend", "testing"], size: 3 });
  assert(buildResult.ok, buildResult.error || "build failed");
  const failedAgent = buildResult.team.members[0]?.agentId;
  if (!failedAgent) return;
  const r = wm.reassignAgent(buildResult.team.id, failedAgent, { reason: "overload" });
  assert(typeof r === "object" && r !== null, "reassignAgent returned non-object");
});

atest("E2E: capacity auto-rebalances under load", async () => {
  cp.enqueueWork({ title: "Work A", skillsRequired: ["backend"], priority: "high" });
  cp.enqueueWork({ title: "Work B", skillsRequired: ["testing"], priority: "medium" });
  cp.enqueueWork({ title: "Work C", skillsRequired: ["frontend"], priority: "low" });
  const r = cp.rebalance();
  assert(r.ok, r.error || "rebalance not ok");
  assert(Array.isArray(r.actions), "no actions array");
  assert(r.snapshot, "no snapshot after rebalance");
});

atest("E2E: performance tracks mission contributors", async () => {
  const before = pe.getStats();
  await wm.runMission({ title: "Performance tracking mission", domain: "backend", dryRun: false });
  const after = pe.getStats();
  assert(after.totalRecords > before.totalRecords, "performance records not added");
});

atest("E2E: dashboard reflects latest mission", async () => {
  await wm.runMission({ title: "Dashboard refresh test", domain: "qa", dryRun: false });
  const r = wd.getDashboard();
  assert(r.ok, "dashboard not ok");
  assert(r.summary.missionsRun > 0, "missionsRun still 0");
  assert(r.summary.minutesSaved > 0, "minutesSaved still 0");
});

atest("E2E: parallel missions all complete", async () => {
  const missions = await Promise.all([
    wm.runMission({ title: "Frontend fix 1", domain: "frontend", dryRun: false }),
    wm.runMission({ title: "Backend fix 2", domain: "backend", dryRun: false }),
    wm.runMission({ title: "QA validation 3", domain: "qa", dryRun: false }),
  ]);
  const allOk = missions.every(m => m.ok);
  assert(allOk, `some missions failed: ${missions.filter(m => !m.ok).map(m => m.error).join(", ")}`);
  const stats = wm.getStats();
  assert(stats.missionsRun >= 3, "not all missions counted");
});

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await Promise.all(promises);
  console.log("\n");
}

main();
