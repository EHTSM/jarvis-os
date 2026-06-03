// Phases 1621-1628 + 1631-1634: Mobile ecosystem + native experience foundation —
// mobile UX, session continuity, workspace experience, notifications/guidance,
// productivity flows, performance optimization, stress test, UX calmness,
// mobile ecosystem refinement, native workflow continuity, maturity.
//
// Platform-agnostic. Works in React web + Electron + Capacitor environments.
// No external calls. No autonomous execution. localStorage-only.
// All arrays bounded. Privacy contract: no rawContent/commandOutput/userInput.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const MOB_SESSION_KEY  = "jarvis_mob_sessions";
const MOB_ONBOARD_KEY  = "jarvis_mob_onboarding";
const MOB_NOTIF_KEY    = "jarvis_mob_notifications";
const MOB_WORKFLOW_KEY = "jarvis_mob_workflows";
const MOB_WORKSPACE_KEY = "jarvis_mob_workspace";
const MOB_TRUST_KEY    = "jarvis_mob_trust";
const MOB_PERF_KEY     = "jarvis_mob_perf";
const MOB_ISO_KEY      = "jarvis_mob_live_iso";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_7D  = 7  * 24 * 60 * 60 * 1000;

const MAX_SESSIONS   = 20;
const MAX_ONBOARD    = 20;
const MAX_NOTIFS     = 30;
const MAX_WORKFLOWS  = 20;
const MAX_WORKSPACE  = 20;
const MAX_TRUST      = 30;
const MAX_PERF       = 30;

// Phase 1622: session stages (forward-only)
const VALID_SESSION_STAGES = [
  "started", "active", "background", "reconnecting", "restored", "terminated",
];

// Phase 1621: onboarding stages (forward-only)
const VALID_ONBOARD_STAGES = [
  "not_started", "app_launched", "permissions", "workspace_ready",
  "first_workflow", "complete", "stalled",
];

// Phase 1624: notification levels
const VALID_NOTIF_LEVELS = new Set(["info", "warning", "critical", "resolved"]);

// Phase 1625: workflow stages (forward-only)
const VALID_WORKFLOW_STAGES = [
  "queued", "running", "paused", "complete", "failed", "cancelled",
];

// Phase 1623: workspace dimensions
const VALID_WORKSPACE_DIMS = new Set([
  "workflow_discoverability", "operational_trust", "ecosystem_response",
  "deploy_survivability", "workspace_continuity", "mobile_calmness",
]);

// Phase 1631: mobile trust dimensions
const VALID_TRUST_DIMS = new Set([
  "onboarding_smoothness", "reconnect_reliability", "workflow_continuity",
  "notification_quality", "deployment_transparency",
]);

// ── LRU cache (Phase 1626) ────────────────────────────────────────────────────

const _lru = new Map();
const LRU_TTL = 30_000;
const LRU_MAX = 50;
function _cached(key, fn) {
  const now = Date.now();
  const hit = _lru.get(key);
  if (hit && now - hit.ts < LRU_TTL) return hit.val;
  const val = fn();
  if (_lru.size >= LRU_MAX) _lru.delete(_lru.keys().next().value);
  _lru.set(key, { val, ts: now });
  return val;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Isolation scanner ─────────────────────────────────────────────────────────

const MOB_PREFIX = "jarvis_mob_";
const MOB_OWNED = new Set([
  MOB_SESSION_KEY, MOB_ONBOARD_KEY, MOB_NOTIF_KEY, MOB_WORKFLOW_KEY,
  MOB_WORKSPACE_KEY, MOB_TRUST_KEY, MOB_PERF_KEY, MOB_ISO_KEY,
]);

function _scanIso() {
  const unknown = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(MOB_PREFIX) && !MOB_OWNED.has(k)) unknown.push(k);
    }
  } catch {}
  return unknown;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function _sessionScore(sessions) {
  if (!sessions.length) return 100;
  const reconnecting = sessions.filter(s => s.stage === "reconnecting").length;
  if (reconnecting > sessions.length * 0.3) return 40;
  if (reconnecting > sessions.length * 0.1) return 70;
  return 100;
}

function _onboardScore(onboard) {
  if (!onboard.length) return 100;
  const stalled = onboard.filter(o => o.stage === "stalled").length;
  const total   = onboard.length;
  if (stalled / total > 0.3) return 40;
  if (stalled / total > 0.1) return 70;
  return 100;
}

function _notifScore(notifs) {
  if (!notifs.length) return 100;
  const now    = Date.now();
  const recent = notifs.filter(n => now - (n.ts || 0) < 60_000);
  if (recent.length > 10) return 40;
  const critical = notifs.filter(n => n.level === "critical");
  if (critical.length > 0) return Math.max(40, 100 - critical.length * 20);
  return 100;
}

function _workflowScore(workflows) {
  if (!workflows.length) return 100;
  const failed = workflows.filter(w => w.stage === "failed").length;
  const total  = workflows.length;
  if (failed / total > 0.3) return 40;
  if (failed / total > 0.1) return 70;
  return 100;
}

function _workspaceScore(workspace) {
  if (!workspace.length) return 100;
  const vals = workspace.map(w => w.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function _trustScore(trust) {
  if (!trust.length) return 100;
  const vals = trust.map(t => t.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// ── Composite bar ─────────────────────────────────────────────────────────────

function _computeMOBBar({
  sessionScore, onboardScore, notifScore, workflowScore,
  workspaceScore, trustScore, isoViolations,
}) {
  const score = Math.round(
    trustScore     * 0.20 +
    onboardScore   * 0.20 +
    sessionScore   * 0.20 +
    workflowScore  * 0.15 +
    workspaceScore * 0.15 +
    notifScore     * 0.10
  ) - (isoViolations > 0 ? 15 : 0);

  const clamped = Math.max(0, Math.min(100, score));
  const hasCrit = isoViolations > 0 || sessionScore < 40 || notifScore < 40;
  const color = hasCrit ? "var(--op-red)" : clamped < 60 ? "var(--op-amber)" : "var(--op-green)";

  let issue = null;
  if (isoViolations > 0)    issue = `MOB isolation: ${isoViolations} unknown keys`;
  else if (notifScore < 40)  issue = "Mobile notification flood";
  else if (sessionScore < 40) issue = "Mobile reconnect storm";
  else if (onboardScore < 40) issue = "Mobile onboarding stalls critical";
  else if (workflowScore < 60) issue = "Mobile workflow failures elevated";
  else if (trustScore < 60)   issue = `Mobile trust: ${trustScore}%`;

  return { score: clamped, hasCrit, color, issue };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useMobileEcosystem() {
  const [sessions,   setSessions]   = useState(() => _load(MOB_SESSION_KEY,   []));
  const [onboard,    setOnboard]    = useState(() => _load(MOB_ONBOARD_KEY,   []));
  const [notifs,     setNotifs]     = useState(() => _load(MOB_NOTIF_KEY,     []));
  const [workflows,  setWorkflows]  = useState(() => _load(MOB_WORKFLOW_KEY,  []));
  const [workspace,  setWorkspace]  = useState(() => _load(MOB_WORKSPACE_KEY, []));
  const [trust,      setTrust]      = useState(() => _load(MOB_TRUST_KEY,     []));
  const [perf,       setPerf]       = useState(() => _load(MOB_PERF_KEY,      []));
  const [isoViolations, setIsoViolations] = useState([]);

  const _recentUpdates = useRef(new Map());
  function _burstGuard(id) {
    const now = Date.now();
    const recent = (_recentUpdates.current.get(id) || []).filter(t => now - t < 10_000);
    if (recent.length >= 3) return false;
    _recentUpdates.current.set(id, [...recent, now]);
    return true;
  }

  // ── Phase 1622: session write ─────────────────────────────────────────────
  const recordSession = useCallback((entry = {}) => {
    const { sessionId, stage, deviceType = "mobile" } = entry;
    if (!sessionId || !VALID_SESSION_STAGES.includes(stage)) return;
    if (!_burstGuard(`session:${sessionId}`)) return;
    const now = Date.now();
    setSessions(prev => {
      const idx = prev.findIndex(s => s.sessionId === sessionId);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_SESSION_STAGES.indexOf(cur.stage);
        const newIdx = VALID_SESSION_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, deviceType, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(s => now - (s.ts || 0) < TTL_7D)
          .slice(0, MAX_SESSIONS);
        _save(MOB_SESSION_KEY, next);
        return next;
      }
      const next = [{ sessionId, stage, deviceType, ts: now }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SESSIONS);
      _save(MOB_SESSION_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1621: onboarding write ─────────────────────────────────────────
  const recordOnboarding = useCallback((entry = {}) => {
    const { userId, stage } = entry;
    if (!userId || !VALID_ONBOARD_STAGES.includes(stage)) return;
    if (!_burstGuard(`onboard:${userId}`)) return;
    const now = Date.now();
    setOnboard(prev => {
      const idx = prev.findIndex(o => o.userId === userId);
      if (idx !== -1) {
        const cur = prev[idx];
        if (stage !== "stalled") {
          const curIdx = VALID_ONBOARD_STAGES.indexOf(cur.stage);
          const newIdx = VALID_ONBOARD_STAGES.indexOf(stage);
          if (newIdx < curIdx) return prev;
        }
        const updated = { ...cur, stage, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(o => now - (o.ts || 0) < TTL_7D)
          .slice(0, MAX_ONBOARD);
        _save(MOB_ONBOARD_KEY, next);
        return next;
      }
      const next = [{ userId, stage, ts: now }, ...prev]
        .filter(o => now - (o.ts || 0) < TTL_7D)
        .slice(0, MAX_ONBOARD);
      _save(MOB_ONBOARD_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1624: notification write ───────────────────────────────────────
  const recordNotif = useCallback((entry = {}) => {
    const { notifId, level, title } = entry;
    if (!notifId || !VALID_NOTIF_LEVELS.has(level)) return;
    const now = Date.now();
    setNotifs(prev => {
      const recent = prev.filter(n => now - (n.ts || 0) < 60_000);
      if (recent.length >= 10 && level !== "critical") return prev;
      if (prev.find(n => n.notifId === notifId)) return prev;
      const next = [{ notifId, level, title: title || "", ts: now }, ...prev]
        .filter(n => now - (n.ts || 0) < TTL_24H)
        .slice(0, MAX_NOTIFS);
      _save(MOB_NOTIF_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1625: workflow write ────────────────────────────────────────────
  const recordWorkflow = useCallback((entry = {}) => {
    const { workflowId, stage } = entry;
    if (!workflowId || !VALID_WORKFLOW_STAGES.includes(stage)) return;
    if (!_burstGuard(`wf:${workflowId}`)) return;
    const now = Date.now();
    setWorkflows(prev => {
      const idx = prev.findIndex(w => w.workflowId === workflowId);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_WORKFLOW_STAGES.indexOf(cur.stage);
        const newIdx = VALID_WORKFLOW_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(w => now - (w.ts || 0) < TTL_7D)
          .slice(0, MAX_WORKFLOWS);
        _save(MOB_WORKFLOW_KEY, next);
        return next;
      }
      const next = [{ workflowId, stage, ts: now }, ...prev]
        .filter(w => now - (w.ts || 0) < TTL_7D)
        .slice(0, MAX_WORKFLOWS);
      _save(MOB_WORKFLOW_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1623: workspace quality write ──────────────────────────────────
  const recordWorkspace = useCallback((entry = {}) => {
    const { dim, score } = entry;
    if (!VALID_WORKSPACE_DIMS.has(dim) || score === undefined) return;
    if (score < 0 || score > 100) return;
    const now = Date.now();
    setWorkspace(prev => {
      const last = prev.find(w => w.dim === dim);
      if (last && now - (last.ts || 0) < 5 * 60_000) return prev;
      const next = [{ dim, score, ts: now }, ...prev]
        .filter(w => now - (w.ts || 0) < TTL_7D)
        .slice(0, MAX_WORKSPACE);
      _save(MOB_WORKSPACE_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1631: mobile trust write ───────────────────────────────────────
  const recordTrust = useCallback((entry = {}) => {
    const { dim, score, userId } = entry;
    if (!VALID_TRUST_DIMS.has(dim) || score === undefined) return;
    if (score < 0 || score > 100) return;
    const now = Date.now();
    setTrust(prev => {
      const dedupKey = `${dim}:${userId || "anon"}`;
      const last = prev.find(t => `${t.dim}:${t.userId || "anon"}` === dedupKey);
      if (last && now - (last.ts || 0) < 5 * 60_000) return prev;
      const next = [{ dim, score, ts: now }, ...prev]
        .filter(t => now - (t.ts || 0) < TTL_7D)
        .slice(0, MAX_TRUST);
      _save(MOB_TRUST_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1626: perf write ────────────────────────────────────────────────
  const recordPerf = useCallback((entry = {}) => {
    const { metric, value, deviceType = "mobile" } = entry;
    if (!metric || value === undefined) return;
    const now = Date.now();
    setPerf(prev => {
      const dedupKey = `${metric}:${deviceType}`;
      const last = prev.find(p => `${p.metric}:${p.deviceType}` === dedupKey);
      if (last && now - (last.ts || 0) < 60_000) return prev;
      const next = [{ metric, value, deviceType, ts: now }, ...prev]
        .filter(p => now - (p.ts || 0) < TTL_24H)
        .slice(0, MAX_PERF);
      _save(MOB_PERF_KEY, next);
      return next;
    });
  }, []);

  // ── Isolation scan ────────────────────────────────────────────────────────
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setIsoViolations(_scanIso());
    };
    setIsoViolations(_scanIso());
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── Coarse dep-keys (Phase 1626) ─────────────────────────────────────────
  const sessionCount   = Math.floor(sessions.length   / 3);
  const onboardCount   = Math.floor(onboard.length    / 3);
  const notifCount     = Math.floor(notifs.length     / 5);
  const workflowCount  = Math.floor(workflows.length  / 3);
  const workspaceCount = Math.floor(workspace.length  / 3);
  const trustCount     = Math.floor(trust.length      / 5);

  const sessionScoreVal   = useMemo(() => _sessionScore(sessions),    [sessionCount]);   // eslint-disable-line
  const onboardScoreVal   = useMemo(() => _onboardScore(onboard),     [onboardCount]);   // eslint-disable-line
  const notifScoreVal     = useMemo(() => _notifScore(notifs),        [notifCount]);     // eslint-disable-line
  const workflowScoreVal  = useMemo(() => _workflowScore(workflows),  [workflowCount]);  // eslint-disable-line
  const workspaceScoreVal = useMemo(() => _workspaceScore(workspace), [workspaceCount]); // eslint-disable-line
  const trustScoreVal     = useMemo(() => _trustScore(trust),         [trustCount]);     // eslint-disable-line

  const mobBar = useMemo(() => _cached("mob_bar", () =>
    _computeMOBBar({
      sessionScore: sessionScoreVal, onboardScore: onboardScoreVal,
      notifScore: notifScoreVal, workflowScore: workflowScoreVal,
      workspaceScore: workspaceScoreVal, trustScore: trustScoreVal,
      isoViolations: isoViolations.length,
    })
  ), [sessionScoreVal, onboardScoreVal, notifScoreVal, workflowScoreVal, workspaceScoreVal, trustScoreVal, isoViolations.length]);

  // Phase 1627: stress profile
  const stressProfile = useMemo(() => {
    const reconnecting   = sessions.filter(s => s.stage === "reconnecting").length;
    const stalledOnboard = onboard.filter(o => o.stage === "stalled").length;
    const failedWf       = workflows.filter(w => w.stage === "failed").length;
    const critNotifs     = notifs.filter(n => n.level === "critical").length;
    return { reconnecting, stalledOnboard, failedWf, critNotifs };
  }, [sessionCount, onboardCount, workflowCount, notifCount]); // eslint-disable-line

  // Phase 1628: mobile UX calmness
  const mobileCalmness = useMemo(() => {
    const stalled      = onboard.filter(o => o.stage === "stalled").length;
    const reconnecting = sessions.filter(s => s.stage === "reconnecting").length;
    const lowTrust     = trust.filter(t => (t.score ?? 100) < 60).length;
    const score = Math.max(0, 100 - stalled * 10 - reconnecting * 8 - lowTrust * 10);
    return { score, label: score >= 80 ? "CALM" : score >= 60 ? "BUSY" : "OVERLOADED" };
  }, [onboardCount, sessionCount, trustCount]); // eslint-disable-line

  return {
    mobBar,
    mobScore: mobBar.score,
    sessionScore:   sessionScoreVal,
    onboardScore:   onboardScoreVal,
    notifScore:     notifScoreVal,
    workflowScore:  workflowScoreVal,
    workspaceScore: workspaceScoreVal,
    trustScore:     trustScoreVal,
    mobIsoViolations: isoViolations,
    stressProfile,
    mobileCalmness,
    recordSession,
    recordOnboarding,
    recordNotif,
    recordWorkflow,
    recordWorkspace,
    recordTrust,
    recordPerf,
  };
}
