// Phases 1591-1598 + 1601-1604: Real product distribution + user experience —
// production UX, session continuity, distribution experience, user notifications,
// productivity flows, performance optimization, stress test, UX calmness,
// installer/packaging validation, public distribution readiness,
// platform validation, product maturity.
//
// Platform-agnostic (web + Electron). localStorage-only.
// No external calls. No autonomous execution.
// All arrays bounded. Privacy contract: no rawContent/commandOutput/userInput.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const PDX_SESSION_KEY  = "jarvis_pdx_sessions";
const PDX_ONBOARD_KEY  = "jarvis_pdx_onboarding";
const PDX_NOTIF_KEY    = "jarvis_pdx_notifications";
const PDX_WORKFLOW_KEY = "jarvis_pdx_workflows";
const PDX_DISTRIB_KEY  = "jarvis_pdx_distribution";
const PDX_INSTALLER_KEY = "jarvis_pdx_installers";
const PDX_PERF_KEY     = "jarvis_pdx_perf";
const PDX_ISO_KEY      = "jarvis_pdx_live_iso";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_7D  = 7  * 24 * 60 * 60 * 1000;

const MAX_SESSIONS  = 20;
const MAX_ONBOARD   = 20;
const MAX_NOTIFS    = 30;
const MAX_WORKFLOWS = 20;
const MAX_DISTRIB   = 20;
const MAX_INSTALL   = 10;
const MAX_PERF      = 30;

// Phase 1592: session stages (forward-only)
const VALID_SESSION_STAGES = [
  "started", "active", "long_running", "recovering", "restored", "terminated",
];

// Phase 1591: onboarding stages (forward-only)
const VALID_ONBOARD_STAGES = [
  "not_started", "installer_launched", "setup", "workspace_ready",
  "first_workflow", "complete", "stalled",
];

// Phase 1594: notification levels
const VALID_NOTIF_LEVELS = new Set(["info", "warning", "critical", "resolved"]);

// Phase 1595: workflow stages (forward-only)
const VALID_WORKFLOW_STAGES = [
  "queued", "running", "paused", "complete", "failed", "cancelled",
];

// Phase 1593: distribution event types
const VALID_DISTRIB_TYPES = new Set([
  "installer_download", "installer_complete", "onboarding_complete",
  "first_deploy", "trust_signal", "churn_signal",
]);

// Phase 1601: installer targets + stages
const VALID_INSTALL_TARGETS = new Set(["mac", "windows", "linux", "web"]);
const VALID_INSTALL_STAGES  = [
  "pending", "downloading", "installing", "verifying", "complete", "failed",
];

// ── LRU cache (Phase 1596) ────────────────────────────────────────────────────

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

const PDX_PREFIX = "jarvis_pdx_";
const PDX_OWNED = new Set([
  PDX_SESSION_KEY, PDX_ONBOARD_KEY, PDX_NOTIF_KEY, PDX_WORKFLOW_KEY,
  PDX_DISTRIB_KEY, PDX_INSTALLER_KEY, PDX_PERF_KEY, PDX_ISO_KEY,
]);

function _scanIso() {
  const unknown = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PDX_PREFIX) && !PDX_OWNED.has(k)) unknown.push(k);
    }
  } catch {}
  return unknown;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function _sessionScore(sessions) {
  if (!sessions.length) return 100;
  const recovering = sessions.filter(s => s.stage === "recovering").length;
  if (recovering > sessions.length * 0.3) return 50;
  if (recovering > sessions.length * 0.1) return 75;
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
  const failed   = workflows.filter(w => w.stage === "failed").length;
  const total    = workflows.length;
  if (failed / total > 0.3) return 40;
  if (failed / total > 0.1) return 70;
  return 100;
}

function _distribScore(distrib) {
  if (!distrib.length) return 100;
  const churn = distrib.filter(d => d.type === "churn_signal").length;
  const trust = distrib.filter(d => d.type === "trust_signal").length;
  if (churn > trust) return Math.max(40, 100 - (churn - trust) * 15);
  return 100;
}

function _installerScore(installers) {
  if (!installers.length) return 100;
  const failed = installers.filter(i => i.stage === "failed").length;
  if (failed > 0) return Math.max(0, 100 - failed * 25);
  return 100;
}

// ── Composite bar ─────────────────────────────────────────────────────────────

function _computePDXBar({
  sessionScore, onboardScore, notifScore, workflowScore,
  distribScore, installerScore, isoViolations,
}) {
  const score = Math.round(
    sessionScore  * 0.20 +
    onboardScore  * 0.20 +
    workflowScore * 0.20 +
    notifScore    * 0.15 +
    distribScore  * 0.15 +
    installerScore * 0.10
  ) - (isoViolations > 0 ? 15 : 0);

  const clamped = Math.max(0, Math.min(100, score));
  const hasCrit = isoViolations > 0 || notifScore < 40 || onboardScore < 40;
  const color = hasCrit ? "var(--op-red)" : clamped < 60 ? "var(--op-amber)" : "var(--op-green)";

  let issue = null;
  if (isoViolations > 0)    issue = `PDX isolation: ${isoViolations} unknown keys`;
  else if (notifScore < 40)  issue = "User notification flood";
  else if (onboardScore < 40) issue = "Onboarding stall rate critical";
  else if (installerScore < 60) issue = "Installer failures detected";
  else if (workflowScore < 60) issue = "Workflow failure rate elevated";
  else if (sessionScore < 60) issue = "Session recovery rate elevated";

  return { score: clamped, hasCrit, color, issue };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useProductDistribution() {
  const [sessions,    setSessions]    = useState(() => _load(PDX_SESSION_KEY,   []));
  const [onboard,     setOnboard]     = useState(() => _load(PDX_ONBOARD_KEY,   []));
  const [notifs,      setNotifs]      = useState(() => _load(PDX_NOTIF_KEY,     []));
  const [workflows,   setWorkflows]   = useState(() => _load(PDX_WORKFLOW_KEY,  []));
  const [distrib,     setDistrib]     = useState(() => _load(PDX_DISTRIB_KEY,   []));
  const [installers,  setInstallers]  = useState(() => _load(PDX_INSTALLER_KEY, []));
  const [perf,        setPerf]        = useState(() => _load(PDX_PERF_KEY,      []));
  const [isoViolations, setIsoViolations] = useState([]);

  const _recentUpdates = useRef(new Map());
  function _burstGuard(id) {
    const now = Date.now();
    const recent = (_recentUpdates.current.get(id) || []).filter(t => now - t < 10_000);
    if (recent.length >= 3) return false;
    _recentUpdates.current.set(id, [...recent, now]);
    return true;
  }

  // ── Phase 1591-1592: session write ────────────────────────────────────────
  const recordSession = useCallback((entry = {}) => {
    const { sessionId, stage, platform = "web" } = entry;
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
        const updated = { ...cur, stage, platform, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(s => now - (s.ts || 0) < TTL_7D)
          .slice(0, MAX_SESSIONS);
        _save(PDX_SESSION_KEY, next);
        return next;
      }
      const next = [{ sessionId, stage, platform, ts: now }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SESSIONS);
      _save(PDX_SESSION_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1591: onboarding write ─────────────────────────────────────────
  const recordOnboarding = useCallback((entry = {}) => {
    const { userId, stage, platform = "web" } = entry;
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
        const updated = { ...cur, stage, platform, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(o => now - (o.ts || 0) < TTL_7D)
          .slice(0, MAX_ONBOARD);
        _save(PDX_ONBOARD_KEY, next);
        return next;
      }
      const next = [{ userId, stage, platform, ts: now }, ...prev]
        .filter(o => now - (o.ts || 0) < TTL_7D)
        .slice(0, MAX_ONBOARD);
      _save(PDX_ONBOARD_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1594: notification write ───────────────────────────────────────
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
      _save(PDX_NOTIF_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1595: workflow write ────────────────────────────────────────────
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
        _save(PDX_WORKFLOW_KEY, next);
        return next;
      }
      const next = [{ workflowId, stage, ts: now }, ...prev]
        .filter(w => now - (w.ts || 0) < TTL_7D)
        .slice(0, MAX_WORKFLOWS);
      _save(PDX_WORKFLOW_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1593: distribution event write ─────────────────────────────────
  const recordDistrib = useCallback((entry = {}) => {
    const { type, platform = "web" } = entry;
    if (!VALID_DISTRIB_TYPES.has(type)) return;
    const now = Date.now();
    setDistrib(prev => {
      const last = prev.find(d => d.type === type && d.platform === platform);
      if (last && now - (last.ts || 0) < 60_000) return prev;
      const next = [{ type, platform, ts: now }, ...prev]
        .filter(d => now - (d.ts || 0) < TTL_7D)
        .slice(0, MAX_DISTRIB);
      _save(PDX_DISTRIB_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1601: installer write ───────────────────────────────────────────
  const recordInstaller = useCallback((entry = {}) => {
    const { target, stage, version } = entry;
    if (!VALID_INSTALL_TARGETS.has(target) || !VALID_INSTALL_STAGES.includes(stage)) return;
    const now = Date.now();
    setInstallers(prev => {
      const idx = prev.findIndex(i => i.target === target);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_INSTALL_STAGES.indexOf(cur.stage);
        const newIdx = VALID_INSTALL_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, updatedAt: now, ...(version ? { version } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .slice(0, MAX_INSTALL);
        _save(PDX_INSTALLER_KEY, next);
        return next;
      }
      const next = [{ target, stage, ts: now, ...(version ? { version } : {}) }, ...prev]
        .slice(0, MAX_INSTALL);
      _save(PDX_INSTALLER_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1596: perf write ────────────────────────────────────────────────
  const recordPerf = useCallback((entry = {}) => {
    const { metric, value, platform = "web" } = entry;
    if (!metric || value === undefined) return;
    const now = Date.now();
    setPerf(prev => {
      const dedupKey = `${metric}:${platform}`;
      const last = prev.find(p => `${p.metric}:${p.platform}` === dedupKey);
      if (last && now - (last.ts || 0) < 60_000) return prev;
      const next = [{ metric, value, platform, ts: now }, ...prev]
        .filter(p => now - (p.ts || 0) < TTL_24H)
        .slice(0, MAX_PERF);
      _save(PDX_PERF_KEY, next);
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

  // ── Coarse dep-keys (Phase 1596) ─────────────────────────────────────────
  const sessionCount   = Math.floor(sessions.length   / 3);
  const onboardCount   = Math.floor(onboard.length    / 3);
  const notifCount     = Math.floor(notifs.length     / 5);
  const workflowCount  = Math.floor(workflows.length  / 3);
  const distribCount   = Math.floor(distrib.length    / 3);
  const installCount   = installers.length;

  const sessionScoreVal   = useMemo(() => _sessionScore(sessions),     [sessionCount]);   // eslint-disable-line
  const onboardScoreVal   = useMemo(() => _onboardScore(onboard),      [onboardCount]);   // eslint-disable-line
  const notifScoreVal     = useMemo(() => _notifScore(notifs),         [notifCount]);     // eslint-disable-line
  const workflowScoreVal  = useMemo(() => _workflowScore(workflows),   [workflowCount]);  // eslint-disable-line
  const distribScoreVal   = useMemo(() => _distribScore(distrib),      [distribCount]);   // eslint-disable-line
  const installerScoreVal = useMemo(() => _installerScore(installers), [installCount]);   // eslint-disable-line

  const pdxBar = useMemo(() => _cached("pdx_bar", () =>
    _computePDXBar({
      sessionScore: sessionScoreVal, onboardScore: onboardScoreVal,
      notifScore: notifScoreVal, workflowScore: workflowScoreVal,
      distribScore: distribScoreVal, installerScore: installerScoreVal,
      isoViolations: isoViolations.length,
    })
  ), [sessionScoreVal, onboardScoreVal, notifScoreVal, workflowScoreVal, distribScoreVal, installerScoreVal, isoViolations.length]);

  // Phase 1597: stress profile
  const stressProfile = useMemo(() => {
    const recovering    = sessions.filter(s => s.stage === "recovering").length;
    const stalledOnboard = onboard.filter(o => o.stage === "stalled").length;
    const failedWf      = workflows.filter(w => w.stage === "failed").length;
    const failedInstall = installers.filter(i => i.stage === "failed").length;
    return { recovering, stalledOnboard, failedWf, failedInstall };
  }, [sessionCount, onboardCount, workflowCount, installCount]); // eslint-disable-line

  // Phase 1598: product calmness
  const productCalmness = useMemo(() => {
    const critNotifs  = notifs.filter(n => n.level === "critical" && Date.now() - (n.ts || 0) < TTL_24H).length;
    const stalled     = onboard.filter(o => o.stage === "stalled").length;
    const score = Math.max(0, 100 - critNotifs * 15 - stalled * 10);
    return { score, label: score >= 80 ? "CALM" : score >= 60 ? "BUSY" : "OVERLOADED" };
  }, [notifCount, onboardCount]); // eslint-disable-line

  // Phase 1601-1602: installer status summary
  const installerStatus = useMemo(() => (
    ["mac", "windows", "linux", "web"].map(t => ({
      target:  t,
      stage:   installers.find(i => i.target === t)?.stage || "pending",
      version: installers.find(i => i.target === t)?.version || null,
    }))
  ), [installCount]); // eslint-disable-line

  return {
    pdxBar,
    pdxScore: pdxBar.score,
    sessionScore:   sessionScoreVal,
    onboardScore:   onboardScoreVal,
    notifScore:     notifScoreVal,
    workflowScore:  workflowScoreVal,
    distribScore:   distribScoreVal,
    installerScore: installerScoreVal,
    pdxIsoViolations: isoViolations,
    stressProfile,
    productCalmness,
    installerStatus,
    recordSession,
    recordOnboarding,
    recordNotif,
    recordWorkflow,
    recordDistrib,
    recordInstaller,
    recordPerf,
  };
}
