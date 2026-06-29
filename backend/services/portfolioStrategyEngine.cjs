"use strict";
/**
 * portfolioStrategyEngine.cjs — POST-Ω P16 Autonomous Investment Engine
 *
 * Balances investment across: products, companies, customers,
 *   infrastructure, AI capabilities.
 *
 * Reuses: productPlannerEngine, companyLifecycleEngine, customerHealthEngine,
 *         marketplaceCatalogEngine, workspaceMesh, capitalAllocationEngine,
 *         investmentAnalysisEngine, revenueForecastEngine, revenueDiscoveryEngine,
 *         knowledgeFederationEngine, engineeringBenchmarkEngine.
 *
 * Storage: data/portfolio-strategy.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "portfolio-strategy.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _ppe  = () => _try(() => require("./productPlannerEngine.cjs"));
const _clf  = () => _try(() => require("./companyLifecycleEngine.cjs"));
const _che  = () => _try(() => require("./customerHealthEngine.cjs"));
const _mce  = () => _try(() => require("./marketplaceCatalogEngine.cjs"));
const _wm   = () => _try(() => require("./workspaceMesh.cjs"));
const _cal  = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _ian  = () => _try(() => require("./investmentAnalysisEngine.cjs"));
const _rfe  = () => _try(() => require("./revenueForecastEngine.cjs"));
const _rde  = () => _try(() => require("./revenueDiscoveryEngine.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _rev  = () => _try(() => require("./revenueOS.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `pfs_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const PORTFOLIO_DIMENSIONS = [
  "products",        // product roadmap investment
  "companies",       // company builder / lifecycle
  "customers",       // customer success and retention
  "infrastructure",  // technical platform
  "ai_capabilities", // AI models, agents, automation
];

const STRATEGY_MODES = [
  "growth",        // maximize new revenue
  "retention",     // protect existing revenue
  "efficiency",    // maximize output per dollar
  "balanced",      // equal weight across dimensions
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { strategies: [], current: null, stats: { total: 0, byMode: {} }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.strategies)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.strategies.length > 500) d.strategies = d.strategies.slice(-500);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function _scoreProducts() {
  try {
    const stats = _ppe()?.getStats?.() || {};
    const plans = stats.byPhase || {};
    const active = (plans.execution || 0) + (plans.planning || 0);
    return { score: Math.min(100, active * 10 + 30), items: stats.total || 0, signals: active > 0 ? ["active_roadmap"] : [] };
  } catch { return { score: 40, items: 0, signals: [] }; }
}

function _scoreCompanies() {
  try {
    const stats = _clf()?.getStats?.() || {};
    return {
      score: Math.min(100, (stats.total || 0) * 5 + 20),
      items: stats.total || 0,
      signals: (stats.total || 0) > 0 ? ["companies_active"] : [],
    };
  } catch { return { score: 20, items: 0, signals: [] }; }
}

function _scoreCustomers() {
  try {
    const s = _che()?.getStats?.() || {};
    const healthScore = Math.round(s.avgScore || 50);
    const atRiskPct   = s.total > 0 ? Math.round((s.atRisk / s.total) * 100) : 0;
    return {
      score: Math.round(healthScore * (1 - atRiskPct / 100)),
      items: s.total || 0,
      atRisk: s.atRisk || 0,
      signals: atRiskPct > 50 ? ["high_churn_risk"] : ["healthy_base"],
    };
  } catch { return { score: 50, items: 0, signals: [] }; }
}

function _scoreInfrastructure() {
  try {
    const wmStats = _wm()?.getStats?.() || {};
    const meshHealth = wmStats.healthyWorkspaces || 0;
    const totalWS = wmStats.totalWorkspaces || 1;
    return {
      score: Math.round((meshHealth / totalWS) * 100),
      workspaces: totalWS,
      signals: meshHealth / totalWS > 0.9 ? ["infra_healthy"] : ["infra_degraded"],
    };
  } catch { return { score: 75, workspaces: 0, signals: [] }; }
}

function _scoreAICapabilities() {
  try {
    const ebBaseline = _eb()?.ENGINEERING_BASELINE || {};
    const patterns = Object.keys(ebBaseline).length;
    return {
      score: Math.min(100, 50 + patterns * 5),
      benchmarkPatterns: patterns,
      signals: patterns > 5 ? ["ai_mature"] : ["ai_growing"],
    };
  } catch { return { score: 60, benchmarkPatterns: 0, signals: [] }; }
}

// ── Strategy recommender ──────────────────────────────────────────────────────

function _recommendWeights(scores, mode) {
  const base = {
    products:        0.25,
    companies:       0.10,
    customers:       0.30,
    infrastructure:  0.20,
    ai_capabilities: 0.15,
  };

  if (mode === "growth") {
    base.products   = 0.35; base.customers = 0.20; base.ai_capabilities = 0.20;
    base.companies  = 0.15; base.infrastructure = 0.10;
  } else if (mode === "retention") {
    base.customers  = 0.45; base.products = 0.20;
    base.infrastructure = 0.20; base.ai_capabilities = 0.10; base.companies = 0.05;
  } else if (mode === "efficiency") {
    base.ai_capabilities = 0.30; base.infrastructure = 0.25; base.products = 0.25;
    base.customers = 0.15; base.companies = 0.05;
  }
  // balanced: keep base

  // Skew further based on live scores
  if ((scores.customers?.atRisk || 0) > 10) {
    base.customers = Math.min(0.50, base.customers + 0.05);
    const excess = 0.05 / (PORTFOLIO_DIMENSIONS.length - 1);
    ["products","companies","infrastructure","ai_capabilities"].forEach(k => {
      base[k] = Math.max(0.05, base[k] - excess);
    });
  }

  // Normalize
  const total = Object.values(base).reduce((a, b) => a + b, 0);
  Object.keys(base).forEach(k => { base[k] = Math.round(base[k] / total * 1000) / 1000; });
  return base;
}

// ── Core: strategize ─────────────────────────────────────────────────────────

function strategize(mode = "balanced", totalBudget = 100000) {
  if (!STRATEGY_MODES.includes(mode)) mode = "balanced";

  const scores = {
    products:        _scoreProducts(),
    companies:       _scoreCompanies(),
    customers:       _scoreCustomers(),
    infrastructure:  _scoreInfrastructure(),
    ai_capabilities: _scoreAICapabilities(),
  };

  const weights = _recommendWeights(scores, mode);

  const portfolio = {};
  PORTFOLIO_DIMENSIONS.forEach(dim => {
    portfolio[dim] = {
      weight:   weights[dim],
      budget:   Math.round(totalBudget * weights[dim]),
      score:    scores[dim]?.score ?? 50,
      items:    scores[dim]?.items ?? 0,
      signals:  scores[dim]?.signals ?? [],
      action:   scores[dim]?.score < 50 ? "increase_investment" : "maintain",
    };
  });

  const overallScore = Math.round(
    Object.values(scores).reduce((s, sc) => s + (sc.score || 50), 0) / PORTFOLIO_DIMENSIONS.length
  );

  const record = {
    id: _id(), mode, totalBudget, portfolio, overallScore,
    topFocus: Object.entries(portfolio).sort((a, b) => b[1].budget - a[1].budget)[0]?.[0] || "customers",
    strategizedAt: _ts(),
  };

  const d = _load();
  d.strategies.push(record);
  d.current = record;
  const byMode = {};
  STRATEGY_MODES.forEach(m => { byMode[m] = 0; });
  d.strategies.forEach(s => { if (byMode[s.mode] !== undefined) byMode[s.mode]++; });
  d.stats = { total: d.strategies.length, byMode };
  _save(d);

  return { ok: true, strategy: record };
}

function getCurrentStrategy() {
  return _load().current || null;
}

function getStrategy(id) {
  return _load().strategies.find(s => s.id === id) || null;
}

function listStrategies({ mode, limit = 20 } = {}) {
  let items = _load().strategies;
  if (mode) items = items.filter(s => s.mode === mode);
  return { ok: true, strategies: items.slice(-limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, PORTFOLIO_DIMENSIONS, STRATEGY_MODES, updatedAt: d.updatedAt };
}

module.exports = {
  PORTFOLIO_DIMENSIONS,
  STRATEGY_MODES,
  strategize,
  getCurrentStrategy,
  getStrategy,
  listStrategies,
  getStats,
};
