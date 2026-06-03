// Phase 907: Real-world failure intelligence.
// Tracks dependency instability patterns, replay corruption triggers,
// deployment interruption causes, debugging dead-end sequences,
// recovery-failure correlation, contextual execution failures.
// Generates operational risk summaries, hardening recommendations, survivability insights.
//
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: max 40 risk records, 24h analysis window.

import { useState, useEffect, useCallback, useMemo } from "react";

const FI_KEY      = "jarvis_failure_intel";
const FI_TTL      = 24 * 60 * 60 * 1000;
const FI_MAX      = 40;
const REC_MAX     = 8;
const WINDOW_1H   = 60 * 60 * 1000;
const WINDOW_24H  = 24 * 60 * 60 * 1000;

// ── Risk pattern detectors ────────────────────────────────────────────────────

function _detectDepInstability(hist) {
  const now    = Date.now();
  const depFails = hist.filter(h =>
    !h.ok && now - (h.ts || 0) < WINDOW_24H &&
    /cannot find module|module not found|npm err|enoent.*node_modules/i.test(h.summary || h.output || "")
  );
  if (depFails.length === 0) return null;

  const instability = depFails.length >= 3 ? "high" : "medium";
  return {
    id:       "dep_instability",
    type:     "dependency",
    severity: instability,
    title:    `Dependency instability: ${depFails.length} missing-module failure(s)`,
    detail:   "node_modules may be corrupted or out of sync with package.json",
    rec:      "Run: npm install && pm2 restart all",
    recCmd:   "npm install && pm2 restart all",
    ts:       now,
  };
}

function _detectReplayCorruptionTriggers(hist, friction) {
  const now = Date.now();
  // Replays that fail shortly after a crash or storage write error
  const storageErrors = friction.filter(f =>
    (f.type === "startup_corruption" || f.type === "unknown_key_detected") &&
    now - (f.ts || 0) < WINDOW_24H
  );
  const replayFails = friction.filter(f =>
    f.type === "replay_stale" || f.type === "replay_failed"
  ).length;

  if (storageErrors.length > 0 && replayFails > 0) {
    return {
      id:       "replay_corruption_trigger",
      type:     "replay",
      severity: "high",
      title:    `Replay corruption risk: ${storageErrors.length} storage anomalies + ${replayFails} replay failure(s)`,
      detail:   "Storage corruption events are triggering replay failures",
      rec:      "Clear stale localStorage keys and reload to reset replay context",
      recCmd:   null,
      ts:       now,
    };
  }
  return null;
}

function _detectDeployInterruptionCauses(hist) {
  const now = Date.now();
  const interrupted = hist.filter(h =>
    !h.ok && now - (h.ts || 0) < WINDOW_24H &&
    /deploy|pm2 start|pm2 restart/i.test(h.cmd || "")
  );
  if (interrupted.length < 2) return null;

  // Classify: OOM vs network vs timeout vs unknown
  const oom     = interrupted.filter(h => /heap|out of memory|killed|enomem/i.test(h.summary || "")).length;
  const network = interrupted.filter(h => /econnreset|econnrefused|etimedout|network/i.test(h.summary || "")).length;
  const cause   = oom > 0 ? "OOM" : network > 0 ? "network" : "unknown";

  return {
    id:       "deploy_interruption_cause",
    type:     "deployment",
    severity: interrupted.length >= 3 ? "high" : "medium",
    title:    `${interrupted.length} deploy interruption(s) — likely cause: ${cause}`,
    detail:   cause === "OOM"     ? "Heap exhaustion during deploy — reduce concurrent services" :
              cause === "network" ? "Network failures during deploy — check connectivity" :
              "Cause unclear — check pm2 logs for details",
    rec:      "Run: pm2 logs --lines 50 to identify root cause",
    recCmd:   "pm2 logs --lines 50",
    ts:       now,
  };
}

function _detectDebugDeadEnds(hist) {
  const now    = Date.now();
  const recent = hist.filter(h => !h.ok && now - (h.ts || 0) < WINDOW_1H);
  if (recent.length < 5) return null;

  // Consecutive failures with escalating retry count
  const cmdGroups = {};
  recent.forEach(h => {
    const k = (h.cmd || "").slice(0, 50);
    cmdGroups[k] = (cmdGroups[k] || 0) + 1;
  });
  const deadEnd = Object.entries(cmdGroups).find(([, c]) => c >= 4);
  if (!deadEnd) return null;

  return {
    id:       "debug_dead_end",
    type:     "debugging",
    severity: "high",
    title:    `Debug dead-end: "${deadEnd[0].slice(0, 40)}" failed ${deadEnd[1]}×`,
    detail:   "Repeating the same failing command is unproductive — change approach",
    rec:      "Stop retrying. Inspect logs first: pm2 logs --lines 100",
    recCmd:   "pm2 logs --lines 100",
    ts:       now,
  };
}

function _detectRecoveryFailureCorrelation(hist, friction) {
  const now      = Date.now();
  const recovFails = hist.filter(h =>
    !h.ok && now - (h.ts || 0) < WINDOW_1H &&
    /pm2 restart|npm install|git reset/i.test(h.cmd || "")
  );
  const crashes = friction.filter(f =>
    f.type === "crash" && now - (f.ts || 0) < WINDOW_1H
  ).length;

  if (recovFails.length < 2 || crashes === 0) return null;
  return {
    id:       "recovery_failure_correlation",
    type:     "correlation",
    severity: "high",
    title:    `Recovery failure + crash correlation (${crashes} crash, ${recovFails.length} failed recovery)`,
    detail:   "Crash events are preventing recovery commands from succeeding",
    rec:      "Check pm2 status and pm2 logs before retrying recovery",
    recCmd:   "pm2 status",
    ts:       now,
  };
}

// ── Survivability insight builder ─────────────────────────────────────────────

function _buildSurvivabilityInsights(risks) {
  const high   = risks.filter(r => r.severity === "high").length;
  const medium = risks.filter(r => r.severity === "medium").length;

  let score = 100;
  score -= high   * 20;
  score -= medium * 10;
  score = Math.max(0, score);

  return {
    score,
    label: score >= 80 ? "RESILIENT" : score >= 55 ? "FRAGILE" : "CRITICAL",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    highRisks:   high,
    mediumRisks: medium,
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadCache() {
  const raw = _load(FI_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > FI_TTL) return null;
  return raw;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useFailureIntelligence() {
  const [risks,             setRisks]             = useState([]);
  const [survivability,     setSurvivability]     = useState(null);
  const [initialized,       setInitialized]       = useState(false);

  const analyze = useCallback(() => {
    const hist  = _load("jarvis_workflow_hist", []);
    const frict = _load("jarvis_friction_signals", []);

    const detected = [
      _detectDepInstability(hist),
      _detectReplayCorruptionTriggers(hist, frict),
      _detectDeployInterruptionCauses(hist),
      _detectDebugDeadEnds(hist),
      _detectRecoveryFailureCorrelation(hist, frict),
    ].filter(Boolean).slice(0, FI_MAX);

    const surv = _buildSurvivabilityInsights(detected);
    setRisks(detected);
    setSurvivability(surv);
    _save(FI_KEY, { risks: detected, survivability: surv, ts: Date.now() });
  }, []);

  useEffect(() => {
    const cached = _loadCache();
    if (cached) {
      setRisks(cached.risks || []);
      setSurvivability(cached.survivability || null);
    }
    analyze();
    setInitialized(true);
  }, [analyze]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") analyze(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [analyze]);

  const recommendations = useMemo(() =>
    risks.filter(r => r.rec).slice(0, REC_MAX).map(r => ({
      id: r.id, title: r.rec, cmd: r.recCmd, severity: r.severity, type: r.type,
    })),
    [risks]
  );

  const topRisk = useMemo(() =>
    risks.find(r => r.severity === "high") || risks[0] || null,
    [risks]
  );

  return {
    initialized,
    risks,
    recommendations,
    survivability,
    topRisk,
    analyze,
  };
}
