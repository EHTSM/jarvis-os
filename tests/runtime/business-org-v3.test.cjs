"use strict";
/**
 * Business Org V3 — test suite
 *
 * Covers: businessOrgState, businessOrgWorkflow, businessOrg module loads.
 * Uses temp directory for isolation.
 *
 * Mission 67: every describe block's before() calls freshModules(), which
 * reassigns the module-level `st`/`wf`/`org` shared across ALL describe
 * blocks in this file, and Node's test runner runs top-level sibling
 * describes CONCURRENTLY by default. The "Revenue and Analytics" block
 * used to seed bizorg_billing.mrr=500 as its own fixture — a stray write to
 * that shared KPI store that the concurrently-running "Billing and Customer
 * Success" block could observe mid-test. Traced and removed at its source
 * (see that block below): the seed was already a dead no-op post the
 * Business Org Financial Integrity Certification, which excluded
 * bizorg_billing from any real MRR report.
 *
 * Mission 69: this file's header always claimed "uses temp directory for
 * isolation" (the mkdtempSync()'d tmpDir below), but that was never actually
 * true — businessOrgState.cjs's DIR was always hardcoded to the real
 * data/bizorg/, never wired to tmpDir at all. freshModules()'s own "cleanup"
 * was deleting state.json/kpis.json/etc. FROM tmpDir, a directory
 * businessOrgState.cjs never touched — a no-op that looked like isolation.
 * Confirmed live: data/bizorg/kpis.json's bizorg_billing entry had
 * tasksCompleted:44 and a stale mrr:500 — real residue accumulated across
 * many prior unisolated runs of this exact file (including a value written
 * before Mission 67 removed a since-deleted test seed), which is what
 * caused this file's billing MRR assertion to intermittently fail once the
 * businessIntelligenceEngine hang (below) stopped masking it by preventing
 * the file from ever finishing cleanly.
 *
 * Real fix: both businessOrgState.cjs (DIR) and businessDataService.cjs
 * (F_LEADS/F_CONTACTS/F_OPPS/F_CAMPS/F_REV) now honour
 * JARVIS_TEST_DATA_SUFFIX (same convention as agentInstanceRegistry.cjs/
 * skillRegistry.cjs/repositoryEditingEngine.cjs/toolExecutionLayer.cjs) —
 * set here, first, before any require() below, since it's read into
 * module-load-time consts. tmpDir/os are no longer needed and removed.
 */
process.env.JARVIS_TEST_DATA_SUFFIX = `bizorgv3-${process.pid}-${Date.now()}`;

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

let st, wf, org;

// Mission 67/68: "CEO objective triggers cascade" (below) calls
// wf.subscribeWorkflowEvents(), real production code (businessOrgWorkflow.cjs)
// that wires 19 event-bus listeners chained through 8 unref'd setTimeout
// calls (COO plan -> Marketing campaign -> Growth lead -> CRM qualify ->
// Sales advance -> Billing/CS/Revenue/Analytics/BI), by design for a
// long-running server process where this cascade should keep running. It has
// no built-in teardown — subscribeWorkflowEvents() is a module-level
// singleton guard (_subscribed), so once subscribed in this test process it
// stays subscribed for the process's lifetime, and every later describe
// block's own st.createDeal()/lead/report activity keeps re-triggering it.
//
// Mission 68 traced this further: the "bizorg_wf_bi" listener (fired by
// analyticsGenerateReport()'s "bizorg:report:generated" event, itself inside
// the setTimeout chain) calls the real businessIntelligenceEngine.cjs's
// scan(), which reads/writes through businessDataService.cjs — a SEPARATE
// data layer from businessOrgState.cjs, with its own real shared
// data/biz-*.json files and (at the time) no isolation mechanism at all.
// That scan processed real, large, pre-existing shared lead/deal data
// (confirmed live: a run showed "BravoCorp-OS52"/"Marisol Vega"-style leads
// this file never created) and, via missionOrchestrator.cjs, created real
// missions from it.
//
// Mission 69 closed the actual root cause: businessDataService.cjs now
// honours JARVIS_TEST_DATA_SUFFIX (set at the top of this file, before any
// require() of businessOrgState/Workflow/businessOrg) the same way
// agentInstanceRegistry.cjs/skillRegistry.cjs/repositoryEditingEngine.cjs/
// toolExecutionLayer.cjs already do — so a BI scan triggered by this test's
// own cascade now reads/writes isolated biz-*.<suffix>.json files that start
// empty, never the real shared ones. With zero real leads/deals to scan,
// scanLeads()/scanDeals() find zero signals and _triggerMission() never
// fires — the cascade's most expensive, hang-causing leg (a real
// missionOrchestrator.createManual() write cycle against the real 32MB+
// data/missions.json) simply cannot happen from this path anymore.
// Unsubscribing every listener here remains a real, verified-safe
// belt-and-suspenders cleanup — retained per Mission 69 rule 8 unless
// evidence proves it's redundant, which was not attempted here (removing it
// carries no benefit and this hook is proven harmless).
function _sweepIsolatedDataDirs() {
    // Isolated biz-*.<suffix>.json files (businessDataService.cjs) land in
    // the real data/ dir (same convention as every other
    // JARVIS_TEST_DATA_SUFFIX consumer) — remove them so no test residue
    // accumulates there.
    const dataDir = path.join(__dirname, "..", "..", "data");
    for (const f of ["biz-leads", "biz-contacts", "biz-opportunities", "biz-campaigns", "biz-revenue"]) {
        try { fs.unlinkSync(path.join(dataDir, `${f}.${process.env.JARVIS_TEST_DATA_SUFFIX}.json`)); } catch { /* never created — fine */ }
    }
    // The isolated data/bizorg-<suffix>/ directory (businessOrgState.cjs) —
    // remove the whole directory, not just the 4 files, so nothing lingers.
    try {
        const dir = path.join(__dirname, "..", "..", "data", `bizorg-${process.env.JARVIS_TEST_DATA_SUFFIX}`);
        for (const f of ["state.json", "kpis.json", "memory.json", "reports.json"]) {
            try { fs.unlinkSync(path.join(dir, f)); } catch { /* never created — fine */ }
        }
        fs.rmdirSync(dir);
    } catch { /* non-fatal — best-effort cleanup; directory may not exist, or a still-settling cascade write races this and is caught by the delayed second sweep below */ }
}

after(async () => {
    try {
        const bus = require("../../agents/runtime/runtimeEventBus.cjs");
        for (const id of [
            "bizorg_wf_coo", "bizorg_wf_mkt", "bizorg_wf_growth", "bizorg_wf_crm",
            "bizorg_wf_sales", "bizorg_wf_billing", "bizorg_wf_cs", "bizorg_wf_revops",
            "bizorg_wf_analytics", "bizorg_wf_coord_task", "bizorg_wf_coord_unblock",
            "bizorg_wf_prodmkt", "bizorg_wf_seo", "bizorg_wf_social", "bizorg_wf_finance",
            "bizorg_wf_partnerships", "bizorg_wf_email", "bizorg_wf_whatsapp", "bizorg_wf_bi",
        ]) {
            bus.unsubscribe(id);
        }
    } catch { /* non-fatal — best-effort cleanup */ }

    _sweepIsolatedDataDirs();

    // The cascade's setTimeout chain (unref'd, so it never blocks process
    // exit) can still have hops in flight at this point — unsubscribing above
    // stops NEW events from scheduling NEW timers, but doesn't cancel timers
    // already queued before this hook ran. Observed live: an already-queued
    // hop wrote a fresh isolated bizorg-<suffix>/{state,kpis,memory,reports}.json
    // moments after the sweep above ran, recreating the directory this hook
    // just removed. The chain's longest observed single hop is 500ms
    // (salesAdvanceDeal, nested inside 2 prior setTimeouts); 1.5s gives a
    // comfortable margin for that plus one further hop (e.g. billing/CS/
    // revenue/analytics at 100-200ms each) to settle, then this re-sweeps
    // whatever that in-flight work left behind. This only delays this file's
    // own after() — it does not touch any per-test timeout.
    await new Promise((r) => setTimeout(r, 1500));
    _sweepIsolatedDataDirs();
});

// Mission 69: the real, isolated directory businessOrgState.cjs actually
// reads/writes now that it honours JARVIS_TEST_DATA_SUFFIX (matches that
// module's own DIR construction exactly).
const bizorgDir = path.join(__dirname, "..", "..", "data", `bizorg-${process.env.JARVIS_TEST_DATA_SUFFIX}`);

function freshModules() {
  for (const key of Object.keys(require.cache)) {
    if (key.includes("businessOrgState") || key.includes("businessOrgWorkflow") || key.includes("businessOrg.cjs")) {
      delete require.cache[key];
    }
  }
  ["state.json","kpis.json","memory.json","reports.json"].forEach(f => { try { fs.unlinkSync(path.join(bizorgDir, f)); } catch {} });
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

  it("billingProcessPayment records the payment without double-counting MRR", () => {
    // Mission 67 / carried from the Business Org Financial Integrity
    // Certification: billingProcessPayment() used to ALSO increment
    // bizorg_billing's own mrr KPI by amount/12, duplicating the same
    // real-world revenue event advanceDeal() already records once, correctly,
    // on the deal's own department KPI when it transitions to closed_won —
    // confirmed live to double the reported global MRR (see
    // businessOrgWorkflow.cjs:276-291). That duplicate accumulator was
    // removed; this test previously still asserted the removed behavior.
    // billing's real, non-duplicative surface is: the returned amount,
    // tasksCompleted, and the payment-processed memory record/event —
    // asserted here instead.
    const before = st.getKpi("bizorg_billing").tasksCompleted || 0;
    const r = wf.billingProcessPayment(process._v3BillingDealId, { plan: "pro" });
    assert.equal(r.ok, true);
    assert.ok(r.amount >= 4800);
    const kpi = st.getKpi("bizorg_billing");
    assert.equal(kpi.tasksCompleted, before + 1,
      "billing must record the payment as completed billing work");
    assert.equal(kpi.mrr || 0, 0,
      "bizorg_billing must NOT carry its own mrr — that would re-introduce the double-counted global MRR defect");
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
    // Mission 67: the Business Org Financial Integrity Certification put
    // bizorg_billing in MRR_REPORTING_DEPTS (businessOrgState.cjs:697) —
    // its mrr KPI is permanently excluded from getDashboard()'s totalMrr
    // (which is what revenueOpsUpdate() below actually reads), and its own
    // duplicate accumulator was removed from billingProcessPayment() as a
    // separate fix. Seeding mrr on it here was already a dead no-op for what
    // this test verifies — the test only checks r.mrr is a number and
    // r.arr === r.mrr * 12, both true regardless of this seed's value — and,
    // being a write to the shared module-level KPI store, it was observable
    // from sibling describe blocks running concurrently (the billing test's
    // own KPI read saw this exact value bleed in). A dead seed causing live
    // cross-test interference is worth deleting outright, not relocating.
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
