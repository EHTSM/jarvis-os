// Phase 841-850: Real operator intelligence.
// Consolidates priority ranking, smart debug sequencing, deployment readiness intelligence,
// recommendation engine, contextual insights, memory intelligence, and workflow acceleration.
//
// Constraints:
//   - All local — no external calls, no autonomous dispatch
//   - Bounded: PRIORITY_MAX=8, REC_MAX=6, INSIGHT_MAX=6, MEMORY_MAX=40, 24h TTL
//   - Reconnect-safe: all state from localStorage
//   - Multi-project isolated: keys prefixed jarvis_oi_
//   - Stale guard: 6h session, 4h workspace context, 1h insight replay

import { useState, useEffect, useCallback, useMemo } from "react";

const HIST_KEY       = "jarvis_workflow_hist";
const FRICTION_KEY   = "jarvis_friction_signals";
const EA_SESSION_KEY = "jarvis_ea_session";
const PW_MEMORY_KEY  = "jarvis_pw_memory";
const DEBUG_KEY      = "jarvis_debug_sessions";
const OI_MEMORY_KEY  = "jarvis_oi_memory";   // operator intelligence memory
const OI_SESSION_KEY = "jarvis_oi_session";  // reconnect-safe session snapshot

const PRIORITY_MAX   = 8;
const REC_MAX        = 6;
const INSIGHT_MAX    = 6;
const MEMORY_MAX     = 40;
const OI_TTL         = 24 * 60 * 60 * 1000;
const SESSION_TTL    = 6  * 60 * 60 * 1000;
const INSIGHT_STALE  = 60 * 60 * 1000;       // 1h — insights older than this are stale

// ── Storage helpers ──────────────────────────────────────────────────────────

function _loadHist() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); } catch { return []; }
}

function _loadFriction() {
  try { return JSON.parse(localStorage.getItem(FRICTION_KEY) || "[]"); } catch { return []; }
}

function _loadEASession() {
  try {
    const raw = JSON.parse(localStorage.getItem(EA_SESSION_KEY) || "null");
    if (!raw || Date.now() - (raw.savedAt || 0) > SESSION_TTL) return null;
    return raw;
  } catch { return null; }
}

function _loadPWMemory() {
  try {
    const raw = JSON.parse(localStorage.getItem(PW_MEMORY_KEY) || "[]");
    return raw.filter(e => Date.now() - (e.ts || 0) < OI_TTL);
  } catch { return []; }
}

function _loadDebugSessions() {
  try {
    const raw = JSON.parse(localStorage.getItem(DEBUG_KEY) || "[]");
    return raw.filter(s => Date.now() - (s.startedAt || 0) < SESSION_TTL);
  } catch { return []; }
}

function _loadOIMemory() {
  try {
    const raw = JSON.parse(localStorage.getItem(OI_MEMORY_KEY) || "[]");
    return raw.filter(e => Date.now() - (e.ts || 0) < OI_TTL);
  } catch { return []; }
}

function _saveOIMemory(entries) {
  try {
    localStorage.setItem(OI_MEMORY_KEY, JSON.stringify(entries.slice(0, MEMORY_MAX)));
  } catch {}
}

function _saveOISession(data) {
  try {
    localStorage.setItem(OI_SESSION_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {}
}

function _loadOISession() {
  try {
    const raw = JSON.parse(localStorage.getItem(OI_SESSION_KEY) || "null");
    if (!raw || Date.now() - (raw.savedAt || 0) > SESSION_TTL) return null;
    return raw;
  } catch { return null; }
}

// ── Phase 841: Operational priority ranking ──────────────────────────────────
// Scores and ranks current operational concerns by urgency + impact.
// Explainable: each item has a `reason` and `evidence` chain.

function _buildPriorityRanking(hist, friction, eaSession, debugSessions) {
  const now = Date.now();
  const W15 = 15 * 60 * 1000;
  const W30 = 30 * 60 * 1000;
  const W60 = 60 * 60 * 1000;

  const recent15 = hist.filter(h => (now - (h.ts || 0)) < W15);
  const recent30 = hist.filter(h => (now - (h.ts || 0)) < W30);
  const recentFriction = friction.filter(f => (now - (f.ts || 0)) < W15);

  const items = [];

  // Runtime failures
  const failRate15 = recent15.length
    ? Math.round((recent15.filter(h => !h.ok).length / recent15.length) * 100) : 0;
  if (failRate15 > 40) {
    items.push({
      id: "runtime_failures",
      category: "runtime",
      urgency: failRate15 > 70 ? "critical" : "high",
      score: 90 + Math.min(9, failRate15 - 40),
      label: "Runtime failures spiking",
      reason: `${failRate15}% failure rate in last 15 min`,
      evidence: [`${recent15.filter(h => !h.ok).length}/${recent15.length} recent executions failed`],
      suggestedAction: "pm2 logs jarvis-backend --lines 30 --noprefix",
      actionLabel: "Inspect backend logs",
    });
  }

  // Reconnect storms
  const reconnects = recentFriction.filter(f =>
    f.type === "reconnect_event" || f.type === "reconnect_during_input"
  ).length;
  if (reconnects >= 3) {
    items.push({
      id: "reconnect_storm",
      category: "connectivity",
      urgency: "high",
      score: 80,
      label: "Reconnect storm",
      reason: `${reconnects} reconnects in last 10 min`,
      evidence: [`SSE stream unstable — ${reconnects} interruptions`],
      suggestedAction: "pm2 restart jarvis-backend",
      actionLabel: "Restart backend",
    });
  }

  // Active debug loop
  const activeSession = debugSessions[0];
  if (activeSession) {
    const ageMin = Math.round((now - (activeSession.startedAt || now)) / 60000);
    items.push({
      id: "active_debug_loop",
      category: "debugging",
      urgency: ageMin > 30 ? "high" : "medium",
      score: 75,
      label: `Active debug session: ${activeSession.label}`,
      reason: `Debugging session started ${ageMin}m ago`,
      evidence: [activeSession.errorClass ? `Error class: ${activeSession.errorClass}` : "Ongoing investigation"],
      suggestedAction: null,
      actionLabel: "Resume session",
    });
  }

  // Deployment blocker
  const deployScore = eaSession?.deployReadiness?.score ?? 100;
  if (deployScore < 60) {
    items.push({
      id: "deploy_blocker",
      category: "deployment",
      urgency: deployScore < 40 ? "critical" : "high",
      score: 70 + (60 - deployScore),
      label: "Deployment blocked",
      reason: `Deploy readiness score: ${deployScore}/100`,
      evidence: eaSession?.deployReadiness?.blockers?.slice(0, 2) || ["Deployment not ready"],
      suggestedAction: "npm run backup",
      actionLabel: "Create backup",
    });
  }

  // Dependency instability
  const depFails = recent30
    .filter(h => !h.ok && /cannot find module|module not found|npm err/i.test(
      (h.summary || h.output || "")
    )).length;
  if (depFails >= 2) {
    items.push({
      id: "dep_instability",
      category: "dependencies",
      urgency: "medium",
      score: 65,
      label: "Dependency instability",
      reason: `${depFails} dependency failures in last 30 min`,
      evidence: [`npm/module errors repeating`, "node_modules may be incomplete"],
      suggestedAction: "npm install",
      actionLabel: "Reinstall deps",
    });
  }

  // Replay corruption risk — stale debug session older than 1h but < 6h
  const staleSession = debugSessions.find(s => {
    const age = now - (s.startedAt || 0);
    return age > W60 && age < SESSION_TTL;
  });
  if (staleSession) {
    items.push({
      id: "replay_corruption_risk",
      category: "replay",
      urgency: "low",
      score: 40,
      label: "Stale replay session",
      reason: `Debug session "${staleSession.label}" is ${Math.round((now - staleSession.startedAt) / 60000)}m old`,
      evidence: ["Replaying this session may surface outdated context"],
      suggestedAction: null,
      actionLabel: "Review session",
    });
  }

  // Recovery effectiveness — high past-recoveries count is positive signal
  const rootCauses = eaSession?.rootCauses || [];
  if (rootCauses.length >= 3) {
    items.push({
      id: "multiple_root_causes",
      category: "debugging",
      urgency: "medium",
      score: 60,
      label: `${rootCauses.length} concurrent root causes`,
      reason: "Multiple simultaneous error patterns detected",
      evidence: rootCauses.slice(0, 3).map(rc => rc.label),
      suggestedAction: rootCauses[0]?.fix || null,
      actionLabel: `Fix: ${rootCauses[0]?.label || "top cause"}`,
    });
  }

  const seen = new Set();
  return items
    .filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
    .sort((a, b) => b.score - a.score)
    .slice(0, PRIORITY_MAX);
}

// ── Phase 842: Smart debugging sequencing ────────────────────────────────────
// Generates a dependency-aware troubleshooting order.
// Validation-first: read-only diagnostics before service mutations.
// Dedup-aware: skips recently-executed paths.

const _DEDUP_KEY = "jarvis_recovery_dedup";
const _DEDUP_TTL = 5 * 60 * 1000;

function _wasRecentlyExecuted(cmd) {
  try {
    const d = JSON.parse(localStorage.getItem(_DEDUP_KEY) || "{}");
    const now = Date.now();
    return Object.entries(d).some(([key, ts]) => key.includes(cmd.slice(0, 20)) && now - ts < _DEDUP_TTL);
  } catch { return false; }
}

function _buildDebugSequence(hist, priorityItems, eaSession) {
  const steps = [];
  const usedCmds = new Set();

  const addStep = (step) => {
    if (usedCmds.has(step.cmd)) return;
    usedCmds.add(step.cmd);
    steps.push(step);
  };

  // Step 0: runtime health check always first (validation-first principle)
  addStep({
    id: "health_check",
    phase: "validate",
    label: "Verify runtime health",
    cmd: "pm2 list",
    safe: true,
    reason: "Baseline — confirm process state before any intervention",
    dependsOn: [],
  });

  // Step 1: address top priority item
  const top = priorityItems[0];
  if (top?.suggestedAction) {
    addStep({
      id: `priority_top`,
      phase: "diagnose",
      label: top.actionLabel,
      cmd: top.suggestedAction,
      safe: !["restart", "kill", "rm", "delete"].some(w => top.suggestedAction.includes(w)),
      reason: top.reason,
      dependsOn: ["health_check"],
      recentlyExecuted: _wasRecentlyExecuted(top.suggestedAction),
    });
  }

  // Step 2: root-cause specific diagnostic from EA session
  const topCause = eaSession?.rootCauses?.[0];
  if (topCause?.fix && topCause.fix !== top?.suggestedAction) {
    addStep({
      id: `rc_diagnose`,
      phase: "diagnose",
      label: `Diagnose: ${topCause.label}`,
      cmd: topCause.fix,
      safe: !["rm", "kill", "delete"].some(w => topCause.fix.includes(w)),
      reason: `Root cause: ${topCause.basis}`,
      dependsOn: ["health_check"],
      recentlyExecuted: _wasRecentlyExecuted(topCause.fix),
    });
  }

  // Step 3: log inspection if backend issues present
  const hasBackendIssue = priorityItems.some(i => i.category === "runtime" || i.category === "connectivity");
  if (hasBackendIssue) {
    addStep({
      id: "inspect_logs",
      phase: "diagnose",
      label: "Inspect backend logs",
      cmd: "pm2 logs jarvis-backend --lines 30 --noprefix",
      safe: true,
      reason: "Backend or connectivity issue detected — logs show root cause",
      dependsOn: ["health_check"],
      recentlyExecuted: _wasRecentlyExecuted("pm2 logs"),
    });
  }

  // Step 4: recovery action (service restart) only after diagnostics
  const needsRestart = priorityItems.some(i =>
    i.urgency === "critical" || (i.category === "runtime" && i.urgency === "high")
  );
  if (needsRestart) {
    addStep({
      id: "restart_service",
      phase: "recover",
      label: "Restart backend service",
      cmd: "pm2 restart jarvis-backend",
      safe: false,
      requiresApproval: true,
      reason: "Critical runtime issue — restart clears transient crash/memory state",
      dependsOn: ["health_check", "inspect_logs"],
      recentlyExecuted: _wasRecentlyExecuted("pm2 restart"),
    });
  }

  // Step 5: post-recovery verification
  if (steps.some(s => s.phase === "recover")) {
    addStep({
      id: "verify_recovery",
      phase: "verify",
      label: "Verify recovery",
      cmd: "pm2 list",
      safe: true,
      reason: "Confirm service is stable after recovery action",
      dependsOn: ["restart_service"],
    });
  }

  // Filter out recently-executed steps to reduce repeat friction (Phase 842)
  return steps
    .filter(s => !s.recentlyExecuted)
    .slice(0, 8);
}

// ── Phase 843: Deployment readiness intelligence ──────────────────────────────
// Produces a richer deployment readiness report than Phase 798/816.
// Adds: dependency-risk score, rollback survivability, runtime-health correlation.

function _buildDeployReadiness(hist, eaSession, friction) {
  const now = Date.now();
  const W30 = 30 * 60 * 1000;
  const recent = hist.filter(h => (now - (h.ts || 0)) < W30);

  // Base score from EA session if available
  let score = eaSession?.deployReadiness?.score ?? 100;

  const risks = [];
  const signals = [];

  // Dependency risk — recent dep failures
  const depFails = recent.filter(h =>
    !h.ok && /cannot find module|module not found|npm err/i.test(h.summary || h.output || "")
  ).length;
  if (depFails >= 2) {
    score -= 20;
    risks.push({ label: "Dependency instability", severity: "high", detail: `${depFails} dep failures in 30m` });
  } else if (depFails === 1) {
    score -= 8;
    risks.push({ label: "Dependency noise", severity: "medium", detail: "1 dep failure recently" });
  }

  // Reconnect storm — runtime may be unstable
  const reconnects = friction.filter(f =>
    (f.type === "reconnect_event") && (now - (f.ts || 0)) < 10 * 60 * 1000
  ).length;
  if (reconnects >= 3) {
    score -= 15;
    risks.push({ label: "Reconnect storm", severity: "high", detail: `${reconnects} reconnects in last 10m` });
  }

  // Rollback survivability
  const lastBackup = hist.find(h => h.ok && /backup/i.test(h.cmd || ""));
  const backupAgeMin = lastBackup ? Math.round((now - (lastBackup.ts || 0)) / 60000) : null;

  let rollbackSurvivability = 0;
  let rollbackLabel = "NONE";
  if (backupAgeMin !== null && backupAgeMin <= 15) {
    rollbackSurvivability = 98; rollbackLabel = "EXCELLENT";
    signals.push(`Backup ${backupAgeMin}m ago — excellent rollback window`);
  } else if (backupAgeMin !== null && backupAgeMin <= 60) {
    rollbackSurvivability = 85; rollbackLabel = "GOOD";
    signals.push(`Backup ${backupAgeMin}m ago — good rollback window`);
  } else if (backupAgeMin !== null && backupAgeMin <= 120) {
    rollbackSurvivability = 65; rollbackLabel = "FAIR";
    signals.push(`Backup ${Math.floor(backupAgeMin / 60)}h ago — acceptable rollback`);
  } else if (backupAgeMin !== null) {
    rollbackSurvivability = 30; rollbackLabel = "STALE";
    score -= 10;
    risks.push({ label: "Stale backup", severity: "medium", detail: `Backup is ${Math.floor(backupAgeMin / 60)}h old` });
  } else {
    rollbackSurvivability = 0; rollbackLabel = "NONE";
    score -= 25;
    risks.push({ label: "No backup", severity: "critical", detail: "No backup on record — rollback impossible" });
  }

  const finalScore = Math.max(0, Math.min(100, score));
  const label = finalScore >= 85 ? "READY" : finalScore >= 65 ? "CAUTION" : finalScore >= 40 ? "RISKY" : "BLOCKED";
  const color = finalScore >= 85 ? "var(--op-green)" : finalScore >= 65 ? "var(--op-amber)" : "var(--op-red)";

  return {
    score: finalScore,
    label,
    color,
    risks: risks.slice(0, 4),
    signals: signals.slice(0, 3),
    rollback: { survivability: rollbackSurvivability, label: rollbackLabel, backupAgeMin },
    isBlocked: finalScore < 40,
    isCaution: finalScore >= 40 && finalScore < 85,
  };
}

// ── Phase 844: Recommendation engine ─────────────────────────────────────────
// Generates bounded, explainable operator recommendations from all intelligence signals.
// Confidence-aware, replay-safe, deduped.

function _buildIntelligentRecs(priorityItems, debugSeq, deployReadiness, pwMemory) {
  const recs = [];

  // Priority-driven recs
  priorityItems.slice(0, 3).forEach((item, i) => {
    if (!item.suggestedAction) return;
    const memMatch = pwMemory.find(m => item.suggestedAction.includes(m.bundleId?.slice(0, 10) || "NOMATCH"));
    recs.push({
      id:         `prio_${item.id}`,
      category:   item.category,
      priority:   item.urgency === "critical" ? "high" : item.urgency,
      label:      item.actionLabel,
      cmd:        item.suggestedAction,
      confidence: 80 + (PRIORITY_MAX - i) * 2,
      reason:     item.reason,
      evidence:   item.evidence,
      impact:     item.urgency === "critical" ? "Resolves critical issue" : "Addresses priority concern",
      memoryBoosted: !!memMatch,
    });
  });

  // Debug sequence first step as rec (if not already covered)
  const firstDebugStep = debugSeq.find(s => s.phase === "diagnose" && !recs.find(r => r.cmd === s.cmd));
  if (firstDebugStep) {
    recs.push({
      id:         `dbg_seq_${firstDebugStep.id}`,
      category:   "debugging",
      priority:   "medium",
      label:      firstDebugStep.label,
      cmd:        firstDebugStep.cmd,
      confidence: 75,
      reason:     firstDebugStep.reason,
      evidence:   firstDebugStep.dependsOn?.length ? [`After: ${firstDebugStep.dependsOn.join(", ")}`] : [],
      impact:     "Next step in diagnostic sequence",
    });
  }

  // Deployment rec if blocked
  if (deployReadiness?.isBlocked && !recs.find(r => r.category === "deployment")) {
    recs.push({
      id:         "deploy_blocked_rec",
      category:   "deployment",
      priority:   "high",
      label:      "Unblock deployment",
      cmd:        deployReadiness.risks[0]?.label.includes("backup") ? "npm run backup" : "npm run check-health",
      confidence: 85,
      reason:     `Deploy score: ${deployReadiness.score}/100 — ${deployReadiness.label}`,
      evidence:   deployReadiness.risks.slice(0, 2).map(r => r.detail),
      impact:     "Required before any deployment",
    });
  }

  const seen = new Set();
  return recs
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority] ?? 1) - (p[b.priority] ?? 1) || b.confidence - a.confidence;
    })
    .slice(0, REC_MAX);
}

// ── Phase 845: Contextual engineering insights ────────────────────────────────
// Lightweight pattern analysis: dep-failure correlation, deploy-history trends,
// replay pattern recognition, workflow survivability.

function _buildContextualInsights(hist, priorityItems, deployReadiness) {
  const now = Date.now();
  const W60 = 60 * 60 * 1000;
  const W24H = 24 * 60 * 60 * 1000;
  const insights = [];

  // Deploy history trend
  const deployEntries = hist
    .filter(h => /deploy|pm2 restart|pm2 start/i.test(h.cmd || ""))
    .slice(0, 20);
  if (deployEntries.length >= 3) {
    const successRate = Math.round(
      (deployEntries.filter(h => h.ok).length / deployEntries.length) * 100
    );
    insights.push({
      id:      "deploy_trend",
      label:   successRate >= 80 ? "Deployment history: healthy" : `Deployment history: ${successRate}% success rate`,
      detail:  `Last ${deployEntries.length} deployments: ${deployEntries.filter(h => h.ok).length} succeeded`,
      type:    successRate >= 80 ? "positive" : "warning",
      stale:   false,
    });
  }

  // Dependency failure correlation — npm fails cluster near builds?
  const depFails = hist.filter(h =>
    !h.ok && /cannot find module|npm err/i.test(h.summary || h.output || "") &&
    (now - (h.ts || 0)) < W24H
  );
  const buildFails = hist.filter(h =>
    !h.ok && /build|compile/i.test(h.cmd || "") &&
    (now - (h.ts || 0)) < W24H
  );
  if (depFails.length >= 2 && buildFails.length >= 1) {
    insights.push({
      id:      "dep_build_correlation",
      label:   "Dependency failures correlate with build failures",
      detail:  `${depFails.length} dep errors, ${buildFails.length} build failures in 24h — likely related`,
      type:    "warning",
      stale:   false,
    });
  }

  // Workflow survivability — how often does the last-run workflow succeed?
  const last10 = hist.slice(0, 10);
  if (last10.length >= 5) {
    const rate = Math.round((last10.filter(h => h.ok).length / last10.length) * 100);
    if (rate >= 80) {
      insights.push({
        id:     "workflow_health",
        label:  `Recent workflow health: ${rate}%`,
        detail: `${last10.filter(h => h.ok).length}/${last10.length} recent executions succeeded`,
        type:   "positive",
        stale:  false,
      });
    }
  }

  // Phase 845: rollback survivability insight
  if (deployReadiness?.rollback?.survivability < 50 && deployReadiness?.rollback?.survivability > 0) {
    insights.push({
      id:     "rollback_risk",
      label:  `Rollback risk: ${deployReadiness.rollback.label}`,
      detail: deployReadiness.rollback.backupAgeMin !== null
        ? `Backup is ${Math.floor(deployReadiness.rollback.backupAgeMin / 60)}h old`
        : "No backup available",
      type:   "warning",
      stale:  false,
    });
  }

  // Priority pressure insight
  const criticalCount = priorityItems.filter(i => i.urgency === "critical").length;
  if (criticalCount > 0) {
    insights.push({
      id:     "critical_pressure",
      label:  `${criticalCount} critical issue${criticalCount > 1 ? "s" : ""} active`,
      detail: priorityItems.filter(i => i.urgency === "critical").map(i => i.label).join("; "),
      type:   "critical",
      stale:  false,
    });
  }

  return insights
    .filter(i => !i.stale)
    .slice(0, INSIGHT_MAX);
}

// ── Phase 847: Intelligence memory ───────────────────────────────────────────
// Records which recommendations were acted on, for recall and confidence boosting.

function _recordIntelligenceAction(recId, cmd, category) {
  try {
    const mem = _loadOIMemory();
    const existing = mem.find(e => e.recId === recId);
    if (existing) {
      existing.count++;
      existing.ts = Date.now();
    } else {
      mem.unshift({ recId, cmd, category, count: 1, ts: Date.now() });
    }
    _saveOIMemory(mem);
  } catch {}
}

function _getIntelligenceMemory(category) {
  try {
    const mem = _loadOIMemory();
    return mem
      .filter(e => !category || e.category === category)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  } catch { return []; }
}

// ── Phase 848: Workflow acceleration — priority bucket dep-key ────────────────
// Coarse dep-key: recalculate only when top-priority urgency changes or
// every 5 history entries — prevents SSE burst thrash.

function _urgencyBucket(priorityItems) {
  const top = priorityItems[0];
  if (!top) return 0;
  const map = { critical: 3, high: 2, medium: 1, low: 0 };
  return map[top.urgency] ?? 0;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useOperatorIntelligence() {
  const [priorityItems,    setPriorityItems]    = useState([]);
  const [debugSequence,    setDebugSequence]    = useState([]);
  const [deployReadiness,  setDeployReadiness]  = useState(null);
  const [intelligentRecs,  setIntelligentRecs]  = useState([]);
  const [contextInsights,  setContextInsights]  = useState([]);
  const [dismissed,        setDismissed]        = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("jarvis_oi_dismissed") || "[]")); }
    catch { return new Set(); }
  });
  const [sessionRestored,  setSessionRestored]  = useState(false);
  const [oimemory,         setOIMemory]         = useState([]);

  const evaluate = useCallback(() => {
    const hist         = _loadHist();
    const friction     = _loadFriction();
    const eaSession    = _loadEASession();
    const debugSessions = _loadDebugSessions();
    const pwMemory     = _loadPWMemory();

    const priority   = _buildPriorityRanking(hist, friction, eaSession, debugSessions);
    const dbgSeq     = _buildDebugSequence(hist, priority, eaSession);
    const deploy     = _buildDeployReadiness(hist, eaSession, friction);
    const recs       = _buildIntelligentRecs(priority, dbgSeq, deploy, pwMemory);
    const insights   = _buildContextualInsights(hist, priority, deploy);
    const mem        = _getIntelligenceMemory(null);

    setPriorityItems(priority);
    setDebugSequence(dbgSeq);
    setDeployReadiness(deploy);
    setIntelligentRecs(recs);
    setContextInsights(insights);
    setOIMemory(mem);
    setSessionRestored(false);

    // Phase 849: persist for reconnect-safe restore
    _saveOISession({ priorityItems: priority, deployReadiness: deploy, intelligentRecs: recs, contextInsights: insights });
  }, []);

  // Phase 849: restore snapshot on mount before first live evaluation
  useEffect(() => {
    const snap = _loadOISession();
    if (snap?.priorityItems?.length) {
      setPriorityItems(snap.priorityItems);
      setDeployReadiness(snap.deployReadiness || null);
      setIntelligentRecs(snap.intelligentRecs || []);
      setContextInsights(snap.contextInsights || []);
      setSessionRestored(true);
    }
    evaluate();
  }, [evaluate]);

  // Phase 848: coarse dep-key — re-evaluate every 5 history entries or urgency level change
  // Read history length from localStorage once per render cycle to derive dep-key
  const [histLen, setHistLen] = useState(() => {
    try { return JSON.parse(localStorage.getItem(HIST_KEY) || "[]").length; } catch { return 0; }
  });

  useEffect(() => {
    const id = setInterval(() => {
      try {
        const len = JSON.parse(localStorage.getItem(HIST_KEY) || "[]").length;
        setHistLen(len);
      } catch {}
    }, 10_000); // check every 10s — coarse enough to avoid thrash
    return () => clearInterval(id);
  }, []);

  const histBucket = Math.floor(histLen / 5);
  const urgencyBucket = useMemo(() => _urgencyBucket(priorityItems), [priorityItems]);

  useEffect(() => { evaluate(); }, [histBucket, urgencyBucket, evaluate]);

  // Visibility restore
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Phase 846: dismiss a recommendation (low-noise UX)
  const dismissRec = useCallback((id) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem("jarvis_oi_dismissed", JSON.stringify([...next].slice(0, 100))); } catch {}
      return next;
    });
  }, []);

  // Phase 847: record an acted-on recommendation
  const recordAction = useCallback((recId, cmd, category) => {
    _recordIntelligenceAction(recId, cmd, category);
    setOIMemory(_getIntelligenceMemory(null));
  }, []);

  // Phase 846: visible recs (non-dismissed, low-noise)
  const visibleRecs = useMemo(
    () => intelligentRecs.filter(r => !dismissed.has(r.id)),
    [intelligentRecs, dismissed]
  );

  // Phase 841: top urgency summary for compact display
  const urgencySummary = useMemo(() => {
    const critical = priorityItems.filter(i => i.urgency === "critical").length;
    const high     = priorityItems.filter(i => i.urgency === "high").length;
    const total    = priorityItems.length;
    if (!total) return { label: "All clear", color: "var(--op-green)", level: "clear" };
    if (critical) return { label: `${critical} critical`, color: "var(--op-red)", level: "critical" };
    if (high)     return { label: `${high} high-priority`, color: "var(--op-amber)", level: "high" };
    return { label: `${total} items`, color: "var(--op-text2)", level: "medium" };
  }, [priorityItems]);

  // Phase 843: deployment trust summary for compact display
  const deployTrust = useMemo(() => {
    if (!deployReadiness) return null;
    return {
      score:    deployReadiness.score,
      label:    deployReadiness.label,
      color:    deployReadiness.color,
      rollback: deployReadiness.rollback,
      blocked:  deployReadiness.isBlocked,
    };
  }, [deployReadiness]);

  // Phase 842: first safe debug step (for single-click quick action)
  const quickDebugStep = useMemo(
    () => debugSequence.find(s => s.safe && s.phase === "diagnose") || debugSequence[0] || null,
    [debugSequence]
  );

  return {
    // Phase 841: priority ranking
    priorityItems,
    urgencySummary,
    // Phase 842: debug sequencing
    debugSequence,
    quickDebugStep,
    // Phase 843: deployment readiness
    deployReadiness,
    deployTrust,
    // Phase 844: recommendation engine
    intelligentRecs: visibleRecs,
    allIntelligentRecs: intelligentRecs,
    dismissRec,
    // Phase 845: contextual insights
    contextInsights,
    // Phase 847: intelligence memory
    oiMemory: oimemory,
    recordAction,
    // Phase 849: session restore
    sessionRestored,
    // Manual trigger
    evaluate,
  };
}
