// Phase 1321-1332: Public production + launch readiness.
//
// Consolidates twelve phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const INSTALLER_KEY    = "jarvis_installer_state";
const ONBOARDING_KEY   = "jarvis_launch_onboarding";
const DEPLOY_KEY       = "jarvis_public_deployments";
const CRASH_KEY        = "jarvis_crash_survivability";
const CHANNEL_KEY      = "jarvis_release_channels";
const TELEMETRY_KEY    = "jarvis_launch_telemetry";
const SUPPORT_KEY      = "jarvis_launch_support";
const LAUNCH_KEY       = "jarvis_launch_coordination";
const ISOLATION_KEY    = "jarvis_channel_isolation";
const PERF_KEY         = "jarvis_launch_perf";

const INSTALLER_MAX    = 10;
const ONBOARDING_MAX   = 20;
const DEPLOY_MAX       = 15;
const CRASH_MAX        = 30;
const CHANNEL_MAX      = 10;
const TELEMETRY_MAX    = 30;
const SUPPORT_MAX      = 15;
const LAUNCH_MAX       = 10;
const ISOLATION_MAX    = 20;
const PERF_MAX         = 20;

const INSTALLER_TTL    = 7  * 24 * 60 * 60 * 1000;
const ONBOARDING_TTL   = 7  * 24 * 60 * 60 * 1000;
const DEPLOY_TTL       = 7  * 24 * 60 * 60 * 1000;
const CRASH_TTL        = 24 * 60 * 60 * 1000;
const CHANNEL_TTL      = 7  * 24 * 60 * 60 * 1000;
const TELEMETRY_TTL    = 7  * 24 * 60 * 60 * 1000;
const SUPPORT_TTL      = 7  * 24 * 60 * 60 * 1000;
const LAUNCH_TTL       = 7  * 24 * 60 * 60 * 1000;
const ISOLATION_TTL    = 24 * 60 * 60 * 1000;
const PERF_TTL         = 24 * 60 * 60 * 1000;

const VALID_INSTALLER_STAGES = ["provisioning", "configuring", "validating", "ready", "failed"];
const VALID_ONBOARDING_STAGES = ["invited", "setup", "first_deploy", "first_workflow", "complete"];
const VALID_DEPLOY_STAGES    = ["queued", "validating", "deploying", "verifying", "complete", "rolled_back"];
const VALID_CHANNELS         = ["stable", "beta", "canary"];
const VALID_CHANNEL_STAGES   = ["draft", "staged", "approved", "deploying", "live", "retired"];
const VALID_CRASH_TYPES      = ["runtime_interruption", "replay_failure", "deploy_failure", "queue_spike", "infra_fault"];
const VALID_TELEMETRY_DIMS   = ["deploy_responsiveness", "onboard_continuity", "runtime_survivability", "smoothness_trend", "workload_pattern"];
const VALID_SUPPORT_STAGES   = ["opened", "triaged", "escalated", "resolving", "closed"];
const VALID_LAUNCH_STAGES    = ["planning", "staging", "approved", "rolling_out", "live", "complete"];

// ── LRU cache ────────────────────────────────────────────────────────────────
const _cache = new Map();
const CACHE_TTL = 30 * 1000;
const CACHE_MAX = 50;
function _cached(key, fn) {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL) return hit.val;
  if (_cache.size >= CACHE_MAX) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  const val = fn();
  _cache.set(key, { val, ts: now });
  return val;
}

// ── Storage helpers ───────────────────────────────────────────────────────────
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Phase 1321: Installer readiness foundation ────────────────────────────────

function _scoreInstaller(installs) {
  if (!installs.length) return 100;
  const active = installs.filter(i => !["ready", "failed"].includes(i.stage));
  const ready  = installs.filter(i => i.stage === "ready");
  const failed = installs.filter(i => i.stage === "failed");
  return Math.max(0, Math.round(
    (ready.length / installs.length) * 100
    - failed.length * 15
    - (active.length > 3 ? 10 : 0)
  ));
}

// ── Phase 1322: Onboarding simplification ────────────────────────────────────

function _scoreOnboarding(sessions) {
  if (!sessions.length) return 100;
  const now     = Date.now();
  const recent  = sessions.filter(s => now - (s.ts || 0) < 7 * 24 * 60 * 60 * 1000);
  const complete = recent.filter(s => s.stage === "complete").length;
  const stale   = recent.filter(s =>
    !["complete"].includes(s.stage)
    && now - (s.ts || 0) > 48 * 60 * 60 * 1000
  ).length;
  const depth   = recent.length ? recent.reduce((acc, s) => {
    const idx = VALID_ONBOARDING_STAGES.indexOf(s.stage);
    return acc + (idx >= 0 ? idx + 1 : 0);
  }, 0) / recent.length : 0;
  return Math.max(0, Math.min(100, Math.round(
    (complete / Math.max(recent.length, 1)) * 60
    + (depth / VALID_ONBOARDING_STAGES.length) * 30
    - stale * 10
  )));
}

// ── Phase 1323: Public deployment hardening ───────────────────────────────────

function _scorePublicDeployments(deploys) {
  if (!deploys.length) return 100;
  const complete  = deploys.filter(d => d.stage === "complete").length;
  const failed    = deploys.filter(d => d.stage === "rolled_back").length;
  const unapproved = deploys.filter(d =>
    ["deploying", "verifying", "complete"].includes(d.stage) && !d.approvedAt
  ).length;
  return Math.max(0, Math.round(
    (complete / deploys.length) * 80
    - failed * 10
    - unapproved * 20
  ));
}

// ── Phase 1324: Crash survivability system ────────────────────────────────────

function _computeCrashSurvivability(crashes) {
  if (!crashes.length) return { score: 100, label: "DURABLE", recoveredCount: 0, failedCount: 0 };
  const recovered = crashes.filter(c => c.recovered === true).length;
  const failed    = crashes.filter(c => c.recovered === false).length;
  const score     = Math.max(0, Math.round(
    (recovered / crashes.length) * 100 - failed * 5
  ));
  return {
    score,
    label:          score >= 80 ? "DURABLE" : score >= 60 ? "FRAGILE" : "CRITICAL",
    recoveredCount: recovered,
    failedCount:    failed,
  };
}

// ── Phase 1325: Release channel maturity ─────────────────────────────────────

function _scoreChannels(channels) {
  if (!channels.length) return 100;
  const live      = channels.filter(c => c.stage === "live").length;
  const unapproved = channels.filter(c =>
    ["deploying", "live"].includes(c.stage) && !c.approvedAt
  ).length;
  const coverage  = new Set(channels.map(c => c.channel).filter(c => VALID_CHANNELS.includes(c))).size;
  return Math.max(0, Math.min(100, Math.round(
    (coverage / VALID_CHANNELS.length) * 40
    + (live > 0 ? 40 : 0)
    + (channels.length > 0 ? 20 : 0)
    - unapproved * 25
  )));
}

// ── Phase 1326: Production telemetry foundation ───────────────────────────────

function _aggregateTelemetry(events) {
  const byDim = {};
  for (const dim of VALID_TELEMETRY_DIMS) {
    const dimEvents = events.filter(e => e.dim === dim);
    byDim[dim] = dimEvents.length
      ? Math.round(dimEvents.reduce((a, e) => a + (e.score ?? 80), 0) / dimEvents.length)
      : null;
  }
  const filled   = Object.values(byDim).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, v) => a + v, 0) / filled.length)
    : 100;
  return { byDim, composite };
}

// ── Phase 1327: Support readiness system ──────────────────────────────────────

function _scoreSupportReadiness(tickets) {
  if (!tickets.length) return 100;
  const now    = Date.now();
  const active = tickets.filter(t => !["closed"].includes(t.stage));
  const stale  = active.filter(t => now - (t.ts || 0) > 4 * 60 * 60 * 1000);
  const closed = tickets.filter(t => t.stage === "closed").length;
  return Math.max(0, Math.round(
    (closed / tickets.length) * 70
    + (active.length <= 5 ? 30 : 0)
    - stale.length * 10
  ));
}

// ── Phase 1328: Operational launch coordination ───────────────────────────────

function _scoreLaunchCoordination(launches) {
  if (!launches.length) return 100;
  const live      = launches.filter(l => ["live", "complete"].includes(l.stage)).length;
  const unapproved = launches.filter(l =>
    ["rolling_out", "live"].includes(l.stage) && !l.approvedAt
  ).length;
  return Math.max(0, Math.round(
    (live / launches.length) * 80
    + (launches.length > 0 ? 20 : 0)
    - unapproved * 30
  ));
}

// ── Phase 1329: Multi-channel isolation hardening ─────────────────────────────

function _checkChannelIsolation(channels, deploys) {
  const violations = [];
  const channelKeys = new Set(channels.map(c => c.id).filter(Boolean));

  // Cross-channel contamination: deploy references a channel that doesn't exist
  for (const d of deploys) {
    if (d.channelId && !channelKeys.has(d.channelId)) {
      violations.push({ type: "channel_crossover", deployId: d.id, channelId: d.channelId, ts: Date.now() });
    }
  }

  // Check for shared-state keys between channels (canary/beta keys in stable channel context)
  const canaryInStable = channels.filter(c => c.channel === "stable" && c._leaked_canary);
  if (canaryInStable.length) {
    violations.push({ type: "canary_bleed", count: canaryInStable.length, ts: Date.now() });
  }

  // Check launch coordination bleed: launch referencing closed channels
  try {
    const launches = _load(LAUNCH_KEY, []);
    for (const l of launches) {
      if (l.channelId) {
        const ch = channels.find(c => c.id === l.channelId);
        if (ch && ch.stage === "retired" && ["rolling_out", "live"].includes(l.stage)) {
          violations.push({ type: "retired_channel_launch", launchId: l.id, channelId: l.channelId, ts: Date.now() });
        }
      }
    }
  } catch {}

  return violations;
}

// ── Phase 1330: Production performance hardening ──────────────────────────────

function _computeLaunchPerf(installs, deploys, channels, telemetry) {
  const findings = [];

  // Installer bloat
  if (installs.length > INSTALLER_MAX) findings.push({ id: "installer_bloat", severity: "medium", msg: `${installs.length} installer records` });

  // Deploy saturation
  const activeDeploys = deploys.filter(d => !["complete", "rolled_back"].includes(d.stage));
  if (activeDeploys.length > 5) findings.push({ id: "deploy_saturation", severity: "high", msg: `${activeDeploys.length} active deploys` });

  // Telemetry burst
  const recentTelemetry = telemetry.filter(e => Date.now() - (e.ts || 0) < 10 * 1000);
  if (recentTelemetry.length > 8) findings.push({ id: "telemetry_burst", severity: "medium", msg: `${recentTelemetry.length} telemetry events in 10s` });

  // Channel duplication
  const channelTypes = channels.map(c => c.channel);
  const channelDupes = channelTypes.length - new Set(channelTypes).size;
  if (channelDupes > 0) findings.push({ id: "channel_duplication", severity: "medium", msg: `${channelDupes} duplicate channels` });

  return {
    ts:        Date.now(),
    findings,
    highCount: findings.filter(f => f.severity === "high").length,
    score:     findings.length === 0 ? 100 : findings.some(f => f.severity === "high") ? 50 : 75,
  };
}

// ── Phase 1331-1332: Stress test + UX refinement → composite scoring ──────────

function _computeLaunchScore({
  installerScore    = 100,
  onboardingScore   = 100,
  deployScore       = 100,
  crashScore        = 100,
  channelScore      = 100,
  telemetryScore    = 100,
  supportScore      = 100,
  launchScore       = 100,
  isoViolations     = 0,
  perfScore         = 100,
} = {}) {
  const composite = Math.round(
    deployScore     * 0.20 +
    launchScore     * 0.15 +
    crashScore      * 0.15 +
    channelScore    * 0.15 +
    onboardingScore * 0.10 +
    supportScore    * 0.10 +
    installerScore  * 0.08 +
    telemetryScore  * 0.05 +
    perfScore       * 0.02
  )
  - (isoViolations > 0 ? 15 : 0);

  return Math.max(0, Math.min(100, composite));
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePublicLaunch() {
  const [installerState,  setInstallerState]  = useState([]);
  const [onboardingSessions, setOnboardingSessions] = useState([]);
  const [publicDeploys,   setPublicDeploys]   = useState([]);
  const [crashEvents,     setCrashEvents]     = useState([]);
  const [channels,        setChannels]        = useState([]);
  const [telemetryEvents, setTelemetryEvents] = useState([]);
  const [supportTickets,  setSupportTickets]  = useState([]);
  const [launches,        setLaunches]        = useState([]);
  const [isoViolations,   setIsoViolations]   = useState([]);
  const [perfAudit,       setPerfAudit]       = useState(null);
  const [initialized,     setInitialized]     = useState(false);

  // ── Phase 1321: Record installer event
  const recordInstallerEvent = useCallback((event = {}) => {
    const { id, stage, env = "production" } = event;
    if (!id || !VALID_INSTALLER_STAGES.includes(stage)) return;
    setInstallerState(prev => {
      const now = Date.now();
      const existing = prev.find(i => i.id === id);
      let next;
      if (existing) {
        next = prev.map(i => i.id === id ? { ...i, stage, updatedAt: now } : i);
      } else {
        next = [{ id, stage, env, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(i => now - (i.ts || 0) < INSTALLER_TTL)
        .slice(0, INSTALLER_MAX);
      _save(INSTALLER_KEY, filtered);
      return filtered;
    });
  }, []);

  // ── Phase 1322: Record onboarding step
  const recordOnboardingStep = useCallback((event = {}) => {
    const { orgId, stage } = event;
    if (!orgId || !VALID_ONBOARDING_STAGES.includes(stage)) return;
    setOnboardingSessions(prev => {
      const now = Date.now();
      const existing = prev.find(s => s.orgId === orgId);
      let next;
      if (existing) {
        const stageIdx   = VALID_ONBOARDING_STAGES.indexOf(stage);
        const currentIdx = VALID_ONBOARDING_STAGES.indexOf(existing.stage);
        if (stageIdx <= currentIdx) return prev;
        next = prev.map(s => s.orgId === orgId ? { ...s, stage, updatedAt: now } : s);
      } else {
        next = [{ orgId, stage, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(s => now - (s.ts || 0) < ONBOARDING_TTL)
        .slice(0, ONBOARDING_MAX);
      _save(ONBOARDING_KEY, filtered);
      return filtered;
    });
  }, []);

  // ── Phase 1323: Record public deployment
  const recordPublicDeploy = useCallback((event = {}) => {
    const { id, stage, channelId, approvedAt } = event;
    if (!id || !VALID_DEPLOY_STAGES.includes(stage)) return;
    // Block unapproved deploying transitions
    if (stage === "deploying" && !approvedAt) return;
    setPublicDeploys(prev => {
      const now      = Date.now();
      const existing = prev.find(d => d.id === id);
      let next;
      if (existing) {
        next = prev.map(d => d.id === id ? { ...d, stage, channelId: channelId ?? d.channelId, approvedAt: approvedAt ?? d.approvedAt, updatedAt: now } : d);
      } else {
        next = [{ id, stage, channelId, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(d => now - (d.ts || 0) < DEPLOY_TTL)
        .slice(0, DEPLOY_MAX);
      _save(DEPLOY_KEY, filtered);
      return filtered;
    });
  }, []);

  // ── Phase 1324: Record crash event
  const recordCrashEvent = useCallback((event = {}) => {
    const { type, recovered, deployId } = event;
    if (!VALID_CRASH_TYPES.includes(type)) return;
    setCrashEvents(prev => {
      const now = Date.now();
      const next = [{ type, recovered: recovered === true, deployId, ts: now }, ...prev]
        .filter(c => now - (c.ts || 0) < CRASH_TTL)
        .slice(0, CRASH_MAX);
      _save(CRASH_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1325: Record release channel update
  const recordChannelUpdate = useCallback((event = {}) => {
    const { id, channel, stage, approvedAt } = event;
    if (!id || !VALID_CHANNELS.includes(channel) || !VALID_CHANNEL_STAGES.includes(stage)) return;
    if (["deploying", "live"].includes(stage) && !approvedAt) return;
    setChannels(prev => {
      const now = Date.now();
      const existing = prev.find(c => c.id === id);
      let next;
      if (existing) {
        next = prev.map(c => c.id === id ? { ...c, stage, approvedAt: approvedAt ?? c.approvedAt, updatedAt: now } : c);
      } else {
        next = [{ id, channel, stage, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(c => now - (c.ts || 0) < CHANNEL_TTL)
        .slice(0, CHANNEL_MAX);
      _save(CHANNEL_KEY, filtered);
      return filtered;
    });
  }, []);

  // ── Phase 1326: Record telemetry event (privacy-safe)
  const recordTelemetryEvent = useCallback((event = {}) => {
    const { dim, score } = event;
    if (!VALID_TELEMETRY_DIMS.includes(dim)) return;
    if (event.rawContent || event.commandOutput || event.userInput) return;
    setTelemetryEvents(prev => {
      const now  = Date.now();
      const dedup = prev.find(e => e.dim === dim && now - (e.ts || 0) < 30 * 1000);
      if (dedup) return prev;
      const next = [{ dim, score: Math.min(100, Math.max(0, score ?? 80)), ts: now }, ...prev]
        .filter(e => now - (e.ts || 0) < TELEMETRY_TTL)
        .slice(0, TELEMETRY_MAX);
      _save(TELEMETRY_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1327: Record support ticket
  const recordSupportTicket = useCallback((event = {}) => {
    const { id, stage, issueType } = event;
    if (!id || !VALID_SUPPORT_STAGES.includes(stage)) return;
    // Block auto-escalation
    if (stage === "escalated" && !event.operatorApproved) return;
    setSupportTickets(prev => {
      const now      = Date.now();
      const existing = prev.find(t => t.id === id);
      let next;
      if (existing) {
        next = prev.map(t => t.id === id ? { ...t, stage, updatedAt: now } : t);
      } else {
        // 5-minute dedup per issueType
        const recentSame = prev.find(t =>
          t.issueType === issueType && now - (t.ts || 0) < 5 * 60 * 1000
        );
        if (recentSame) return prev;
        next = [{ id, stage, issueType, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(t => now - (t.ts || 0) < SUPPORT_TTL)
        .slice(0, SUPPORT_MAX);
      _save(SUPPORT_KEY, filtered);
      return filtered;
    });
  }, []);

  // ── Phase 1328: Record launch coordination event
  const recordLaunchEvent = useCallback((event = {}) => {
    const { id, stage, channelId, approvedAt } = event;
    if (!id || !VALID_LAUNCH_STAGES.includes(stage)) return;
    if (["rolling_out", "live"].includes(stage) && !approvedAt) return;
    setLaunches(prev => {
      const now      = Date.now();
      const existing = prev.find(l => l.id === id);
      let next;
      if (existing) {
        next = prev.map(l => l.id === id ? { ...l, stage, channelId: channelId ?? l.channelId, approvedAt: approvedAt ?? l.approvedAt, updatedAt: now } : l);
      } else {
        next = [{ id, stage, channelId, approvedAt, ts: now, updatedAt: now }, ...prev];
      }
      const filtered = next
        .filter(l => now - (l.ts || 0) < LAUNCH_TTL)
        .slice(0, LAUNCH_MAX);
      _save(LAUNCH_KEY, filtered);
      return filtered;
    });
  }, []);

  // ── Evaluate: Phase 1329-1330 isolation + perf ────────────────────────────
  const evaluate = useCallback(() => {
    const now = Date.now();

    // Phase 1329: channel isolation
    const isos = _checkChannelIsolation(channels, publicDeploys);
    setIsoViolations(isos);
    if (isos.length) {
      const existing = _load(ISOLATION_KEY, []);
      const next = [...isos, ...existing]
        .filter(v => now - (v.ts || 0) < ISOLATION_TTL)
        .slice(0, ISOLATION_MAX);
      _save(ISOLATION_KEY, next);
    }

    // Phase 1330: perf audit
    const perf = _computeLaunchPerf(installerState, publicDeploys, channels, telemetryEvents);
    setPerfAudit(perf);
    _save(PERF_KEY, perf);
  }, [channels, publicDeploys, installerState, telemetryEvents]);

  useEffect(() => {
    const now = Date.now();
    setInstallerState(_load(INSTALLER_KEY, []).filter(i => now - (i.ts || 0) < INSTALLER_TTL));
    setOnboardingSessions(_load(ONBOARDING_KEY, []).filter(s => now - (s.ts || 0) < ONBOARDING_TTL));
    setPublicDeploys(_load(DEPLOY_KEY, []).filter(d => now - (d.ts || 0) < DEPLOY_TTL));
    setCrashEvents(_load(CRASH_KEY, []).filter(c => now - (c.ts || 0) < CRASH_TTL));
    setChannels(_load(CHANNEL_KEY, []).filter(c => now - (c.ts || 0) < CHANNEL_TTL));
    setTelemetryEvents(_load(TELEMETRY_KEY, []).filter(e => now - (e.ts || 0) < TELEMETRY_TTL));
    setSupportTickets(_load(SUPPORT_KEY, []).filter(t => now - (t.ts || 0) < SUPPORT_TTL));
    setLaunches(_load(LAUNCH_KEY, []).filter(l => now - (l.ts || 0) < LAUNCH_TTL));
    setInitialized(true);
  }, []);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // ── Derived scores (memoized) ─────────────────────────────────────────────
  const installerScore = useMemo(() => _scoreInstaller(installerState), [installerState]);

  const onboardingScore = useMemo(
    () => _cached(`onboard|${Math.floor(onboardingSessions.length / 3)}`, () => _scoreOnboarding(onboardingSessions)),
    [onboardingSessions]
  );

  const deployScore = useMemo(() => _scorePublicDeployments(publicDeploys), [publicDeploys]);

  const crashSurvivability = useMemo(() => _computeCrashSurvivability(crashEvents), [crashEvents]);

  const channelScore = useMemo(() => _scoreChannels(channels), [channels]);

  const telemetryAgg = useMemo(
    () => _cached(`telemetry|${Math.floor(telemetryEvents.length / 5)}`, () => _aggregateTelemetry(telemetryEvents)),
    [telemetryEvents]
  );

  const supportScore = useMemo(() => _scoreSupportReadiness(supportTickets), [supportTickets]);

  const launchCoordScore = useMemo(() => _scoreLaunchCoordination(launches), [launches]);

  const launchScore = useMemo(() => _computeLaunchScore({
    installerScore,
    onboardingScore,
    deployScore,
    crashScore:    crashSurvivability.score,
    channelScore,
    telemetryScore: telemetryAgg.composite,
    supportScore,
    launchScore:   launchCoordScore,
    isoViolations: isoViolations.length,
    perfScore:     perfAudit?.score ?? 100,
  }), [
    installerScore, onboardingScore, deployScore, crashSurvivability.score,
    channelScore, telemetryAgg.composite, supportScore, launchCoordScore,
    isoViolations.length, perfAudit?.score,
  ]);

  const launchBar = useMemo(() => {
    if (launchScore >= 80 && isoViolations.length === 0 && !perfAudit?.highCount) return null;
    const topIssue =
      isoViolations.length ? `Channel isolation: ${isoViolations.length} violation${isoViolations.length > 1 ? "s" : ""}` :
      crashSurvivability.label !== "DURABLE" ? `Crash survivability: ${crashSurvivability.label}` :
      deployScore < 60 ? `Deploy health: ${deployScore}%` :
      launchCoordScore < 60 ? `Launch coordination: ${launchCoordScore}%` :
      null;
    const color = launchScore >= 80 ? "var(--op-green)" : launchScore >= 60 ? "var(--op-amber)" : "var(--op-red)";
    return { score: launchScore, issue: topIssue, color, hasCrit: launchScore < 50 };
  }, [launchScore, isoViolations.length, crashSurvivability.label, deployScore, launchCoordScore]);

  return {
    initialized,
    installerState,
    onboardingSessions,
    publicDeploys,
    crashEvents,
    channels,
    telemetryEvents,
    supportTickets,
    launches,
    isoViolations,
    perfAudit,
    installerScore,
    onboardingScore,
    deployScore,
    crashSurvivability,
    channelScore,
    telemetryAgg,
    supportScore,
    launchCoordScore,
    launchScore,
    launchBar,
    recordInstallerEvent,
    recordOnboardingStep,
    recordPublicDeploy,
    recordCrashEvent,
    recordChannelUpdate,
    recordTelemetryEvent,
    recordSupportTicket,
    recordLaunchEvent,
    evaluate,
  };
}
