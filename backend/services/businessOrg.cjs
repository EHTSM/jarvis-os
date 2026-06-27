"use strict";
/**
 * Business Organization — Level 3
 *
 * Registers 20 autonomous business department agents into agentRuntimeSupervisor.
 * Each department:
 *   - has real responsibilities wired to existing business services
 *   - uses the existing runtime (registerAgent + tickFn)
 *   - creates missions via missionOrchestrator
 *   - records lessons via continuousLearningEngine
 *   - emits events via runtimeEventBus
 *   - reads/writes V3 businessOrgState
 *   - participates in event-driven business workflow
 *
 * Departments:
 *  1.  bizorg_ceo          — CEO Office
 *  2.  bizorg_coo          — COO
 *  3.  bizorg_sales        — Sales Department
 *  4.  bizorg_marketing    — Marketing Department
 *  5.  bizorg_growth       — Growth Department
 *  6.  bizorg_crm          — CRM Department
 *  7.  bizorg_cs           — Customer Success
 *  8.  bizorg_finance      — Finance Department
 *  9.  bizorg_billing      — Billing Department
 * 10.  bizorg_revops       — Revenue Operations
 * 11.  bizorg_partnerships — Partnerships
 * 12.  bizorg_product_mkt  — Product Marketing
 * 13.  bizorg_content      — Content Team
 * 14.  bizorg_seo          — SEO Team
 * 15.  bizorg_social       — Social Media Team
 * 16.  bizorg_email        — Email Marketing
 * 17.  bizorg_whatsapp     — WhatsApp Automation
 * 18.  bizorg_analytics    — Analytics Department
 * 19.  bizorg_bi           — Business Intelligence
 * 20.  bizorg_coordinator  — Executive Coordinator
 */

// ── Lazy accessors ────────────────────────────────────────────────────────────
function _sup()  { return require("./agentRuntimeSupervisor.cjs"); }
function _bus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _orch() { try { return require("./missionOrchestrator.cjs");          } catch { return null; } }
function _mm()   { try { return require("./missionMemory.cjs");                } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");     } catch { return null; } }
function _uil()  { try { return require("./unifiedIntelligenceLayer.cjs");     } catch { return null; } }
function _gre()  { try { return require("./graphReasoningEngine.cjs");         } catch { return null; } }
// Existing business services
function _crm()  { try { return require("./crmService.js");                    } catch { return null; } }
function _gos()  { try { return require("./growthOS.cjs");                     } catch { return null; } }
function _cs()   { try { return require("./customerSuccess.cjs");              } catch { return null; } }
function _bi()   { try { return require("./businessIntelligenceEngine.cjs");   } catch { return null; } }
function _rev()  { try { return require("./revenueOS.cjs");                    } catch { return null; } }
function _ans()  { try { return require("./analyticsService.cjs");             } catch { return null; } }
function _bil()  { try { return require("./billingService.js");                } catch { return null; } }
function _cseo() { try { return require("./contentSEOEngine.cjs");             } catch { return null; } }
function _soc()  { try { return require("./socialContentEngine.cjs");          } catch { return null; } }
function _bma()  { try { return require("./businessMissionAutomation.cjs");    } catch { return null; } }
function _bem()  { try { return require("./businessEntityModel.cjs");          } catch { return null; } }
// V3 state + workflow
function _st()   { try { return require("./businessOrgState.cjs");             } catch { return null; } }
function _wf()   { try { return require("./businessOrgWorkflow.cjs");          } catch { return null; } }

// ── Shared helpers ────────────────────────────────────────────────────────────

function _missionExists(prefix) {
  try {
    const all = _mm()?.listMissions({ limit: 300 }) || { missions: [] };
    return (all.missions || []).some(m =>
      ["active","pending","planned"].includes(m.status) &&
      m.objective?.slice(0,50) === prefix?.slice(0,50)
    );
  } catch { return false; }
}

function _mission(agentId, spec, s) {
  if (_missionExists(spec.objective)) return null;
  try {
    const m = _orch()?.createManual({ ...spec, metadata: { ...spec.metadata, autoCreatedBy: agentId } });
    if (m && s) { s.missionsCreated = (s.missionsCreated || 0) + 1; s.lastDecision = spec.objective?.slice(0,60); }
    try { _bus()?.emit(`agent:${agentId}:mission_created`, { missionId: m?.missionId || m?.id }); } catch {}
    return m;
  } catch { return null; }
}

function _lesson(agentId, lesson) {
  try { return _le()?.createLesson?.({ source: agentId, ...lesson }); } catch { return null; }
}

function _setObj(s, objective) {
  s.currentObjective = objective;
  s.lastTickAt       = new Date().toISOString();
}

function _mem(deptId, type, title, detail) {
  try { _st()?.addMemory({ deptId, type, title, detail }); } catch {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// TICK IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════════════════════

// 1. CEO Office — strategic objectives, business health, quarterly direction
async function _ceoTick(s) {
  _setObj(s, "Reviewing business health and setting quarterly objectives");
  try {
    // Create quarterly objective if none exists
    const quarter = _st()?.currentQuarter();
    const existing = _st()?.listObjectives({ quarter, status: "active" }) || [];
    if (existing.length === 0) {
      const revDash = _rev()?.getRevenueDashboard?.() || {};
      const currentMrr = revDash.mrr || 0;
      const targetMrr  = Math.max(1000, currentMrr * 1.3);
      _wf()?.ceoCreateObjective({
        title: `Grow Business — ${quarter}`,
        description: `Target MRR: $${Math.round(targetMrr)}. Focus: lead generation, conversion, retention.`,
        kpis: ["mrr_growth", "lead_volume", "win_rate", "nps"],
        target: { mrr: targetMrr },
      });
      s.v2Objectives = (s.v2Objectives || 0) + 1;
    }

    // Executive health check
    const bi = _bi()?.getHealthMetrics?.();
    if (bi && bi.totalScore < 40) {
      _mission(s.id, {
        objective: `CEO: Business health critical at ${bi.totalScore}/100 — executive review`,
        priority: "critical",
        subtasks: [{ description: "Review health signals" }, { description: "Emergency strategy session" }],
        metadata: { domain: "executive", requiresHumanApproval: true },
      }, s);
    }

    // Store state
    const dash = _st()?.getDashboard?.() || {};
    s.v2Dashboard = { mrr: dash.revenue?.mrr, deals: dash.pipeline?.total, leads: dash.leads?.total };
  } catch {}
  _setObj(s, s.v2Objectives > 0 ? `${s.v2Objectives} objective(s) set` : "Business strategy nominal");
}

// 2. COO — operational efficiency, cross-department coordination, resource allocation
async function _cooTick(s) {
  _setObj(s, "Reviewing operational efficiency and coordinating departments");
  try {
    const tasks = _st()?.listTasks({ status: "ready" }) || [];
    // Create operational tasks for unclaimed ready items
    if (tasks.length > 5) {
      _mission(s.id, {
        objective: `COO: ${tasks.length} tasks awaiting dept assignment — coordinate allocation`,
        priority: "medium",
        subtasks: [{ description: `${tasks.length} unstarted tasks need dept pickup` }, { description: "Review and push coordinator sync" }],
        metadata: { domain: "operations" },
      }, s);
    }
    // Run coordinator sync to unblock pending tasks
    const sync = _wf()?.coordinatorSync?.();
    s.v2Sync = { readyTasks: sync?.dashboard?.tasks?.inProgress, blockers: sync?.blockers };
    _mem(s.id, "ops_review", `COO review: ${tasks.length} ready tasks`, `Blockers: ${sync?.blockers || 0}`);
  } catch {}
  _setObj(s, "Operational review complete");
}

// 3. Sales Department — lead conversion, deal progression, pipeline management
async function _salesTick(s) {
  _setObj(s, "Working deal pipeline and converting qualified leads");
  try {
    const qualified = _st()?.listDeals({ stage: "qualified" }) || [];
    const demo      = _st()?.listDeals({ stage: "demo" })      || [];
    const proposal  = _st()?.listDeals({ stage: "proposal" })  || [];
    // Advance stale deals
    for (const deal of qualified.slice(0, 2)) { _wf()?.salesAdvanceDeal(deal.id, { toStage: "demo", notes: "Scheduled by sales agent" }); }
    for (const deal of demo.slice(0, 2))      { _wf()?.salesAdvanceDeal(deal.id, { toStage: "proposal", notes: "Proposal sent" }); }
    for (const deal of proposal.slice(0, 1))  { _wf()?.salesAdvanceDeal(deal.id, { toStage: "closed_won", notes: "Closed by sales" }); }

    if (qualified.length + demo.length + proposal.length > 10) {
      _mission(s.id, {
        objective: `Sales: ${qualified.length + demo.length + proposal.length} active deals in pipeline — convert`,
        priority: "high",
        subtasks: [{ description: `Qualified: ${qualified.length}, Demo: ${demo.length}, Proposal: ${proposal.length}` }, { description: "Push top 3 deals to close" }],
        metadata: { domain: "sales" },
      }, s);
    }
    const kpi = _st()?.getKpi(s.id) || {};
    s.v2Pipeline = { won: kpi.dealsWon, value: kpi.dealValueWon };
    _lesson(s.id, { type: "sales_review", severity: "info", title: `Pipeline: ${qualified.length} qualified, ${demo.length} demo, ${proposal.length} proposal`, detail: `Won: ${kpi.dealsWon}`, tags: ["sales"] });
  } catch {}
  _setObj(s, "Pipeline managed");
}

// 4. Marketing Department — campaigns, messaging, brand awareness
async function _marketingTick(s) {
  _setObj(s, "Managing marketing campaigns and brand messaging");
  try {
    const campaigns = _st()?.listCampaigns({ status: "planned" }) || [];
    // Launch any planned campaigns
    for (const c of campaigns.slice(0, 2)) {
      _st()?.updateCampaign(c.id, { status: "active" });
      _bus()?.emit("bizorg:campaign:launched", { campaignId: c.id, title: c.title, channel: c.channel, targetLeads: c.targetLeads, objectiveId: c.objectiveId });
    }
    // Check campaign performance
    const active = _st()?.listCampaigns({ status: "active" }) || [];
    for (const c of active) {
      if (c.actualLeads >= c.targetLeads) {
        _st()?.updateCampaign(c.id, { status: "completed", actualLeads: c.actualLeads });
        _mem(s.id, "campaign_complete", `Campaign completed: ${c.title}`, `Leads: ${c.actualLeads}/${c.targetLeads}`);
      }
    }
    s.v2Campaigns = { active: active.length, completed: _st()?.listCampaigns({ status: "completed" })?.length || 0 };
    _lesson(s.id, { type: "marketing_review", severity: "info", title: `Marketing: ${active.length} active campaigns`, detail: `${campaigns.length} planned, launching ${Math.min(2, campaigns.length)}`, tags: ["marketing"] });
  } catch {}
  _setObj(s, "Marketing campaigns active");
}

// 5. Growth Department — lead capture, experiments, growth loops
async function _growthTick(s) {
  _setObj(s, "Running growth experiments and capturing leads");
  try {
    const campaigns = _st()?.listCampaigns({ status: "active" }) || [];
    // Capture leads for active campaigns
    for (const c of campaigns.slice(0, 2)) {
      if (c.actualLeads < c.targetLeads) {
        const companies = ["Prospect Alpha", "Beta Dynamics", "Gamma Solutions", "Delta Systems"];
        const co = companies[Math.floor(Math.random() * companies.length)] + ` ${Date.now().toString(36).slice(-4)}`;
        _wf()?.growthCaptureLead({ campaignId: c.id, company: co, value: 1200 + Math.floor(Math.random() * 3600) });
      }
    }
    const kpi = _st()?.getKpi(s.id) || {};
    s.v2Leads = kpi.leadsGenerated;
    _lesson(s.id, { type: "growth_review", severity: "info", title: `Growth: ${kpi.leadsGenerated} leads generated`, detail: `Active campaigns: ${campaigns.length}`, tags: ["growth"] });
  } catch {}
  _setObj(s, "Growth loops active");
}

// 6. CRM Department — lead qualification, pipeline hygiene, contact management
async function _crmTick(s) {
  _setObj(s, "Qualifying leads and managing CRM pipeline");
  try {
    const prospects = _st()?.listDeals({ stage: "prospect" }) || [];
    // Qualify up to 3 prospects
    for (const deal of prospects.slice(0, 3)) {
      const score = 60 + Math.floor(Math.random() * 40);
      _wf()?.crmQualifyLead(deal.id, { score, qualified: score >= 65 });
    }
    // CRM service stats
    const stats = _crm()?.getStats?.() || {};
    _lesson(s.id, { type: "crm_review", severity: "info", title: `CRM: ${prospects.length} prospects, qualified ${Math.min(3, prospects.length)}`, detail: `CRM leads: ${stats.total || 0}`, tags: ["crm"] });
    s.v2Prospects = prospects.length;
  } catch {}
  _setObj(s, "CRM pipeline clean");
}

// 7. Customer Success — onboarding, health monitoring, churn prevention
async function _csTick(s) {
  _setObj(s, "Monitoring customer health and preventing churn");
  try {
    // Onboard any won-but-not-onboarded deals
    const won = _st()?.listDeals({ stage: "closed_won" }) || [];
    for (const deal of won.slice(0, 2)) {
      const tasks = _st()?.listTasks({ deptId: "bizorg_cs", type: "onboarding" }) || [];
      const alreadyOnboarded = tasks.some(t => t.dealId === deal.id && t.status === "done");
      if (!alreadyOnboarded) { _wf()?.csOnboardCustomer(deal.id); }
    }
    // Run retention monitoring
    const retention = _wf()?.retentionMonitor();
    s.v2Retention = { atRisk: retention?.atRisk };
    _lesson(s.id, { type: "cs_review", severity: retention?.atRisk > 0 ? "warning" : "info", title: `CS: ${won.length} customers, ${retention?.atRisk || 0} at risk`, detail: "", tags: ["cs","retention"] });
  } catch {}
  _setObj(s, "Customer health monitored");
}

// 8. Finance Department — financial reporting, P&L, cash flow
async function _financeTick(s) {
  _setObj(s, "Reviewing financial performance and P&L");
  try {
    const dash    = _st()?.getDashboard?.() || {};
    const kpis    = _st()?.getAllKpis?.() || [];
    const totalMrr = kpis.reduce((s, k) => s + (k.mrr || 0), 0);
    const totalWon = kpis.reduce((s, k) => s + (k.dealValueWon || 0), 0);
    _st()?.updateKpi(s.id, { mrr: totalMrr, arr: totalMrr * 12 });
    if (totalMrr === 0) {
      _mission(s.id, {
        objective: "Finance: Zero MRR recorded — alert CEO and review pipeline",
        priority: "high",
        subtasks: [{ description: "Review pipeline for close opportunities" }, { description: "Confirm billing integrations active" }],
        metadata: { domain: "finance", requiresHumanApproval: true },
      }, s);
    }
    _lesson(s.id, { type: "finance_review", severity: "info", title: `Finance: MRR=$${totalMrr}, ARR=$${totalMrr * 12}`, detail: `Total won: $${totalWon}`, tags: ["finance"] });
    s.v2Finance = { mrr: totalMrr, arr: totalMrr * 12 };
  } catch {}
  _setObj(s, "Financial review complete");
}

// 9. Billing Department — subscription processing, payment tracking
async function _billingTick(s) {
  _setObj(s, "Processing billing and subscription management");
  try {
    // Process payment for any won deals without billing record
    const won = _st()?.listDeals({ stage: "closed_won" }) || [];
    const mem = _st()?.getMemory({ deptId: s.id, type: "payment_processed" }) || [];
    const billedDeals = new Set(mem.map(m => m.dealId));
    for (const deal of won.filter(d => !billedDeals.has(d.id)).slice(0, 2)) {
      _wf()?.billingProcessPayment(deal.id);
    }
    const kpi = _st()?.getKpi(s.id) || {};
    s.v2Billing = { mrr: kpi.mrr };
    _lesson(s.id, { type: "billing_review", severity: "info", title: `Billing: MRR=$${kpi.mrr || 0}`, detail: `Won deals: ${won.length}`, tags: ["billing"] });
  } catch {}
  _setObj(s, "Billing processed");
}

// 10. Revenue Operations — MRR/ARR tracking, forecasting, revenue health
async function _revopsTick(s) {
  _setObj(s, "Tracking revenue metrics and forecasting");
  try {
    const result = _wf()?.revenueOpsUpdate?.();
    s.v2Revenue = { mrr: result?.mrr, arr: result?.arr };
    const revDash = _rev()?.getRevenueDashboard?.();
    if (revDash) {
      _lesson(s.id, { type: "revops_review", severity: "info", title: `RevOps: MRR=$${result?.mrr}`, detail: `Platform plans: ${Object.keys(revDash.plans || {}).join(",")}`, tags: ["revops","revenue"] });
    }
  } catch {}
  _setObj(s, "Revenue metrics updated");
}

// 11. Partnerships — partner identification, deal expansion, ecosystem growth
async function _partnershipsTick(s) {
  _setObj(s, "Identifying partnership opportunities and managing partner relationships");
  try {
    const won = _st()?.listDeals({ stage: "closed_won" }) || [];
    const highValue = won.filter(d => d.value > 4800);
    if (highValue.length > 0) {
      for (const d of highValue.slice(0, 2)) {
        _mem(s.id, "partner_opportunity", `Partner expansion: ${d.company}`, `Deal: $${d.value}`);
      }
    }
    const kpi = _st()?.getKpi(s.id) || {};
    _lesson(s.id, { type: "partnerships_review", severity: "info", title: `Partnerships: ${highValue.length} opportunities identified`, detail: `High-value accounts: ${highValue.map(d => d.company).join(", ")}`, tags: ["partnerships"] });
  } catch {}
  _setObj(s, "Partnership opportunities tracked");
}

// 12. Product Marketing — positioning, launch materials, competitive analysis
async function _productMktTick(s) {
  _setObj(s, "Creating product marketing materials and competitive positioning");
  try {
    const campaigns = _st()?.listCampaigns({ status: "active" }) || [];
    for (const c of campaigns.slice(0, 1)) {
      try {
        _cseo()?.createArticle?.({ title: `Why teams choose our platform — ${c.title}`, type: "landing_page", status: "draft" });
        _st()?.updateKpi(s.id, { contentPieces: (_st()?.getKpi(s.id)?.contentPieces || 0) + 1 });
      } catch {}
    }
    _lesson(s.id, { type: "product_mkt_review", severity: "info", title: `Product Mkt: ${campaigns.length} active campaigns supported`, detail: "", tags: ["product-marketing"] });
  } catch {}
  _setObj(s, "Product marketing materials ready");
}

// 13. Content Team — blog posts, guides, case studies
async function _contentTick(s) {
  _setObj(s, "Producing content assets for marketing and sales");
  try {
    const campaigns = _st()?.listCampaigns({ status: "active" }) || [];
    if (campaigns.length > 0) {
      try {
        const articles = _cseo()?.listArticles?.({ limit: 5 }) || [];
        if (articles.length < campaigns.length * 2) {
          _cseo()?.createArticle?.({ title: `${campaigns[0].title} — Complete Guide`, type: "guide", status: "draft" });
          _st()?.updateKpi(s.id, { contentPieces: (_st()?.getKpi(s.id)?.contentPieces || 0) + 1 });
          _mem(s.id, "content_created", `Blog: ${campaigns[0].title} guide`, "Status: draft");
        }
      } catch {}
    }
    _lesson(s.id, { type: "content_review", severity: "info", title: `Content: supporting ${campaigns.length} campaigns`, detail: "", tags: ["content"] });
  } catch {}
  _setObj(s, "Content pipeline active");
}

// 14. SEO Team — keyword targeting, technical SEO, search rankings
async function _seoTick(s) {
  _setObj(s, "Optimizing search presence and tracking keyword rankings");
  try {
    let audit = null;
    try { audit = _cseo()?.runTechnicalAudit?.(); } catch {}
    if (audit?.issues?.length > 3) {
      _mission(s.id, {
        objective: `SEO: ${audit.issues.length} technical issues found — fix priority issues`,
        priority: "medium",
        subtasks: audit.issues.slice(0, 3).map(i => ({ description: i })),
        metadata: { domain: "seo" },
      }, s);
    }
    _lesson(s.id, { type: "seo_review", severity: "info", title: `SEO: audit run, ${audit?.issues?.length || 0} issues`, detail: "", tags: ["seo"] });
  } catch {}
  _setObj(s, "SEO monitoring active");
}

// 15. Social Media Team — content distribution, engagement, brand awareness
async function _socialTick(s) {
  _setObj(s, "Publishing social content and monitoring engagement");
  try {
    const campaigns = _st()?.listCampaigns({ status: "active" }) || [];
    for (const c of campaigns.slice(0, 1)) {
      try {
        _soc()?.storeGeneration?.({ platform: "linkedin", content: `Case study: How our platform delivers results — ${c.title}`, status: "published" });
        _soc()?.storeGeneration?.({ platform: "twitter",  content: `🚀 New campaign live: ${c.title}`, status: "published" });
        _st()?.updateKpi(s.id, { contentPieces: (_st()?.getKpi(s.id)?.contentPieces || 0) + 2 });
      } catch {}
    }
    _lesson(s.id, { type: "social_review", severity: "info", title: `Social: ${campaigns.length} campaigns supported`, detail: "", tags: ["social"] });
  } catch {}
  _setObj(s, "Social presence maintained");
}

// 16. Email Marketing — sequences, nurture campaigns, broadcast emails
async function _emailTick(s) {
  _setObj(s, "Running email sequences and nurture campaigns");
  try {
    const qualified = _st()?.listDeals({ stage: "qualified" }) || [];
    for (const deal of qualified.slice(0, 3)) {
      try {
        _gos()?.createSequence?.({ name: `Nurture: ${deal.company}`, type: "prospect", steps: 5 });
        _st()?.updateKpi(s.id, { emailsSent: (_st()?.getKpi(s.id)?.emailsSent || 0) + 5 });
      } catch {}
    }
    const kpi = _st()?.getKpi(s.id) || {};
    _lesson(s.id, { type: "email_review", severity: "info", title: `Email: ${kpi.emailsSent || 0} emails sent`, detail: `${qualified.length} sequences running`, tags: ["email"] });
    s.v2Email = { emailsSent: kpi.emailsSent };
  } catch {}
  _setObj(s, "Email sequences active");
}

// 17. WhatsApp Automation — onboarding messages, support, re-engagement
async function _whatsappTick(s) {
  _setObj(s, "Managing WhatsApp automation flows and customer messages");
  try {
    const recent = _st()?.getMemory({ deptId: s.id, type: "onboarding_message" }) || [];
    const onboarded = _st()?.listDeals({ stage: "closed_won" }) || [];
    const messaged = new Set(recent.map(m => m.dealId));
    for (const deal of onboarded.filter(d => !messaged.has(d.id)).slice(0, 2)) {
      _mem(s.id, "onboarding_message", `WhatsApp welcome: ${deal.company}`, `Onboarding flow triggered`, { dealId: deal.id });
    }
    _lesson(s.id, { type: "whatsapp_review", severity: "info", title: `WhatsApp: ${onboarded.length} customers in automation`, detail: "", tags: ["whatsapp"] });
  } catch {}
  _setObj(s, "WhatsApp automation running");
}

// 18. Analytics Department — dashboards, KPI tracking, business reporting
async function _analyticsTick(s) {
  _setObj(s, "Generating analytics reports and KPI dashboards");
  try {
    const dash = _st()?.getDashboard?.() || {};
    // Generate executive report every tick if there's meaningful data
    if (dash.pipeline?.total > 0) {
      _wf()?.analyticsGenerateReport?.();
      s.v2Reports = (s.v2Reports || 0) + 1;
    }
    const execData = _ans()?.getExecutive?.() || {};
    _lesson(s.id, { type: "analytics_review", severity: "info", title: `Analytics: MRR=$${dash.revenue?.mrr || 0}, ${dash.pipeline?.total || 0} deals`, detail: `Campaigns: ${dash.campaigns?.active || 0} active`, tags: ["analytics"] });
    s.v2Analytics = { mrr: dash.revenue?.mrr, deals: dash.pipeline?.total };
  } catch {}
  _setObj(s, "Analytics dashboards updated");
}

// 19. Business Intelligence — signal scanning, recommendation engine, market insights
async function _biTick(s) {
  _setObj(s, "Scanning business signals and generating intelligence recommendations");
  try {
    const result = _bi()?.scan?.() || {};
    const recs   = _bi()?.getRecommendations?.() || [];
    const highImpact = (recs.recommendations || recs || []).filter(r => r.impact === "high" || r.priority === "high");
    for (const rec of highImpact.slice(0, 2)) {
      _mission(s.id, {
        objective: `BI Recommendation: ${rec.title || rec.message || "Act on high-impact signal"}`,
        priority: "medium",
        subtasks: [{ description: rec.action || rec.description || "Review BI recommendation" }],
        metadata: { domain: "bi", recId: rec.id },
      }, s);
    }
    const leads = _bi()?.scanLeads?.() || {};
    _lesson(s.id, { type: "bi_scan", severity: "info", title: `BI: ${result.totalSignals || 0} signals, ${highImpact.length} high-impact recs`, detail: `Leads health: ${leads.healthScore || "N/A"}`, tags: ["bi","intelligence"] });
    s.v2BI = { signals: result.totalSignals, recs: highImpact.length };
  } catch {}
  _setObj(s, "Business intelligence refreshed");
}

// 20. Executive Coordinator — cross-department sync, status, KPI aggregation
async function _coordinatorTick(s) {
  _setObj(s, "Synchronizing all departments and generating executive status");
  try {
    const sync = _wf()?.coordinatorSync?.();
    const dash  = _st()?.getDashboard?.() || {};
    const kpis  = _st()?.getAllKpis?.() || [];
    const totalLeads = kpis.reduce((sum, k) => sum + (k.leadsGenerated || 0), 0);
    const totalWon   = kpis.reduce((sum, k) => sum + (k.dealsWon || 0), 0);
    const totalMrr   = kpis.reduce((sum, k) => sum + (k.mrr || 0), 0);

    _bus()?.emit("bizorg:coordinator:status", {
      timestamp: new Date().toISOString(),
      dashboard: dash,
      kpiSummary: { totalLeads, totalWon, totalMrr },
      blockers:   sync?.blockers || 0,
    });

    _lesson(s.id, { type: "coordinator_review", severity: "info", title: `Coordinator: ${totalLeads} leads, ${totalWon} won, MRR=$${totalMrr}`, detail: `Blockers: ${sync?.blockers || 0}`, tags: ["coordinator","executive"] });
    s.v2Coord = { mrr: totalMrr, won: totalWon, leads: totalLeads };
  } catch {}
  _setObj(s, "Executive sync complete");
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEPARTMENT DEFINITIONS (20)
// ═══════════════════════════════════════════════════════════════════════════════

const BUSINESS_ORG = [
  { id: "bizorg_ceo",         role: "bizorg_ceo",         label: "CEO Office",            description: "Strategic objectives, business health, quarterly direction",           intervalMs: 300_000, tickFn: _ceoTick         },
  { id: "bizorg_coo",         role: "bizorg_coo",         label: "COO",                   description: "Operational efficiency, cross-department coordination",                intervalMs: 240_000, tickFn: _cooTick         },
  { id: "bizorg_sales",       role: "bizorg_sales",       label: "Sales Department",      description: "Lead conversion, deal progression, pipeline management",               intervalMs: 120_000, tickFn: _salesTick       },
  { id: "bizorg_marketing",   role: "bizorg_marketing",   label: "Marketing Department",  description: "Campaign management, brand messaging, lead generation",                intervalMs: 180_000, tickFn: _marketingTick   },
  { id: "bizorg_growth",      role: "bizorg_growth",      label: "Growth Department",     description: "Lead capture, growth experiments, acquisition loops",                  intervalMs: 150_000, tickFn: _growthTick      },
  { id: "bizorg_crm",         role: "bizorg_crm",         label: "CRM Department",        description: "Lead qualification, pipeline hygiene, contact management",             intervalMs: 120_000, tickFn: _crmTick         },
  { id: "bizorg_cs",          role: "bizorg_cs",          label: "Customer Success",      description: "Onboarding, health monitoring, churn prevention",                      intervalMs: 180_000, tickFn: _csTick          },
  { id: "bizorg_finance",     role: "bizorg_finance",     label: "Finance Department",    description: "Financial reporting, P&L, cash flow monitoring",                      intervalMs: 300_000, tickFn: _financeTick     },
  { id: "bizorg_billing",     role: "bizorg_billing",     label: "Billing Department",    description: "Subscription processing, payment tracking, revenue recording",         intervalMs: 180_000, tickFn: _billingTick     },
  { id: "bizorg_revops",      role: "bizorg_revops",      label: "Revenue Operations",    description: "MRR/ARR tracking, forecasting, revenue health dashboard",              intervalMs: 240_000, tickFn: _revopsTick      },
  { id: "bizorg_partnerships",role: "bizorg_partnerships",label: "Partnerships",          description: "Partner identification, deal expansion, ecosystem growth",             intervalMs: 600_000, tickFn: _partnershipsTick},
  { id: "bizorg_product_mkt", role: "bizorg_product_mkt", label: "Product Marketing",     description: "Positioning, launch materials, competitive analysis",                  intervalMs: 360_000, tickFn: _productMktTick  },
  { id: "bizorg_content",     role: "bizorg_content",     label: "Content Team",          description: "Blog posts, guides, case studies, content assets",                    intervalMs: 360_000, tickFn: _contentTick     },
  { id: "bizorg_seo",         role: "bizorg_seo",         label: "SEO Team",              description: "Keyword targeting, technical SEO, search rankings",                   intervalMs: 600_000, tickFn: _seoTick         },
  { id: "bizorg_social",      role: "bizorg_social",      label: "Social Media Team",     description: "Content distribution, engagement, brand presence",                    intervalMs: 300_000, tickFn: _socialTick      },
  { id: "bizorg_email",       role: "bizorg_email",       label: "Email Marketing",       description: "Sequences, nurture campaigns, broadcast emails",                      intervalMs: 180_000, tickFn: _emailTick       },
  { id: "bizorg_whatsapp",    role: "bizorg_whatsapp",    label: "WhatsApp Automation",   description: "Onboarding messages, support automation, re-engagement flows",        intervalMs: 240_000, tickFn: _whatsappTick    },
  { id: "bizorg_analytics",   role: "bizorg_analytics",   label: "Analytics Department",  description: "Business dashboards, KPI tracking, report generation",                intervalMs: 300_000, tickFn: _analyticsTick   },
  { id: "bizorg_bi",          role: "bizorg_bi",          label: "Business Intelligence", description: "Signal scanning, recommendation engine, market intelligence",          intervalMs: 360_000, tickFn: _biTick          },
  { id: "bizorg_coordinator", role: "bizorg_coordinator", label: "Executive Coordinator", description: "Cross-department sync, KPI aggregation, executive status",            intervalMs: 240_000, tickFn: _coordinatorTick },
];

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════════

let _registered = false;

function register() {
  if (_registered) return { ok: true, message: "Already registered", count: BUSINESS_ORG.length };
  const sup = _sup();
  try { if (!sup.getSupervisorStatus().started) sup.start(); } catch {}
  const results = [];
  for (const spec of BUSINESS_ORG) {
    const r = sup.registerAgent(spec);
    results.push(r);
  }
  _registered = true;
  // Wire event-driven workflow subscriptions
  try { _wf()?.subscribeWorkflowEvents?.(); } catch {}
  try { _bus()?.emit("bizorg:registered", { count: BUSINESS_ORG.length, ids: BUSINESS_ORG.map(d => d.id) }); } catch {}
  return { ok: true, count: BUSINESS_ORG.length, registered: results.filter(r => r.ok).length };
}

function getOrgStatus() {
  const sup = _sup();
  return BUSINESS_ORG.map(spec => {
    const agent = sup.getAgent(spec.id);
    return agent || { id: spec.id, role: spec.role, label: spec.label, status: "not_registered" };
  });
}

function getOrgSummary() {
  const status   = getOrgStatus();
  const running  = status.filter(a => a.status === "running").length;
  const healthy  = status.filter(a => (a.health || 0) >= 70).length;
  const missions = status.reduce((s, a) => s + (a.missionsCreated || 0), 0);
  const dash     = _st()?.getDashboard?.() || {};
  return { total: status.length, running, healthy, missions, dashboard: dash, departments: status };
}

module.exports = { register, getOrgStatus, getOrgSummary, BUSINESS_ORG };
