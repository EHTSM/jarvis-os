"use strict";
/**
 * businessQualityEngine.cjs — OBI X V1 Business Intelligence Evolution
 *
 * 7-dimension business quality scoring:
 *   revenue health, customer health, growth health,
 *   marketing health, sales health, retention health, operational health
 *
 * Reuses: businessReasoningEngine, businessIntelligenceEngine, businessOrgState,
 *         revenueOS, customerSuccess, analyticsService, growthOS
 *
 * Storage: data/business-quality.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "business-quality.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _bre = () => _try(() => require("./businessReasoningEngine.cjs"));
const _bie = () => _try(() => require("./businessIntelligenceEngine.cjs"));
const _bos = () => _try(() => require("./businessOrgState.cjs"));
const _rev = () => _try(() => require("./revenueOS.cjs"));
const _cs  = () => _try(() => require("./customerSuccess.cjs"));
const _gos = () => _try(() => require("./growthOS.cjs"));
const _as  = () => _try(() => require("./analyticsService.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `bq_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

// dimension weights (must sum to 1.0)
const WEIGHTS = {
  revenue_health:     0.25,
  customer_health:    0.20,
  growth_health:      0.15,
  sales_health:       0.15,
  marketing_health:   0.10,
  retention_health:   0.10,
  operational_health: 0.05,
};

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return { scores: [], stats: { total: 0, contexts: 0, avgOverall: 0 }, updatedAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.scores.length > 300) d.scores = d.scores.slice(-300);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Score computation ─────────────────────────────────────────────────────────

async function score(context, { reasoningAnalysis, rawData } = {}) {
  context = context || "current_business";

  // Reuse reasoning engine or compute inline
  let ra = reasoningAnalysis;
  if (!ra) {
    const r = await _bre()?.analyze?.(context, rawData || {});
    ra = r?.analysis || null;
  }

  const dims = ra?.dimensions || {};

  // Map reasoning dimension scores to quality dimensions
  const revenueHealth     = dims.revenue?.score    ?? 70;
  const customerHealth    = dims.customer?.score   ?? 70;
  const growthHealth      = dims.growth?.score     ?? 65;
  const salesHealth       = dims.sales?.score      ?? 65;
  const marketingHealth   = dims.marketing?.score  ?? 65;
  const retentionHealth   = dims.retention?.score  ?? 70;

  // Operational health from analytics / KPIs
  const kpis         = _try(() => _bos()?.getAllKpis?.())    || {};
  const kpiValues    = Object.values(kpis);
  const onTrackKpis  = kpiValues.filter(k => (k.current || 0) >= (k.target || Infinity) * 0.8).length;
  const operationalHealth = kpiValues.length > 0
    ? Math.min(100, 50 + (onTrackKpis / kpiValues.length) * 50)
    : 60;

  const dimensions = {
    revenue_health:     +revenueHealth.toFixed(1),
    customer_health:    +customerHealth.toFixed(1),
    growth_health:      +growthHealth.toFixed(1),
    sales_health:       +salesHealth.toFixed(1),
    marketing_health:   +marketingHealth.toFixed(1),
    retention_health:   +retentionHealth.toFixed(1),
    operational_health: +operationalHealth.toFixed(1),
  };

  const overall = +Object.entries(WEIGHTS)
    .reduce((s, [k, w]) => s + (dimensions[k] || 70) * w, 0)
    .toFixed(1);

  // Top improvement suggestions
  const sorted = Object.entries(dimensions).sort((a, b) => a[1] - b[1]);
  const improvements = sorted.slice(0, 3).map(([dim, val]) => ({
    dimension: dim,
    currentScore: val,
    priority: val < 50 ? "critical" : val < 65 ? "high" : "medium",
    suggestion: `Improve ${dim.replace(/_/g, " ")} from ${val} to at least ${Math.min(100, val + 15)}`,
  }));

  const entry = {
    id:          _id(),
    context,
    dimensions,
    overall,
    improvements,
    reasoningOverall: ra?.overallScore || null,
    scoredAt:    _ts(),
  };

  const d    = _load();
  const prev = d.scores.findLast?.(s => s.context === context) || d.scores.filter(s => s.context === context).slice(-1)[0];
  d.scores.push(entry);
  d.stats.total++;
  d.stats.contexts = new Set(d.scores.map(s => s.context)).size;
  d.stats.avgOverall = +(d.scores.slice(-20).reduce((s, sc) => s + sc.overall, 0) / Math.min(d.scores.length, 20)).toFixed(1);
  _save(d);

  return { ok: true, score: entry };
}

function getScore(id) { return _load().scores.find(s => s.id === id) || null; }

function listScores({ context, limit = 50 } = {}) {
  let list = _load().scores;
  if (context) list = list.filter(s => s.context === context);
  return { ok: true, scores: list.slice(-limit) };
}

function getHistory(context, limit = 10) {
  const list = _load().scores.filter(s => s.context === (context || "current_business"));
  return { ok: true, history: list.slice(-limit) };
}

function getTrend(context, dimension) {
  const hist = getHistory(context || "current_business", 10).history;
  if (hist.length < 2) return { ok: false, error: "insufficient history" };
  const vals = hist.map(h => dimension ? (h.dimensions?.[dimension] || 0) : h.overall);
  const first = vals[0];
  const last  = vals[vals.length - 1];
  const direction = last > first + 1 ? "improving" : last < first - 1 ? "declining" : "stable";
  return { ok: true, context, dimension: dimension || "overall", first: +first.toFixed(1), last: +last.toFixed(1), direction, velocity: +(last - first).toFixed(1) };
}

function getStats() { return { ..._load().stats, updatedAt: _load().updatedAt }; }

module.exports = { score, getScore, listScores, getHistory, getTrend, getStats, WEIGHTS };
