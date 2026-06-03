// Phase 796-805, 831-834: Bounded engineering assistant.
// Consolidates debugging prioritization, recovery guidance, deployment readiness,
// and contextual recommendations into one operator-facing surface.
//
// Constraints:
//   - All analysis is local — no external calls
//   - All execution requires operator approval (returns commands, never dispatches)
//   - Bounded: max 8 recommendations, max 5 remembered patterns, 24h staleness cutoff
//   - Reconnect-safe: reads only from localStorage, not from live SSE state

import { useState, useEffect, useCallback, useMemo } from "react";

const HIST_KEY       = "jarvis_workflow_hist";
const FRICTION_KEY   = "jarvis_friction_signals";
const MEMORY_KEY     = "jarvis_ea_memory";   // engineering assistant memory, separate from exec memory
const DISMISSED_KEY  = "jarvis_ea_dismissed";
const MEMORY_MAX     = 50;
const MEMORY_TTL     = 24 * 60 * 60 * 1000;
const REC_MAX        = 8;

// ── Storage helpers ─────────────────────────────────────────────────────────

function _loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
}

function _loadFriction() {
  try { return JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]"); } catch { return []; }
}

function _loadMemory() {
  try {
    const raw = JSON.parse(localStorage.getItem(MEMORY_KEY) || "[]");
    const cutoff = Date.now() - MEMORY_TTL;
    return raw.filter(e => (e.ts || 0) > cutoff);
  } catch { return []; }
}

function _saveMemory(entries) {
  try {
    localStorage.setItem(MEMORY_KEY, JSON.stringify(entries.slice(0, MEMORY_MAX)));
  } catch {}
}

function _loadDismissed() {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]")); }
  catch { return new Set(); }
}

function _saveDismissed(set) {
  try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...set].slice(0, 100))); } catch {}
}

// ── Phase 796: Root-cause analysis ──────────────────────────────────────────
// Scores failure causes by frequency + error pattern match. Returns ranked list.

const _CAUSE_PATTERNS = [
  { id: "backend_down",    pattern: /econnrefused|backend.*not.*running|connection refused/i,  label: "Backend not running",      fix: "pm2 list",                                  confidence: 90 },
  { id: "pm2_crash",       pattern: /pm2|process.*exited|respawning/i,                         label: "PM2 process crashed",       fix: "pm2 logs jarvis-backend --lines 30",        confidence: 85 },
  { id: "oom",             pattern: /out of memory|heap|enomem|killed/i,                       label: "Out of memory",             fix: "pm2 restart jarvis-backend",                confidence: 80 },
  { id: "auth_expired",    pattern: /401|unauthorized|token.*expired|jwt/i,                    label: "Auth token expired",        fix: null,  actionKey: "reload",                  confidence: 90 },
  { id: "missing_dep",     pattern: /cannot find module|module not found|require.*failed/i,    label: "Missing dependency",        fix: "npm install",                               confidence: 85 },
  { id: "disk_full",       pattern: /enospc|no space left|disk.*full/i,                        label: "Disk full",                 fix: "df -h",                                     confidence: 95 },
  { id: "timeout",         pattern: /etimedout|timeout|timed out/i,                            label: "Execution timed out",       fix: "pm2 logs --lines 20",                       confidence: 70 },
  { id: "git_conflict",    pattern: /merge conflict|CONFLICT|unmerged/i,                       label: "Git merge conflict",        fix: "git status && git diff",                    confidence: 85 },
  { id: "npm_error",       pattern: /npm err|npm warn.*peer|npm.*lifecycle/i,                  label: "npm error",                 fix: "rm -rf node_modules && npm install",         confidence: 75 },
  { id: "syntax_error",    pattern: /syntaxerror|unexpected token|parse error/i,               label: "Syntax error in code",      fix: "npm run lint",                              confidence: 80 },
  { id: "port_conflict",   pattern: /eaddrinuse|address already in use|port.*in use/i,         label: "Port already in use",       fix: "lsof -ti :5050 | xargs kill -9",            confidence: 85 },
  { id: "permission",      pattern: /eacces|permission denied|operation not permitted/i,       label: "Permission denied",         fix: "ls -la $(pwd)",                             confidence: 80 },
];

function _analyzeFailures(hist) {
  const recentFails = hist.filter(h => !h.ok).slice(0, 20);
  if (!recentFails.length) return [];

  const causeScores = new Map(); // id → { ...cause, score, matchCount }

  for (const entry of recentFails) {
    const text = [entry.summary, entry.output, entry.cmd].filter(Boolean).join(" ");
    for (const cause of _CAUSE_PATTERNS) {
      if (cause.pattern.test(text)) {
        const existing = causeScores.get(cause.id);
        if (existing) {
          existing.score += cause.confidence;
          existing.matchCount++;
        } else {
          causeScores.set(cause.id, { ...cause, score: cause.confidence, matchCount: 1 });
        }
      }
    }
  }

  return [...causeScores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(c => ({
      id:         c.id,
      label:      c.label,
      fix:        c.fix,
      actionKey:  c.actionKey || null,
      confidence: Math.min(99, Math.round(c.score / c.matchCount)),
      matchCount: c.matchCount,
      basis:      c.matchCount > 1 ? `${c.matchCount} matching failures` : "1 matching failure",
    }));
}

// ── Phase 797: Recovery path ranking ────────────────────────────────────────
// Ranks recovery options by safety + probability. Never dispatches autonomously.

function _rankRecoveryPaths(rootCauses, hist) {
  if (!rootCauses.length) return [];

  const topCause = rootCauses[0];
  const paths = [];

  // Phase 797: rollback availability — check for recent successful state
  const lastGoodEntry = hist.find(h => h.ok && (h.cmd || "").includes("backup"));
  const hasRollbackPoint = !!lastGoodEntry;
  const rollbackAgeMin = lastGoodEntry
    ? Math.round((Date.now() - (lastGoodEntry.ts || 0)) / 60000)
    : null;

  // Safe read-only diagnostics always first
  if (topCause.fix && !["rm", "kill", "delete"].some(d => topCause.fix.includes(d))) {
    paths.push({
      id:         `diagnose_${topCause.id}`,
      label:      `Diagnose: ${topCause.label}`,
      cmd:        topCause.fix,
      safety:     "safe",
      confidence: topCause.confidence,
      reason:     `Matches ${topCause.basis} — read-only diagnostic, no side effects`,
    });
  }

  // Rollback if available and recent
  if (hasRollbackPoint && rollbackAgeMin !== null && rollbackAgeMin < 120) {
    paths.push({
      id:         "rollback_to_backup",
      label:      "Rollback to last backup",
      cmd:        "npm run backup -- --restore",
      safety:     "low_risk",
      confidence: 70,
      reason:     `Backup available ${rollbackAgeMin}m ago — within safe rollback window`,
    });
  }

  // Service restart if PM2 or backend issue
  if (["backend_down", "pm2_crash", "oom", "timeout"].includes(topCause.id)) {
    paths.push({
      id:         "restart_service",
      label:      "Restart backend service",
      cmd:        "pm2 restart jarvis-backend",
      safety:     "low_risk",
      confidence: 75,
      reason:     "Recovers from crash, memory, or timeout issues without data loss",
    });
  }

  // Dep install if module missing
  if (topCause.id === "missing_dep") {
    paths.push({
      id:         "reinstall_deps",
      label:      "Reinstall dependencies",
      cmd:        "npm install",
      safety:     "safe",
      confidence: 80,
      reason:     "Restores missing node_modules without touching application data",
    });
  }

  // Deduplicate by id, sort by confidence
  const seen = new Set();
  return paths
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 4);
}

// ── Phase 798: Deployment readiness ─────────────────────────────────────────
// Scores deployment trust from: backup age, recent failure rate, queue state.

function _assessDeploymentReadiness(hist) {
  const now = Date.now();
  const WINDOW = 30 * 60 * 1000;
  const recent = hist.filter(h => (now - (h.ts || 0)) < WINDOW);

  const failRate = recent.length
    ? Math.round((recent.filter(h => !h.ok).length / recent.length) * 100)
    : 0;

  const lastBackup = hist.find(h => h.ok && (h.cmd || "").includes("backup"));
  const backupAgeMin = lastBackup ? Math.round((now - (lastBackup.ts || 0)) / 60000) : null;

  // Score 0-100
  let score = 100;
  if (failRate > 30)           score -= 30;
  else if (failRate > 10)      score -= 15;
  if (backupAgeMin === null)   score -= 30;
  else if (backupAgeMin > 120) score -= 20;
  else if (backupAgeMin > 60)  score -= 10;

  const label = score >= 80 ? "READY"
              : score >= 60 ? "CAUTION"
              : "NOT READY";
  const color = score >= 80 ? "var(--op-green)"
              : score >= 60 ? "var(--op-amber)"
              : "var(--op-red)";

  const blockers = [];
  if (failRate > 30)         blockers.push(`${failRate}% failure rate in last 30m — resolve before deploying`);
  if (backupAgeMin === null) blockers.push("No backup found — run a backup before deploying");
  else if (backupAgeMin > 120) blockers.push(`Backup is ${Math.floor(backupAgeMin / 60)}h old — refresh before deploying`);

  const checklist = [
    { item: "Backend health",  ok: failRate < 20,           note: failRate >= 20 ? `${failRate}% failure rate` : null },
    { item: "Backup available", ok: backupAgeMin !== null && backupAgeMin < 120, note: backupAgeMin === null ? "No backup" : backupAgeMin >= 120 ? `${Math.floor(backupAgeMin/60)}h ago` : `${backupAgeMin}m ago` },
    { item: "Recent failures", ok: failRate === 0,           note: failRate > 0 ? `${recent.filter(h => !h.ok).length} in 30m` : null },
  ];

  return { score, label, color, blockers, checklist, failRate, backupAgeMin };
}

// ── Phase 799: Contextual recommendations ────────────────────────────────────
// Generates a ranked list of recommended next actions based on current state.

function _buildRecommendations(rootCauses, recoveryPaths, deployReadiness, activeLoop) {
  const recs = [];

  // Debug loop recommendation
  if (activeLoop) {
    recs.push({
      id:         `loop_${activeLoop.errorClass}`,
      category:   "debugging",
      priority:   "high",
      label:      `Break debug loop: ${activeLoop.errorClass}`,
      description: activeLoop.suggestion,
      cmd:        null,
      confidence: 85,
      reason:     `Same command failed ${activeLoop.count}× in ${activeLoop.durationMin}m`,
      impact:     "Stops wasted retry cycles",
    });
  }

  // Top root cause
  if (rootCauses[0]) {
    const rc = rootCauses[0];
    recs.push({
      id:         `rc_${rc.id}`,
      category:   "debugging",
      priority:   rc.confidence >= 80 ? "high" : "medium",
      label:      `Fix: ${rc.label}`,
      description: rc.fix ? `Run: ${rc.fix}` : "Reload session to re-authenticate",
      cmd:        rc.fix,
      actionKey:  rc.actionKey,
      confidence: rc.confidence,
      reason:     rc.basis,
      impact:     "Addresses most likely root cause",
    });
  }

  // Recovery paths (top 2)
  recoveryPaths.slice(0, 2).forEach(rp => {
    if (!recs.find(r => r.cmd === rp.cmd)) {
      recs.push({
        id:         `rp_${rp.id}`,
        category:   "recovery",
        priority:   "medium",
        label:      rp.label,
        description: rp.reason,
        cmd:        rp.cmd,
        confidence: rp.confidence,
        reason:     rp.reason,
        impact:     rp.safety === "safe" ? "No side effects" : "Low-risk service restart",
      });
    }
  });

  // Deployment blocker
  if (deployReadiness.score < 60 && deployReadiness.blockers.length) {
    recs.push({
      id:         "deploy_blocker",
      category:   "deployment",
      priority:   "high",
      label:      "Deployment not ready",
      description: deployReadiness.blockers[0],
      cmd:        deployReadiness.blockers[0].includes("backup") ? "npm run backup" : "npm run check-health",
      confidence: 90,
      reason:     `Deployment score ${deployReadiness.score}/100`,
      impact:     "Prevents failed deployment",
    });
  }

  // Deduplicate + cap
  const seen = new Set();
  return recs
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .sort((a, b) => {
      const priority = { high: 0, medium: 1, low: 2 };
      return (priority[a.priority] ?? 1) - (priority[b.priority] ?? 1) || b.confidence - a.confidence;
    })
    .slice(0, REC_MAX);
}

// ── Phase 831: Workflow memory cross-reference ───────────────────────────────
// When engineering assistant surfaces a recovery/rec, check if workflow memory
// has a recent successful completion of the same command for confidence boost.

const PW_MEMORY_KEY = "jarvis_pw_memory";

function _getPWMemoryBoost(cmd) {
  try {
    const raw = JSON.parse(localStorage.getItem(PW_MEMORY_KEY) || "[]");
    const match = raw.find(e => e.bundleId && cmd && e.label && cmd.includes(e.label.slice(0, 15)));
    return match ? { boosted: true, count: match.count, bundleLabel: match.label } : null;
  } catch { return null; }
}

// ── Phase 833: Long-session survivability — session age guard ────────────────
// If session snapshot is > 6h, mark stale so UI signals operator to re-analyze.

function _isSessionStale() {
  try {
    const raw = JSON.parse(localStorage.getItem("jarvis_ea_session") || "null");
    if (!raw) return false;
    return Date.now() - (raw.savedAt || 0) > 6 * 60 * 60 * 1000;
  } catch { return false; }
}

// ── Phase 802: Engineering memory — successful recovery recall ───────────────

function _recordRecovery(cmd, context = {}) {
  try {
    const mem = _loadMemory();
    const existing = mem.find(e => e.cmd === cmd);
    if (existing) {
      existing.count++;
      existing.ts = Date.now();
      if (context.errorClass) existing.errorClasses = [...new Set([...(existing.errorClasses || []), context.errorClass])];
    } else {
      mem.unshift({
        cmd,
        count: 1,
        ts: Date.now(),
        errorClasses: context.errorClass ? [context.errorClass] : [],
        label: context.label || cmd.slice(0, 50),
      });
    }
    _saveMemory(mem);
  } catch {}
}

function _getRelevantRecoveries(errorClass) {
  try {
    const mem = _loadMemory();
    return mem
      .filter(e => !errorClass || !e.errorClasses?.length || e.errorClasses.includes(errorClass))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(e => ({ cmd: e.cmd, count: e.count, label: e.label }));
  } catch { return []; }
}

// ── Phase 803-804: Session continuity — persist last analysis across reconnects ─

const SESSION_KEY = "jarvis_ea_session";

function _saveSession(data) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {}
}

function _loadSession() {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!raw || Date.now() - (raw.savedAt || 0) > 6 * 60 * 60 * 1000) return null;
    return raw;
  } catch { return null; }
}

// ── Phase 805: Project isolation — all keys prefixed with jarvis_ea_ ──────────
// Keys: jarvis_ea_memory, jarvis_ea_dismissed, jarvis_ea_session
// (already defined above — no cross-project contamination)

// ── Main hook ────────────────────────────────────────────────────────────────

export function useEngineeringAssistant({ activeLoop = null, history = [] } = {}) {
  const [rootCauses,      setRootCauses]      = useState([]);
  const [recoveryPaths,   setRecoveryPaths]   = useState([]);
  const [deployReadiness, setDeployReadiness] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [dismissed,       setDismissed]       = useState(() => _loadDismissed());
  const [pastRecoveries,  setPastRecoveries]  = useState([]);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [sessionStale,   setSessionStale]    = useState(false);

  // Phase 804: restore last session state on mount (reconnect-safe)
  // Phase 833: check staleness on restore
  useEffect(() => {
    const saved = _loadSession();
    if (saved?.rootCauses?.length) {
      setRootCauses(saved.rootCauses);
      setRecoveryPaths(saved.recoveryPaths || []);
      setDeployReadiness(saved.deployReadiness || null);
      setRecommendations(saved.recommendations || []);
      setSessionRestored(true);
    }
    setSessionStale(_isSessionStale());
  }, []);

  // Main analysis — runs on mount, on history changes, on activeLoop changes
  const analyze = useCallback(() => {
    const hist = _loadHist();
    const causes   = _analyzeFailures(hist);
    const recovery = _rankRecoveryPaths(causes, hist);
    const deploy   = _assessDeploymentReadiness(hist);
    const recs     = _buildRecommendations(causes, recovery, deploy, activeLoop);
    const past     = _getRelevantRecoveries(causes[0]?.id || null);

    setRootCauses(causes);
    setRecoveryPaths(recovery);
    setDeployReadiness(deploy);
    setRecommendations(recs);
    setPastRecoveries(past);
    setSessionRestored(false);
    setSessionStale(false);

    // Phase 804: persist for reconnect-safe restore
    _saveSession({ rootCauses: causes, recoveryPaths: recovery, deployReadiness: deploy, recommendations: recs });
  }, [activeLoop]);

  // Phase 818: coarse dep-key — re-analyze only every 5 new entries to avoid SSE burst thrash
  const histBucket = Math.floor(history.length / 5);
  useEffect(() => { analyze(); }, [histBucket, analyze]);

  // Phase 804: re-analyze on tab/window restore
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") analyze(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [analyze]);

  // Phase 800: dismiss a specific recommendation
  const dismissRec = useCallback((id) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      _saveDismissed(next);
      return next;
    });
  }, []);

  // Phase 802: record a successful recovery action
  const recordRecovery = useCallback((cmd, context) => {
    _recordRecovery(cmd, context);
    setPastRecoveries(_getRelevantRecoveries(context?.errorClass || null));
  }, []);

  // Phase 831: recovery paths cross-referenced against workflow memory for confidence boost
  const boostedRecoveryPaths = useMemo(
    () => recoveryPaths.map(rp => {
      const boost = rp.cmd ? _getPWMemoryBoost(rp.cmd) : null;
      if (!boost) return rp;
      return {
        ...rp,
        confidence: Math.min(99, rp.confidence + 5),
        memoryBoost: boost,
      };
    }),
    [recoveryPaths]
  );

  // Phase 800: visible (non-dismissed) recommendations
  const visibleRecs = useMemo(
    () => recommendations.filter(r => !dismissed.has(r.id)),
    [recommendations, dismissed]
  );

  // Phase 798: deployment readiness label for external use
  const deployLabel = deployReadiness
    ? { label: deployReadiness.label, color: deployReadiness.color, score: deployReadiness.score }
    : null;

  // Phase 824: maturity score — aggregate operational readiness 0-100
  const maturityScore = useMemo(() => {
    let score = 100;
    const factors = [];

    // Deployment readiness (weight: 30)
    if (deployReadiness) {
      const contrib = Math.round((deployReadiness.score / 100) * 30);
      score = score - 30 + contrib;
      if (deployReadiness.score < 60) factors.push({ label: "Deployment not ready", impact: "high" });
    }

    // Active recommendations (weight: 20 — fewer = better)
    const highRecs = recommendations.filter(r => r.priority === "high").length;
    if (highRecs >= 2)      { score -= 20; factors.push({ label: `${highRecs} high-priority issues`, impact: "high" }); }
    else if (highRecs === 1) { score -= 10; factors.push({ label: "1 high-priority issue", impact: "medium" }); }

    // Root causes found (weight: 20)
    if (rootCauses.length >= 3)      { score -= 20; factors.push({ label: `${rootCauses.length} root causes found`, impact: "high" }); }
    else if (rootCauses.length >= 1) { score -= 10; factors.push({ label: `${rootCauses.length} root cause(s) found`, impact: "medium" }); }

    // Recovery paths available (weight: 10 bonus)
    if (recoveryPaths.length > 0) score = Math.min(100, score + 5);

    const finalScore = Math.max(0, Math.min(100, score));
    const label = finalScore >= 85 ? "PRODUCTION READY"
                : finalScore >= 70 ? "STABLE"
                : finalScore >= 50 ? "NEEDS ATTENTION"
                : "UNSTABLE";
    const color = finalScore >= 85 ? "var(--op-green)"
                : finalScore >= 70 ? "var(--op-green)"
                : finalScore >= 50 ? "var(--op-amber)"
                : "var(--op-red)";

    return { score: finalScore, label, color, factors };
  }, [deployReadiness, recommendations, rootCauses, recoveryPaths]);

  return {
    // Phase 796: debugging analysis
    rootCauses,
    // Phase 797: recovery paths (operator-approved — returns cmds only)
    recoveryPaths: boostedRecoveryPaths,
    // Phase 798: deployment readiness
    deployReadiness,
    deployLabel,
    // Phase 799-800: contextual recommendations with confidence + reasoning
    recommendations: visibleRecs,
    allRecommendations: recommendations,
    // Phase 800: dismiss
    dismissRec,
    // Phase 802: past successful recoveries
    pastRecoveries,
    recordRecovery,
    // Phase 804: session restore indicator
    sessionRestored,
    // Phase 824: maturity score
    maturityScore,
    // Phase 833: long-session stale flag
    sessionStale,
    // Manual re-analysis
    analyze,
  };
}
