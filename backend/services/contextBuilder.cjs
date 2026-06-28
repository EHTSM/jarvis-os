"use strict";
/**
 * contextBuilder.cjs — POST-Ω Sprint P6 FDT
 *
 * Whenever a command arrives, builds one unified context object by aggregating
 * from all available platform sources. Delivered to the Digital Twin Engine
 * and all execution engines.
 *
 * Sources:
 *   - founderProfileEngine    (preferences, trust score)
 *   - decisionLearningEngine  (similar past decisions, patterns)
 *   - workflowPreferenceEngine (category preferences, timing)
 *   - engineeringMemoryEngine  (relevant engineering knowledge)
 *   - productionBibleEngine    (matching workflow procedures)
 *   - approvalEvidence         (historical approval evidence)
 *   - workspaceController      (current workspace state)
 *   - founderWorkRegistry      (workflow classification / coverage)
 *   - missionMemory / missions (related missions)
 *
 * No own storage — pure aggregation.
 */

const _try = fn => { try { return fn(); } catch { return null; } };
const _fpe  = () => _try(() => require("./founderProfileEngine.cjs"));
const _dle  = () => _try(() => require("./decisionLearningEngine.cjs"));
const _wpe  = () => _try(() => require("./workflowPreferenceEngine.cjs"));
const _eme  = () => _try(() => require("./engineeringMemoryEngine.cjs"));
const _pbe  = () => _try(() => require("./productionBibleEngine.cjs"));
const _aev  = () => _try(() => require("./approvalEvidence.cjs"));
const _wc   = () => _try(() => require("./workspaceController.cjs"));
const _fwr  = () => _try(() => require("./founderWorkRegistry.cjs"));
const _mm   = () => _try(() => require("./missionMemory.cjs"));
const _cle  = () => _try(() => require("./continuousLearningEngine.cjs"));
const _ae   = () => _try(() => require("./approvalEngine.cjs"));
const _ape  = () => _try(() => require("./approvalPredictionEngine.cjs"));

function _ts() { return new Date().toISOString(); }

// ── Core context builder ─────────────────────────────────────────────────────

async function build(command, { workflowId, domain, category, opts = {} } = {}) {
  const started = Date.now();

  // 1. Current workspace state
  const workspace   = _try(() => _wc()?.getContext?.()) || {};

  // 2. Founder profile
  const profile     = _try(() => _fpe()?.getProfile?.()) || {};

  // 3. Similar past decisions
  const similar     = _try(() => _dle()?.getSimilarDecisions?.(command, domain, 5)) || {};

  // 4. Workflow-category preferences
  const wfCategory  = category || _inferCategory(command, domain);
  const categoryPref = _try(() => _wpe()?.getPreference?.(wfCategory)) || {};
  const timingCheck  = _try(() => _wpe()?.isGoodTime?.(wfCategory)) || {};

  // 5. Engineering memory recall
  let engineeringMemory = [];
  try {
    const recall = await _eme()?.recall?.({ query: command, limit: 5 });
    engineeringMemory = Array.isArray(recall) ? recall : [];
  } catch {}

  // 6. Production Bible match
  let bibleWorkflow = null;
  if (workflowId) {
    bibleWorkflow = _try(() => _pbe()?.getWorkflow?.(workflowId)) || null;
  }
  if (!bibleWorkflow) {
    const list = _try(() => _pbe()?.listWorkflows?.({ limit: 200 })) || [];
    const lc   = command.toLowerCase();
    bibleWorkflow = list.find(w =>
      (w.title || "").toLowerCase().includes(lc.slice(0, 30)) ||
      lc.includes((w.category || "").toLowerCase())
    ) || null;
  }

  // 7. Approval history for this workflow
  let approvalHistory = [];
  if (workflowId) {
    approvalHistory = _try(() => _aev()?.listEvidence?.({ workflowId, limit: 5 })?.evidence) || [];
  }

  // 8. Approval prediction
  const prediction = _try(() => _ape()?.predict?.(workflowId || command, {
    domain, risk: opts.risk || "medium", context: { workspace },
  })) || {};

  // 9. Workflow registry entry
  let wfRegistry = null;
  if (workflowId) {
    wfRegistry = _try(() => _fwr()?.getWorkflow?.(workflowId)) || null;
  }

  // 10. Pending approvals for cross-reference
  const pendingApprovals = _try(() => _ae()?.listSessions?.({ status: "pending", limit: 5 })) || [];

  // 11. Recent learning lessons
  const recentLessons = _try(() => _cle()?.getLessons?.({ source: "founderProfileEngine", limit: 5 })) || [];

  // 12. Decision patterns
  const patterns  = _try(() => _dle()?.getPatterns?.()?.patterns) || {};

  const durationMs = Date.now() - started;

  return {
    ok:              true,
    command,
    workflowId,
    domain,
    category:        wfCategory,
    generatedAt:     _ts(),
    buildDurationMs: durationMs,

    // Workspace
    workspace: {
      activeProject:   workspace.activeProject || null,
      activeBrowser:   workspace.activeBrowser || null,
      activeTerminal:  workspace.activeTerminal || null,
      currentTask:     workspace.currentTask    || null,
      automationCoverage: workspace.stats?.automationCoverage || 0,
    },

    // Founder intelligence
    founder: {
      trustScore:      profile.trustScore || 0,
      totalActions:    profile.totalActions || 0,
      preferences:     profile.preferences || {},
      predictionAccuracy: profile.predictionAccuracy || { correct: 0, total: 0 },
      correctionCount: profile.correctionCount || 0,
    },

    // Historical decisions
    history: {
      similarDecisions:  similar.similar || [],
      approvalHistory,
      decisionPatterns:  patterns,
    },

    // Preferences for this category
    categoryPreference: categoryPref,
    timingAdvice:       timingCheck,

    // Engineering knowledge
    engineeringMemory,
    recentLessons,

    // Procedure reference
    bibleWorkflow,
    wfRegistry,

    // Prediction
    prediction: {
      predictedOutcome:   prediction.predictedOutcome    || null,
      approveProbability: prediction.approveProbability  || null,
      rejectProbability:  prediction.rejectProbability   || null,
      confidence:         prediction.confidence          || 0,
      shouldAutoApprove:  prediction.shouldAutoApprove   || false,
      reasoning:          prediction.reasoning           || [],
    },

    // Cross-references
    pendingApprovals,
  };
}

// ── Category inference ────────────────────────────────────────────────────────

function _inferCategory(command, domain) {
  if (domain) return domain;
  const lc = (command || "").toLowerCase();
  if (/deploy|release|ship|publish/.test(lc))     return "deployment";
  if (/test|spec|regression|coverage/.test(lc))   return "testing";
  if (/doc|readme|wiki|comment/.test(lc))          return "documentation";
  if (/ui|design|layout|component|css/.test(lc))  return "ui_review";
  if (/security|auth|secret|ssl|cert/.test(lc))   return "security";
  if (/perf|speed|latency|optimize/.test(lc))     return "performance";
  if (/review|pr|pull request|code/.test(lc))     return "code_review";
  if (/infra|server|nginx|vm|vps/.test(lc))       return "infrastructure";
  if (/monitor|alert|oncall|log/.test(lc))         return "monitoring";
  return "business";
}

// ── Quick context (sync, lightweight) ────────────────────────────────────────

function buildQuick(command, { workflowId, domain } = {}) {
  const profile   = _try(() => _fpe()?.getProfile?.())   || {};
  const patterns  = _try(() => _dle()?.getPatterns?.()?.patterns) || {};
  const workspace = _try(() => _wc()?.getContext?.())    || {};
  const category  = _inferCategory(command, domain);
  const timing    = _try(() => _wpe()?.isGoodTime?.(category)) || {};

  return {
    ok:        true,
    command,
    workflowId,
    category,
    trustScore:     profile.trustScore || 0,
    preferences:    profile.preferences || {},
    patterns,
    timing,
    workspace: { activeProject: workspace.activeProject },
    generatedAt: _ts(),
    isQuick:    true,
  };
}

module.exports = { build, buildQuick };
