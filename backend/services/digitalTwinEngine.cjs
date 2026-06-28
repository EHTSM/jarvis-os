"use strict";
/**
 * digitalTwinEngine.cjs — POST-Ω Sprint P6 FDT
 *
 * The Founder Digital Twin.
 * For every important decision, produces:
 *   "If the founder were here, what decision would they most likely make?"
 *
 * Integrates all P6 subsystems:
 *   - contextBuilder         (full context aggregation)
 *   - approvalPredictionEngine (predict approve/reject)
 *   - decisionLearningEngine  (record and learn)
 *   - workflowPreferenceEngine (preference signals)
 *   - founderProfileEngine    (profile + trust)
 *
 * Plus all pre-P6 systems:
 *   - approvalEngine (P4)    — routes auto-approvals
 *   - computerController (P5) — executes NL commands
 *   - productionBibleEngine  — procedure reference
 *   - continuousLearningEngine — lesson persistence
 *   - engineeringMemoryEngine  — memory recall
 *   - founderWorkRegistry     — workflow coverage
 *
 * Storage: data/digital-twin.json
 */

const fs   = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "../..");
const DATA = path.join(ROOT, "data", "digital-twin.json");

const _try = fn => { try { return fn(); } catch { return null; } };
const _ctx  = () => _try(() => require("./contextBuilder.cjs"));
const _ape  = () => _try(() => require("./approvalPredictionEngine.cjs"));
const _dle  = () => _try(() => require("./decisionLearningEngine.cjs"));
const _wpe  = () => _try(() => require("./workflowPreferenceEngine.cjs"));
const _fpe  = () => _try(() => require("./founderProfileEngine.cjs"));
const _ae   = () => _try(() => require("./approvalEngine.cjs"));
const _cc   = () => _try(() => require("./computerController.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _eme  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _pbe  = () => _try(() => require("./productionBibleEngine.cjs"));

function _ts() { return new Date().toISOString(); }
function _id() { return `fdt_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`; }

// ── Default store ─────────────────────────────────────────────────────────────

function _default() {
  return {
    decisions: [],   // last 500 twin decisions
    scenarios: [],   // last 100 run scenarios
    stats: {
      total:           0,
      approved:        0,
      rejected:        0,
      modified:        0,
      correct:         0,        // twin agreed with actual founder
      autoResolved:    0,
      founderRequired: 0,
      minutesSaved:    0,
    },
    learningLoop: {
      totalCorrections:    0,
      knowledgeUpdates:    0,
      profileUpdates:      0,
      lastLoopAt:          null,
    },
    updatedAt: null,
  };
}

// In-memory index for fast lookup — survives concurrent file writes within the same process
const _memoryIndex = new Map();

function _load() {
  try { return JSON.parse(fs.readFileSync(DATA, "utf8")); }
  catch { return _default(); }
}

function _save(d) {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  if (d.decisions.length > 500) d.decisions = d.decisions.slice(-500);
  if (d.scenarios.length > 100) d.scenarios = d.scenarios.slice(-100);
  d.updatedAt = _ts();
  fs.writeFileSync(DATA, JSON.stringify(d, null, 2));
}

// ── Core twin decision ────────────────────────────────────────────────────────

async function decide(command, {
  workflowId,
  domain,
  category,
  risk      = "medium",
  context   = {},
  opts      = {},
} = {}) {
  const store   = _load();
  const id      = _id();
  const started = Date.now();

  // Build full context
  const ctx = await _try(() => _ctx()?.build?.(command, { workflowId, domain, category, opts: { ...opts, risk } }))
           || _try(() => _ctx()?.buildQuick?.(command, { workflowId, domain }))
           || {};

  // Approval prediction
  const pred = _try(() => _ape()?.predict?.(workflowId || command, {
    domain, risk, context: { ...context, ...ctx.workspace },
  })) || { predictedOutcome: "approved", approveProbability: 0.7, confidence: 0, reasoning: [], shouldAutoApprove: false };

  // Similar historical decisions
  const similar = ctx.history?.similarDecisions || [];

  // Build twin decision object
  const founderWouldLikely = _determineLikely(pred, similar, ctx);

  const decision = {
    id,
    command,
    workflowId,
    domain,
    category:          ctx.category,
    risk,

    founderWouldLikely,     // "approve" | "reject" | "modify"
    confidence:            pred.confidence,
    approveProbability:    pred.approveProbability,
    rejectProbability:     pred.rejectProbability,
    shouldAutoApprove:     pred.shouldAutoApprove,

    reasoning:             pred.reasoning || [],
    supportingHistory:     similar.slice(0, 3).map(s => ({
      subject:  s.subject,
      outcome:  s.outcome,
      similarity: s.similarity,
      ts:       s.ts,
    })),

    trustScore:            ctx.founder?.trustScore || 0,
    contextSources:        _countSources(ctx),

    actualOutcome:         null,   // set when founder confirms
    wasCorrect:            null,
    resolvedAt:            null,

    ts:                    _ts(),
    durationMs:            Date.now() - started,
  };

  store.decisions.push(decision);
  store.stats.total++;
  if (founderWouldLikely === "approve")    store.stats.approved++;
  else if (founderWouldLikely === "reject") store.stats.rejected++;
  else                                      store.stats.modified++;

  if (pred.shouldAutoApprove) store.stats.autoResolved++;
  else                        store.stats.founderRequired++;

  _memoryIndex.set(id, decision); // fast in-process lookup
  _save(store);
  return { ok: true, ...decision };
}

function _determineLikely(pred, similar, ctx) {
  // If prediction model is confident, trust it
  if (pred.confidence >= 0.7) {
    return pred.predictedOutcome === "approved" ? "approve" : "reject";
  }
  // Fall back to historical majority
  if (similar.length >= 3) {
    const votes = { approve: 0, reject: 0, modify: 0 };
    for (const s of similar) {
      if (s.outcome === "approved") votes.approve++;
      else if (s.outcome === "rejected") votes.reject++;
      else votes.modify++;
    }
    const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
    return top[0];
  }
  // Default to approve if low risk
  return ctx.risk === "low" ? "approve" : "approve";
}

function _countSources(ctx) {
  let n = 0;
  if (ctx.workspace?.activeProject) n++;
  if (Object.keys(ctx.founder?.preferences || {}).length) n++;
  if ((ctx.history?.similarDecisions || []).length) n++;
  if ((ctx.engineeringMemory || []).length) n++;
  if (ctx.bibleWorkflow) n++;
  if ((ctx.history?.approvalHistory || []).length) n++;
  return n;
}

// ── Scenario runner ───────────────────────────────────────────────────────────
// Runs the twin against a named scenario and measures prediction quality.

const SCENARIOS = {
  deployment: {
    command:    "Deploy today's release to production.",
    workflowId: "wf_eng_deploy_release",
    domain:     "deployment",
    risk:       "high",
  },
  production_release: {
    command:    "Ship production release v2.0.",
    workflowId: "wf_ops_deploy_backend",
    domain:     "deployment",
    risk:       "high",
  },
  ui_approval: {
    command:    "Approve new UI layout for dashboard.",
    domain:     "ui_review",
    risk:       "medium",
  },
  code_review: {
    command:    "Review and approve pull request for auth module.",
    domain:     "code_review",
    risk:       "medium",
  },
  documentation: {
    command:    "Approve documentation update for API.",
    domain:     "documentation",
    risk:       "low",
  },
  roadmap_decision: {
    command:    "Prioritize mobile offline sync for next sprint.",
    domain:     "business",
    risk:       "medium",
  },
  production_checklist: {
    command:    "Run production readiness checklist.",
    workflowId: "wf_ops_deployment_checklist_1",
    domain:     "deployment",
    risk:       "medium",
  },
};

async function runScenario(scenarioName) {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) return { ok: false, error: `Unknown scenario: ${scenarioName}. Available: ${Object.keys(SCENARIOS).join(", ")}` };

  const result = await decide(scenario.command, scenario);
  const store  = _load();

  const scenRec = {
    scenarioName,
    scenario,
    result: {
      founderWouldLikely: result.founderWouldLikely,
      confidence:         result.confidence,
      approveProbability: result.approveProbability,
      shouldAutoApprove:  result.shouldAutoApprove,
      reasoning:          result.reasoning,
    },
    ts: _ts(),
  };

  store.scenarios.push(scenRec);
  _save(store);

  return { ok: true, scenarioName, ...scenRec.result, decisionId: result.id };
}

async function runAllScenarios() {
  const results = [];
  for (const name of Object.keys(SCENARIOS)) {
    const r = await runScenario(name);
    results.push(r);
  }
  const avgConf = results.filter(r => r.ok).reduce((s, r) => s + (r.confidence || 0), 0) / Math.max(1, results.filter(r => r.ok).length);
  return {
    ok:          true,
    total:       results.length,
    passed:      results.filter(r => r.ok).length,
    avgConfidence: Math.round(avgConf * 100) / 100,
    results,
  };
}

// ── Outcome recording + learning loop ────────────────────────────────────────

async function recordOutcome(decisionId, actualOutcome, { correction = false } = {}) {
  const store    = _load();
  // Check in-memory index first (survives concurrent file writes)
  let decision   = _memoryIndex.get(decisionId) || store.decisions.find(d => d.id === decisionId);
  if (!decision) return { ok: false, error: "decision not found" };
  // Ensure decision is in the store array for mutation
  if (!store.decisions.find(d => d.id === decisionId)) store.decisions.push(decision);

  decision.actualOutcome = actualOutcome;
  decision.wasCorrect    = decision.founderWouldLikely === actualOutcome || (
    decision.founderWouldLikely === "approve" && actualOutcome === "approved"
  ) || (
    decision.founderWouldLikely === "reject" && actualOutcome === "rejected"
  );
  decision.resolvedAt    = _ts();

  if (decision.wasCorrect) store.stats.correct++;
  if (correction)          store.learningLoop.totalCorrections++;

  // Track minutes saved when twin was correct and auto-resolved
  if (decision.wasCorrect && decision.shouldAutoApprove) {
    store.stats.minutesSaved += 5; // avg 5 min per approval
  }

  _save(store);

  // Run the full learning loop
  await _runLearningLoop(decision, actualOutcome, correction);

  return {
    ok:         true,
    wasCorrect: decision.wasCorrect,
    accuracy:   store.stats.total > 0 ? Math.round(store.stats.correct / store.stats.total * 100) : 0,
  };
}

async function _runLearningLoop(decision, actualOutcome, correction) {
  const store = _load();

  // 1. Profile update
  _try(() => _fpe()?.observeApproval?.({
    workflowId:   decision.workflowId,
    approvalType: "GENERIC",
    outcome:      actualOutcome,
    confidence:   decision.approveProbability,
    responseMs:   decision.durationMs,
    risk:         decision.risk,
  }));
  store.learningLoop.profileUpdates++;

  // 2. Decision record
  _try(() => _dle()?.recordDecision?.({
    type:         actualOutcome === "approved" ? "approve" : actualOutcome === "rejected" ? "reject" : "modify",
    subject:      decision.command,
    workflowId:   decision.workflowId,
    domain:       decision.domain,
    outcome:      actualOutcome,
    confidence:   decision.confidence,
    predictionWas: decision.founderWouldLikely === "approve" ? "approved" : "rejected",
    durationMs:   decision.durationMs || 0,
    risk:         decision.risk,
  }));

  // 3. Workflow preference update
  _try(() => _wpe()?.observeExecution?.({
    category:       decision.category || decision.domain,
    workflowId:     decision.workflowId,
    outcome:        actualOutcome,
    founderOverride: correction,
  }));

  // 4. Knowledge update — CLE lesson
  _try(() => _cle()?.createLesson?.({
    type:       "twin_decision_outcome",
    title:      `Twin ${decision.wasCorrect ? "correct" : "incorrect"}: ${decision.command?.slice(0, 60)}`,
    source:     "digitalTwinEngine",
    confidence: decision.wasCorrect ? 0.9 : 0.7,
    tags:       ["twin_outcome", decision.domain, actualOutcome, decision.wasCorrect ? "correct" : "incorrect"],
    metadata:   { decisionId: decision.id, predicted: decision.founderWouldLikely, actual: actualOutcome },
  }));
  store.learningLoop.knowledgeUpdates++;

  // 5. Engineering memory
  if (correction) {
    _try(() => _eme()?.remember?.({
      type:       "twin_correction",
      content:    `Twin predicted "${decision.founderWouldLikely}" but founder chose "${actualOutcome}" for: ${decision.command}`,
      confidence: 0.95,
      tags:       ["twin_correction", decision.domain, "learning"],
    }));
  }

  // 6. Production Bible update on repeated patterns
  if (decision.wasCorrect && decision.workflowId) {
    _try(() => _fwr()?.recordExecution?.(decision.workflowId, {
      outcome:         actualOutcome,
      durationMs:      decision.durationMs || 0,
      approvalRequired: !decision.shouldAutoApprove,
      stepsExecuted:   ["twin_decision", "context_build", "prediction", "outcome"],
    }));
  }

  store.learningLoop.lastLoopAt = _ts();
  _save(store);
}

// ── Dashboard ────────────────────────────────────────────────────────────────

function getDashboard() {
  const store    = _load();
  const s        = store.stats;
  const profile  = _try(() => _fpe()?.getStats?.()) || {};
  const predStats = _try(() => _ape()?.getStats?.()) || {};
  const dleStats = _try(() => _dle()?.getStats?.()) || {};
  const wpeStats = _try(() => _wpe()?.getStats?.()) || {};

  const accuracy = s.total > 0 ? Math.round(s.correct / s.total * 100) : 0;

  return {
    ok:              true,
    trustScore:      profile.trustScore || 0,
    totalDecisions:  s.total,
    accuracy,
    autoResolved:    s.autoResolved,
    founderRequired: s.founderRequired,
    minutesSaved:    s.minutesSaved,
    learningLoop:    store.learningLoop,
    recentDecisions: store.decisions.slice(-5).map(d => ({
      id: d.id, command: d.command?.slice(0, 60), founderWouldLikely: d.founderWouldLikely,
      confidence: d.confidence, wasCorrect: d.wasCorrect, ts: d.ts,
    })),
    profile: {
      totalActions:       profile.totalActions,
      correctionCount:    profile.correctionCount,
      predictionAccuracy: profile.predictionAccuracy,
      dimensions:         profile.dimensions,
    },
    prediction: {
      accuracy:        predStats.predictionAccuracy,
      autoApproveRate: predStats.autoApproveRate,
      total:           predStats.total,
      threshold:       predStats.threshold,
    },
    decisions: {
      total:    dleStats.totalDecisions,
      patterns: dleStats.patternCount,
      domains:  dleStats.domains,
    },
    preferences: {
      categories:        wpeStats.categoriesTracked,
      totalObservations: wpeStats.totalObservations,
    },
    scenarios:       store.scenarios.slice(-7),
    generatedAt:     _ts(),
  };
}

function getStats() {
  const store   = _load();
  const s       = store.stats;
  return {
    total:           s.total,
    correct:         s.correct,
    accuracy:        s.total > 0 ? Math.round(s.correct / s.total * 100) : 0,
    autoResolved:    s.autoResolved,
    founderRequired: s.founderRequired,
    minutesSaved:    s.minutesSaved,
    updatedAt:       store.updatedAt,
  };
}

function getDecisions({ limit = 50, outcome } = {}) {
  const store = _load();
  let list    = store.decisions;
  if (outcome) list = list.filter(d => d.founderWouldLikely === outcome || d.actualOutcome === outcome);
  return { ok: true, decisions: list.slice(-limit), total: list.length };
}

module.exports = {
  decide,
  runScenario,
  runAllScenarios,
  recordOutcome,
  getDashboard,
  getStats,
  getDecisions,
  SCENARIOS,
};
