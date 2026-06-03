// Phases 1636-1650: Premium product experience + operational cockpit polish.
//
// Consolidates: stress-test audit (1643), performance/memory audit (1644),
// operational safety audit (1645), and desktop session quality (1646-1650).
// No external calls. No autonomous execution. localStorage-only.
// Bounded: 30 session snapshots, 24h TTL.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

const OPX_SESSION_KEY  = "jarvis_opx_session";
const OPX_PERF_KEY     = "jarvis_opx_perf";
const OPX_SAFETY_KEY   = "jarvis_opx_safety";
const OPX_SESSION_MAX  = 30;
const OPX_TTL          = 24 * 60 * 60 * 1000;

// ── Performance audit (Phase 1644) ───────────────────────────────────────────

function _runPerfAudit(sessionAgeMs) {
  const findings = [];

  // Listener leak proxy: track event listeners via localStorage marker
  try {
    const listenerCount = parseInt(localStorage.getItem("jarvis_opx_listener_count") || "0", 10);
    if (listenerCount > 80) findings.push({ id: "listener_leak", severity: "high", msg: `${listenerCount} active listeners (>80)` });
  } catch {}

  // Animation budget: sessions >2h should suppress non-critical animations
  const animationBudgetExhausted = sessionAgeMs > 2 * 60 * 60 * 1000;

  // Unbounded array check — spot-check key stores
  try {
    const notifs = JSON.parse(localStorage.getItem("jarvis_notifications") || "[]");
    if (notifs.length > 200) findings.push({ id: "notif_unbounded", severity: "medium", msg: `${notifs.length} notification entries (>200)` });
  } catch {}

  try {
    const friction = JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]");
    if (friction.length > 500) findings.push({ id: "friction_unbounded", severity: "medium", msg: `${friction.length} friction entries (>500)` });
  } catch {}

  // Memory estimate via localStorage size (bytes)
  let storageBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || "";
      storageBytes += k.length + (localStorage.getItem(k) || "").length;
    }
    if (storageBytes > 5 * 1024 * 1024) findings.push({ id: "storage_pressure", severity: "high", msg: `localStorage ${Math.round(storageBytes / 1024)}KB (>5MB)` });
  } catch {}

  const score = findings.length === 0 ? 100
    : findings.some(f => f.severity === "high") ? 55 : 78;

  return { ts: Date.now(), findings, score, animationBudgetExhausted, storageBytes };
}

// ── Safety audit (Phase 1645) ─────────────────────────────────────────────────

const OPX_SAFETY_RULES = [
  {
    id:    "no_unsafe_contextual_execution",
    label: "No unsafe contextual execution",
    check: () => ["jarvis_autonomous", "jarvis_auto_exec", "jarvis_opx_autonomous"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_hidden_runtime_escalation",
    label: "No hidden runtime escalation",
    check: () => ["jarvis_opx_auto_escalate", "jarvis_auto_opx_deploy", "jarvis_opx_exec_auto"]
      .every(k => localStorage.getItem(k) === null),
  },
  {
    id:    "no_stale_replay_restoration",
    label: "Stale replay restoration not active",
    check: () => {
      try {
        const ws = JSON.parse(localStorage.getItem("jarvis_operator_workspace") || "null");
        if (!ws?.savedAt) return true;
        return Date.now() - ws.savedAt < 48 * 60 * 60 * 1000;
      } catch { return true; }
    },
  },
  {
    id:    "no_connector_state_corruption",
    label: "No connector state corruption",
    check: () => {
      try {
        const isos = JSON.parse(localStorage.getItem("jarvis_opx_live_iso") || "[]");
        return isos.filter(v => Date.now() - (v.ts || 0) < 60 * 60 * 1000).length === 0;
      } catch { return true; }
    },
  },
  {
    id:    "no_duplicated_operational_contexts",
    label: "No duplicated operational contexts",
    check: () => {
      try {
        const sessions = JSON.parse(localStorage.getItem("jarvis_opx_session") || "[]");
        const activeIds = sessions.filter(s => s.status === "active").map(s => s.id);
        return activeIds.length === new Set(activeIds).size;
      } catch { return true; }
    },
  },
  {
    id:    "no_recursive_incident_escalation",
    label: "No recursive incident escalation",
    check: () => {
      try {
        const friction = JSON.parse(localStorage.getItem("jarvis_friction_signals") || "[]");
        const recent = friction.filter(f => Date.now() - (f.ts || 0) < 10 * 1000);
        return recent.length < 5;
      } catch { return true; }
    },
  },
  {
    id:    "operator_gate_respected",
    label: "Operator gate respected",
    check: () => {
      try {
        const executions = JSON.parse(localStorage.getItem("jarvis_executions") || "[]");
        const gated = executions.filter(e => e.requiresGate);
        return gated.every(e => e.operatorApproved || e.status !== "running");
      } catch { return true; }
    },
  },
];

function _runSafetyAudit() {
  const results = OPX_SAFETY_RULES.map(rule => ({
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

// ── Session quality snapshot (Phase 1643) ────────────────────────────────────

function _snapSession({ perfScore, safetyScore, sessionAgeMs, animationBudgetExhausted }) {
  const cockpitQuality = Math.round(
    safetyScore * 0.45 +
    perfScore   * 0.35 +
    (sessionAgeMs < 4 * 60 * 60 * 1000 ? 20 : 10) // age bonus
  );
  const score = Math.max(0, Math.min(100, cockpitQuality));
  return {
    score,
    label:    score >= 85 ? "EXCELLENT" : score >= 65 ? "GOOD" : "DEGRADED",
    color:    score >= 85 ? "var(--op-green)" : score >= 65 ? "var(--op-amber)" : "var(--op-red)",
    sessionAgeMs,
    animationBudgetExhausted,
    ts: Date.now(),
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

export function useOperatorPolish() {
  const sessionStartRef = useRef(Date.now());

  const [perfAudit,   setPerfAudit]   = useState(() => _load(OPX_PERF_KEY,    null));
  const [safetyAudit, setSafetyAudit] = useState(() => _load(OPX_SAFETY_KEY,  null));
  const [sessions,    setSessions]    = useState(() =>
    _load(OPX_SESSION_KEY, []).filter(s => Date.now() - (s.ts || 0) < OPX_TTL)
  );
  const [initialized, setInitialized] = useState(false);

  const evaluate = useCallback(() => {
    const now        = Date.now();
    const sessionAgeMs = now - sessionStartRef.current;

    const perf = _runPerfAudit(sessionAgeMs);
    setPerfAudit(perf);
    _save(OPX_PERF_KEY, perf);

    const safety = _runSafetyAudit();
    setSafetyAudit(safety);
    _save(OPX_SAFETY_KEY, safety);

    const snap = _snapSession({
      perfScore:   perf.score,
      safetyScore: safety.score,
      sessionAgeMs,
      animationBudgetExhausted: perf.animationBudgetExhausted,
    });

    setSessions(prev => {
      const next = [snap, ...prev]
        .filter(s => now - (s.ts || 0) < OPX_TTL)
        .slice(0, OPX_SESSION_MAX);
      _save(OPX_SESSION_KEY, next);
      return next;
    });

    // Apply animation budget class to body — cost-free once set
    if (perf.animationBudgetExhausted) {
      document.body.classList.add("op-animation-budget-exhausted");
    }
  }, []);

  useEffect(() => {
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  // Re-evaluate on visibility restore
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Hourly re-evaluate for long sessions
  useEffect(() => {
    const id = setInterval(evaluate, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [evaluate]);

  const latestSession = useMemo(() => sessions[0] || null, [sessions]);

  const sessionAgeMs = useMemo(() => Date.now() - sessionStartRef.current, []);

  const sessionAgeLabel = useMemo(() => {
    const h = Math.floor(sessionAgeMs / 3_600_000);
    const m = Math.floor((sessionAgeMs % 3_600_000) / 60_000);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }, [sessionAgeMs]);

  // Calm status bar pill — only visible when degraded
  const cockpitPill = useMemo(() => {
    if (!latestSession || latestSession.score >= 85) return null;
    return {
      label:  "COCKPIT",
      score:  latestSession.score,
      color:  latestSession.color,
      issue:  safetyAudit?.results.find(r => !r.passed)?.label || null,
    };
  }, [latestSession, safetyAudit]);

  // Safety status shorthand
  const allSafe = useMemo(() => safetyAudit?.allPassed ?? true, [safetyAudit]);

  return {
    initialized,
    perfAudit,
    safetyAudit,
    latestSession,
    sessionAgeMs,
    sessionAgeLabel,
    cockpitPill,
    allSafe,
    animationBudgetExhausted: perfAudit?.animationBudgetExhausted ?? false,
    evaluate,
  };
}
