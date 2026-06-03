// Phase 826-827: Workspace restoration + one-click debugging flows.
// Provides reconnect-safe workspace recovery, replay-linked environment restore,
// and debugging-session continuity across browser restarts/reconnects.
//
// Constraints:
//   - All local — no external calls
//   - No autonomous execution — returns commands only, operator dispatches
//   - Bounded: max 10 workspace snapshots, 24h TTL, max 8 debug flows
//   - Reconnect-safe: all state derived from localStorage

import { useState, useEffect, useCallback, useMemo } from "react";

const WS_KEY        = "jarvis_operator_workspace";
const HIST_KEY      = "jarvis_workflow_hist";
const FRICTION_KEY  = "jarvis_friction_signals";
const SESSION_KEY   = "jarvis_debug_sessions";
const SNAPSHOT_KEY  = "jarvis_health_snapshot";
const WS_MAX        = 10;
const WS_TTL        = 24 * 60 * 60 * 1000;   // 24h
const FLOW_MAX      = 8;

// ── Storage helpers ──────────────────────────────────────────────────────────

function _loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
}

function _loadDebugSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "[]");
    const cutoff = Date.now() - WS_TTL;
    return raw.filter(s => (s.startedAt || 0) > cutoff);
  } catch { return []; }
}

// ── Phase 826: Workspace snapshot persistence ────────────────────────────────
// Snapshots are written by callers (WorkflowPanel/ExecLogPanel on meaningful state).
// On restore, the latest valid snapshot is hydrated.

function _loadWorkspaceSnaps() {
  try {
    const raw = JSON.parse(localStorage.getItem(WS_KEY) || "[]");
    const cutoff = Date.now() - WS_TTL;
    return raw.filter(s => (s.ts || 0) > cutoff).slice(0, WS_MAX);
  } catch { return []; }
}

function _saveWorkspaceSnap(snap) {
  try {
    const snaps = _loadWorkspaceSnaps();
    snaps.unshift({ ...snap, ts: Date.now() });
    localStorage.setItem(WS_KEY, JSON.stringify(snaps.slice(0, WS_MAX)));
  } catch {}
}

// ── Phase 826: Environment restore context ───────────────────────────────────
// Derives what the operator was doing from the most recent workspace snapshot,
// debug sessions, and execution history. Returns a single "restore context".

function _buildRestoreContext(snaps, debugSessions, hist) {
  const latest = snaps[0] || null;
  const latestSession = debugSessions[0] || null;

  // Last command the operator ran
  const lastCmd = hist[0];

  // Infer mode: debugging, deployment, or general
  let mode = "general";
  let modeLabel = "General workspace";
  let modeColor = "var(--op-text2)";

  if (latestSession) {
    mode = "debugging";
    modeLabel = `Debugging: ${latestSession.label}`;
    modeColor = "var(--op-amber)";
  } else if (lastCmd && /deploy|pm2 start|pm2 restart/i.test(lastCmd.cmd || "")) {
    mode = "deployment";
    modeLabel = "Deployment workflow";
    modeColor = "var(--op-blue, #44a2ff)";
  } else if (latest?.mode) {
    mode = latest.mode;
    modeLabel = latest.modeLabel || "Restored workspace";
    modeColor = "var(--op-text2)";
  }

  const ageMin = latest ? Math.round((Date.now() - latest.ts) / 60000) : null;
  const sessionAgeMin = latestSession
    ? Math.round((Date.now() - latestSession.startedAt) / 60000)
    : null;

  // Stale if > 4h
  const stale = ageMin !== null && ageMin > 240;

  return {
    mode,
    modeLabel,
    modeColor,
    stale,
    ageMin,
    sessionAgeMin,
    lastCmd:     lastCmd ? { cmd: lastCmd.cmd, ok: lastCmd.ok } : null,
    snapLabel:   latest?.label || null,
    debugSession: latestSession ? { label: latestSession.label, errorClass: latestSession.errorClass } : null,
    hasContext:  !!(latest || latestSession || lastCmd),
  };
}

// ── Phase 827: One-click debugging flows ─────────────────────────────────────
// Generates bounded, ordered debugging initialization flows.
// Flows are interrupt-safe: each step is independent; operator approves each.

function _buildDebugFlows(hist, restoreCtx, healthSnap) {
  const flows = [];
  const trust = healthSnap?.trust;
  const topPred = healthSnap?.predictions?.[0] || null;

  // Flow 1: Runtime health verification — always available
  flows.push({
    id:        "verify_health",
    label:     "Verify runtime health",
    steps: [
      { id: "pm2_list",    cmd: "pm2 list",                        label: "Check PM2 processes",  safe: true },
      { id: "pm2_logs",    cmd: "pm2 logs jarvis-backend --lines 20 --noprefix", label: "Tail backend logs", safe: true },
    ],
    priority: trust?.score < 80 ? "high" : "medium",
    reason:   trust?.score < 80
      ? `Trust score ${trust.score}/100 — verify runtime is stable`
      : "Confirm runtime is healthy before starting work",
  });

  // Flow 2: Dependency validation — when recent dep errors detected
  const depFails = hist
    .filter(h => !h.ok && /cannot find module|module not found|npm err/i.test(h.summary || h.output || ""))
    .slice(0, 3);
  if (depFails.length) {
    flows.push({
      id:       "validate_deps",
      label:    "Validate dependencies",
      steps: [
        { id: "npm_ls",   cmd: "npm ls --depth=0 2>&1 | head -20", label: "List installed packages", safe: true },
        { id: "npm_install", cmd: "npm install",                   label: "Restore missing deps",    safe: true },
      ],
      priority: "high",
      reason:   `${depFails.length} dependency failure(s) in recent history`,
    });
  }

  // Flow 3: Replay-linked debug startup — when restoring a debug session
  if (restoreCtx.debugSession) {
    const ec = restoreCtx.debugSession.errorClass;
    const diagCmd = ec === "connection" ? "pm2 list"
                  : ec === "npm"        ? "npm install"
                  : ec === "pm2"        ? "pm2 logs jarvis-backend --lines 30 --noprefix"
                  : ec === "git"        ? "git status && git log --oneline -5"
                  : "pm2 logs --lines 20 --noprefix";
    flows.push({
      id:       "replay_debug",
      label:    `Resume: ${restoreCtx.debugSession.label}`,
      steps: [
        { id: "context_check", cmd: diagCmd, label: `Diagnose: ${ec || "last error"}`, safe: true },
        { id: "pm2_status",    cmd: "pm2 list",                                         label: "Confirm process state",   safe: true },
      ],
      priority: "high",
      reason:   `Resuming debug session from ${restoreCtx.sessionAgeMin}m ago`,
    });
  }

  // Flow 4: Prediction-based pre-emptive check
  if (topPred?.cmd) {
    flows.push({
      id:       `preempt_${topPred.id}`,
      label:    `Preemptive: ${topPred.msg.slice(0, 50)}`,
      steps: [
        { id: "pred_check", cmd: topPred.cmd, label: topPred.suggestion || "Run diagnostic", safe: true },
      ],
      priority: topPred.severity === "high" ? "high" : "medium",
      reason:   `Predicted issue — ${topPred.probability}% probability`,
    });
  }

  // Flow 5: Contextual troubleshooting — based on recent failures
  const recentFails = hist.filter(h => !h.ok).slice(0, 5);
  if (recentFails.length >= 2) {
    const topFail = recentFails[0];
    flows.push({
      id:       "contextual_troubleshoot",
      label:    "Contextual troubleshooting",
      steps: [
        { id: "inspect_fail", cmd: "pm2 logs jarvis-backend --lines 30 --noprefix", label: "Inspect failure context", safe: true },
        { id: "check_disk",   cmd: "df -h",                                          label: "Check disk space",        safe: true },
      ],
      priority: "medium",
      reason:   `${recentFails.length} recent failures — last: ${(topFail.cmd || "").slice(0, 30)}`,
    });
  }

  // Dedup + sort by priority + cap
  const seen = new Set();
  const sorted = flows
    .filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true; })
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
    })
    .slice(0, FLOW_MAX);

  return sorted;
}

// ── Phase 826: Startup friction estimation ───────────────────────────────────
// Scores how much friction the operator faces on startup. Lower = faster start.

function _estimateStartupFriction(restoreCtx, hist, friction) {
  let friction_score = 0;
  const items = [];

  // No workspace context → high friction
  if (!restoreCtx.hasContext) {
    friction_score += 30;
    items.push({ label: "No prior context to restore", severity: "medium" });
  }

  // Stale snapshot
  if (restoreCtx.stale) {
    friction_score += 15;
    items.push({ label: `Workspace snapshot is ${Math.floor(restoreCtx.ageMin / 60)}h old`, severity: "low" });
  }

  // Recent failures to investigate
  const recentFails = hist.filter(h => !h.ok && Date.now() - (h.ts || 0) < 30 * 60 * 1000).length;
  if (recentFails >= 3) {
    friction_score += 20;
    items.push({ label: `${recentFails} unresolved failures in last 30m`, severity: "medium" });
  }

  // Active reconnect noise
  const reconnects = friction.filter(f =>
    f.type === "reconnect_event" && Date.now() - (f.ts || 0) < 10 * 60 * 1000
  ).length;
  if (reconnects >= 2) {
    friction_score += 15;
    items.push({ label: `${reconnects} reconnects in last 10m`, severity: "medium" });
  }

  return {
    score: Math.min(100, friction_score),
    label: friction_score >= 40 ? "HIGH FRICTION" : friction_score >= 20 ? "MODERATE" : "SMOOTH",
    color: friction_score >= 40 ? "var(--op-red)" : friction_score >= 20 ? "var(--op-amber)" : "var(--op-green)",
    items,
  };
}

// ── Main hook ────────────────────────────────────────────────────────────────

export function useWorkspaceRestoration() {
  const [restoreCtx,    setRestoreCtx]    = useState(null);
  const [debugFlows,    setDebugFlows]    = useState([]);
  const [startupFriction, setStartupFriction] = useState(null);
  const [activeFlowId,  setActiveFlowId]  = useState(null);
  const [flowProgress,  setFlowProgress]  = useState({}); // flowId → stepIndex

  const evaluate = useCallback(() => {
    try {
      const snaps   = _loadWorkspaceSnaps();
      const sessions = _loadDebugSessions();
      const hist    = _loadHist();
      const friction = JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]");
      const healthSnap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");

      const ctx    = _buildRestoreContext(snaps, sessions, hist);
      const flows  = _buildDebugFlows(hist, ctx, healthSnap);
      const sf     = _estimateStartupFriction(ctx, hist, friction);

      setRestoreCtx(ctx);
      setDebugFlows(flows);
      setStartupFriction(sf);
    } catch {}
  }, []);

  useEffect(() => {
    evaluate();
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Save a workspace snapshot (called by operator-facing components on meaningful events)
  const saveSnapshot = useCallback((label, extra = {}) => {
    _saveWorkspaceSnap({ label, ...extra });
    evaluate();
  }, [evaluate]);

  // Start a debug flow — tracks which step is active
  const startFlow = useCallback((flowId) => {
    setActiveFlowId(flowId);
    setFlowProgress(prev => ({ ...prev, [flowId]: 0 }));
  }, []);

  // Advance to next step in a flow (operator calls after each step completes)
  const advanceFlow = useCallback((flowId) => {
    setFlowProgress(prev => ({ ...prev, [flowId]: (prev[flowId] ?? 0) + 1 }));
  }, []);

  // Complete/dismiss a flow
  const completeFlow = useCallback((flowId) => {
    setActiveFlowId(prev => prev === flowId ? null : prev);
    setFlowProgress(prev => {
      const next = { ...prev };
      delete next[flowId];
      return next;
    });
  }, []);

  // Phase 827: current step for the active flow
  const activeFlowStep = useMemo(() => {
    if (!activeFlowId) return null;
    const flow = debugFlows.find(f => f.id === activeFlowId);
    if (!flow) return null;
    const stepIdx = flowProgress[activeFlowId] ?? 0;
    const step = flow.steps[stepIdx];
    if (!step) return null;
    return {
      flowId:   activeFlowId,
      flowLabel: flow.label,
      stepIdx,
      totalSteps: flow.steps.length,
      ...step,
    };
  }, [activeFlowId, debugFlows, flowProgress]);

  // Phase 827: high-priority flows to surface first
  const highPriorityFlows = useMemo(
    () => debugFlows.filter(f => f.priority === "high"),
    [debugFlows]
  );

  return {
    // Phase 826: workspace restore context
    restoreCtx,
    startupFriction,
    saveSnapshot,
    // Phase 827: one-click debugging flows
    debugFlows,
    highPriorityFlows,
    activeFlowId,
    activeFlowStep,
    flowProgress,
    startFlow,
    advanceFlow,
    completeFlow,
    evaluate,
  };
}
