"use strict";
/**
 * discoveryPlannerEngine.cjs — POST-Ω P18 Scientific Discovery Engine
 *
 * Converts platform observations into structured research questions and
 * discovery plans. Acts as the entry point of the scientific pipeline:
 *   Observe → Question → Generate Hypothesis.
 *
 * Reuses: selfImprovementEngine (patterns), engineeringBenchmarkEngine (baselines),
 *         researchKnowledgeEngine (114 findings), knowledgeFederationEngine,
 *         evolutionReasoningEngine, engineeringReasoningEngine,
 *         businessReasoningEngine, knowledgeReasoningEngine,
 *         analyticsService, workforceManager.
 *
 * Storage: data/discovery-plans.json
 */

const fs   = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "discovery-plans.json");

const _try = fn => { try { return fn(); } catch { return null; } };

const _sie  = () => _try(() => require("./selfImprovementEngine.cjs"));
const _eb   = () => _try(() => require("./engineeringBenchmarkEngine.cjs"));
const _rke  = () => _try(() => require("./researchKnowledgeEngine.cjs"));
const _kfe  = () => _try(() => require("./knowledgeFederationEngine.cjs"));
const _ose  = () => _try(() => require("./evolutionReasoningEngine.cjs"));
const _er   = () => _try(() => require("./engineeringReasoningEngine.cjs"));
const _obi  = () => _try(() => require("./businessReasoningEngine.cjs"));
const _okb  = () => _try(() => require("./knowledgeReasoningEngine.cjs"));
const _ana  = () => _try(() => require("./analyticsService.cjs"));
const _wf   = () => _try(() => require("./workforceManager.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `dp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`; }

const DISCOVERY_DOMAINS = [
  "engineering",     // code quality, architecture, performance
  "business",        // revenue, growth, efficiency
  "customer",        // behavior, retention, satisfaction
  "infrastructure",  // reliability, cost, latency
  "ai_capabilities", // model quality, automation, accuracy
  "knowledge",       // knowledge coverage, recall, correlation
];

const QUESTION_TYPES = [
  "why",        // root cause
  "how",        // mechanism
  "what_if",    // counterfactual
  "how_much",   // quantitative
  "can_we",     // feasibility
];

// ── Storage ───────────────────────────────────────────────────────────────────

function _load() {
  const defaults = { plans: [], stats: { total: 0, byDomain: {}, byQuestionType: {} }, updatedAt: null };
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

// ── Observation collectors ────────────────────────────────────────────────────

function _collectObservations() {
  const observations = [];

  // 1. SIE patterns → research questions
  try {
    const pats = _sie()?.discoverPatterns?.() || {};
    (pats.patterns || []).forEach(p => {
      observations.push({
        source:     "selfImprovementEngine",
        domain:     "engineering",
        signal:     p.pattern,
        evidence:   p.evidence || 0,
        confidence: p.confidence || 50,
        suggested:  "why",
      });
    });
  } catch {}

  // 2. Benchmark deviations → quantitative questions
  try {
    const baseline = _eb()?.ENGINEERING_BASELINE || {};
    Object.entries(baseline).forEach(([dim, val]) => {
      if (typeof val === "number" && val < 70) {
        observations.push({
          source:     "engineeringBenchmarkEngine",
          domain:     "engineering",
          signal:     `${dim} score below threshold: ${val}`,
          evidence:   1,
          confidence: 85,
          suggested:  "how_much",
        });
      }
    });
  } catch {}

  // 3. RKE findings → open questions
  try {
    const f = _rke()?.getFindings?.({ limit: 10 }) || {};
    (f.findings || []).forEach(finding => {
      observations.push({
        source:     "researchKnowledgeEngine",
        domain:     finding.domain || "engineering",
        signal:     finding.finding || finding.topic,
        evidence:   finding.confidence || 75,
        confidence: finding.confidence || 75,
        suggested:  "how",
      });
    });
  } catch {}

  // 4. Evolution reasoning → what_if questions
  try {
    const ose = _ose()?.getStats?.() || {};
    if ((ose.total || 0) > 0) {
      observations.push({
        source:     "evolutionReasoningEngine",
        domain:     "ai_capabilities",
        signal:     `${ose.total} evolution analyses completed — what improvements are possible?`,
        evidence:   ose.total,
        confidence: 80,
        suggested:  "what_if",
      });
    }
  } catch {}

  // 5. Knowledge federation → knowledge gap questions
  try {
    const kfe = _kfe()?.getStats?.() || {};
    const coverage = kfe.coveragePct || 0;
    if (coverage < 90) {
      observations.push({
        source:     "knowledgeFederationEngine",
        domain:     "knowledge",
        signal:     `Knowledge coverage at ${coverage}% — gaps exist across federated sources`,
        evidence:   1,
        confidence: 90,
        suggested:  "can_we",
      });
    }
  } catch {}

  return observations;
}

// ── Plan builder ──────────────────────────────────────────────────────────────

function _buildQuestion(obs) {
  const templates = {
    why:       `Why does "${obs.signal.slice(0,60)}" occur in the ${obs.domain} domain?`,
    how:       `How can we improve "${obs.signal.slice(0,60)}" within the ${obs.domain} domain?`,
    what_if:   `What if we changed the approach to "${obs.signal.slice(0,60)}"?`,
    how_much:  `How much improvement is achievable in "${obs.signal.slice(0,60)}"?`,
    can_we:    `Can we address "${obs.signal.slice(0,60)}" systematically?`,
  };
  return templates[obs.suggested] || templates.how;
}

// ── Core: plan ────────────────────────────────────────────────────────────────

function plan() {
  const observations = _collectObservations();
  if (observations.length === 0) {
    return { ok: true, found: 0, plans: [], message: "No observations to plan from" };
  }

  const plans = observations.map(obs => ({
    id:           _id(),
    domain:       obs.domain,
    source:       obs.source,
    observation:  obs.signal.slice(0, 200),
    question:     _buildQuestion(obs),
    questionType: obs.suggested,
    evidence:     obs.evidence,
    confidence:   obs.confidence,
    priority:     obs.confidence >= 90 ? "high" : obs.confidence >= 70 ? "medium" : "low",
    status:       "pending",
    plannedAt:    _ts(),
  }));

  const d = _load();
  const dedup = new Map(d.plans.map(p => [p.domain + ':' + p.observation.slice(0, 50), p]));
  plans.forEach(p => dedup.set(p.domain + ':' + p.observation.slice(0, 50), p));
  d.plans = [...dedup.values()];

  const byDomain = {};
  DISCOVERY_DOMAINS.forEach(dom => { byDomain[dom] = 0; });
  d.plans.forEach(p => { if (byDomain[p.domain] !== undefined) byDomain[p.domain]++; });
  const byQuestionType = {};
  QUESTION_TYPES.forEach(t => { byQuestionType[t] = 0; });
  d.plans.forEach(p => { if (byQuestionType[p.questionType] !== undefined) byQuestionType[p.questionType]++; });
  d.stats = { total: d.plans.length, byDomain, byQuestionType };
  _save(d);

  return { ok: true, found: plans.length, total: d.plans.length, plans };
}

function getPlan(id) {
  return _load().plans.find(p => p.id === id) || null;
}

function listPlans({ domain, priority, limit = 50 } = {}) {
  let items = _load().plans;
  if (domain)   items = items.filter(p => p.domain === domain);
  if (priority) items = items.filter(p => p.priority === priority);
  return { ok: true, plans: items.slice(0, limit), total: items.length };
}

function getStats() {
  const d = _load();
  return { ...d.stats, DISCOVERY_DOMAINS, QUESTION_TYPES, updatedAt: d.updatedAt };
}

module.exports = {
  DISCOVERY_DOMAINS,
  QUESTION_TYPES,
  plan,
  getPlan,
  listPlans,
  getStats,
};
