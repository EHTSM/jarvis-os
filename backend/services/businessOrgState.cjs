"use strict";
/**
 * Business Org State — Level 3
 *
 * Persistent state for the 20-department autonomous business organization.
 * Every department has:
 *   - own objectives (quarterly + campaign-level)
 *   - own KPI snapshot
 *   - own work queue (business tasks / deals / campaigns)
 *   - own memory (lessons, decisions, outcomes)
 *   - ownership of business assets (leads, deals, customers, campaigns)
 *
 * Business pipeline stages:
 *   prospect → qualified → demo → proposal → negotiation → closed_won | closed_lost
 *
 * Storage layout:
 *   data/bizorg/state.json   — objectives, tasks, pipeline, blockers, handoffs
 *   data/bizorg/kpis.json    — per-department KPIs
 *   data/bizorg/memory.json  — business memory entries
 *   data/bizorg/reports.json — executive reports
 */

const fs   = require("fs");
const path = require("path");

const DIR          = path.join(__dirname, "../../data/bizorg");
const STATE_FILE   = path.join(DIR, "state.json");
const KPI_FILE     = path.join(DIR, "kpis.json");
const MEMORY_FILE  = path.join(DIR, "memory.json");
const REPORT_FILE  = path.join(DIR, "reports.json");

function _ensureDir() { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); }

// ── Defaults ──────────────────────────────────────────────────────────────────

const PIPELINE_STAGES = ["prospect", "qualified", "demo", "proposal", "negotiation", "closed_won", "closed_lost"];

function _defaultState() {
  return {
    version:     3,
    updatedAt:   new Date().toISOString(),
    objectives:  [],   // CEO-level business objectives
    campaigns:   [],   // marketing campaigns → lead gen
    deals:       [],   // CRM pipeline deals
    tasks:       [],   // department work tasks
    backlogs:    {},   // deptId → [taskId, ...]
    handoffs:    [],   // cross-department handoffs
    blockers:    [],   // { id, taskId, description, raisedBy, resolvedAt }
    approvals:   [],   // CEO/COO approval gates
    ownership:   {},   // taskId|dealId → deptId
    reports:     [],   // executive report summaries (also in reports.json)
  };
}

function _defaultKpis() { return {}; }

function _defaultKpi(deptId) {
  return {
    deptId,
    updatedAt:          new Date().toISOString(),
    // Universal KPIs
    tasksCompleted:     0,
    tasksCreated:       0,
    handoffsSent:       0,
    handoffsAccepted:   0,
    memoryEntries:      0,
    // Sales/CRM
    leadsGenerated:     0,
    leadsQualified:     0,
    dealsCreated:       0,
    dealsWon:           0,
    dealsLost:          0,
    dealValueWon:       0,   // total $ won
    // Marketing
    campaignsLaunched:  0,
    campaignLeads:      0,
    emailsSent:         0,
    // Revenue
    mrr:                0,
    arr:                0,
    churnRate:          0,
    ltv:                0,
    cac:                0,
    // CS
    healthScore:        100,
    retentionRate:      100,
    // Content
    contentPieces:      0,
    // Analytics
    reportsGenerated:   0,
  };
}

// ── I/O ───────────────────────────────────────────────────────────────────────

let _state   = null;
let _kpis    = null;
let _memory  = null;
let _reports = null;

function _load() {
  _ensureDir();
  if (_state) return;
  try { _state   = JSON.parse(fs.readFileSync(STATE_FILE,  "utf8")); } catch { _state   = _defaultState(); }
  try { _kpis    = JSON.parse(fs.readFileSync(KPI_FILE,    "utf8")); } catch { _kpis    = _defaultKpis(); }
  try { _memory  = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")); } catch { _memory  = []; }
  try { _reports = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8")); } catch { _reports = []; }
}

function _save() {
  _ensureDir();
  _state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE,  JSON.stringify(_state,   null, 2));
  fs.writeFileSync(KPI_FILE,    JSON.stringify(_kpis,    null, 2));
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(_memory,  null, 2));
  fs.writeFileSync(REPORT_FILE, JSON.stringify(_reports, null, 2));
}

function _s()  { _load(); return _state; }
function _k()  { _load(); return _kpis; }
function _kpi(deptId) {
  _load();
  if (!_kpis[deptId]) _kpis[deptId] = _defaultKpi(deptId);
  return _kpis[deptId];
}

let _seq = 0;
function _id(prefix) { return `${prefix}_${Date.now()}_${(++_seq).toString(36)}`; }

function _q() { return _currentQuarter(); }
function _currentQuarter() {
  const d = new Date(); return `Q${Math.ceil((d.getMonth() + 1) / 3)}-${d.getFullYear()}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECTIVES (CEO level)
// ═══════════════════════════════════════════════════════════════════════════════

function createObjective({ title, description, quarter, deptId = "bizorg_ceo", kpis = [], target } = {}) {
  if (!title) return { ok: false, error: "title required" };
  _s();
  const obj = {
    id:          _id("bobj"),
    title, description,
    quarter:     quarter || _q(),
    deptId,
    kpis, target,
    status:      "active",
    campaignIds: [],
    taskIds:     [],
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    completedAt: null,
  };
  _state.objectives.push(obj);
  _kpi(deptId).tasksCreated++;
  _save();
  return { ok: true, objective: obj };
}

function listObjectives({ quarter, deptId, status } = {}) {
  _s();
  let list = _state.objectives;
  if (quarter) list = list.filter(o => o.quarter === quarter);
  if (deptId)  list = list.filter(o => o.deptId  === deptId);
  if (status)  list = list.filter(o => o.status  === status);
  return list;
}

function updateObjective(id, patch) {
  _s();
  const obj = _state.objectives.find(o => o.id === id);
  if (!obj) return { ok: false, error: "not found" };
  Object.assign(obj, patch, { updatedAt: new Date().toISOString() });
  _save();
  return { ok: true, objective: obj };
}

function _objectiveExists(title) {
  try { return _s().objectives.some(o => o.title === title && o.status === "active"); } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS (Marketing → Lead Gen)
// ═══════════════════════════════════════════════════════════════════════════════

function createCampaign({ title, description, objectiveId, channel, budget = 0, targetLeads = 10, deptId = "bizorg_marketing" } = {}) {
  if (!title) return { ok: false, error: "title required" };
  _s();
  const campaign = {
    id:           _id("bcmp"),
    title, description,
    objectiveId:  objectiveId || null,
    channel:      channel || "email",
    budget,
    targetLeads,
    actualLeads:  0,
    deptId,
    status:       "planned",
    taskIds:      [],
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    launchedAt:   null,
    completedAt:  null,
  };
  _state.campaigns.push(campaign);
  if (objectiveId) {
    const obj = _state.objectives.find(o => o.id === objectiveId);
    if (obj && !obj.campaignIds.includes(campaign.id)) obj.campaignIds.push(campaign.id);
  }
  _kpi(deptId).tasksCreated++;
  _save();
  return { ok: true, campaign };
}

function updateCampaign(id, patch) {
  _s();
  const c = _state.campaigns.find(c => c.id === id);
  if (!c) return { ok: false, error: "Campaign not found" };
  Object.assign(c, patch, { updatedAt: new Date().toISOString() });
  if (patch.status === "active" && !c.launchedAt) c.launchedAt = new Date().toISOString();
  if (patch.status === "completed" && !c.completedAt) {
    c.completedAt = new Date().toISOString();
    _kpi(c.deptId).campaignsLaunched++;
    if (patch.actualLeads) _kpi(c.deptId).campaignLeads += (patch.actualLeads || 0);
  }
  _save();
  return { ok: true, campaign: c };
}

function listCampaigns({ objectiveId, status, channel } = {}) {
  _s();
  let list = _state.campaigns;
  if (objectiveId) list = list.filter(c => c.objectiveId === objectiveId);
  if (status)      list = list.filter(c => c.status === status);
  if (channel)     list = list.filter(c => c.channel === channel);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEALS (CRM Pipeline)
// ═══════════════════════════════════════════════════════════════════════════════

function createDeal({ title, company, contactEmail, value = 0, stage = "prospect", deptId = "bizorg_crm", campaignId, leadSource } = {}) {
  if (!title) return { ok: false, error: "title required" };
  _s();
  const deal = {
    id:           _id("bdeal"),
    title, company,
    contactEmail: contactEmail || null,
    value,
    stage,
    deptId,
    campaignId:   campaignId || null,
    leadSource:   leadSource || "organic",
    assignedTo:   deptId,
    history:      [{ ts: new Date().toISOString(), stage, actor: deptId, note: "Deal created" }],
    wonAt:        null,
    lostAt:       null,
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
  };
  _state.deals.push(deal);
  _state.ownership[deal.id] = deptId;
  _kpi(deptId).dealsCreated++;
  _kpi(deptId).leadsGenerated++;
  if (campaignId) {
    const camp = _state.campaigns.find(c => c.id === campaignId);
    if (camp) { camp.actualLeads++; camp.updatedAt = new Date().toISOString(); }
  }
  _save();
  return { ok: true, deal };
}

function advanceDeal(id, { stage, actor, note = "", value } = {}) {
  _s();
  const deal = _state.deals.find(d => d.id === id);
  if (!deal) return { ok: false, error: "Deal not found" };
  if (!PIPELINE_STAGES.includes(stage)) return { ok: false, error: `Invalid stage: ${stage}` };

  const prev = deal.stage;
  deal.stage     = stage;
  deal.updatedAt = new Date().toISOString();
  if (value !== undefined) deal.value = value;
  deal.history.push({ ts: new Date().toISOString(), stage, actor: actor || deal.deptId, note });

  if (stage === "qualified") _kpi(deal.deptId).leadsQualified++;
  if (stage === "closed_won") {
    deal.wonAt = new Date().toISOString();
    const k = _kpi(deal.deptId);
    k.dealsWon++;
    k.dealValueWon += deal.value;
    k.mrr += Math.round(deal.value / 12);
  }
  if (stage === "closed_lost") {
    deal.lostAt = new Date().toISOString();
    _kpi(deal.deptId).dealsLost++;
  }
  _save();
  return { ok: true, deal, prevStage: prev };
}

function getDeal(id) { _s(); return _state.deals.find(d => d.id === id) || null; }

function listDeals({ stage, deptId, campaignId, limit = 100 } = {}) {
  _s();
  let list = _state.deals;
  if (stage)      list = list.filter(d => d.stage === stage);
  if (deptId)     list = list.filter(d => d.deptId === deptId || d.assignedTo === deptId);
  if (campaignId) list = list.filter(d => d.campaignId === campaignId);
  return list.slice(0, limit);
}

function getPipelineStats() {
  _s();
  const deals = _state.deals;
  const byStage = {};
  for (const s of PIPELINE_STAGES) byStage[s] = { count: 0, value: 0 };
  for (const d of deals) {
    if (byStage[d.stage]) { byStage[d.stage].count++; byStage[d.stage].value += d.value; }
  }
  const won    = deals.filter(d => d.stage === "closed_won");
  const active = deals.filter(d => !["closed_won","closed_lost"].includes(d.stage));
  return {
    total: deals.length,
    byStage,
    pipelineValue:  active.reduce((s, d) => s + d.value, 0),
    totalWonValue:  won.reduce((s, d) => s + d.value, 0),
    winRate:        deals.length ? Math.round(won.length / deals.filter(d => ["closed_won","closed_lost"].includes(d.stage)).length * 100) || 0 : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS (Department work queue)
// ═══════════════════════════════════════════════════════════════════════════════

const TASK_STATUSES = ["planned","ready","in_progress","blocked","done","cancelled"];

function createTask({ title, description, deptId, priority = "medium", type = "general", objectiveId, campaignId, dealId, estimatedHours = 2, tags = [] } = {}) {
  if (!title || !deptId) return { ok: false, error: "title + deptId required" };
  _s();
  const task = {
    id:          _id("btask"),
    title, description,
    deptId,
    priority, type,
    objectiveId: objectiveId || null,
    campaignId:  campaignId  || null,
    dealId:      dealId      || null,
    estimatedHours,
    tags,
    status:      "planned",
    assignedTo:  deptId,
    history:     [],
    claimedAt:   null,
    startedAt:   null,
    completedAt: null,
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
  };
  _state.tasks.push(task);
  if (!_state.backlogs[deptId]) _state.backlogs[deptId] = [];
  _state.backlogs[deptId].push(task.id);
  _state.ownership[task.id] = deptId;
  _kpi(deptId).tasksCreated++;
  _save();
  return { ok: true, task };
}

function getTask(id) { _s(); return _state.tasks.find(t => t.id === id) || null; }

function listTasks({ deptId, status, type, priority, limit = 100 } = {}) {
  _s();
  let list = _state.tasks;
  if (deptId)   list = list.filter(t => t.deptId === deptId || t.assignedTo === deptId);
  if (status)   list = list.filter(t => t.status === status);
  if (type)     list = list.filter(t => t.type   === type);
  if (priority) list = list.filter(t => t.priority === priority);
  return list.slice(0, limit);
}

function updateTask(id, patch, { actor = "system", note = "" } = {}) {
  _s();
  const task = _state.tasks.find(t => t.id === id);
  if (!task) return { ok: false, error: "Task not found" };
  const prev = task.status;
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
  task.history.push({ ts: new Date().toISOString(), actor, action: patch.status ? `${prev}→${patch.status}` : "update", note });
  if (patch.status === "in_progress" && !task.startedAt) task.startedAt = new Date().toISOString();
  if (patch.status === "done" && !task.completedAt) {
    task.completedAt = new Date().toISOString();
    _kpi(task.deptId).tasksCompleted++;
  }
  _save();
  return { ok: true, task, prevStatus: prev };
}

function claimTask(deptId, taskId) {
  _s();
  const task = _state.tasks.find(t => t.id === taskId);
  if (!task) return { ok: false, error: "Task not found" };
  if (!["planned","ready"].includes(task.status)) return { ok: false, error: `Cannot claim — status: ${task.status}` };
  task.assignedTo = deptId;
  task.status     = "in_progress";
  task.claimedAt  = new Date().toISOString();
  task.startedAt  = task.claimedAt;
  task.updatedAt  = task.claimedAt;
  task.history.push({ ts: task.claimedAt, actor: deptId, action: "claimed+started" });
  _state.ownership[taskId] = deptId;
  if (!_state.backlogs[deptId]) _state.backlogs[deptId] = [];
  if (!_state.backlogs[deptId].includes(taskId)) _state.backlogs[deptId].push(taskId);
  _save();
  return { ok: true, task };
}

function getBacklog(deptId) {
  _s();
  return (_state.backlogs[deptId] || []).map(id => _state.tasks.find(t => t.id === id)).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDOFFS
// ═══════════════════════════════════════════════════════════════════════════════

function createHandoff({ fromDept, toDept, taskId, dealId, message, context = {} } = {}) {
  if (!fromDept || !toDept) return { ok: false, error: "fromDept + toDept required" };
  _s();
  const handoff = {
    id:        _id("bhoff"),
    fromDept, toDept,
    taskId:    taskId || null,
    dealId:    dealId || null,
    message:   message || "",
    context,
    timestamp: new Date().toISOString(),
    accepted:  null,
    acceptedAt: null,
  };
  _state.handoffs.push(handoff);
  _kpi(fromDept).handoffsSent++;
  _save();
  return { ok: true, handoff };
}

function acceptHandoff(handoffId) {
  _s();
  const h = _state.handoffs.find(h => h.id === handoffId);
  if (!h) return { ok: false, error: "Handoff not found" };
  h.accepted   = true;
  h.acceptedAt = new Date().toISOString();
  // Transfer ownership
  if (h.taskId) _state.ownership[h.taskId] = h.toDept;
  if (h.dealId) {
    _state.ownership[h.dealId] = h.toDept;
    const d = _state.deals.find(d => d.id === h.dealId);
    if (d) { d.assignedTo = h.toDept; d.deptId = h.toDept; d.updatedAt = h.acceptedAt; }
  }
  _kpi(h.fromDept).handoffsAccepted++;
  _save();
  return { ok: true, handoff: h };
}

function listHandoffs({ deptId, pending = false } = {}) {
  _s();
  let list = _state.handoffs;
  if (deptId)  list = list.filter(h => h.fromDept === deptId || h.toDept === deptId);
  if (pending) list = list.filter(h => h.accepted === null);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKERS
// ═══════════════════════════════════════════════════════════════════════════════

function raiseBlocker({ taskId, dealId, description, raisedBy } = {}) {
  _s();
  const blocker = {
    id:         _id("bblk"),
    taskId:     taskId || null,
    dealId:     dealId || null,
    description,
    raisedBy:   raisedBy || "system",
    raisedAt:   new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };
  _state.blockers.push(blocker);
  if (taskId) { const t = _state.tasks.find(t => t.id === taskId); if (t) { t.status = "blocked"; t.updatedAt = blocker.raisedAt; } }
  _save();
  return { ok: true, blocker };
}

function resolveBlocker(id, { resolvedBy } = {}) {
  _s();
  const b = _state.blockers.find(b => b.id === id);
  if (!b) return { ok: false, error: "Blocker not found" };
  b.resolvedAt = new Date().toISOString();
  b.resolvedBy = resolvedBy || "system";
  if (b.taskId) {
    const t = _state.tasks.find(t => t.id === b.taskId);
    if (t && t.status === "blocked") { t.status = "in_progress"; t.updatedAt = b.resolvedAt; }
  }
  _save();
  return { ok: true, blocker: b };
}

function listBlockers({ resolved = false } = {}) {
  _s();
  return _state.blockers.filter(b => resolved ? true : !b.resolvedAt);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY
// ═══════════════════════════════════════════════════════════════════════════════

function addMemory({ deptId, type, title, detail, taskId, dealId, tags = [], metrics = {} } = {}) {
  if (!deptId || !title) return { ok: false, error: "deptId + title required" };
  _load();
  const entry = {
    id:        _id("bmem"),
    deptId, type: type || "lesson", title,
    detail:    detail || "",
    taskId:    taskId  || null,
    dealId:    dealId  || null,
    tags, metrics,
    timestamp: new Date().toISOString(),
  };
  _memory.push(entry);
  _kpi(deptId).memoryEntries++;
  _save();
  return { ok: true, entry };
}

function getMemory({ deptId, type, limit = 50 } = {}) {
  _load();
  let list = _memory;
  if (deptId) list = list.filter(m => m.deptId === deptId);
  if (type)   list = list.filter(m => m.type   === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

function createReport({ title, deptId, type, data, period } = {}) {
  _load();
  const report = {
    id:        _id("brpt"),
    title, deptId,
    type:      type   || "executive",
    period:    period || _q(),
    data,
    createdAt: new Date().toISOString(),
  };
  _reports.push(report);
  _kpi(deptId || "bizorg_analytics").reportsGenerated++;
  _state.reports = _state.reports || [];
  _state.reports.push({ id: report.id, title, deptId, type, createdAt: report.createdAt });
  _save();
  return { ok: true, report };
}

function listReports({ deptId, type, limit = 20 } = {}) {
  _load();
  let list = _reports;
  if (deptId) list = list.filter(r => r.deptId === deptId);
  if (type)   list = list.filter(r => r.type   === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════════════════════════

function getKpi(deptId)      { return _kpi(deptId); }
function getAllKpis()         { _load(); return Object.values(_kpis); }
function updateKpi(deptId, p) {
  const k = _kpi(deptId);
  Object.assign(k, p, { updatedAt: new Date().toISOString() });
  _save();
  return k;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function getDashboard() {
  _s();
  const kpis     = Object.values(_kpis);
  const deals    = _state.deals;
  const tasks    = _state.tasks;
  const pipeline = getPipelineStats();
  const totalMrr = kpis.reduce((s, k) => s + (k.mrr || 0), 0);
  const totalLeads = kpis.reduce((s, k) => s + (k.leadsGenerated || 0), 0);
  const totalWon = kpis.reduce((s, k) => s + (k.dealsWon || 0), 0);
  return {
    updatedAt:   new Date().toISOString(),
    quarter:     _q(),
    objectives:  { total: _state.objectives.length, active: _state.objectives.filter(o => o.status === "active").length },
    campaigns:   { total: _state.campaigns.length, active: _state.campaigns.filter(c => c.status === "active").length, completed: _state.campaigns.filter(c => c.status === "completed").length },
    pipeline,
    tasks: {
      total:      tasks.length,
      inProgress: tasks.filter(t => t.status === "in_progress").length,
      blocked:    tasks.filter(t => t.status === "blocked").length,
      done:       tasks.filter(t => t.status === "done").length,
    },
    blockers:    { active: _state.blockers.filter(b => !b.resolvedAt).length },
    handoffs:    { pending: _state.handoffs.filter(h => h.accepted === null).length },
    revenue:     { mrr: totalMrr, arr: totalMrr * 12 },
    leads:       { total: totalLeads, won: totalWon },
    reports:     { total: _reports.length },
    deptCount:   kpis.length,
  };
}

function currentQuarter() { return _q(); }
function getPipelineStages() { return PIPELINE_STAGES; }
function getOwnership()    { _s(); return _state.ownership; }

module.exports = {
  // Objectives
  createObjective, listObjectives, updateObjective,
  // Campaigns
  createCampaign, updateCampaign, listCampaigns,
  // Deals
  createDeal, advanceDeal, getDeal, listDeals, getPipelineStats,
  // Tasks
  createTask, getTask, listTasks, updateTask, claimTask, getBacklog,
  // Handoffs
  createHandoff, acceptHandoff, listHandoffs,
  // Blockers
  raiseBlocker, resolveBlocker, listBlockers,
  // Memory
  addMemory, getMemory,
  // Reports
  createReport, listReports,
  // KPIs
  getKpi, getAllKpis, updateKpi,
  // Dashboard
  getDashboard, currentQuarter, getPipelineStages, getOwnership,
  // Constants
  PIPELINE_STAGES,
};
