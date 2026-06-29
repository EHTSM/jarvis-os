"use strict";
/**
 * hypothesisEngine.cjs — POST-Ω P18 Scientific Discovery Engine
 *
 * Generates testable hypotheses from platform telemetry, benchmarks,
 * engineering, business, customer, and infrastructure signals.
 *
 * Pipeline stage: Question → Generate Hypothesis → Design Experiment
 *
 * Reuses: discoveryPlannerEngine (plans), engineeringBenchmarkEngine,
 *         selfImprovementEngine, researchKnowledgeEngine,
 *         evolutionReasoningEngine, businessReasoningEngine,
 *         knowledgeReasoningEngine, engineeringReasoningEngine,
 *         digitalTwinEngine, analyticsService.
 *
 * Storage: data/hypotheses.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "hypotheses.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _dpe  = () => _try(() => require("./discoveryPlannerEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _okb  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _oai  = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _twin = () => _try(() => require("./digitalTwinEngine.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `hyp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const HYPOTHESIS_SOURCES = [
  "platform_telemetry",
  "benchmarks",
  "engineering",
  "business",
  "customer",
  "infrastructure",
];

const HYPOTHESIS_STATUSES = [
  "draft",
  "ready",
  "testing",
  "validated",
  "refuted",
  "inconclusive",
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { hypotheses: [], stats: { total: 0, validated: 0, refuted: 0, bySource: {} }, updatedAt: null };
  try {
    const d = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(d.hypotheses)) return defaults;
    return d;
  } catch { return defaults; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.hypotheses.length > 2000) d.hypotheses = d.hypotheses.slice(-2000);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Hypothesis builders per source ───────────────────────────────────────────

function _fromBenchmarks() {
  const hyps = [];
  try {
    const eb  = _eb();
    const baseline = eb?.ENGINEERING_BASELINE || {};
    const compare  = eb?.compareToBaseline?.() || {};
    const dims = compare.dimensions || Object.entries(baseline).map(([k, v]) => ({ name: k, score: v }));
    dims.forEach(dim => {
      const score = dim.score ?? dim.current ?? 0;
      if (score < 80) {
        hyps.push({
          source:      "benchmarks",
          domain:      "engineering",
          statement:   `Improving ${dim.name} from ${score} to 90+ will increase platform reliability by ≥15%.`,
          rationale:   `Benchmark baseline shows ${dim.name} at ${score} — below the 80-point threshold required for production excellence.`,
          measurable:  `${dim.name} score ≥90 after intervention`,
          falsifiable: `If ${dim.name} score does not increase by ≥10 points after 2 weeks of changes, the hypothesis is refuted.`,
          confidence:  Math.min(95, 60 + Math.round((80 - score) * 0.8)),
        });
      }
    });
  } catch {}
  return hyps;
}

function _fromEngineering() {
  const hyps = [];
  try {
    const pats = _sie()?.discoverPatterns?.() || {};
    (pats.patterns || []).slice(0, 5).forEach(p => {
      hyps.push({
        source:      "engineering",
        domain:      "engineering",
        statement:   `Resolving the pattern "${p.pattern.slice(0,80)}" will reduce engineering failures by ≥${Math.min(50, Math.round((p.evidence || 1) * 0.01))}%.`,
        rationale:   `Pattern observed ${p.evidence || '?'} times with ${p.confidence || 70}% confidence. ${p.suggestion || 'Investigate and fix root cause.'}`,
        measurable:  `Failure rate for this pattern drops to <5% within 30 days`,
        falsifiable: `If failure rate does not decrease ≥20% within 30 days, hypothesis is refuted.`,
        confidence:  p.confidence || 70,
      });
    });
  } catch {}
  return hyps;
}

function _fromBusiness() {
  const hyps = [];
  try {
    const obi = _obi()?.analyze?.() || {};
    const insights = obi.insights || obi.recommendations || [];
    insights.slice(0, 3).forEach(insight => {
      hyps.push({
        source:      "business",
        domain:      "business",
        statement:   `Implementing "${(insight.recommendation || insight.insight || 'business improvement').slice(0,80)}" will improve business health score by ≥10 points.`,
        rationale:   `Business reasoning engine identified this opportunity with ${insight.confidence || 75}% confidence.`,
        measurable:  `Business health score increases by ≥10 points within 60 days`,
        falsifiable: `If health score does not increase ≥5 points in 60 days, hypothesis is refuted.`,
        confidence:  insight.confidence || 75,
      });
    });
  } catch {}
  return hyps;
}

function _fromCustomer() {
  const hyps = [];
  try {
    const ana = _ana()?.getExecutive?.() || {};
    const churnRisk = ana.churnRisk || (ana.metrics?.churnRate || 0);
    if (churnRisk > 0) {
      hyps.push({
        source:      "customer",
        domain:      "customer",
        statement:   `Automated proactive customer success interventions will reduce churn risk from ${Math.round(churnRisk * 100) || 'current level'}% by ≥25%.`,
        rationale:   `Analytics reveal elevated churn risk in current customer cohort. Automated interventions via customerHealthEngine have not yet been systematically applied.`,
        measurable:  `Churn risk indicator drops by ≥25% within 30 days of intervention`,
        falsifiable: `If churn risk does not decrease ≥10% within 30 days, hypothesis is refuted.`,
        confidence:  82,
      });
    }

    const trialConversion = ana.trialConversion || ana.metrics?.conversionRate;
    if (trialConversion !== undefined) {
      hyps.push({
        source:      "customer",
        domain:      "customer",
        statement:   `Adding AI-guided onboarding checkpoints will increase trial-to-paid conversion by ≥30% from current ${typeof trialConversion === 'number' ? Math.round(trialConversion * 100) + '%' : 'baseline'}.`,
        rationale:   `Current conversion data suggests friction in onboarding flow. AI-guided checkpoints reduce time-to-value.`,
        measurable:  `Conversion rate increases ≥30% relative within 45 days`,
        falsifiable: `If conversion rate does not improve ≥15% relative, hypothesis is refuted.`,
        confidence:  78,
      });
    }
  } catch {}

  // Always include at least one customer hypothesis
  if (hyps.length === 0) {
    hyps.push({
      source:      "customer",
      domain:      "customer",
      statement:   `Automated health scoring and early warning alerts will reduce customer churn by ≥20%.`,
      rationale:   `Platform has customer health data but no automated intervention pipeline. Hypothesis tests whether automation closes this gap.`,
      measurable:  `Churn events decrease ≥20% in the 30 days following automation activation`,
      falsifiable: `If churn events do not decrease ≥10% within 30 days, hypothesis is refuted.`,
      confidence:  80,
    });
  }
  return hyps;
}

function _fromKnowledge() {
  const hyps = [];
  try {
    const stats = _rke()?.getStats?.() || {};
    const total = stats.findingsIndexed || 0;
    if (total > 0) {
      hyps.push({
        source:      "platform_telemetry",
        domain:      "knowledge",
        statement:   `Cross-referencing the ${total} indexed research findings will surface ≥3 novel algorithm improvements not yet applied to the platform.`,
        rationale:   `${total} findings are indexed but correlation analysis has not been systematically applied to detect latent algorithm improvements.`,
        measurable:  `≥3 algorithm improvement proposals generated and validated within 14 days`,
        falsifiable: `If <2 improvement proposals are generated, hypothesis is refuted.`,
        confidence:  85,
      });
    }

    const okb = _okb()?.analyze?.() || {};
    const kInsights = (okb.insights || okb.recommendations || []).slice(0, 2);
    kInsights.forEach(i => {
      hyps.push({
        source:      "platform_telemetry",
        domain:      "knowledge",
        statement:   `Applying "${(i.recommendation || i.insight || 'knowledge optimization').slice(0,80)}" will improve knowledge retrieval accuracy by ≥15%.`,
        rationale:   `Knowledge reasoning engine identified this gap with ${i.confidence || 78}% confidence.`,
        measurable:  `Knowledge retrieval precision ≥15% improvement in 30 days`,
        falsifiable: `If precision does not improve ≥5%, hypothesis is refuted.`,
        confidence:  i.confidence || 78,
      });
    });
  } catch {}
  return hyps;
}

function _fromInfrastructure() {
  const hyps = [];
  try {
    const oai = _oai()?.analyze?.() || {};
    const recs = (oai.insights || oai.recommendations || []).slice(0, 2);
    recs.forEach(r => {
      hyps.push({
        source:      "infrastructure",
        domain:      "infrastructure",
        statement:   `Applying "${(r.recommendation || r.insight || 'infrastructure improvement').slice(0,80)}" will improve system uptime by ≥2 nines.`,
        rationale:   `Engineering reasoning analysis identified this infrastructure pattern with ${r.confidence || 80}% confidence.`,
        measurable:  `System availability SLO improves by ≥0.5% within 30 days`,
        falsifiable: `If availability does not improve ≥0.2%, hypothesis is refuted.`,
        confidence:  r.confidence || 80,
      });
    });
  } catch {}

  if (hyps.length === 0) {
    hyps.push({
      source:      "infrastructure",
      domain:      "infrastructure",
      statement:   `Automated circuit-breaker configuration will reduce infrastructure failure cascades by ≥40%.`,
      rationale:   `Engineering reasoning shows current circuit-breaker strategy is sub-optimal. Automated tuning via self-healing engine can improve cascade prevention.`,
      measurable:  `Cascading failure rate drops ≥40% within 21 days of automated tuning`,
      falsifiable: `If cascade rate does not drop ≥20%, hypothesis is refuted.`,
      confidence:  88,
    });
  }
  return hyps;
}

// ── Core: generate ────────────────────────────────────────────────────────────

function generate({ sources } = {}) {
  const allowed = sources ? HYPOTHESIS_SOURCES.filter(s => sources.includes(s)) : HYPOTHESIS_SOURCES;

  const raw = [];
  if (allowed.includes("benchmarks"))        raw.push(..._fromBenchmarks());
  if (allowed.includes("engineering"))       raw.push(..._fromEngineering());
  if (allowed.includes("business"))          raw.push(..._fromBusiness());
  if (allowed.includes("customer"))          raw.push(..._fromCustomer());
  if (allowed.includes("platform_telemetry")) raw.push(..._fromKnowledge());
  if (allowed.includes("infrastructure"))    raw.push(..._fromInfrastructure());

  const hyps = raw.map(h => ({
    id:          _id(),
    source:      h.source,
    domain:      h.domain,
    statement:   h.statement,
    rationale:   h.rationale,
    measurable:  h.measurable,
    falsifiable: h.falsifiable,
    confidence:  h.confidence || 75,
    status:      "draft",
    experimentId: null,
    generatedAt: _ts(),
    validatedAt: null,
  }));

  if (hyps.length === 0) return { ok: true, generated: 0, hypotheses: [] };

  const d = _load();
  const dedup = new Map(d.hypotheses.map(h => [h.statement.slice(0, 60), h]));
  hyps.forEach(h => dedup.set(h.statement.slice(0, 60), h));
  d.hypotheses = [...dedup.values()];

  // Stats
  const bySource = {};
  HYPOTHESIS_SOURCES.forEach(s => { bySource[s] = 0; });
  d.hypotheses.forEach(h => { if (bySource[h.source] !== undefined) bySource[h.source]++; });
  d.stats = {
    total:     d.hypotheses.length,
    validated: d.hypotheses.filter(h => h.status === "validated").length,
    refuted:   d.hypotheses.filter(h => h.status === "refuted").length,
    bySource,
  };
  _save(d);

  return { ok: true, generated: hyps.length, total: d.hypotheses.length, hypotheses: hyps };
}

function updateStatus(id, status, { experimentId, note } = {}) {
  if (!HYPOTHESIS_STATUSES.includes(status)) return { ok: false, error: `Unknown status: ${status}` };
  const d = _load();
  const h = d.hypotheses.find(x => x.id === id);
  if (!h) return { ok: false, error: `Hypothesis ${id} not found` };
  h.status = status;
  if (experimentId) h.experimentId = experimentId;
  if (status === "validated" || status === "refuted") h.validatedAt = _ts();
  if (note) h.note = note;
  d.stats.validated = d.hypotheses.filter(x => x.status === "validated").length;
  d.stats.refuted   = d.hypotheses.filter(x => x.status === "refuted").length;
  _save(d);
  return { ok: true, hypothesis: h };
}

function getHypothesis(id) {
  return _load().hypotheses.find(h => h.id === id) || null;
}

function listHypotheses({ source, domain, status, limit = 50 } = {}) {
  let items = _load().hypotheses;
  if (source) items = items.filter(h => h.source === source);
  if (domain) items = items.filter(h => h.domain === domain);
  if (status) items = items.filter(h => h.status === status);
  return { ok: true, hypotheses: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  const all = d.hypotheses;
  const avgConf = all.length ? Math.round(all.reduce((s, h) => s + h.confidence, 0) / all.length) : 0;
  return { ...d.stats, avgConfidence: avgConf, HYPOTHESIS_SOURCES, HYPOTHESIS_STATUSES, updatedAt: d.updatedAt };
}

module.exports = {
  HYPOTHESIS_SOURCES,
  HYPOTHESIS_STATUSES,
  generate,
  updateStatus,
  getHypothesis,
  listHypotheses,
  getStats,
};
