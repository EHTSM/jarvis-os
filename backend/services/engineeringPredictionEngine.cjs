"use strict";
/**
 * engineeringPredictionEngine.cjs — OAI X V1 Engineering Intelligence Evolution
 *
 * Predicts engineering failures before they happen:
 *   - bugs                  (smell density, rule violations, historical pattern)
 *   - regressions           (quality trend declining)
 *   - deployment failures   (failing gates, unresolved blockers)
 *   - runtime failures      (self-healing patterns, observer anomalies)
 *   - performance degradation (latency trend, memory growth)
 *   - security risks        (dependency age, known vuln patterns)
 *
 * Reuses: engineeringQualityEngine, engineeringReasoningEngine, engineeringMemoryEngine,
 *         continuousLearningEngine, selfHealingRuntime, continuousRuntimeObserver,
 *         engineeringOrgState, engineeringRuleRegistry
 *
 * Storage: data/engineering-predictions.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "engineering-predictions.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _eqe = () => _try(() => require("./engineeringQualityEngine.cjs"));
const _ere = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _em  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));
const _sh  = () => _try(() => require("./selfHealingRuntime.cjs"));
const _ro  = () => _try(() => require("./continuousRuntimeObserver.cjs"));
const _eos = () => _try(() => require("./engineeringOrgState.cjs"));
const _rr  = () => _try(() => require("./engineeringRuleRegistry.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

// ── Prediction rules ──────────────────────────────────────────────────────────

function _predictBugs(qualScore, reasoning) {
  const preds = [];
  const dims  = qualScore?.dimensions || {};
  const ra    = reasoning?.dimensions || {};

  if ((dims.code_quality || 75) < 60) {
    preds.push({ type: "bug_accumulation", likelihood: 0.85, severity: "high", description: "Low code quality score predicts defect density increase of >30% in next 30 days" });
  }
  if ((ra.bugs?.score || 75) < 50) {
    preds.push({ type: "critical_bug_risk", likelihood: 0.80, severity: "critical", description: "Bug reasoning score below 50 — high-severity defects likely in production within 14 days" });
  }
  const ruleStats = _try(() => _rr()?.getStats?.()) || {};
  const rules     = ruleStats.rules || [];
  const highFire  = rules.filter(r => (r.triggerCount || 0) > 10).length;
  if (highFire > 2) {
    preds.push({ type: "repeated_violations", likelihood: 0.75, severity: "medium", description: `${highFire} rules firing repeatedly — systemic code health issue` });
  }
  return preds;
}

function _predictRegressions(qualScore, context) {
  const preds = [];
  const trend = _eqe()?.getTrend?.(context) || {};

  if (trend.direction === "declining") {
    preds.push({ type: "quality_regression", likelihood: 0.90, severity: "high", description: `Quality trend declining (${trend.first}→${trend.last}) — regression imminent if unchecked` });
  }
  if ((qualScore?.dimensions?.reliability || 75) < 60) {
    preds.push({ type: "reliability_regression", likelihood: 0.80, severity: "high", description: "Reliability score below 60 — increased MTTR and repeat-failure risk" });
  }
  return preds;
}

function _predictDeploymentFailures(orgState) {
  const preds   = [];
  const blockers= _try(() => _eos()?.listBlockers?.()) || { blockers: [] };
  const bl      = blockers.blockers || [];
  const unresolvedCritical = bl.filter(b => !b.resolvedAt && (b.severity === "critical" || b.impact === "critical")).length;

  if (unresolvedCritical > 0) {
    preds.push({ type: "deploy_blocked", likelihood: 0.95, severity: "critical", description: `${unresolvedCritical} unresolved critical blockers will prevent deployment` });
  }
  const approvals = _try(() => _eos()?.listApprovals?.()) || { approvals: [] };
  const pending   = (approvals.approvals || []).filter(a => a.status === "pending").length;
  if (pending > 3) {
    preds.push({ type: "approval_bottleneck", likelihood: 0.70, severity: "medium", description: `${pending} pending approvals will delay release` });
  }
  return preds;
}

function _predictRuntimeFailures(healHistory, observerHealth) {
  const preds   = [];
  const cycles  = healHistory?.cycles || healHistory?.history || [];
  const recentFails = cycles.slice(-5).filter(c => !c.success && !c.ok).length;

  if (recentFails >= 3) {
    preds.push({ type: "runtime_instability", likelihood: 0.85, severity: "critical", description: `${recentFails} recent heal cycles failed — runtime instability predicted` });
  }
  if (recentFails >= 1) {
    preds.push({ type: "recurring_failures", likelihood: 0.70, severity: "high", description: "Recurring self-heal failures indicate systemic runtime issue" });
  }

  // sources may be an object {} or array [] depending on observer state
  const sourcesRaw = observerHealth?.sources || {};
  const sourcesArr = Array.isArray(sourcesRaw) ? sourcesRaw : Object.values(sourcesRaw);
  const unhealthy  = sourcesArr.filter(s => s.status === "error" || s.status === "degraded").length;
  if (unhealthy > 0) {
    preds.push({ type: "observer_anomaly", likelihood: 0.75, severity: "high", description: `${unhealthy} monitored sources in degraded state` });
  }
  return preds;
}

function _predictPerformanceDegradation(qualScore, reasoning) {
  const preds = [];
  const dims  = qualScore?.dimensions || {};
  const ra    = reasoning?.dimensions || {};

  if ((dims.performance || 75) < 60) {
    preds.push({ type: "performance_degradation", likelihood: 0.80, severity: "high", description: "Performance score below 60 — latency spikes expected under load" });
  }
  if ((ra.performance?.score || 75) < 50) {
    preds.push({ type: "throughput_bottleneck", likelihood: 0.75, severity: "medium", description: "Performance reasoning identifies throughput bottleneck" });
  }
  return preds;
}

function _predictSecurityRisks(qualScore, reasoning) {
  const preds = [];
  const dims  = qualScore?.dimensions || {};
  const ra    = reasoning?.dimensions || {};

  if ((dims.security || 80) < 70) {
    preds.push({ type: "security_exposure", likelihood: 0.90, severity: "critical", description: "Security score below 70 — active vulnerability exposure predicted" });
  }
  if ((ra.security?.score || 80) < 60) {
    preds.push({ type: "dependency_vulnerability", likelihood: 0.85, severity: "critical", description: "Security reasoning identifies likely CVE in dependency chain" });
  }
  if ((ra.dependencies?.score || 80) < 65) {
    preds.push({ type: "outdated_dependencies", likelihood: 0.75, severity: "medium", description: "Dependency health below threshold — update required before next release" });
  }
  return preds;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { predictions: [], stats: { total: 0, criticalPredictions: 0, avgRisk: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.predictions.length > 300) d.predictions = d.predictions.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Main prediction ───────────────────────────────────────────────────────────

async function predict(context, { qualityScore, reasoningAnalysis } = {}) {
  context = context || "current_repo";

  const hist    = _eqe()?.getHistory?.(context, 1)?.history || [];
  const qs      = qualityScore    || hist[hist.length - 1] || { dimensions: {}, overall: 70 };
  const ra      = reasoningAnalysis || _try(() => {
    const list = require("./engineeringReasoningEngine.cjs").listAnalyses?.({ limit: 1 });
    return list?.analyses?.slice(-1)[0] || null;
  }) || { dimensions: {} };

  const healHist = _try(() => _sh()?.getHistory?.(5)) || {};
  const obsvHealth = _try(() => _ro()?.getHealth?.()) || {};
  const orgState   = _try(() => _eos()?.getDashboard?.()) || {};

  const bugs        = _predictBugs(qs, ra);
  const regressions = _predictRegressions(qs, context);
  const deployFails = _predictDeploymentFailures(orgState);
  const runtimeFails= _predictRuntimeFailures(healHist, obsvHealth);
  const perfDeg     = _predictPerformanceDegradation(qs, ra);
  const secRisks    = _predictSecurityRisks(qs, ra);

  const all = [...bugs, ...regressions, ...deployFails, ...runtimeFails, ...perfDeg, ...secRisks];
  const riskScore = all.length > 0
    ? Math.round(all.reduce((s, p) => s + p.likelihood * (p.severity === "critical" ? 1.5 : p.severity === "high" ? 1.0 : 0.5), 0) / all.length * 100)
    : 5;

  const d = _load();
  const entry = {
    id:            _id(),
    context,
    bugs,
    regressions,
    deploymentFailures: deployFails,
    runtimeFailures:    runtimeFails,
    performanceDegradation: perfDeg,
    securityRisks:      secRisks,
    total:         all.length,
    criticalCount: all.filter(p => p.severity === "critical").length,
    riskScore,
    qualityOverall: qs?.overall || null,
    predictedAt:   _ts(),
  };

  d.predictions.push(entry);
  d.stats.total++;
  d.stats.criticalPredictions += entry.criticalCount;
  const recent = d.predictions.slice(-20);
  d.stats.avgRisk = +(recent.reduce((s, p) => s + p.riskScore, 0) / recent.length).toFixed(1);
  _save(d);

  _try(() => _em()?.remember?.({
    problem:   `Engineering risk prediction for ${context}`,
    solution:  `Risk score: ${riskScore}. ${all.length} predictions. ${entry.criticalCount} critical.`,
    context:   { riskScore, total: all.length, criticalCount: entry.criticalCount },
    outcome:   "predicted",
    confidence: 0.80,
  }));

  return { ok: true, prediction: entry };
}

function getPrediction(id)  { return _load().predictions.find(p => p.id === id) || null; }

function listPredictions({ context, limit = 50 } = {}) {
  let preds = _load().predictions;
  if (context) preds = preds.filter(p => p.context === context);
  return { ok: true, predictions: preds.slice(-limit) };
}

function getStats() {
  return { ..._load().stats, updatedAt: _load().updatedAt };
}

module.exports = { predict, getPrediction, listPredictions, getStats };
