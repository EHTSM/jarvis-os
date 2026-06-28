"use strict";
/**
 * approvalPredictionEngine.cjs — POST-Ω Sprint P6 FDT
 *
 * Before asking the founder to approve anything, predict:
 *   - approve probability
 *   - reject probability
 *   - confidence
 *   - reasoning
 *
 * When confidence ≥ AUTO_APPROVE_THRESHOLD, routes through the existing
 * approvalEngine for auto-approval — never duplicates the queue.
 *
 * Reuses: founderProfileEngine, decisionLearningEngine,
 *         approvalEngine (P4), approvalPolicy (P4), approvalEvidence (P4).
 *
 * Storage: data/approval-predictions.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "approval-predictions.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _fpe = () => _try(() => require("./founderProfileEngine.cjs"));
const _dle = () => _try(() => require("./decisionLearningEngine.cjs"));
const _ae  = () => _try(() => require("./approvalEngine.cjs"));
const _ap  = () => _try(() => require("./approvalPolicy.cjs"));
const _aev = () => _try(() => require("./approvalEvidence.cjs"));
const _fwr = () => _try(() => require("./founderWorkRegistry.cjs"));

// Confidence threshold above which auto-approval fires without founder tap
const AUTO_APPROVE_THRESHOLD = 0.88;

function _ts() { return new Date().toISOString(); }
function _id() { return `ap_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { predictions: [], stats: { total: 0, correct: 0, autoApproved: 0, manualRequired: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.predictions.length > 1000) d.predictions = d.predictions.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Feature extraction ────────────────────────────────────────────────────────

function _extractFeatures(workflowId, domain, risk, context) {
  const prefs     = _fpe()?.getPreferences?.() || {};
  const patterns  = _dle()?.getPatterns?.()?.patterns || {};
  const policy    = _ap()?.getPolicy?.(workflowId) || {};
  const evidence  = _aev()?.getSummary?.() || {};

  return {
    risk,
    domain,
    workflowId,
    // Profile preferences
    riskTolerance:       prefs.preferences?.risk_tolerance?.score      ?? 0.5,
    automationPref:      prefs.preferences?.automation_preference?.score ?? 0.5,
    trustScore:          prefs.trustScore ?? 0,
    // Historical patterns
    domainApprovalRate:  patterns[`${domain}_approval_rate`]?.rate      ?? 0.7,
    highRiskRate:        patterns.high_risk_approval_rate?.rate          ?? 0.5,
    correctionFreq:      patterns.correction_frequency?.rate             ?? 0.1,
    avgSpeedMs:          patterns.avg_decision_speed_ms?.avgMs           ?? 30000,
    // Policy
    policyRisk:          policy.risk,
    policyThreshold:     policy.autoApproveThreshold,
    // Evidence history
    historicApproveRate: evidence.totalEvents > 0
                           ? (evidence.approved + evidence.autoApproved) / evidence.totalEvents
                           : 0.7,
    // Context features
    hasContext:          Object.keys(context || {}).length > 0,
  };
}

// ── Core prediction model ─────────────────────────────────────────────────────
// Simple weighted feature scoring — no ML dependency required.

function predict(workflowId, { domain = "general", risk = "medium", context = {}, confidence: systemConf = 0.8 } = {}) {
  const features = _extractFeatures(workflowId, domain, risk, context);

  // Base probability from historical approval rate for this domain
  let approveProbability = features.domainApprovalRate || 0.7;

  // Adjust for risk level
  if (risk === "critical") approveProbability *= 0.5;
  else if (risk === "high")    approveProbability *= 0.7;
  else if (risk === "medium")  approveProbability *= 0.9;
  else if (risk === "low")     approveProbability *= 1.05;

  // Adjust for founder risk tolerance (0=conservative, 1=aggressive)
  const riskAdj = (features.riskTolerance - 0.5) * 0.2;
  approveProbability += riskAdj;

  // Adjust for automation preference
  if (domain === "deployment" || domain === "automation") {
    const autoAdj = (features.automationPref - 0.5) * 0.15;
    approveProbability += autoAdj;
  }

  // Adjust for trust — low trust → stay conservative
  const trustAdj = (features.trustScore / 100 - 0.5) * 0.1;
  approveProbability += trustAdj;

  // Correction frequency penalty — if we're often wrong, be less confident
  approveProbability -= features.correctionFreq * 0.1;

  // Clamp
  approveProbability = Math.max(0.05, Math.min(0.98, approveProbability));
  const rejectProbability = 1 - approveProbability;

  // Confidence in our prediction — grows with trust score and sample size
  const patternConf   = _dle()?.getPatterns?.()?.patterns?.[`${domain}_approval_rate`]?.confidence ?? 0;
  const profileConf   = features.trustScore / 100;
  const predConf      = Math.min(0.95, (patternConf * 0.4 + profileConf * 0.4 + systemConf * 0.2));

  // Determine predicted outcome
  const predictedOutcome = approveProbability >= 0.5 ? "approved" : "rejected";

  // Build reasoning
  const reasoning = _buildReasoning(features, approveProbability, risk, domain);

  // Should auto-approve?
  const shouldAutoApprove = predConf >= AUTO_APPROVE_THRESHOLD
                         && approveProbability >= 0.85
                         && risk !== "critical"
                         && risk !== "high";

  return {
    ok:                 true,
    workflowId,
    predictedOutcome,
    approveProbability:  Math.round(approveProbability * 100) / 100,
    rejectProbability:   Math.round(rejectProbability  * 100) / 100,
    confidence:          Math.round(predConf * 100) / 100,
    shouldAutoApprove,
    autoApproveThreshold: AUTO_APPROVE_THRESHOLD,
    reasoning,
    features,
  };
}

function _buildReasoning(features, prob, risk, domain) {
  const reasons = [];
  if (features.domainApprovalRate > 0.8)
    reasons.push(`Founder historically approves ${Math.round(features.domainApprovalRate*100)}% of ${domain} requests.`);
  if (features.riskTolerance > 0.6)
    reasons.push("Founder shows moderate-high risk tolerance.");
  else if (features.riskTolerance < 0.4)
    reasons.push("Founder is risk-conservative — rejection more likely for high-risk items.");
  if (risk === "high" || risk === "critical")
    reasons.push(`This request is classified as ${risk} risk — probability reduced.`);
  if (features.automationPref > 0.6 && domain === "deployment")
    reasons.push("Founder prefers automation for deployments.");
  if (features.correctionFreq > 0.2)
    reasons.push("Prediction model has been corrected frequently — confidence adjusted down.");
  if (reasons.length === 0)
    reasons.push("Based on general founder approval patterns.");
  return reasons;
}

// ── Predict + route ───────────────────────────────────────────────────────────

async function predictAndRoute(workflowId, opts = {}) {
  const pred = predict(workflowId, opts);
  const store = _load();
  const id    = _id();

  const entry = {
    id,
    workflowId,
    ...pred,
    routed:   null,
    resolvedAt: null,
    ts:       _ts(),
  };

  if (pred.shouldAutoApprove) {
    // Route through existing approvalEngine for auto-approval
    const result = await _try(() => _ae()?.requestApproval?.(workflowId, {
      confidence:  pred.approveProbability,
      context:     { ...opts.context, twinPrediction: pred },
      triggeredBy: "approvalPredictionEngine",
    }));

    if (result?.reqId) {
      await _try(() => _ae()?.approveAndResume?.(result.reqId, { approvedBy: "founder_twin" }));
      entry.routed    = "auto_approved_via_engine";
      entry.reqId     = result.reqId;
      store.stats.autoApproved++;
    } else {
      entry.routed = "auto_approve_fallback";
      store.stats.autoApproved++;
    }
    store.stats.total++;
  } else {
    entry.routed = "founder_required";
    store.stats.manualRequired++;
    store.stats.total++;
  }

  store.predictions.push(entry);
  _save(store);

  return { ...pred, routedAs: entry.routed, predictionId: id };
}

// ── Outcome feedback ──────────────────────────────────────────────────────────

function recordOutcome(predictionId, actualOutcome) {
  const store = _load();
  const pred  = store.predictions.find(p => p.id === predictionId);
  if (!pred) return { ok: false, error: "prediction not found" };

  pred.actualOutcome  = actualOutcome;
  pred.wasCorrect     = pred.predictedOutcome === actualOutcome;
  pred.resolvedAt     = _ts();

  if (pred.wasCorrect) store.stats.correct = (store.stats.correct || 0) + 1;

  _save(store);

  // Feed back into profile
  _try(() => _fpe()?.recordPredictionOutcome?.({
    predicted:  pred.predictedOutcome,
    actual:     actualOutcome,
    corrected:  !pred.wasCorrect,
  }));

  return { ok: true, wasCorrect: pred.wasCorrect };
}

// ── History ───────────────────────────────────────────────────────────────────

function getPredictions({ workflowId, routed, limit = 50 } = {}) {
  const store = _load();
  let list = store.predictions;
  if (workflowId) list = list.filter(p => p.workflowId === workflowId);
  if (routed)     list = list.filter(p => p.routed === routed);
  return { ok: true, predictions: list.slice(-limit), stats: store.stats };
}

function getStats() {
  const store = _load();
  const s     = store.stats;
  return {
    total:           s.total,
    autoApproved:    s.autoApproved,
    manualRequired:  s.manualRequired,
    predictionAccuracy: s.total > 0 ? Math.round((s.correct || 0) / s.total * 100) : 0,
    autoApproveRate: s.total > 0 ? Math.round(s.autoApproved / s.total * 100) : 0,
    threshold:       AUTO_APPROVE_THRESHOLD,
    updatedAt:       store.updatedAt,
  };
}

module.exports = {
  predict,
  predictAndRoute,
  recordOutcome,
  getPredictions,
  getStats,
  AUTO_APPROVE_THRESHOLD,
};
