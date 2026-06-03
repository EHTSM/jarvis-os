// Phase 828-834: Productivity workflow bundles.
// Provides deployment preparation flows, startup restoration bundles,
// debugging initialization chains, dependency recovery sequences,
// and contextual stabilization flows. All local, operator-approval-only.
//
// Constraints:
//   - No autonomous execution — returns workflow specs, operator dispatches steps
//   - Replay-safe: stale bundles are flagged, not replayed automatically
//   - Interruption-safe: each bundle step is independently executable
//   - Bounded: BUNDLE_MAX=10, DEPLOY_HIST_MAX=20, memory 24h TTL
//   - Multi-project isolation: keys prefixed jarvis_pw_

import { useState, useEffect, useCallback, useMemo } from "react";

const HIST_KEY       = "jarvis_workflow_hist";
const SNAPSHOT_KEY   = "jarvis_health_snapshot";
const EA_SESSION_KEY = "jarvis_ea_session";
const PW_MEMORY_KEY  = "jarvis_pw_memory";    // workflow memory — isolated namespace
const PW_EXEC_KEY    = "jarvis_pw_exec";      // execution dedup key
const PW_TTL         = 24 * 60 * 60 * 1000;  // 24h
const BUNDLE_MAX     = 10;
const DEPLOY_HIST_MAX = 20;
const EXEC_DEDUP_TTL = 3 * 60 * 1000;        // 3 min — prevent accidental re-run

// ── Storage helpers ──────────────────────────────────────────────────────────

function _loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
}

function _loadHealthSnap() {
  try { return JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null"); } catch { return null; }
}

function _loadEASession() {
  try {
    const raw = JSON.parse(localStorage.getItem(EA_SESSION_KEY) || "null");
    if (!raw || Date.now() - (raw.savedAt || 0) > PW_TTL) return null;
    return raw;
  } catch { return null; }
}

// Phase 831: Workflow memory — persists successful bundle completions
function _loadPWMemory() {
  try {
    const raw = JSON.parse(localStorage.getItem(PW_MEMORY_KEY) || "[]");
    const cutoff = Date.now() - PW_TTL;
    return raw.filter(e => (e.ts || 0) > cutoff);
  } catch { return []; }
}

function _savePWMemory(entries) {
  try {
    localStorage.setItem(PW_MEMORY_KEY, JSON.stringify(entries.slice(0, 50)));
  } catch {}
}

function _recordBundleSuccess(bundleId, label) {
  try {
    const mem = _loadPWMemory();
    const existing = mem.find(e => e.bundleId === bundleId);
    if (existing) {
      existing.count++;
      existing.ts = Date.now();
    } else {
      mem.unshift({ bundleId, label, count: 1, ts: Date.now() });
    }
    _savePWMemory(mem);
  } catch {}
}

// Phase 833: Execution dedup guard — prevents re-running the same bundle within 3 min
function _loadExecDedup() {
  try {
    const raw = JSON.parse(localStorage.getItem(PW_EXEC_KEY) || "{}");
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, ts]) => now - ts < EXEC_DEDUP_TTL));
  } catch { return {}; }
}

function _markBundleExec(bundleId) {
  try {
    const d = _loadExecDedup();
    d[bundleId] = Date.now();
    localStorage.setItem(PW_EXEC_KEY, JSON.stringify(d));
  } catch {}
}

function _wasBundleRecentlyExec(bundleId) {
  const d = _loadExecDedup();
  return !!(d[bundleId]);
}

// ── Phase 828: Deployment preparation workflow ───────────────────────────────

function _buildDeployWorkflow(hist, healthSnap, eaSession) {
  const now = Date.now();
  const WINDOW_30M = 30 * 60 * 1000;
  const recent = hist.filter(h => (now - (h.ts || 0)) < WINDOW_30M);

  const failRate = recent.length
    ? Math.round((recent.filter(h => !h.ok).length / recent.length) * 100)
    : 0;

  const lastBackup = hist.find(h => h.ok && /backup/i.test(h.cmd || ""));
  const backupAgeMin = lastBackup ? Math.round((now - (lastBackup.ts || 0)) / 60000) : null;

  const deployScore = eaSession?.deployReadiness?.score ?? 100;
  const trustScore  = healthSnap?.trust?.score ?? 100;

  // Build stages: each stage is independently executable
  const stages = [];

  // Stage 1: pre-deploy health check (always)
  stages.push({
    id:      "pre_deploy_health",
    label:   "Pre-deploy health check",
    steps: [
      { id: "pm2_list",  cmd: "pm2 list",                 label: "Check PM2 processes",  safe: true },
      { id: "check_disk", cmd: "df -h",                   label: "Check disk space",      safe: true },
    ],
    required: true,
    reason: "Confirm runtime is stable before deployment",
  });

  // Stage 2: backup (required if no recent backup)
  const needsBackup = backupAgeMin === null || backupAgeMin > 60;
  stages.push({
    id:       "pre_deploy_backup",
    label:    "Create deployment backup",
    steps: [
      { id: "backup", cmd: "npm run backup", label: "Create backup checkpoint", safe: true },
    ],
    required: needsBackup,
    reason:   needsBackup
      ? (backupAgeMin === null ? "No backup on record" : `Backup is ${Math.floor(backupAgeMin/60)}h old`)
      : `Backup available ${backupAgeMin}m ago — optional refresh`,
  });

  // Stage 3: lint + build check (if deploy score < 80)
  if (deployScore < 80 || failRate > 15) {
    stages.push({
      id:      "pre_deploy_lint",
      label:   "Validate build",
      steps: [
        { id: "lint",  cmd: "npm run lint",            label: "Run lint check",   safe: true },
        { id: "build", cmd: "npm run build:frontend",  label: "Build frontend",   safe: true },
      ],
      required: failRate > 25,
      reason:   failRate > 25
        ? `${failRate}% failure rate — validate before deploying`
        : "Recommended — confirm build is clean",
    });
  }

  // Stage 4: deploy
  stages.push({
    id:      "deploy_execute",
    label:   "Execute deployment",
    steps: [
      { id: "pm2_restart", cmd: "pm2 restart jarvis-backend", label: "Restart backend service", safe: false, requiresApproval: true },
    ],
    required: true,
    reason:   "Restart backend with latest code",
  });

  // Stage 5: post-deploy verification
  stages.push({
    id:       "post_deploy_verify",
    label:    "Post-deploy verification",
    steps: [
      { id: "pm2_status", cmd: "pm2 list",                                label: "Verify process health",    safe: true },
      { id: "tail_logs",  cmd: "pm2 logs jarvis-backend --lines 20 --noprefix", label: "Confirm clean startup", safe: true },
    ],
    required: true,
    reason:   "Confirm deployment succeeded before declaring stable",
  });

  // Rollback confidence
  let rollbackConfidence = 0;
  let rollbackLabel = "NO ROLLBACK";
  let rollbackColor = "var(--op-red)";
  if (backupAgeMin !== null && backupAgeMin < 30) {
    rollbackConfidence = 95; rollbackLabel = "READY"; rollbackColor = "var(--op-green)";
  } else if (backupAgeMin !== null && backupAgeMin < 120) {
    rollbackConfidence = 75; rollbackLabel = "AVAILABLE"; rollbackColor = "var(--op-amber)";
  } else if (backupAgeMin !== null) {
    rollbackConfidence = 40; rollbackLabel = "STALE"; rollbackColor = "var(--op-amber)";
  }

  return {
    id: "deploy_workflow",
    label: "Deployment workflow",
    stages,
    rollback: { confidence: rollbackConfidence, label: rollbackLabel, color: rollbackColor, ageMin: backupAgeMin },
    readinessScore: deployScore,
    trustScore,
    stagesRequired: stages.filter(s => s.required).length,
    stagesTotal: stages.length,
  };
}

// ── Phase 830: Workflow bundles ──────────────────────────────────────────────
// Returns named bundles of related steps for common engineering scenarios.

function _buildWorkflowBundles(hist, healthSnap) {
  const bundles = [];
  const trust = healthSnap?.trust;

  // Bundle: startup restoration
  bundles.push({
    id:    "startup_restore",
    label: "Startup restoration",
    icon:  "↩",
    description: "Restore your session and verify the runtime is healthy",
    steps: [
      { id: "pm2_list",    cmd: "pm2 list",                                    label: "Check processes",    safe: true },
      { id: "pm2_logs",    cmd: "pm2 logs jarvis-backend --lines 20 --noprefix", label: "Review recent logs", safe: true },
    ],
    category: "startup",
    priority: "high",
  });

  // Bundle: dependency recovery
  const depFails = hist
    .filter(h => !h.ok && /cannot find module|module not found|npm err/i.test(h.summary || h.output || ""))
    .slice(0, 3);
  if (depFails.length) {
    bundles.push({
      id:    "dep_recovery",
      label: "Dependency recovery",
      icon:  "⚙",
      description: `Restore missing dependencies (${depFails.length} recent failure${depFails.length > 1 ? "s" : ""})`,
      steps: [
        { id: "npm_ls",      cmd: "npm ls --depth=0 2>&1 | head -20", label: "Check installed packages", safe: true },
        { id: "npm_install", cmd: "npm install",                       label: "Reinstall dependencies",  safe: true },
      ],
      category: "recovery",
      priority: "high",
    });
  }

  // Bundle: contextual stabilization — when trust is degraded
  if (trust && trust.score < 80) {
    bundles.push({
      id:    "stabilize",
      label: "Stabilize runtime",
      icon:  "⚡",
      description: `Trust at ${trust.score}/100 — stabilize before proceeding`,
      steps: [
        { id: "pm2_logs",    cmd: "pm2 logs jarvis-backend --lines 30 --noprefix", label: "Inspect logs",        safe: true },
        { id: "pm2_restart", cmd: "pm2 restart jarvis-backend",                    label: "Restart backend",     safe: false, requiresApproval: true },
        { id: "pm2_list",    cmd: "pm2 list",                                       label: "Verify after restart", safe: true },
      ],
      category: "recovery",
      priority: "high",
    });
  }

  // Bundle: deployment preparation (always available)
  bundles.push({
    id:    "deploy_prep",
    label: "Deployment preparation",
    icon:  "🚀",
    description: "Pre-deploy checklist: backup, lint, health check",
    steps: [
      { id: "backup",    cmd: "npm run backup",        label: "Create backup",     safe: true },
      { id: "lint",      cmd: "npm run lint",          label: "Lint check",        safe: true },
      { id: "pm2_list",  cmd: "pm2 list",              label: "Verify health",     safe: true },
    ],
    category: "deployment",
    priority: "medium",
  });

  // Bundle: git health check
  bundles.push({
    id:    "git_health",
    label: "Git health check",
    icon:  "⎇",
    description: "Review repo state and recent changes",
    steps: [
      { id: "git_status",  cmd: "git status",           label: "Check repo status",  safe: true },
      { id: "git_log",     cmd: "git log --oneline -10", label: "Review recent commits", safe: true },
      { id: "git_stash_ls", cmd: "git stash list",      label: "Check stashed work",  safe: true },
    ],
    category: "startup",
    priority: "medium",
  });

  return bundles.slice(0, BUNDLE_MAX);
}

// ── Phase 832: Deployment history for replay visibility ──────────────────────
// Summarizes recent deployment outcomes for readiness visibility.

function _buildDeployHistory(hist) {
  const deployEntries = hist
    .filter(h => /deploy|pm2 start|pm2 restart/i.test(h.cmd || ""))
    .slice(0, DEPLOY_HIST_MAX);

  if (!deployEntries.length) return null;

  const successes = deployEntries.filter(h => h.ok).length;
  const failures  = deployEntries.filter(h => !h.ok).length;
  const successRate = Math.round((successes / deployEntries.length) * 100);

  const last = deployEntries[0];
  const lastAgeMin = last ? Math.round((Date.now() - (last.ts || 0)) / 60000) : null;

  return {
    total: deployEntries.length,
    successes,
    failures,
    successRate,
    lastResult: last?.ok ? "success" : "failure",
    lastAgeMin,
    lastCmd: last?.cmd,
    color: successRate >= 80 ? "var(--op-green)" : successRate >= 50 ? "var(--op-amber)" : "var(--op-red)",
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useProductivityWorkflows() {
  const [deployWorkflow,  setDeployWorkflow]  = useState(null);
  const [bundles,         setBundles]         = useState([]);
  const [deployHistory,   setDeployHistory]   = useState(null);
  const [activeBundleId,  setActiveBundleId]  = useState(null);
  const [bundleProgress,  setBundleProgress]  = useState({});
  const [pwMemory,        setPWMemory]        = useState([]);

  const evaluate = useCallback(() => {
    const hist       = _loadHist();
    const healthSnap = _loadHealthSnap();
    const eaSession  = _loadEASession();

    setDeployWorkflow(_buildDeployWorkflow(hist, healthSnap, eaSession));
    setBundles(_buildWorkflowBundles(hist, healthSnap));
    setDeployHistory(_buildDeployHistory(hist));
    setPWMemory(_loadPWMemory());
  }, []);

  useEffect(() => {
    evaluate();
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Phase 830: start a bundle (with dedup guard)
  const startBundle = useCallback((bundleId) => {
    if (_wasBundleRecentlyExec(bundleId)) return false; // deduped
    setActiveBundleId(bundleId);
    setBundleProgress(prev => ({ ...prev, [bundleId]: 0 }));
    _markBundleExec(bundleId);
    return true;
  }, []);

  // Advance bundle progress (operator-called after each step)
  const advanceBundle = useCallback((bundleId) => {
    setBundleProgress(prev => ({ ...prev, [bundleId]: (prev[bundleId] ?? 0) + 1 }));
  }, []);

  // Phase 831: complete a bundle, record in memory
  const completeBundle = useCallback((bundleId, label) => {
    _recordBundleSuccess(bundleId, label);
    setActiveBundleId(prev => prev === bundleId ? null : prev);
    setBundleProgress(prev => {
      const next = { ...prev };
      delete next[bundleId];
      return next;
    });
    setPWMemory(_loadPWMemory());
  }, []);

  // Dismiss/cancel a bundle without recording success
  const cancelBundle = useCallback((bundleId) => {
    setActiveBundleId(prev => prev === bundleId ? null : prev);
    setBundleProgress(prev => {
      const next = { ...prev };
      delete next[bundleId];
      return next;
    });
  }, []);

  // Phase 827: current step in the active bundle
  const activeBundleStep = useMemo(() => {
    if (!activeBundleId) return null;
    const bundle = bundles.find(b => b.id === activeBundleId);
    if (!bundle) return null;
    const stepIdx = bundleProgress[activeBundleId] ?? 0;
    const step = bundle.steps[stepIdx];
    if (!step) return null; // bundle complete
    return {
      bundleId:    activeBundleId,
      bundleLabel: bundle.label,
      stepIdx,
      totalSteps:  bundle.steps.length,
      ...step,
    };
  }, [activeBundleId, bundles, bundleProgress]);

  // Phase 832: high-priority bundles surface first
  const highPriorityBundles = useMemo(
    () => bundles.filter(b => b.priority === "high"),
    [bundles]
  );

  // Phase 831: recently successful bundles from memory (for recall)
  const recentSuccesses = useMemo(
    () => pwMemory.slice(0, 5).map(e => ({ ...e, stale: Date.now() - e.ts > 2 * 60 * 60 * 1000 })),
    [pwMemory]
  );

  // Phase 828: deploy workflow stage progression
  const [activeDeployStage, setActiveDeployStage] = useState(0);
  const advanceDeployStage = useCallback(() => {
    setActiveDeployStage(prev => prev + 1);
  }, []);
  const resetDeployWorkflow = useCallback(() => {
    setActiveDeployStage(0);
  }, []);

  const currentDeployStage = useMemo(() => {
    if (!deployWorkflow) return null;
    const stage = deployWorkflow.stages[activeDeployStage];
    if (!stage) return null;
    return { ...stage, stageIdx: activeDeployStage, totalStages: deployWorkflow.stages.length };
  }, [deployWorkflow, activeDeployStage]);

  return {
    // Phase 828: deployment workflow
    deployWorkflow,
    deployHistory,
    currentDeployStage,
    activeDeployStage,
    advanceDeployStage,
    resetDeployWorkflow,
    // Phase 830: workflow bundles
    bundles,
    highPriorityBundles,
    activeBundleId,
    activeBundleStep,
    bundleProgress,
    startBundle,
    advanceBundle,
    completeBundle,
    cancelBundle,
    // Phase 831: workflow memory
    recentSuccesses,
    pwMemory,
    // Shared
    evaluate,
  };
}
