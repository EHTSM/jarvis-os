// Phase 904: Internal-beta session intelligence.
// Long-session workflow understanding, replay-heavy session analysis,
// deployment-behavior correlation, debugging-pattern analysis,
// contextual productivity insights.
//
// Bounded analysis depth: last 200 hist entries, last 50 friction events.
// Lightweight persistence: 6h session TTL, 1h insight TTL.
// No external calls. No autonomous execution.

import { useState, useEffect, useCallback, useMemo } from "react";

const BSI_KEY       = "jarvis_bsi_session";
const BSI_TTL       = 6  * 60 * 60 * 1000;
const INSIGHT_TTL   = 60 * 60 * 1000;
const HIST_DEPTH    = 200;
const FRICTION_DEPTH = 50;
const INSIGHT_MAX   = 8;

// ── Pattern analyzers ─────────────────────────────────────────────────────────

function _analyzeDeployBehavior(hist) {
  const deploys = hist.filter(h => /deploy|pm2 start|pm2 restart/i.test(h.cmd || ""));
  if (deploys.length < 2) return null;

  const successes = deploys.filter(h => h.ok).length;
  const rate      = Math.round((successes / deploys.length) * 100);

  // Check if deploys cluster after debugging sessions (good pattern)
  const debugCmd  = hist.filter(h => /pm2 logs|journalctl|check|diagnose/i.test(h.cmd || ""));
  const preDebug  = deploys.filter(d => {
    const dIdx = hist.indexOf(d);
    return hist.slice(Math.max(0, dIdx - 5), dIdx).some(h => debugCmd.includes(h));
  });

  return {
    id:       "deploy_behavior",
    type:     "correlation",
    title:    `Deployment pattern: ${rate}% success rate`,
    detail:   preDebug.length > 0
      ? `${preDebug.length} deploy(s) preceded by diagnostic checks — good practice`
      : "Deploys not consistently preceded by diagnostic checks",
    insight:  rate >= 80 ? "Deploy discipline is strong" : "Consider always running health check before deploy",
    positive: rate >= 80,
  };
}

function _analyzeDebuggingPatterns(hist) {
  const now    = Date.now();
  const recent = hist.filter(h => now - (h.ts || 0) < BSI_TTL);
  if (recent.length < 5) return null;

  // Detect diagnostic-first pattern (health check → investigate → fix)
  const healthFirst = recent.filter(h =>
    /pm2 status|curl.*health|df -h|free -m/i.test(h.cmd || "")
  );
  const totalCmds = recent.length;
  const diagRate  = Math.round((healthFirst.length / totalCmds) * 100);

  // Most frequent failure type
  const failCmds = recent.filter(h => !h.ok);
  const cmdGroups = {};
  failCmds.forEach(h => {
    const k = (h.cmd || "").split(" ").slice(0, 2).join(" ");
    cmdGroups[k] = (cmdGroups[k] || 0) + 1;
  });
  const topFail = Object.entries(cmdGroups).sort((a, b) => b[1] - a[1])[0];

  return {
    id:       "debug_patterns",
    type:     "pattern",
    title:    `Debugging: ${diagRate}% diagnostic-first rate`,
    detail:   topFail
      ? `Most common failure: "${topFail[0]}" (${topFail[1]}×)`
      : "No recurring failure pattern in this session",
    insight:  diagRate >= 30
      ? "Strong diagnostic discipline — health checks precede fixes"
      : "Consider starting with health check before debugging",
    positive: diagRate >= 30,
  };
}

function _analyzeReplayHeaviness(frictionEvents) {
  const replays = frictionEvents.filter(f =>
    f.type === "reconnect_event" || f.type === "replay_restored" || f.type === "replay_stale"
  );
  if (replays.length < 2) return null;

  const stale = replays.filter(f => f.type === "replay_stale").length;
  const ok    = replays.filter(f => f.type === "replay_restored").length;
  const total = replays.length;

  return {
    id:       "replay_heaviness",
    type:     "replay",
    title:    `Replay-heavy session: ${total} restore event(s)`,
    detail:   `${ok} successful, ${stale} stale restoration(s)`,
    insight:  stale > ok
      ? "Frequent stale replays — session gaps exceed 6h replay window"
      : "Replay restoration is working well across reconnects",
    positive: stale <= ok,
  };
}

function _analyzeWorkflowProductivity(hist) {
  const now    = Date.now();
  const recent = hist.filter(h => h.ok && now - (h.ts || 0) < BSI_TTL);
  if (recent.length < 3) return null;

  // Execution velocity: commands per hour in this session
  const oldest = recent[recent.length - 1];
  const sessionMs = now - (oldest?.ts || now);
  const sessionH  = Math.max(sessionMs / 3600000, 0.1);
  const velocity  = Math.round(recent.length / sessionH);

  // Success streak: longest consecutive success run
  let streak = 0, maxStreak = 0;
  hist.slice(0, 20).forEach(h => {
    if (h.ok) { streak++; maxStreak = Math.max(maxStreak, streak); }
    else       streak = 0;
  });

  return {
    id:       "workflow_productivity",
    type:     "productivity",
    title:    `Workflow velocity: ~${velocity} commands/h`,
    detail:   `Longest success streak: ${maxStreak} commands`,
    insight:  velocity >= 10
      ? "High execution velocity — productive session"
      : "Low velocity — consider using workflow bundles to speed up",
    positive: velocity >= 10,
  };
}

function _buildContextualInsights(hist, frictionEvents) {
  const insights = [
    _analyzeDeployBehavior(hist),
    _analyzeDebuggingPatterns(hist),
    _analyzeReplayHeaviness(frictionEvents),
    _analyzeWorkflowProductivity(hist),
  ].filter(Boolean).slice(0, INSIGHT_MAX);

  return insights;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadSession() {
  const raw = _load(BSI_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > BSI_TTL) return null;
  return raw;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useBetaSessionIntelligence() {
  const [insights,     setInsights]     = useState([]);
  const [sessionData,  setSessionData]  = useState(null);
  const [initialized,  setInitialized]  = useState(false);

  const analyze = useCallback(() => {
    const hist    = _load("jarvis_workflow_hist", []).slice(0, HIST_DEPTH);
    const frict   = _load("jarvis_friction_signals", []).slice(0, FRICTION_DEPTH);
    const now     = Date.now();

    const newInsights = _buildContextualInsights(hist, frict);

    // Session data: basic stats
    const recentHist = hist.filter(h => now - (h.ts || 0) < BSI_TTL);
    const failRate   = recentHist.length > 0
      ? Math.round((recentHist.filter(h => !h.ok).length / recentHist.length) * 100)
      : 0;
    const session = {
      commandCount: recentHist.length,
      failRate,
      reconnects:   frict.filter(f => f.type === "reconnect_event" && now - (f.ts || 0) < BSI_TTL).length,
      ts:           now,
    };

    setInsights(newInsights);
    setSessionData(session);
    _save(BSI_KEY, { insights: newInsights, session, ts: now });
  }, []);

  useEffect(() => {
    const cached = _loadSession();
    if (cached) {
      setInsights(cached.insights || []);
      setSessionData(cached.session || null);
    }
    analyze();
    setInitialized(true);
  }, [analyze]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") analyze(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [analyze]);

  // Top positive insight for operator bar
  const topInsight = useMemo(() =>
    insights.find(i => !i.positive) || insights[0] || null,
    [insights]
  );

  return {
    initialized,
    insights,
    topInsight,
    sessionData,
    analyze,
  };
}
