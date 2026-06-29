"use strict";
/**
 * infrastructurePlannerEngine.cjs — POST-Ω P19 Global Infrastructure Orchestrator
 *
 * Converts infrastructure state + platform intelligence into actionable plans:
 *   Discover → Register → Assess → Plan → Deploy
 *
 * Reuses: infrastructureRegistryEngine, riskAssessmentEngine, capitalAllocationEngine,
 *         engineeringBenchmarkEngine, selfImprovementEngine, researchKnowledgeEngine,
 *         evolutionReasoningEngine, engineeringReasoningEngine, analyticsService,
 *         investmentDashboard, scientificDiscoveryDashboard.
 *
 * Storage: data/infrastructure-plans.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "infrastructure-plans.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _reg  = () => _try(() => require("./infrastructureRegistryEngine.cjs"));
const _risk = () => _try(() => require("./riskAssessmentEngine.cjs"));
const _cap  = () => _try(() => require("./capitalAllocationEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _oai  = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `ip_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const PLAN_TYPES = [
  "scaling",        // add capacity
  "consolidation",  // merge/reduce resources
  "redundancy",     // add failover
  "cost_reduction", // eliminate waste
  "security",       // harden infrastructure
  "migration",      // move between providers
  "upgrade",        // version/config upgrades
];

const PLAN_PRIORITIES = ["critical", "high", "medium", "low"];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { plans: [], stats: { total: 0, byType: {}, byPriority: {}, executed: 0 }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.plans)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.plans.length > 1000) d.plans = d.plans.slice(-1000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Plan generators ───────────────────────────────────────────────────────────

function _plansFromRegistry() {
  const plans = [];
  try {
    const stats = _reg()?.getStats?.() || {};
    const { byStatus = {}, byType = {}, total = 0 } = stats;

    // Degraded resources → immediate plan
    if ((byStatus.degraded || 0) > 0) {
      plans.push({
        type:        "redundancy",
        priority:    "critical",
        title:       `Restore ${byStatus.degraded} degraded infrastructure resources`,
        rationale:   `${byStatus.degraded} resource(s) in degraded status detected. Immediate redundancy or recovery required.`,
        actions:     ["run_health_scan", "isolate_degraded", "route_to_healthy", "alert_operator"],
        estimatedCost: 0,
        estimatedImpact: "restore_availability",
        resourceTypes:   ["all"],
      });
    }

    // Under-represented resource types → scaling plan
    if (total > 0 && (byType.vps || 0) < 2) {
      plans.push({
        type:        "redundancy",
        priority:    "high",
        title:       "Add VPS redundancy — single point of failure detected",
        rationale:   `Only ${byType.vps || 0} VPS registered. Production requires ≥2 for HA.`,
        actions:     ["provision_secondary_vps", "configure_load_balancer", "update_dns_failover"],
        estimatedCost: 20,
        estimatedImpact: "eliminate_single_point_of_failure",
        resourceTypes: ["vps"],
      });
    }

    // No CDN → cost optimization via CDN
    if ((byType.cdn || 0) === 0 && (byType.cloudflare || 0) === 0) {
      plans.push({
        type:        "cost_reduction",
        priority:    "medium",
        title:       "Enable CDN to reduce bandwidth costs",
        rationale:   "No CDN configured. Estimated 30-40% bandwidth cost reduction achievable.",
        actions:     ["provision_cloudflare", "update_dns_to_cf", "configure_cache_rules"],
        estimatedCost: 0,
        estimatedImpact: "reduce_bandwidth_cost_30pct",
        resourceTypes: ["cloudflare", "cdn"],
      });
    }
  } catch {}
  return plans;
}

function _plansFromRisk() {
  const plans = [];
  try {
    const risk = _risk()?.assess?.() || {};
    const dims  = risk.dimensions || [];
    dims.forEach(dim => {
      if ((dim.level || 0) >= 3) { // high or critical
        plans.push({
          type:        "security",
          priority:    dim.level >= 4 ? "critical" : "high",
          title:       `Mitigate ${dim.dimension} risk (level: ${dim.dimension === 3 ? 'high' : 'critical'})`,
          rationale:   dim.mitigation || `${dim.dimension} risk factor at high/critical level. Immediate mitigation required.`,
          actions:     ["assess_blast_radius", "apply_mitigation", "monitor_resolution", "document_incident"],
          estimatedCost: 0,
          estimatedImpact: "risk_reduction",
          resourceTypes: ["all"],
        });
      }
    });
  } catch {}
  return plans;
}

function _plansFromBenchmarks() {
  const plans = [];
  try {
    const base = _eb()?.ENGINEERING_BASELINE || {};
    if ((base.reliability || 100) < 80) {
      plans.push({
        type:        "redundancy",
        priority:    "high",
        title:       `Infrastructure reliability below threshold (${base.reliability || '?'}/100)`,
        rationale:   "Engineering benchmark shows reliability below 80. Add redundancy and circuit breakers.",
        actions:     ["audit_spofs", "add_health_checks", "configure_circuit_breakers", "add_alerting"],
        estimatedCost: 0,
        estimatedImpact: "improve_reliability_to_90+",
        resourceTypes: ["all"],
      });
    }
    if ((base.scalability || 100) < 75) {
      plans.push({
        type:        "scaling",
        priority:    "medium",
        title:       `Infrastructure scalability below threshold (${base.scalability || '?'}/100)`,
        rationale:   "Scalability benchmark indicates insufficient horizontal scaling capacity.",
        actions:     ["enable_auto_scaling", "add_load_balancer", "review_db_connection_pool"],
        estimatedCost: 10,
        estimatedImpact: "improve_scalability_to_85+",
        resourceTypes: ["vps", "kubernetes", "database"],
      });
    }
  } catch {}
  return plans;
}

function _plansFromCapitalAllocation() {
  const plans = [];
  try {
    const alloc = _cap()?.getCurrentAllocation?.() || {};
    const infra = (alloc.allocations || []).find(a => a.category === "infrastructure");
    if (infra && infra.utilization < 50) {
      plans.push({
        type:        "consolidation",
        priority:    "low",
        title:       "Infrastructure budget under-utilized — consolidate resources",
        rationale:   `Infrastructure budget utilization at ${infra.utilization || '?'}%. Consolidate idle resources to reduce cost.`,
        actions:     ["audit_idle_resources", "terminate_underused", "reallocate_budget", "update_registry"],
        estimatedCost: -50, // negative = savings
        estimatedImpact: "reduce_infra_cost_20pct",
        resourceTypes: ["vps", "storage", "database"],
      });
    }
  } catch {}
  return plans;
}

function _plansFromEvolution() {
  const plans = [];
  try {
    const ose  = _ose()?.analyze?.() || {};
    const recs = (ose.recommendations || ose.insights || []).filter(r =>
      (r.recommendation || r.insight || '').toLowerCase().includes('infra') ||
      (r.recommendation || r.insight || '').toLowerCase().includes('deploy') ||
      (r.recommendation || r.insight || '').toLowerCase().includes('scale')
    ).slice(0, 2);
    recs.forEach(r => {
      plans.push({
        type:        "upgrade",
        priority:    "low",
        title:       `Evolutionary upgrade: ${(r.recommendation || r.insight || 'infrastructure improvement').slice(0, 70)}`,
        rationale:   r.recommendation || r.insight || "OSE recommends infrastructure evolution.",
        actions:     ["evaluate_change", "run_in_staging", "apply_to_production", "validate"],
        estimatedCost: 0,
        estimatedImpact: "platform_evolution",
        resourceTypes: ["all"],
      });
    });
  } catch {}
  return plans;
}

// ── Core: plan ────────────────────────────────────────────────────────────────

function plan() {
  const raw = [
    ..._plansFromRegistry(),
    ..._plansFromRisk(),
    ..._plansFromBenchmarks(),
    ..._plansFromCapitalAllocation(),
    ..._plansFromEvolution(),
  ];

  const plans = raw.map(p => ({
    id:              _id(),
    type:            p.type,
    priority:        p.priority,
    title:           p.title,
    rationale:       p.rationale,
    actions:         p.actions || [],
    estimatedCost:   p.estimatedCost || 0,
    estimatedImpact: p.estimatedImpact || "unknown",
    resourceTypes:   p.resourceTypes || ["all"],
    status:          "pending",
    createdAt:       _ts(),
    executedAt:      null,
  }));

  const d = _load();
  const dedup = new Map(d.plans.map(p => [p.title.slice(0, 60), p]));
  plans.forEach(p => dedup.set(p.title.slice(0, 60), p));
  d.plans = [...dedup.values()];

  const byType     = {};
  const byPriority = {};
  PLAN_TYPES.forEach(t => { byType[t] = 0; });
  PLAN_PRIORITIES.forEach(p => { byPriority[p] = 0; });
  d.plans.forEach(p => {
    if (byType[p.type]         !== undefined) byType[p.type]++;
    if (byPriority[p.priority] !== undefined) byPriority[p.priority]++;
  });
  d.stats = { total: d.plans.length, byType, byPriority, executed: d.plans.filter(p => p.status === "executed").length };
  _save(d);

  return { ok: true, found: plans.length, total: d.plans.length, plans };
}

function markExecuted(id) {
  const d = _load();
  const p = d.plans.find(x => x.id === id);
  if (!p) return { ok: false, error: `Plan ${id} not found` };
  p.status     = "executed";
  p.executedAt = _ts();
  d.stats.executed = d.plans.filter(x => x.status === "executed").length;
  _save(d);
  return { ok: true, plan: p };
}

function getPlan(id) {
  return _load().plans.find(p => p.id === id) || null;
}

function listPlans({ type, priority, status, limit = 50 } = {}) {
  let items = _load().plans;
  if (type)     items = items.filter(p => p.type === type);
  if (priority) items = items.filter(p => p.priority === priority);
  if (status)   items = items.filter(p => p.status === status);
  return { ok: true, plans: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, PLAN_TYPES, PLAN_PRIORITIES, updatedAt: d.updatedAt };
}

module.exports = {
  PLAN_TYPES,
  PLAN_PRIORITIES,
  plan,
  markExecuted,
  getPlan,
  listPlans,
  getStats,
};
