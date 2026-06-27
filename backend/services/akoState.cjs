"use strict";
/**
 * Autonomous Knowledge Organization — State Layer (LEVEL 4)
 *
 * Persistent store at data/ako/ — does NOT duplicate existing memory systems.
 * Wraps and indexes into: semanticMemorySearch, knowledgeGraph, engineeringMemoryEngine,
 * continuousLearningEngine, memoryPersistenceLayer, missionMemory.
 *
 * Stored here: objectives, knowledge items (with confidence/source/validation),
 * per-dept KPIs, playbooks, contradictions, department memory, reports, work queue.
 *
 * Knowledge item types: document, code, api, decision, lesson, playbook, market,
 *   competitive, policy, product, customer, engineering, business, prompt, model, observation
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/ako");
const FILES = {
  state:    path.join(DATA_DIR, "state.json"),
  kpis:     path.join(DATA_DIR, "kpis.json"),
  memory:   path.join(DATA_DIR, "memory.json"),
  reports:  path.join(DATA_DIR, "reports.json"),
};

// ── Lazy service accessors ────────────────────────────────────────────────────
function _sm()   { try { return require("./semanticMemorySearch.cjs");         } catch { return null; } }
function _kg()   { try { return require("./knowledgeGraph.cjs");               } catch { return null; } }
function _em()   { try { return require("./engineeringMemoryEngine.cjs");       } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");      } catch { return null; } }
function _mpl()  { try { return require("./memoryPersistenceLayer.cjs");        } catch { return null; } }
function _mmi()  { try { return require("./memoryIntelligenceEngine.cjs");      } catch { return null; } }
function _mi()   { try { return require("./memoryIntelligenceEngine.cjs");      } catch { return null; } }
function _gr()   { try { return require("./graphReasoningEngine.cjs");          } catch { return null; } }
function _lcs()  { try { return require("./largeContextCodeSearch.cjs");        } catch { return null; } }
function _err()  { try { return require("./engineeringRuleRegistry.cjs");       } catch { return null; } }

// ── Persistence ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  state: {
    objectives: [],
    items: [],       // knowledge items
    playbooks: [],
    contradictions: [],
    tasks: [],
    handoffs: [],
    blockers: [],
    ownership: {},
  },
  kpis: {},
  memory: [],
  reports: [],
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let _cache = {};
function _load(key) {
  if (_cache[key]) return _cache[key];
  try { _cache[key] = JSON.parse(fs.readFileSync(FILES[key], "utf8")); }
  catch { _cache[key] = JSON.parse(JSON.stringify(DEFAULTS[key])); }
  return _cache[key];
}
function _save(key) {
  try { fs.writeFileSync(FILES[key], JSON.stringify(_cache[key], null, 2)); } catch {}
}
function _s()  { return _load("state"); }
function _k()  { return _load("kpis");  }
function _m()  { return _load("memory"); }
function _r()  { return _load("reports"); }

function _saveAll() { ["state","kpis","memory","reports"].forEach(_save); }

// ── ID generators ─────────────────────────────────────────────────────────────
const _id = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

// ── KPI helpers ───────────────────────────────────────────────────────────────
function _kpi(deptId) {
  const k = _k();
  if (!k[deptId]) k[deptId] = {
    deptId,
    itemsCapured: 0, itemsValidated: 0, itemsRejected: 0,
    playbooksCreated: 0, contradictionsFound: 0, contradictionsResolved: 0,
    searchesServed: 0, graphEdgesAdded: 0, lessonsRecorded: 0,
    reportsGenerated: 0, memoryEntries: 0, tasksCompleted: 0,
    confidenceAvg: 0, qualityScore: 100,
  };
  return k[deptId];
}

// ── Quarter helper ────────────────────────────────────────────────────────────
function currentQuarter() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECTIVES
// ═══════════════════════════════════════════════════════════════════════════════

function createObjective({ title, deptId = "ako_cko", kpis = [], description = "" } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const s = _s();
  if (s.objectives.some(o => o.title === title && o.status === "active"))
    return { ok: false, error: "Duplicate objective" };
  const obj = { id: _id("aobj"), title, deptId, description, kpis, quarter: currentQuarter(), status: "active", createdAt: new Date().toISOString(), completedAt: null };
  s.objectives.push(obj);
  _save("state");
  return { ok: true, objective: obj };
}

function updateObjective(id, patch) {
  const obj = _s().objectives.find(o => o.id === id);
  if (!obj) return { ok: false, error: "Not found" };
  Object.assign(obj, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, objective: obj };
}

function listObjectives({ quarter, deptId, status } = {}) {
  let list = _s().objectives;
  if (quarter) list = list.filter(o => o.quarter === quarter);
  if (deptId)  list = list.filter(o => o.deptId === deptId);
  if (status)  list = list.filter(o => o.status === status);
  return list;
}

// ═══════════════════════════════════════════════════════════════════════════════
// KNOWLEDGE ITEMS
// ═══════════════════════════════════════════════════════════════════════════════

const VALID_TYPES = new Set([
  "document","code","api","decision","lesson","playbook","market",
  "competitive","policy","product","customer","engineering","business",
  "prompt","model","observation","rule","rca","benchmark"
]);

function createItem({
  title, content, type = "observation", source = "ako",
  deptId = "ako_coordinator", confidence = 70, tags = [],
  objectiveId, relatedItemIds = [], validateWith = null,
} = {}) {
  if (!title || !content) return { ok: false, error: "title and content required" };
  if (!VALID_TYPES.has(type)) return { ok: false, error: `Unknown type: ${type}` };

  // Duplicate detection: exact title+type
  const s = _s();
  const dup = s.items.find(i => i.title === title && i.type === type && i.status !== "rejected");
  if (dup) return { ok: false, error: "Duplicate knowledge item", existing: dup.id };

  const item = {
    id: _id("aki"), title, content, type, source, deptId,
    confidence: Math.max(0, Math.min(100, confidence)),
    tags, objectiveId, relatedItemIds,
    status: "pending", // pending → validated | rejected
    validatedAt: null, rejectedAt: null, rejectedReason: null,
    contradictions: [],
    graphNodeId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  s.items.push(item);

  // Index into semantic memory search
  try {
    _sm()?.saveTypedMemory(item.id, type, title, { content, source, confidence, tags }, deptId);
  } catch {}
  // Index into knowledge graph
  try {
    const nodeType = type === "engineering" ? "mission" : "knowledge";
    _kg()?.addEdge({ from: deptId, to: item.id, relation: "produced", fromType: "dept", toType: nodeType, meta: { title, type, confidence } });
    item.graphNodeId = item.id;
  } catch {}

  _kpi(deptId).itemsCapured++;
  _save("state");
  _save("kpis");
  return { ok: true, item };
}

function validateItem(id, { validatedBy = "ako_qa", confidence, notes } = {}) {
  const item = _s().items.find(i => i.id === id);
  if (!item) return { ok: false, error: "Not found" };
  if (confidence !== undefined) item.confidence = Math.max(0, Math.min(100, confidence));
  item.status = "validated";
  item.validatedAt = new Date().toISOString();
  item.validatedBy = validatedBy;
  if (notes) item.validationNotes = notes;
  _kpi(validatedBy).itemsValidated++;
  // Record as lesson in continuousLearningEngine
  try {
    _le()?.createLesson?.({ source: validatedBy, type: item.type, severity: "info",
      title: `Knowledge validated: ${item.title}`,
      detail: `Confidence: ${item.confidence}%, Source: ${item.source}`,
      tags: ["knowledge", item.type, ...(item.tags || [])],
    });
    _kpi(validatedBy).lessonsRecorded++;
  } catch {}
  _save("state");
  _save("kpis");
  return { ok: true, item };
}

function rejectItem(id, { rejectedBy = "ako_qa", reason = "Failed validation" } = {}) {
  const item = _s().items.find(i => i.id === id);
  if (!item) return { ok: false, error: "Not found" };
  item.status = "rejected";
  item.rejectedAt = new Date().toISOString();
  item.rejectedReason = reason;
  item.rejectedBy = rejectedBy;
  _kpi(rejectedBy).itemsRejected++;
  _save("state");
  _save("kpis");
  return { ok: true, item };
}

function getItem(id) { return _s().items.find(i => i.id === id) || null; }

function listItems({ type, deptId, status, tags, limit = 100 } = {}) {
  let list = _s().items;
  if (type)   list = list.filter(i => i.type === type);
  if (deptId) list = list.filter(i => i.deptId === deptId);
  if (status) list = list.filter(i => i.status === status);
  if (tags?.length) list = list.filter(i => tags.some(t => i.tags?.includes(t)));
  return list.slice(-limit).reverse();
}

// ── Semantic search (delegates to existing semanticMemorySearch) ──────────────
function searchItems(query, { limit = 20, type } = {}) {
  try {
    const results = _sm()?.semanticSearch?.(query, limit) || [];
    if (type) return results.filter(r => r.type === type);
    return results;
  } catch { return []; }
}

// ── Contradiction detection ───────────────────────────────────────────────────
function detectContradictions(itemId) {
  const item = _s().items.find(i => i.id === itemId);
  if (!item) return [];
  // Find items with same type+tags but very different confidence or conflicting content keywords
  const candidates = _s().items.filter(i =>
    i.id !== itemId && i.status !== "rejected" &&
    i.type === item.type &&
    i.tags?.some(t => item.tags?.includes(t))
  );
  const found = [];
  for (const c of candidates) {
    // Simple heuristic: if both reference same entity but confidence diverges >30 pts
    const confDiff = Math.abs((item.confidence || 70) - (c.confidence || 70));
    if (confDiff > 30) {
      found.push({ itemA: itemId, itemB: c.id, reason: `Confidence divergence: ${confDiff}pts`, severity: "warning" });
    }
  }
  if (found.length > 0) {
    _s().contradictions.push(...found);
    _save("state");
  }
  return found;
}

function resolveContradiction(itemAId, itemBId, { resolution, keepId } = {}) {
  const s = _s();
  s.contradictions = s.contradictions.filter(c => !(c.itemA === itemAId && c.itemB === itemBId));
  if (keepId) {
    const discardId = keepId === itemAId ? itemBId : itemAId;
    rejectItem(discardId, { rejectedBy: "ako_qa", reason: `Contradiction resolved — kept ${keepId}` });
  }
  _save("state");
  return { ok: true, resolution };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAYBOOKS
// ═══════════════════════════════════════════════════════════════════════════════

function createPlaybook({ title, problem, solution, steps = [], type = "engineering", confidence = 80, source = "ako", tags = [], deptId = "ako_learning" } = {}) {
  if (!title || !solution) return { ok: false, error: "title and solution required" };
  const s = _s();
  if (s.playbooks.some(p => p.title === title)) return { ok: false, error: "Duplicate playbook" };
  const pb = { id: _id("akpb"), title, problem, solution, steps, type, confidence, source, deptId, tags, timesUsed: 0, createdAt: new Date().toISOString() };
  s.playbooks.push(pb);
  _kpi(deptId).playbooksCreated++;
  // Also ingest as a validated knowledge item
  createItem({ title, content: solution, type: "playbook", source, deptId, confidence, tags });
  // Record lesson
  try { _le()?.createLesson?.({ source: deptId, type: "playbook", severity: "info", title: `Playbook created: ${title}`, detail: solution?.slice(0,200), tags: ["playbook", type] }); } catch {}
  _save("state");
  _save("kpis");
  return { ok: true, playbook: pb };
}

function usePlaybook(id) {
  const pb = _s().playbooks.find(p => p.id === id);
  if (!pb) return { ok: false, error: "Not found" };
  pb.timesUsed++;
  pb.lastUsedAt = new Date().toISOString();
  _save("state");
  return { ok: true, playbook: pb };
}

function listPlaybooks({ type, tags, deptId, limit = 50 } = {}) {
  let list = _s().playbooks;
  if (type)   list = list.filter(p => p.type === type);
  if (deptId) list = list.filter(p => p.deptId === deptId);
  if (tags?.length) list = list.filter(p => tags.some(t => p.tags?.includes(t)));
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS (work queue)
// ═══════════════════════════════════════════════════════════════════════════════

function createTask({ title, description = "", deptId, type = "research", priority = "medium", objectiveId, itemId } = {}) {
  if (!title || !deptId) return { ok: false, error: "title and deptId required" };
  const task = { id: _id("aktsk"), title, description, deptId, type, priority, objectiveId, itemId, status: "planned", claimedBy: null, claimedAt: null, completedAt: null, createdAt: new Date().toISOString() };
  _s().tasks.push(task);
  _save("state");
  return { ok: true, task };
}

function claimTask(deptId, taskId) {
  const task = _s().tasks.find(t => t.id === taskId && ["planned","ready"].includes(t.status));
  if (!task) return { ok: false, error: "Task not claimable" };
  task.status = "in_progress";
  task.claimedBy = deptId;
  task.claimedAt = new Date().toISOString();
  _save("state");
  return { ok: true, task };
}

function completeTask(taskId, { completedBy, outcome } = {}) {
  const task = _s().tasks.find(t => t.id === taskId);
  if (!task) return { ok: false, error: "Not found" };
  task.status = "done";
  task.completedAt = new Date().toISOString();
  task.completedBy = completedBy || task.claimedBy;
  task.outcome = outcome;
  _kpi(task.deptId).tasksCompleted++;
  _save("state");
  _save("kpis");
  return { ok: true, task };
}

function getBacklog(deptId) {
  return _s().tasks.filter(t => t.deptId === deptId && ["planned","ready"].includes(t.status));
}

function listTasks({ deptId, status, type, limit = 100 } = {}) {
  let list = _s().tasks;
  if (deptId) list = list.filter(t => t.deptId === deptId);
  if (status) list = list.filter(t => t.status === status);
  if (type)   list = list.filter(t => t.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY, REPORTS, KPIs
// ═══════════════════════════════════════════════════════════════════════════════

function addMemory({ deptId, type, title, detail, tags = [], meta = {} } = {}) {
  if (!deptId || !title) return { ok: false, error: "deptId and title required" };
  const entry = { id: _id("akmem"), deptId, type, title, detail, tags, meta, createdAt: new Date().toISOString() };
  _m().push(entry);
  _kpi(deptId).memoryEntries++;
  _save("memory");
  _save("kpis");
  return { ok: true, entry };
}

function getMemory({ deptId, type, tags, limit = 50 } = {}) {
  let list = _m();
  if (deptId) list = list.filter(m => m.deptId === deptId);
  if (type)   list = list.filter(m => m.type === type);
  if (tags?.length) list = list.filter(m => tags.some(t => m.tags?.includes(t)));
  return list.slice(-limit).reverse();
}

function createReport({ title, deptId, type = "knowledge", data = {}, summary = "" } = {}) {
  if (!title || !deptId) return { ok: false, error: "title and deptId required" };
  const report = { id: _id("akrpt"), title, deptId, type, data, summary, createdAt: new Date().toISOString() };
  _r().push(report);
  _kpi(deptId).reportsGenerated++;
  _save("reports");
  _save("kpis");
  return { ok: true, report };
}

function listReports({ deptId, type, limit = 20 } = {}) {
  let list = _r();
  if (deptId) list = list.filter(r => r.deptId === deptId);
  if (type)   list = list.filter(r => r.type === type);
  return list.slice(-limit).reverse();
}

function getKpi(deptId)   { return _kpi(deptId); }
function getAllKpis()      { const k = _k(); return Object.values(k); }
function updateKpi(deptId, patch) {
  Object.assign(_kpi(deptId), patch);
  _save("kpis");
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function getDashboard() {
  const s    = _s();
  const kpis = getAllKpis();
  const items = s.items;
  const q     = currentQuarter();

  // Pull live stats from existing engines
  let emStats = null, kgStats = null, leStats = null;
  try { emStats = require("./engineeringMemoryEngine.cjs").getStatistics(); } catch {}
  try { kgStats = require("./knowledgeGraph.cjs").getStats();               } catch {}
  try { leStats = require("./continuousLearningEngine.cjs").getStats?.();   } catch {}

  return {
    quarter: q,
    objectives: {
      total: s.objectives.length,
      active: s.objectives.filter(o => o.status === "active").length,
    },
    knowledge: {
      total: items.length,
      validated: items.filter(i => i.status === "validated").length,
      pending: items.filter(i => i.status === "pending").length,
      rejected: items.filter(i => i.status === "rejected").length,
      byType: items.reduce((acc, i) => { acc[i.type] = (acc[i.type]||0)+1; return acc; }, {}),
      avgConfidence: items.length ? Math.round(items.reduce((s,i) => s+(i.confidence||0),0)/items.length) : 0,
    },
    playbooks: {
      total: s.playbooks.length,
      totalUses: s.playbooks.reduce((s,p) => s+(p.timesUsed||0),0),
    },
    contradictions: {
      open: s.contradictions.length,
    },
    tasks: {
      total: s.tasks.length,
      inProgress: s.tasks.filter(t => t.status === "in_progress").length,
      done: s.tasks.filter(t => t.status === "done").length,
    },
    reports: {
      total: _r().length,
    },
    platformKnowledge: {
      engineeringItems: emStats?.memorySources?.lessons || 0,
      graphEdges: kgStats?.totalEdges || 0,
      openLessons: leStats?.openRecommendations || 0,
    },
    kpiCount: kpis.length,
  };
}

// ── Graph utilities (delegates to existing knowledgeGraph + graphReasoningEngine) ──

function addKnowledgeEdge({ fromId, toId, relation = "relates_to", meta = {} } = {}) {
  try {
    _kg()?.addEdge({ from: fromId, to: toId, relation, fromType: "knowledge", toType: "knowledge", meta });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

function findRelated(query, limit = 10) {
  try { return _kg()?.findRelated?.(query, limit) || []; } catch { return []; }
}

function graphImpact(nodeId) {
  try { return _kg()?.impactAnalysis?.(nodeId) || {}; } catch { return {}; }
}

// ── Code knowledge extraction (delegates to largeContextCodeSearch) ───────────
function extractCodeKnowledge(query) {
  try {
    const results = _lcs()?.search?.(query, { maxFiles: 10 }) || [];
    return results.map(r => ({ file: r.file, snippet: r.content?.slice(0,300), score: r.score }));
  } catch { return []; }
}

// ── Rule-based knowledge (delegates to engineeringRuleRegistry) ───────────────
function extractRuleKnowledge() {
  try {
    const rules = _err()?.listRules?.() || [];
    return rules.map(r => ({ id: r.id, name: r.name, pattern: r.pattern, severity: r.severity, confidence: r.confidence }));
  } catch { return []; }
}

// ── Memory intelligence (delegates to memoryIntelligenceEngine) ──────────────
function runMemoryMaintenance() {
  try { return _mmi()?.runFullMaintenance?.() || {}; } catch { return {}; }
}

module.exports = {
  // Objectives
  createObjective, updateObjective, listObjectives,
  // Knowledge items
  createItem, validateItem, rejectItem, getItem, listItems, searchItems,
  detectContradictions, resolveContradiction,
  // Playbooks
  createPlaybook, usePlaybook, listPlaybooks,
  // Tasks
  createTask, claimTask, completeTask, getBacklog, listTasks,
  // Memory + reports + KPIs
  addMemory, getMemory, createReport, listReports,
  getKpi, getAllKpis, updateKpi,
  // Dashboard + graph utilities
  getDashboard, addKnowledgeEdge, findRelated, graphImpact,
  // Delegated to existing services
  extractCodeKnowledge, extractRuleKnowledge, runMemoryMaintenance,
  // Helpers
  currentQuarter, VALID_TYPES,
};
