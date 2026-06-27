"use strict";
/**
 * Autonomous Evolution Organization — Workflow Layer (LEVEL 5)
 *
 * 9-step event-driven cascade via runtimeEventBus:
 *
 * 1. CEO creates quarterly evolution objective  → aeo:objective:created
 * 2. Observe: detect weaknesses across all orgs → aeo:weakness:detected
 * 3. Analyze: generate improvement proposals    → aeo:evolution:proposed
 * 4. Validate: score confidence + impact        → aeo:evolution:validated
 * 5. Simulate: run experiment trial             → aeo:experiment:run
 * 6. Approve: coordinator approves high-impact  → aeo:evolution:approved
 * 7. Apply: apply to target org/runtime         → aeo:evolution:applied
 * 8. Measure: before/after metric comparison    → aeo:evolution:measured
 * 9. Learn: record lesson, update AKO, notify  → aeo:evolution:learned
 *
 * Reuses: improvementLoopEngine, selfImprovementEngine, selfHealingRuntime,
 *   observabilityEngine, enterpriseObservability, engineeringSmellDetector,
 *   engineeringConfidenceEngine, continuousLearningEngine, engineeringMemoryEngine,
 *   akoWorkflow, businessOrgState, engineeringOrgState, costAnalytics,
 *   uxOptimizerService, deploymentAutopilot, improvementLoop, modelMarketplace
 */

function _bus()  { try { return require("../../agents/runtime/runtimeEventBus.cjs"); } catch { return null; } }
function _orch() { try { return require("./missionOrchestrator.cjs");                } catch { return null; } }
function _mm()   { try { return require("./missionMemory.cjs");                      } catch { return null; } }
function _st()   { return require("./aeoState.cjs"); }
function _ile()  { try { return require("./improvementLoopEngine.cjs");              } catch { return null; } }
function _sie()  { try { return require("./selfImprovementEngine.cjs");              } catch { return null; } }
function _shr()  { try { return require("./selfHealingRuntime.cjs");                 } catch { return null; } }
function _obs()  { try { return require("./observabilityEngine.cjs");                } catch { return null; } }
function _ent()  { try { return require("./enterpriseObservability.cjs");            } catch { return null; } }
function _esd()  { try { return require("./engineeringSmellDetector.cjs");           } catch { return null; } }
function _ece()  { try { return require("./engineeringConfidenceEngine.cjs");        } catch { return null; } }
function _ca()   { try { return require("./costAnalytics.cjs");                      } catch { return null; } }
function _il()   { try { return require("./improvementLoop.cjs");                    } catch { return null; } }
function _le()   { try { return require("./continuousLearningEngine.cjs");           } catch { return null; } }
function _em()   { try { return require("./engineeringMemoryEngine.cjs");            } catch { return null; } }
function _akowf(){ try { return require("./akoWorkflow.cjs");                        } catch { return null; } }
function _akost(){ try { return require("./akoState.cjs");                           } catch { return null; } }
function _bizSt(){ try { return require("./businessOrgState.cjs");                   } catch { return null; } }
function _engSt(){ try { return require("./engineeringOrgState.cjs");                } catch { return null; } }
function _uxOpt(){ try { return require("./uxOptimizerService.cjs");                 } catch { return null; } }
function _depa() { try { return require("./deploymentAutopilot.cjs");                } catch { return null; } }
function _bm()   { try { return require("./modelMarketplace.cjs");                   } catch { return null; } }

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
// STEP 1 — CEO creates evolution objective
// ═══════════════════════════════════════════════════════════════════════════════

function ceoCreateObjective({ title, description = "", kpis = ["evolutions_kept","impact_score","weaknesses_resolved"] } = {}) {
  if (!title) return null;
  const r = _st().createObjective({ title, deptId: "aeo_ceo", kpis, description });
  if (!r.ok) return null;
  _emit("aeo:objective:created", { objectiveId: r.objective.id, title, kpis });
  return r.objective;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Observe: collect weaknesses from all orgs
// ═══════════════════════════════════════════════════════════════════════════════

function observeWeaknesses(objectiveId) {
  const weaknesses = _st().detectWeaknesses();
  for (const w of weaknesses) {
    _st().addMemory({ deptId: "aeo_self_assessment", type: "weakness", title: w.title, detail: `${w.source}: ${w.detail}`, tags: [w.source, w.severity] });
  }
  _st().updateKpi("aeo_self_assessment", { weaknessesDetected: (_st().getKpi("aeo_self_assessment").weaknessesDetected || 0) + weaknesses.length });
  if (weaknesses.length > 0) _emit("aeo:weakness:detected", { count: weaknesses.length, objectiveId, severity: weaknesses[0]?.severity });
  return weaknesses;
}

// Pull additional signals via selfImprovementEngine
function analyzePatterns() {
  const patterns = [];
  try {
    const r = _sie()?.analyzeRecentExecutions?.();
    if (r?.patterns) patterns.push(...r.patterns);
  } catch {}
  try {
    const changes = _sie()?.recommendArchitectureChanges?.();
    if (Array.isArray(changes)) {
      for (const c of changes.slice(0,3)) {
        patterns.push({ type: "architecture", title: c.title || c, description: c.description || String(c) });
      }
    }
  } catch {}
  return patterns;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Generate improvement proposals from weaknesses
// ═══════════════════════════════════════════════════════════════════════════════

function proposeFromWeakness(weakness, objectiveId) {
  const titleMap = {
    engineering_smells:  { type: "quality",       target: "engineering", confidence: 75, impact: 65 },
    self_healing:        { type: "reliability",    target: "runtime",     confidence: 80, impact: 70 },
    learning_engine:     { type: "learning",       target: "knowledge",   confidence: 72, impact: 60 },
    business_org:        { type: "business",       target: "business",    confidence: 78, impact: 80 },
    observability:       { type: "runtime",        target: "runtime",     confidence: 85, impact: 75 },
  };
  const meta = titleMap[weakness.source] || { type: "capability", target: "runtime", confidence: 70, impact: 65 };
  const r = _st().proposeEvolution({
    title: `Improve: ${weakness.title}`,
    description: `Weakness detected by ${weakness.source}: ${weakness.detail || weakness.title}. Propose targeted improvement.`,
    type: meta.type, target: meta.target,
    deptId: `aeo_${meta.type}`,
    confidence: meta.confidence + (weakness.severity === "critical" ? 10 : weakness.severity === "high" ? 5 : 0),
    impact: meta.impact + (weakness.severity === "critical" ? 15 : weakness.severity === "high" ? 8 : 0),
    objectiveId,
    tags: [weakness.source, weakness.severity || "medium", meta.type],
  });
  if (r.ok) _emit("aeo:evolution:proposed", { evoId: r.evolution.id, type: meta.type, target: meta.target });
  return r.ok ? r.evolution : null;
}

// Propose performance evolution based on metrics
function proposePerformanceEvolution(objectiveId) {
  try {
    const metrics = _ile()?.getStats?.() || {};
    if ((metrics.reverted || 0) > (metrics.kept || 0)) {
      return _st().proposeEvolution({
        title: "Improve improvement trial keep rate",
        description: `Keep rate low: ${metrics.kept || 0} kept vs ${metrics.reverted || 0} reverted. Tighten proposal criteria.`,
        type: "performance", target: "runtime", deptId: "aeo_performance",
        confidence: 82, impact: 70, objectiveId, tags: ["performance","trial","improvement"],
      });
    }
  } catch {}
  return null;
}

// Propose cost evolution from costAnalytics
function proposeCostEvolution(objectiveId) {
  try {
    const summary = _ca()?.profitSummary?.() || {};
    if (summary.totalCost > 0 && summary.totalRevenue / summary.totalCost < 2) {
      return _st().proposeEvolution({
        title: "Optimize cost-to-revenue ratio",
        description: `Current ratio: ${(summary.totalRevenue / summary.totalCost).toFixed(2)}x. Target: 3x+. Review AI provider costs.`,
        type: "cost", target: "runtime", deptId: "aeo_cost",
        confidence: 85, impact: 85, objectiveId, tags: ["cost","revenue","optimization"],
      });
    }
  } catch {}
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Validate: score + confidence check
// ═══════════════════════════════════════════════════════════════════════════════

function validateEvolution(evoId, { minConfidence = 65, minImpact = 50 } = {}) {
  const evo = _st().getEvolution(evoId);
  if (!evo || evo.status !== "proposed") return { ok: false, error: "Must be in proposed status" };
  const passes = evo.confidence >= minConfidence && evo.impact >= minImpact;
  if (!passes) {
    _st().updateEvolution(evoId, { status: "rejected", rejectedReason: `Confidence ${evo.confidence}%<${minConfidence} or impact ${evo.impact}<${minImpact}` });
    return { ok: false, passes: false, evo };
  }
  // Get confidence explanation if available
  let explanation = null;
  try { explanation = _ece()?.explain?.({ type: evo.type, confidence: evo.confidence, context: evo.description }); } catch {}
  _st().updateEvolution(evoId, { status: "validated", confidenceExplanation: explanation });
  _st().updateKpi("aeo_quality", { improvementsValidated: (_st().getKpi("aeo_quality").improvementsValidated || 0) + 1 });
  _emit("aeo:evolution:validated", { evoId, confidence: evo.confidence, impact: evo.impact });
  return { ok: true, passes: true, evo: _st().getEvolution(evoId), explanation };
}

function autoValidateProposed({ minConfidence = 65, minImpact = 50 } = {}) {
  const proposed = _st().listEvolutions({ status: "proposed" });
  const results = { validated: 0, rejected: 0 };
  for (const evo of proposed) {
    const r = validateEvolution(evo.id, { minConfidence, minImpact });
    if (r.ok) results.validated++; else results.rejected++;
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Simulate: run improvementLoopEngine trial
// ═══════════════════════════════════════════════════════════════════════════════

function simulateEvolution(evoId) {
  const evo = _st().getEvolution(evoId);
  if (!evo || evo.status !== "validated") return { ok: false, error: "Must be validated first" };
  const r = _st().runExperiment({ name: evo.title, type: evo.type, payload: { evoId, target: evo.target, description: evo.description }, deptId: "aeo_experimentation" });
  if (r.ok) {
    _st().updateEvolution(evoId, { experimentId: r.experiment.id, status: "approved" });
    _emit("aeo:experiment:run", { evoId, experimentId: r.experiment.id, type: evo.type });
  }
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Approve (auto-approve validated evolutions with high confidence)
// ═══════════════════════════════════════════════════════════════════════════════

function approveEvolutions({ minConfidence = 70 } = {}) {
  const validated = _st().listEvolutions({ status: "validated" });
  const approved = [];
  for (const evo of validated.filter(e => e.confidence >= minConfidence)) {
    _st().updateEvolution(evo.id, { status: "approved", approvedBy: "aeo_coordinator" });
    _emit("aeo:evolution:approved", { evoId: evo.id, confidence: evo.confidence });
    approved.push(evo.id);
  }
  return { approved };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 7 — Apply evolution to target organization
// ═══════════════════════════════════════════════════════════════════════════════

function applyEvolution(evoId) {
  const evo = _st().getEvolution(evoId);
  if (!evo || evo.status !== "approved") return { ok: false, error: "Must be approved first" };
  // Collect before metrics from target
  const beforeMetrics = _collectMetrics(evo.target);
  // Apply via aeoState (which logs to improvementLoopEngine)
  const r = _st().applyEvolution(evoId, { approvedBy: "aeo_coordinator", beforeMetrics });
  if (r.ok) _emit("aeo:evolution:applied", { evoId, target: evo.target, type: evo.type });
  return r;
}

function _collectMetrics(target) {
  const m = {};
  try {
    if (target === "engineering") {
      const dash = _engSt()?.getDashboard?.() || {};
      m.velocity = dash.kpis?.velocity || 0;
      m.qualityScore = dash.kpis?.qualityScore || 0;
    } else if (target === "business") {
      const dash = _bizSt()?.getDashboard?.() || {};
      m.mrr = dash.revenue?.mrr || 0;
      m.winRate = dash.pipeline?.winRate || 0;
    } else if (target === "knowledge") {
      const dash = _akost()?.getDashboard?.() || {};
      m.validated = dash.knowledge?.validated || 0;
      m.playbooks = dash.playbooks?.total || 0;
    } else if (target === "runtime") {
      const status = _shr()?.getStatus?.() || {};
      m.healedTotal = status.healedTotal || 0;
      m.failedTotal = status.failedTotal || 0;
    }
  } catch {}
  m._timestamp = Date.now();
  return m;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 8 — Measure: compare before/after
// ═══════════════════════════════════════════════════════════════════════════════

function measureEvolution(evoId) {
  const evo = _st().getEvolution(evoId);
  if (!evo || evo.status !== "applied") return { ok: false, error: "Must be applied first" };
  const afterMetrics = _collectMetrics(evo.target);
  const r = _st().measureEvolution(evoId, { afterMetrics });
  if (!r.ok) return r;
  _emit("aeo:evolution:measured", { evoId, impactMeasured: r.impactMeasured, target: evo.target });
  // Auto-keep positive, revert negative
  if (r.impactMeasured >= 0) {
    _st().keepEvolution(evoId);
    _emit("aeo:evolution:kept", { evoId, impact: r.impactMeasured });
  } else {
    _st().revertEvolution(evoId, { reason: `Negative impact measured: ${r.impactMeasured}%` });
    _emit("aeo:evolution:reverted", { evoId, reason: "negative impact" });
  }
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 9 — Learn: propagate to AKO + notify orgs
// ═══════════════════════════════════════════════════════════════════════════════

function recordEvolutionLesson(evoId) {
  const evo = _st().getEvolution(evoId);
  if (!evo) return;
  const wasKept = evo.status === "kept";
  const title = wasKept
    ? `Evolution success: ${evo.title} — impact ${evo.impactMeasured}%`
    : `Evolution reverted: ${evo.title} — ${evo.revertedReason}`;
  // ContinuousLearningEngine lesson
  try {
    _le()?.createLesson?.({ source: `aeo_${evo.type}`, type: evo.type, severity: wasKept ? "info" : "warning", title, detail: evo.description?.slice(0,200), tags: ["evolution", evo.type, wasKept ? "success" : "failure"] });
  } catch {}
  // AKO knowledge item
  try {
    _akowf()?.researchCapture?.({ title, content: `${evo.description}. Impact: ${evo.impactMeasured}%`, type: "lesson", source: "aeo", confidence: wasKept ? 90 : 70, tags: ["evolution", evo.type, wasKept ? "success" : "failure"] });
  } catch {}
  // EngineeringMemoryEngine
  try {
    _em()?.remember?.({ type: "evolution", title, content: evo.description, confidence: wasKept ? 88 : 60, tags: ["evolution", evo.type] });
  } catch {}
  _emit("aeo:evolution:learned", { evoId, wasKept, title, type: evo.type, target: evo.target });
}

// ═══════════════════════════════════════════════════════════════════════════════
// FULL PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

async function runEvolutionPipeline(objectiveId) {
  const steps = [];
  // Step 2: Observe
  const weaknesses = observeWeaknesses(objectiveId);
  steps.push({ step: "observe", weaknesses: weaknesses.length });
  // Step 3: Propose from each weakness
  const proposed = [];
  for (const w of weaknesses.slice(0,3)) {
    const evo = proposeFromWeakness(w, objectiveId);
    if (evo) proposed.push(evo.id);
  }
  steps.push({ step: "propose", count: proposed.length });
  // Step 4: Validate all proposed
  const vr = autoValidateProposed({ minConfidence: 65, minImpact: 50 });
  steps.push({ step: "validate", ...vr });
  // Step 5+6: Simulate + Approve
  const simResults = [];
  for (const id of proposed) {
    const evo = _st().getEvolution(id);
    if (evo?.status === "validated") {
      const sr = simulateEvolution(id);
      simResults.push({ id, ok: sr.ok });
    }
  }
  steps.push({ step: "simulate", count: simResults.filter(r => r.ok).length });
  // Step 7: Apply approved
  const approved = _st().listEvolutions({ status: "approved" }).slice(0,2);
  for (const evo of approved) {
    applyEvolution(evo.id);
  }
  steps.push({ step: "apply", count: approved.length });
  // Step 8: Measure applied (after brief delay simulated synchronously)
  const applied = _st().listEvolutions({ status: "applied" }).slice(0,2);
  for (const evo of applied) {
    measureEvolution(evo.id);
  }
  steps.push({ step: "measure", count: applied.length });
  // Step 9: Learn
  const kept = _st().listEvolutions({ status: "kept" }).slice(-3);
  for (const evo of kept) { recordEvolutionLesson(evo.id); }
  steps.push({ step: "learn", count: kept.length });
  return { ok: true, steps, proposed: proposed.length, weaknesses: weaknesses.length };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COORDINATOR SYNC
// ═══════════════════════════════════════════════════════════════════════════════

function coordinatorSync() {
  const dash  = _st().getDashboard();
  const kpis  = _st().getAllKpis();
  const total = kpis.reduce((s,k) => s+(k.evolutionsProposed||0), 0);
  const kept  = kpis.reduce((s,k) => s+(k.evolutionsKept||0), 0);
  // Weekly improvement loop report
  let weeklyReport = null;
  try { weeklyReport = _il()?.getLatestReport?.(); } catch {}
  _st().createReport({
    title: `AEO Coordinator Sync — ${new Date().toISOString().slice(0,10)}`,
    deptId: "aeo_coordinator", type: "sync",
    data: { dash, kpiSummary: { total, kept }, weeklyReport },
    summary: `${dash.evolutions.total} evolutions, ${dash.evolutions.kept} kept, avg impact ${dash.evolutions.avgImpact}%`,
  });
  _emit("aeo:coordinator:sync", { dashboard: dash, kpiSummary: { total, kept } });
  return { ok: true, dashboard: dash };
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

  // When objective created → create evolution tasks
  bus.subscribe("aeo:objective:created", async ({ objectiveId, title }) => {
    try {
      const tasks = [
        { title: `Observe: scan engineering org for weaknesses`, deptId: "aeo_self_assessment", type: "observe" },
        { title: `Observe: scan business org for weaknesses`,    deptId: "aeo_self_assessment", type: "observe" },
        { title: `Propose: generate improvement plans`,          deptId: "aeo_capability",      type: "propose" },
        { title: `Validate: score all proposed evolutions`,      deptId: "aeo_quality",         type: "validate" },
        { title: `Experiment: run improvement trials`,           deptId: "aeo_experimentation", type: "experiment" },
      ];
      for (const t of tasks) _st().createTask({ ...t, objectiveId });
    } catch {}
  });

  // When evolution proposed → auto-validate
  bus.subscribe("aeo:evolution:proposed", async ({ evoId }) => {
    try { setTimeout(() => validateEvolution(evoId), 100); } catch {}
  });

  // When evolution validated → simulate
  bus.subscribe("aeo:evolution:validated", async ({ evoId, confidence }) => {
    try {
      if ((confidence || 0) >= 70) setTimeout(() => simulateEvolution(evoId), 150);
    } catch {}
  });

  // When evolution applied → schedule measurement
  bus.subscribe("aeo:evolution:applied", async ({ evoId }) => {
    try { setTimeout(() => measureEvolution(evoId), 200); } catch {}
  });

  // When evolution kept/reverted → learn
  bus.subscribe("aeo:evolution:kept",     async ({ evoId }) => { try { recordEvolutionLesson(evoId); } catch {} });
  bus.subscribe("aeo:evolution:reverted", async ({ evoId }) => { try { recordEvolutionLesson(evoId); } catch {} });

  // Cross-org: when engineering work completes → check for improvement opportunity
  bus.subscribe("engorg:work:completed", async ({ domain, workItemId }) => {
    try {
      const kpi = _engSt()?.getKpi?.(domain);
      if (kpi && (kpi.velocity || 0) < 3) {
        const obj = _st().listObjectives({ status: "active" })[0];
        _st().proposeEvolution({
          title: `Engineering velocity low in ${domain}: ${kpi.velocity || 0} items/cycle`,
          description: `Domain ${domain} velocity is below threshold. Review work claiming patterns.`,
          type: "workflow", target: "engineering", deptId: "aeo_workflow",
          confidence: 72, impact: 68, objectiveId: obj?.id, tags: ["engineering", domain, "velocity"],
        });
      }
    } catch {}
  });

  // Cross-org: when business deal won → capture evolution signal
  bus.subscribe("bizorg:deal:won", async ({ value }) => {
    try {
      const obj = _st().listObjectives({ status: "active" })[0];
      if (value > 5000) {
        _st().addMemory({ deptId: "aeo_business", type: "signal", title: `High-value deal won: $${value}`, detail: "Replicate sales pattern", tags: ["business","win","signal"] });
      }
    } catch {}
  });

  // Cross-org: when AKO stores knowledge → check for evolution opportunity
  bus.subscribe("ako:knowledge:validated", async ({ itemId, type }) => {
    try {
      if (type === "engineering" || type === "lesson") {
        const obj = _st().listObjectives({ status: "active" })[0];
        _st().addMemory({ deptId: "aeo_knowledge", type: "input", title: `AKO validated ${type} knowledge: ${itemId}`, detail: "", tags: ["knowledge",type] });
      }
    } catch {}
  });

  // Self-healing: when runtime heals → update reliability evolution
  bus.subscribe("runtime:healed", async ({ strategy, taskId }) => {
    try { _st().addMemory({ deptId: "aeo_reliability", type: "heal", title: `Runtime healed via ${strategy}`, detail: `Task: ${taskId}`, tags: ["reliability","heal"] }); } catch {}
  });
}

module.exports = {
  ceoCreateObjective,
  observeWeaknesses, analyzePatterns,
  proposeFromWeakness, proposePerformanceEvolution, proposeCostEvolution,
  validateEvolution, autoValidateProposed,
  simulateEvolution, approveEvolutions,
  applyEvolution, measureEvolution,
  recordEvolutionLesson,
  runEvolutionPipeline, coordinatorSync,
  subscribeWorkflowEvents,
};
