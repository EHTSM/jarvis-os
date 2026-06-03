// Phase 1111-1120: Production packaging hardening + update delivery infrastructure +
// crash reporting + public telemetry discipline + public onboarding experience +
// support operations + docs/guides + release channel maturity + stress validation +
// performance + memory hardening.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only. Privacy-safe: no raw content, counts/booleans/durations only.
// Bounded: 20 release records, 30 crash reports, 20 telemetry events, 10 support exports, 10 channel snapshots.

import { useState, useEffect, useCallback, useMemo } from "react";

const REL_KEY     = "jarvis_release_state";
const CRASH_KEY   = "jarvis_crash_reports";
const TELEM_KEY   = "jarvis_public_telemetry";
const SUPP_KEY    = "jarvis_support_exports";
const CHAN_KEY    = "jarvis_release_channels";
const OB_KEY      = "jarvis_onboarding_state";

const REL_MAX     = 20;
const CRASH_MAX   = 30;
const TELEM_MAX   = 20;
const SUPP_MAX    = 10;
const CHAN_MAX    = 10;

const REL_TTL     = 30 * 24 * 60 * 60 * 1000;
const CRASH_TTL   = 7  * 24 * 60 * 60 * 1000;
const TELEM_TTL   = 30 * 24 * 60 * 60 * 1000;
const SUPP_TTL    = 30 * 24 * 60 * 60 * 1000;
const CHAN_TTL    = 7  * 24 * 60 * 60 * 1000;

// ── Phase 1111-1112: Packaging + update delivery ──────────────────────────────

const RELEASE_CHANNELS = new Set(["stable", "beta", "experimental"]);

const CHANNEL_CONSTRAINTS = {
  stable:       { maxRollbackDays: 30, requiresApproval: true,  replayGuardMins: 5  },
  beta:         { maxRollbackDays: 7,  requiresApproval: true,  replayGuardMins: 2  },
  experimental: { maxRollbackDays: 1,  requiresApproval: false, replayGuardMins: 0  },
};

function _buildReleaseRecord({ version, channel = "stable", metadata = {} }) {
  if (!RELEASE_CHANNELS.has(channel)) return null;
  return {
    id:           `rel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    version,
    channel,
    status:       "pending",   // pending → staged → delivered → complete | rolled_back
    approved:     CHANNEL_CONSTRAINTS[channel].requiresApproval ? false : true,
    replaySafe:   false,       // set true after replay continuity check
    ts:           Date.now(),
    updatedAt:    Date.now(),
    metadata,
  };
}

function _buildChannelSnapshot(channel) {
  const constraints = CHANNEL_CONSTRAINTS[channel] || CHANNEL_CONSTRAINTS.stable;
  return {
    channel,
    ts:               Date.now(),
    healthy:          true,
    lastDeliveredAt:  null,
    rollbackAvailable: false,
    constraints,
  };
}

// ── Phase 1113: Crash reporting — privacy-safe ────────────────────────────────

const CRASH_TYPES = new Set([
  "runtime_crash", "replay_restore_failure", "deployment_interrupt",
  "workflow_state_corruption", "plugin_isolation_failure", "trust_degradation",
]);

function _buildCrashReport({ type, durationMs = null, recoverable = true }) {
  if (!CRASH_TYPES.has(type)) return null;
  return {
    id:          `crsh_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    recoverable,
    durationMs,  // how long recovery took (not raw content)
    ts:          Date.now(),
    exported:    false,
  };
}

// ── Phase 1114: Public telemetry — minimal + bounded ─────────────────────────

const TELEM_EVENT_TYPES = new Set([
  "session_started", "session_ended", "workflow_completed", "workflow_failed",
  "deployment_succeeded", "deployment_failed", "onboarding_step_completed",
  "first_session", "plugin_activated", "replay_restored",
]);

// Privacy contract: only counts, booleans, durations — never raw content/commands
function _buildTelemEvent(type, meta = {}) {
  if (!TELEM_EVENT_TYPES.has(type)) return null;
  const safe = {};
  if (typeof meta.durationMs  === "number") safe.durationMs  = meta.durationMs;
  if (typeof meta.stepIndex   === "number") safe.stepIndex   = meta.stepIndex;
  if (typeof meta.success     === "boolean") safe.success    = meta.success;
  if (typeof meta.channelName === "string") safe.channelName = meta.channelName;
  return { id: `tel_${Date.now()}`, type, ts: Date.now(), ...safe };
}

// ── Phase 1115: Onboarding experience ────────────────────────────────────────

const ONBOARDING_STEPS = [
  { id: "workspace_setup",     label: "Set up workspace",        category: "setup"   },
  { id: "first_workflow",      label: "Run first workflow",       category: "workflow" },
  { id: "debugging_basics",    label: "Try debugging tools",      category: "debug"   },
  { id: "replay_intro",        label: "Explore replay system",    category: "replay"  },
  { id: "deployment_basics",   label: "Configure deployment",     category: "deploy"  },
  { id: "plugin_ecosystem",    label: "Browse plugin ecosystem",  category: "ecosystem" },
  { id: "survivability_check", label: "Review survivability",     category: "ops"     },
];

function _loadOnboardingState() {
  try {
    return JSON.parse(localStorage.getItem(OB_KEY) || "null") ?? {
      completedSteps: [],
      startedAt:      Date.now(),
      dismissed:      false,
    };
  } catch { return { completedSteps: [], startedAt: Date.now(), dismissed: false }; }
}

function _onboardingProgress(state) {
  const completed = state.completedSteps?.length ?? 0;
  const total     = ONBOARDING_STEPS.length;
  const pct       = Math.round((completed / total) * 100);
  return { completed, total, pct, done: completed >= total };
}

// ── Phase 1116: Support operations — privacy-safe exports ─────────────────────

function _buildSupportExport({
  crashCount = 0, workflowSuccessRate = null,
  survivabilityScore = null, sessionDurationMin = null,
} = {}) {
  return {
    id:                  `supp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    ts:                  Date.now(),
    crashCount,          // count only
    workflowSuccessRate, // 0-100 percentage
    survivabilityScore,  // 0-100 score
    sessionDurationMin,  // minutes — no session content
    jarvisKeyCount: (() => {
      try {
        let c = 0;
        for (let i = 0; i < localStorage.length; i++) {
          if (localStorage.key(i)?.startsWith("jarvis_")) c++;
        }
        return c;
      } catch { return null; }
    })(),
  };
}

// ── Phase 1118: Release channel maturity ─────────────────────────────────────

function _validateReleaseContinuity(release, replayAgeMs = null) {
  const constraints = CHANNEL_CONSTRAINTS[release.channel] || CHANNEL_CONSTRAINTS.stable;
  const issues = [];

  if (constraints.requiresApproval && !release.approved) {
    issues.push({ id: "unapproved", msg: "Release requires operator approval" });
  }
  if (constraints.replayGuardMins > 0 && replayAgeMs !== null) {
    const replayAgeMins = replayAgeMs / 60000;
    if (replayAgeMins > constraints.replayGuardMins) {
      issues.push({ id: "stale_replay", msg: `Replay ${Math.round(replayAgeMins)}m old — exceeds ${constraints.replayGuardMins}m guard` });
    }
  }

  return { valid: issues.length === 0, issues };
}

// ── Phase 1119-1120: Stress validation + perf hardening ──────────────────────

// Bounded module-level cache — perf hydration
const _releaseCache = new Map();
const REL_CACHE_TTL = 60 * 1000; // 1 min

function _cachedRelease(key, compute) {
  const cached = _releaseCache.get(key);
  if (cached && Date.now() - cached.ts < REL_CACHE_TTL) return cached.val;
  const val = compute();
  if (_releaseCache.size > 10) {
    const oldest = [..._releaseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _releaseCache.delete(oldest[0]);
  }
  _releaseCache.set(key, { val, ts: Date.now() });
  return val;
}

// Public readiness scoring (Phase 1124)
function _computePublicReadiness({
  crashCount        = 0,
  recentCrashCount  = 0,
  onboardingPct     = 0,
  channelHealthy    = true,
  survivabilityScore = 100,
} = {}) {
  let score = 100;
  if (recentCrashCount > 3)     score -= 25;
  else if (recentCrashCount > 0) score -= 10;
  if (onboardingPct < 50)        score -= 10;
  if (!channelHealthy)           score -= 20;
  if (survivabilityScore < 70)   score -= 20;
  score = Math.max(0, score);

  return {
    score,
    label: score >= 80 ? "RELEASE READY" : score >= 60 ? "NEEDS WORK" : "NOT READY",
    color: score >= 80 ? "var(--op-green)" : score >= 60 ? "var(--op-amber)" : "var(--op-red)",
    crashCount,
    onboardingPct,
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

export function usePublicRelease({
  survivabilityScore = 100,
  replayAgeMs        = null,
} = {}) {
  const [releases,       setReleases]       = useState([]);
  const [crashReports,   setCrashReports]   = useState([]);
  const [telemEvents,    setTelemEvents]    = useState([]);
  const [supportExports, setSupportExports] = useState([]);
  const [channelSnaps,   setChannelSnaps]   = useState({});
  const [onboarding,     setOnboarding]     = useState(null);
  const [initialized,    setInitialized]    = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();
    // TTL-filter all bounded arrays
    setReleases(prev => {
      const next = prev.filter(r => now - (r.ts || 0) < REL_TTL).slice(0, REL_MAX);
      _save(REL_KEY, next);
      return next;
    });
    setCrashReports(prev => {
      const next = prev.filter(r => now - (r.ts || 0) < CRASH_TTL).slice(0, CRASH_MAX);
      _save(CRASH_KEY, next);
      return next;
    });
    setTelemEvents(prev => {
      const next = prev.filter(e => now - (e.ts || 0) < TELEM_TTL).slice(0, TELEM_MAX);
      _save(TELEM_KEY, next);
      return next;
    });
    setSupportExports(prev => {
      const next = prev.filter(e => now - (e.ts || 0) < SUPP_TTL).slice(0, SUPP_MAX);
      _save(SUPP_KEY, next);
      return next;
    });
  }, []);

  useEffect(() => {
    const now = Date.now();
    setReleases(      _load(REL_KEY,   []).filter(r => now - (r.ts || 0) < REL_TTL));
    setCrashReports(  _load(CRASH_KEY, []).filter(r => now - (r.ts || 0) < CRASH_TTL));
    setTelemEvents(   _load(TELEM_KEY, []).filter(e => now - (e.ts || 0) < TELEM_TTL));
    setSupportExports(_load(SUPP_KEY,  []).filter(e => now - (e.ts || 0) < SUPP_TTL));
    setChannelSnaps(  _load(CHAN_KEY,  {}));
    setOnboarding(_loadOnboardingState());
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Release actions (Phase 1111-1112) ─────────────────────────────────────

  const stageRelease = useCallback(({ version, channel, metadata } = {}) => {
    const rel = _buildReleaseRecord({ version, channel, metadata });
    if (!rel) return null;
    setReleases(prev => {
      const next = [rel, ...prev].slice(0, REL_MAX);
      _save(REL_KEY, next);
      return next;
    });
    // Initialize channel snapshot
    setChannelSnaps(prev => {
      const next = { ...prev, [channel]: _buildChannelSnapshot(channel) };
      _save(CHAN_KEY, next);
      return next;
    });
    return rel.id;
  }, []);

  const approveRelease = useCallback((relId) => {
    setReleases(prev => {
      const next = prev.map(r => r.id === relId ? { ...r, approved: true, updatedAt: Date.now() } : r);
      _save(REL_KEY, next);
      return next;
    });
  }, []);

  const advanceRelease = useCallback((relId) => {
    const STAGES = ["pending", "staged", "delivered", "complete"];
    setReleases(prev => {
      const next = prev.map(r => {
        if (r.id !== relId) return r;
        const validation = _validateReleaseContinuity(r, replayAgeMs);
        if (!validation.valid) return { ...r, status: "blocked", blockReasons: validation.issues, updatedAt: Date.now() };
        const idx = STAGES.indexOf(r.status);
        const nextStatus = idx >= 0 && idx < STAGES.length - 1 ? STAGES[idx + 1] : r.status;
        return { ...r, status: nextStatus, replaySafe: validation.valid, updatedAt: Date.now() };
      });
      _save(REL_KEY, next);
      return next;
    });
  }, [replayAgeMs]);

  const rollbackRelease = useCallback((relId) => {
    setReleases(prev => {
      const next = prev.map(r =>
        r.id === relId ? { ...r, status: "rolled_back", updatedAt: Date.now() } : r
      );
      _save(REL_KEY, next);
      return next;
    });
  }, []);

  // ── Crash reporting (Phase 1113) ──────────────────────────────────────────

  const reportCrash = useCallback(({ type, durationMs, recoverable } = {}) => {
    const report = _buildCrashReport({ type, durationMs, recoverable });
    if (!report) return null;
    setCrashReports(prev => {
      const next = [report, ...prev].slice(0, CRASH_MAX);
      _save(CRASH_KEY, next);
      return next;
    });
    return report.id;
  }, []);

  // ── Telemetry (Phase 1114) ────────────────────────────────────────────────

  const recordTelemetry = useCallback((type, meta = {}) => {
    const evt = _buildTelemEvent(type, meta);
    if (!evt) return;
    setTelemEvents(prev => {
      const next = [evt, ...prev].filter(e => Date.now() - (e.ts || 0) < TELEM_TTL).slice(0, TELEM_MAX);
      _save(TELEM_KEY, next);
      return next;
    });
  }, []);

  // ── Onboarding (Phase 1115) ───────────────────────────────────────────────

  const completeOnboardingStep = useCallback((stepId) => {
    setOnboarding(prev => {
      if (!prev) return prev;
      const completed = prev.completedSteps.includes(stepId)
        ? prev.completedSteps
        : [...prev.completedSteps, stepId];
      const next = { ...prev, completedSteps: completed };
      _save(OB_KEY, next);
      return next;
    });
  }, []);

  const dismissOnboarding = useCallback(() => {
    setOnboarding(prev => {
      const next = { ...prev, dismissed: true };
      _save(OB_KEY, next);
      return next;
    });
  }, []);

  // ── Support export (Phase 1116) ───────────────────────────────────────────

  const generateSupportExport = useCallback(() => {
    const recentCrashes = crashReports.filter(r => Date.now() - r.ts < 24 * 60 * 60 * 1000);
    const exp = _buildSupportExport({
      crashCount:          crashReports.length,
      workflowSuccessRate: null, // populated by caller if available
      survivabilityScore,
      sessionDurationMin:  null, // populated by caller if available
    });
    setSupportExports(prev => {
      const next = [exp, ...prev].slice(0, SUPP_MAX);
      _save(SUPP_KEY, next);
      return next;
    });
    return exp;
  }, [crashReports, survivabilityScore]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const onboardingProgress = useMemo(() =>
    onboarding ? _onboardingProgress(onboarding) : { completed: 0, total: ONBOARDING_STEPS.length, pct: 0, done: false },
    [onboarding]
  );

  const nextOnboardingStep = useMemo(() => {
    if (!onboarding || onboarding.dismissed) return null;
    return ONBOARDING_STEPS.find(s => !onboarding.completedSteps.includes(s.id)) || null;
  }, [onboarding]);

  const recentCrashCount = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return crashReports.filter(r => r.ts > cutoff).length;
  }, [crashReports]);

  const activeRelease = useMemo(() =>
    releases.find(r => r.status !== "complete" && r.status !== "rolled_back") || null,
    [releases]
  );

  const publicReadiness = useMemo(() =>
    _cachedRelease(`pr_${recentCrashCount}_${onboardingProgress.pct}_${Math.floor(survivabilityScore / 10)}`,
      () => _computePublicReadiness({
        crashCount:        crashReports.length,
        recentCrashCount,
        onboardingPct:     onboardingProgress.pct,
        channelHealthy:    Object.values(channelSnaps).every(c => c.healthy),
        survivabilityScore,
      })
    ),
    [recentCrashCount, onboardingProgress.pct, survivabilityScore, crashReports.length, channelSnaps]
  );

  // Calm release bar — shown when not ready or active release in flight
  const releaseBar = useMemo(() => {
    if (publicReadiness.score >= 80 && !activeRelease) return null;
    return {
      label:      activeRelease ? `Release ${activeRelease.version} (${activeRelease.status})` : null,
      readiness:  publicReadiness.score,
      color:      publicReadiness.color,
      crashes:    recentCrashCount > 0 ? `${recentCrashCount} crash${recentCrashCount > 1 ? "es" : ""} (24h)` : null,
      onboarding: onboardingProgress.pct < 100 ? `Onboarding ${onboardingProgress.pct}%` : null,
    };
  }, [publicReadiness, activeRelease, recentCrashCount, onboardingProgress.pct]);

  return {
    initialized,
    releases,
    crashReports,
    telemEvents,
    supportExports,
    channelSnaps,
    onboarding,
    // Derived
    onboardingProgress,
    nextOnboardingStep,
    recentCrashCount,
    activeRelease,
    publicReadiness,
    releaseBar,
    // Actions
    stageRelease,
    approveRelease,
    advanceRelease,
    rollbackRelease,
    reportCrash,
    recordTelemetry,
    completeOnboardingStep,
    dismissOnboarding,
    generateSupportExport,
    evaluate,
  };
}
