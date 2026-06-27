"use strict";
/**
 * Engineering Org State — Level 2 V2
 *
 * Persistent state for the autonomous engineering organization.
 * Every engineer has:
 *   - own backlog (ordered list of work items)
 *   - own KPI snapshot (velocity, quality, utilization)
 *   - ownership map (workItemId → engineerId)
 *   - blocker registry
 *   - handoff log
 *   - approval queue
 *   - engineering memory (per-engineer lesson store)
 *
 * Work items are the unit of engineering work. They map 1:1 to missions
 * but carry richer eng-org metadata (epic, owner, reviewers, blockers).
 *
 * Quarterly objectives → Epics → Work items → Tasks (missions)
 *
 * Storage layout:
 *   data/engorg/state.json         — master state file
 *   data/engorg/kpis.json          — per-engineer KPIs
 *   data/engorg/memory.json        — engineering memory entries
 */

const fs   = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "../../data/engorg");
const STATE_FILE  = path.join(DIR, "state.json");
const KPI_FILE    = path.join(DIR, "kpis.json");
const MEMORY_FILE = path.join(DIR, "memory.json");

function _ensureDir() { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); }

// ── Defaults ──────────────────────────────────────────────────────────────────

function _defaultState() {
  return {
    version:    2,
    updatedAt:  new Date().toISOString(),
    objectives: [],   // quarterly objectives (CTO level)
    epics:      [],   // EM-level epics linked to objectives
    workItems:  [],   // individual work items (tech plan → claim → review → done)
    backlogs:   {},   // engineerId → [workItemId, ...]
    blockers:   [],   // { id, workItemId, description, blockedBy, raisedBy, resolvedAt }
    handoffs:   [],   // { id, fromEngineer, toEngineer, workItemId, message, timestamp, accepted }
    approvals:  [],   // { id, workItemId, requestedBy, approvers[], decisions[], status }
    ownership:  {},   // workItemId → engineerId
    reviews:    [],   // { id, workItemId, reviewerIds[], status, findings, createdAt, resolvedAt }
  };
}

function _defaultKpis() {
  return {};  // engineerId → KPI object
}

function _defaultKpi(engineerId) {
  return {
    engineerId,
    updatedAt:       new Date().toISOString(),
    velocity:        0,     // work items completed this cycle
    qualityScore:    100,   // 0-100, decrements on regressions/incidents
    utilization:     0,     // 0-100, % of capacity used
    missionsCreated: 0,
    missionsCompleted: 0,
    reviewsCompleted: 0,
    handoffsSent:    0,
    handoffsAccepted: 0,
    blockersRaised:  0,
    blockersResolved: 0,
    approvalsGranted: 0,
    approvalsDenied:  0,
    avgCycleTimeMs:  0,     // avg time from claim to done
    memoryEntries:   0,
  };
}

// ── I/O ───────────────────────────────────────────────────────────────────────

let _state = null;
let _kpis  = null;
let _memory = null;
let _dirty  = false;

function _loadState() {
  _ensureDir();
  if (_state) return;
  try { _state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { _state = _defaultState(); }
  try { _kpis  = JSON.parse(fs.readFileSync(KPI_FILE,   "utf8")); } catch { _kpis  = _defaultKpis(); }
  try { _memory = JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8")); } catch { _memory = []; }
}

function _save() {
  _ensureDir();
  _state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE,  JSON.stringify(_state,  null, 2));
  fs.writeFileSync(KPI_FILE,    JSON.stringify(_kpis,   null, 2));
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(_memory, null, 2));
}

function _s() { _loadState(); return _state; }
function _k() { _loadState(); return _kpis; }
function _m() { _loadState(); return _memory; }

function _kpi(engineerId) {
  _loadState();
  if (!_kpis[engineerId]) _kpis[engineerId] = _defaultKpi(engineerId);
  return _kpis[engineerId];
}

// ── ID generator ──────────────────────────────────────────────────────────────
let _seq = 0;
function _id(prefix) { return `${prefix}_${Date.now()}_${(++_seq).toString(36)}`; }

// ═══════════════════════════════════════════════════════════════════════════════
// QUARTERLY OBJECTIVES (CTO)
// ═══════════════════════════════════════════════════════════════════════════════

function createObjective({ title, description, quarter, ownerId = "engorg_cto", kpis = [] } = {}) {
  if (!title) return { ok: false, error: "title required" };
  _s();
  const obj = {
    id:          _id("obj"),
    title, description,
    quarter:     quarter || _currentQuarter(),
    status:      "active",
    ownerId,
    kpis,
    epicIds:     [],
    createdAt:   new Date().toISOString(),
    updatedAt:   new Date().toISOString(),
    completedAt: null,
  };
  _state.objectives.push(obj);
  _save();
  return { ok: true, objective: obj };
}

function listObjectives({ quarter, status } = {}) {
  _s();
  let list = _state.objectives;
  if (quarter) list = list.filter(o => o.quarter === quarter);
  if (status)  list = list.filter(o => o.status  === status);
  return list;
}

function updateObjective(id, patch) {
  _s();
  const obj = _state.objectives.find(o => o.id === id);
  if (!obj) return { ok: false, error: "Objective not found" };
  Object.assign(obj, patch, { updatedAt: new Date().toISOString() });
  _save();
  return { ok: true, objective: obj };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EPICS (Engineering Manager)
// ═══════════════════════════════════════════════════════════════════════════════

function createEpic({ title, description, objectiveId, ownerId = "engorg_manager", priority = "medium", estimatedDays = 5 } = {}) {
  if (!title) return { ok: false, error: "title required" };
  _s();
  const epic = {
    id:           _id("epic"),
    title, description,
    objectiveId:  objectiveId || null,
    status:       "planned",
    priority,
    ownerId,
    estimatedDays,
    workItemIds:  [],
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    completedAt:  null,
  };
  _state.epics.push(epic);
  if (objectiveId) {
    const obj = _state.objectives.find(o => o.id === objectiveId);
    if (obj) obj.epicIds.push(epic.id);
  }
  _save();
  return { ok: true, epic };
}

function listEpics({ objectiveId, status, priority } = {}) {
  _s();
  let list = _state.epics;
  if (objectiveId) list = list.filter(e => e.objectiveId === objectiveId);
  if (status)      list = list.filter(e => e.status === status);
  if (priority)    list = list.filter(e => e.priority === priority);
  return list;
}

function updateEpic(id, patch) {
  _s();
  const epic = _state.epics.find(e => e.id === id);
  if (!epic) return { ok: false, error: "Epic not found" };
  Object.assign(epic, patch, { updatedAt: new Date().toISOString() });
  _save();
  return { ok: true, epic };
}

// ═══════════════════════════════════════════════════════════════════════════════
// WORK ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_STATUSES = ["planned", "ready", "claimed", "in_progress", "blocked",
                        "in_review", "in_qa", "in_security_review", "approved",
                        "deploying", "done", "cancelled"];

function createWorkItem({
  title, description, epicId, domain, priority = "medium",
  assignedTo, reviewerIds = [], techPlan, missionId,
  estimatedHours = 4, tags = [],
} = {}) {
  if (!title) return { ok: false, error: "title required" };
  _s();
  const item = {
    id:           _id("wi"),
    title, description,
    epicId:       epicId || null,
    domain:       domain || "engineering",
    priority,
    status:       "planned",
    assignedTo:   assignedTo || null,
    reviewerIds:  reviewerIds || [],
    techPlan:     techPlan || null,
    missionId:    missionId || null,
    estimatedHours,
    tags,
    blockerIds:   [],
    approvalId:   null,
    reviewId:     null,
    claimedAt:    null,
    startedAt:    null,
    completedAt:  null,
    createdAt:    new Date().toISOString(),
    updatedAt:    new Date().toISOString(),
    history:      [],   // [{ts, actor, action, note}]
  };
  _state.workItems.push(item);
  if (epicId) {
    const epic = _state.epics.find(e => e.id === epicId);
    if (epic && !epic.workItemIds.includes(item.id)) epic.workItemIds.push(item.id);
  }
  _save();
  return { ok: true, workItem: item };
}

function getWorkItem(id) {
  _s();
  return _state.workItems.find(w => w.id === id) || null;
}

function listWorkItems({ status, assignedTo, domain, epicId, priority, limit = 100 } = {}) {
  _s();
  let list = _state.workItems;
  if (status)     list = list.filter(w => w.status === status);
  if (assignedTo) list = list.filter(w => w.assignedTo === assignedTo);
  if (domain)     list = list.filter(w => w.domain === domain);
  if (epicId)     list = list.filter(w => w.epicId === epicId);
  if (priority)   list = list.filter(w => w.priority === priority);
  return list.slice(0, limit);
}

function updateWorkItem(id, patch, { actor = "system", note = "" } = {}) {
  _s();
  const item = _state.workItems.find(w => w.id === id);
  if (!item) return { ok: false, error: "Work item not found" };
  const prev = item.status;
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  item.history.push({ ts: new Date().toISOString(), actor, action: patch.status ? `status:${prev}→${patch.status}` : "update", note });
  if (patch.status === "claimed" && !item.claimedAt) item.claimedAt = new Date().toISOString();
  if (patch.status === "in_progress" && !item.startedAt) item.startedAt = new Date().toISOString();
  if (patch.status === "done" && !item.completedAt) {
    item.completedAt = new Date().toISOString();
    // Update KPI velocity
    if (item.assignedTo) {
      const k = _kpi(item.assignedTo);
      k.velocity++;
      k.missionsCompleted++;
      if (item.startedAt) {
        const cycleMs = new Date(item.completedAt) - new Date(item.startedAt);
        k.avgCycleTimeMs = k.avgCycleTimeMs ? Math.round((k.avgCycleTimeMs + cycleMs) / 2) : cycleMs;
      }
      k.updatedAt = new Date().toISOString();
    }
  }
  // Update ownership map
  if (patch.assignedTo) _state.ownership[id] = patch.assignedTo;
  _save();
  return { ok: true, workItem: item, prevStatus: prev };
}

// ── Backlog management ────────────────────────────────────────────────────────

function getBacklog(engineerId) {
  _s();
  const ids = _state.backlogs[engineerId] || [];
  return ids.map(id => _state.workItems.find(w => w.id === id)).filter(Boolean);
}

function addToBacklog(engineerId, workItemId) {
  _s();
  if (!_state.backlogs[engineerId]) _state.backlogs[engineerId] = [];
  if (!_state.backlogs[engineerId].includes(workItemId)) _state.backlogs[engineerId].push(workItemId);
  _save();
  return { ok: true };
}

function removeFromBacklog(engineerId, workItemId) {
  _s();
  if (_state.backlogs[engineerId]) {
    _state.backlogs[engineerId] = _state.backlogs[engineerId].filter(id => id !== workItemId);
    _save();
  }
  return { ok: true };
}

// ── Claim work item ────────────────────────────────────────────────────────────

function claimWorkItem(engineerId, workItemId) {
  _s();
  const item = _state.workItems.find(w => w.id === workItemId);
  if (!item) return { ok: false, error: "Work item not found" };
  if (item.status !== "ready" && item.status !== "planned") return { ok: false, error: `Cannot claim — status: ${item.status}` };
  if (item.assignedTo && item.assignedTo !== engineerId) return { ok: false, error: `Already assigned to ${item.assignedTo}` };

  const prev = item.status;
  item.assignedTo = engineerId;
  item.status     = "claimed";
  item.claimedAt  = new Date().toISOString();
  item.updatedAt  = new Date().toISOString();
  item.history.push({ ts: item.claimedAt, actor: engineerId, action: `claimed (was ${prev})`, note: "" });
  _state.ownership[workItemId] = engineerId;

  // Add to engineer's backlog
  if (!_state.backlogs[engineerId]) _state.backlogs[engineerId] = [];
  if (!_state.backlogs[engineerId].includes(workItemId)) _state.backlogs[engineerId].push(workItemId);

  // KPI
  const k = _kpi(engineerId);
  k.utilization = Math.min(100, k.utilization + 10);
  k.updatedAt = new Date().toISOString();

  _save();
  return { ok: true, workItem: item };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKERS
// ═══════════════════════════════════════════════════════════════════════════════

function raiseBlocker({ workItemId, description, blockedBy, raisedBy } = {}) {
  if (!workItemId || !description) return { ok: false, error: "workItemId + description required" };
  _s();
  const blocker = {
    id:         _id("blk"),
    workItemId, description,
    blockedBy:  blockedBy || null,
    raisedBy:   raisedBy  || "system",
    raisedAt:   new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
  };
  _state.blockers.push(blocker);

  // Mark work item as blocked
  const item = _state.workItems.find(w => w.id === workItemId);
  if (item) {
    item.status = "blocked";
    item.blockerIds.push(blocker.id);
    item.updatedAt = new Date().toISOString();
  }

  // KPI
  if (raisedBy) { const k = _kpi(raisedBy); k.blockersRaised++; k.updatedAt = new Date().toISOString(); }

  _save();
  return { ok: true, blocker };
}

function resolveBlocker(blockerId, { resolvedBy } = {}) {
  _s();
  const blocker = _state.blockers.find(b => b.id === blockerId);
  if (!blocker) return { ok: false, error: "Blocker not found" };
  blocker.resolvedAt = new Date().toISOString();
  blocker.resolvedBy = resolvedBy || "system";

  // Un-block work item if no remaining blockers
  const item = _state.workItems.find(w => w.id === blocker.workItemId);
  if (item) {
    item.blockerIds = item.blockerIds.filter(id => id !== blockerId);
    const remaining = _state.blockers.filter(b => b.workItemId === blocker.workItemId && !b.resolvedAt);
    if (remaining.length === 0 && item.status === "blocked") {
      item.status = item.assignedTo ? "in_progress" : "ready";
      item.updatedAt = new Date().toISOString();
    }
  }

  if (resolvedBy) { const k = _kpi(resolvedBy); k.blockersResolved++; k.updatedAt = new Date().toISOString(); }
  _save();
  return { ok: true, blocker, workItemStatus: item?.status };
}

function listBlockers({ workItemId, resolved = false } = {}) {
  _s();
  let list = _state.blockers;
  if (workItemId) list = list.filter(b => b.workItemId === workItemId);
  if (!resolved)  list = list.filter(b => !b.resolvedAt);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HANDOFFS
// ═══════════════════════════════════════════════════════════════════════════════

function createHandoff({ fromEngineer, toEngineer, workItemId, message } = {}) {
  if (!fromEngineer || !toEngineer || !workItemId) return { ok: false, error: "fromEngineer, toEngineer, workItemId required" };
  _s();
  const handoff = {
    id:           _id("hoff"),
    fromEngineer, toEngineer, workItemId,
    message:      message || "",
    timestamp:    new Date().toISOString(),
    accepted:     null,
    acceptedAt:   null,
  };
  _state.handoffs.push(handoff);
  _kpi(fromEngineer).handoffsSent++;
  _kpi(fromEngineer).updatedAt = new Date().toISOString();
  _save();
  return { ok: true, handoff };
}

function acceptHandoff(handoffId, { engineerId } = {}) {
  _s();
  const handoff = _state.handoffs.find(h => h.id === handoffId);
  if (!handoff) return { ok: false, error: "Handoff not found" };
  handoff.accepted   = true;
  handoff.acceptedAt = new Date().toISOString();

  // Transfer ownership
  _state.ownership[handoff.workItemId] = handoff.toEngineer;
  const item = _state.workItems.find(w => w.id === handoff.workItemId);
  if (item) { item.assignedTo = handoff.toEngineer; item.updatedAt = new Date().toISOString(); }

  // KPIs
  const k = _kpi(handoff.fromEngineer);
  k.handoffsAccepted++;
  k.updatedAt = new Date().toISOString();
  addToBacklog(handoff.toEngineer, handoff.workItemId);
  removeFromBacklog(handoff.fromEngineer, handoff.workItemId);
  _save();
  return { ok: true, handoff };
}

function listHandoffs({ engineerId, pending = false } = {}) {
  _s();
  let list = _state.handoffs;
  if (engineerId) list = list.filter(h => h.fromEngineer === engineerId || h.toEngineer === engineerId);
  if (pending)    list = list.filter(h => h.accepted === null);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVALS
// ═══════════════════════════════════════════════════════════════════════════════

function requestApproval({ workItemId, requestedBy, approvers = [], description } = {}) {
  if (!workItemId || !requestedBy) return { ok: false, error: "workItemId + requestedBy required" };
  _s();
  const approval = {
    id:          _id("appr"),
    workItemId, requestedBy,
    approvers:   approvers.length ? approvers : ["engorg_code_review"],
    decisions:   [],  // [{engineerId, decision: "approve"|"deny", comment, timestamp}]
    status:      "pending",
    description: description || "",
    createdAt:   new Date().toISOString(),
    resolvedAt:  null,
  };
  _state.approvals.push(approval);
  const item = _state.workItems.find(w => w.id === workItemId);
  if (item) { item.approvalId = approval.id; item.status = "in_review"; item.updatedAt = new Date().toISOString(); }
  _save();
  return { ok: true, approval };
}

function recordApprovalDecision(approvalId, { engineerId, decision, comment = "" } = {}) {
  _s();
  const approval = _state.approvals.find(a => a.id === approvalId);
  if (!approval) return { ok: false, error: "Approval not found" };
  if (approval.status !== "pending") return { ok: false, error: `Approval already ${approval.status}` };

  approval.decisions.push({ engineerId, decision, comment, timestamp: new Date().toISOString() });

  const k = _kpi(engineerId);
  if (decision === "approve") k.approvalsGranted++; else k.approvalsDenied++;
  k.updatedAt = new Date().toISOString();

  // Resolve if all approvers have decided
  const approvedBy = approval.decisions.filter(d => d.decision === "approve").map(d => d.engineerId);
  const deniedBy   = approval.decisions.filter(d => d.decision === "deny").map(d => d.engineerId);
  const allVoted   = approval.approvers.every(a => approval.decisions.some(d => d.engineerId === a));
  const anyDenied  = deniedBy.length > 0;

  if (anyDenied) {
    approval.status     = "denied";
    approval.resolvedAt = new Date().toISOString();
    const item = _state.workItems.find(w => w.id === approval.workItemId);
    if (item) { item.status = "in_progress"; item.updatedAt = new Date().toISOString(); }
  } else if (allVoted) {
    approval.status     = "approved";
    approval.resolvedAt = new Date().toISOString();
    const item = _state.workItems.find(w => w.id === approval.workItemId);
    if (item) { item.status = "approved"; item.updatedAt = new Date().toISOString(); }
  }

  _save();
  return { ok: true, approval };
}

function listApprovals({ status, workItemId } = {}) {
  _s();
  let list = _state.approvals;
  if (status)     list = list.filter(a => a.status === status);
  if (workItemId) list = list.filter(a => a.workItemId === workItemId);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// REVIEWS
// ═══════════════════════════════════════════════════════════════════════════════

function createReview({ workItemId, requestedBy, reviewerIds = [], type = "code" } = {}) {
  if (!workItemId) return { ok: false, error: "workItemId required" };
  _s();
  const review = {
    id:          _id("rev"),
    workItemId, requestedBy,
    reviewerIds: reviewerIds.length ? reviewerIds : ["engorg_code_review"],
    type,
    status:      "open",
    findings:    [],
    createdAt:   new Date().toISOString(),
    resolvedAt:  null,
  };
  _state.reviews.push(review);
  const item = _state.workItems.find(w => w.id === workItemId);
  if (item) { item.reviewId = review.id; item.status = "in_review"; item.updatedAt = new Date().toISOString(); }
  _save();
  return { ok: true, review };
}

function addReviewFinding(reviewId, { finding, severity = "medium", reviewerId } = {}) {
  _s();
  const review = _state.reviews.find(r => r.id === reviewId);
  if (!review) return { ok: false, error: "Review not found" };
  review.findings.push({ finding, severity, reviewerId, timestamp: new Date().toISOString() });
  _save();
  return { ok: true, review };
}

function closeReview(reviewId, { status = "approved", reviewerId } = {}) {
  _s();
  const review = _state.reviews.find(r => r.id === reviewId);
  if (!review) return { ok: false, error: "Review not found" };
  review.status     = status;
  review.resolvedAt = new Date().toISOString();
  if (reviewerId) {
    const k = _kpi(reviewerId);
    k.reviewsCompleted++;
    k.updatedAt = new Date().toISOString();
  }
  const item = _state.workItems.find(w => w.id === review.workItemId);
  if (item && status === "approved") { item.status = "approved"; item.updatedAt = new Date().toISOString(); }
  else if (item && status === "rejected") { item.status = "in_progress"; item.updatedAt = new Date().toISOString(); }
  _save();
  return { ok: true, review };
}

function listReviews({ status, workItemId, type } = {}) {
  _s();
  let list = _state.reviews;
  if (status)     list = list.filter(r => r.status === status);
  if (workItemId) list = list.filter(r => r.workItemId === workItemId);
  if (type)       list = list.filter(r => r.type === type);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENGINEERING MEMORY
// ═══════════════════════════════════════════════════════════════════════════════

function addMemory({ engineerId, type, title, detail, workItemId, tags = [] } = {}) {
  if (!engineerId || !title) return { ok: false, error: "engineerId + title required" };
  _loadState();
  const entry = {
    id:         _id("mem"),
    engineerId, type: type || "lesson", title, detail: detail || "",
    workItemId: workItemId || null,
    tags, timestamp: new Date().toISOString(),
  };
  _memory.push(entry);
  _kpi(engineerId).memoryEntries++;
  _kpi(engineerId).updatedAt = new Date().toISOString();
  _save();
  return { ok: true, entry };
}

function getMemory({ engineerId, type, limit = 50 } = {}) {
  _loadState();
  let list = _memory;
  if (engineerId) list = list.filter(m => m.engineerId === engineerId);
  if (type)       list = list.filter(m => m.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// KPIs
// ═══════════════════════════════════════════════════════════════════════════════

function getKpi(engineerId) { return _kpi(engineerId); }

function getAllKpis() {
  _loadState();
  return Object.values(_kpis);
}

function updateKpi(engineerId, patch) {
  const k = _kpi(engineerId);
  Object.assign(k, patch, { updatedAt: new Date().toISOString() });
  _save();
  return k;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD DATA
// ═══════════════════════════════════════════════════════════════════════════════

function getDashboard() {
  _s();
  const items = _state.workItems;
  const velocity = Object.values(_kpis).reduce((s, k) => s + (k.velocity || 0), 0);
  const avgQuality = Object.values(_kpis).length
    ? Math.round(Object.values(_kpis).reduce((s, k) => s + (k.qualityScore || 100), 0) / Object.values(_kpis).length)
    : 100;

  return {
    updatedAt:   new Date().toISOString(),
    objectives:  { total: _state.objectives.length, active: _state.objectives.filter(o => o.status === "active").length },
    epics:       { total: _state.epics.length, inProgress: _state.epics.filter(e => e.status === "in_progress").length },
    workItems: {
      total:       items.length,
      planned:     items.filter(w => w.status === "planned").length,
      ready:       items.filter(w => w.status === "ready").length,
      claimed:     items.filter(w => w.status === "claimed").length,
      inProgress:  items.filter(w => w.status === "in_progress").length,
      blocked:     items.filter(w => w.status === "blocked").length,
      inReview:    items.filter(w => ["in_review", "in_qa", "in_security_review"].includes(w.status)).length,
      approved:    items.filter(w => w.status === "approved").length,
      deploying:   items.filter(w => w.status === "deploying").length,
      done:        items.filter(w => w.status === "done").length,
    },
    blockers:    { active: _state.blockers.filter(b => !b.resolvedAt).length },
    handoffs:    { pending: _state.handoffs.filter(h => h.accepted === null).length },
    approvals:   { pending: _state.approvals.filter(a => a.status === "pending").length },
    reviews:     { open: _state.reviews.filter(r => r.status === "open").length },
    velocity,
    avgQualityScore: avgQuality,
    ownership:   Object.keys(_state.ownership).length,
  };
}

function getOwnership() { _s(); return _state.ownership; }

// ── Utility ───────────────────────────────────────────────────────────────────
function _currentQuarter() {
  const d = new Date();
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q}-${d.getFullYear()}`;
}

function currentQuarter() { return _currentQuarter(); }

module.exports = {
  // Objectives
  createObjective, listObjectives, updateObjective,
  // Epics
  createEpic, listEpics, updateEpic,
  // Work items
  createWorkItem, getWorkItem, listWorkItems, updateWorkItem,
  // Backlogs
  getBacklog, addToBacklog, removeFromBacklog, claimWorkItem,
  // Blockers
  raiseBlocker, resolveBlocker, listBlockers,
  // Handoffs
  createHandoff, acceptHandoff, listHandoffs,
  // Approvals
  requestApproval, recordApprovalDecision, listApprovals,
  // Reviews
  createReview, addReviewFinding, closeReview, listReviews,
  // Memory
  addMemory, getMemory,
  // KPIs
  getKpi, getAllKpis, updateKpi,
  // Dashboard
  getDashboard, getOwnership, currentQuarter,
};
