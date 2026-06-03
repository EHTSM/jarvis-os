// Phase 916-918: Release channel foundation + feature flag infrastructure + staged update rollouts.
// Stable/beta/experimental channels, gradual feature rollout, rollback-ready releases,
// replay-safe update routing, percentage-based rollout simulation.
//
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: max 20 flag overrides, max 10 rollout records, 30-day retention.

import { useState, useEffect, useCallback, useMemo } from "react";

const CHANNEL_KEY  = "jarvis_release_channel";
const FLAGS_KEY    = "jarvis_feature_flags";
const ROLLOUT_KEY  = "jarvis_rollout_state";
const ROLLOUT_TTL  = 30 * 24 * 60 * 60 * 1000;
const FLAG_MAX     = 20;
const ROLLOUT_MAX  = 10;

// ── Channel definitions ───────────────────────────────────────────────────────

const CHANNELS = {
  stable:       { label: "Stable",       color: "var(--op-green)",  risk: "low",    description: "Production-ready features only" },
  beta:         { label: "Beta",         color: "var(--op-blue)",   risk: "medium", description: "Tested features, may have rough edges" },
  experimental: { label: "Experimental", color: "var(--op-amber)",  risk: "high",   description: "Cutting-edge features, not yet validated" },
};

// ── Built-in feature flags ────────────────────────────────────────────────────
// Each flag: { id, label, default, channels, replayImpact }
// replayImpact: "none" | "low" | "high" — replay-safe classification

const BUILTIN_FLAGS = [
  { id: "onboarding_v2",          label: "Onboarding v2",           default: false, channels: ["beta", "experimental"], replayImpact: "none" },
  { id: "friction_detector",      label: "Workflow friction alerts", default: true,  channels: ["beta", "experimental", "stable"], replayImpact: "none" },
  { id: "session_intelligence",   label: "Session intelligence",    default: true,  channels: ["beta", "experimental", "stable"], replayImpact: "none" },
  { id: "collab_workflows",       label: "Collaborative workflows", default: false, channels: ["beta", "experimental"], replayImpact: "low" },
  { id: "advanced_automation",    label: "Advanced automation",     default: false, channels: ["experimental"], replayImpact: "high" },
  { id: "multi_project_analytics",label: "Multi-project analytics", default: true,  channels: ["beta", "experimental", "stable"], replayImpact: "none" },
  { id: "deploy_confidence",      label: "Deploy confidence score", default: true,  channels: ["beta", "experimental", "stable"], replayImpact: "none" },
  { id: "crash_diagnostics",      label: "Crash diagnostics",       default: true,  channels: ["beta", "experimental", "stable"], replayImpact: "none" },
];

// ── Rollout simulation ────────────────────────────────────────────────────────
// Deterministic percentage gate: uses a stable hash of the support session ID.

function _rolloutGate(sessionId, pct) {
  if (pct >= 100) return true;
  if (pct <= 0)   return false;
  // Simple deterministic hash
  let hash = 0;
  for (let i = 0; i < (sessionId || "").length; i++) {
    hash = ((hash << 5) - hash) + (sessionId || "").charCodeAt(i);
    hash |= 0;
  }
  return (Math.abs(hash) % 100) < pct;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadChannel() {
  const raw = localStorage.getItem(CHANNEL_KEY);
  if (raw && CHANNELS[raw]) return raw;
  // Read from meta tag (build pipeline injection)
  try {
    const meta = document.querySelector('meta[name="jarvis-channel"]');
    if (meta?.content && CHANNELS[meta.content]) return meta.content;
  } catch {}
  return "beta";
}

function _loadFlagOverrides() {
  return _load(FLAGS_KEY, {});
}

function _loadRolloutState() {
  const raw = _load(ROLLOUT_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > ROLLOUT_TTL) return { history: [], current: null };
  return raw;
}

// ── Rollout confidence ────────────────────────────────────────────────────────

function _rolloutConfidence(rolloutState, hist = []) {
  const current = rolloutState.current;
  if (!current) return null;

  const now    = Date.now();
  const recent = hist.filter(h => now - (h.ts || 0) < 2 * 60 * 60 * 1000);
  const fails  = recent.filter(h => !h.ok).length;
  const total  = recent.length;
  const failRate = total > 0 ? Math.round((fails / total) * 100) : 0;

  let score = 100;
  if (failRate > 30)           score -= 25;
  if (current.pct < 25)       score -= 10; // very small rollout = less data
  if (current.stageIdx === 0) score  = Math.min(score, 70); // first stage, incomplete data

  const label = score >= 80 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW";
  const color = score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)";
  return { score, label, color, pct: current.pct, failRate, stage: current.stageIdx + 1 };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useReleaseChannel() {
  const [channel,       setChannelState]  = useState("beta");
  const [flagOverrides, setFlagOverrides] = useState({});
  const [rolloutState,  setRolloutState]  = useState({ history: [], current: null });
  const [initialized,   setInitialized]   = useState(false);

  const sessionId = useMemo(() => {
    try { return localStorage.getItem("jarvis_support_session_id") || "default"; } catch { return "default"; }
  }, []);

  useEffect(() => {
    setChannelState(_loadChannel());
    setFlagOverrides(_loadFlagOverrides());
    setRolloutState(_loadRolloutState());
    setInitialized(true);
  }, []);

  // Resolved flags: builtin defaults + channel filtering + operator overrides
  const resolvedFlags = useMemo(() => {
    const result = {};
    BUILTIN_FLAGS.forEach(f => {
      const inChannel  = f.channels.includes(channel);
      const override   = flagOverrides[f.id];
      result[f.id] = {
        ...f,
        enabled:  override !== undefined ? override : (inChannel && f.default),
        overridden: override !== undefined,
        inChannel,
      };
    });
    return result;
  }, [channel, flagOverrides]);

  // Check a single flag
  const isEnabled = useCallback((flagId) => {
    return resolvedFlags[flagId]?.enabled ?? false;
  }, [resolvedFlags]);

  // Check rollout gate for a feature
  const isInRollout = useCallback((flagId, pct = 50) => {
    if (!isEnabled(flagId)) return false;
    return _rolloutGate(sessionId, pct);
  }, [isEnabled, sessionId]);

  // Set channel (operator-visible)
  const setChannel = useCallback((ch) => {
    if (!CHANNELS[ch]) return;
    setChannelState(ch);
    try { localStorage.setItem(CHANNEL_KEY, ch); } catch {}
  }, []);

  // Override a single flag
  const setFlagOverride = useCallback((flagId, enabled) => {
    if (!BUILTIN_FLAGS.find(f => f.id === flagId)) return;
    setFlagOverrides(prev => {
      const next = { ...prev, [flagId]: enabled };
      // Cap overrides
      const keys = Object.keys(next);
      if (keys.length > FLAG_MAX) {
        const oldest = keys[0];
        delete next[oldest];
      }
      _save(FLAGS_KEY, next);
      return next;
    });
  }, []);

  // Reset all overrides
  const resetFlags = useCallback(() => {
    setFlagOverrides({});
    try { localStorage.removeItem(FLAGS_KEY); } catch {}
  }, []);

  // Staged rollout simulation (3 stages: 10% → 50% → 100%)
  const ROLLOUT_STAGES = [10, 50, 100];

  const startRollout = useCallback((version, stageIdx = 0) => {
    const pct     = ROLLOUT_STAGES[Math.min(stageIdx, ROLLOUT_STAGES.length - 1)];
    const current = { version, stageIdx, pct, startedAt: Date.now() };
    setRolloutState(prev => {
      const history = [current, ...(prev.history || [])].slice(0, ROLLOUT_MAX);
      const next    = { current, history, ts: Date.now() };
      _save(ROLLOUT_KEY, next);
      return next;
    });
  }, []);

  const advanceRollout = useCallback(() => {
    setRolloutState(prev => {
      if (!prev.current) return prev;
      const nextStage = prev.current.stageIdx + 1;
      if (nextStage >= ROLLOUT_STAGES.length) {
        // Complete
        const completed = { ...prev.current, completedAt: Date.now(), pct: 100 };
        const history   = [completed, ...(prev.history || [])].slice(0, ROLLOUT_MAX);
        const next      = { current: null, history, ts: Date.now() };
        _save(ROLLOUT_KEY, next);
        return next;
      }
      const current = { ...prev.current, stageIdx: nextStage, pct: ROLLOUT_STAGES[nextStage], advancedAt: Date.now() };
      const history = [current, ...(prev.history || [])].slice(0, ROLLOUT_MAX);
      const next    = { current, history, ts: Date.now() };
      _save(ROLLOUT_KEY, next);
      return next;
    });
  }, []);

  const rollbackRollout = useCallback(() => {
    setRolloutState(prev => {
      if (!prev.current) return prev;
      const rolled = { ...prev.current, rolledBackAt: Date.now() };
      const history = [rolled, ...(prev.history || [])].slice(0, ROLLOUT_MAX);
      const next    = { current: null, history, ts: Date.now() };
      _save(ROLLOUT_KEY, next);
      return next;
    });
  }, []);

  // Rollout confidence
  const rolloutConfidence = useMemo(() => {
    const hist = _load("jarvis_workflow_hist", []);
    return _rolloutConfidence(rolloutState, hist);
  }, [rolloutState]);

  // Update survivability score
  const updateSurvivability = useMemo(() => {
    const snap  = _load("jarvis_health_snapshot", null);
    const ageH  = snap ? Math.round((Date.now() - (snap.ts || 0)) / 3600000) : null;
    const stale = ageH === null || ageH > 6;
    let score   = 100;
    if (stale)                             score -= 20;
    if (rolloutState.current?.stageIdx === 0) score -= 10;
    return {
      score: Math.max(0, score),
      label: score >= 80 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW",
      color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
    };
  }, [rolloutState]);

  // Channel summary
  const channelInfo = CHANNELS[channel] || CHANNELS.beta;

  return {
    initialized,
    channel,
    channelInfo,
    channels: CHANNELS,
    // Feature flags
    resolvedFlags,
    flagList: BUILTIN_FLAGS,
    isEnabled,
    isInRollout,
    setFlagOverride,
    resetFlags,
    // Channel control
    setChannel,
    // Rollout
    rolloutState,
    rolloutConfidence,
    updateSurvivability,
    startRollout,
    advanceRollout,
    rollbackRollout,
  };
}
