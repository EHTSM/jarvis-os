// Phase 902: Productivity scoring.
// Generates explainable scores for: debugging productivity, deployment efficiency,
// replay usability, onboarding smoothness, workflow friction, operational trust.
//
// All inputs: localStorage-only. No external calls. No autonomous execution.
// Bounded: scores 0-100, computation capped at last 100 events per dimension.

import { useState, useEffect, useCallback, useMemo } from "react";

const SCORE_KEY = "jarvis_productivity_scores";
const SCORE_TTL = 24 * 60 * 60 * 1000;

// ── Scoring functions ─────────────────────────────────────────────────────────
// Each returns { score: 0-100, label, color, factors: [{label, impact, positive}] }

function _scoreDebugging(analytics) {
  if (!analytics) return null;
  const d = analytics.debugging || {};
  const r = analytics.recovery  || {};
  let score = 100;
  const factors = [];

  if (d.sessions > 0 && d.avgDurationMs !== null) {
    const avgMin = d.avgDurationMs / 60000;
    if (avgMin > 30) {
      const impact = Math.min(25, Math.round((avgMin - 30) / 5) * 5);
      score -= impact;
      factors.push({ label: `Avg debug session ${Math.round(avgMin)}m`, impact, positive: false });
    } else {
      factors.push({ label: `Avg debug session ${Math.round(avgMin)}m`, impact: 0, positive: true });
    }
  }

  if (d.deadEnds > 0) {
    const impact = Math.min(20, d.deadEnds * 5);
    score -= impact;
    factors.push({ label: `${d.deadEnds} dead-end debug step(s)`, impact, positive: false });
  }

  if (r.loops > 0) {
    const impact = Math.min(20, r.loops * 7);
    score -= impact;
    factors.push({ label: `${r.loops} recovery loop(s)`, impact, positive: false });
  }

  if (r.succeeded > 0 && r.failed === 0) {
    factors.push({ label: `${r.succeeded} clean recovery`, impact: 0, positive: true });
  }

  score = Math.max(0, score);
  return { score, ...scoreLabel(score), factors, dimension: "debugging" };
}

function _scoreDeployment(analytics) {
  if (!analytics) return null;
  const d = analytics.deployment || {};
  let score = 100;
  const factors = [];

  if (d.successRate !== null) {
    if (d.successRate < 70) {
      const impact = Math.round((70 - d.successRate) / 2);
      score -= impact;
      factors.push({ label: `${d.successRate}% deploy success rate`, impact, positive: false });
    } else {
      factors.push({ label: `${d.successRate}% deploy success rate`, impact: 0, positive: true });
    }
  }

  if (d.interrupted > 0) {
    const impact = Math.min(25, d.interrupted * 8);
    score -= impact;
    factors.push({ label: `${d.interrupted} interrupted deploy(s)`, impact, positive: false });
  }

  score = Math.max(0, score);
  return { score, ...scoreLabel(score), factors, dimension: "deployment" };
}

function _scoreReplay(analytics) {
  if (!analytics) return null;
  const r = analytics.replay || {};
  let score = 100;
  const factors = [];

  if (r.successRate !== null) {
    if (r.successRate < 80) {
      const impact = Math.round((80 - r.successRate) / 2);
      score -= impact;
      factors.push({ label: `${r.successRate}% replay success rate`, impact, positive: false });
    } else {
      factors.push({ label: `${r.successRate}% replay success rate`, impact: 0, positive: true });
    }
  }

  if (r.stale > 0) {
    const impact = Math.min(15, r.stale * 5);
    score -= impact;
    factors.push({ label: `${r.stale} stale replay(s)`, impact, positive: false });
  }

  if (r.failed > 0) {
    const impact = Math.min(20, r.failed * 10);
    score -= impact;
    factors.push({ label: `${r.failed} replay failure(s)`, impact, positive: false });
  }

  score = Math.max(0, score);
  return { score, ...scoreLabel(score), factors, dimension: "replay" };
}

function _scoreOnboarding(analytics) {
  if (!analytics) return null;
  const o = analytics.onboarding || {};
  let score = 100;
  const factors = [];

  if (o.frictionPct > 40) {
    const impact = Math.min(30, Math.round((o.frictionPct - 40) / 2));
    score -= impact;
    factors.push({ label: `${o.frictionPct}% onboarding steps skipped`, impact, positive: false });
  } else if (o.viewed > 0) {
    factors.push({ label: `${100 - o.frictionPct}% onboarding engagement`, impact: 0, positive: true });
  }

  if (o.completed > 0) {
    factors.push({ label: `${o.completed} flow(s) completed`, impact: 0, positive: true });
  }

  score = Math.max(0, score);
  return { score, ...scoreLabel(score), factors, dimension: "onboarding" };
}

function _scoreWorkflowFriction(analytics) {
  if (!analytics) return null;
  const w = analytics.workflow || {};
  const r = analytics.recovery || {};
  let score = 100;
  const factors = [];

  if (w.completionRate !== null && w.completionRate < 75) {
    const impact = Math.round((75 - w.completionRate) / 2);
    score -= impact;
    factors.push({ label: `${w.completionRate}% workflow completion rate`, impact, positive: false });
  } else if (w.completionRate !== null) {
    factors.push({ label: `${w.completionRate}% workflow completion rate`, impact: 0, positive: true });
  }

  if (w.abandoned > 2) {
    const impact = Math.min(20, w.abandoned * 4);
    score -= impact;
    factors.push({ label: `${w.abandoned} abandoned workflow(s)`, impact, positive: false });
  }

  if (r.loops > 2) {
    const impact = Math.min(20, r.loops * 5);
    score -= impact;
    factors.push({ label: `${r.loops} recovery loops`, impact, positive: false });
  }

  score = Math.max(0, score);
  return { score, ...scoreLabel(score), factors, dimension: "workflow_friction" };
}

function _scoreOperationalTrust(trustScore, frictionScore, deployScore) {
  // Composite of trust, friction, and deployment
  const safe  = trustScore  ?? 100;
  const fric  = frictionScore?.score ?? 100;
  const dep   = deployScore?.score  ?? 100;
  const score = Math.round((safe * 0.5) + (fric * 0.25) + (dep * 0.25));
  const factors = [
    { label: `Runtime trust ${safe}`, impact: 0, positive: safe >= 70 },
    { label: `Workflow friction ${fric}`, impact: 0, positive: fric >= 70 },
    { label: `Deployment efficiency ${dep}`, impact: 0, positive: dep >= 70 },
  ];
  return { score, ...scoreLabel(score), factors, dimension: "operational_trust" };
}

// ── Shared label/color helper ─────────────────────────────────────────────────

function scoreLabel(score) {
  if (score >= 85) return { label: "EXCELLENT", color: "var(--op-green)" };
  if (score >= 70) return { label: "GOOD",      color: "var(--op-green)" };
  if (score >= 50) return { label: "FAIR",       color: "var(--op-amber)" };
  return                  { label: "POOR",       color: "var(--op-red)"   };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _saveScores(scores) {
  try { localStorage.setItem(SCORE_KEY, JSON.stringify({ scores, ts: Date.now() })); } catch {}
}
function _loadScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORE_KEY) || "null");
    if (!raw || Date.now() - (raw.ts || 0) > SCORE_TTL) return null;
    return raw.scores;
  } catch { return null; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useProductivityScoring({ analytics7d = null, trustScore = 100 } = {}) {
  const [scores,      setScores]      = useState(null);
  const [initialized, setInitialized] = useState(false);

  const computeScores = useCallback(() => {
    const debugging   = _scoreDebugging(analytics7d);
    const deployment  = _scoreDeployment(analytics7d);
    const replay      = _scoreReplay(analytics7d);
    const onboarding  = _scoreOnboarding(analytics7d);
    const friction    = _scoreWorkflowFriction(analytics7d);
    const opTrust     = _scoreOperationalTrust(trustScore, friction, deployment);

    const computed = { debugging, deployment, replay, onboarding, friction, opTrust };
    setScores(computed);
    _saveScores(computed);
    return computed;
  }, [analytics7d, trustScore]);

  useEffect(() => {
    const cached = _loadScores();
    if (cached) setScores(cached);
    if (analytics7d) computeScores();
    setInitialized(true);
  }, [computeScores, analytics7d]);

  // Overall score — weighted average of all dimensions
  const overallScore = useMemo(() => {
    if (!scores) return null;
    const dims = [
      scores.debugging, scores.deployment, scores.replay,
      scores.onboarding, scores.friction, scores.opTrust,
    ].filter(Boolean);
    if (dims.length === 0) return null;
    const avg = Math.round(dims.reduce((s, d) => s + d.score, 0) / dims.length);
    return { score: avg, ...scoreLabel(avg) };
  }, [scores]);

  // Lowest-scoring dimension — focus area
  const focusArea = useMemo(() => {
    if (!scores) return null;
    const dims = Object.values(scores).filter(Boolean);
    if (dims.length === 0) return null;
    return dims.reduce((a, b) => (a.score < b.score ? a : b));
  }, [scores]);

  return {
    initialized,
    scores,
    overallScore,
    focusArea,
    computeScores,
    // Expose label helper for consumers
    scoreLabel,
  };
}
