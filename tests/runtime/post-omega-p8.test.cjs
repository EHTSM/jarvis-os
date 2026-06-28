"use strict";
/**
 * POST-Ω Sprint P8 — Autonomous Company Factory
 * Test suite: businessTemplateEngine, companyBlueprintEngine,
 *             companyWorkspaceBuilder, companyLifecycleEngine,
 *             companyDashboard, companyFactory
 */

// Prevent booting long-running agentRuntimeSupervisor timers during tests
process.env.SKIP_PLATFORM_REGISTER = "1";

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

const bte   = require("../../backend/services/businessTemplateEngine.cjs");
const cbe   = require("../../backend/services/companyBlueprintEngine.cjs");
const cwb   = require("../../backend/services/companyWorkspaceBuilder.cjs");
const cle   = require("../../backend/services/companyLifecycleEngine.cjs");
const cd    = require("../../backend/services/companyDashboard.cjs");
const cf    = require("../../backend/services/companyFactory.cjs");

// ─────────────────────────────────────────────────────────────────────────────
// 1. businessTemplateEngine (10 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[1] businessTemplateEngine");

test("TEMPLATES has 10 entries", () => {
  const keys = Object.keys(bte.TEMPLATES);
  assert(keys.length === 10, `got ${keys.length}`);
});

test("listTemplates returns all 10", () => {
  const list = bte.listTemplates();
  assert(list.length === 10, `got ${list.length}`);
  assert(list[0].id, "template has no id");
  assert(list[0].skills, "template has no skills");
});

test("getTemplate returns saas template", () => {
  const t = bte.getTemplate("saas");
  assert(t && t.id === "saas", "saas not found");
  assert(t.fullName, "no fullName");
  assert(Array.isArray(t.skills), "skills not array");
  assert(t.minutesSaved > 0, "minutesSaved not set");
});

test("getTemplate returns null for unknown", () => {
  assert(bte.getTemplate("nonexistent_xyz") === null, "should return null");
});

test("inferTemplate detects saas", () => {
  const t = bte.inferTemplate("Build a B2B SaaS subscription platform");
  assert(t.id === "saas", `expected saas, got ${t.id}`);
});

test("inferTemplate detects healthcare", () => {
  const t = bte.inferTemplate("Create a HIPAA-compliant patient management system");
  assert(t.id === "healthcare", `expected healthcare, got ${t.id}`);
});

test("inferTemplate detects marketplace", () => {
  const t = bte.inferTemplate("Two-sided marketplace connecting buyers and sellers");
  assert(t.id === "marketplace", `expected marketplace, got ${t.id}`);
});

test("inferTemplate detects ecommerce", () => {
  const t = bte.inferTemplate("Online store for selling products");
  assert(t.id === "ecommerce", `expected ecommerce, got ${t.id}`);
});

test("inferTemplate detects ai_product", () => {
  const t = bte.inferTemplate("AI copilot tool built on LLM");
  assert(t.id === "ai_product", `expected ai_product, got ${t.id}`);
});

test("inferTemplate defaults to saas for unknown", () => {
  const t = bte.inferTemplate("Something completely generic and unrelated");
  assert(t && t.id, "should return fallback template");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. companyBlueprintEngine (12 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[2] companyBlueprintEngine");

let _bp1; // shared across tests

test("generateBlueprint fails without name", () => {
  const r = cbe.generateBlueprint({ description: "A company" });
  assert(!r.ok, "should fail without name");
});

test("generateBlueprint saas", () => {
  const r = cbe.generateBlueprint({ name: "TestSaaS", templateId: "saas", description: "SaaS platform" });
  assert(r.ok, r.error || "blueprint not ok");
  assert(r.blueprint, "no blueprint");
  assert(r.blueprint.id, "no blueprint id");
  assert(r.blueprint.templateId === "saas", "wrong templateId");
  _bp1 = r.blueprint;
});

test("blueprint has roadmap phases", () => {
  assert(_bp1?.roadmap?.length > 0, "roadmap empty");
  assert(_bp1.roadmap[0].phase, "phase has no name");
  assert(_bp1.roadmap[0].milestones?.length > 0, "no milestones");
  assert(_bp1.roadmap[0].estimatedWeeks > 0, "no estimatedWeeks");
});

test("blueprint has missions", () => {
  assert(_bp1?.missions?.length >= 10, `expected >=10 missions, got ${_bp1?.missions?.length}`);
  assert(_bp1.missions[0].title, "mission has no title");
  assert(_bp1.missions[0].domain, "mission has no domain");
  assert(_bp1.missions[0].priority, "mission has no priority");
});

test("blueprint has risks", () => {
  assert(_bp1?.risks?.length > 0, "no risks");
  assert(_bp1.risks[0].risk, "risk has no description");
  assert(_bp1.risks[0].severity, "risk has no severity");
});

test("blueprint has governance", () => {
  assert(_bp1?.governance, "no governance");
  assert(Array.isArray(_bp1.governance.approvalRequired), "no approvalRequired");
});

test("blueprint has tech stack", () => {
  assert(Array.isArray(_bp1?.techStack) && _bp1.techStack.length > 0, "no techStack");
});

test("blueprint healthcare has extra missions", () => {
  const r = cbe.generateBlueprint({ name: "HealthCo", templateId: "healthcare" });
  assert(r.ok, r.error);
  assert(r.blueprint.missions.some(m => /hipaa/i.test(m.title)), "no HIPAA mission");
  assert(r.blueprint.missions.length > 12, "healthcare blueprint should have extra missions");
});

test("blueprint ai_product has extra missions", () => {
  const r = cbe.generateBlueprint({ name: "AICo", templateId: "ai_product" });
  assert(r.ok, r.error);
  assert(r.blueprint.missions.some(m => /llm|eval/i.test(m.title)), "no LLM/eval mission");
});

test("getBlueprint retrieves by id", () => {
  const bp = cbe.getBlueprint(_bp1.id);
  assert(bp, "blueprint not found");
  assert(bp.id === _bp1.id, "wrong blueprint");
});

test("listBlueprints returns list", () => {
  const r = cbe.listBlueprints({ limit: 10 });
  assert(r.ok, "not ok");
  assert(Array.isArray(r.blueprints), "not array");
  assert(r.blueprints.length >= 1, "no blueprints");
});

test("updateBlueprintStatus changes status", () => {
  const r = cbe.updateBlueprintStatus(_bp1.id, "active");
  assert(r.ok, r.error || "update not ok");
  assert(r.blueprint.status === "active", "status not updated");
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. companyWorkspaceBuilder (10 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[3] companyWorkspaceBuilder");

let _ws1;

test("buildWorkspace fails without blueprintId", async () => {
  const r = await cwb.buildWorkspace(null);
  assert(!r.ok, "should fail without blueprintId");
});

// Run all workspace-dependent tests as a single chained atest to guarantee _ws1 is set first
atest("workspace suite (build + 8 validations)", async () => {
  // Build
  const r = await cwb.buildWorkspace(_bp1.id);
  assert(r.ok, r.error || "buildWorkspace not ok");
  assert(r.workspace, "no workspace");
  assert(r.workspace.id, "no workspace id");
  assert(r.workspace.blueprintId === _bp1.id, "wrong blueprintId");
  _ws1 = r.workspace;

  // Repositories
  assert(_ws1.repositories?.repositories?.length >= 4, `expected 4 repos, got ${_ws1.repositories?.repositories?.length}`);
  assert(_ws1.repositories.repositories[0].name, "repo has no name");
  assert(_ws1.repositories.repositories[0].type, "repo has no type");

  // Documentation
  const docs = _ws1.documentation;
  assert(docs, "no documentation");
  assert(docs.architecture, "no architecture doc");
  assert(docs.runbook, "no runbook");
  assert(docs.productRoadmap, "no productRoadmap");

  // Capability map
  assert(Array.isArray(_ws1.capabilityMap) && _ws1.capabilityMap.length > 0, "no capabilityMap");
  assert(_ws1.capabilityMap[0].capability, "no capability name");
  assert(_ws1.capabilityMap[0].status, "no capability status");

  // Registered missions
  assert(Array.isArray(_ws1.registeredMissions), "registeredMissions not array");

  // Production bible
  assert(_ws1.productionBible, "no productionBible");
  assert(Array.isArray(_ws1.productionBible.workflows) && _ws1.productionBible.workflows.length > 0, "empty workflows in bible");

  // Readiness score
  assert(typeof _ws1.readinessScore === "number", "no readinessScore");
  assert(_ws1.readinessScore >= 0 && _ws1.readinessScore <= 100, "readinessScore out of range");

  // getWorkspaceForBlueprint
  const ws2 = cwb.getWorkspaceForBlueprint(_bp1.id);
  assert(ws2, "workspace not found by blueprintId");
  assert(ws2.blueprintId === _bp1.id, "wrong workspace");

  // listWorkspaces
  const listR = cwb.listWorkspaces({ limit: 10 });
  assert(listR.ok, "listWorkspaces not ok");
  assert(Array.isArray(listR.workspaces) && listR.workspaces.length >= 1, "no workspaces in list");
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. companyLifecycleEngine (12 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[4] companyLifecycleEngine");

let _c1;

test("STAGES has 7 entries", () => {
  assert(cle.STAGES.length === 7, `got ${cle.STAGES.length}: ${cle.STAGES.join(",")}`);
});

test("STAGE_GATES defined for key stages", () => {
  assert(cle.STAGE_GATES.building, "no building gates");
  assert(cle.STAGE_GATES.launch, "no launch gates");
  assert(cle.STAGE_GATES.scale, "no scale gates");
});

test("createCompany fails without blueprintId or name", () => {
  const r = cle.createCompany({});
  assert(!r.ok, "should fail");
});

test("createCompany creates company record", () => {
  const r = cle.createCompany({ blueprintId: _bp1.id, workspaceId: _ws1?.id, name: "TestSaaS", templateId: "saas" });
  assert(r.ok, r.error || "createCompany not ok");
  assert(r.company, "no company");
  assert(r.company.id, "no company id");
  assert(r.company.stage === "planning", `expected planning, got ${r.company.stage}`);
  _c1 = r.company;
});

test("getCompany retrieves by id", () => {
  const c = cle.getCompany(_c1.id);
  assert(c, "company not found");
  assert(c.id === _c1.id, "wrong company");
});

test("passGate marks gate passed", () => {
  const r = cle.passGate(_c1.id, "blueprint_approved", { evidence: "Test approval" });
  assert(r.ok, r.error || "passGate not ok");
  const c = cle.getCompany(_c1.id);
  assert(c.gates["blueprint_approved"]?.passed === true, "gate not marked passed");
});

test("getReadinessForStage returns readiness", () => {
  const r = cle.getReadinessForStage(_c1.id, "building");
  assert(r.ok, r.error || "not ok");
  assert(typeof r.readiness === "number", "no readiness score");
  assert(Array.isArray(r.passed), "passed not array");
  assert(Array.isArray(r.missing), "missing not array");
});

atest("advanceStage blocked by missing gates", async () => {
  const r = await cle.advanceStage(_c1.id);
  assert(!r.ok || r.missing?.length === 0, "should block if gates not met");
});

atest("advanceStage succeeds with force", async () => {
  const r = await cle.advanceStage(_c1.id, { force: true });
  assert(r.ok, r.error || "advance not ok");
  assert(r.to === "building", `expected building, got ${r.to}`);
  assert(r.from === "planning", `expected from planning, got ${r.from}`);
  const c = cle.getCompany(_c1.id);
  assert(c.stage === "building", "stage not updated");
});

atest("advanceStage fails at final stage", async () => {
  const c2 = cle.createCompany({ name: "FinalCo", templateId: "internal_tool" });
  // Force through all stages
  let id = c2.company.id;
  for (let i = 0; i < 6; i++) await cle.advanceStage(id, { force: true });
  const r = await cle.advanceStage(id, { force: true });
  assert(!r.ok, "should fail at final stage");
});

test("listCompanies returns list", () => {
  const r = cle.listCompanies({ limit: 10 });
  assert(r.ok, "not ok");
  assert(Array.isArray(r.companies), "not array");
  assert(r.companies.length >= 1, "no companies");
});

test("updateKPIs updates company kpis", () => {
  const r = cle.updateKPIs(_c1.id, { mrr: 5000, churn: 2.5 });
  assert(r.ok, r.error || "updateKPIs not ok");
  assert(r.kpis.mrr === 5000, "mrr not updated");
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. companyDashboard (6 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[5] companyDashboard");

test("getDashboard returns ok", () => {
  const r = cd.getDashboard();
  assert(r.ok, "getDashboard not ok");
});

test("getDashboard has summary", () => {
  const r = cd.getDashboard();
  assert(r.summary, "no summary");
  assert(typeof r.summary.totalCompanies === "number", "no totalCompanies");
  assert(typeof r.summary.launched === "number", "no launched");
  assert(typeof r.summary.minutesSaved === "number", "no minutesSaved");
});

test("getDashboard has companies array", () => {
  const r = cd.getDashboard();
  assert(Array.isArray(r.companies), "companies not array");
  assert(r.companies.length >= 1, "no companies in dashboard");
  const c = r.companies[0];
  assert(c.id, "company has no id");
  assert(c.progress, "company has no progress");
});

test("getDashboard has lifecycleDistribution", () => {
  const r = cd.getDashboard();
  assert(r.lifecycleDistribution && typeof r.lifecycleDistribution === "object", "no lifecycleDistribution");
});

test("getDashboard has topRisks array", () => {
  const r = cd.getDashboard();
  assert(Array.isArray(r.topRisks), "topRisks not array");
});

test("getCompanyDetail returns full detail", () => {
  const r = cd.getCompanyDetail(_c1.id);
  assert(r.ok, r.error || "getCompanyDetail not ok");
  assert(r.company, "no company");
  assert(r.progress, "no progress");
  assert(typeof r.riskScore === "number", "no riskScore");
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. companyFactory (14 tests)
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n[6] companyFactory");

atest("createCompany fails without idea or name", async () => {
  const r = await cf.createCompany({});
  assert(!r.ok, "should fail without idea or name");
});

atest("createCompany: SaaS via NL idea", async () => {
  const r = await cf.createCompany({ idea: "Create a SaaS company", name: "SaaSCo Alpha" });
  assert(r.ok, r.error || "createCompany not ok");
  assert(r.status === "ready", `expected ready, got ${r.status}`);
  assert(r.companyId, "no companyId");
  assert(r.blueprintId, "no blueprintId");
  assert(r.workspaceId, "no workspaceId");
  assert(r.templateId === "saas", `expected saas, got ${r.templateId}`);
});

atest("createCompany: pipeline runs all 13 steps", async () => {
  const r = await cf.createCompany({ idea: "Build a marketplace", name: "MarketplaceCo" });
  assert(r.ok, r.error);
  assert(Array.isArray(r.timeline), "no timeline");
  const steps = r.timeline.map(t => t.step);
  assert(steps.includes("idea"), "missing idea step");
  assert(steps.includes("blueprint"), "missing blueprint step");
  assert(steps.includes("workspace"), "missing workspace step");
  assert(steps.includes("workforce"), "missing workforce step");
  assert(steps.includes("ready"), "missing ready step");
  assert(r.timeline.length >= 10, `only ${r.timeline.length} steps`);
});

atest("createCompany: Healthcare startup", async () => {
  const r = await cf.createCompany({ idea: "HIPAA-compliant patient management system", name: "HealthVenture", skipApproval: true });
  assert(r.ok, r.error);
  assert(r.templateId === "healthcare", `expected healthcare, got ${r.templateId}`);
  assert(r.checklist.some(c => /hipaa/i.test(c.item)), "no HIPAA checklist item");
});

atest("createCompany: AI Agency", async () => {
  const r = await cf.createCompany({ idea: "Create an AI agency", name: "AIAgency" });
  assert(r.ok, r.error);
  assert(r.templateId === "agency", `expected agency, got ${r.templateId}`);
});

atest("createCompany: Ecommerce store", async () => {
  const r = await cf.createCompany({ idea: "Online ecommerce store", name: "ShopNow" });
  assert(r.ok, r.error);
  assert(r.templateId === "ecommerce", `expected ecommerce, got ${r.templateId}`);
});

atest("createCompany: explicit templateId override", async () => {
  const r = await cf.createCompany({ idea: "Something generic", name: "ERPCo", templateId: "erp", skipApproval: true });
  assert(r.ok, r.error);
  assert(r.templateId === "erp", `expected erp, got ${r.templateId}`);
});

atest("createCompany returns blueprint with missions", async () => {
  const r = await cf.createCompany({ idea: "Internal tool for HR", name: "HRTool" });
  assert(r.ok, r.error);
  assert(r.blueprint, "no blueprint");
  assert(r.missionCount >= 10, `only ${r.missionCount} missions`);
  assert(r.totalWeeks > 0, "no totalWeeks");
});

atest("createCompany returns production checklist", async () => {
  const r = await cf.createCompany({ idea: "SaaS billing platform", name: "BillFlow" });
  assert(r.ok, r.error);
  assert(Array.isArray(r.checklist), "checklist not array");
  assert(r.checklist.length >= 16, `only ${r.checklist.length} checklist items`);
  assert(r.checklist[0].item, "no item text");
  assert(r.checklist[0].category, "no category");
  assert(typeof r.checklist[0].done === "boolean", "no done flag");
});

atest("createCompany records minutesSaved", async () => {
  const before = cf.getStats();
  await cf.createCompany({ idea: "Build a learning management system", name: "LearnCo" });
  const after = cf.getStats();
  assert(after.minutesSaved > before.minutesSaved, "minutesSaved not updated");
  assert(after.totalCreated > before.totalCreated, "totalCreated not incremented");
});

atest("createCompany stores run in history", async () => {
  const r = await cf.createCompany({ idea: "Marketplace for freelancers", name: "FreelanceHub" });
  assert(r.ok, r.error);
  const run = cf.getRun(r.blueprint.id.replace("bp_","cf_")); // may not match exactly
  const runs = cf.listRuns({ limit: 5 });
  assert(runs.ok && Array.isArray(runs.runs), "listRuns failed");
  assert(runs.runs.some(run => run.companyName === "FreelanceHub"), "run not stored");
});

atest("createCompany: company registered in lifecycle", async () => {
  const r = await cf.createCompany({ idea: "ERP system for manufacturing", name: "MfgERP", skipApproval: true });
  assert(r.ok, r.error);
  assert(r.companyId, "no companyId");
  const c = cle.getCompany(r.companyId);
  assert(c, "company not in lifecycle");
  assert(c.stage === "planning", `expected planning, got ${c.stage}`);
  assert(c.gates["blueprint_approved"]?.passed, "blueprint_approved gate not set");
  assert(c.gates["workspace_ready"]?.passed, "workspace_ready gate not set");
  assert(c.gates["team_allocated"]?.passed, "team_allocated gate not set");
});

atest("E2E: parallel company creation", async () => {
  const results = await Promise.all([
    cf.createCompany({ idea: "SaaS analytics tool", name: "AnalyticsCo" }),
    cf.createCompany({ idea: "EdTech learning platform", name: "EduPlatform" }),
    cf.createCompany({ idea: "AI product for developers", name: "DevAI", skipApproval: true }),
  ]);
  const allOk = results.every(r => r.ok);
  assert(allOk, `some failed: ${results.filter(r => !r.ok).map(r => r.error).join(", ")}`);
  assert(new Set(results.map(r => r.companyId)).size === 3, "duplicate companyIds");
});

atest("getStats returns factory stats", async () => {
  const stats = cf.getStats();
  assert(typeof stats === "object", "not object");
  assert(typeof stats.totalCreated === "number", "no totalCreated");
  assert(typeof stats.minutesSaved === "number", "no minutesSaved");
  assert(stats.byTemplate && Object.keys(stats.byTemplate).length > 0, "no byTemplate");
});

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  await Promise.all(promises);
  console.log("\n");
}

main();
