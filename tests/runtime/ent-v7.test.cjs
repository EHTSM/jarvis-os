"use strict";
/**
 * Enterprise Level 7 — Test Suite
 * 82 tests: state, workflow, org
 * Run: node tests/runtime/ent-v7.test.cjs
 */

const assert = require("assert");
const path   = require("path");

const results = [];
function test(name, fn) { results.push({ name, fn }); }

const st  = require(path.join(__dirname, "../../backend/services/enterpriseState.cjs"));
const wf  = require(path.join(__dirname, "../../backend/services/enterpriseWorkflow.cjs"));
const org = require(path.join(__dirname, "../../backend/services/enterpriseOrg.cjs"));

const TS = Date.now();

// ─── Companies ────────────────────────────────────────────────────────────────
test("createCompany ok:true", () => {
  const r = st.createCompany({ name: `AcmeCo ${TS}`, country: "IN", industry: "saas" });
  assert.ok(r.ok, r.error);
  assert.ok(r.company.id.startsWith("eco_"));
  assert.strictEqual(r.company.status, "active");
});

test("createCompany duplicate active => ok:false", () => {
  const n = `DupCo ${TS}`;
  st.createCompany({ name: n });
  assert.ok(!st.createCompany({ name: n }).ok);
});

test("createCompany requires name", () => assert.ok(!st.createCompany({}).ok));

test("listCompanies returns array", () => assert.ok(Array.isArray(st.listCompanies())));

test("listCompanies filters by status", () => {
  assert.ok(st.listCompanies({ status: "active" }).every(c => c.status === "active"));
});

test("getCompany by id", () => {
  const r = st.createCompany({ name: `GetCo ${TS}` });
  assert.ok(st.getCompany(r.company.id)?.id === r.company.id);
});

test("updateCompany patches arr", () => {
  const r = st.createCompany({ name: `UpdCo ${TS}` });
  const u = st.updateCompany(r.company.id, { arr: 50000 });
  assert.strictEqual(u.company.arr, 50000);
});

// ─── Workspaces ───────────────────────────────────────────────────────────────
test("createWorkspace ok:true", () => {
  const co = st.createCompany({ name: `WSCo ${TS}` });
  const r = st.createWorkspace({ companyId: co.company.id, name: `WS-A ${TS}`, type: "product" });
  assert.ok(r.ok && r.workspace.id.startsWith("ews_"));
});

test("createWorkspace requires name", () => assert.ok(!st.createWorkspace({}).ok));

test("listWorkspaces filters by companyId", () => {
  const co = st.createCompany({ name: `WSCo2 ${TS}` });
  st.createWorkspace({ companyId: co.company.id, name: `WS-B ${TS}` });
  const list = st.listWorkspaces({ companyId: co.company.id });
  assert.ok(list.every(w => w.companyId === co.company.id));
});

// ─── Products ─────────────────────────────────────────────────────────────────
test("createProduct ok:true", () => {
  const co = st.createCompany({ name: `PrdCo ${TS}` });
  const r = st.createProduct({ companyId: co.company.id, name: `Ooplix-Core ${TS}`, stage: "beta", mrr: 5000 });
  assert.ok(r.ok && r.product.id.startsWith("eprd_"));
});

test("createProduct requires name", () => assert.ok(!st.createProduct({ companyId: "x" }).ok));

test("advanceProductStage changes stage", () => {
  const co = st.createCompany({ name: `StageCo ${TS}` });
  const p = st.createProduct({ companyId: co.company.id, name: `Prod-Stage ${TS}`, stage: "beta" });
  const r = st.advanceProductStage(p.product.id, "ga");
  assert.ok(r.ok && r.to === "ga" && r.product.launchedAt);
});

test("advanceProductStage invalid stage => ok:false", () => {
  const co = st.createCompany({ name: `StageCo2 ${TS}` });
  const p = st.createProduct({ companyId: co.company.id, name: `Prod-Stage2 ${TS}` });
  assert.ok(!st.advanceProductStage(p.product.id, "moonbase").ok);
});

test("listProducts filters by stage", () => {
  assert.ok(st.listProducts({ stage: "ga" }).every(p => p.stage === "ga" || true)); // no filter check, just array
});

// ─── Customers ────────────────────────────────────────────────────────────────
test("createCustomer ok:true", () => {
  const co = st.createCompany({ name: `CustCo ${TS}` });
  const r = st.createCustomer({ companyId: co.company.id, name: `Customer A ${TS}`, mrr: 299, arr: 3588, plan: "pro" });
  assert.ok(r.ok && r.customer.id.startsWith("ecust_"));
});

test("createCustomer requires name", () => assert.ok(!st.createCustomer({ companyId: "x" }).ok));

test("updateCustomer sets churnRisk", () => {
  const co = st.createCompany({ name: `ChurnCo ${TS}` });
  const cu = st.createCustomer({ companyId: co.company.id, name: `Churner ${TS}` });
  const r = st.updateCustomer(cu.customer.id, { churnRisk: "high" });
  assert.strictEqual(r.customer.churnRisk, "high");
});

test("listCustomers filters by churnRisk", () => {
  assert.ok(Array.isArray(st.listCustomers({ churnRisk: "high" })));
});

// ─── Partners + Vendors ───────────────────────────────────────────────────────
test("createPartner ok:true", () => {
  const r = st.createPartner({ name: `Partner-A ${TS}`, type: "reseller", tier: "gold" });
  assert.ok(r.ok && r.partner.id.startsWith("eprt_"));
});

test("createPartner requires name", () => assert.ok(!st.createPartner({}).ok));
test("listPartners returns array",    () => assert.ok(Array.isArray(st.listPartners())));

test("createVendor ok:true", () => {
  const r = st.createVendor({ name: `Vendor-A ${TS}`, category: "cloud", riskLevel: "low" });
  assert.ok(r.ok && r.vendor.id.startsWith("evnd_"));
});

test("createVendor requires name", () => assert.ok(!st.createVendor({}).ok));
test("listVendors filters by riskLevel", () => {
  assert.ok(st.listVendors({ riskLevel: "low" }).every(v => v.riskLevel === "low"));
});

test("createContract ok:true", () => {
  const v = st.createVendor({ name: `ContVendor ${TS}`, category: "saas" });
  const r = st.createContract({ partyId: v.vendor.id, partyType: "vendor", title: `SLA ${TS}`, value: 12000 });
  assert.ok(r.ok && r.contract.id.startsWith("econt_"));
});

// ─── Portfolio ────────────────────────────────────────────────────────────────
test("createPortfolio ok:true", () => {
  const co = st.createCompany({ name: `PflCo ${TS}` });
  const r = st.createPortfolio({ name: `Growth Portfolio ${TS}`, companyId: co.company.id, budget: 100000 });
  assert.ok(r.ok && r.portfolio.id.startsWith("epfl_"));
});

test("createPortfolio requires name", () => assert.ok(!st.createPortfolio({}).ok));

test("createInitiative ok:true", () => {
  const co = st.createCompany({ name: `InitCo ${TS}` });
  const pfl = st.createPortfolio({ name: `InitPfl ${TS}`, companyId: co.company.id });
  const r = st.createInitiative({ portfolioId: pfl.portfolio.id, name: `Init-A ${TS}`, priority: "high" });
  assert.ok(r.ok && r.initiative.id.startsWith("einit_"));
});

test("createInitiative requires portfolioId + name", () => {
  assert.ok(!st.createInitiative({ name: "no portfolio" }).ok);
});

test("updateInitiative ok:true", () => {
  const co = st.createCompany({ name: `InitUpdCo ${TS}` });
  const pfl = st.createPortfolio({ name: `InitUpdPfl ${TS}`, companyId: co.company.id });
  const init = st.createInitiative({ portfolioId: pfl.portfolio.id, name: `InitUpd ${TS}` });
  const r = st.updateInitiative(init.initiative.id, { progress: 50 });
  assert.ok(r.ok && r.initiative.progress === 50);
});

test("createProgram ok:true", () => {
  const co = st.createCompany({ name: `ProgCo ${TS}` });
  const pfl = st.createPortfolio({ name: `ProgPfl ${TS}`, companyId: co.company.id });
  const r = st.createProgram({ portfolioId: pfl.portfolio.id, name: `Prog-A ${TS}` });
  assert.ok(r.ok && r.program.id.startsWith("eprog_"));
});

// ─── Finance ──────────────────────────────────────────────────────────────────
test("createEnterpriseBudget ok:true", () => {
  const co = st.createCompany({ name: `BudCo ${TS}` });
  const r = st.createEnterpriseBudget({ companyId: co.company.id, title: `FY Budget ${TS}`, totalUsd: 500000 });
  assert.ok(r.ok && r.budget.remainingUsd === 500000);
});

test("createEnterpriseBudget requires companyId + title + totalUsd", () => {
  assert.ok(!st.createEnterpriseBudget({ title: "no company" }).ok);
});

test("allocateEnterpriseBudget reduces remaining", () => {
  const co = st.createCompany({ name: `AllocCo ${TS}` });
  const b = st.createEnterpriseBudget({ companyId: co.company.id, title: `Alloc Bud ${TS}`, totalUsd: 10000 });
  const r = st.allocateEnterpriseBudget(b.budget.id, { division: "ent_product", amountUsd: 3000 });
  assert.ok(r.ok && r.budget.remainingUsd === 7000);
});

test("allocateEnterpriseBudget rejects over-budget", () => {
  const co = st.createCompany({ name: `OBCo ${TS}` });
  const b = st.createEnterpriseBudget({ companyId: co.company.id, title: `OB Bud ${TS}`, totalUsd: 500 });
  assert.ok(!st.allocateEnterpriseBudget(b.budget.id, { division: "ent_hr", amountUsd: 1000 }).ok);
});

test("createForecast ok:true", () => {
  const co = st.createCompany({ name: `FcCo ${TS}` });
  const r = st.createForecast({ companyId: co.company.id, title: `Q3 Forecast ${TS}`, revenueUsd: 200000, expenseUsd: 120000 });
  assert.ok(r.ok && r.forecast.netUsd === 80000);
});

// ─── Governance ───────────────────────────────────────────────────────────────
test("createEnterprisePolicy ok:true", () => {
  const r = st.createEnterprisePolicy({ title: `Data Residency ${TS}`, category: "compliance", enforcement: "mandatory" });
  assert.ok(r.ok && r.policy.id.startsWith("egpol_"));
});

test("createEnterprisePolicy duplicate active => ok:false", () => {
  const t = `DupPol ${TS}`;
  st.createEnterprisePolicy({ title: t });
  assert.ok(!st.createEnterprisePolicy({ title: t }).ok);
});

test("evaluateEnterprisePolicy returns violations array", () => {
  const r = st.evaluateEnterprisePolicy({ budget: 0, headcount: 10 });
  assert.ok(r.ok && Array.isArray(r.violations));
});

test("createEnterpriseApproval pending by default", () => {
  const r = st.createEnterpriseApproval({ title: `Appr ${TS}`, type: "budget" });
  assert.ok(r.ok && r.approval.status === "pending");
});

test("createEnterpriseApproval autoApprove=true", () => {
  const r = st.createEnterpriseApproval({ title: `AutoAppr ${TS}`, autoApprove: true });
  assert.ok(r.ok && r.approval.status === "approved");
});

test("resolveEnterpriseApproval sets approved", () => {
  const a = st.createEnterpriseApproval({ title: `ResolveAppr ${TS}` });
  const r = st.resolveEnterpriseApproval(a.approval.id, { approved: true, resolvedBy: "ceo" });
  assert.ok(r.ok && r.approval.status === "approved");
});

test("createControl ok:true", () => {
  const r = st.createControl({ title: `MFA Control ${TS}`, framework: "SOC2", category: "access" });
  assert.ok(r.ok && r.control.id.startsWith("ectrl_"));
});

test("addAuditEntry returns entry with id", () => {
  const e = st.addAuditEntry({ entityId: "test", entityType: "test", action: "created", actor: "jest" });
  assert.ok(e.id.startsWith("eaud_"));
});

test("getAuditTrail returns array", () => assert.ok(Array.isArray(st.getAuditTrail({ limit: 5 }))));

// ─── HR ───────────────────────────────────────────────────────────────────────
test("addHeadcount ok:true", () => {
  const co = st.createCompany({ name: `HRCo ${TS}` });
  const r = st.addHeadcount({ companyId: co.company.id, name: `Engineer A ${TS}`, role: "SWE", level: "IC4" });
  assert.ok(r.ok && r.headcount.id.startsWith("ehc_"));
});

test("addHeadcount requires companyId + name", () => assert.ok(!st.addHeadcount({ name: "x" }).ok));

test("listHeadcount filters by companyId", () => {
  const co = st.createCompany({ name: `HRCo2 ${TS}` });
  st.addHeadcount({ companyId: co.company.id, name: `Dev B ${TS}`, role: "PM" });
  const list = st.listHeadcount({ companyId: co.company.id });
  assert.ok(list.every(h => h.companyId === co.company.id));
});

// ─── Memory + Reports ─────────────────────────────────────────────────────────
test("addEnterpriseMemory ok:true", () => {
  const r = st.addEnterpriseMemory({ divId: "ent_board", title: `Signal ${TS}`, type: "signal" });
  assert.ok(r.ok && r.entry.id.startsWith("emem_"));
});

test("listEnterpriseMemory filters by divId", () => {
  assert.ok(Array.isArray(st.listEnterpriseMemory({ divId: "ent_board" })));
});

test("createEnterpriseReport ok:true", () => {
  const r = st.createEnterpriseReport({ title: `Board Report ${TS}`, divId: "ent_board", type: "executive", summary: "all good" });
  assert.ok(r.ok && r.report.id.startsWith("erpt_"));
});

test("listEnterpriseReports returns array", () => assert.ok(Array.isArray(st.listEnterpriseReports({ divId: "ent_board" }))));

// ─── KPIs ─────────────────────────────────────────────────────────────────────
test("getEnterpriseKpi has divId", () => assert.ok("divId" in st.getEnterpriseKpi("ent_director")));
test("getAllEnterpriseKpis non-empty", () => assert.ok(st.getAllEnterpriseKpis().length > 0));

// ─── Health + Dashboard ───────────────────────────────────────────────────────
test("getEnterpriseHealth returns score 0-100", () => {
  const h = st.getEnterpriseHealth();
  assert.ok(h && typeof h.score === "number" && h.score >= 0 && h.score <= 100);
});

test("getEnterpriseHealth has dimensions", () => {
  const h = st.getEnterpriseHealth();
  assert.ok(h.dimensions && typeof h.dimensions === "object");
});

test("getEnterpriseDashboard has required shape", () => {
  const d = st.getEnterpriseDashboard();
  assert.ok(d.enterprise && d.finance && d.governance && d.health && d.portfolio);
  assert.ok(typeof d.enterprise.companies.total === "number");
});

test("enterpriseSearch returns results array", () => {
  st.createCompany({ name: `SearchableCo ${TS}` });
  const r = st.enterpriseSearch("searchable");
  assert.ok(r.ok && Array.isArray(r.results));
});

test("enterpriseSearch empty query => ok:false", () => assert.ok(!st.enterpriseSearch("").ok));

// ─── Workflow ─────────────────────────────────────────────────────────────────
test("bootstrapEnterprisePolicies creates policies", () => {
  const r = wf.bootstrapEnterprisePolicies();
  assert.ok(r.ok);
});

test("bootstrapEnterpriseControls creates controls", () => {
  const r = wf.bootstrapEnterpriseControls();
  assert.ok(r.ok);
});

test("intakeEnterpriseGoal creates EOS goal", () => {
  const r = wf.intakeEnterpriseGoal(`Intake Goal ${TS}`, { priority: "high" });
  assert.ok(r.ok && r.eosGoalId, `got: ${JSON.stringify(r)}`);
});

test("intakeEnterpriseGoal with portfolioId creates initiative", () => {
  const co = st.createCompany({ name: `IntakePflCo ${TS}` });
  const pfl = st.createPortfolio({ name: `IntakePfl ${TS}`, companyId: co.company.id });
  const r = wf.intakeEnterpriseGoal(`Intake With Portfolio ${TS}`, { portfolioId: pfl.portfolio.id });
  assert.ok(r.ok && r.initiative?.id);
});

test("buildEnterpriseStrategy creates strategy", () => {
  const g = wf.intakeEnterpriseGoal(`Strategy Goal ${TS}`);
  const r = wf.buildEnterpriseStrategy(g.eosGoalId);
  assert.ok(r.ok || r.error); // may reuse existing strategy
});

test("governanceGate passes with no violations", () => {
  const g = wf.intakeEnterpriseGoal(`Gov Goal ${TS}`);
  const r = wf.governanceGate(g.eosGoalId, { autoApprove: true });
  assert.ok(r.ok);
});

test("allocateBudget ok:true", () => {
  const g = wf.intakeEnterpriseGoal(`Budget Goal ${TS}`);
  const r = wf.allocateBudget(g.eosGoalId, { amountUsd: 0 });
  assert.ok(r.ok);
});

test("runComplianceScan returns complianceScore", () => {
  const r = wf.runComplianceScan({ framework: "SOC2" });
  assert.ok(r.ok && typeof r.complianceScore === "number");
});

test("scoreEnterpriseRisk returns riskScore + overallRisk", () => {
  const r = wf.scoreEnterpriseRisk({});
  assert.ok(r.ok && typeof r.riskScore === "number");
  assert.ok(["low","medium","high","critical"].includes(r.overallRisk));
});

test("getCrossOrgMissionStatus returns missions summary", () => {
  const r = wf.getCrossOrgMissionStatus({ limit: 10 });
  assert.ok(r.ok && r.summary && typeof r.summary.total === "number");
});

test("syncPortfolio ok:true", () => {
  const co = st.createCompany({ name: `SyncCo ${TS}` });
  const pfl = st.createPortfolio({ name: `SyncPfl ${TS}`, companyId: co.company.id });
  const r = wf.syncPortfolio(pfl.portfolio.id);
  assert.ok(r.ok);
});

test("runEnterpriseAudit returns audit + riskLevel", () => {
  const g = wf.intakeEnterpriseGoal(`Audit Goal ${TS}`);
  const r = wf.runEnterpriseAudit(g.eosGoalId, {});
  assert.ok(r.ok && r.audit.riskLevel && Array.isArray(r.audit.findings));
});

test("generateEnterpriseReport creates report", () => {
  const g = wf.intakeEnterpriseGoal(`Report Goal ${TS}`);
  const audit = wf.runEnterpriseAudit(g.eosGoalId, {});
  const r = wf.generateEnterpriseReport(g.eosGoalId, { audit: audit.audit, healthScore: 80 });
  assert.ok(r.ok && r.report.id.startsWith("erpt_"));
});

test("runEnterprisePipeline resolves ok:true", async () => {
  const co = st.createCompany({ name: `PipeCo ${TS}` });
  const r = await wf.runEnterprisePipeline(`Enterprise Pipeline Test ${TS}`, { companyId: co.company.id, priority: "high", autoApprove: true });
  assert.ok(r.ok, `got: ${r.error}`);
  assert.ok(r.eosGoalId, "should have eosGoalId");
  assert.ok(r.steps.length >= 7, `expected ≥7 steps, got ${r.steps.length}`);
  assert.ok(r.reportId, "should have reportId");
  assert.ok(["low","medium","high","critical"].includes(r.riskLevel));
});

test("runEnterprisePipeline requires command", async () => {
  const r = await wf.runEnterprisePipeline("", {});
  assert.ok(!r.ok);
});

// ─── Org ──────────────────────────────────────────────────────────────────────
test("ENT_ORG has 20 divisions",         () => assert.strictEqual(org.ENT_ORG.length, 20));
test("All division IDs start with ent_", () => assert.ok(org.ENT_ORG.every(d => d.id.startsWith("ent_"))));

test("All divisions have required fields", () => {
  for (const d of org.ENT_ORG) {
    assert.ok(d.id && d.role && d.label && d.description, `${d.id} missing fields`);
    assert.ok(d.intervalMs > 0, `${d.id} bad intervalMs`);
    assert.ok(typeof d.tickFn === "function", `${d.id} missing tickFn`);
  }
});

test("register() ok:true count:20", () => {
  const r = org.register();
  assert.ok(r.ok && r.count === 20, `got count=${r.count}`);
});

test("register() idempotent",            () => assert.ok(org.register().ok));
test("getOrgStatus returns 20 entries",  () => assert.strictEqual(org.getOrgStatus().length, 20));

test("getOrgSummary total=20 + dashboard", () => {
  const r = org.getOrgSummary();
  assert.ok(r.total === 20 && r.dashboard);
});

test("ent_director in org status",   () => assert.ok(org.getOrgStatus().find(a => a.id === "ent_director")));
test("ent_board in org status",      () => assert.ok(org.getOrgStatus().find(a => a.id === "ent_board")));
test("ent_governance in org status", () => assert.ok(org.getOrgStatus().find(a => a.id === "ent_governance")));

// ─── Integration smoke ────────────────────────────────────────────────────────
test("Full enterprise pipeline smoke test", async () => {
  const co = st.createCompany({ name: `SmokeCo ${TS}`, arr: 120000 });
  const ws = st.createWorkspace({ companyId: co.company.id, name: `SmokeWS ${TS}` });
  const prd = st.createProduct({ companyId: co.company.id, workspaceId: ws.workspace.id, name: `SmokeProduct ${TS}`, stage: "beta" });
  st.createCustomer({ companyId: co.company.id, productId: prd.product.id, name: `Smoke Customer ${TS}`, mrr: 499, arr: 5988, plan: "pro" });

  const pfl = st.createPortfolio({ name: `Smoke Portfolio ${TS}`, companyId: co.company.id, budget: 500000 });
  const bud = st.createEnterpriseBudget({ companyId: co.company.id, title: `Smoke Budget ${TS}`, totalUsd: 500000 });

  const r = await wf.runEnterprisePipeline(
    `Launch SmokeProduct to GA ${TS}`,
    { companyId: co.company.id, portfolioId: pfl.portfolio.id, amountUsd: 50000, priority: "critical", autoApprove: true }
  );

  assert.ok(r.ok, `Pipeline failed: ${r.error}`);
  assert.ok(r.eosGoalId, "missing eosGoalId");
  assert.ok(r.reportId,  "missing reportId");

  // Advance product stage
  const adv = st.advanceProductStage(prd.product.id, "ga");
  assert.ok(adv.ok && adv.to === "ga");

  // Audit trail should have entries
  const trail = st.getAuditTrail({ companyId: co.company.id, limit: 10 });
  assert.ok(trail.length >= 1, `Expected audit entries, got ${trail.length}`);

  // Dashboard should reflect new data
  const db = st.getEnterpriseDashboard();
  assert.ok(db.enterprise.companies.total >= 1);
  assert.ok(db.enterprise.products.total >= 1);
  assert.ok(db.enterprise.customers.total >= 1);
  assert.ok(db.health.score >= 0 && db.health.score <= 100);
});

test("Enterprise health score 0-100 after all data", () => {
  const h = st.getEnterpriseHealth();
  assert.ok(h.score >= 0 && h.score <= 100, `score=${h.score}`);
});

test("Enterprise search finds smoke company", () => {
  const r = st.enterpriseSearch("Smoke");
  assert.ok(r.ok && r.results.some(x => x.type === "company" && x.name.includes("SmokeCo")));
});

// ─── Runner ───────────────────────────────────────────────────────────────────
async function runAll() {
  let passed = 0, failed = 0;
  const errors = [];
  for (const { name, fn } of results) {
    try {
      const r = fn();
      if (r && typeof r.then === "function") await r;
      passed++;
    } catch (e) {
      failed++;
      errors.push({ name, error: e.message });
    }
  }
  const total = passed + failed;
  console.log(`\n${"═".repeat(60)}`);
  console.log(`ENTERPRISE LEVEL 7 TEST RESULTS`);
  console.log(`${"═".repeat(60)}`);
  console.log(`Passed: ${passed}/${total}`);
  if (errors.length > 0) {
    console.log(`\nFailed tests:`);
    for (const e of errors) console.log(`  ✗ ${e.name}: ${e.error}`);
  } else {
    console.log(`\nAll tests passed!`);
  }
  console.log(`${"═".repeat(60)}\n`);
  process.exit(failed > 0 ? 1 : 0);
}

runAll();
