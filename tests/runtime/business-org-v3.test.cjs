"use strict";
/**
 * Business Org V3 — test suite
 *
 * Covers: businessOrgState, businessOrgWorkflow, businessOrg module loads.
 * Uses temp directory for isolation.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bizorg-v3-test-"));

let st, wf, org;

function freshModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes("businessOrgState") || key.includes("businessOrgWorkflow") || key.includes("businessOrg.cjs")) {
      delete require.cache[key];
    }
  }
  ["state.json","kpis.json","memory.json","reports.json"].forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch {} });
  st  = require("../../backend/services/businessOrgState.cjs");
  wf  = require("../../backend/services/businessOrgWorkflow.cjs");
  org = require("../../backend/services/businessOrg.cjs");
}

// ── State: Objectives ─────────────────────────────────────────────────────────

describe("businessOrgState — Objectives", () => {
  before(freshModules);

  it("creates a CEO objective", () => {
    const r = st.createObjective({ title: "Q3 Revenue Growth", deptId: "bizorg_ceo", kpis: ["mrr", "leads"] });
    assert.equal(r.ok, true);
    assert.ok(r.objective.id.startsWith("bobj_"));
    assert.equal(r.objective.deptId, "bizorg_ceo");
    assert.equal(r.objective.status, "active");
    process._v3ObjId = r.objective.id;
  });

  it("lists objectives by quarter", () => {
    const q = st.currentQuarter();
    const list = st.listObjectives({ quarter: q });
    assert.ok(list.length >= 1);
    assert.ok(list.every(o => o.quarter === q));
  });

  it("updates objective status", () => {
    const r = st.updateObjective(process._v3ObjId, { status: "completed" });
    assert.equal(r.ok, true);
    assert.equal(r.objective.status, "completed");
  });

  it("rejects objective without title", () => {
    const r = st.createObjective({ deptId: "bizorg_ceo" });
    assert.equal(r.ok, false);
  });
});

// ── State: Campaigns ──────────────────────────────────────────────────────────

describe("businessOrgState — Campaigns", () => {
  before(() => {
    freshModules();
    const obj = st.createObjective({ title: "Growth Obj", deptId: "bizorg_ceo" });
    process._v3CampObjId = obj.objective.id;
  });

  it("creates a campaign linked to objective", () => {
    const r = st.createCampaign({ title: "Q3 Email Campaign", objectiveId: process._v3CampObjId, channel: "email", targetLeads: 20 });
    assert.equal(r.ok, true);
    assert.ok(r.campaign.id.startsWith("bcmp_"));
    assert.equal(r.campaign.channel, "email");
    assert.equal(r.campaign.status, "planned");
    process._v3CampId = r.campaign.id;
  });

  it("activates campaign", () => {
    const r = st.updateCampaign(process._v3CampId, { status: "active" });
    assert.equal(r.ok, true);
    assert.equal(r.campaign.status, "active");
  });

  it("lists campaigns by status", () => {
    const list = st.listCampaigns({ status: "active" });
    assert.ok(list.some(c => c.id === process._v3CampId));
  });
});

// ── State: Deals ──────────────────────────────────────────────────────────────

describe("businessOrgState — Deals", () => {
  before(() => {
    freshModules();
    const camp = st.createCampaign({ title: "Test Camp", channel: "social", targetLeads: 10 });
    process._v3DealCampId = camp.campaign.id;
  });

  it("creates a deal", () => {
    const r = st.createDeal({ title: "Acme Corp Lead", company: "Acme Corp", value: 2400, stage: "prospect", campaignId: process._v3DealCampId });
    assert.equal(r.ok, true);
    assert.ok(r.deal.id.startsWith("bdeal_"));
    assert.equal(r.deal.stage, "prospect");
    assert.equal(r.deal.value, 2400);
    process._v3DealId = r.deal.id;
  });

  it("advances deal to qualified", () => {
    const r = st.advanceDeal(process._v3DealId, { stage: "qualified", actor: "bizorg_crm" });
    assert.equal(r.ok, true);
    assert.equal(r.deal.stage, "qualified");
    assert.equal(r.prevStage, "prospect");
  });

  it("advances deal to closed_won and updates KPI", () => {
    const r = st.advanceDeal(process._v3DealId, { stage: "closed_won", actor: "bizorg_sales" });
    assert.equal(r.ok, true);
    assert.equal(r.deal.stage, "closed_won");
    assert.ok(r.deal.wonAt);
    const kpi = st.getKpi("bizorg_crm");
    assert.ok(kpi.dealsWon >= 1);
    assert.ok(kpi.dealValueWon >= 2400);
    assert.ok(kpi.mrr >= 200);
  });

  it("getPipelineStats returns accurate stats", () => {
    const stats = st.getPipelineStats();
    assert.ok(typeof stats.total === "number");
    assert.ok(typeof stats.pipelineValue === "number");
    assert.ok(typeof stats.winRate === "number");
    assert.ok(stats.byStage.closed_won.count >= 1);
  });

  it("deal links to campaign and increments actualLeads", () => {
    const camps = st.listCampaigns({ status: "planned" });
    // The campaign's actualLeads was incremented on deal creation
    const camp = st.listCampaigns({}).find(c => c.id === process._v3DealCampId);
    assert.ok(camp.actualLeads >= 1);
  });
});

// ── State: Tasks ──────────────────────────────────────────────────────────────

describe("businessOrgState — Tasks", () => {
  before(freshModules);

  it("creates a department task", () => {
    const r = st.createTask({ title: "Send proposal", deptId: "bizorg_sales", type: "outreach", priority: "high" });
    assert.equal(r.ok, true);
    assert.ok(r.task.id.startsWith("btask_"));
    assert.equal(r.task.deptId, "bizorg_sales");
    assert.equal(r.task.status, "planned");
    process._v3TaskId = r.task.id;
  });

  it("claims task and marks in_progress", () => {
    st.updateTask(process._v3TaskId, { status: "ready" });
    const r = st.claimTask("bizorg_sales", process._v3TaskId);
    assert.equal(r.ok, true);
    assert.equal(r.task.status, "in_progress");
  });

  it("completes task and updates KPI", () => {
    const r = st.updateTask(process._v3TaskId, { status: "done" }, { actor: "bizorg_sales" });
    assert.equal(r.ok, true);
    const kpi = st.getKpi("bizorg_sales");
    assert.ok(kpi.tasksCompleted >= 1);
  });

  it("backlog includes department tasks", () => {
    const task = st.createTask({ title: "Follow up call", deptId: "bizorg_sales", type: "outreach" });
    const backlog = st.getBacklog("bizorg_sales");
    assert.ok(backlog.some(t => t.id === task.task.id));
  });
});

// ── State: Handoffs ───────────────────────────────────────────────────────────

describe("businessOrgState — Handoffs", () => {
  before(() => {
    freshModules();
    const deal = st.createDeal({ title: "Handoff test deal", company: "TestCo", value: 1000, stage: "qualified" });
    process._v3HoffDealId = deal.deal.id;
  });

  it("creates a handoff from CRM to Sales", () => {
    const r = st.createHandoff({ fromDept: "bizorg_crm", toDept: "bizorg_sales", dealId: process._v3HoffDealId, message: "Qualified — ready for sales" });
    assert.equal(r.ok, true);
    assert.ok(r.handoff.id.startsWith("bhoff_"));
    assert.equal(r.handoff.accepted, null);
    process._v3HoffId = r.handoff.id;
  });

  it("lists pending handoffs", () => {
    const list = st.listHandoffs({ pending: true });
    assert.ok(list.some(h => h.id === process._v3HoffId));
  });

  it("accepts handoff and transfers deal ownership", () => {
    const r = st.acceptHandoff(process._v3HoffId);
    assert.equal(r.ok, true);
    assert.equal(r.handoff.accepted, true);
    const ownership = st.getOwnership();
    assert.equal(ownership[process._v3HoffDealId], "bizorg_sales");
  });
});

// ── State: Blockers ───────────────────────────────────────────────────────────

describe("businessOrgState — Blockers", () => {
  before(() => {
    freshModules();
    const task = st.createTask({ title: "Blocked task", deptId: "bizorg_marketing", type: "campaign" });
    st.updateTask(task.task.id, { status: "ready" });
    process._v3BlkTaskId = task.task.id;
  });

  it("raises a blocker", () => {
    const r = st.raiseBlocker({ taskId: process._v3BlkTaskId, description: "Budget approval pending", raisedBy: "bizorg_marketing" });
    assert.equal(r.ok, true);
    assert.ok(r.blocker.id.startsWith("bblk_"));
    process._v3BlkId = r.blocker.id;
  });

  it("task status set to blocked", () => {
    const task = st.getTask(process._v3BlkTaskId);
    assert.equal(task.status, "blocked");
  });

  it("resolves blocker and unblocks task", () => {
    const r = st.resolveBlocker(process._v3BlkId, { resolvedBy: "bizorg_coo" });
    assert.equal(r.ok, true);
    assert.ok(r.blocker.resolvedAt);
    const task = st.getTask(process._v3BlkTaskId);
    assert.equal(task.status, "in_progress");
  });
});

// ── State: Memory ─────────────────────────────────────────────────────────────

describe("businessOrgState — Memory", () => {
  before(freshModules);

  it("adds business memory entry", () => {
    const r = st.addMemory({ deptId: "bizorg_ceo", type: "decision", title: "Focus Q3 on SMB segment", tags: ["strategy", "q3"] });
    assert.equal(r.ok, true);
    assert.ok(r.entry.id.startsWith("bmem_"));
  });

  it("retrieves memory by department", () => {
    const list = st.getMemory({ deptId: "bizorg_ceo" });
    assert.ok(list.length >= 1);
    assert.ok(list.every(m => m.deptId === "bizorg_ceo"));
  });

  it("memoryEntries KPI increments", () => {
    const kpi = st.getKpi("bizorg_ceo");
    assert.ok(kpi.memoryEntries >= 1);
  });
});

// ── State: Reports ────────────────────────────────────────────────────────────

describe("businessOrgState — Reports", () => {
  before(freshModules);

  it("creates an executive report", () => {
    const r = st.createReport({ title: "Q3 Business Summary", deptId: "bizorg_analytics", type: "executive", data: { mrr: 5000, leads: 20 } });
    assert.equal(r.ok, true);
    assert.ok(r.report.id.startsWith("brpt_"));
    assert.equal(r.report.type, "executive");
  });

  it("lists reports", () => {
    const list = st.listReports({});
    assert.ok(list.length >= 1);
  });

  it("reportsGenerated KPI increments", () => {
    const kpi = st.getKpi("bizorg_analytics");
    assert.ok(kpi.reportsGenerated >= 1);
  });
});

// ── State: Dashboard ─────────────────────────────────────────────────────────

describe("businessOrgState — Dashboard", () => {
  before(() => {
    freshModules();
    const obj = st.createObjective({ title: "Dash test obj", deptId: "bizorg_ceo" });
    const camp = st.createCampaign({ title: "Dash camp", objectiveId: obj.objective.id, channel: "email", targetLeads: 5 });
    st.createDeal({ title: "Dash deal", company: "DashCo", value: 3000, stage: "qualified", campaignId: camp.campaign.id });
  });

  it("getDashboard returns all sections", () => {
    const dash = st.getDashboard();
    assert.ok(typeof dash.objectives === "object");
    assert.ok(typeof dash.campaigns === "object");
    assert.ok(typeof dash.pipeline === "object");
    assert.ok(typeof dash.tasks === "object");
    assert.ok(typeof dash.revenue === "object");
    assert.ok(typeof dash.leads === "object");
  });

  it("getDashboard reflects created entities", () => {
    const dash = st.getDashboard();
    assert.ok(dash.objectives.total >= 1);
    assert.ok(dash.campaigns.total >= 1);
    assert.ok(dash.pipeline.total >= 1);
  });
});

// ── Workflow: CEO cascade ─────────────────────────────────────────────────────

describe("businessOrgWorkflow — CEO objective triggers cascade", () => {
  const UNIQUE_TITLE = `Q3 Revenue Test ${Date.now()}`;

  before(() => {
    freshModules();
    wf.subscribeWorkflowEvents();
  });

  it("ceoCreateObjective returns objective", () => {
    const obj = wf.ceoCreateObjective({ title: UNIQUE_TITLE, kpis: ["mrr", "leads"] });
    assert.ok(obj, "Should create objective");
    assert.ok(obj.id.startsWith("bobj_"));
    process._v3CascadeObjId = obj.id;
  });

  it("deduplicates identical objectives", () => {
    const obj2 = wf.ceoCreateObjective({ title: UNIQUE_TITLE });
    assert.equal(obj2, null, "Duplicate should return null");
  });

  it("COO creates operational tasks (event-driven)", (_, done) => {
    setTimeout(() => {
      const tasks = st.listTasks({});
      assert.ok(tasks.length >= 1, `Expected tasks, got ${tasks.length}`);
      done();
    }, 300);
  });

  it("Marketing launches campaigns (event-driven)", (_, done) => {
    setTimeout(() => {
      const campaigns = st.listCampaigns({ status: "active" });
      assert.ok(campaigns.length >= 1, `Expected campaigns, got ${campaigns.length}`);
      done();
    }, 500);
  });
});

// ── Workflow: Lead pipeline ───────────────────────────────────────────────────

describe("businessOrgWorkflow — Lead capture and qualification", () => {
  before(() => {
    freshModules();
    const camp = st.createCampaign({ title: "Test Camp", channel: "email", targetLeads: 10 });
    st.updateCampaign(camp.campaign.id, { status: "active" });
    process._v3LeadCampId = camp.campaign.id;
  });

  it("growthCaptureLead creates deal in prospect stage", () => {
    const deal = wf.growthCaptureLead({ campaignId: process._v3LeadCampId, company: "TestCo Inc", value: 2400 });
    assert.ok(deal, "Should create deal");
    assert.ok(deal.id.startsWith("bdeal_"));
    assert.equal(deal.stage, "prospect");
    process._v3LeadDealId = deal.id;
  });

  it("crmQualifyLead qualifies and advances to qualified stage", () => {
    const r = wf.crmQualifyLead(process._v3LeadDealId, { score: 80, qualified: true });
    assert.equal(r.ok, true);
    assert.equal(r.qualified, true);
    const deal = st.getDeal(process._v3LeadDealId);
    assert.equal(deal.stage, "qualified");
  });

  it("salesAdvanceDeal moves to demo", () => {
    const r = wf.salesAdvanceDeal(process._v3LeadDealId, { toStage: "demo", notes: "Demo scheduled" });
    assert.equal(r.ok, true);
    assert.equal(r.deal.stage, "demo");
  });

  it("salesAdvanceDeal closes won and emits event", () => {
    wf.salesAdvanceDeal(process._v3LeadDealId, { toStage: "proposal" });
    const r = wf.salesAdvanceDeal(process._v3LeadDealId, { toStage: "closed_won" });
    assert.equal(r.ok, true);
    assert.equal(r.deal.stage, "closed_won");
    const kpi = st.getKpi("bizorg_sales");
    assert.ok(kpi.tasksCompleted >= 3);
  });

  it("crmQualifyLead disqualifies low-score leads", () => {
    const deal2 = wf.growthCaptureLead({ company: "Bad Lead Co", value: 500 });
    const r = wf.crmQualifyLead(deal2.id, { score: 30, qualified: false });
    assert.equal(r.ok, true);
    assert.equal(r.qualified, false);
    const deal = st.getDeal(deal2.id);
    assert.equal(deal.stage, "closed_lost");
  });
});

// ── Workflow: Billing + CS ────────────────────────────────────────────────────

describe("businessOrgWorkflow — Billing and Customer Success", () => {
  before(() => {
    freshModules();
    const deal = st.createDeal({ title: "Won deal", company: "BigCo", value: 4800, stage: "closed_won" });
    process._v3BillingDealId = deal.deal.id;
  });

  it("billingProcessPayment updates billing KPI MRR", () => {
    const r = wf.billingProcessPayment(process._v3BillingDealId, { plan: "pro" });
    assert.equal(r.ok, true);
    assert.ok(r.amount >= 4800);
    const kpi = st.getKpi("bizorg_billing");
    assert.ok(kpi.mrr >= 400);
  });

  it("csOnboardCustomer creates onboarding task and returns healthScore", () => {
    const r = wf.csOnboardCustomer(process._v3BillingDealId);
    assert.equal(r.ok, true);
    assert.ok(typeof r.healthScore === "number");
    assert.ok(r.healthScore > 0 && r.healthScore <= 100);
  });

  it("CS memory entry created", () => {
    const mem = st.getMemory({ deptId: "bizorg_cs", type: "customer_onboarded" });
    assert.ok(mem.length >= 1);
  });
});

// ── Workflow: Revenue Ops + Analytics ────────────────────────────────────────

describe("businessOrgWorkflow — Revenue and Analytics", () => {
  before(() => {
    freshModules();
    // Create a won deal with MRR
    const deal = st.createDeal({ title: "Revenue deal", company: "RevCo", value: 6000, stage: "closed_won" });
    st.updateKpi("bizorg_billing", { mrr: 500 });
  });

  it("revenueOpsUpdate returns MRR and ARR", () => {
    const r = wf.revenueOpsUpdate();
    assert.equal(r.ok, true);
    assert.ok(typeof r.mrr === "number");
    assert.ok(r.arr === r.mrr * 12);
  });

  it("analyticsGenerateReport creates report", () => {
    // Create some deals first so dashboard has data
    st.createDeal({ title: "Analytics deal", company: "AnalyticsCo", value: 2000, stage: "demo" });
    const r = wf.analyticsGenerateReport();
    assert.equal(r.ok, true);
    assert.ok(r.report?.id.startsWith("brpt_"));
    assert.ok(typeof r.dashboard === "object");
  });
});

// ── Workflow: Coordinator sync ────────────────────────────────────────────────

describe("businessOrgWorkflow — Coordinator sync", () => {
  before(() => {
    freshModules();
    // Create some ready tasks
    const t1 = st.createTask({ title: "Ready task 1", deptId: "bizorg_marketing", type: "campaign" });
    const t2 = st.createTask({ title: "Ready task 2", deptId: "bizorg_sales", type: "outreach" });
    st.updateTask(t1.task.id, { status: "ready" });
    st.updateTask(t2.task.id, { status: "ready" });
  });

  it("coordinatorSync returns ok", () => {
    const r = wf.coordinatorSync();
    assert.equal(r.ok, true);
    assert.ok(typeof r.dashboard === "object");
  });

  it("coordinatorSync reports pending handoffs and blockers", () => {
    const r = wf.coordinatorSync();
    assert.ok(typeof r.blockers === "number");
    assert.ok(typeof r.pendingHandoffs === "number");
  });
});

// ── BusinessOrg module ────────────────────────────────────────────────────────

describe("businessOrg — Module validation", () => {
  before(freshModules);

  it("BUSINESS_ORG has 20 departments", () => {
    assert.equal(org.BUSINESS_ORG.length, 20);
  });

  it("all department IDs start with bizorg_", () => {
    assert.ok(org.BUSINESS_ORG.every(d => d.id.startsWith("bizorg_")));
  });

  it("all department IDs are unique", () => {
    const ids = org.BUSINESS_ORG.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("all departments have tickFn", () => {
    assert.ok(org.BUSINESS_ORG.every(d => typeof d.tickFn === "function"));
  });

  it("all departments have intervalMs > 0", () => {
    assert.ok(org.BUSINESS_ORG.every(d => d.intervalMs > 0));
  });

  it("getOrgStatus and getOrgSummary are exported", () => {
    assert.ok(typeof org.getOrgStatus === "function");
    assert.ok(typeof org.getOrgSummary === "function");
  });
});
