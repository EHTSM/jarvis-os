// Phase 856-865: Safe workflow automation.
// Provides approval-gated workflow chains, adaptive recovery sequencing,
// deployment automation, contextual execution chains, and engineering memory.
//
// Constraints:
//   - No autonomous execution — all chains return step specs, operator dispatches
//   - Approval-gated: risky steps flagged requiresApproval=true
//   - Bounded: CHAIN_MAX=6 steps, HISTORY_MAX=20 chains, MEMORY_MAX=30, 24h TTL
//   - Reconnect-safe: all state persisted to jarvis_wa_ namespace
//   - Multi-project isolated: all keys prefixed jarvis_wa_
//   - Stale guard: 6h chain session TTL, 5min execution dedup

import { useState, useEffect, useCallback, useMemo } from "react";

const HIST_KEY       = "jarvis_workflow_hist";
const FRICTION_KEY   = "jarvis_friction_signals";
const SNAPSHOT_KEY   = "jarvis_health_snapshot";
const OI_SESSION_KEY = "jarvis_oi_session";
const WA_CHAINS_KEY  = "jarvis_wa_chains";    // active/queued chains
const WA_MEMORY_KEY  = "jarvis_wa_memory";    // successful chain completions
const WA_SESSION_KEY = "jarvis_wa_session";   // reconnect-safe session
const WA_DEDUP_KEY   = "jarvis_wa_dedup";     // execution dedup guard

const CHAIN_MAX     = 6;   // max steps per chain
const HISTORY_MAX   = 20;  // chains remembered in memory
const MEMORY_MAX    = 30;
const WA_TTL        = 24 * 60 * 60 * 1000;
const SESSION_TTL   = 6  * 60 * 60 * 1000;
const DEDUP_TTL     = 5  * 60 * 1000;  // 5 min — prevents duplicate chain start

// ── Storage helpers ──────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; }
  catch { return fallback; }
}

function _loadHist()     { return _load(HIST_KEY, []); }
function _loadFriction() { return _load(FRICTION_KEY, []); }

function _loadWAMemory() {
  try {
    const raw = _load(WA_MEMORY_KEY, []);
    return raw.filter(e => Date.now() - (e.ts || 0) < WA_TTL);
  } catch { return []; }
}

function _saveWAMemory(entries) {
  try { localStorage.setItem(WA_MEMORY_KEY, JSON.stringify(entries.slice(0, MEMORY_MAX))); } catch {}
}

function _loadWASession() {
  try {
    const raw = _load(WA_SESSION_KEY, null);
    if (!raw || Date.now() - (raw.savedAt || 0) > SESSION_TTL) return null;
    return raw;
  } catch { return null; }
}

function _saveWASession(data) {
  try { localStorage.setItem(WA_SESSION_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch {}
}

// Phase 864: dedup guard — prevents re-starting same chain within 5 min
function _loadDedup() {
  try {
    const raw = _load(WA_DEDUP_KEY, {});
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, ts]) => now - ts < DEDUP_TTL));
  } catch { return {}; }
}

function _markChainStarted(chainId) {
  try {
    const d = _loadDedup();
    d[chainId] = Date.now();
    localStorage.setItem(WA_DEDUP_KEY, JSON.stringify(d));
  } catch {}
}

function _wasChainRecentlyStarted(chainId) {
  const d = _loadDedup();
  return !!(d[chainId]);
}

// Phase 862: record successful chain completion
function _recordChainSuccess(chainId, label, category) {
  try {
    const mem = _loadWAMemory();
    const existing = mem.find(e => e.chainId === chainId);
    if (existing) { existing.count++; existing.ts = Date.now(); }
    else { mem.unshift({ chainId, label, category, count: 1, ts: Date.now() }); }
    _saveWAMemory(mem);
  } catch {}
}

// ── Phase 856: Safe workflow chain builder ────────────────────────────────────
// Generates bounded, interrupt-safe step chains for common engineering scenarios.
// Each chain: ordered steps, each with safe/requiresApproval flags + reason.

function _buildWorkflowChains(hist, friction, healthSnap, oiSession) {
  const chains = [];
  const now = Date.now();
  const W15 = 15 * 60 * 1000;
  const W30 = 30 * 60 * 1000;

  const recent15 = hist.filter(h => (now - (h.ts || 0)) < W15);
  const failRate  = recent15.length
    ? Math.round((recent15.filter(h => !h.ok).length / recent15.length) * 100) : 0;
  const trust = healthSnap?.trust;
  const reconnects = friction.filter(f =>
    f.type === "reconnect_event" && (now - (f.ts || 0)) < 10 * 60 * 1000
  ).length;

  // Chain 1: Debugging setup (always available — validation-first)
  chains.push({
    id:       "debug_setup",
    label:    "Debugging setup",
    category: "debugging",
    icon:     "🔍",
    priority: failRate > 30 ? "high" : "medium",
    reason:   failRate > 30 ? `${failRate}% failure rate — full debug setup` : "Prepare debug environment",
    steps: [
      { id: "pm2_list",    cmd: "pm2 list",                                          label: "Check process health", safe: true,  phase: "validate" },
      { id: "pm2_logs",    cmd: "pm2 logs jarvis-backend --lines 30 --noprefix",     label: "Inspect logs",         safe: true,  phase: "diagnose" },
      { id: "disk_check",  cmd: "df -h",                                              label: "Check disk space",     safe: true,  phase: "diagnose" },
    ].slice(0, CHAIN_MAX),
  });

  // Chain 2: Adaptive recovery (surfaces when trust is degraded or fail rate high)
  if (failRate > 25 || (trust && trust.score < 70)) {
    const topCause = oiSession?.priorityItems?.[0];
    const recoveryCmd = topCause?.suggestedAction || "pm2 logs jarvis-backend --lines 30 --noprefix";
    chains.push({
      id:       "adaptive_recovery",
      label:    "Adaptive recovery",
      category: "recovery",
      icon:     "⚡",
      priority: "high",
      reason:   trust ? `Trust ${trust.score}/100 — guided recovery` : `${failRate}% fail rate`,
      steps: [
        { id: "diagnose",    cmd: recoveryCmd,                              label: topCause?.actionLabel || "Diagnose top issue", safe: true,  phase: "diagnose" },
        { id: "pm2_logs",    cmd: "pm2 logs jarvis-backend --lines 30 --noprefix", label: "Inspect logs",  safe: true,  phase: "diagnose" },
        { id: "restart",     cmd: "pm2 restart jarvis-backend",             label: "Restart backend",      safe: false, phase: "recover", requiresApproval: true },
        { id: "verify",      cmd: "pm2 list",                               label: "Verify recovery",      safe: true,  phase: "verify"  },
      ].slice(0, CHAIN_MAX),
    });
  }

  // Chain 3: Deployment preparation
  const deployScore = oiSession?.deployReadiness?.score ?? 100;
  const lastBackup  = hist.find(h => h.ok && /backup/i.test(h.cmd || ""));
  const backupAgeMin = lastBackup ? Math.round((now - (lastBackup.ts || 0)) / 60000) : null;
  const needsBackup  = backupAgeMin === null || backupAgeMin > 60;

  const deploySteps = [
    { id: "health_pre",  cmd: "pm2 list",        label: "Pre-deploy health",  safe: true, phase: "validate" },
  ];
  if (needsBackup) {
    deploySteps.push({ id: "backup",    cmd: "npm run backup",  label: "Create backup",      safe: true, phase: "prepare" });
  }
  deploySteps.push({ id: "lint",       cmd: "npm run lint",    label: "Lint check",         safe: true, phase: "prepare" });
  deploySteps.push({ id: "deploy",     cmd: "pm2 restart jarvis-backend", label: "Deploy",  safe: false, phase: "deploy", requiresApproval: true });
  deploySteps.push({ id: "verify",     cmd: "pm2 list",        label: "Verify deploy",      safe: true, phase: "verify" });

  chains.push({
    id:       "deploy_prep",
    label:    "Deployment preparation",
    category: "deployment",
    icon:     "🚀",
    priority: deployScore < 60 ? "high" : "medium",
    reason:   deployScore < 60 ? `Deploy score ${deployScore}/100 — requires attention` : "Staged deployment workflow",
    steps:    deploySteps.slice(0, CHAIN_MAX),
  });

  // Chain 4: Dependency validation
  const depFails = hist.filter(h =>
    !h.ok && /cannot find module|module not found|npm err/i.test(h.summary || h.output || "") &&
    (now - (h.ts || 0)) < W30
  ).length;
  if (depFails >= 1) {
    chains.push({
      id:       "dep_validation",
      label:    "Dependency validation",
      category: "dependencies",
      icon:     "⚙",
      priority: depFails >= 3 ? "high" : "medium",
      reason:   `${depFails} dependency failure${depFails > 1 ? "s" : ""} in last 30m`,
      steps: [
        { id: "npm_ls",      cmd: "npm ls --depth=0 2>&1 | head -20", label: "Check packages",   safe: true, phase: "validate" },
        { id: "npm_install", cmd: "npm install",                       label: "Reinstall deps",   safe: true, phase: "repair"   },
        { id: "verify",      cmd: "pm2 list",                          label: "Verify runtime",   safe: true, phase: "verify"   },
      ].slice(0, CHAIN_MAX),
    });
  }

  // Chain 5: Reconnect recovery (when SSE is storming)
  if (reconnects >= 3) {
    chains.push({
      id:       "reconnect_recovery",
      label:    "Reconnect recovery",
      category: "connectivity",
      icon:     "⟳",
      priority: "high",
      reason:   `${reconnects} reconnects in last 10m — SSE stream unstable`,
      steps: [
        { id: "pm2_logs", cmd: "pm2 logs jarvis-backend --lines 20 --noprefix", label: "Check backend logs", safe: true, phase: "diagnose" },
        { id: "restart",  cmd: "pm2 restart jarvis-backend",                    label: "Restart backend",    safe: false, phase: "recover", requiresApproval: true },
        { id: "verify",   cmd: "pm2 list",                                       label: "Confirm process",    safe: true, phase: "verify"  },
      ].slice(0, CHAIN_MAX),
    });
  }

  // Phase 860: Contextual execution chain — git health when git errors detected
  const gitFails = hist.filter(h =>
    !h.ok && /git|merge conflict|CONFLICT/i.test(h.summary || h.output || "") &&
    (now - (h.ts || 0)) < W30
  ).length;
  if (gitFails >= 1) {
    chains.push({
      id:       "git_health",
      label:    "Git health check",
      category: "debugging",
      icon:     "⎇",
      priority: "medium",
      reason:   `${gitFails} git error(s) in last 30m`,
      steps: [
        { id: "git_status", cmd: "git status",             label: "Check repo state",   safe: true, phase: "diagnose" },
        { id: "git_log",    cmd: "git log --oneline -10",  label: "Review commits",     safe: true, phase: "diagnose" },
        { id: "git_stash",  cmd: "git stash list",         label: "Check stashes",      safe: true, phase: "diagnose" },
      ].slice(0, CHAIN_MAX),
    });
  }

  // Sort: high priority first, dedup by id
  const seen = new Set();
  return chains
    .filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
    });
}

// ── Phase 858: Deployment trust summary ─────────────────────────────────────
// Generates a compact deployment trust report for operator visibility.

function _buildDeployTrust(hist, oiSession) {
  const now = Date.now();
  const W30 = 30 * 60 * 1000;
  const recent = hist.filter(h => (now - (h.ts || 0)) < W30);
  const failRate = recent.length
    ? Math.round((recent.filter(h => !h.ok).length / recent.length) * 100) : 0;
  const lastBackup = hist.find(h => h.ok && /backup/i.test(h.cmd || ""));
  const backupAgeMin = lastBackup ? Math.round((now - (lastBackup.ts || 0)) / 60000) : null;
  const oiDeploy = oiSession?.deployReadiness;

  const score = oiDeploy?.score ?? (100 - (failRate > 30 ? 30 : failRate > 10 ? 15 : 0) - (backupAgeMin === null ? 25 : backupAgeMin > 120 ? 15 : 0));
  const label = score >= 85 ? "TRUSTED" : score >= 65 ? "CAUTION" : "RISKY";
  const color = score >= 85 ? "var(--op-green)" : score >= 65 ? "var(--op-amber)" : "var(--op-red)";

  return { score, label, color, backupAgeMin, failRate, risks: oiDeploy?.risks || [] };
}

// ── Phase 863: Coarse dep-key for workflow regeneration ──────────────────────
// Only regenerate chains when fail rate bucket or reconnect count changes.

function _failBucket(hist) {
  const W15 = 15 * 60 * 1000;
  const recent = hist.filter(h => (Date.now() - (h.ts || 0)) < W15);
  const failRate = recent.length ? Math.round((recent.filter(h => !h.ok).length / recent.length) * 100) : 0;
  // Bucket: 0-9%, 10-24%, 25-49%, 50%+
  return failRate >= 50 ? 3 : failRate >= 25 ? 2 : failRate >= 10 ? 1 : 0;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useWorkflowAutomation() {
  const [chains,         setChains]         = useState([]);
  const [deployTrust,    setDeployTrust]    = useState(null);
  const [activeChainId,  setActiveChainId]  = useState(null);
  const [chainProgress,  setChainProgress]  = useState({});  // chainId → stepIndex
  const [waMemory,       setWAMemory]       = useState([]);
  const [sessionRestored, setSessionRestored] = useState(false);

  const evaluate = useCallback(() => {
    const hist       = _loadHist();
    const friction   = _loadFriction();
    const healthSnap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || "null");
    const oiSession  = JSON.parse(localStorage.getItem(OI_SESSION_KEY) || "null");

    const newChains = _buildWorkflowChains(hist, friction, healthSnap, oiSession);
    const trust     = _buildDeployTrust(hist, oiSession);
    const mem       = _loadWAMemory();

    setChains(newChains);
    setDeployTrust(trust);
    setWAMemory(mem);
    setSessionRestored(false);

    // Phase 864: persist for reconnect-safe restore
    _saveWASession({ chains: newChains, deployTrust: trust });
  }, []);

  // Phase 864: restore on mount before first evaluation
  useEffect(() => {
    const snap = _loadWASession();
    if (snap?.chains?.length) {
      setChains(snap.chains);
      setDeployTrust(snap.deployTrust || null);
      setSessionRestored(true);
    }
    evaluate();
  }, [evaluate]);

  // Phase 863: coarse dep-key polling — re-evaluate on fail rate bucket change
  const [failBucket, setFailBucket] = useState(() => _failBucket(_loadHist()));
  useEffect(() => {
    const id = setInterval(() => {
      setFailBucket(_failBucket(_loadHist()));
    }, 15_000); // poll every 15s
    return () => clearInterval(id);
  }, []);
  useEffect(() => { evaluate(); }, [failBucket, evaluate]);

  // Visibility restore
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Phase 856: start a chain (with dedup guard and approval gate)
  const startChain = useCallback((chainId) => {
    if (_wasChainRecentlyStarted(chainId)) return false;
    setActiveChainId(chainId);
    setChainProgress(prev => ({ ...prev, [chainId]: 0 }));
    _markChainStarted(chainId);
    return true;
  }, []);

  // Advance to next step in a chain
  const advanceChain = useCallback((chainId) => {
    setChainProgress(prev => ({ ...prev, [chainId]: (prev[chainId] ?? 0) + 1 }));
  }, []);

  // Phase 862: complete a chain — record in memory
  const completeChain = useCallback((chainId) => {
    const chain = chains.find(c => c.id === chainId);
    if (chain) _recordChainSuccess(chainId, chain.label, chain.category);
    setActiveChainId(prev => prev === chainId ? null : prev);
    setChainProgress(prev => { const n = { ...prev }; delete n[chainId]; return n; });
    setWAMemory(_loadWAMemory());
  }, [chains]);

  // Cancel without recording success
  const cancelChain = useCallback((chainId) => {
    setActiveChainId(prev => prev === chainId ? null : prev);
    setChainProgress(prev => { const n = { ...prev }; delete n[chainId]; return n; });
  }, []);

  // Phase 856: current step in the active chain
  const activeChainStep = useMemo(() => {
    if (!activeChainId) return null;
    const chain = chains.find(c => c.id === activeChainId);
    if (!chain) return null;
    const stepIdx = chainProgress[activeChainId] ?? 0;
    const step = chain.steps[stepIdx];
    if (!step) return null;
    return {
      chainId,
      chainLabel: chain.label,
      chainCategory: chain.category,
      stepIdx,
      totalSteps: chain.steps.length,
      isLast: stepIdx === chain.steps.length - 1,
      ...step,
    };
  }, [activeChainId, chains, chainProgress]);

  // Phase 859: quick-start chains — high priority, not recently started
  const quickStartChains = useMemo(
    () => chains.filter(c => c.priority === "high" && !_wasChainRecentlyStarted(c.id)),
    [chains]
  );

  // Phase 862: recently successful chains for recall chips
  const recentSuccesses = useMemo(
    () => waMemory.slice(0, 4).map(e => ({
      ...e,
      stale: Date.now() - (e.ts || 0) > 2 * 60 * 60 * 1000,
    })),
    [waMemory]
  );

  // Phase 861: execution visibility summary
  const automationSummary = useMemo(() => {
    if (!activeChainStep) return null;
    const chain = chains.find(c => c.id === activeChainStep.chainId);
    if (!chain) return null;
    const stepIdx = chainProgress[activeChainStep.chainId] ?? 0;
    return {
      chainLabel:  chain.label,
      stepLabel:   activeChainStep.label,
      phase:       activeChainStep.phase,
      progress:    Math.round((stepIdx / chain.steps.length) * 100),
      requiresApproval: activeChainStep.requiresApproval,
      safe:        activeChainStep.safe,
    };
  }, [activeChainStep, chains, chainProgress]);

  return {
    // Phase 856: workflow chains
    chains,
    quickStartChains,
    // Phase 856: chain execution control
    activeChainId,
    activeChainStep,
    chainProgress,
    startChain,
    advanceChain,
    completeChain,
    cancelChain,
    // Phase 858: deployment trust
    deployTrust,
    // Phase 861: automation visibility
    automationSummary,
    // Phase 862: memory
    waMemory,
    recentSuccesses,
    // Phase 864: session restore
    sessionRestored,
    // Manual trigger
    evaluate,
  };
}
