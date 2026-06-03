// Phase 1333-1335: Execution performance audit + operational safety audit +
// public production + launch readiness complete.
//
// Consolidates three phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 20 readiness snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const LAUNCHPERF_KEY   = "jarvis_launch_perf_audit";
const LAUNCHSAFE_KEY   = "jarvis_launch_safety_audit";
const LAUNCHREADY_KEY  = "jarvis_launch_readiness";

const LAUNCHREADY_MAX  = 20;

const LAUNCHPERF_TTL   = 24 * 60 * 60 * 1000;
const LAUNCHSAFE_TTL   = 24 * 60 * 60 * 1000;
const LAUNCHREADY_TTL  = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1333: Execution performance audit ───────────────────────────────────

function _runLaunchPerfAudit() {
  const now = Date.now();
  const findings = [];

  // No replay-state corruption: onboarding stages must be valid
  try {
    const sessions = JSON.parse(localStorage.getItem("jarvis_launch_onboarding") || "[]");
    const corrupted = sessions.filter(s => !s.stage || !s.orgId);
    if (corrupted.length > 0) findings.push({ id: "onboard_corruption", severity: "high", msg: `${corrupted.length} corrupted onboarding sessions` });
  } catch {}

  // No workflow duplication: deploy IDs must be unique
  try {
    const deploys = JSON.parse(localStorage.getItem("jarvis_public_deployments") || "[]");
    const ids   = deploys.map(d => d.id);
    const dupes = ids.length - new Set(ids).size;
    if (dupes > 0) findings.push({ id: "deploy_duplication", severity: "high", msg: `${dupes} duplicate deploy IDs` });
  } catch {}

  // No indexing leaks: crash events should not contain PII fields
  try {
    const crashes = JSON.parse(localStorage.getItem("jarvis_crash_survivability") || "[]");
    const leaked  = crashes.filter(c => c.userInput || c.rawContent || c.commandOutput);
    if (leaked.length > 0) findings.push({ id: "crash_pii_leak", severity: "high", msg: `${leaked.length} crash events with PII` });
  } catch {}

  // No unbounded memory growth: channel array bounded
  try {
    const channels = JSON.parse(localStorage.getItem("jarvis_release_channels") || "[]");
    if (channels.length > 10) findings.push({ id: "channel_overflow", severity: "medium", msg: `${channels.length} channel records` });
  } catch {}

  // Telemetry burst check
  try {
    const events = JSON.parse(localStorage.getItem("jarvis_launch_telemetry") || "[]");
    const burst  = events.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
    if (burst.length > 8) findings.push({ id: "telemetry_burst", severity: "medium", msg: `${burst.length} telemetry events in 10s` });
  } catch {}

  // Support ticket bloat
  try {
    const tickets = JSON.parse(localStorage.getItem("jarvis_launch_support") || "[]");
    const active  = tickets.filter(t => !["closed"].includes(t.stage));
    if (active.length > 5) findings.push({ id: "support_overflow", severity: "medium", msg: `${active.length} active support tickets` });
  } catch {}

  return {
    ts:        now,
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1334: Operational safety audit ─────────────────────────────────────

const LAUNCH_SAFETY_RULES = [
  {
    id:    "no_hidden_launch_escalation",
    label: "No hidden launch escalation",
    check: () => ["jarvis_launch_auto_escalate", "jarvis_auto_launch", "jarvis_launch_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_unsafe_deployment_continuation",
    label: "No unsafe deployment continuation",
    check: () => {
      try {
        const deploys = JSON.parse(localStorage.getItem("jarvis_public_deployments") || "[]");
        return deploys
          .filter(d => ["deploying", "verifying", "complete"].includes(d.stage))
          .every(d => d.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const crashes = JSON.parse(localStorage.getItem("jarvis_crash_survivability") || "[]");
        const stale   = crashes.filter(c =>
          c.type === "replay_failure"
          && c.recovered === false
          && Date.now() - (c.ts || 0) > 4 * 60 * 60 * 1000
        );
        return stale.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_rollout_loops",
    label: "No recursive rollout loops",
    check: () => {
      try {
        const launches = JSON.parse(localStorage.getItem("jarvis_launch_coordination") || "[]");
        const recent   = launches.filter(l => Date.now() - (l.updatedAt || l.ts || 0) < 10 * 1000);
        return recent.length < 3;
      } catch { return true; }
    },
  },
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_auto_exec", "jarvis_autonomous", "jarvis_launch_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos = JSON.parse(localStorage.getItem("jarvis_channel_isolation") || "[]");
        const recent = isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000);
        return recent.length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "channels_approval_gated",
    label: "Release channels are approval-gated",
    check: () => {
      try {
        const channels = JSON.parse(localStorage.getItem("jarvis_release_channels") || "[]");
        return channels
          .filter(c => ["deploying", "live"].includes(c.stage))
          .every(c => c.approvedAt);
      } catch { return true; }
    },
  },
  {
    id:    "telemetry_privacy_safe",
    label: "Launch telemetry is privacy-safe",
    check: () => {
      try {
        const events = JSON.parse(localStorage.getItem("jarvis_launch_telemetry") || "[]");
        return events.every(e => !e.rawContent && !e.commandOutput && !e.userInput);
      } catch { return true; }
    },
  },
];

function _runLaunchSafetyAudit() {
  const results = LAUNCH_SAFETY_RULES.map(rule => ({
    id:     rule.id,
    label:  rule.label,
    passed: rule.check(),
    ts:     Date.now(),
  }));
  const passCount = results.filter(r => r.passed).length;
  return {
    results,
    passCount,
    total:     results.length,
    allPassed: passCount === results.length,
    score:     Math.round((passCount / results.length) * 100),
    ts:        Date.now(),
  };
}

// ── Phase 1335: Public production + launch readiness complete ─────────────────

function _computeLaunchReadiness({
  perfScore       = 100,
  safetyScore     = 100,
  launchScore     = 100,
  deployScore     = 100,
  crashScore      = 100,
  channelScore    = 100,
  onboardingScore = 100,
  isoViolations   = 0,
} = {}) {
  const composite = Math.round(
    safetyScore     * 0.25 +
    launchScore     * 0.20 +
    deployScore     * 0.20 +
    crashScore      * 0.15 +
    channelScore    * 0.10 +
    onboardingScore * 0.05 +
    perfScore       * 0.05
  )
  + (safetyScore === 100 ? 5 : 0)
  - (isoViolations > 0 ? 15 : 0);

  const score = Math.max(0, Math.min(100, composite));

  const blockers = [];
  if (safetyScore < 100)    blockers.push("Safety audit failures");
  if (deployScore < 60)     blockers.push("Public deployment health degraded");
  if (crashScore < 60)      blockers.push("Crash survivability critical");
  if (channelScore < 60)    blockers.push("Release channel maturity degraded");
  if (isoViolations > 0)    blockers.push("Channel isolation violations");
  if (onboardingScore < 60) blockers.push("Onboarding continuity degraded");

  return {
    score,
    label:   score >= 80 ? "LAUNCH READY" : score >= 60 ? "DEVELOPING" : "NOT READY",
    color:   score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    blockers,
    ts:      Date.now(),
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePublicLaunchReadiness({
  launchScore     = 100,
  deployScore     = 100,
  crashScore      = 100,
  channelScore    = 100,
  onboardingScore = 100,
  isoViolations   = 0,
} = {}) {
  const [perfAudit,   setPerfAudit]   = useState(null);
  const [safetyAudit, setSafetyAudit] = useState(null);
  const [readiness,   setReadiness]   = useState([]);
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();

    const perf = _runLaunchPerfAudit();
    setPerfAudit(perf);
    _save(LAUNCHPERF_KEY, perf);

    const safety = _runLaunchSafetyAudit();
    setSafetyAudit(safety);
    _save(LAUNCHSAFE_KEY, safety);

    const snap = _computeLaunchReadiness({
      perfScore: perf.score, safetyScore: safety.score,
      launchScore, deployScore, crashScore, channelScore, onboardingScore, isoViolations,
    });
    setReadiness(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < LAUNCHREADY_TTL)
        .slice(0, LAUNCHREADY_MAX);
      _save(LAUNCHREADY_KEY, next);
      return next;
    });
  }, [launchScore, deployScore, crashScore, channelScore, onboardingScore, isoViolations]);

  useEffect(() => {
    const now = Date.now();
    const cachedPerf = _load(LAUNCHPERF_KEY, null);
    if (cachedPerf?.ts && now - cachedPerf.ts < LAUNCHPERF_TTL) setPerfAudit(cachedPerf);
    const cachedSafe = _load(LAUNCHSAFE_KEY, null);
    if (cachedSafe?.ts && now - cachedSafe.ts < LAUNCHSAFE_TTL) setSafetyAudit(cachedSafe);
    setReadiness(_load(LAUNCHREADY_KEY, []).filter(s => now - (s.ts || 0) < LAUNCHREADY_TTL));
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const latestReadiness = useMemo(() => readiness[0] || null, [readiness]);

  const launchReadinessPill = useMemo(() => {
    if (!latestReadiness || latestReadiness.score >= 80) return null;
    return {
      label:   "LAUNCH",
      score:   latestReadiness.score,
      color:   latestReadiness.color,
      blocker: latestReadiness.blockers[0] || null,
    };
  }, [latestReadiness]);

  const readinessTrend = useMemo(() => {
    if (readiness.length < 2) return null;
    const delta = readiness[0].score - readiness[1].score;
    return delta > 0 ? "improving" : delta < 0 ? "degrading" : "stable";
  }, [readiness]);

  return {
    initialized,
    perfAudit,
    safetyAudit,
    latestReadiness,
    launchReadinessPill,
    readinessTrend,
    evaluate,
  };
}
