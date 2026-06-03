// Phase 903: Workflow friction detection.
// Detects repeated recovery loops, excessive workflow steps, debugging bottlenecks,
// deployment slowdowns, replay restoration friction, contextual navigation confusion.
// Generates friction summaries, optimization recommendations, simplification candidates.
//
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: max 20 friction records, max 10 recommendations.

import { useState, useEffect, useCallback, useMemo } from "react";

const FRICTION_STATE_KEY = "jarvis_friction_state";
const FRIC_MAX           = 20;
const REC_MAX            = 10;
const FRIC_WINDOW        = 60 * 60 * 1000;   // 1h analysis window
const LOOP_THRESHOLD     = 3;                 // repeated recovery → friction
const STEP_THRESHOLD     = 8;                 // workflow steps before "excessive"

// ── Friction pattern detectors ────────────────────────────────────────────────

function _detectRecoveryLoops(hist) {
  const now     = Date.now();
  const recent  = hist.filter(h => now - (h.ts || 0) < FRIC_WINDOW);
  const recovCmds = recent.filter(h => /pm2 restart|npm install|git reset|rollback/i.test(h.cmd || ""));

  // Count consecutive recovery command runs
  let maxRun = 0, currentRun = 0, lastCmd = null;
  recovCmds.forEach(h => {
    const key = (h.cmd || "").split(" ").slice(0, 2).join(" ");
    if (key === lastCmd) { currentRun++; maxRun = Math.max(maxRun, currentRun); }
    else                 { currentRun = 1; lastCmd = key; }
  });

  if (maxRun >= LOOP_THRESHOLD) {
    return {
      id:       "recovery_loop",
      type:     "loop",
      severity: "high",
      title:    `Recovery loop detected (${maxRun}× same command)`,
      detail:   "Repeated recovery commands without resolution indicate a root cause not yet addressed.",
      rec:      "Run a diagnostic command first: pm2 logs --lines 50",
      recCmd:   "pm2 logs --lines 50",
    };
  }
  return null;
}

function _detectExcessiveWorkflowSteps(bundles) {
  if (!bundles || bundles.length === 0) return null;
  const excessive = bundles.filter(b => (b.steps || []).length > STEP_THRESHOLD);
  if (excessive.length === 0) return null;
  return {
    id:       "excessive_steps",
    type:     "complexity",
    severity: "medium",
    title:    `${excessive.length} workflow(s) with >${STEP_THRESHOLD} steps`,
    detail:   "Long workflow chains increase failure surface and operator fatigue.",
    rec:      "Split long bundles into focused 3-5 step sequences",
    recCmd:   null,
  };
}

function _detectDebuggingBottlenecks(hist) {
  const now     = Date.now();
  const recent  = hist.filter(h => now - (h.ts || 0) < FRIC_WINDOW && !h.ok);

  // Same failing command ≥ 3 times
  const cmdCounts = {};
  recent.forEach(h => {
    const k = (h.cmd || "").slice(0, 50);
    cmdCounts[k] = (cmdCounts[k] || 0) + 1;
  });
  const bottleneck = Object.entries(cmdCounts).find(([, c]) => c >= 3);
  if (!bottleneck) return null;

  return {
    id:       `debug_bottleneck_${bottleneck[0].slice(0, 20).replace(/\s/g, "_")}`,
    type:     "bottleneck",
    severity: "high",
    title:    `Debugging bottleneck: "${bottleneck[0].slice(0, 40)}" failing ${bottleneck[1]}×`,
    detail:   "Same command failing repeatedly — approaching a dead end.",
    rec:      "Check error output and try an alternative diagnostic: pm2 logs --lines 100",
    recCmd:   "pm2 logs --lines 100",
  };
}

function _detectDeploymentSlowdowns(hist) {
  const now    = Date.now();
  const deploys = hist.filter(h => /deploy|pm2 start|pm2 restart/i.test(h.cmd || "") && now - (h.ts || 0) < 2 * FRIC_WINDOW);
  if (deploys.length < 2) return null;

  const failed = deploys.filter(h => !h.ok).length;
  if (failed / deploys.length < 0.5) return null;

  return {
    id:       "deploy_slowdown",
    type:     "slowdown",
    severity: "high",
    title:    `Deployment friction: ${failed}/${deploys.length} deploys failed`,
    detail:   "High deploy failure rate indicates an environment or configuration issue.",
    rec:      "Check environment variables and service logs before next deploy",
    recCmd:   "pm2 logs --lines 30",
  };
}

function _detectReplayFriction(friction) {
  const now   = Date.now();
  const stale = friction.filter(f => f.type === "replay_stale" && now - (f.ts || 0) < FRIC_WINDOW).length;
  const fail  = friction.filter(f => f.type === "replay_failed"  && now - (f.ts || 0) < FRIC_WINDOW).length;
  if (stale + fail < 2) return null;

  return {
    id:       "replay_friction",
    type:     "replay",
    severity: "medium",
    title:    `Replay friction: ${stale} stale + ${fail} failed restoration(s)`,
    detail:   "Replay is not surviving reconnects reliably — sessions are being lost.",
    rec:      "Shorten session gaps — replay window is 6h. Resume within 6h to restore cleanly.",
    recCmd:   null,
  };
}

function _detectNavigationConfusion(hist) {
  const now    = Date.now();
  const recent = hist.filter(h => now - (h.ts || 0) < FRIC_WINDOW);
  // Many short commands (≤ 2 tokens) with no pattern — proxy for aimless navigation
  const short = recent.filter(h => (h.cmd || "").trim().split(" ").length <= 2 && !h.ok);
  if (short.length < 5) return null;

  return {
    id:       "navigation_confusion",
    type:     "navigation",
    severity: "low",
    title:    `${short.length} short failing commands — possible navigation confusion`,
    detail:   "Many brief failing commands may indicate disorientation. Use the Debug Sequence or Bundles.",
    rec:      "Open the Debug Sequence panel to get guided diagnostic steps",
    recCmd:   null,
  };
}

// ── Simplification candidates ─────────────────────────────────────────────────
// Identifies frequently-executed multi-step patterns that could be bundled.

function _buildSimplificationCandidates(hist) {
  const now    = Date.now();
  const recent = hist.filter(h => h.ok && now - (h.ts || 0) < 7 * 24 * 3600000);
  const freq   = {};
  recent.forEach(h => {
    const k = (h.cmd || "").slice(0, 60);
    freq[k] = (freq[k] || 0) + 1;
  });
  return Object.entries(freq)
    .filter(([, c]) => c >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([cmd, count]) => ({ cmd, count, suggestion: `Add "${cmd}" to a workflow bundle` }));
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useWorkflowFrictionDetector() {
  const [frictions,    setFrictions]    = useState([]);
  const [simplCandidates, setSimplCandidates] = useState([]);
  const [initialized,  setInitialized]  = useState(false);

  const analyze = useCallback(() => {
    const hist    = _load("jarvis_workflow_hist", []);
    const frict   = _load("jarvis_friction_signals", []);
    const bundles = _load("jarvis_wa_chains", []);

    const detected = [
      _detectRecoveryLoops(hist),
      _detectExcessiveWorkflowSteps(bundles),
      _detectDebuggingBottlenecks(hist),
      _detectDeploymentSlowdowns(hist),
      _detectReplayFriction(frict),
      _detectNavigationConfusion(hist),
    ].filter(Boolean);

    const candidates = _buildSimplificationCandidates(hist);
    const capped     = detected.slice(0, FRIC_MAX);

    setFrictions(capped);
    setSimplCandidates(candidates);
    _save(FRICTION_STATE_KEY, { frictions: capped, candidates, ts: Date.now() });
  }, []);

  useEffect(() => {
    // Load cached state first
    const cached = _load(FRICTION_STATE_KEY, null);
    if (cached && Date.now() - (cached.ts || 0) < 30 * 60 * 1000) {
      setFrictions(cached.frictions || []);
      setSimplCandidates(cached.candidates || []);
    }
    analyze();
    setInitialized(true);
  }, [analyze]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") analyze(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [analyze]);

  // Recommendations: one per friction, capped
  const recommendations = useMemo(() =>
    frictions
      .filter(f => f.rec)
      .slice(0, REC_MAX)
      .map(f => ({ id: f.id, title: f.rec, cmd: f.recCmd, severity: f.severity, source: f.type })),
    [frictions]
  );

  // Friction summary for operator bar
  const frictionSummary = useMemo(() => {
    const high   = frictions.filter(f => f.severity === "high").length;
    const medium = frictions.filter(f => f.severity === "medium").length;
    if (high > 0)   return { label: `${high} friction issue(s)`, color: "var(--op-red)",   count: high };
    if (medium > 0) return { label: `${medium} friction signal(s)`, color: "var(--op-amber)", count: medium };
    return            { label: "No friction detected", color: "var(--op-green)", count: 0 };
  }, [frictions]);

  return {
    initialized,
    frictions,
    recommendations,
    simplificationCandidates: simplCandidates,
    frictionSummary,
    analyze,
  };
}
