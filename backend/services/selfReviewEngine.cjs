"use strict";
/**
 * selfReviewEngine.cjs — POST-Ω Sprint P1
 *
 * Weekly self-review that scores the platform across 9 dimensions.
 * Reads exclusively from existing data sources — no new infrastructure.
 *
 * Scores: architecture, autonomy, technicalDebt, reliability,
 *         performance, founderTimeSaved, customerImpact, consolidation, security
 */

const fs   = require("fs");
const path = require("path");

// ── Lazy accessors to existing services ──────────────────────────────────────
const _try = fn => { try { return fn(); } catch { return null; } };
const _il  = () => _try(() => require("./intelligenceLayer.cjs"));
const _le  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ast = () => _try(() => require("./autonomousState.cjs"));
const _plt = () => _try(() => require("./platformState.cjs"));
const _uil = () => _try(() => require("./unifiedIntelligenceLayer.cjs"));
const _sup = () => _try(() => require("./agentRuntimeSupervisor.cjs"));
const _sh  = () => _try(() => require("./securityHardening.cjs"));

// ── Data file ─────────────────────────────────────────────────────────────────
const DATA_FILE = path.join(__dirname, "../../data/self-review.json");

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")); }
  catch { return { reviews: [], sprints: [], lastReviewAt: null }; }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2));
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function _scoreArchitecture() {
  // Measures: service count, duplicate detection, route coverage, layer health
  const signals = [];
  let score = 100;

  // Layer health from L10 autonomous state
  const snap = _try(() => _ast()?.getGlobalHealthSnapshot?.()) || {};
  const layerHealth = snap.score ?? 70;
  score = Math.min(score, 40 + layerHealth * 0.6);

  // Platform analytics — org/blueprint/deployment coverage
  const analytics = _try(() => _plt()?.getPlatformAnalytics?.()) || {};
  if (analytics.orgs?.total > 0)       signals.push("org_registry_populated");
  if (analytics.blueprints?.total > 0) signals.push("blueprints_defined");
  if (analytics.deployments?.total > 0) signals.push("deployments_executed");

  // Intelligence layer available
  const corr = _try(() => _il()?.getCorrelations?.());
  if (corr?.correlations) { score = Math.min(score + 5, 100); signals.push("intelligence_layer_active"); }

  return { score: Math.round(Math.max(0, Math.min(100, score))), signals };
}

function _scoreAutonomy() {
  // Measures: autonomous cycle count, decision volume, experiment rate, agent uptime
  const ast = _ast();
  if (!ast) return { score: 50, signals: ["autonomousState_unavailable"] };

  const snap    = _try(() => ast.getGlobalHealthSnapshot?.()) || {};
  const ctrl    = _try(() => ast.getControlState?.())         || {};
  const dStats  = _try(() => ast.getDecisionStats?.())        || {};
  const signals = [];
  let score = 0;

  // Cycle history
  const cycle = snap.cycle ?? ctrl.cycle ?? 0;
  score += Math.min(30, cycle * 2); // up to 30pts for 15+ cycles
  if (cycle > 0) signals.push(`${cycle}_autonomous_cycles`);

  // Decision volume
  const decisions = dStats.total ?? 0;
  score += Math.min(25, decisions);
  if (decisions > 5) signals.push(`${decisions}_decisions_recorded`);

  // Experiment rate
  const exps = _try(() => ast.listExperiments?.()) || [];
  const concluded = exps.filter(e => ["completed","rolled_back"].includes(e.status)).length;
  score += Math.min(20, concluded * 5);
  if (concluded > 0) signals.push(`${concluded}_experiments_concluded`);

  // Agent uptime
  const sup = _sup();
  const agents = _try(() => sup?.listAgents?.()) || [];
  const activeAgents = agents.filter(a => a.status === "active" || a.status === "registered").length;
  const uptimeScore = agents.length > 0 ? Math.round((activeAgents / agents.length) * 25) : 0;
  score += uptimeScore;
  if (activeAgents > 0) signals.push(`${activeAgents}/${agents.length}_agents_active`);

  return { score: Math.round(Math.max(0, Math.min(100, score))), signals };
}

function _scoreTechnicalDebt() {
  // Measures: known placeholders, correlation errors, unresolved lessons, failure rate
  const signals = [];
  let debt = 0; // debt points accumulate; score = 100 - debt

  // Check if intelligence layer correlations are working (fixed in Sprint P1)
  const corr = _try(() => _il()?.getCorrelations?.());
  if (!corr) { debt += 15; signals.push("intelligence_layer_unreachable"); }
  else        signals.push("intelligence_layer_healthy");

  // Unresolved decisions (pending > 24h)
  const decisions = _try(() => _ast()?.listDecisions?.({ status: "pending" })) || [];
  const stale = decisions.filter(d => Date.now() - new Date(d.createdAt).getTime() > 86400000);
  debt += Math.min(20, stale.length * 2);
  if (stale.length > 0) signals.push(`${stale.length}_stale_decisions`);

  // Unresolved lessons (no action taken)
  const lesRaw = _try(() => _le()?.getLessons?.()) || [];
  const les = Array.isArray(lesRaw) ? lesRaw : (lesRaw?.lessons || []);
  const unactioned = les.filter(l => !l.actionTaken && !l.dismissed).slice(-50).length;
  debt += Math.min(15, Math.round(unactioned * 0.3));
  if (unactioned > 10) signals.push(`${unactioned}_unactioned_lessons`);

  // Known placeholder count — static audit of key files
  const PLACEHOLDER_PATTERNS = [/TODO/g, /placeholder/g, /not implemented/gi, /FIXME/g];
  const AUDIT_FILES = [
    "backend/services/autonomousExecutionRuntime.cjs",
    "backend/services/pluginSDK.cjs",
    "backend/services/dop2Deployment.cjs",
  ];
  let placeholders = 0;
  for (const f of AUDIT_FILES) {
    try {
      const src = fs.readFileSync(path.join(__dirname, "../../", f), "utf8");
      for (const p of PLACEHOLDER_PATTERNS) placeholders += (src.match(p) || []).length;
    } catch {}
  }
  debt += Math.min(20, placeholders);
  if (placeholders > 0) signals.push(`${placeholders}_known_placeholders`);

  return { score: Math.round(Math.max(0, Math.min(100, 100 - debt))), signals, debtPoints: debt };
}

function _scoreReliability() {
  // Measures: agent success rate, healing history, security score, circuit breaker state
  const signals = [];
  let score = 70; // baseline

  // Agent success rate
  const sup = _sup();
  const agents = _try(() => sup?.listAgents?.()) || [];
  const withSuccessRate = agents.filter(a => typeof a.successRate === "number");
  if (withSuccessRate.length > 0) {
    const avg = withSuccessRate.reduce((s, a) => s + a.successRate, 0) / withSuccessRate.length;
    score = Math.min(100, score + (avg - 0.5) * 30);
    signals.push(`avg_agent_success_${Math.round(avg * 100)}pct`);
  }

  // Security hardening score
  const sh = _sh();
  const secReport = _try(() => sh?.runSecurityChecks?.()) || _try(() => sh?.getLatestReport?.());
  if (secReport?.score) {
    score = (score + secReport.score) / 2;
    signals.push(`security_score_${secReport.score}`);
  }

  // Healing history size — more heals = system survived incidents
  try {
    const hh = JSON.parse(fs.readFileSync(path.join(__dirname, "../../data/healing-history.json"), "utf8"));
    const heals = Array.isArray(hh) ? hh.length : (hh.history?.length ?? 0);
    if (heals > 0) { score = Math.min(100, score + Math.min(10, heals * 0.5)); signals.push(`${heals}_healing_events`); }
  } catch {}

  return { score: Math.round(Math.max(0, Math.min(100, score))), signals };
}

function _scorePerformance() {
  // Measures: bundle size, startup metrics (from existing data), response times
  const signals = [];
  let score = 75;

  // Check if any perf data exists
  try {
    const metrics = fs.readdirSync(path.join(__dirname, "../../data/metrics"))
      .filter(f => f.endsWith(".ndjson"))
      .slice(-1)[0];
    if (metrics) {
      signals.push("metrics_recording_active");
      score = Math.min(100, score + 5);
    }
  } catch {}

  // Autonomy cycle duration (fast loops = good performance)
  const cycles = _try(() => _ast()?.getCycleHistory?.()) || [];
  if (cycles.length > 0) {
    const recentMs = cycles.slice(-5).map(c => c.durationMs || 5000);
    const avgMs = recentMs.reduce((a, b) => a + b, 0) / recentMs.length;
    const cycleScore = avgMs < 2000 ? 20 : avgMs < 5000 ? 10 : 5;
    score = Math.min(100, score + cycleScore);
    signals.push(`avg_cycle_${Math.round(avgMs)}ms`);
  }

  return { score: Math.round(Math.max(0, Math.min(100, score))), signals };
}

function _scoreFounderTimeSaved() {
  // Measures: autonomous decisions made (each = manual task eliminated), experiment outcomes
  const ast = _ast();
  if (!ast) return { score: 0, signals: ["no_autonomous_data"], minutesSaved: 0 };

  const dStats    = _try(() => ast.getDecisionStats?.())           || {};
  const opts      = _try(() => ast.listOptimizations?.({ type: "all" })) || [];
  const reports   = _try(() => ast.listAutonomousReports?.())      || [];
  const signals   = [];

  // Each successful decision = ~15 min saved
  const succeeded = dStats.succeeded ?? 0;
  const minutesSaved = succeeded * 15 + opts.length * 30 + reports.length * 10;

  let score = Math.min(100, Math.round(minutesSaved / 10));
  if (succeeded > 0) signals.push(`${succeeded}_autonomous_decisions`);
  if (opts.length > 0) signals.push(`${opts.length}_optimizations_applied`);
  if (reports.length > 0) signals.push(`${reports.length}_auto_reports_generated`);

  return { score, signals, minutesSaved };
}

function _scoreCustomerImpact() {
  // Measures: deployed orgs, published templates, marketplace activity, certifications
  const plt = _plt();
  if (!plt) return { score: 30, signals: ["platform_state_unavailable"] };

  const analytics = _try(() => plt.getPlatformAnalytics?.()) || {};
  const signals   = [];
  let score = 20;

  const orgs   = analytics.orgs?.total ?? 0;
  const tmpl   = analytics.templates?.total ?? 0;
  const mkt    = analytics.marketplace?.total ?? 0;
  const certs  = analytics.certifications?.total ?? 0;
  const deps   = analytics.deployments?.total ?? 0;

  score += Math.min(20, orgs * 4);
  score += Math.min(15, tmpl * 3);
  score += Math.min(15, deps * 3);
  score += Math.min(15, mkt  * 3);
  score += Math.min(15, certs * 5);

  if (orgs  > 0) signals.push(`${orgs}_orgs_registered`);
  if (tmpl  > 0) signals.push(`${tmpl}_templates_published`);
  if (deps  > 0) signals.push(`${deps}_orgs_deployed`);
  if (certs > 0) signals.push(`${certs}_orgs_certified`);

  return { score: Math.round(Math.max(0, Math.min(100, score))), signals };
}

function _scoreConsolidation() {
  // Measures: known duplicates resolved, placeholder count decreasing over reviews
  const d = _load();
  const signals = [];
  let score = 60; // baseline

  // If we have previous reviews, compare debt
  const prev = d.reviews.slice(-5);
  if (prev.length >= 2) {
    const older = prev[0].scores.technicalDebt;
    const newer = prev[prev.length - 1].scores.technicalDebt;
    if (newer > older) { score += 20; signals.push("debt_decreasing"); }
    else if (newer < older) { score -= 10; signals.push("debt_increasing"); }
    else signals.push("debt_stable");
  } else {
    signals.push("first_review_baseline");
  }

  // Intelligence layer fix applied (Sprint P1)
  try {
    const src = fs.readFileSync(path.join(__dirname, "./intelligenceLayer.cjs"), "utf8");
    if (src.includes("Object.values(raw)")) { score += 20; signals.push("P1_intelligence_fix_applied"); }
  } catch {}

  return { score: Math.round(Math.max(0, Math.min(100, score))), signals };
}

function _scoreSecurity() {
  const sh = _sh();
  if (!sh) return { score: 60, signals: ["security_hardening_unavailable"] };
  const report = _try(() => sh.runSecurityChecks?.()) || _try(() => sh.getLatestReport?.()) || {};
  const score  = report.score ?? 70;
  const grade  = report.grade ?? "C";
  return { score: Math.min(100, Math.round(score)), signals: [`security_grade_${grade}`] };
}

// ── Core: run a full review ────────────────────────────────────────────────────

function runReview() {
  const architecture  = _scoreArchitecture();
  const autonomy      = _scoreAutonomy();
  const technicalDebt = _scoreTechnicalDebt();
  const reliability   = _scoreReliability();
  const performance   = _scorePerformance();
  const founderTime   = _scoreFounderTimeSaved();
  const customerImpact = _scoreCustomerImpact();
  const consolidation = _scoreConsolidation();
  const security      = _scoreSecurity();

  // Overall = weighted average
  const weights = {
    architecture: 0.15, autonomy: 0.15, technicalDebt: 0.12,
    reliability: 0.15,  performance: 0.10, founderTime: 0.10,
    customerImpact: 0.10, consolidation: 0.08, security: 0.05,
  };
  const scores = {
    architecture: architecture.score, autonomy: autonomy.score,
    technicalDebt: technicalDebt.score, reliability: reliability.score,
    performance: performance.score, founderTimeSaved: founderTime.score,
    customerImpact: customerImpact.score, consolidation: consolidation.score,
    security: security.score,
  };
  const overall = Math.round(
    Object.entries(weights).reduce((s, [k, w]) => s + (scores[k] ?? 50) * w, 0)
  );

  const recommendations = _generateRecommendations(scores, {
    architecture, autonomy, technicalDebt, reliability,
    performance, founderTime, customerImpact, consolidation, security,
  });

  const review = {
    id:        `review_${Date.now()}`,
    createdAt: new Date().toISOString(),
    period:    "weekly",
    overall,
    scores,
    signals: {
      architecture:  architecture.signals,
      autonomy:      autonomy.signals,
      technicalDebt: technicalDebt.signals,
      reliability:   reliability.signals,
      performance:   performance.signals,
      founderTimeSaved: founderTime.signals,
      customerImpact: customerImpact.signals,
      consolidation: consolidation.signals,
      security:      security.signals,
    },
    minutesSaved:    founderTime.minutesSaved,
    debtPoints:      technicalDebt.debtPoints,
    recommendations,
  };

  const d = _load();
  d.reviews.push(review);
  if (d.reviews.length > 52) d.reviews = d.reviews.slice(-52); // keep 1 year
  d.lastReviewAt = review.createdAt;
  _save(d);

  // Feed into autonomous memory
  _try(() => _ast()?.createAutonomousReport?.({
    type:    "weekly_self_review",
    title:   `Weekly Self-Review — Overall ${overall}/100`,
    summary: recommendations.map(r => r.action).join("; "),
    data:    { overall, scores },
  }));

  // Feed into learning engine
  _try(() => _le()?.createLesson?.({
    type:       "self_review",
    title:      `Platform self-review: overall=${overall}`,
    source:     "selfReviewEngine",
    confidence: 0.9,
    tags:       ["self_review", "architecture", "autonomy"],
    data:       { scores, overall },
  }));

  return { ok: true, review };
}

function _generateRecommendations(scores, details) {
  const recs = [];

  if (scores.technicalDebt < 70) {
    recs.push({
      priority: "high",
      area:     "technical_debt",
      action:   `Resolve ${details.technicalDebt.debtPoints} debt points — focus: ${details.technicalDebt.signals.slice(0,2).join(", ")}`,
      impact:   "maintainability",
    });
  }
  if (scores.autonomy < 60) {
    recs.push({
      priority: "high",
      area:     "autonomy",
      action:   "Run more autonomous cycles — trigger /auto/v10/loop/cycle to build decision history",
      impact:   "founder_time",
    });
  }
  if (scores.reliability < 70) {
    recs.push({
      priority: "high",
      area:     "reliability",
      action:   `Improve agent uptime — ${details.reliability.signals.join(", ")}`,
      impact:   "reliability",
    });
  }
  if (scores.architecture < 70) {
    recs.push({
      priority: "medium",
      area:     "architecture",
      action:   "Run consolidation audit — merge duplicate services, remove dead phase routes",
      impact:   "maintainability",
    });
  }
  if (scores.consolidation < 70) {
    recs.push({
      priority: "medium",
      area:     "consolidation",
      action:   "Technical debt is growing — prioritize Sprint P2 consolidation pass",
      impact:   "maintainability",
    });
  }
  if (scores.customerImpact < 50) {
    recs.push({
      priority: "medium",
      area:     "customer_impact",
      action:   "Deploy and certify orgs via /platform/v1/deploy to drive customer value score",
      impact:   "customer_value",
    });
  }
  if (scores.performance < 70) {
    recs.push({
      priority: "low",
      area:     "performance",
      action:   "Add performance benchmarks — instrument cycle duration and response latency",
      impact:   "performance",
    });
  }

  // Always recommend self-improvement loop
  recs.push({
    priority: "ongoing",
    area:     "self_improvement",
    action:   "Continue POST-Ω program — next sprint: architecture consolidation",
    impact:   "autonomy",
  });

  return recs;
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

function listReviews({ limit = 10 } = {}) {
  return _load().reviews.slice(-limit).reverse();
}

function getLatestReview() {
  const reviews = _load().reviews;
  return reviews.length > 0 ? reviews[reviews.length - 1] : null;
}

function getReview(id) {
  return _load().reviews.find(r => r.id === id) || null;
}

function getTrend() {
  const reviews = _load().reviews.slice(-8);
  if (reviews.length < 2) return { ok: false, reason: "not_enough_reviews" };

  const trend = {};
  const dims  = ["architecture","autonomy","technicalDebt","reliability","performance","founderTimeSaved","customerImpact","consolidation","security"];
  for (const dim of dims) {
    const vals = reviews.map(r => r.scores[dim] ?? 0);
    const delta = vals[vals.length - 1] - vals[0];
    trend[dim] = { first: vals[0], latest: vals[vals.length - 1], delta, direction: delta > 0 ? "improving" : delta < 0 ? "declining" : "stable" };
  }
  return { ok: true, reviews: reviews.length, trend };
}

module.exports = {
  runReview,
  listReviews,
  getLatestReview,
  getReview,
  getTrend,
};
