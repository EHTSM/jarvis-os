"use strict";
/**
 * infrastructureOptimizationEngine.cjs — POST-Ω P19 Global Infrastructure Orchestrator
 *
 * Recommends: cost optimization, scaling, consolidation, redundancy.
 * Pipeline stages: Optimize → Learn
 *
 * Reuses: infrastructureRegistryEngine, infrastructurePlannerEngine,
 *         infrastructureHealthEngine, capitalAllocationEngine,
 *         investmentDashboard, revenueDashboard, riskAssessmentEngine,
 *         engineeringBenchmarkEngine, selfImprovementEngine,
 *         innovationEngine, scientificDiscoveryDashboard.
 *
 * Storage: data/infrastructure-optimization.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "infrastructure-optimization.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _reg  = () => _try(() => require("./infrastructureRegistryEngine.cjs"));
const _planner = () => _try(() => require("./infrastructurePlannerEngine.cjs"));
const _he   = () => _try(() => require("./infrastructureHealthEngine.cjs"));
const _cap  = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _inv  = () => _try(() => require("./investmentDashboard.cjs"));
const _rev  = () => _try(() => require("./revenueDashboard.cjs"));
const _risk = () => _try(() => require("./riskAssessmentEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _inn  = () => _try(() => require("./innovationEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `opt_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const OPTIMIZATION_TYPES = [
  "cost",        // reduce spend
  "scaling",     // add/remove capacity
  "consolidation", // merge resources
  "redundancy",  // add failover paths
  "performance", // improve speed/latency
  "security",    // harden attack surface
];

const OPTIMIZATION_STATUSES = ["pending", "applied", "rejected", "deferred"];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = {
    optimizations: [],
    stats: { total: 0, applied: 0, byType: {}, estimatedMonthlySavings: 0 },
    updatedAt: null,
  };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.optimizations)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.optimizations.length > 1000) d.optimizations = d.optimizations.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Optimization generators ───────────────────────────────────────────────────

function _costOptimizations() {
  const opts = [];
  try {
    const regStats = _reg()?.getStats?.() || {};
    const inactive  = (regStats.byStatus?.inactive || 0);
    if (inactive > 0) {
      opts.push({
        type:            "cost",
        title:           `Terminate ${inactive} inactive infrastructure resources`,
        rationale:       `${inactive} resources are registered as inactive and not serving traffic. Removing them saves compute cost.`,
        monthlySavings:  inactive * 15,
        effort:          "low",
        risk:            "low",
        actions:         ["audit_inactive_resources", "confirm_no_traffic", "deregister", "terminate_instances"],
      });
    }

    const alloc = _cap()?.getCurrentAllocation?.() || {};
    const infraAlloc = (alloc.allocations || []).find(a => a.category === "infrastructure");
    if (infraAlloc && infraAlloc.utilization < 60) {
      opts.push({
        type:            "cost",
        title:           "Downsize underutilized VPS instances",
        rationale:       `Infrastructure budget utilization at ${infraAlloc.utilization || '?'}%. Downsizing can cut costs 20-30%.`,
        monthlySavings:  30,
        effort:          "medium",
        risk:            "low",
        actions:         ["benchmark_current_utilization", "identify_downsizeable", "resize_instances", "monitor_performance"],
      });
    }
  } catch {}
  return opts;
}

function _scalingOptimizations() {
  const opts = [];
  try {
    const health = _he()?.getStats?.() || {};
    const avgScore = health.avgHealthScore || 80;
    if (avgScore < 70) {
      opts.push({
        type:            "scaling",
        title:           "Horizontal scale-out to address health degradation",
        rationale:       `Average infrastructure health score at ${avgScore}/100. Adding capacity can absorb load spikes.`,
        monthlySavings:  -20, // negative = additional cost but improves availability
        effort:          "medium",
        risk:            "medium",
        actions:         ["identify_bottleneck_resources", "provision_additional_capacity", "update_load_balancer", "validate_health"],
      });
    }

    const bench = _eb()?.ENGINEERING_BASELINE || {};
    if ((bench.scalability || 100) < 75) {
      opts.push({
        type:            "scaling",
        title:           "Enable auto-scaling policies for variable workloads",
        rationale:       `Scalability benchmark at ${bench.scalability || '?'}/100. Auto-scaling eliminates manual capacity management.`,
        monthlySavings:  0,
        effort:          "medium",
        risk:            "low",
        actions:         ["configure_autoscaling_rules", "set_scaling_triggers", "test_scale_up", "test_scale_down"],
      });
    }
  } catch {}
  return opts;
}

function _consolidationOptimizations() {
  const opts = [];
  try {
    const regStats = _reg()?.getStats?.() || {};
    const envs = regStats.byEnvironment || {};
    const devResources = envs.development || 0;
    if (devResources > 5) {
      opts.push({
        type:            "consolidation",
        title:           `Consolidate ${devResources} development environment resources`,
        rationale:       `${devResources} development resources running. Use shared dev environment to reduce overhead.`,
        monthlySavings:  devResources * 5,
        effort:          "low",
        risk:            "low",
        actions:         ["audit_dev_environments", "merge_to_shared_dev", "update_team_access", "deregister_old"],
      });
    }

    // Multi-region consolidation if single-region suffices
    const regions = Object.entries(regStats.byRegion || {}).filter(([,v]) => v > 0);
    if (regions.length > 2) {
      opts.push({
        type:            "consolidation",
        title:           `Consolidate from ${regions.length} regions to primary + DR`,
        rationale:       `Resources spread across ${regions.length} regions adds complexity and cost. Consolidate to 2 regions.`,
        monthlySavings:  25,
        effort:          "high",
        risk:            "medium",
        actions:         ["map_traffic_by_region", "migrate_to_primary", "keep_dr_region", "update_routing"],
      });
    }
  } catch {}
  return opts;
}

function _redundancyOptimizations() {
  const opts = [];
  try {
    const regStats = _reg()?.getStats?.() || {};
    const byType = regStats.byType || {};

    if ((byType.ssl || 0) < 1) {
      opts.push({
        type:            "redundancy",
        title:           "Enable SSL certificate auto-renewal",
        rationale:       "No SSL auto-renewal configured. Manual renewal is a reliability risk.",
        monthlySavings:  0,
        effort:          "low",
        risk:            "low",
        actions:         ["configure_certbot", "enable_auto_renewal", "test_renewal", "alert_on_expiry"],
      });
    }

    if ((byType.vps || 0) < 2) {
      opts.push({
        type:            "redundancy",
        title:           "Add secondary VPS for high availability",
        rationale:       "Single VPS = single point of failure. Add failover VPS in secondary region.",
        monthlySavings:  -20, // cost increase for redundancy
        effort:          "medium",
        risk:            "low",
        actions:         ["provision_secondary_vps", "configure_load_balancer", "test_failover", "update_dns"],
      });
    }
  } catch {}
  return opts;
}

function _performanceOptimizations() {
  const opts = [];
  try {
    const health = _he()?.getStats?.() || {};
    const dims   = health.byDimension || {};
    const networkScore = dims.network || 80;
    if (networkScore < 70) {
      opts.push({
        type:            "performance",
        title:           "Enable CDN for static asset delivery",
        rationale:       `Network health score at ${networkScore}/100. CDN caching reduces latency and server load.`,
        monthlySavings:  10,
        effort:          "low",
        risk:            "low",
        actions:         ["configure_cdn_rules", "push_assets_to_cdn", "update_origins", "validate_cache_hit_rate"],
      });
    }
  } catch {}
  return opts;
}

// ── Core: optimize ────────────────────────────────────────────────────────────

function optimize() {
  const raw = [
    ..._costOptimizations(),
    ..._scalingOptimizations(),
    ..._consolidationOptimizations(),
    ..._redundancyOptimizations(),
    ..._performanceOptimizations(),
  ];

  if (raw.length === 0) return { ok: true, found: 0, optimizations: [] };

  const optimizations = raw.map(o => ({
    id:              _id(),
    type:            o.type,
    title:           o.title,
    rationale:       o.rationale,
    actions:         o.actions || [],
    monthlySavings:  o.monthlySavings || 0,
    effort:          o.effort || "medium",
    risk:            o.risk || "medium",
    status:          "pending",
    discoveredAt:    _ts(),
    appliedAt:       null,
  }));

  const d = _load();
  const dedup = new Map(d.optimizations.map(o => [o.title.slice(0, 60), o]));
  optimizations.forEach(o => dedup.set(o.title.slice(0, 60), o));
  d.optimizations = [...dedup.values()];

  const byType = {};
  OPTIMIZATION_TYPES.forEach(t => { byType[t] = 0; });
  d.optimizations.forEach(o => { if (byType[o.type] !== undefined) byType[o.type]++; });
  const monthlySavings = d.optimizations
    .filter(o => o.status === "pending" || o.status === "applied")
    .reduce((sum, o) => sum + (o.monthlySavings || 0), 0);

  d.stats = {
    total:                   d.optimizations.length,
    applied:                 d.optimizations.filter(o => o.status === "applied").length,
    byType,
    estimatedMonthlySavings: monthlySavings,
  };
  _save(d);

  // Record innovations from optimizations
  try {
    _inn()?.recordInnovation?.({
      title:       `Infrastructure optimization: ${optimizations.length} recommendations`,
      type:        "platform_innovation",
      description: `Identified ${optimizations.length} infrastructure optimization opportunities. Est. monthly savings: $${monthlySavings}`,
      confidence:  80,
      impact:      monthlySavings > 50 ? "high" : "medium",
      source:      "infrastructureOptimizationEngine",
    });
  } catch {}

  return { ok: true, found: optimizations.length, total: d.optimizations.length, optimizations, estimatedMonthlySavings: monthlySavings };
}

function applyOptimization(id) {
  const d = _load();
  const o = d.optimizations.find(x => x.id === id);
  if (!o) return { ok: false, error: `Optimization ${id} not found` };
  o.status    = "applied";
  o.appliedAt = _ts();
  d.stats.applied = d.optimizations.filter(x => x.status === "applied").length;
  _save(d);
  return { ok: true, optimization: o };
}

function getOptimization(id) {
  return _load().optimizations.find(o => o.id === id) || null;
}

function listOptimizations({ type, status, limit = 50 } = {}) {
  let items = _load().optimizations;
  if (type)   items = items.filter(o => o.type === type);
  if (status) items = items.filter(o => o.status === status);
  return { ok: true, optimizations: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, OPTIMIZATION_TYPES, OPTIMIZATION_STATUSES, updatedAt: d.updatedAt };
}

module.exports = {
  OPTIMIZATION_TYPES,
  OPTIMIZATION_STATUSES,
  optimize,
  applyOptimization,
  getOptimization,
  listOptimizations,
  getStats,
};
