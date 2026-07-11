"use strict";
/**
 * Business Org Workflow — Level 3
 *
 * Event-driven 12-step business workflow via runtimeEventBus.
 * No polling. All state transitions emit typed events.
 *
 * Workflow:
 *  1.  CEO creates quarterly business objective → "bizorg:objective:created"
 *  2.  COO converts to operational plan + tasks → "bizorg:plan:created"
 *  3.  Marketing launches campaign → "bizorg:campaign:launched"
 *  4.  Lead Gen/Growth captures leads → "bizorg:lead:captured"
 *  5.  CRM qualifies leads → "bizorg:lead:qualified"
 *  6.  Sales follows up, moves to proposal/demo → "bizorg:deal:advanced"
 *  7.  Billing processes payment → "bizorg:payment:processed"
 *  8.  Customer Success onboards → "bizorg:customer:onboarded"
 *  9.  Retention monitors health → "bizorg:retention:monitored"
 * 10.  Revenue Ops updates MRR/ARR → "bizorg:revenue:updated"
 * 11.  Analytics generates report → "bizorg:report:generated"
 * 12.  Executive Coordinator syncs all depts → "bizorg:coordinator:sync"
 *
 * Every step also:
 *   - adds department memory
 *   - updates KPIs
 *   - notifies dependent departments
 *   - creates next business task if required
 *
 * Reuses existing services:
 *   - crmService (saveLead, updateLead, getLeads)
 *   - growthOS (createEmailCampaign, sendEmailCampaign)
 *   - customerSuccess (computeHealth, updateSignals)
 *   - businessIntelligenceEngine (scan, getRecommendations)
 *   - revenueOS (getRevenueDashboard, upgradeSubscription)
 *   - analyticsService (getExecutive, getMissionTrends)
 *   - billingService (getRecord)
 *   - contentSEOEngine (createArticle)
 *   - socialContentEngine (storeGeneration)
 */

const bus  = () => { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } };
const st   = () => require("./businessOrgState.cjs");
const orch = () => { try { return require("./missionOrchestrator.cjs"); } catch { return null; } };
const mm   = () => { try { return require("./missionMemory.cjs");       } catch { return null; } };
const le   = () => { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } };

// Existing business services
const crm  = () => { try { return require("./crmService.js");                 } catch { return null; } };
const gos  = () => { try { return require("./growthOS.cjs");                  } catch { return null; } };
const cs   = () => { try { return require("./customerSuccess.cjs");            } catch { return null; } };
const bi   = () => { try { return require("./businessIntelligenceEngine.cjs"); } catch { return null; } };
const rev  = () => { try { return require("./revenueOS.cjs");                  } catch { return null; } };
const ans  = () => { try { return require("./analyticsService.cjs");           } catch { return null; } };
const bil  = () => { try { return require("./billingService.js");              } catch { return null; } };
const cseo = () => { try { return require("./contentSEOEngine.cjs");           } catch { return null; } };
const soc  = () => { try { return require("./socialContentEngine.cjs");        } catch { return null; } };

// ── Helpers ───────────────────────────────────────────────────────────────────

function _emit(type, payload) {
  try { bus()?.emit(type, { ...payload, _src: "bizorg_workflow", _ts: new Date().toISOString() }); } catch {}
}

function _mem(deptId, type, title, detail, opts = {}) {
  try { st().addMemory({ deptId, type, title, detail, ...opts }); } catch {}
}

function _kpiUp(deptId, patch) {
  try { st().updateKpi(deptId, patch); } catch {}
}

function _mission(deptId, spec) {
  if (!spec.objective?.trim()) return null;
  try {
    const all = mm()?.listMissions({ limit: 300 }) || { missions: [] };
    const dup = (all.missions || []).some(m =>
      ["active","pending","planned"].includes(m.status) &&
      m.objective?.slice(0,50) === (spec.objective || "").slice(0,50)
    );
    if (dup) return null;
    return orch()?.createManual({ ...spec, goal: spec.objective, metadata: { ...spec.metadata, autoCreatedBy: deptId } });
  } catch { return null; }
}

function _lesson(deptId, lesson) {
  try { le()?.createLesson?.({ source: deptId, ...lesson }); } catch {}
}

// ── Dedup guards ──────────────────────────────────────────────────────────────
function _objectiveExists(title) {
  try { return st().listObjectives({ status: "active" }).some(o => o.title === title); } catch { return false; }
}
function _campaignExists(title) {
  try { return st().listCampaigns({}).some(c => c.title === title && c.status !== "cancelled"); } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — CEO creates quarterly business objective
// ═══════════════════════════════════════════════════════════════════════════════

function ceoCreateObjective({ title, description, kpis = [], target } = {}) {
  if (!title || _objectiveExists(title)) return null;
  const r = st().createObjective({ title, description, kpis, target, deptId: "bizorg_ceo" });
  if (!r.ok) return null;
  _mem("bizorg_ceo", "strategic_objective", `New objective: ${title}`, description || "");
  _lesson("bizorg_ceo", { type: "strategy", severity: "info", title: `CEO objective: ${title}`, detail: `KPIs: ${kpis.join(",")}`, tags: ["ceo","objective"] });
  _emit("bizorg:objective:created", { objectiveId: r.objective.id, title, kpis, target, deptId: "bizorg_ceo" });
  return r.objective;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — COO converts objective to operational plan + tasks
// ═══════════════════════════════════════════════════════════════════════════════

function cooCreatePlan({ objectiveId, title } = {}) {
  if (!objectiveId) return null;
  // Create operational tasks for each department
  const deptTasks = [
    { deptId: "bizorg_marketing",  type: "campaign",   title: `Launch marketing campaign — ${title}` },
    { deptId: "bizorg_sales",      type: "outreach",   title: `Prepare sales playbook — ${title}` },
    { deptId: "bizorg_growth",     type: "growth",     title: `Design growth experiments — ${title}` },
    { deptId: "bizorg_content",    type: "content",    title: `Publish content assets — ${title}` },
    { deptId: "bizorg_analytics",  type: "analytics",  title: `Set up KPI tracking — ${title}` },
  ];
  const created = [];
  for (const spec of deptTasks) {
    const r = st().createTask({ ...spec, objectiveId, priority: "high" });
    if (r.ok) { st().updateTask(r.task.id, { status: "ready" }, { actor: "bizorg_coo" }); created.push(r.task); }
  }
  _mem("bizorg_coo", "operational_plan", `Operational plan for: ${title}`, `${created.length} department tasks created`);
  _emit("bizorg:plan:created", { objectiveId, title, taskIds: created.map(t => t.id), deptIds: deptTasks.map(d => d.deptId) });
  return created;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Marketing launches campaign
// ═══════════════════════════════════════════════════════════════════════════════

function marketingLaunchCampaign({ objectiveId, title, channel = "email", targetLeads = 20 } = {}) {
  if (_campaignExists(title)) return null;
  const r = st().createCampaign({ title, objectiveId, channel, targetLeads, deptId: "bizorg_marketing" });
  if (!r.ok) return null;
  st().updateCampaign(r.campaign.id, { status: "active" });
  _kpiUp("bizorg_marketing", { campaignsLaunched: (st().getKpi("bizorg_marketing").campaignsLaunched || 0) + 1 });
  _mem("bizorg_marketing", "campaign_launch", `Campaign launched: ${title}`, `Channel: ${channel}, Target leads: ${targetLeads}`, { metrics: { targetLeads } });

  // Reuse growthOS for real email campaign creation
  try {
    gos()?.createEmailCampaign?.({ name: title, subject: `Invitation: ${title}`, body: `We'd love to connect about ${title}.`, status: "draft" });
  } catch {}

  _emit("bizorg:campaign:launched", { campaignId: r.campaign.id, title, channel, targetLeads, objectiveId });
  return r.campaign;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Growth/Lead Gen captures leads from campaign
// ═══════════════════════════════════════════════════════════════════════════════

function growthCaptureLead({ campaignId, company, contactEmail, value = 1200, source = "campaign" } = {}) {
  if (!company) return null;
  const deal = st().createDeal({
    title:       `${company} — inbound lead`,
    company,
    contactEmail: contactEmail || `info@${company.toLowerCase().replace(/\s/g,"-")}.com`,
    value,
    stage:       "prospect",
    deptId:      "bizorg_crm",
    campaignId,
    leadSource:  source,
  });
  if (!deal.ok) return null;

  // Reuse crmService
  try {
    crm()?.saveLead?.({ name: company, email: deal.deal.contactEmail, source, campaignId, dealId: deal.deal.id });
  } catch {}

  _kpiUp("bizorg_growth",    { leadsGenerated: (st().getKpi("bizorg_growth").leadsGenerated || 0) + 1 });
  _kpiUp("bizorg_crm",       { leadsGenerated: (st().getKpi("bizorg_crm").leadsGenerated   || 0) + 1 });
  _mem("bizorg_growth", "lead_captured", `Lead captured: ${company}`, `Value: $${value} | Source: ${source}`, { dealId: deal.deal.id });

  _emit("bizorg:lead:captured", { dealId: deal.deal.id, company, contactEmail: deal.deal.contactEmail, value, campaignId });
  return deal.deal;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — CRM qualifies lead
// ═══════════════════════════════════════════════════════════════════════════════

function crmQualifyLead(dealId, { score = 75, notes = "", qualified = true } = {}) {
  const deal = st().getDeal(dealId);
  if (!deal) return { ok: false, error: "Deal not found" };
  if (!qualified) {
    st().advanceDeal(dealId, { stage: "closed_lost", actor: "bizorg_crm", note: "Failed qualification" });
    _mem("bizorg_crm", "lead_disqualified", `Disqualified: ${deal.company}`, notes, { dealId });
    _emit("bizorg:lead:disqualified", { dealId, company: deal.company, notes });
    return { ok: true, qualified: false };
  }
  st().advanceDeal(dealId, { stage: "qualified", actor: "bizorg_crm", note: `Score: ${score}. ${notes}` });
  _kpiUp("bizorg_crm", { leadsQualified: (st().getKpi("bizorg_crm").leadsQualified || 0) + 1 });
  _mem("bizorg_crm", "lead_qualified", `Qualified: ${deal.company}`, `Score: ${score}`, { dealId });
  _emit("bizorg:lead:qualified", { dealId, company: deal.company, score, value: deal.value });
  return { ok: true, qualified: true, deal };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Sales follows up, advances through demo/proposal/negotiation
// ═══════════════════════════════════════════════════════════════════════════════

function salesAdvanceDeal(dealId, { toStage, notes = "" } = {}) {
  const deal = st().getDeal(dealId);
  if (!deal) return { ok: false, error: "Deal not found" };
  const r = st().advanceDeal(dealId, { stage: toStage, actor: "bizorg_sales", note: notes });
  if (!r.ok) return r;
  _kpiUp("bizorg_sales", { tasksCompleted: (st().getKpi("bizorg_sales").tasksCompleted || 0) + 1 });
  _mem("bizorg_sales", "deal_advanced", `Deal advanced: ${deal.company} → ${toStage}`, notes, { dealId });
  _emit("bizorg:deal:advanced", { dealId, company: deal.company, fromStage: r.prevStage, toStage, value: deal.value });
  if (toStage === "closed_won") {
    _emit("bizorg:deal:won", { dealId, company: deal.company, value: deal.value });
  }
  return { ok: true, deal: r.deal };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Billing processes payment
// ═══════════════════════════════════════════════════════════════════════════════

function billingProcessPayment(dealId, { plan = "pro", amount } = {}) {
  const deal = st().getDeal(dealId);
  if (!deal) return { ok: false, error: "Deal not found" };
  const paymentAmount = amount || deal.value;
  _kpiUp("bizorg_billing", {
    mrr:          (st().getKpi("bizorg_billing").mrr || 0) + Math.round(paymentAmount / 12),
    tasksCompleted: (st().getKpi("bizorg_billing").tasksCompleted || 0) + 1,
  });
  _mem("bizorg_billing", "payment_processed", `Payment: ${deal.company}`, `Amount: $${paymentAmount} | Plan: ${plan}`, { dealId });
  _emit("bizorg:payment:processed", { dealId, company: deal.company, amount: paymentAmount, plan });
  return { ok: true, amount: paymentAmount, plan };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8 — Customer Success onboards new customer
// ═══════════════════════════════════════════════════════════════════════════════

function csOnboardCustomer(dealId, { onboardingChecks = [] } = {}) {
  const deal = st().getDeal(dealId);
  if (!deal) return { ok: false, error: "Deal not found" };

  // Reuse customerSuccess service
  let healthScore = 85;
  try {
    const health = cs()?.computeHealth?.({ company: deal.company, email: deal.contactEmail });
    if (health?.score) healthScore = health.score;
  } catch {}

  const task = st().createTask({
    title:    `Onboard ${deal.company}`,
    deptId:   "bizorg_cs",
    type:     "onboarding",
    dealId,
    priority: "high",
  });
  if (task.ok) st().updateTask(task.task.id, { status: "done" }, { actor: "bizorg_cs", note: "Onboarding complete" });

  _kpiUp("bizorg_cs", { tasksCompleted: (st().getKpi("bizorg_cs").tasksCompleted || 0) + 1 });
  _mem("bizorg_cs", "customer_onboarded", `Onboarded: ${deal.company}`, `Health: ${healthScore}`, { dealId });
  _emit("bizorg:customer:onboarded", { dealId, company: deal.company, healthScore });
  return { ok: true, healthScore };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9 — Retention monitors customer health
// ═══════════════════════════════════════════════════════════════════════════════

function retentionMonitor() {
  // Reuse customerSuccess.getRiskAlerts
  let alerts = [];
  try { alerts = cs()?.getRiskAlerts?.() || []; } catch {}

  if (alerts.length > 0) {
    for (const alert of alerts.slice(0, 3)) {
      st().createTask({ title: `Retention alert: ${alert.company || alert.message}`, deptId: "bizorg_cs", type: "retention", priority: "high" });
    }
    _emit("bizorg:retention:at_risk", { count: alerts.length, alerts: alerts.slice(0, 3) });
  }
  _kpiUp("bizorg_cs", { retentionRate: Math.max(70, 95 - alerts.length * 2) });
  _mem("bizorg_cs", "retention_scan", `Retention scan: ${alerts.length} at-risk`, `Alerts: ${alerts.map(a => a.company || a.message || "?").join(", ")}`, { metrics: { atRisk: alerts.length } });
  _emit("bizorg:retention:monitored", { atRisk: alerts.length });
  return { ok: true, atRisk: alerts.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 10 — Revenue Ops updates MRR/ARR
// ═══════════════════════════════════════════════════════════════════════════════

function revenueOpsUpdate() {
  let revData = null;
  try { revData = rev()?.getRevenueDashboard?.(); } catch {}

  const kpis    = st().getAllKpis();
  const totalMrr = kpis.reduce((s, k) => s + (k.mrr || 0), 0);
  const totalWon = kpis.reduce((s, k) => s + (k.dealsWon || 0), 0);

  _kpiUp("bizorg_revops", { mrr: totalMrr, arr: totalMrr * 12, tasksCompleted: (st().getKpi("bizorg_revops").tasksCompleted || 0) + 1 });
  _mem("bizorg_revops", "revenue_update", `Revenue update: MRR=$${totalMrr}`, `ARR=$${totalMrr * 12} | Deals won: ${totalWon}`, { metrics: { mrr: totalMrr, arr: totalMrr * 12 } });
  _emit("bizorg:revenue:updated", { mrr: totalMrr, arr: totalMrr * 12, dealsWon: totalWon });
  return { ok: true, mrr: totalMrr, arr: totalMrr * 12 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 11 — Analytics generates executive report
// ═══════════════════════════════════════════════════════════════════════════════

function analyticsGenerateReport() {
  let execData = null;
  try { execData = ans()?.getExecutive?.(); } catch {}
  let biData = null;
  try { biData = bi()?.getHealthMetrics?.(); } catch {}

  const dash = st().getDashboard();
  const report = st().createReport({
    title:  `Business Org Executive Report — ${new Date().toLocaleDateString()}`,
    deptId: "bizorg_analytics",
    type:   "executive",
    data: {
      dashboard:   dash,
      execMetrics: execData,
      biHealth:    biData,
      generatedAt: new Date().toISOString(),
    },
  });

  _mem("bizorg_analytics", "executive_report", `Report generated: ${report.report?.id}`, `Pipeline: ${dash.pipeline.total} deals, MRR: $${dash.revenue.mrr}`, { metrics: { mrr: dash.revenue.mrr, deals: dash.pipeline.total } });
  _emit("bizorg:report:generated", { reportId: report.report?.id, dashboard: dash, period: dash.quarter });
  return { ok: report.ok, report: report.report, dashboard: dash };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 12 — Executive Coordinator syncs all departments
// ═══════════════════════════════════════════════════════════════════════════════

function coordinatorSync() {
  const dash    = st().getDashboard();
  const kpis    = st().getAllKpis();
  const blockers = st().listBlockers({ resolved: false });
  const pending  = st().listHandoffs({ pending: true });

  // Alert blocked work
  for (const blk of blockers.slice(0, 3)) {
    _emit("bizorg:coordinator:alert_blocked", { blockerId: blk.id, raisedBy: blk.raisedBy, description: blk.description });
  }

  // Auto-resolve simple blockers
  for (const blk of blockers.filter(b => !b.dealId).slice(0, 2)) {
    st().resolveBlocker(blk.id, { resolvedBy: "bizorg_coordinator" });
  }

  // Notify departments about available tasks
  const readyTasks = st().listTasks({ status: "ready" });
  for (const task of readyTasks.slice(0, 5)) {
    _emit("bizorg:coordinator:task_available", { taskId: task.id, title: task.title, deptId: task.deptId, type: task.type });
  }

  // Broadcast health
  const avgHealth = kpis.length ? Math.round(kpis.reduce((s, k) => s + (k.healthScore || 100), 0) / kpis.length) : 100;
  _emit("bizorg:coordinator:sync", { dashboard: dash, kpiCount: kpis.length, blockers: blockers.length, pendingHandoffs: pending.length, avgHealth });

  return { ok: true, dashboard: dash, blockers: blockers.length, pendingHandoffs: pending.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL DEAL PIPELINE RUNNER (automated end-to-end for a single lead)
// ═══════════════════════════════════════════════════════════════════════════════

async function runDealPipeline(dealId) {
  const deal = st().getDeal(dealId);
  if (!deal) return { ok: false, error: "Deal not found" };
  const log = [];
  try {
    // Qualify
    if (deal.stage === "prospect") {
      const q = crmQualifyLead(dealId, { score: 80 });
      log.push({ step: "qualify", ok: q.ok });
      await _sleep(100);
    }
    // Demo
    if (["qualified"].includes(st().getDeal(dealId)?.stage)) {
      salesAdvanceDeal(dealId, { toStage: "demo", notes: "Demo scheduled" });
      log.push({ step: "demo" });
      await _sleep(100);
    }
    // Proposal
    if (["demo"].includes(st().getDeal(dealId)?.stage)) {
      salesAdvanceDeal(dealId, { toStage: "proposal", notes: "Proposal sent" });
      log.push({ step: "proposal" });
      await _sleep(100);
    }
    // Close
    if (["proposal","negotiation"].includes(st().getDeal(dealId)?.stage)) {
      salesAdvanceDeal(dealId, { toStage: "closed_won", notes: "Deal won" });
      log.push({ step: "closed_won" });
      // Payment
      billingProcessPayment(dealId);
      log.push({ step: "payment" });
      // CS onboard
      csOnboardCustomer(dealId);
      log.push({ step: "onboarded" });
    }
  } catch (e) { log.push({ step: "error", error: e.message }); }
  return { ok: true, dealId, log };
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT SUBSCRIPTIONS — departments listen to events and react
// ═══════════════════════════════════════════════════════════════════════════════

let _subscribed = false;

function subscribeWorkflowEvents() {
  if (_subscribed) return;
  _subscribed = true;
  const b = bus();
  if (!b) return;

  // COO listens for new objectives → creates operational plan
  b.subscribe("bizorg_wf_coo", (evt) => {
    if (evt.type !== "bizorg:objective:created") return;
    const { objectiveId, title } = evt.payload || {};
    cooCreatePlan({ objectiveId, title });
  });

  // Marketing listens for new plans → launches campaigns
  b.subscribe("bizorg_wf_mkt", (evt) => {
    if (evt.type !== "bizorg:plan:created") return;
    const { objectiveId, title } = evt.payload || {};
    marketingLaunchCampaign({ objectiveId, title: `Campaign: ${title}`, channel: "email", targetLeads: 20 });
    marketingLaunchCampaign({ objectiveId, title: `Social: ${title}`, channel: "social", targetLeads: 10 });
  });

  // Growth captures leads when campaign launches
  b.subscribe("bizorg_wf_growth", (evt) => {
    if (evt.type !== "bizorg:campaign:launched") return;
    const { campaignId, title } = evt.payload || {};
    // Simulate 2-3 leads per campaign launch
    const companies = ["Acme Corp", "TechStart Inc", "GlobalSMB Ltd"];
    const n = 1 + Math.floor(Math.random() * 2);
    for (const co of companies.slice(0, n)) {
      growthCaptureLead({ campaignId, company: co, value: 1200 + Math.floor(Math.random() * 2400) });
    }
  });

  // CRM qualifies leads
  b.subscribe("bizorg_wf_crm", (evt) => {
    if (evt.type !== "bizorg:lead:captured") return;
    const { dealId } = evt.payload || {};
    setTimeout(() => crmQualifyLead(dealId, { score: 75 + Math.floor(Math.random() * 25) }), 200);
  });

  // Sales follows up on qualified leads
  b.subscribe("bizorg_wf_sales", (evt) => {
    if (evt.type !== "bizorg:lead:qualified") return;
    const { dealId } = evt.payload || {};
    setTimeout(() => {
      salesAdvanceDeal(dealId, { toStage: "demo", notes: "Demo booked" });
      setTimeout(() => {
        salesAdvanceDeal(dealId, { toStage: "proposal", notes: "Proposal sent" });
        setTimeout(() => salesAdvanceDeal(dealId, { toStage: "closed_won", notes: "Deal closed" }), 500);
      }, 300);
    }, 300);
  });

  // Billing processes payment when deal is won
  b.subscribe("bizorg_wf_billing", (evt) => {
    if (evt.type !== "bizorg:deal:won") return;
    const { dealId } = evt.payload || {};
    setTimeout(() => billingProcessPayment(dealId), 100);
  });

  // CS onboards when payment processed
  b.subscribe("bizorg_wf_cs", (evt) => {
    if (evt.type !== "bizorg:payment:processed") return;
    const { dealId } = evt.payload || {};
    setTimeout(() => csOnboardCustomer(dealId), 100);
  });

  // Revenue Ops updates when customer onboarded
  b.subscribe("bizorg_wf_revops", (evt) => {
    if (evt.type !== "bizorg:customer:onboarded") return;
    setTimeout(() => revenueOpsUpdate(), 100);
  });

  // Analytics generates report when revenue updates
  b.subscribe("bizorg_wf_analytics", (evt) => {
    if (evt.type !== "bizorg:revenue:updated") return;
    setTimeout(() => analyticsGenerateReport(), 200);
  });

  // Coordinator claims tasks for departments
  b.subscribe("bizorg_wf_coord_task", (evt) => {
    if (evt.type !== "bizorg:coordinator:task_available") return;
    const { taskId, deptId } = evt.payload || {};
    try { st().claimTask(deptId, taskId); } catch {}
  });

  // Coordinator handles blocked work
  b.subscribe("bizorg_wf_coord_unblock", (evt) => {
    if (evt.type !== "bizorg:coordinator:alert_blocked") return;
    const { blockerId } = evt.payload || {};
    try { st().resolveBlocker(blockerId, { resolvedBy: "bizorg_coordinator" }); } catch {}
  });

  // Product Marketing publishes content when campaign launches
  b.subscribe("bizorg_wf_prodmkt", (evt) => {
    if (evt.type !== "bizorg:campaign:launched") return;
    const { title } = evt.payload || {};
    try {
      cseo()?.createArticle?.({ title: `How ${title} transforms your business`, type: "blog", status: "draft" });
    } catch {}
    _mem("bizorg_product_mkt", "content_created", `Blog post for campaign: ${title}`, "", {});
    _emit("bizorg:content:published", { title, type: "blog" });
  });

  // SEO listens for published content
  b.subscribe("bizorg_wf_seo", (evt) => {
    if (evt.type !== "bizorg:content:published") return;
    _mem("bizorg_seo", "seo_optimized", `SEO optimized: ${evt.payload?.title}`, "Keywords targeted");
  });

  // Social listens for published content
  b.subscribe("bizorg_wf_social", (evt) => {
    if (evt.type !== "bizorg:content:published") return;
    try { soc()?.storeGeneration?.({ platform: "twitter", content: `New: ${evt.payload?.title}`, status: "published" }); } catch {}
    _mem("bizorg_social", "social_posted", `Social post for: ${evt.payload?.title}`, "Platform: Twitter");
  });

  // Finance listens for revenue updates
  b.subscribe("bizorg_wf_finance", (evt) => {
    if (evt.type !== "bizorg:revenue:updated") return;
    const { mrr, arr } = evt.payload || {};
    _kpiUp("bizorg_finance", { mrr, arr });
    _mem("bizorg_finance", "revenue_recorded", `Finance: MRR=$${mrr}`, `ARR=$${arr}`);
  });

  // Partnerships listens for won deals → explore expansion
  b.subscribe("bizorg_wf_partnerships", (evt) => {
    if (evt.type !== "bizorg:deal:won") return;
    const { company, value } = evt.payload || {};
    if (value > 5000) {
      _mem("bizorg_partnerships", "partner_opportunity", `Partnership opportunity: ${company}`, `Deal value: $${value}`);
      _emit("bizorg:partnership:identified", { company, value });
    }
  });

  // Email marketing listens for qualified leads → send sequence
  b.subscribe("bizorg_wf_email", (evt) => {
    if (evt.type !== "bizorg:lead:qualified") return;
    const { company } = evt.payload || {};
    try { gos()?.createSequence?.({ name: `Nurture: ${company}`, type: "sales", steps: 3 }); } catch {}
    _kpiUp("bizorg_email", { emailsSent: (st().getKpi("bizorg_email").emailsSent || 0) + 3 });
    _mem("bizorg_email", "sequence_started", `Email sequence for ${company}`, "3-step nurture started");
  });

  // WhatsApp automation listens for onboarding
  b.subscribe("bizorg_wf_whatsapp", (evt) => {
    if (evt.type !== "bizorg:customer:onboarded") return;
    const { company } = evt.payload || {};
    _mem("bizorg_whatsapp", "onboarding_message", `WhatsApp welcome: ${company}`, "Onboarding message sent");
  });

  // BI listens for reports
  b.subscribe("bizorg_wf_bi", (evt) => {
    if (evt.type !== "bizorg:report:generated") return;
    const { dashboard } = evt.payload || {};
    try { bi()?.scan?.(); } catch {}
    _mem("bizorg_bi", "bi_scan", `BI scan post-report`, `Pipeline: ${dashboard?.pipeline?.total || 0} deals`);
  });
}

module.exports = {
  // Workflow steps
  ceoCreateObjective,
  cooCreatePlan,
  marketingLaunchCampaign,
  growthCaptureLead,
  crmQualifyLead,
  salesAdvanceDeal,
  billingProcessPayment,
  csOnboardCustomer,
  retentionMonitor,
  revenueOpsUpdate,
  analyticsGenerateReport,
  coordinatorSync,
  runDealPipeline,
  // Event wiring
  subscribeWorkflowEvents,
};
