"use strict";
/**
 * businessPredictionEngine.cjs — OBI X V1 Business Intelligence Evolution
 *
 * Predicts business failures and opportunities before they happen:
 *   - revenue trends
 *   - churn
 *   - conversion
 *   - campaign success
 *   - pricing impact
 *   - customer lifetime value
 *   - acquisition efficiency
 *
 * Reuses: businessQualityEngine, businessReasoningEngine, businessOrgState,
 *         revenueOS, customerSuccess, growthOS, continuousLearningEngine
 *
 * Storage: data/business-predictions.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "business-predictions.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bqe = () => _try(() => require("./businessQualityEngine.cjs"));
const _bre = () => _try(() => require("./businessReasoningEngine.cjs"));
const _bos = () => _try(() => require("./businessOrgState.cjs"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _cs  = () => _try(() => require("./customerSuccess.cjs"));
const _gos = () => _try(() => require("./growthOS.cjs"));
const _cle = () => _try(() => require("./continuousLearningEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `bp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// ── Prediction functions ──────────────────────────────────────────────────────

function _predictRevenueTrends(qualScore) {
  const preds  = [];
  const rev    = qualScore?.dimensions?.revenue_health ?? 70;
  const ret    = qualScore?.dimensions?.retention_health ?? 70;
  const growth = qualScore?.dimensions?.growth_health ?? 65;

  if (rev < 50)     preds.push({ type: "revenue_decline",        likelihood: 0.85, severity: "critical", description: "Revenue health critically low — decline expected within 30 days" });
  if (rev < 65)     preds.push({ type: "mrr_stagnation",         likelihood: 0.75, severity: "high",     description: "MRR at risk of stagnating without intervention" });
  if (growth >= 75) preds.push({ type: "revenue_acceleration",   likelihood: 0.70, severity: "info",     description: "Strong growth signals — revenue acceleration likely" });
  if (ret < 60)     preds.push({ type: "arr_shrinkage",          likelihood: 0.80, severity: "critical", description: "Poor retention will shrink ARR — churn exceeds new revenue" });
  return preds;
}

function _predictChurn(qualScore, reasoning) {
  const preds   = [];
  const custH   = qualScore?.dimensions?.customer_health  ?? 70;
  const retH    = qualScore?.dimensions?.retention_health ?? 70;
  const churnPct= reasoning?.dimensions?.retention?.risks ?? 0;

  if (custH < 60)   preds.push({ type: "customer_churn_wave",    likelihood: 0.85, severity: "critical", description: `Customer health ${custH} — mass churn predicted within 14 days` });
  if (retH < 55)    preds.push({ type: "retention_collapse",     likelihood: 0.80, severity: "critical", description: "Retention health critical — net revenue retention at risk" });
  if (churnPct > 5) preds.push({ type: "churn_cluster",          likelihood: 0.75, severity: "high",     description: `${churnPct} churn risk signals — targeted intervention needed` });
  return preds;
}

function _predictConversion(qualScore, reasoning) {
  const preds = [];
  const sales = qualScore?.dimensions?.sales_health ?? 65;
  const mkt   = qualScore?.dimensions?.marketing_health ?? 65;
  const price = reasoning?.dimensions?.pricing?.winRate ?? 50;

  if (sales < 55)    preds.push({ type: "pipeline_conversion_drop",  likelihood: 0.80, severity: "high",   description: `Sales health ${sales} — pipeline conversion to drop below 15%` });
  if (mkt < 50)      preds.push({ type: "lead_quality_decline",      likelihood: 0.75, severity: "high",   description: "Marketing health low — lead quality and quantity will fall" });
  if (price < 25)    preds.push({ type: "pricing_conversion_drag",   likelihood: 0.70, severity: "medium", description: "Win rate below 25% — pricing friction reducing conversion" });
  if (sales >= 80)   preds.push({ type: "conversion_acceleration",   likelihood: 0.65, severity: "info",   description: "Strong sales signals — conversion rates likely to improve" });
  return preds;
}

function _predictCampaignSuccess(qualScore) {
  const preds = [];
  const mkt   = qualScore?.dimensions?.marketing_health ?? 65;
  const rev   = qualScore?.dimensions?.revenue_health   ?? 70;

  if (mkt < 50)     preds.push({ type: "campaign_underperformance",  likelihood: 0.80, severity: "high",   description: "Marketing health too low for campaigns to succeed" });
  if (mkt < 65)     preds.push({ type: "campaign_roi_risk",          likelihood: 0.70, severity: "medium", description: "Campaign ROI at risk — optimize targeting and creative" });
  if (mkt >= 75 && rev >= 65) {
    preds.push({ type: "campaign_breakout_potential", likelihood: 0.65, severity: "info", description: "Conditions favorable for breakout campaign performance" });
  }
  return preds;
}

function _predictPricingImpact(reasoning) {
  const preds   = [];
  const winRate = reasoning?.dimensions?.pricing?.winRate  ?? 50;
  const avgDeal = reasoning?.dimensions?.pricing?.avgDeal  ?? 200;

  if (winRate < 20)  preds.push({ type: "price_too_high",           likelihood: 0.80, severity: "high",     description: `Win rate ${winRate}% — price exceeds perceived value` });
  if (avgDeal < 50)  preds.push({ type: "pricing_floor_risk",       likelihood: 0.75, severity: "high",     description: "Deal values too low — pricing below sustainability threshold" });
  if (winRate > 70)  preds.push({ type: "price_increase_headroom",  likelihood: 0.65, severity: "info",     description: "Win rate high — pricing headroom available, consider increase" });
  return preds;
}

function _predictCLV(qualScore, reasoning) {
  const preds  = [];
  const custH  = qualScore?.dimensions?.customer_health  ?? 70;
  const retH   = qualScore?.dimensions?.retention_health ?? 70;

  if (custH < 60 || retH < 60) {
    preds.push({ type: "clv_at_risk",  likelihood: 0.80, severity: "high",   description: "Poor customer/retention health — CLV will decline 20-40% in next quarter" });
  }
  if (custH >= 80 && retH >= 75) {
    preds.push({ type: "clv_growth",   likelihood: 0.70, severity: "info",   description: "Strong health metrics — CLV expansion likely through upsell/cross-sell" });
  }
  return preds;
}

function _predictAcquisitionEfficiency(qualScore) {
  const preds = [];
  const sales = qualScore?.dimensions?.sales_health      ?? 65;
  const mkt   = qualScore?.dimensions?.marketing_health  ?? 65;
  const growth= qualScore?.dimensions?.growth_health     ?? 65;

  const cac_signal = (100 - mkt) * 0.4 + (100 - sales) * 0.4 + (100 - growth) * 0.2;

  if (cac_signal > 50)  preds.push({ type: "cac_creep",         likelihood: 0.75, severity: "high",   description: "CAC likely increasing — acquisition efficiency declining" });
  if (cac_signal > 70)  preds.push({ type: "acquisition_crisis", likelihood: 0.80, severity: "critical", description: "Acquisition efficiency critical — CAC may exceed LTV" });
  if (cac_signal < 25)  preds.push({ type: "efficient_growth",   likelihood: 0.65, severity: "info",   description: "Acquisition efficiency strong — good CAC/LTV ratio expected" });
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

// ── Main predict ──────────────────────────────────────────────────────────────

async function predict(context, { qualityScore, reasoningAnalysis } = {}) {
  context = context || "current_business";

  const hist = _bqe()?.getHistory?.(context, 1)?.history || [];
  const qs   = qualityScore     || hist[hist.length - 1] || { dimensions: {}, overall: 64 };
  const ra   = reasoningAnalysis || null;

  const revTrends   = _predictRevenueTrends(qs);
  const churn       = _predictChurn(qs, ra);
  const conversion  = _predictConversion(qs, ra);
  const campaigns   = _predictCampaignSuccess(qs);
  const pricing     = _predictPricingImpact(ra);
  const clv         = _predictCLV(qs, ra);
  const acquisition = _predictAcquisitionEfficiency(qs);

  const all = [...revTrends, ...churn, ...conversion, ...campaigns, ...pricing, ...clv, ...acquisition];

  // Filter info from riskScore
  const riskItems  = all.filter(p => p.severity !== "info");
  const riskScore  = riskItems.length > 0
    ? Math.round(riskItems.reduce((s, p) => s + p.likelihood * (p.severity === "critical" ? 1.5 : p.severity === "high" ? 1.0 : 0.5), 0) / riskItems.length * 100)
    : 5;

  const d = _load();
  const entry = {
    id:             _id(),
    context,
    revenueTrends:  revTrends,
    churn,
    conversion,
    campaignSuccess: campaigns,
    pricingImpact:  pricing,
    customerLTV:    clv,
    acquisitionEfficiency: acquisition,
    total:          all.length,
    criticalCount:  all.filter(p => p.severity === "critical").length,
    opportunityCount: all.filter(p => p.severity === "info").length,
    riskScore,
    predictedAt:    _ts(),
  };

  d.predictions.push(entry);
  d.stats.total++;
  d.stats.criticalPredictions += entry.criticalCount;
  const recent = d.predictions.slice(-20);
  d.stats.avgRisk = +(recent.reduce((s, p) => s + p.riskScore, 0) / recent.length).toFixed(1);
  _save(d);

  return { ok: true, prediction: entry };
}

function getPrediction(id) { return _load().predictions.find(p => p.id === id) || null; }
function listPredictions({ context, limit = 50 } = {}) {
  let preds = _load().predictions;
  if (context) preds = preds.filter(p => p.context === context);
  return { ok: true, predictions: preds.slice(-limit) };
}
function getStats() { return { ..._load().stats, updatedAt: _load().updatedAt }; }

module.exports = { predict, getPrediction, listPredictions, getStats };
