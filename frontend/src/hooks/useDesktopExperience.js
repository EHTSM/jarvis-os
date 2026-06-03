// Phases 1576-1583 + 1586-1589: Desktop experience + production packaging —
// native UX, session persistence, multi-window productivity, notifications/alerts,
// system tray/background ops, performance optimization, stress test,
// UX calmness, packaging maturity, auto-update foundation,
// platform validation, desktop operational maturity.
//
// Electron context safe: graceful no-op when window.electronAPI absent.
// No external calls. No autonomous execution. localStorage-only.
// All arrays bounded. Privacy contract: no rawContent/commandOutput/userInput.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const DXP_SESSION_KEY  = "jarvis_dxp_sessions";
const DXP_WINDOW_KEY   = "jarvis_dxp_windows";
const DXP_NOTIF_KEY    = "jarvis_dxp_notifications";
const DXP_TRAY_KEY     = "jarvis_dxp_tray";
const DXP_PACKAGE_KEY  = "jarvis_dxp_packaging";
const DXP_UPDATE_KEY   = "jarvis_dxp_updates";
const DXP_PERF_KEY     = "jarvis_dxp_perf";
const DXP_ISO_KEY      = "jarvis_dxp_live_iso";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_7D  = 7  * 24 * 60 * 60 * 1000;

const MAX_SESSIONS = 20;
const MAX_WINDOWS  = 20;
const MAX_NOTIFS   = 30;
const MAX_TRAY     = 20;
const MAX_PACKAGES = 10;
const MAX_UPDATES  = 10;
const MAX_PERF     = 30;

// Phase 1577: session persistence stages (forward-only)
const VALID_SESSION_STAGES = [
  "started", "active", "long_running", "persisted", "recovering", "restored", "terminated",
];

// Phase 1578: window stages (forward-only)
const VALID_WINDOW_STAGES = ["created", "loading", "active", "hidden", "closed"];

// Phase 1579: notification severity levels
const VALID_NOTIF_LEVELS = new Set(["info", "warning", "critical", "resolved"]);

// Phase 1580: tray operation types
const VALID_TRAY_TYPES = new Set([
  "background_sync", "health_check", "deployment_watch",
  "incident_watch", "idle", "reconnecting",
]);

// Phase 1586: packaging targets + stages
const VALID_PKG_TARGETS = new Set(["mac", "windows", "linux"]);
const VALID_PKG_STAGES  = ["pending", "building", "signing", "ready", "published", "failed"];

// Phase 1587: update stages (forward-only)
const VALID_UPDATE_STAGES = [
  "checking", "available", "downloading", "ready", "installing", "complete", "failed",
];

// ── Electron context ──────────────────────────────────────────────────────────

function _isElectron() {
  return typeof window !== "undefined" && !!window.electronAPI;
}

// ── LRU cache (Phase 1581) ────────────────────────────────────────────────────

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

// ── Isolation scanner (Phase 1578) ───────────────────────────────────────────

const DXP_PREFIX = "jarvis_dxp_";
const DXP_OWNED = new Set([
  DXP_SESSION_KEY, DXP_WINDOW_KEY, DXP_NOTIF_KEY, DXP_TRAY_KEY,
  DXP_PACKAGE_KEY, DXP_UPDATE_KEY, DXP_PERF_KEY, DXP_ISO_KEY,
]);

function _scanIso() {
  const unknown = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DXP_PREFIX) && !DXP_OWNED.has(k)) unknown.push(k);
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

function _windowScore(windows) {
  if (!windows.length) return 100;
  const active = windows.filter(w => w.stage === "active").length;
  if (active > 12) return 50;
  if (active > 8)  return 75;
  return 100;
}

function _notifScore(notifs) {
  if (!notifs.length) return 100;
  const now = Date.now();
  const recent  = notifs.filter(n => now - (n.ts || 0) < 60_000);
  if (recent.length > 10) return 40; // alert flood
  const critical = notifs.filter(n => n.level === "critical" && n.level !== "resolved");
  if (critical.length > 0) return Math.max(40, 100 - critical.length * 20);
  return 100;
}

function _trayScore(tray) {
  if (!tray.length) return 100;
  const reconnecting = tray.filter(t => t.type === "reconnecting").length;
  if (reconnecting > 3) return 50;
  return 100;
}

function _packageScore(pkg) {
  if (!pkg.length) return 100;
  const failed = pkg.filter(p => p.stage === "failed").length;
  if (failed > 0) return Math.max(0, 100 - failed * 25);
  return 100;
}

function _updateScore(updates) {
  if (!updates.length) return 100;
  const failed = updates.filter(u => u.stage === "failed").length;
  if (failed > 0) return 50;
  return 100;
}

// ── Composite bar ─────────────────────────────────────────────────────────────

function _computeDXPBar({
  sessionScore, windowScore, notifScore, trayScore,
  packageScore, updateScore, isoViolations,
}) {
  const score = Math.round(
    sessionScore * 0.25 +
    notifScore   * 0.20 +
    windowScore  * 0.20 +
    trayScore    * 0.15 +
    packageScore * 0.10 +
    updateScore  * 0.10
  ) - (isoViolations > 0 ? 15 : 0);

  const clamped = Math.max(0, Math.min(100, score));
  const hasCrit = isoViolations > 0 || notifScore < 40;
  const color = hasCrit ? "var(--op-red)" : clamped < 60 ? "var(--op-amber)" : "var(--op-green)";

  let issue = null;
  if (isoViolations > 0)  issue = `DXP isolation: ${isoViolations} unknown keys`;
  else if (notifScore < 40) issue = "Desktop alert flood";
  else if (sessionScore < 60) issue = "Desktop session recovery elevated";
  else if (packageScore < 60) issue = "Packaging build failures";
  else if (updateScore < 60)  issue = "Auto-update failure";
  else if (windowScore < 60)  issue = "Window saturation";

  return { score: clamped, hasCrit, color, issue };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useDesktopExperience() {
  const isElectron = _isElectron();

  const [sessions,  setSessions]  = useState(() => _load(DXP_SESSION_KEY,  []));
  const [windows,   setWindows]   = useState(() => _load(DXP_WINDOW_KEY,   []));
  const [notifs,    setNotifs]    = useState(() => _load(DXP_NOTIF_KEY,    []));
  const [tray,      setTray]      = useState(() => _load(DXP_TRAY_KEY,     []));
  const [packaging, setPackaging] = useState(() => _load(DXP_PACKAGE_KEY,  []));
  const [updates,   setUpdates]   = useState(() => _load(DXP_UPDATE_KEY,   []));
  const [perf,      setPerf]      = useState(() => _load(DXP_PERF_KEY,     []));
  const [isoViolations, setIsoViolations] = useState([]);

  const _recentUpdates = useRef(new Map());
  function _burstGuard(id) {
    const now = Date.now();
    const recent = (_recentUpdates.current.get(id) || []).filter(t => now - t < 10_000);
    if (recent.length >= 3) return false;
    _recentUpdates.current.set(id, [...recent, now]);
    return true;
  }

  // ── Phase 1576-1577: session persistence write ────────────────────────────
  const recordSession = useCallback((entry = {}) => {
    const { sessionId, stage, workspaceId } = entry;
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
        const updated = { ...cur, stage, updatedAt: now, ...(workspaceId ? { workspaceId } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(s => now - (s.ts || 0) < TTL_7D)
          .slice(0, MAX_SESSIONS);
        _save(DXP_SESSION_KEY, next);
        return next;
      }
      const next = [{ sessionId, stage, ts: now, ...(workspaceId ? { workspaceId } : {}) }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SESSIONS);
      _save(DXP_SESSION_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1578: multi-window write ───────────────────────────────────────
  const recordWindow = useCallback((entry = {}) => {
    const { windowId, stage, workflowId } = entry;
    if (!windowId || !VALID_WINDOW_STAGES.includes(stage)) return;
    if (!_burstGuard(`window:${windowId}`)) return;
    const now = Date.now();
    setWindows(prev => {
      const idx = prev.findIndex(w => w.windowId === windowId);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_WINDOW_STAGES.indexOf(cur.stage);
        const newIdx = VALID_WINDOW_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, updatedAt: now, ...(workflowId ? { workflowId } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(w => now - (w.ts || 0) < TTL_7D)
          .slice(0, MAX_WINDOWS);
        _save(DXP_WINDOW_KEY, next);
        return next;
      }
      const next = [{ windowId, stage, ts: now, ...(workflowId ? { workflowId } : {}) }, ...prev]
        .filter(w => now - (w.ts || 0) < TTL_7D)
        .slice(0, MAX_WINDOWS);
      _save(DXP_WINDOW_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1579: notification write (dedup + flood guard) ─────────────────
  const recordNotif = useCallback((entry = {}) => {
    const { notifId, level, title } = entry;
    if (!notifId || !VALID_NOTIF_LEVELS.has(level)) return;
    const now = Date.now();
    setNotifs(prev => {
      // flood guard: cap at 10 new notifs per 60s window
      const recent = prev.filter(n => now - (n.ts || 0) < 60_000);
      if (recent.length >= 10 && level !== "critical") return prev;
      // dedup
      if (prev.find(n => n.notifId === notifId)) return prev;
      const next = [{ notifId, level, title: title || "", ts: now }, ...prev]
        .filter(n => now - (n.ts || 0) < TTL_24H)
        .slice(0, MAX_NOTIFS);
      _save(DXP_NOTIF_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1580: tray operation write ─────────────────────────────────────
  const recordTray = useCallback((entry = {}) => {
    const { type } = entry;
    if (!VALID_TRAY_TYPES.has(type)) return;
    const now = Date.now();
    setTray(prev => {
      const last = prev.find(t => t.type === type);
      if (last && now - (last.ts || 0) < 30_000) return prev;
      const next = [{ type, ts: now }, ...prev]
        .filter(t => now - (t.ts || 0) < TTL_24H)
        .slice(0, MAX_TRAY);
      _save(DXP_TRAY_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1581: perf write ────────────────────────────────────────────────
  const recordPerf = useCallback((entry = {}) => {
    const { metric, value } = entry;
    if (!metric || value === undefined) return;
    const now = Date.now();
    setPerf(prev => {
      const last = prev.find(p => p.metric === metric);
      if (last && now - (last.ts || 0) < 60_000) return prev;
      const next = [{ metric, value, ts: now }, ...prev]
        .filter(p => now - (p.ts || 0) < TTL_24H)
        .slice(0, MAX_PERF);
      _save(DXP_PERF_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1586: packaging write ───────────────────────────────────────────
  const recordPackaging = useCallback((entry = {}) => {
    const { target, stage, version } = entry;
    if (!VALID_PKG_TARGETS.has(target) || !VALID_PKG_STAGES.includes(stage)) return;
    const now = Date.now();
    setPackaging(prev => {
      const idx = prev.findIndex(p => p.target === target);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_PKG_STAGES.indexOf(cur.stage);
        const newIdx = VALID_PKG_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, updatedAt: now, ...(version ? { version } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .slice(0, MAX_PACKAGES);
        _save(DXP_PACKAGE_KEY, next);
        return next;
      }
      const next = [{ target, stage, ts: now, ...(version ? { version } : {}) }, ...prev]
        .slice(0, MAX_PACKAGES);
      _save(DXP_PACKAGE_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1587: auto-update write (forward-only) ──────────────────────────
  const recordUpdate = useCallback((entry = {}) => {
    const { version, stage } = entry;
    if (!version || !VALID_UPDATE_STAGES.includes(stage)) return;
    const now = Date.now();
    setUpdates(prev => {
      const idx = prev.findIndex(u => u.version === version);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_UPDATE_STAGES.indexOf(cur.stage);
        const newIdx = VALID_UPDATE_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .slice(0, MAX_UPDATES);
        _save(DXP_UPDATE_KEY, next);
        return next;
      }
      const next = [{ version, stage, ts: now }, ...prev].slice(0, MAX_UPDATES);
      _save(DXP_UPDATE_KEY, next);
      return next;
    });
  }, []);

  // ── Electron IPC bridge — system events ──────────────────────────────────
  useEffect(() => {
    if (!isElectron) return;
    const api = window.electronAPI;

    const onResume = () => recordTray({ type: "reconnecting" });
    const onRestored = () => {
      setSessions(prev => prev.map(s =>
        s.stage === "persisted" ? { ...s, stage: "recovering", updatedAt: Date.now() } : s
      ));
    };

    api.onSystemResume?.(onResume);
    api.onWindowRestored?.(onRestored);
    return () => api.removeSystemListeners?.();
  }, [isElectron, recordTray]);

  // ── Isolation scan ────────────────────────────────────────────────────────
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setIsoViolations(_scanIso());
    };
    setIsoViolations(_scanIso());
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── Coarse dep-keys (Phase 1581) ─────────────────────────────────────────
  const sessionCount = Math.floor(sessions.length  / 3);
  const windowCount  = Math.floor(windows.length   / 3);
  const notifCount   = Math.floor(notifs.length    / 5);
  const trayCount    = Math.floor(tray.length      / 3);
  const pkgCount     = packaging.length;
  const updateCount  = updates.length;

  const sessionScoreVal = useMemo(() => _sessionScore(sessions),   [sessionCount]); // eslint-disable-line
  const windowScoreVal  = useMemo(() => _windowScore(windows),     [windowCount]);  // eslint-disable-line
  const notifScoreVal   = useMemo(() => _notifScore(notifs),       [notifCount]);   // eslint-disable-line
  const trayScoreVal    = useMemo(() => _trayScore(tray),          [trayCount]);    // eslint-disable-line
  const pkgScoreVal     = useMemo(() => _packageScore(packaging),  [pkgCount]);     // eslint-disable-line
  const updateScoreVal  = useMemo(() => _updateScore(updates),     [updateCount]);  // eslint-disable-line

  const dxpBar = useMemo(() => {
    if (!isElectron) return null;
    return _cached("dxp_bar", () =>
      _computeDXPBar({
        sessionScore: sessionScoreVal, windowScore: windowScoreVal,
        notifScore: notifScoreVal, trayScore: trayScoreVal,
        packageScore: pkgScoreVal, updateScore: updateScoreVal,
        isoViolations: isoViolations.length,
      })
    );
  }, [sessionScoreVal, windowScoreVal, notifScoreVal, trayScoreVal, pkgScoreVal, updateScoreVal, isoViolations.length, isElectron]);

  // Phase 1582: stress profile
  const stressProfile = useMemo(() => {
    const recovering    = sessions.filter(s => s.stage === "recovering").length;
    const activeWindows = windows.filter(w => w.stage === "active").length;
    const critNotifs    = notifs.filter(n => n.level === "critical").length;
    const failedPkg     = packaging.filter(p => p.stage === "failed").length;
    return { recovering, activeWindows, critNotifs, failedPkg };
  }, [sessionCount, windowCount, notifCount, pkgCount]); // eslint-disable-line

  // Phase 1583: desktop calmness
  const desktopCalmness = useMemo(() => {
    const critCount = notifs.filter(n => n.level === "critical" && Date.now() - (n.ts || 0) < TTL_24H).length;
    const recovering = sessions.filter(s => s.stage === "recovering").length;
    const score = Math.max(0, 100 - critCount * 15 - recovering * 10);
    return { score, label: score >= 80 ? "CALM" : score >= 60 ? "BUSY" : "OVERLOADED" };
  }, [notifCount, sessionCount]); // eslint-disable-line

  // Phase 1586-1587: packaging + update status summaries
  const packagingStatus = useMemo(() => (
    ["mac", "windows", "linux"].map(t => ({
      target: t,
      stage: packaging.find(p => p.target === t)?.stage || "pending",
      version: packaging.find(p => p.target === t)?.version || null,
    }))
  ), [pkgCount]); // eslint-disable-line

  const updateStatus = useMemo(() => {
    if (!updates.length) return null;
    return updates.sort((a, b) => b.ts - a.ts)[0];
  }, [updateCount]); // eslint-disable-line

  return {
    isElectron,
    dxpBar,
    dxpScore: dxpBar?.score ?? 100,
    sessionScore:  sessionScoreVal,
    windowScore:   windowScoreVal,
    notifScore:    notifScoreVal,
    trayScore:     trayScoreVal,
    packageScore:  pkgScoreVal,
    updateScore:   updateScoreVal,
    dxpIsoViolations: isoViolations,
    stressProfile,
    desktopCalmness,
    packagingStatus,
    updateStatus,
    recordSession,
    recordWindow,
    recordNotif,
    recordTray,
    recordPerf,
    recordPackaging,
    recordUpdate,
  };
}
