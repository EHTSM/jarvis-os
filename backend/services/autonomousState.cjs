"use strict";
/**
 * Autonomous Civilization — State (LEVEL 10)
 *
 * Persistent store for every autonomous action, decision, experiment,
 * evolution, and observation. Every record is traceable and explainable.
 *
 * Reuses (never duplicates) all lower-layer state — only READS from L1-9.
 * Owns exclusively: autonomous decisions, experiments, evolution timeline,
 * opportunity map, threat map, planning timeline, budget/resource optimizations,
 * global reporting, confidence dashboard, control center state.
 *
 * Storage: data/autonomous/ (10 JSON files)
 */

const fs   = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../data/autonomous");
const FILES = {
  decisions:    path.join(DATA_DIR, "decisions.json"),    // Autonomous Decision Ledger
  experiments:  path.join(DATA_DIR, "experiments.json"),  // Autonomous Experiment Ledger
  evolution:    path.join(DATA_DIR, "evolution.json"),    // Evolution Timeline + org lifecycle
  opportunities:path.join(DATA_DIR, "opportunities.json"),// Global Opportunity Map
  threats:      path.join(DATA_DIR, "threats.json"),      // Global Threat Map
  planning:     path.join(DATA_DIR, "planning.json"),     // Global + Multi-Year Planning
  optimizations:path.join(DATA_DIR, "optimizations.json"),// Budget + Resource Optimizations
  loop:         path.join(DATA_DIR, "loop.json"),         // Loop state + cycle history
  reports:      path.join(DATA_DIR, "reports.json"),      // Global Autonomous Reports
  control:      path.join(DATA_DIR, "control.json"),      // Control Center state
};

// ── Lazy accessors to all lower layers ────────────────────────────────────────
function _civSt()  { try { return require("./civilizationState.cjs");    } catch { return null; } }
function _civWf()  { try { return require("./civilizationWorkflow.cjs"); } catch { return null; } }
function _ecoSt()  { try { return require("./ecosystemState.cjs");       } catch { return null; } }
function _ecoWf()  { try { return require("./ecosystemWorkflow.cjs");    } catch { return null; } }
function _entSt()  { try { return require("./enterpriseState.cjs");      } catch { return null; } }
function _eosSt()  { try { return require("./executiveState.cjs");       } catch { return null; } }
function _eosWf()  { try { return require("./executiveWorkflow.cjs");    } catch { return null; } }
function _le()     { try { return require("./continuousLearningEngine.cjs"); } catch { return null; } }
function _rca()    { try { return require("./rootCauseAnalysisEngine.cjs"); } catch { return null; } }
function _em()     { try { return require("./engineeringMemoryEngine.cjs"); } catch { return null; } }
function _bus()    { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _sup()    { try { return require("./agentRuntimeSupervisor.cjs"); } catch { return null; } }

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  decisions:    { ledger: [], totalDecisions: 0 },
  experiments:  { ledger: [], totalExperiments: 0 },
  evolution:    { timeline: [], orgLifecycle: [], totalEvolutions: 0 },
  opportunities:{ map: [], discovered: 0, acted: 0 },
  threats:      { map: [], detected: 0, mitigated: 0 },
  planning:     { globalPlan: null, multiYearPlan: null, schedule: [], cycles: 0 },
  optimizations:{ budget: [], resources: [], capabilities: [] },
  loop:         { running: false, cycle: 0, lastCycleAt: null, history: [], errors: [] },
  reports:      { reports: [], totalReports: 0 },
  control:      {
    mode: "active",          // active | paused | recovery
    autonomyLevel: 1.0,      // 0-1, how autonomous decisions are
    confidenceThreshold: 0.6,// minimum confidence to act
    epoch: 1,
    startedAt: null, lastHealthAt: null,
    globalHealth: 100, layerHealth: {},
  },
};

const _cache = {};
function _load(key) {
  if (!_cache[key]) {
    try { _cache[key] = JSON.parse(fs.readFileSync(FILES[key], "utf8")); }
    catch { _cache[key] = JSON.parse(JSON.stringify(DEFAULTS[key])); }
  }
  return _cache[key];
}
function _save(key) {
  try { fs.writeFileSync(FILES[key], JSON.stringify(_cache[key], null, 2)); } catch {}
}

const _dec = () => _load("decisions");
const _exp = () => _load("experiments");
const _evo = () => _load("evolution");
const _opp = () => _load("opportunities");
const _thr = () => _load("threats");
const _pln = () => _load("planning");
const _opt = () => _load("optimizations");
const _lp  = () => _load("loop");
const _rep = () => _load("reports");
const _ctl = () => _load("control");

const _id  = pfx => `${pfx}_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
const _now = () => new Date().toISOString();

// ═══════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS DECISION LEDGER — every decision traceable + explainable
// ═══════════════════════════════════════════════════════════════════════════════

const DECISION_TYPES = ["observe","detect","plan","simulate","validate","execute","measure","learn","evolve","recover","audit"];

function recordDecision({ type, title, rationale, confidence = 0.7, expectedImpact = {}, layer = "civilization", domain = "general", data = {}, reversible = true, approved = true } = {}) {
  if (!type || !title || !rationale) return { ok: false, error: "type, title, rationale required" };
  const decision = {
    id: _id("adec"), type, title, rationale, confidence,
    expectedImpact, actualImpact: null, layer, domain, data,
    reversible, approved, status: "pending",
    lessons: [], outcome: null,
    decidedAt: _now(), executedAt: null, measuredAt: null,
  };
  const d = _dec();
  d.ledger.push(decision);
  d.totalDecisions++;
  if (d.ledger.length > 5000) d.ledger.splice(0, d.ledger.length - 5000);
  _save("decisions");
  try { _bus()?.emit("autonomous:decision:recorded", { id: decision.id, type, title, confidence, layer }); } catch {}
  return { ok: true, decision };
}

function resolveDecision(id, { outcome, actualImpact = {}, lessons = [] } = {}) {
  const d = _dec().ledger.find(x => x.id === id);
  if (!d) return { ok: false, error: "Decision not found" };
  d.outcome = outcome; d.actualImpact = actualImpact; d.lessons = lessons;
  d.status = outcome === "success" ? "succeeded" : outcome === "failed" ? "failed" : "completed";
  d.measuredAt = _now();
  _save("decisions");
  // Feed lessons into L4 learning engine
  if (lessons.length > 0) {
    try { _le()?.addLesson?.({ type: "autonomous_decision", title: d.title, source: "autonomous_loop", confidence: d.confidence, tags: ["autonomous","level10",d.domain] }); } catch {}
  }
  return { ok: true, decision: d };
}

function listDecisions({ type, status, layer, domain, minConfidence, limit = 50 } = {}) {
  let list = _dec().ledger;
  if (type)          list = list.filter(d => d.type === type);
  if (status)        list = list.filter(d => d.status === status);
  if (layer)         list = list.filter(d => d.layer === layer);
  if (domain)        list = list.filter(d => d.domain === domain);
  if (minConfidence) list = list.filter(d => d.confidence >= minConfidence);
  return list.slice(-limit).reverse();
}

function getDecision(id) { return _dec().ledger.find(d => d.id === id) || null; }
function getDecisionStats() {
  const l = _dec().ledger;
  const total = l.length;
  const byType = {}; const byStatus = {};
  l.forEach(d => { byType[d.type] = (byType[d.type]||0)+1; byStatus[d.status] = (byStatus[d.status]||0)+1; });
  const avgConf = total > 0 ? Math.round(l.reduce((a,d)=>a+d.confidence,0)/total*100)/100 : 0;
  return { total: _dec().totalDecisions, inLedger: total, byType, byStatus, avgConfidence: avgConf };
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS EXPERIMENT LEDGER — reversible experiments with outcomes
// ═══════════════════════════════════════════════════════════════════════════════

const EXPERIMENT_TYPES = ["capability","process","resource","organization","strategy","innovation","recovery"];

function createExperiment({ title, hypothesis, type = "process", domain = "general", layer = "civilization", targetLayer, changes = [], expectedOutcome = "", rollbackPlan = "", confidence = 0.6 } = {}) {
  if (!title || !hypothesis) return { ok: false, error: "title and hypothesis required" };
  const experiment = {
    id: _id("aexp"), title, hypothesis, type, domain, layer, targetLayer: targetLayer || layer,
    changes, expectedOutcome, rollbackPlan, confidence,
    status: "designed", // designed → running → measuring → completed/rolled_back
    observations: [], measurements: {}, outcome: null,
    rationale: hypothesis, actualOutcome: null, lessons: [],
    designedAt: _now(), startedAt: null, completedAt: null,
  };
  const e = _exp();
  e.ledger.push(experiment);
  e.totalExperiments++;
  if (e.ledger.length > 2000) e.ledger.splice(0, e.ledger.length - 2000);
  _save("experiments");
  return { ok: true, experiment };
}

function startExperiment(id) {
  const exp = _exp().ledger.find(e => e.id === id);
  if (!exp) return { ok: false, error: "Experiment not found" };
  if (exp.status !== "designed") return { ok: false, error: "Can only start designed experiments" };
  exp.status = "running"; exp.startedAt = _now();
  _save("experiments");
  recordDecision({ type: "execute", title: `Start experiment: ${exp.title}`, rationale: exp.hypothesis, confidence: exp.confidence, layer: exp.layer, domain: exp.domain, reversible: true });
  return { ok: true, experiment: exp };
}

function addExperimentObservation(id, { observation, metric, value, source = "autonomous" } = {}) {
  const exp = _exp().ledger.find(e => e.id === id);
  if (!exp) return { ok: false, error: "Experiment not found" };
  exp.observations.push({ observation, metric, value, source, at: _now() });
  if (metric) exp.measurements[metric] = value;
  _save("experiments");
  return { ok: true, experiment: exp };
}

function concludeExperiment(id, { outcome, actualOutcome = "", lessons = [], rollback = false } = {}) {
  const exp = _exp().ledger.find(e => e.id === id);
  if (!exp) return { ok: false, error: "Experiment not found" };
  exp.outcome = outcome; exp.actualOutcome = actualOutcome; exp.lessons = lessons;
  exp.status = rollback ? "rolled_back" : "completed";
  exp.completedAt = _now();
  _save("experiments");
  if (lessons.length) try { _le()?.addLesson?.({ type: "experiment_outcome", title: exp.title, source: "autonomous_experiment", confidence: exp.confidence, tags: ["experiment","level10",exp.domain] }); } catch {}
  return { ok: true, experiment: exp };
}

function listExperiments({ type, status, domain, limit = 50 } = {}) {
  let list = _exp().ledger;
  if (type)   list = list.filter(e => e.type === type);
  if (status) list = list.filter(e => e.status === status);
  if (domain) list = list.filter(e => e.domain === domain);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS EVOLUTION TIMELINE — org creation, retirement, capability evolution
// ═══════════════════════════════════════════════════════════════════════════════

function recordEvolution({ type, title, description = "", targetDomain, targetLayer, change, rationale, confidence = 0.7, impact = "medium", measuredBy = [], reversible = true } = {}) {
  if (!type || !title || !change || !rationale) return { ok: false, error: "type, title, change, rationale required" };
  const evo = {
    id: _id("aevo"), type, title, description, targetDomain, targetLayer, change, rationale,
    confidence, impact, measuredBy, reversible,
    status: "proposed", outcome: null, measuredImpact: null,
    proposedAt: _now(), implementedAt: null, measuredAt: null,
  };
  const e = _evo();
  e.timeline.push(evo);
  e.totalEvolutions++;
  if (e.timeline.length > 3000) e.timeline.splice(0, e.timeline.length - 3000);
  _save("evolution");
  try { _civSt()?.proposeEvolution?.({ title, description, proposerId: "autonomous_system", targetDomain: targetDomain || "general", change, rationale, priority: impact === "high" ? "high" : "medium" }); } catch {}
  try { _bus()?.emit("autonomous:evolution:proposed", { id: evo.id, type, title, targetDomain }); } catch {}
  return { ok: true, evolution: evo };
}

function implementEvolution(id, { outcome = "success", measuredImpact = {} } = {}) {
  const evo = _evo().timeline.find(e => e.id === id);
  if (!evo) return { ok: false, error: "Evolution not found" };
  evo.status = "implemented"; evo.outcome = outcome; evo.measuredImpact = measuredImpact;
  evo.implementedAt = _now();
  _save("evolution");
  return { ok: true, evolution: evo };
}

function recordOrgLifecycle({ action, orgId, orgName, orgType, reason, confidence = 0.8, reversible = true } = {}) {
  if (!action || !orgName) return { ok: false, error: "action and orgName required" };
  const event = { id: _id("aorg"), action, orgId, orgName, orgType, reason, confidence, reversible, at: _now() };
  _evo().orgLifecycle.push(event);
  _save("evolution");
  return { ok: true, event };
}

function listEvolution({ type, status, targetDomain, limit = 50 } = {}) {
  let list = _evo().timeline;
  if (type)         list = list.filter(e => e.type === type);
  if (status)       list = list.filter(e => e.status === status);
  if (targetDomain) list = list.filter(e => e.targetDomain === targetDomain);
  return list.slice(-limit).reverse();
}

function listOrgLifecycle({ action, limit = 50 } = {}) {
  let list = _evo().orgLifecycle;
  if (action) list = list.filter(e => e.action === action);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPPORTUNITY MAP — discovered opportunities with action tracking
// ═══════════════════════════════════════════════════════════════════════════════

function discoverOpportunity({ title, description = "", source, domain = "general", layer = "civilization", estimatedValue = 0, confidence = 0.7, expiresAt = null, data = {} } = {}) {
  if (!title || !source) return { ok: false, error: "title and source required" };
  const opp = {
    id: _id("aopp"), title, description, source, domain, layer,
    estimatedValue, confidence, expiresAt, data,
    status: "open", priority: estimatedValue > 1000 ? "high" : estimatedValue > 100 ? "medium" : "low",
    actionTaken: null, outcome: null,
    discoveredAt: _now(), actedAt: null,
  };
  const o = _opp();
  o.map.push(opp);
  o.discovered++;
  if (o.map.length > 2000) o.map.splice(0, o.map.length - 2000);
  _save("opportunities");
  try { _bus()?.emit("autonomous:opportunity:discovered", { id: opp.id, title, domain, estimatedValue }); } catch {}
  return { ok: true, opportunity: opp };
}

function actOnOpportunity(id, { action, decisionId } = {}) {
  const opp = _opp().map.find(o => o.id === id);
  if (!opp) return { ok: false, error: "Opportunity not found" };
  opp.actionTaken = action; opp.status = "acted"; opp.actedAt = _now(); opp.decisionId = decisionId;
  _opp().acted++;
  _save("opportunities");
  return { ok: true, opportunity: opp };
}

function closeOpportunity(id, { outcome, actualValue = 0 } = {}) {
  const opp = _opp().map.find(o => o.id === id);
  if (!opp) return { ok: false, error: "Opportunity not found" };
  opp.outcome = outcome; opp.actualValue = actualValue; opp.status = "closed";
  _save("opportunities");
  return { ok: true, opportunity: opp };
}

function listOpportunities({ status, domain, layer, priority, limit = 50 } = {}) {
  let list = _opp().map;
  if (status)   list = list.filter(o => o.status === status);
  if (domain)   list = list.filter(o => o.domain === domain);
  if (layer)    list = list.filter(o => o.layer === layer);
  if (priority) list = list.filter(o => o.priority === priority);
  return list.sort((a,b)=>b.confidence-a.confidence).slice(0,limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// THREAT MAP — detected threats with mitigation tracking
// ═══════════════════════════════════════════════════════════════════════════════

const THREAT_LEVELS = ["low","medium","high","critical"];

function detectThreat({ title, description = "", source, domain = "general", layer = "civilization", severity = "medium", confidence = 0.7, affectedSystems = [], data = {} } = {}) {
  if (!title || !source) return { ok: false, error: "title and source required" };
  const threat = {
    id: _id("athr"), title, description, source, domain, layer,
    severity, confidence, affectedSystems, data,
    status: "open", mitigationPlan: null, mitigationDecisionId: null,
    detectedAt: _now(), mitigatedAt: null,
  };
  const t = _thr();
  t.map.push(threat);
  t.detected++;
  if (t.map.length > 2000) t.map.splice(0, t.map.length - 2000);
  _save("threats");
  try { _bus()?.emit("autonomous:threat:detected", { id: threat.id, title, severity, domain }); } catch {}
  return { ok: true, threat };
}

function mitigateThreat(id, { plan, decisionId, outcome } = {}) {
  const threat = _thr().map.find(t => t.id === id);
  if (!threat) return { ok: false, error: "Threat not found" };
  threat.mitigationPlan = plan; threat.mitigationDecisionId = decisionId;
  threat.status = outcome ? "mitigated" : "in_mitigation";
  if (outcome) { threat.mitigatedAt = _now(); _thr().mitigated++; }
  _save("threats");
  return { ok: true, threat };
}

function listThreats({ status, severity, domain, layer, limit = 50 } = {}) {
  let list = _thr().map;
  if (status)   list = list.filter(t => t.status === status);
  if (severity) list = list.filter(t => t.severity === severity);
  if (domain)   list = list.filter(t => t.domain === domain);
  if (layer)    list = list.filter(t => t.layer === layer);
  return list.sort((a,b) => THREAT_LEVELS.indexOf(b.severity) - THREAT_LEVELS.indexOf(a.severity)).slice(0,limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL PLANNING — strategic plans + multi-year plans + schedule
// ═══════════════════════════════════════════════════════════════════════════════

function createGlobalPlan({ title, objective, horizon = "1y", priorities = [], layers = [], confidence = 0.7, generatedBy = "autonomous" } = {}) {
  if (!title || !objective) return { ok: false, error: "title and objective required" };
  const plan = {
    id: _id("apln"), title, objective, horizon, priorities, layers,
    confidence, generatedBy,
    status: "active", cycle: _lp().cycle,
    outcomes: [], revision: 0,
    createdAt: _now(), updatedAt: _now(),
  };
  _pln().globalPlan = plan;
  _pln().cycles++;
  _save("planning");
  return { ok: true, plan };
}

function createMultiYearPlan({ title, years = 3, phases = [], milestones = [], objective = "", confidence = 0.65 } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const plan = {
    id: _id("amyp"), title, years, phases, milestones, objective, confidence,
    status: "active", progress: 0,
    createdAt: _now(), updatedAt: _now(),
  };
  _pln().multiYearPlan = plan;
  _save("planning");
  return { ok: true, plan };
}

function scheduleAction({ title, scheduledFor, type, priority = "medium", domain = "general", layer = "civilization", decisionId, confidence = 0.7 } = {}) {
  if (!title || !scheduledFor) return { ok: false, error: "title and scheduledFor required" };
  const action = {
    id: _id("asch"), title, scheduledFor, type: type || "execute", priority, domain, layer, decisionId, confidence,
    status: "scheduled", executedAt: null, outcome: null,
    scheduledAt: _now(),
  };
  _pln().schedule.push(action);
  if (_pln().schedule.length > 5000) _pln().schedule.splice(0, _pln().schedule.length - 5000);
  _save("planning");
  return { ok: true, action };
}

function executeDueActions() {
  const now = new Date();
  const due = _pln().schedule.filter(a => a.status === "scheduled" && new Date(a.scheduledFor) <= now);
  for (const a of due) { a.status = "executed"; a.executedAt = _now(); }
  if (due.length > 0) _save("planning");
  return { executed: due.length, actions: due };
}

function getGlobalPlan()     { return _pln().globalPlan; }
function getMultiYearPlan()  { return _pln().multiYearPlan; }
function getSchedule({ status, limit = 100 } = {}) {
  let list = _pln().schedule;
  if (status) list = list.filter(a => a.status === status);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS OPTIMIZATIONS — budget + resource + capability
// ═══════════════════════════════════════════════════════════════════════════════

function recordBudgetOptimization({ domain, layer, action, amountSaved = 0, rationale, confidence = 0.7 } = {}) {
  if (!domain || !action || !rationale) return { ok: false, error: "domain, action, rationale required" };
  const opt = { id: _id("abopt"), domain, layer, action, amountSaved, rationale, confidence, recordedAt: _now() };
  _opt().budget.push(opt);
  if (_opt().budget.length > 1000) _opt().budget.splice(0, _opt().budget.length - 1000);
  _save("optimizations");
  return { ok: true, optimization: opt };
}

function recordResourceOptimization({ resourceType, action, amountOptimized = 0, domain, rationale, confidence = 0.7 } = {}) {
  const opt = { id: _id("aropt"), resourceType, action, amountOptimized, domain, rationale, confidence, recordedAt: _now() };
  _opt().resources.push(opt);
  if (_opt().resources.length > 1000) _opt().resources.splice(0, _opt().resources.length - 1000);
  _save("optimizations");
  return { ok: true, optimization: opt };
}

function recordCapabilityEvolution({ capability, action, domain, rationale, confidence = 0.7, impact = "medium" } = {}) {
  const opt = { id: _id("acevo"), capability, action, domain, rationale, confidence, impact, recordedAt: _now() };
  _opt().capabilities.push(opt);
  _save("optimizations");
  return { ok: true, optimization: opt };
}

function listOptimizations({ type, domain, limit = 50 } = {}) {
  const all = [
    ..._opt().budget.map(o => ({...o, optimizationType: "budget"})),
    ..._opt().resources.map(o => ({...o, optimizationType: "resource"})),
    ..._opt().capabilities.map(o => ({...o, optimizationType: "capability"})),
  ];
  let list = all.sort((a,b) => new Date(b.recordedAt) - new Date(a.recordedAt));
  if (type)   list = list.filter(o => o.optimizationType === type);
  if (domain) list = list.filter(o => o.domain === domain);
  return list.slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════════
// LOOP STATE — cycle tracking + history
// ═══════════════════════════════════════════════════════════════════════════════

function getLoopState() { return _lp(); }

function startCycle() {
  const lp = _lp();
  lp.running = true;
  lp.cycle++;
  lp.lastCycleAt = _now();
  _save("loop");
  return { cycle: lp.cycle };
}

function endCycle({ summary = "", health = 100, decisionsThisCycle = 0, opportunitiesFound = 0, threatsFound = 0, error = null } = {}) {
  const lp = _lp();
  lp.running = false;
  const record = {
    cycle: lp.cycle, summary, health, decisionsThisCycle, opportunitiesFound, threatsFound,
    error, at: _now(),
  };
  lp.history.push(record);
  if (lp.history.length > 1000) lp.history.splice(0, lp.history.length - 1000);
  if (error) lp.errors.push({ cycle: lp.cycle, error, at: _now() });
  if (lp.errors.length > 200) lp.errors.splice(0, lp.errors.length - 200);
  _save("loop");
  return { ok: true, record };
}

function getCycleHistory({ limit = 20 } = {}) { return _lp().history.slice(-limit).reverse(); }

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL AUTONOMOUS REPORTS
// ═══════════════════════════════════════════════════════════════════════════════

function createAutonomousReport({ title, type = "cycle", cycle, summary, data = {}, confidence = 0.8 } = {}) {
  if (!title) return { ok: false, error: "title required" };
  const report = {
    id: _id("arpt"), title, type, cycle: cycle || _lp().cycle, summary, data, confidence,
    createdAt: _now(),
  };
  const r = _rep();
  r.reports.push(report);
  r.totalReports++;
  if (r.reports.length > 1000) r.reports.splice(0, r.reports.length - 1000);
  _save("reports");
  return { ok: true, report };
}

function listAutonomousReports({ type, limit = 20 } = {}) {
  let list = _rep().reports;
  if (type) list = list.filter(r => r.type === type);
  return list.slice(-limit).reverse();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTROL CENTER STATE
// ═══════════════════════════════════════════════════════════════════════════════

function getControlState() { return _ctl(); }

function updateControlState(patch) {
  Object.assign(_ctl(), patch, { lastHealthAt: _now() });
  _save("control");
  return { ok: true, control: _ctl() };
}

function setMode(mode) {
  if (!["active","paused","recovery"].includes(mode)) return { ok: false, error: "mode must be active/paused/recovery" };
  _ctl().mode = mode;
  _save("control");
  try { _bus()?.emit("autonomous:mode:changed", { mode }); } catch {}
  return { ok: true, mode };
}

function setAutonomyLevel(level) {
  const clamped = Math.min(1, Math.max(0, level));
  _ctl().autonomyLevel = clamped;
  _save("control");
  return { ok: true, autonomyLevel: clamped };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL HEALTH SNAPSHOT (reads from all 9 layers)
// ═══════════════════════════════════════════════════════════════════════════════

function getGlobalHealthSnapshot() {
  const layers = {};

  // L9 Civilization
  try { const h = _civSt()?.getCivilizationHealth?.(); layers.civilization = { score: h?.score ?? 70, alerts: h?.alerts?.length ?? 0 }; } catch { layers.civilization = { score: 70, alerts: 0 }; }
  // L8 Ecosystem
  try { const h = _ecoSt()?.getEcosystemHealth?.(); layers.ecosystem = { score: h?.score ?? 70 }; } catch { layers.ecosystem = { score: 70 }; }
  // L7 Enterprise
  try { const h = _entSt()?.getEnterpriseHealth?.(); layers.enterprise = { score: h?.score ?? 60 }; } catch { layers.enterprise = { score: 60 }; }
  // L6 Executive
  try { const h = _eosSt()?.getGlobalHealth?.(); layers.executive = { score: h?.score ?? 60 }; } catch { layers.executive = { score: 60 }; }
  // Runtime agents
  try { const agents = _sup()?.listAgents?.() || []; const running = agents.filter(a=>a.status==="running").length; layers.runtime = { total: agents.length, running, score: agents.length > 0 ? Math.round((running/agents.length)*100) : 100 }; } catch { layers.runtime = { score: 80 }; }

  const scores = Object.values(layers).map(l => l.score ?? 50);
  const globalScore = Math.min(100, Math.max(0, Math.round(scores.reduce((a,b)=>a+b,0)/scores.length)));

  const ctl = _ctl();
  ctl.globalHealth = globalScore;
  ctl.layerHealth = layers;
  ctl.lastHealthAt = _now();
  _save("control");

  return { score: globalScore, layers, openThreats: _thr().map.filter(t=>t.status==="open").length, openOpportunities: _opp().map.filter(o=>o.status==="open").length, cycle: _lp().cycle };
}

// ═══════════════════════════════════════════════════════════════════════════════
// GLOBAL AI OPERATING DASHBOARD (all dashboards aggregated)
// ═══════════════════════════════════════════════════════════════════════════════

function getGlobalDashboard() {
  const health = getGlobalHealthSnapshot();
  const civDb  = (() => { try { return _civSt()?.getCivilizationDashboard?.() || {}; } catch { return {}; } })();
  const ecoDb  = (() => { try { return _ecoSt()?.getEcosystemDashboard?.() || {};    } catch { return {}; } })();
  const decStats = getDecisionStats();

  return {
    autonomous: {
      mode:           _ctl().mode,
      autonomyLevel:  _ctl().autonomyLevel,
      confidenceThreshold: _ctl().confidenceThreshold,
      epoch:          _ctl().epoch,
      cycle:          _lp().cycle,
      running:        _lp().running,
      startedAt:      _ctl().startedAt,
    },
    health,
    decisions:    decStats,
    experiments: { total: _exp().totalExperiments, running: _exp().ledger.filter(e=>e.status==="running").length, completed: _exp().ledger.filter(e=>e.status==="completed").length, rolledBack: _exp().ledger.filter(e=>e.status==="rolled_back").length },
    evolution:   { total: _evo().totalEvolutions, proposed: _evo().timeline.filter(e=>e.status==="proposed").length, implemented: _evo().timeline.filter(e=>e.status==="implemented").length, orgCreations: _evo().orgLifecycle.filter(e=>e.action==="create").length, orgRetirements: _evo().orgLifecycle.filter(e=>e.action==="retire").length },
    opportunities:{ total: _opp().discovered, open: _opp().map.filter(o=>o.status==="open").length, acted: _opp().acted },
    threats:     { total: _thr().detected, open: _thr().map.filter(t=>t.status==="open").length, mitigated: _thr().mitigated },
    planning:    { globalPlan: _pln().globalPlan?.title, multiYearPlan: _pln().multiYearPlan?.title, scheduledActions: _pln().schedule.filter(a=>a.status==="scheduled").length },
    optimizations:{ budget: _opt().budget.length, resource: _opt().resources.length, capability: _opt().capabilities.length },
    reports:     { total: _rep().totalReports },
    civilization: civDb.civilization || {},
    ecosystem:    ecoDb.ecosystem || {},
    lastSync:     _now(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPLAINABILITY DASHBOARD — every decision chain traceable
// ═══════════════════════════════════════════════════════════════════════════════

function getExplainabilityDashboard({ decisionId } = {}) {
  if (decisionId) {
    const decision = getDecision(decisionId);
    if (!decision) return { ok: false, error: "Decision not found" };
    // Find related experiment
    const experiment = _exp().ledger.find(e => e.id === decision.data?.experimentId);
    // Find related opportunity
    const opportunity = decision.data?.opportunityId ? _opp().map.find(o => o.id === decision.data.opportunityId) : null;
    // Find related threat
    const threat = decision.data?.threatId ? _thr().map.find(t => t.id === decision.data.threatId) : null;
    return { ok: true, decision, experiment, opportunity, threat, explainability: { rationale: decision.rationale, confidence: decision.confidence, expectedImpact: decision.expectedImpact, actualImpact: decision.actualImpact, lessons: decision.lessons } };
  }
  // Summary explainability
  const recent = listDecisions({ limit: 10 });
  return {
    ok: true,
    recentDecisions: recent,
    avgConfidence: getDecisionStats().avgConfidence,
    explainedCount: recent.filter(d => d.rationale).length,
    measuredCount: recent.filter(d => d.actualImpact !== null).length,
    learnedCount: recent.filter(d => d.lessons?.length > 0).length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIDENCE DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════

function getConfidenceDashboard() {
  const decisions = _dec().ledger;
  const experiments = _exp().ledger;
  const evolutions = _evo().timeline;

  const byType = {};
  decisions.forEach(d => {
    if (!byType[d.type]) byType[d.type] = { count: 0, totalConf: 0, avgConf: 0 };
    byType[d.type].count++; byType[d.type].totalConf += d.confidence;
  });
  Object.values(byType).forEach(t => { t.avgConf = t.count > 0 ? Math.round(t.totalConf/t.count*100)/100 : 0; });

  const overall = decisions.length > 0 ? Math.round(decisions.reduce((a,d)=>a+d.confidence,0)/decisions.length*100)/100 : 0;
  const threshold = _ctl().confidenceThreshold;
  const belowThreshold = decisions.filter(d => d.confidence < threshold).length;

  return {
    overall, threshold, belowThreshold,
    byDecisionType: byType,
    experimentConfidence: experiments.length > 0 ? Math.round(experiments.reduce((a,e)=>a+e.confidence,0)/experiments.length*100)/100 : 0,
    evolutionConfidence: evolutions.length > 0 ? Math.round(evolutions.reduce((a,e)=>a+e.confidence,0)/evolutions.length*100)/100 : 0,
    highConfidence: decisions.filter(d=>d.confidence>=0.8).length,
    mediumConfidence: decisions.filter(d=>d.confidence>=0.6&&d.confidence<0.8).length,
    lowConfidence: decisions.filter(d=>d.confidence<0.6).length,
  };
}

module.exports = {
  // Decision Ledger
  recordDecision, resolveDecision, listDecisions, getDecision, getDecisionStats,
  DECISION_TYPES,
  // Experiment Ledger
  createExperiment, startExperiment, addExperimentObservation, concludeExperiment, listExperiments,
  EXPERIMENT_TYPES,
  // Evolution Timeline
  recordEvolution, implementEvolution, recordOrgLifecycle, listEvolution, listOrgLifecycle,
  // Opportunity Map
  discoverOpportunity, actOnOpportunity, closeOpportunity, listOpportunities,
  // Threat Map
  detectThreat, mitigateThreat, listThreats, THREAT_LEVELS,
  // Planning
  createGlobalPlan, createMultiYearPlan, scheduleAction, executeDueActions,
  getGlobalPlan, getMultiYearPlan, getSchedule,
  // Optimizations
  recordBudgetOptimization, recordResourceOptimization, recordCapabilityEvolution, listOptimizations,
  // Loop State
  getLoopState, startCycle, endCycle, getCycleHistory,
  // Reports
  createAutonomousReport, listAutonomousReports,
  // Control
  getControlState, updateControlState, setMode, setAutonomyLevel,
  // Global views
  getGlobalHealthSnapshot, getGlobalDashboard, getExplainabilityDashboard, getConfidenceDashboard,
};
