// Phases 1561-1569 + 1572-1574: Electron desktop shell + operational cockpit —
// session durability, cockpit UI quality, observability, multi-window isolation,
// performance optimization, stress test, UX calmness, packaging readiness,
// platform validation, desktop operational maturity.
//
// Detects Electron context via window.electronAPI. Safe in web context.
// No external calls. No autonomous execution. localStorage-only.
// All arrays bounded. Privacy contract: no rawContent/commandOutput/userInput.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const ELD_SESSION_KEY  = "jarvis_eld_sessions";
const ELD_COCKPIT_KEY  = "jarvis_eld_cockpit";
const ELD_OBS_KEY      = "jarvis_eld_obs";
const ELD_WINDOW_KEY   = "jarvis_eld_windows";
const ELD_PERF_KEY     = "jarvis_eld_perf";
const ELD_PACKAGE_KEY  = "jarvis_eld_packaging";
const ELD_ISO_KEY      = "jarvis_eld_live_iso";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_7D  = 7  * 24 * 60 * 60 * 1000;

const MAX_SESSIONS  = 20;
const MAX_COCKPIT   = 20;
const MAX_OBS       = 30;
const MAX_WINDOWS   = 20;
const MAX_PERF      = 30;
const MAX_PACKAGING = 10;

// Phase 1563: desktop session stages (forward-only)
const VALID_SESSION_STAGES = [
  "started", "active", "long_running", "sleeping", "recovering", "terminated",
];

// Phase 1564: cockpit quality dimensions
const VALID_COCKPIT_DIMS = new Set([
  "workflow_visibility", "deployment_readability", "operational_priority",
  "ecosystem_nav", "contextual_focus", "indicator_calmness",
]);

// Phase 1565: observability metric types
const VALID_OBS_TYPES = new Set([
  "startup_ms", "load_ms", "memory_mb", "cpu_pct",
  "reconnect_count", "crash_count", "ipc_latency_ms",
]);

// Phase 1566: window states (forward-only)
const VALID_WINDOW_STAGES = ["created", "loaded", "active", "hidden", "closed"];

// Phase 1572: packaging targets
const VALID_PACKAGE_TARGETS = new Set(["mac", "windows", "linux"]);
const VALID_PACKAGE_STAGES  = ["pending", "building", "ready", "published", "failed"];

// ── Electron context detection (Phase 1562) ────────────────────────────────

function _isElectron() {
  return typeof window !== "undefined" && !!window.electronAPI;
}

// ── LRU cache (Phase 1567) ────────────────────────────────────────────────────

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

// ── Isolation scanner (Phase 1566) ───────────────────────────────────────────

const ELD_PREFIX = "jarvis_eld_";
const ELD_OWNED = new Set([
  ELD_SESSION_KEY, ELD_COCKPIT_KEY, ELD_OBS_KEY, ELD_WINDOW_KEY,
  ELD_PERF_KEY, ELD_PACKAGE_KEY, ELD_ISO_KEY,
]);

function _scanIso() {
  const unknown = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(ELD_PREFIX) && !ELD_OWNED.has(k)) unknown.push(k);
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

function _cockpitScore(cockpit) {
  if (!cockpit.length) return 100;
  const vals = cockpit.map(c => c.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

function _obsScore(obs) {
  if (!obs.length) return 100;
  const crashes = obs.filter(o => o.type === "crash_count" && (o.value || 0) > 0);
  if (crashes.length > 0) return 50;
  const reconnects = obs.filter(o => o.type === "reconnect_count" && (o.value || 0) > 3);
  if (reconnects.length > 0) return 70;
  return 100;
}

function _windowScore(windows) {
  if (!windows.length) return 100;
  const active = windows.filter(w => w.stage === "active").length;
  if (active > 10) return 60;
  return 100;
}

function _packageScore(packaging) {
  if (!packaging.length) return 100;
  const failed = packaging.filter(p => p.stage === "failed").length;
  if (failed > 0) return Math.max(0, 100 - failed * 25);
  return 100;
}

// ── Composite bar ─────────────────────────────────────────────────────────────

function _computeELDBar({
  sessionScore, cockpitScore, obsScore, windowScore, packageScore, isoViolations,
  isElectron,
}) {
  const score = Math.round(
    sessionScore  * 0.25 +
    cockpitScore  * 0.25 +
    obsScore      * 0.20 +
    windowScore   * 0.15 +
    packageScore  * 0.15
  ) - (isoViolations > 0 ? 15 : 0);

  const clamped = Math.max(0, Math.min(100, score));
  const hasCrit = isoViolations > 0 || obsScore < 50;
  const color = hasCrit ? "var(--op-red)" : clamped < 60 ? "var(--op-amber)" : "var(--op-green)";

  let issue = null;
  if (!isElectron)           issue = null; // web context — no bar needed
  else if (isoViolations > 0) issue = `ELD isolation: ${isoViolations} unknown keys`;
  else if (obsScore < 50)     issue = "Desktop crash/reconnect detected";
  else if (sessionScore < 60) issue = "Desktop session recovery elevated";
  else if (windowScore < 60)  issue = "Too many active windows";
  else if (cockpitScore < 60) issue = `Cockpit quality: ${cockpitScore}%`;

  return { score: clamped, hasCrit, color, issue, isElectron };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useElectronDesktop() {
  const isElectron = _isElectron();

  const [sessions,   setSessions]   = useState(() => _load(ELD_SESSION_KEY,  []));
  const [cockpit,    setCockpit]    = useState(() => _load(ELD_COCKPIT_KEY,  []));
  const [obs,        setObs]        = useState(() => _load(ELD_OBS_KEY,      []));
  const [windows,    setWindows]    = useState(() => _load(ELD_WINDOW_KEY,   []));
  const [perf,       setPerf]       = useState(() => _load(ELD_PERF_KEY,     []));
  const [packaging,  setPackaging]  = useState(() => _load(ELD_PACKAGE_KEY,  []));
  const [isoViolations, setIsoViolations] = useState([]);

  const _recentUpdates = useRef(new Map());
  function _burstGuard(id) {
    const now = Date.now();
    const recent = (_recentUpdates.current.get(id) || []).filter(t => now - t < 10_000);
    if (recent.length >= 3) return false;
    _recentUpdates.current.set(id, [...recent, now]);
    return true;
  }

  // ── Phase 1563: desktop session write ────────────────────────────────────
  const recordSession = useCallback((entry = {}) => {
    const { sessionId, stage, durationMs } = entry;
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
        const updated = { ...cur, stage, updatedAt: now, ...(durationMs ? { durationMs } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(s => now - (s.ts || 0) < TTL_7D)
          .slice(0, MAX_SESSIONS);
        _save(ELD_SESSION_KEY, next);
        return next;
      }
      const next = [{ sessionId, stage, ts: now, ...(durationMs ? { durationMs } : {}) }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SESSIONS);
      _save(ELD_SESSION_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1564: cockpit quality write ────────────────────────────────────
  const recordCockpit = useCallback((entry = {}) => {
    const { dim, score } = entry;
    if (!VALID_COCKPIT_DIMS.has(dim)) return;
    if (score !== undefined && (score < 0 || score > 100)) return;
    const now = Date.now();
    setCockpit(prev => {
      const last = prev.find(c => c.dim === dim);
      if (last && now - (last.ts || 0) < 5 * 60_000) return prev;
      const next = [{ dim, score: score ?? 100, ts: now }, ...prev]
        .filter(c => now - (c.ts || 0) < TTL_7D)
        .slice(0, MAX_COCKPIT);
      _save(ELD_COCKPIT_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1565: observability metric write ────────────────────────────────
  const recordObs = useCallback((entry = {}) => {
    const { type, value } = entry;
    if (!VALID_OBS_TYPES.has(type) || value === undefined) return;
    const now = Date.now();
    setObs(prev => {
      const last = prev.find(o => o.type === type);
      if (last && now - (last.ts || 0) < 30_000) return prev;
      const next = [{ type, value, ts: now }, ...prev]
        .filter(o => now - (o.ts || 0) < TTL_24H)
        .slice(0, MAX_OBS);
      _save(ELD_OBS_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1566: window state write ───────────────────────────────────────
  const recordWindow = useCallback((entry = {}) => {
    const { windowId, stage } = entry;
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
        const updated = { ...cur, stage, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(w => now - (w.ts || 0) < TTL_7D)
          .slice(0, MAX_WINDOWS);
        _save(ELD_WINDOW_KEY, next);
        return next;
      }
      const next = [{ windowId, stage, ts: now }, ...prev]
        .filter(w => now - (w.ts || 0) < TTL_7D)
        .slice(0, MAX_WINDOWS);
      _save(ELD_WINDOW_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1567: perf observation write ───────────────────────────────────
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
      _save(ELD_PERF_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1572: packaging status write ───────────────────────────────────
  const recordPackaging = useCallback((entry = {}) => {
    const { target, stage } = entry;
    if (!VALID_PACKAGE_TARGETS.has(target) || !VALID_PACKAGE_STAGES.includes(stage)) return;
    const now = Date.now();
    setPackaging(prev => {
      const idx = prev.findIndex(p => p.target === target);
      if (idx !== -1) {
        const updated = { ...prev[idx], stage, updatedAt: now };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .slice(0, MAX_PACKAGING);
        _save(ELD_PACKAGE_KEY, next);
        return next;
      }
      const next = [{ target, stage, ts: now }, ...prev].slice(0, MAX_PACKAGING);
      _save(ELD_PACKAGE_KEY, next);
      return next;
    });
  }, []);

  // ── Electron IPC bridge (Phase 1562) — listen for signals from main ──────
  useEffect(() => {
    if (!isElectron) return;
    const api = window.electronAPI;

    const onResume = (data) => {
      recordObs({ type: "reconnect_count", value: 1 });
      // record session recovery on wake from sleep
      if (data?.sleepDurationMs > 5 * 60_000) {
        setSessions(prev => {
          const active = prev.find(s => s.stage === "active" || s.stage === "long_running");
          if (!active) return prev;
          return prev.map(s =>
            s.sessionId === active.sessionId ? { ...s, stage: "recovering", updatedAt: Date.now() } : s
          );
        });
      }
    };

    const onLowMem = (data) => {
      if (data?.heapMb) recordObs({ type: "memory_mb", value: data.heapMb });
    };

    const onRestored = () => {
      setSessions(prev => prev.map(s =>
        s.stage === "sleeping" ? { ...s, stage: "recovering", updatedAt: Date.now() } : s
      ));
    };

    api.onSystemResume?.(onResume);
    api.onLowMemory?.(onLowMem);
    api.onWindowRestored?.(onRestored);

    return () => {
      api.removeSystemListeners?.();
      api.removeLowMemoryListener?.();
    };
  }, [isElectron, recordObs]);

  // ── Isolation scan ────────────────────────────────────────────────────────
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setIsoViolations(_scanIso());
    };
    setIsoViolations(_scanIso());
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // ── Coarse dep-keys (Phase 1567) ─────────────────────────────────────────
  const sessionCount  = Math.floor(sessions.length  / 3);
  const cockpitCount  = Math.floor(cockpit.length   / 3);
  const obsCount      = Math.floor(obs.length       / 5);
  const windowCount   = Math.floor(windows.length   / 3);
  const packageCount  = packaging.length;

  const sessionScoreVal  = useMemo(() => _sessionScore(sessions),   [sessionCount]);  // eslint-disable-line
  const cockpitScoreVal  = useMemo(() => _cockpitScore(cockpit),    [cockpitCount]);  // eslint-disable-line
  const obsScoreVal      = useMemo(() => _obsScore(obs),            [obsCount]);      // eslint-disable-line
  const windowScoreVal   = useMemo(() => _windowScore(windows),     [windowCount]);   // eslint-disable-line
  const packageScoreVal  = useMemo(() => _packageScore(packaging),  [packageCount]);  // eslint-disable-line

  const eldBar = useMemo(() => {
    if (!isElectron) return null;
    return _cached("eld_bar", () =>
      _computeELDBar({
        sessionScore: sessionScoreVal, cockpitScore: cockpitScoreVal,
        obsScore: obsScoreVal, windowScore: windowScoreVal,
        packageScore: packageScoreVal, isoViolations: isoViolations.length,
        isElectron,
      })
    );
  }, [sessionScoreVal, cockpitScoreVal, obsScoreVal, windowScoreVal, packageScoreVal, isoViolations.length, isElectron]);

  // Phase 1568: stress profile (observable, no side effects)
  const stressProfile = useMemo(() => {
    const recovering    = sessions.filter(s => s.stage === "recovering").length;
    const activeWindows = windows.filter(w => w.stage === "active").length;
    const crashes       = obs.filter(o => o.type === "crash_count" && o.value > 0).length;
    const failedPkg     = packaging.filter(p => p.stage === "failed").length;
    return { recovering, activeWindows, crashes, failedPkg };
  }, [sessionCount, windowCount, obsCount, packageCount]); // eslint-disable-line

  // Phase 1569: desktop UX calmness
  const desktopCalmness = useMemo(() => {
    if (!cockpit.length) return { score: 100, label: "CALM" };
    const recent = cockpit.filter(c => Date.now() - (c.ts || 0) < TTL_24H);
    if (!recent.length) return { score: 100, label: "CALM" };
    const avg = recent.reduce((a, c) => a + (c.score ?? 100), 0) / recent.length;
    const score = Math.round(avg);
    return { score, label: score >= 80 ? "CALM" : score >= 60 ? "BUSY" : "OVERLOADED" };
  }, [cockpitCount]); // eslint-disable-line

  // Phase 1573-1574: packaging readiness summary
  const packagingStatus = useMemo(() => {
    const targets = ["mac", "windows", "linux"];
    return targets.map(t => {
      const entry = packaging.find(p => p.target === t);
      return { target: t, stage: entry?.stage || "pending" };
    });
  }, [packageCount]); // eslint-disable-line

  return {
    isElectron,
    eldBar,
    eldScore: eldBar?.score ?? 100,
    sessionScore:  sessionScoreVal,
    cockpitScore:  cockpitScoreVal,
    obsScore:      obsScoreVal,
    windowScore:   windowScoreVal,
    packageScore:  packageScoreVal,
    eldIsoViolations: isoViolations,
    stressProfile,
    desktopCalmness,
    packagingStatus,
    recordSession,
    recordCockpit,
    recordObs,
    recordWindow,
    recordPerf,
    recordPackaging,
  };
}
