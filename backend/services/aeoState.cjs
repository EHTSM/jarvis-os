"use strict";
/**
 * Autonomous Evolution Organization — State Layer (LEVEL 5)
 *
 * Persistent store at data/aeo/
 * Does NOT duplicate existing engines. Wraps:
 *   improvementLoopEngine  — trial apply/measure/keep/revert
 *   selfImprovementEngine  — pattern discovery, rule promotion
 *   selfHealingRuntime     — reliability probes + circuit breaks
 *   observabilityEngine    — metrics, alerts, logs
 *   enterpriseObservability— spans, system metrics
 *   engineeringSmellDetector — code smell scanning
 *   engineeringConfidenceEngine — confidence explanations
 *   costAnalytics          — cost tracking
 *   improvementLoop        — weekly report generation
 *
 * Stored here: objectives, evolutions (improvement proposals),
 * experiments, KPIs, tasks, memory, reports.
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/aeo");
const FILES = {
  state:   path.join(DATA_DIR, "state.json"),
  kpis:    path.join(DATA_DIR, "kpis.json"),
  memory:  path.join(DATA_DIR, "memory.json"),
  reports: path.join(DATA_DIR, "reports.json"),
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Lazy service accessors ────────────────────────────────────────────────────
function _ile()  { try { return require("./improvementLoopEngine.cjs");        } catch { return null; } }
function _sie()  { try { return require("./selfImprovementEngine.cjs");        } catch { return null; } }
function _shr()  { try { return require("./selfHealingRuntime.cjs");           } catch { return null; } }
function _obs()  { try { return require("./observabilityEngine.cjs");          } catch { return null; } }
function _ent()  { try { return require("./enterpriseObservability.cjs");      } catch { return null; } }
function _esd()  { try { return require("./engineeringSmellDetector.cjs");     } catch { return null; } }
function _ece()  { try { return require("./engineeringConfidenceEngine.cjs");  } catch { return null; } }
function _ca()   { try { return require("./costAnalytics.cjs");                } catch { return null; } }
function _il()   { try { return require("./improvementLoop.cjs");              } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");     } catch { return null; } }
function _em()   { try { return require("./engineeringMemoryEngine.cjs");      } catch { return null; } }
function _ako()  { try { return require("./akoState.cjs");                     } catch { return null; } }
function _akowf(){ try { return require("./akoWorkflow.cjs");                  } catch { return null; } }
function _bizSt(){ try { return require("./businessOrgState.cjs");             } catch { return null; } }
function _engSt(){ try { return require("./engineeringOrgState.cjs");          } catch { return null; } }
function _uxOpt(){ try { return require("./uxOptimizerService.cjs");           } catch { return null; } }
function _depa() { try { return require("./deploymentAutopilot.cjs");          } catch { return null; } }
function _bm()   { try { return require("./modelMarketplace.cjs");             } catch { return null; } }
function _ai()   { try { return require("./aiRegistry.cjs");                   } catch { return null; } }

// ── Persistence ───────────────────────────────────────────────────────────────
const DEFAULTS = {
  state: {
    objectives: [],
    evolutions: [],   // improvement proposals
    experiments: [],  // A/B trials via improvementLoopEngine
    tasks: [],
    history: [],      // applied evolutions with before/after
  },
  kpis: {},
  memory: [],
  reports: [],
};

let _cache = {};
function _load(key) {
  if (_cache[key]) return _cache[key];
  try { _cache[key] = JSON.parse(fs.readFileSync(FILES[key], "utf8")); }
  catch { _cache[key] = JSON.parse(JSON.stringify(DEFAULTS[key])); }
  return _cache[key];
}
function _save(key) { try { fs.writeFileSync(FILES[key], JSON.stringify(_cache[key], null, 2)); } catch {} }
function _s()  { return _load("state"); }
function _k()  { return _load("kpis"); }
function _m()  { return _load("memory"); }
function _r()  { return _load("reports"); }

// ── Helpers ───────────────────────────────────────────────────────────────────
const _id = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;

function currentQuarter() {
  const d = new Date();
  return `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function _kpi(deptId) {
  const k = _k();
  if (!k[deptId]) k[deptId] = {
    deptId,
    evolutionsProposed: 0, evolutionsApplied: 0, evolutionsReverted: 0, evolutionsKept: 0,
    experimentsRun: 0, weaknessesDetected: 0, improvementsValidated: 0,
    confidenceAvg: 0, impactScore: 0, tasksCompleted: 0, reportsGenerated: 0, memoryEntries: 0,
  };
  return k[deptId];
}

// ═══════════════════════════════════════════════════════════════════════════════
// OBJECTIVES
// ═══════════════════════════════════════════════════════════════════════════════

function createObjective({ title, deptId = "aeo_ceo", kpis = [], description = "" } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const s = _s();
  if (s.objectives.some(o => o.title === title && o.status === "active"))
    return { ok: false, error: "Duplicate objective" };
  const obj = { id: _id("aeobj"), title, deptId, description, kpis, quarter: currentQuarter(), status: "active", createdAt: new Date().toISOString() };
  s.objectives.push(obj);
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

function updateObjective(id, patch) {
  const obj = _s().objectives.find(o => o.id === id);
  if (!obj) return { ok: false, error: "Not found" };
  Object.assign(obj, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, objective: obj };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EVOLUTION PROPOSALS
// ═══════════════════════════════════════════════════════════════════════════════

const EVO_TYPES = ["capability","architecture","workflow","agent","prompt","model",
  "runtime","performance","cost","reliability","quality","security","ux","business",
  "knowledge","experiment","learning","self_assessment"];

function proposeEvolution({
  title, description, type = "capability", target, // target: "engineering"|"business"|"knowledge"|"odi"|"runtime"
  deptId = "aeo_ceo", confidence = 70, impact = 70,
  rollbackStrategy = "revert_state", objectiveId, tags = [],
} = {}) {
  if (!title || !description) return { ok: false, error: "title and description required" };
  if (!EVO_TYPES.includes(type)) return { ok: false, error: `Unknown type: ${type}` };
  const s = _s();
  if (s.evolutions.some(e => e.title === title && !["rejected","reverted"].includes(e.status)))
    return { ok: false, error: "Duplicate evolution proposal" };
  const evo = {
    id: _id("aevo"), title, description, type, target, deptId, confidence, impact,
    rollbackStrategy, objectiveId, tags,
    status: "proposed", // proposed → validated → approved → applied → measured → kept | reverted
    beforeMetrics: null, afterMetrics: null, impactMeasured: null,
    appliedAt: null, measuredAt: null, keptAt: null, revertedAt: null, revertedReason: null,
    experimentId: null, approvedBy: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  s.evolutions.push(evo);
  _kpi(deptId).evolutionsProposed++;
  _save("state");
  _save("kpis");
  return { ok: true, evolution: evo };
}

function updateEvolution(id, patch) {
  const evo = _s().evolutions.find(e => e.id === id);
  if (!evo) return { ok: false, error: "Not found" };
  Object.assign(evo, patch, { updatedAt: new Date().toISOString() });
  _save("state");
  return { ok: true, evolution: evo };
}

function getEvolution(id) { return _s().evolutions.find(e => e.id === id) || null; }

function listEvolutions({ type, status, target, deptId, limit = 100 } = {}) {
  let list = _s().evolutions;
  if (type)   list = list.filter(e => e.type === type);
  if (status) list = list.filter(e => e.status === status);
  if (target) list = list.filter(e => e.target === target);
  if (deptId) list = list.filter(e => e.deptId === deptId);
  return list.slice(-limit).reverse();
}

// ── Apply + Measure via improvementLoopEngine ─────────────────────────────────
function applyEvolution(id, { approvedBy = "aeo_coordinator", beforeMetrics = {} } = {}) {
  const evo = getEvolution(id);
  if (!evo) return { ok: false, error: "Not found" };
  if (!["validated","approved"].includes(evo.status)) return { ok: false, error: `Cannot apply evo in status: ${evo.status}` };
  // Record trial in improvementLoopEngine
  let trialId = null;
  try {
    const trial = _ile()?.apply?.({ name: evo.title, type: evo.type, payload: { evoId: id, description: evo.description, target: evo.target } });
    trialId = trial?.id;
    evo.experimentId = trialId;
  } catch {}
  // Capture before metrics
  evo.beforeMetrics = beforeMetrics;
  evo.status = "applied";
  evo.appliedAt = new Date().toISOString();
  evo.approvedBy = approvedBy;
  _kpi(evo.deptId).evolutionsApplied++;
  // Record to AKO brain
  try { _akowf()?.researchCapture?.({ title: `Evolution applied: ${evo.title}`, content: evo.description, type: "decision", source: "aeo", confidence: evo.confidence, tags: ["evolution","applied",evo.type] }); } catch {}
  _save("state");
  _save("kpis");
  return { ok: true, evolution: evo, trialId };
}

function measureEvolution(id, { afterMetrics = {} } = {}) {
  const evo = getEvolution(id);
  if (!evo || evo.status !== "applied") return { ok: false, error: "Must be in applied status" };
  const before = evo.beforeMetrics || {};
  evo.afterMetrics = afterMetrics;
  evo.measuredAt = new Date().toISOString();
  // Compute impact
  const keys = [...new Set([...Object.keys(before), ...Object.keys(afterMetrics)])];
  let totalDelta = 0, count = 0;
  for (const k of keys) {
    const b = Number(before[k]) || 0;
    const a = Number(afterMetrics[k]) || 0;
    if (b !== 0) { totalDelta += ((a - b) / Math.abs(b)) * 100; count++; }
  }
  evo.impactMeasured = count > 0 ? Math.round(totalDelta / count) : 0;
  evo.status = "measured";
  _save("state");
  return { ok: true, evolution: evo, impactMeasured: evo.impactMeasured };
}

function keepEvolution(id) {
  const evo = getEvolution(id);
  if (!evo || evo.status !== "measured") return { ok: false, error: "Must be measured first" };
  evo.status = "kept";
  evo.keptAt = new Date().toISOString();
  _kpi(evo.deptId).evolutionsKept++;
  _kpi("aeo_coordinator").impactScore += evo.impactMeasured || 0;
  // Keep in improvementLoopEngine
  if (evo.experimentId) { try { _ile()?.keep?.(evo.experimentId); } catch {} }
  // Persist to evolution history
  _s().history.push({ evoId: id, title: evo.title, type: evo.type, target: evo.target, keptAt: evo.keptAt, impactMeasured: evo.impactMeasured });
  // Feed to AKO
  try { _akowf()?.recordLesson?.({ title: `Evolution kept: ${evo.title}`, detail: `Impact: ${evo.impactMeasured}%`, type: evo.type, tags: ["evolution","kept"] }); } catch {}
  _save("state");
  _save("kpis");
  return { ok: true, evolution: evo };
}

function revertEvolution(id, { reason = "Did not improve metrics" } = {}) {
  const evo = getEvolution(id);
  if (!evo || !["applied","measured"].includes(evo.status)) return { ok: false, error: "Cannot revert in current status" };
  evo.status = "reverted";
  evo.revertedAt = new Date().toISOString();
  evo.revertedReason = reason;
  _kpi(evo.deptId).evolutionsReverted++;
  if (evo.experimentId) { try { _ile()?.revert?.(evo.experimentId); } catch {} }
  try { _akowf()?.researchCapture?.({ title: `Evolution reverted: ${evo.title}`, content: reason, type: "lesson", source: "aeo", confidence: 80, tags: ["evolution","reverted","lesson"] }); } catch {}
  _save("state");
  _save("kpis");
  return { ok: true, evolution: evo };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPERIMENTS (delegates to improvementLoopEngine)
// ═══════════════════════════════════════════════════════════════════════════════

function runExperiment({ name, type = "capability", payload = {}, deptId = "aeo_experimentation" } = {}) {
  if (!name) return { ok: false, error: "name required" };
  try {
    const trial = _ile()?.apply?.({ name, type, payload });
    if (!trial) return { ok: false, error: "improvementLoopEngine returned no trial" };
    const exp = { id: _id("aexp"), name, type, payload, deptId, trialId: trial.id, status: "running", startedAt: new Date().toISOString() };
    _s().experiments.push(exp);
    _kpi(deptId).experimentsRun++;
    _save("state");
    _save("kpis");
    return { ok: true, experiment: exp, trial };
  } catch (e) { return { ok: false, error: e.message }; }
}

function listExperiments({ status, type, limit = 50 } = {}) {
  let list = _s().experiments;
  if (status) list = list.filter(e => e.status === status);
  if (type)   list = list.filter(e => e.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════════════════════════════════════

function createTask({ title, description = "", deptId, type = "evolution", priority = "medium", objectiveId, evoId } = {}) {
  if (!title || !deptId) return { ok: false, error: "title and deptId required" };
  const task = { id: _id("aetsk"), title, description, deptId, type, priority, objectiveId, evoId, status: "planned", claimedBy: null, completedAt: null, createdAt: new Date().toISOString() };
  _s().tasks.push(task);
  _save("state");
  return { ok: true, task };
}

function claimTask(deptId, taskId) {
  const task = _s().tasks.find(t => t.id === taskId && ["planned","ready"].includes(t.status));
  if (!task) return { ok: false, error: "Task not claimable" };
  if (task.deptId && task.deptId !== deptId) return { ok: false, error: "Task belongs to another department" };
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

function getBacklog(deptId) { return _s().tasks.filter(t => t.deptId === deptId && ["planned","ready"].includes(t.status)); }

function listTasks({ deptId, status, type, limit = 100 } = {}) {
  let list = _s().tasks;
  if (deptId) list = list.filter(t => t.deptId === deptId);
  if (status) list = list.filter(t => t.status === status);
  if (type)   list = list.filter(t => t.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEMORY + REPORTS + KPIs
// ═══════════════════════════════════════════════════════════════════════════════

function addMemory({ deptId, type, title, detail, tags = [] } = {}) {
  if (!deptId || !title) return { ok: false, error: "deptId and title required" };
  const entry = { id: _id("aemem"), deptId, type, title, detail, tags, createdAt: new Date().toISOString() };
  _m().push(entry);
  _kpi(deptId).memoryEntries++;
  _save("memory");
  _save("kpis");
  return { ok: true, entry };
}

function getMemory({ deptId, type, limit = 50 } = {}) {
  let list = _m();
  if (deptId) list = list.filter(m => m.deptId === deptId);
  if (type)   list = list.filter(m => m.type === type);
  return list.slice(-limit).reverse();
}

function createReport({ title, deptId, type = "evolution", data = {}, summary = "" } = {}) {
  if (!title || !deptId) return { ok: false, error: "title and deptId required" };
  const report = { id: _id("aerpt"), title, deptId, type, data, summary, createdAt: new Date().toISOString() };
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

function listMemory(opts) { return getMemory(opts); }
function getHistory() { return _s().evolutions.filter(e => ["kept","reverted"].includes(e.status)); }

function getKpi(deptId)  { return _kpi(deptId); }
function getAllKpis()     { return Object.values(_k()); }
function updateKpi(deptId, patch) { Object.assign(_kpi(deptId), patch); _save("kpis"); }

// ═══════════════════════════════════════════════════════════════════════════════
// WEAKNESS DETECTION (aggregates across all 4 existing levels)
// ═══════════════════════════════════════════════════════════════════════════════

function detectWeaknesses() {
  const weaknesses = [];
  // 1. Engineering: smells
  try {
    const smells = _esd()?.scan?.() || [];
    for (const s of (Array.isArray(smells) ? smells : smells.smells || []).slice(0, 5)) {
      weaknesses.push({ source: "engineering_smells", title: s.title || s.type || "Code smell", severity: s.severity || "medium", detail: s.description || s.message || "" });
    }
  } catch {}
  // 2. Self-healing: recent failures
  try {
    const hist = _shr()?.getHistory?.() || [];
    const recent = hist.filter(h => h.result === "failed").slice(-3);
    for (const h of recent) {
      weaknesses.push({ source: "self_healing", title: `Heal failure: ${h.strategy || "unknown"}`, severity: "high", detail: `Task: ${h.taskId}, strategy: ${h.strategy}` });
    }
  } catch {}
  // 3. Learning: open recommendations
  try {
    const recs = _le()?.getRecommendations?.() || [];
    for (const r of recs.slice(0, 3)) {
      weaknesses.push({ source: "learning_engine", title: r.title || r.message || "Open recommendation", severity: r.severity || "medium", detail: r.description || "" });
    }
  } catch {}
  // 4. Business: low win rate
  try {
    const bizDash = _bizSt()?.getDashboard?.() || {};
    if (bizDash.pipeline?.winRate < 0.3) {
      weaknesses.push({ source: "business_org", title: `Win rate critically low: ${Math.round((bizDash.pipeline?.winRate||0)*100)}%`, severity: "critical", detail: "Pipeline needs attention" });
    }
  } catch {}
  // 5. Observability alerts
  try {
    const alerts = _obs()?.getAlerts?.() || {};
    for (const a of (alerts.active || []).slice(0, 3)) {
      weaknesses.push({ source: "observability", title: a.name || "Active alert", severity: a.severity || "high", detail: a.message || "" });
    }
  } catch {}
  return weaknesses;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function getDashboard() {
  const s    = _s();
  const kpis = getAllKpis();
  const evos = s.evolutions;
  let ileStats = {}, shrStatus = {};
  try { ileStats = _ile()?.getStats?.() || {}; } catch {}
  try { shrStatus = _shr()?.getStatus?.() || {}; } catch {}
  return {
    quarter: currentQuarter(),
    objectives: { total: s.objectives.length, active: s.objectives.filter(o => o.status === "active").length },
    evolutions: {
      total: evos.length,
      proposed: evos.filter(e => e.status === "proposed").length,
      validated: evos.filter(e => e.status === "validated").length,
      applied: evos.filter(e => e.status === "applied").length,
      kept: evos.filter(e => e.status === "kept").length,
      reverted: evos.filter(e => e.status === "reverted").length,
      avgImpact: evos.filter(e => e.impactMeasured !== null).length
        ? Math.round(evos.filter(e => e.impactMeasured !== null).reduce((s,e) => s+(e.impactMeasured||0), 0) / evos.filter(e => e.impactMeasured !== null).length)
        : 0,
    },
    experiments: { total: s.experiments.length, running: s.experiments.filter(e => e.status === "running").length },
    tasks: { total: s.tasks.length, inProgress: s.tasks.filter(t => t.status === "in_progress").length, done: s.tasks.filter(t => t.status === "done").length },
    history: { total: s.history.length },
    reports: { total: _r().length },
    platform: {
      ileTrials: ileStats.total || 0,
      ileKept: ileStats.kept || 0,
      shrHealed: shrStatus.healedTotal || 0,
    },
    kpiCount: kpis.length,
  };
}

module.exports = {
  // Objectives
  createObjective, listObjectives, updateObjective,
  // Evolutions
  proposeEvolution, updateEvolution, getEvolution, listEvolutions,
  applyEvolution, measureEvolution, keepEvolution, revertEvolution,
  // Experiments
  runExperiment, listExperiments,
  // Tasks
  createTask, claimTask, completeTask, getBacklog, listTasks,
  // Memory + Reports + KPIs
  addMemory, getMemory, listMemory, createReport, listReports,
  getHistory,
  getKpi, getAllKpis, updateKpi,
  // Weakness detection
  detectWeaknesses,
  // Dashboard
  getDashboard,
  // Helpers
  currentQuarter, EVO_TYPES,
};
