// Phase 887: Operator onboarding foundation.
// Guided workspace initialization, replay-aware onboarding flows,
// debugging workflow discovery, deployment walkthroughs.
//
// Design: progressive disclosure — new operators see calm step-by-step guidance.
// Returning operators see abbreviated reminders only.
// All state: localStorage-only. No timers. No external calls. No autonomous execution.

import { useState, useEffect, useCallback, useMemo } from "react";

const OB_KEY      = "jarvis_onboarding";
const OB_TTL      = 30 * 24 * 60 * 60 * 1000; // 30 days before re-showing

// ── Onboarding flow definitions ───────────────────────────────────────────────
// Each step: { id, title, body, action?, actionLabel? }
// action is a string key — the consumer maps it to a real handler.

const FLOWS = {
  workspace_init: {
    id:    "workspace_init",
    title: "Welcome to Ooplix",
    steps: [
      {
        id:    "ws_health",
        title: "Check runtime health",
        body:  "Start each session by verifying that services are running. The trust score at the top shows TRUSTED / DEGRADED / UNSTABLE.",
        action: "check_health",
        actionLabel: "Run health check",
      },
      {
        id:    "ws_explore",
        title: "Explore workflow bundles",
        body:  "Pre-built bundles — startup, recovery, deployment — let you run common sequences with a single click. Try the Startup bundle now.",
        action: "open_bundles",
        actionLabel: "Open bundles",
      },
      {
        id:    "ws_first_command",
        title: "Run your first command",
        body:  "Type any shell command in the input bar. Commands with ⚠ warnings require your explicit approval before execution.",
        action: null,
        actionLabel: null,
      },
      {
        id:    "ws_done",
        title: "You're set up",
        body:  "Your session state is automatically saved. If you disconnect, Ooplix restores your last context on reconnect.",
        action: null,
        actionLabel: null,
      },
    ],
  },

  debugging_discovery: {
    id:    "debugging_discovery",
    title: "Debugging workflows",
    steps: [
      {
        id:    "dbg_sequence",
        title: "Follow the debug sequence",
        body:  "The Debug Sequence in the panel shows dependency-aware steps: health check → diagnose → inspect logs → restart → verify. Follow them in order.",
        action: "open_debug_sequence",
        actionLabel: "Show debug sequence",
      },
      {
        id:    "dbg_replay",
        title: "Replay past sessions",
        body:  "Recent command history is preserved across reconnects. If a session was interrupted, Ooplix highlights the last failed step.",
        action: null,
        actionLabel: null,
      },
      {
        id:    "dbg_export",
        title: "Export debugging context",
        body:  "Use the Collaboration panel to export a debug handoff — a snapshot of active root causes and recovery paths — for async team sharing.",
        action: "open_collab",
        actionLabel: "Open collaboration",
      },
    ],
  },

  deployment_walkthrough: {
    id:    "deployment_walkthrough",
    title: "Safe deployment flow",
    steps: [
      {
        id:    "dep_trust",
        title: "Check trust before deploying",
        body:  "Ooplix blocks deployment when trust score is below 55 (DEGRADED) or when a crash was recorded in the last 30 minutes.",
        action: "check_health",
        actionLabel: "View trust score",
      },
      {
        id:    "dep_backup",
        title: "Create a backup",
        body:  "The Deploy Prep workflow includes a backup step. A fresh backup improves your deployment confidence score and enables safe rollback.",
        action: "open_deploy_bundle",
        actionLabel: "Open deploy bundle",
      },
      {
        id:    "dep_approval",
        title: "Approve deployment step",
        body:  "Deployment commands always show an approval gate. Click Approve to proceed — or Cancel to abort with no changes made.",
        action: null,
        actionLabel: null,
      },
      {
        id:    "dep_verify",
        title: "Verify after deploy",
        body:  "Run pm2 status and curl health-check after every deployment. The Deploy bundle includes a verification step automatically.",
        action: null,
        actionLabel: null,
      },
    ],
  },

  safety_education: {
    id:    "safety_education",
    title: "Operational safety",
    steps: [
      {
        id:    "safe_destructive",
        title: "Destructive command protection",
        body:  "Ooplix blocks commands matching known destructive patterns (rm -rf, fork bombs, pipe-to-shell). If you need to run one, disable the block in Settings.",
        action: null,
        actionLabel: null,
      },
      {
        id:    "safe_approval",
        title: "Approval gates",
        body:  "Any step flagged requiresApproval shows a gate before execution. You can always Cancel — nothing is executed without your explicit confirmation.",
        action: null,
        actionLabel: null,
      },
      {
        id:    "safe_trust",
        title: "Trust score",
        body:  "Trust degrades with crash events, reconnect storms, and high failure rates. When UNSTABLE, automation limits tighten automatically.",
        action: null,
        actionLabel: null,
      },
    ],
  },
};

const FLOW_ORDER = ["workspace_init", "debugging_discovery", "deployment_walkthrough", "safety_education"];

// ── Storage helpers ───────────────────────────────────────────────────────────

function _loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(OB_KEY) || "null");
    if (!raw) return null;
    // Re-show after TTL
    if (Date.now() - (raw.completedAt || 0) > OB_TTL) return { ...raw, completed: false };
    return raw;
  } catch { return null; }
}

function _saveState(state) {
  try { localStorage.setItem(OB_KEY, JSON.stringify(state)); } catch {}
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useOperatorOnboarding() {
  const [obState, setObState] = useState(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const saved = _loadState();
    if (saved) {
      setObState(saved);
    } else {
      // First-time operator
      const fresh = {
        completed:       false,
        completedAt:     null,
        completedFlows:  [],
        activeFlow:      FLOW_ORDER[0],
        activeStepIdx:   0,
        dismissed:       false,
        isFirstTime:     true,
      };
      setObState(fresh);
      _saveState(fresh);
    }
    setInitialized(true);
  }, []);

  const _update = useCallback((patch) => {
    setObState(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      _saveState(next);
      return next;
    });
  }, []);

  // Active flow + step
  const activeFlow = useMemo(() => {
    if (!obState?.activeFlow) return null;
    return FLOWS[obState.activeFlow] || null;
  }, [obState?.activeFlow]);

  const activeStep = useMemo(() => {
    if (!activeFlow || obState == null) return null;
    return activeFlow.steps[obState.activeStepIdx] || null;
  }, [activeFlow, obState]);

  const stepProgress = useMemo(() => {
    if (!activeFlow || obState == null) return { current: 0, total: 0, pct: 0 };
    const total   = activeFlow.steps.length;
    const current = obState.activeStepIdx + 1;
    return { current, total, pct: Math.round((current / total) * 100) };
  }, [activeFlow, obState]);

  const flowProgress = useMemo(() => {
    if (!obState) return { current: 0, total: FLOW_ORDER.length, pct: 0 };
    const done = obState.completedFlows?.length || 0;
    return { current: done, total: FLOW_ORDER.length, pct: Math.round((done / FLOW_ORDER.length) * 100) };
  }, [obState]);

  // Advance to next step in current flow
  const advanceStep = useCallback(() => {
    if (!obState || !activeFlow) return;
    const nextIdx = obState.activeStepIdx + 1;
    if (nextIdx < activeFlow.steps.length) {
      _update({ activeStepIdx: nextIdx });
    } else {
      // Flow complete — move to next flow
      const completedFlows = [...(obState.completedFlows || []), activeFlow.id];
      const nextFlowIdx    = FLOW_ORDER.indexOf(activeFlow.id) + 1;
      if (nextFlowIdx < FLOW_ORDER.length) {
        _update({ completedFlows, activeFlow: FLOW_ORDER[nextFlowIdx], activeStepIdx: 0 });
      } else {
        // All flows done
        _update({ completedFlows, completed: true, completedAt: Date.now(), activeFlow: null, activeStepIdx: 0 });
      }
    }
  }, [obState, activeFlow, _update]);

  // Skip directly to a flow
  const jumpToFlow = useCallback((flowId) => {
    if (!FLOWS[flowId]) return;
    _update({ activeFlow: flowId, activeStepIdx: 0 });
  }, [_update]);

  // Dismiss onboarding (operator can always reopen)
  const dismiss = useCallback(() => {
    _update({ dismissed: true });
  }, [_update]);

  // Reopen onboarding
  const reopen = useCallback(() => {
    _update({ dismissed: false, activeFlow: obState?.completedFlows?.length < FLOW_ORDER.length
      ? obState?.activeFlow || FLOW_ORDER[0]
      : FLOW_ORDER[0],
      activeStepIdx: 0 });
  }, [obState, _update]);

  // Reset (re-trigger first-time flow)
  const reset = useCallback(() => {
    const fresh = {
      completed: false, completedAt: null, completedFlows: [],
      activeFlow: FLOW_ORDER[0], activeStepIdx: 0, dismissed: false, isFirstTime: false,
    };
    setObState(fresh);
    _saveState(fresh);
  }, []);

  const shouldShow = useMemo(() => {
    if (!obState || !initialized) return false;
    if (obState.dismissed) return false;
    if (obState.completed)  return false;
    return true;
  }, [obState, initialized]);

  // Reminder for returning operators: brief tips
  const showReminder = useMemo(() => {
    if (!obState || !initialized) return false;
    return !obState.isFirstTime && !obState.completed && !obState.dismissed;
  }, [obState, initialized]);

  return {
    initialized,
    shouldShow,
    showReminder,
    // Active flow state
    activeFlow,
    activeStep,
    stepProgress,
    flowProgress,
    // All flows (for TOC)
    allFlows: FLOW_ORDER.map(id => ({
      ...FLOWS[id],
      completed: obState?.completedFlows?.includes(id) || false,
      active:    obState?.activeFlow === id,
    })),
    // Actions
    advanceStep,
    jumpToFlow,
    dismiss,
    reopen,
    reset,
    // Raw state
    completed:  obState?.completed || false,
    dismissed:  obState?.dismissed || false,
    isFirstTime: obState?.isFirstTime || false,
  };
}
