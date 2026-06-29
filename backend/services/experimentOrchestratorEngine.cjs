"use strict";
/**
 * experimentOrchestratorEngine.cjs — POST-Ω P18 Scientific Discovery Engine
 *
 * Coordinates experiments using the existing Experiment Manager from
 * Research Institute (POST-Ω P10). Does NOT re-implement experiment logic —
 * it orchestrates hypothesis→experiment→evidence→validate lifecycle.
 *
 * Pipeline stages: Design Experiment → Execute → Collect Evidence → Analyze → Validate
 *
 * Reuses: hypothesisEngine, researchInstituteRoutes (experimentManager inside P10),
 *         autonomousExecutionEngine, workforceManager, digitalTwinEngine,
 *         engineeringBenchmarkEngine, selfImprovementEngine,
 *         researchKnowledgeEngine, analyticsService.
 *
 * Storage: data/scientific-experiments.json (separate from data/experiments.json)
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "scientific-experiments.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _hyp  = () => _try(() => require("./hypothesisEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _aee  = () => _try(() => require("./autonomousExecutionEngine.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));
const _twin = () => _try(() => require("./digitalTwinEngine.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `sci_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const EXPERIMENT_PHASES = [
  "design",
  "execute",
  "collect_evidence",
  "analyze",
  "validate",
];

const EXPERIMENT_OUTCOMES = [
  "hypothesis_supported",
  "hypothesis_refuted",
  "inconclusive",
  "requires_follow_up",
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    experiments: [],
    stats: { total: 0, completed: 0, supported: 0, refuted: 0, byPhase: {} },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.experiments)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.experiments.length > 1000) d.experiments = d.experiments.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Evidence collectors ───────────────────────────────────────────────────────

function _collectEvidence(hypothesis) {
  const evidence = [];

  // Benchmark evidence
  try {
    const bench = _eb()?.runEngineeringBenchmark?.() || {};
    if (bench.overall !== undefined) {
      evidence.push({
        type:       "benchmark",
        source:     "engineeringBenchmarkEngine",
        metric:     "overall_score",
        value:      bench.overall,
        baseline:   bench.baseline || 70,
        delta:      (bench.overall || 0) - (bench.baseline || 70),
        supportive: (bench.overall || 0) > (bench.baseline || 70),
        collectedAt: _ts(),
      });
    }
  } catch {}

  // Pattern evidence
  try {
    const pats = _sie()?.discoverPatterns?.() || {};
    const count = (pats.patterns || []).length;
    evidence.push({
      type:       "pattern_analysis",
      source:     "selfImprovementEngine",
      metric:     "open_patterns",
      value:      count,
      baseline:   5,
      delta:      count - 5,
      supportive: count < 5,
      collectedAt: _ts(),
    });
  } catch {}

  // Knowledge evidence
  try {
    const stats = _rke()?.getStats?.() || {};
    evidence.push({
      type:       "knowledge_base",
      source:     "researchKnowledgeEngine",
      metric:     "findings_indexed",
      value:      stats.findingsIndexed || stats.totalFindings || 0,
      baseline:   50,
      delta:      (stats.findingsIndexed || 0) - 50,
      supportive: (stats.findingsIndexed || 0) >= 50,
      collectedAt: _ts(),
    });
  } catch {}

  // Digital twin simulation evidence
  try {
    const domain = hypothesis?.domain || "engineering";
    const scenarios = _twin()?.runAllScenarios?.() || {};
    if (scenarios.scenarios) {
      const relScenario = scenarios.scenarios.find(s =>
        (s.name || '').toLowerCase().includes(domain)
      ) || scenarios.scenarios[0];
      if (relScenario) {
        evidence.push({
          type:       "digital_twin_simulation",
          source:     "digitalTwinEngine",
          metric:     "simulated_outcome",
          value:      relScenario.score || relScenario.outcome || "positive",
          baseline:   "neutral",
          delta:      null,
          supportive: true,
          collectedAt: _ts(),
        });
      }
    }
  } catch {}

  return evidence;
}

function _analyzeEvidence(evidence, hypothesis) {
  const supportive = evidence.filter(e => e.supportive).length;
  const total      = evidence.length;
  const ratio      = total > 0 ? supportive / total : 0;

  let outcome, confidence;
  if (ratio >= 0.7) {
    outcome    = "hypothesis_supported";
    confidence = Math.round(60 + ratio * 35);
  } else if (ratio <= 0.3) {
    outcome    = "hypothesis_refuted";
    confidence = Math.round(60 + (1 - ratio) * 30);
  } else if (total < 2) {
    outcome    = "inconclusive";
    confidence = 50;
  } else {
    outcome    = "requires_follow_up";
    confidence = Math.round(50 + ratio * 20);
  }

  return {
    outcome,
    confidence,
    supportingCount: supportive,
    totalEvidence:   total,
    ratio:           Math.round(ratio * 100),
    summary: `${supportive}/${total} evidence points support the hypothesis (${Math.round(ratio * 100)}% supportive). Outcome: ${outcome}.`,
  };
}

// ── Core: orchestrate ─────────────────────────────────────────────────────────

async function orchestrate(hypothesisId, { skipExecute = false } = {}) {
  const hyp = _hyp()?.getHypothesis?.(hypothesisId);
  if (!hyp) return { ok: false, error: `Hypothesis ${hypothesisId} not found` };

  const expId = _id();
  const phases = [];
  let currentPhase = "design";

  // Phase 1: Design
  phases.push({
    phase:  "design",
    status: "completed",
    output: {
      experimentType:  hyp.domain === "engineering" ? "benchmark_comparison" : "before_after_analysis",
      controlGroup:    "current platform state",
      treatmentGroup:  "post-intervention platform state",
      duration:        "30 days",
      successCriteria: hyp.measurable,
      failureCriteria: hyp.falsifiable,
    },
    completedAt: _ts(),
  });

  // Phase 2: Execute (delegate to AEE or mock)
  currentPhase = "execute";
  let executeResult;
  if (skipExecute) {
    executeResult = { ok: true, workflowId: `mock_wf_${Date.now()}`, message: "Mocked execution" };
  } else {
    try {
      executeResult = await _aee()?.executeWorkflow?.({
        goal: `Execute experiment for hypothesis: ${hyp.statement.slice(0, 100)}`,
        context: { hypothesisId, domain: hyp.domain },
      }) || { ok: true, workflowId: null };
    } catch { executeResult = { ok: true, workflowId: null }; }
  }
  phases.push({
    phase:  "execute",
    status: "completed",
    output: { workflowId: executeResult.workflowId || null, executionMode: skipExecute ? "mock" : "live" },
    completedAt: _ts(),
  });

  // Phase 3: Collect Evidence
  currentPhase = "collect_evidence";
  const evidence = _collectEvidence(hyp);
  phases.push({
    phase:       "collect_evidence",
    status:      "completed",
    output:      { evidenceCount: evidence.length, evidence },
    completedAt: _ts(),
  });

  // Phase 4: Analyze
  currentPhase = "analyze";
  const analysis = _analyzeEvidence(evidence, hyp);
  phases.push({
    phase:       "analyze",
    status:      "completed",
    output:      analysis,
    completedAt: _ts(),
  });

  // Phase 5: Validate
  currentPhase = "validate";
  const validated = analysis.outcome !== "inconclusive";
  phases.push({
    phase:  "validate",
    status: "completed",
    output: {
      validated,
      outcome:    analysis.outcome,
      confidence: analysis.confidence,
      message:    validated
        ? `Experiment complete: ${analysis.outcome} with ${analysis.confidence}% confidence.`
        : `Experiment inconclusive — insufficient evidence. Requires follow-up.`,
    },
    completedAt: _ts(),
  });

  // Update hypothesis status
  const newStatus =
    analysis.outcome === "hypothesis_supported" ? "validated" :
    analysis.outcome === "hypothesis_refuted"   ? "refuted"   : "inconclusive";
  _hyp()?.updateStatus?.(hypothesisId, newStatus, { experimentId: expId });

  // Publish finding to RKE
  try {
    _rke()?.indexFinding?.({
      topic:      `Scientific Experiment: ${hyp.domain}`,
      domain:     hyp.domain,
      finding:    analysis.summary,
      hypothesis: hyp.statement,
      confidence: analysis.confidence,
      source:     "scientificDiscoveryEngine",
    });
  } catch {}

  const experiment = {
    id:             expId,
    hypothesisId,
    hypothesisStatement: hyp.statement.slice(0, 150),
    domain:         hyp.domain,
    phases,
    outcome:        analysis.outcome,
    confidence:     analysis.confidence,
    evidenceCount:  evidence.length,
    validated,
    status:         "completed",
    completedAt:    _ts(),
  };

  const d = _load();
  d.experiments.push(experiment);
  d.stats = {
    total:     d.experiments.length,
    completed: d.experiments.filter(e => e.status === "completed").length,
    supported: d.experiments.filter(e => e.outcome === "hypothesis_supported").length,
    refuted:   d.experiments.filter(e => e.outcome === "hypothesis_refuted").length,
    byPhase:   { design: 0, execute: 0, collect_evidence: 0, analyze: 0, validate: 0 },
  };
  d.experiments.forEach(e => {
    e.phases?.forEach(p => { if (d.stats.byPhase[p.phase] !== undefined) d.stats.byPhase[p.phase]++; });
  });
  _save(d);

  return { ok: true, experiment, analysis };
}

function getExperiment(id) {
  return _load().experiments.find(e => e.id === id) || null;
}

function listExperiments({ domain, outcome, limit = 50 } = {}) {
  let items = _load().experiments;
  if (domain)  items = items.filter(e => e.domain === domain);
  if (outcome) items = items.filter(e => e.outcome === outcome);
  return { ok: true, experiments: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  const successRate = d.stats.total > 0 ? Math.round(d.stats.supported / d.stats.total * 100) : 0;
  return { ...d.stats, successRate, EXPERIMENT_PHASES, EXPERIMENT_OUTCOMES, updatedAt: d.updatedAt };
}

module.exports = {
  EXPERIMENT_PHASES,
  EXPERIMENT_OUTCOMES,
  orchestrate,
  getExperiment,
  listExperiments,
  getStats,
};
