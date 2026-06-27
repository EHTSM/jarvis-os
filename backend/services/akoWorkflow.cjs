"use strict";
/**
 * Autonomous Knowledge Organization — Workflow Layer (LEVEL 4)
 *
 * 9-step event-driven cascade via runtimeEventBus (no polling):
 *
 * 1. CKO creates quarterly knowledge objective   → ako:objective:created
 * 2. Research captures observations/docs/code    → ako:knowledge:captured
 * 3. Validation engine scores + validates items  → ako:knowledge:validated | ako:knowledge:rejected
 * 4. Knowledge Graph indexes relationships       → ako:graph:indexed
 * 5. Memory Department stores to platform memory → ako:memory:stored
 * 6. Retrieval caches + confirms searchability   → ako:knowledge:searchable
 * 7. Decision support generates playbooks        → ako:playbook:created
 * 8. Learning engine records lessons             → ako:lesson:recorded
 * 9. Coordinator syncs all depts + reports       → ako:coordinator:sync
 *
 * All reuses existing: semanticMemorySearch, knowledgeGraph,
 * engineeringMemoryEngine, continuousLearningEngine, memoryPersistenceLayer,
 * graphReasoningEngine, largeContextCodeSearch, engineeringRuleRegistry,
 * missionMemory, runtimeEventBus
 */

// ── Lazy service accessors ────────────────────────────────────────────────────
function _bus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _orch() { try { return require("./missionOrchestrator.cjs");                } catch { return null; } }
function _st()   { return require("./akoState.cjs"); }
function _em()   { try { return require("./engineeringMemoryEngine.cjs");             } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");            } catch { return null; } }
function _sm()   { try { return require("./semanticMemorySearch.cjs");               } catch { return null; } }
function _kg()   { try { return require("./knowledgeGraph.cjs");                     } catch { return null; } }
function _gr()   { try { return require("./graphReasoningEngine.cjs");               } catch { return null; } }
function _mpl()  { try { return require("./memoryPersistenceLayer.cjs");              } catch { return null; } }
function _mi()   { try { return require("./memoryIntelligenceEngine.cjs");            } catch { return null; } }
function _mm()   { try { return require("./missionMemory.cjs");                       } catch { return null; } }
function _lcs()  { try { return require("./largeContextCodeSearch.cjs");              } catch { return null; } }
function _err()  { try { return require("./engineeringRuleRegistry.cjs");             } catch { return null; } }
function _bi()   { try { return require("./businessIntelligenceEngine.cjs");          } catch { return null; } }
function _engSt(){ try { return require("./engineeringOrgState.cjs");                 } catch { return null; } }
function _bizSt(){ try { return require("./businessOrgState.cjs");                    } catch { return null; } }
function _ai()   { try { return require("./aiRegistry.cjs");                          } catch { return null; } }
function _gos()  { try { return require("./growthOS.cjs");                            } catch { return null; } }

// ── Utilities ─────────────────────────────────────────────────────────────────
function _emit(type, payload) {
  try { _bus()?.emit(type, { ...payload, ts: new Date().toISOString() }); } catch {}
}

function _missionExists(prefix) {
  try {
    const all = _mm()?.listMissions({ limit: 300 }) || { missions: [] };
    return (all.missions || []).some(m =>
      ["active","pending","planned"].includes(m.status) &&
      m.objective?.slice(0,50) === prefix?.slice(0,50)
    );
  } catch { return false; }
}

function _createMission(spec, agentId) {
  if (_missionExists(spec.objective)) return null;
  try { return _orch()?.createManual({ ...spec, metadata: { ...spec.metadata, autoCreatedBy: agentId } }); }
  catch { return null; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — CKO creates quarterly knowledge objective
// ═══════════════════════════════════════════════════════════════════════════════

function ckoCreateObjective({ title, description = "", kpis = ["items_captured","playbooks","lessons"] } = {}) {
  if (!title) return null;
  const r = _st().createObjective({ title, deptId: "ako_cko", kpis, description });
  if (!r.ok) return null;
  _emit("ako:objective:created", { objectiveId: r.objective.id, title, kpis });
  return r.objective;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Research: capture knowledge from various sources
// ═══════════════════════════════════════════════════════════════════════════════

function researchCapture({ title, content, type = "observation", source = "research", confidence = 70, tags = [], objectiveId } = {}) {
  if (!title || !content) return null;
  const r = _st().createItem({ title, content, type, source, deptId: "ako_research", confidence, tags, objectiveId });
  if (!r.ok) return null;
  _emit("ako:knowledge:captured", { itemId: r.item.id, type, title, source, confidence, objectiveId });
  return r.item;
}

// Pull knowledge from engineering memory engine
function captureEngineeringKnowledge(objectiveId) {
  const captured = [];
  try {
    const stats = _em()?.getStatistics?.() || {};
    const items = [
      { title: `Engineering: ${stats.memorySources?.lessons || 0} lessons in memory`, content: JSON.stringify(stats.memorySources || {}), type: "engineering", confidence: 95 },
      { title: `Engineering: ${stats.memorySources?.rcas || 0} root cause analyses`, content: JSON.stringify(stats.engineHealth || {}), type: "engineering", confidence: 90 },
    ];
    for (const item of items) {
      const r = researchCapture({ ...item, objectiveId, source: "engineeringMemoryEngine", tags: ["engineering","memory"] });
      if (r) captured.push(r);
    }
  } catch {}
  return captured;
}

// Pull knowledge from business organization
function captureBusinessKnowledge(objectiveId) {
  const captured = [];
  try {
    const dash = _bizSt()?.getDashboard?.() || {};
    const r = researchCapture({
      title: `Business: MRR=$${dash.revenue?.mrr || 0}, ${dash.pipeline?.total || 0} deals in pipeline`,
      content: JSON.stringify({ mrr: dash.revenue?.mrr, arr: dash.revenue?.arr, winRate: dash.pipeline?.winRate, leads: dash.leads?.total }),
      type: "business", confidence: 90, objectiveId,
      source: "businessOrgState", tags: ["business","revenue","pipeline"],
    });
    if (r) captured.push(r);
  } catch {}
  return captured;
}

// Pull knowledge from AI registry
function captureAIKnowledge(objectiveId) {
  const captured = [];
  try {
    const providers = _ai()?.getAll?.() || [];
    for (const p of providers.slice(0, 3)) {
      const r = researchCapture({
        title: `AI Model: ${p.name || p.id} — capabilities: ${(p.capabilities||[]).join(",")}`,
        content: JSON.stringify({ id: p.id, type: p.type, capabilities: p.capabilities }),
        type: "model", confidence: 95, objectiveId,
        source: "aiRegistry", tags: ["ai","model"],
      });
      if (r) captured.push(r);
    }
  } catch {}
  return captured;
}

// Pull engineering rules
function captureRuleKnowledge(objectiveId) {
  const captured = [];
  try {
    const rules = _err()?.listRules?.() || [];
    for (const rule of rules.slice(0, 5)) {
      const r = researchCapture({
        title: `Engineering Rule: ${rule.name || rule.id}`,
        content: `Pattern: ${rule.pattern || "N/A"}. Description: ${rule.description || ""}. Severity: ${rule.severity || "medium"}`,
        type: "rule", confidence: rule.confidence || 85, objectiveId,
        source: "engineeringRuleRegistry", tags: ["engineering","rule"],
      });
      if (r) captured.push(r);
    }
  } catch {}
  return captured;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Validation
// ═══════════════════════════════════════════════════════════════════════════════

function validateKnowledge(itemId, { confidence, notes } = {}) {
  const r = _st().validateItem(itemId, { validatedBy: "ako_qa", confidence, notes });
  if (!r.ok) return r;
  // Contradiction check post-validation
  const contradictions = _st().detectContradictions(itemId);
  if (contradictions.length > 0) {
    _emit("ako:contradiction:detected", { itemId, count: contradictions.length, contradictions });
  }
  _emit("ako:knowledge:validated", { itemId, confidence: r.item.confidence, type: r.item.type });
  return r;
}

function rejectKnowledge(itemId, reason) {
  const r = _st().rejectItem(itemId, { rejectedBy: "ako_qa", reason });
  if (r.ok) _emit("ako:knowledge:rejected", { itemId, reason });
  return r;
}

// Auto-validate pending items above threshold
function autoValidatePending(minConfidence = 65) {
  const pending = _st().listItems({ status: "pending" });
  const results = { validated: 0, rejected: 0 };
  for (const item of pending) {
    if ((item.confidence || 70) >= minConfidence) {
      validateKnowledge(item.id, { confidence: item.confidence });
      results.validated++;
    } else {
      rejectKnowledge(item.id, `Auto-rejected: confidence ${item.confidence}% below threshold ${minConfidence}%`);
      results.rejected++;
    }
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Knowledge Graph indexing
// ═══════════════════════════════════════════════════════════════════════════════

function indexKnowledgeGraph(itemId) {
  const item = _st().getItem(itemId);
  if (!item || item.status !== "validated") return { ok: false, error: "Item not validated" };
  // Link to related items via kg
  let edgesAdded = 0;
  try {
    // Connect to other items with same type
    const related = _st().listItems({ type: item.type, status: "validated" })
      .filter(i => i.id !== itemId).slice(0, 5);
    for (const r of related) {
      _st().addKnowledgeEdge({ fromId: itemId, toId: r.id, relation: "same_type", meta: { type: item.type } });
      edgesAdded++;
    }
    // Connect to same-tag items
    if (item.tags?.length) {
      const tagRelated = _st().listItems({ tags: item.tags, status: "validated" }).filter(i => i.id !== itemId).slice(0, 3);
      for (const r of tagRelated) {
        _st().addKnowledgeEdge({ fromId: itemId, toId: r.id, relation: "shares_tag", meta: { tags: item.tags } });
        edgesAdded++;
      }
    }
    _st().updateKpi("ako_graph", { graphEdgesAdded: (_st().getKpi("ako_graph").graphEdgesAdded || 0) + edgesAdded });
  } catch {}
  _emit("ako:graph:indexed", { itemId, edgesAdded, type: item.type });
  return { ok: true, itemId, edgesAdded };
}

// Run graph reasoning to detect gaps and clusters
function analyzeKnowledgeGraph() {
  try {
    const gaps    = _kg()?.getStats?.() || {};
    const health  = _gr()?.getHealthScore?.() || null;
    return { gaps, health };
  } catch { return {}; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Memory storage
// ═══════════════════════════════════════════════════════════════════════════════

function storeToMemory(itemId) {
  const item = _st().getItem(itemId);
  if (!item) return { ok: false, error: "Item not found" };
  // Store to platform memory persistence layer
  try {
    _mpl()?.save?.(item.id, {
      type: item.type, title: item.title, content: item.content,
      source: item.source, confidence: item.confidence, tags: item.tags,
    });
  } catch {}
  // Store to engineering memory if engineering type
  if (["engineering","code","rule","rca"].includes(item.type)) {
    try {
      _em()?.remember?.({
        type: item.type, title: item.title, content: item.content,
        confidence: item.confidence, tags: item.tags, source: item.source,
      });
    } catch {}
  }
  // AKO dept memory
  _st().addMemory({ deptId: "ako_memory", type: "stored", title: item.title, detail: `type=${item.type} confidence=${item.confidence}`, tags: item.tags });
  _emit("ako:memory:stored", { itemId, type: item.type, title: item.title });
  return { ok: true, itemId };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Retrieval: confirm searchability
// ═══════════════════════════════════════════════════════════════════════════════

function confirmSearchable(itemId) {
  const item = _st().getItem(itemId);
  if (!item) return { ok: false };
  // Verify semantic search can find it
  try {
    const results = _sm()?.semanticSearch?.(item.title, 5) || [];
    const found = results.some(r => r.nodeId === itemId || r.id === itemId || r.title === item.title);
    _st().updateKpi("ako_retrieval", { searchesServed: (_st().getKpi("ako_retrieval").searchesServed || 0) + 1 });
    _emit("ako:knowledge:searchable", { itemId, found, title: item.title });
    return { ok: true, found };
  } catch { return { ok: true, found: false }; }
}

function retrieveKnowledge(query, { limit = 20, type } = {}) {
  _st().updateKpi("ako_retrieval", { searchesServed: (_st().getKpi("ako_retrieval").searchesServed || 0) + 1 });
  return _st().searchItems(query, { limit, type });
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Decision support: auto-create playbooks from patterns
// ═══════════════════════════════════════════════════════════════════════════════

function generatePlaybook({ problem, type = "engineering" } = {}) {
  if (!problem) return null;
  // Look for existing knowledge on this problem
  const related = _st().searchItems(problem, { limit: 5 });
  if (!related.length) return null;

  // Build solution from top knowledge items
  const solution = related.map(r => `• ${r.title}: ${(r.content || "").slice(0, 120)}`).join("\n");
  const title    = `Playbook: ${problem.slice(0, 80)}`;
  const confidence = Math.round(related.reduce((s, r) => s + (r.confidence || 70), 0) / related.length);
  const tags     = [...new Set(related.flatMap(r => r.tags || []))].slice(0, 8);

  const r = _st().createPlaybook({ title, problem, solution, type, confidence, source: "ako_decision", tags, deptId: "ako_decision" });
  if (!r.ok) return null;
  _emit("ako:playbook:created", { playbookId: r.playbook.id, title, type, confidence });
  return r.playbook;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8 — Learning: record lessons from validated knowledge
// ═══════════════════════════════════════════════════════════════════════════════

function recordLesson({ title, detail, type = "knowledge", severity = "info", tags = [] } = {}) {
  try {
    const r = _le()?.createLesson?.({ source: "ako_learning", type, severity, title, detail, tags: ["ako", ...tags] });
    _st().updateKpi("ako_learning", { lessonsRecorded: (_st().getKpi("ako_learning").lessonsRecorded || 0) + 1 });
    _emit("ako:lesson:recorded", { type, title, severity });
    return r;
  } catch { return null; }
}

function syncEngineeringLessons(objectiveId) {
  const lessons = [];
  try {
    const all = _le()?.getLessons?.({ limit: 10 }) || [];
    for (const lesson of all.filter(l => l.source !== "ako_learning").slice(0, 5)) {
      const item = researchCapture({
        title: `Lesson: ${lesson.title}`,
        content: lesson.detail || lesson.description || lesson.title,
        type: "lesson", confidence: 85, objectiveId,
        source: lesson.source || "continuousLearningEngine", tags: ["lesson", ...(lesson.tags || [])],
      });
      if (item) lessons.push(item);
    }
  } catch {}
  return lessons;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9 — Coordinator sync
// ═══════════════════════════════════════════════════════════════════════════════

function coordinatorSync() {
  const dash    = _st().getDashboard();
  const kpis    = _st().getAllKpis();
  const pending = _st().listItems({ status: "pending" }).length;

  // Auto-validate any pending items
  if (pending > 0) {
    const autoResult = autoValidatePending(65);
    _st().addMemory({ deptId: "ako_coordinator", type: "auto_validate", title: `Auto-validated ${autoResult.validated}, rejected ${autoResult.rejected} items`, detail: `Pending was: ${pending}` });
  }

  // Generate coordinator report
  const totalItems = kpis.reduce((s, k) => s + (k.itemsCapured || 0), 0);
  const totalLessons = kpis.reduce((s, k) => s + (k.lessonsRecorded || 0), 0);
  _st().createReport({
    title: `AKO Coordinator Sync — ${new Date().toISOString().slice(0,10)}`,
    deptId: "ako_coordinator", type: "sync",
    data: { dash, kpiSummary: { totalItems, totalLessons, playbooks: dash.playbooks?.total } },
    summary: `${dash.knowledge.total} items, ${dash.playbooks.total} playbooks, ${dash.platformKnowledge.engineeringItems} eng items`,
  });

  _emit("ako:coordinator:sync", { dashboard: dash, kpiSummary: { totalItems, totalLessons } });
  return { ok: true, dashboard: dash, pending, autoValidated: pending > 0 };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE: Observe → Research → Validate → Graph → Memory → Retrieve → Learn
// ═══════════════════════════════════════════════════════════════════════════════

async function runKnowledgePipeline({ title, content, type = "observation", source = "ako", confidence = 70, tags = [], objectiveId } = {}) {
  const steps = [];
  // 2. Capture
  const item = researchCapture({ title, content, type, source, confidence, tags, objectiveId });
  if (!item) return { ok: false, error: "Failed to capture knowledge" };
  steps.push({ step: "capture", itemId: item.id });
  // 3. Validate
  const vr = validateKnowledge(item.id, { confidence });
  steps.push({ step: "validate", ok: vr.ok, status: vr.item?.status });
  if (vr.item?.status !== "validated") return { ok: true, item, steps, skipped: "pipeline halted after reject" };
  // 4. Graph
  const gr = indexKnowledgeGraph(item.id);
  steps.push({ step: "graph", edgesAdded: gr.edgesAdded });
  // 5. Memory
  const mr = storeToMemory(item.id);
  steps.push({ step: "memory", ok: mr.ok });
  // 6. Retrieval
  const rr = confirmSearchable(item.id);
  steps.push({ step: "retrieval", found: rr.found });
  // 7. Decision support — try to build playbook from new item's tags
  if (tags.length > 0) {
    const pb = generatePlaybook({ problem: title, type });
    steps.push({ step: "playbook", created: !!pb, id: pb?.id });
  }
  // 8. Learning
  recordLesson({ title: `Knowledge pipeline: ${title}`, detail: `type=${type} confidence=${confidence} source=${source}`, type, tags });
  steps.push({ step: "lesson", recorded: true });
  return { ok: true, item, steps };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVENT SUBSCRIPTIONS
// ═══════════════════════════════════════════════════════════════════════════════

let _subscribed = false;

function subscribeWorkflowEvents() {
  if (_subscribed) return;
  _subscribed = true;
  const bus = _bus();
  if (!bus) return;

  // CKO creates operational tasks when objective is created
  bus.subscribe("ako:objective:created", async ({ objectiveId, title }) => {
    try {
      const tasks = [
        { title: `Research: capture engineering knowledge for ${title}`, type: "research",    deptId: "ako_research",    priority: "high"   },
        { title: `Research: capture business knowledge for ${title}`,    type: "research",    deptId: "ako_research",    priority: "high"   },
        { title: `Research: capture AI model knowledge for ${title}`,    type: "research",    deptId: "ako_ai_model",    priority: "medium" },
        { title: `Research: capture engineering rules for ${title}`,     type: "research",    deptId: "ako_engineering", priority: "medium" },
        { title: `Validate all pending items for objective ${title}`,    type: "validation",  deptId: "ako_qa",          priority: "high"   },
      ];
      for (const t of tasks) _st().createTask({ ...t, objectiveId });
      _emit("ako:tasks:created", { objectiveId, count: tasks.length });
    } catch {}
  });

  // Research captures → auto-validate
  bus.subscribe("ako:knowledge:captured", async ({ itemId, confidence }) => {
    try {
      if ((confidence || 70) >= 65) {
        setTimeout(() => validateKnowledge(itemId, { confidence }), 50);
      }
    } catch {}
  });

  // On validation → index graph + store memory + confirm searchable
  bus.subscribe("ako:knowledge:validated", async ({ itemId }) => {
    try {
      setTimeout(() => {
        indexKnowledgeGraph(itemId);
        storeToMemory(itemId);
        confirmSearchable(itemId);
      }, 100);
    } catch {}
  });

  // On graph indexed → learning step
  bus.subscribe("ako:graph:indexed", async ({ itemId }) => {
    try {
      const item = _st().getItem(itemId);
      if (item) recordLesson({ title: `Graph indexed: ${item.title}`, detail: `type=${item.type}`, type: item.type, tags: item.tags || [] });
    } catch {}
  });

  // On engineering events — cross-org knowledge capture
  bus.subscribe("engorg:work:completed", async ({ workItemId, domain, engineerId }) => {
    try {
      researchCapture({
        title: `Engineering completed: ${domain} work item ${workItemId}`,
        content: `Domain: ${domain}, Engineer: ${engineerId}, completed at ${new Date().toISOString()}`,
        type: "engineering", source: "engineeringOrg", confidence: 80,
        tags: ["engineering", domain || "general"],
      });
    } catch {}
  });

  // On business events — cross-org knowledge capture
  bus.subscribe("bizorg:deal:won", async ({ dealId, company, value }) => {
    try {
      researchCapture({
        title: `Business win: ${company} — $${value}`,
        content: `Company: ${company}, Deal: ${dealId}, Value: $${value}, Won: ${new Date().toISOString()}`,
        type: "business", source: "businessOrg", confidence: 90,
        tags: ["business","deal","win"],
      });
    } catch {}
  });

  // On ODI design events — design knowledge
  bus.subscribe("odi:patch:applied", async ({ patchId, description }) => {
    try {
      researchCapture({
        title: `Design patch: ${description || patchId}`,
        content: `Patch ${patchId} applied to UI. Description: ${description || "N/A"}`,
        type: "product", source: "odi", confidence: 85,
        tags: ["design","odi","patch"],
      });
    } catch {}
  });

  // Mission completion → knowledge capture
  bus.subscribe("mission:completed", async ({ missionId, objective }) => {
    try {
      if (!objective) return;
      researchCapture({
        title: `Mission completed: ${objective?.slice(0,80)}`,
        content: `Mission ${missionId} completed. Objective: ${objective}`,
        type: "decision", source: "missionSystem", confidence: 75,
        tags: ["mission","decision"],
      });
    } catch {}
  });
}

module.exports = {
  // Step functions
  ckoCreateObjective,
  researchCapture, captureEngineeringKnowledge, captureBusinessKnowledge,
  captureAIKnowledge, captureRuleKnowledge,
  validateKnowledge, rejectKnowledge, autoValidatePending,
  indexKnowledgeGraph, analyzeKnowledgeGraph,
  storeToMemory, confirmSearchable, retrieveKnowledge,
  generatePlaybook,
  recordLesson, syncEngineeringLessons,
  coordinatorSync,
  // Full pipeline
  runKnowledgePipeline,
  // Event wiring
  subscribeWorkflowEvents,
};
