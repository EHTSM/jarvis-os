// Phase 969-970: Public API hardening + SaaS performance hardening.
// Execution endpoint boundaries, replay-safe API coordination,
// deployment API survivability, diagnostics export protection,
// operational trust enforcement, bounded caches, reconnect-safe optimization.
//
// Consolidates two phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 30 API events, 20 perf samples, 24h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const API_HARD_KEY = "jarvis_api_hardening";
const PERF_OPT_KEY = "jarvis_saas_perf";
const API_EVT_MAX  = 30;
const PERF_MAX     = 20;
const HARD_TTL     = 24 * 60 * 60 * 1000;

// ── Phase 969: API endpoint boundaries ───────────────────────────────────────

const ENDPOINT_LIMITS = {
  "/api/run":      { maxChain: 6, requireApproval: true,  blockRecursive: true },
  "/api/deploy":   { maxChain: 1, requireApproval: true,  blockRecursive: true },
  "/api/export":   { maxChain: 1, requireApproval: false, blockRecursive: false },
  "/api/replay":   { maxChain: 3, requireApproval: false, blockRecursive: true },
  "/api/diagnose": { maxChain: 1, requireApproval: false, blockRecursive: false },
};

// Trust progression levels for API access
const TRUST_LEVELS = {
  LOCKED:    { score: 0,  label: "LOCKED",    desc: "No API access — runtime unstable" },
  GUARDED:   { score: 40, label: "GUARDED",   desc: "Read-only + diagnostics" },
  RESTRICTED:{ score: 60, label: "RESTRICTED",desc: "Approved executions only" },
  TRUSTED:   { score: 80, label: "TRUSTED",   desc: "Full operator access" },
};

function _resolveApiTrust(trustScore) {
  if (trustScore >= 80) return TRUST_LEVELS.TRUSTED;
  if (trustScore >= 60) return TRUST_LEVELS.RESTRICTED;
  if (trustScore >= 40) return TRUST_LEVELS.GUARDED;
  return TRUST_LEVELS.LOCKED;
}

function _validateApiRequest(endpoint, meta = {}, trustScore = 100) {
  const limits    = ENDPOINT_LIMITS[endpoint];
  const apiTrust  = _resolveApiTrust(trustScore);
  const violations = [];

  if (apiTrust.score === 0) {
    violations.push("API access locked — runtime trust score too low");
    return { allowed: false, violations, apiTrust };
  }

  if (!limits) return { allowed: true, violations: [], apiTrust };

  if (limits.requireApproval && !meta.approved) {
    violations.push(`${endpoint} requires operator approval`);
  }
  if (limits.blockRecursive && meta.isRecursive) {
    violations.push(`Recursive execution blocked on ${endpoint}`);
  }
  if (limits.maxChain && (meta.chainDepth || 0) > limits.maxChain) {
    violations.push(`Chain depth ${meta.chainDepth} exceeds ${limits.maxChain} for ${endpoint}`);
  }
  if (endpoint === "/api/deploy" && trustScore < 60) {
    violations.push("Deploy API requires RESTRICTED trust or higher");
  }

  return { allowed: violations.length === 0, violations, apiTrust };
}

// ── Phase 970: SaaS performance hardening ────────────────────────────────────

function _samplePerfNow(label) {
  try {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      ts:        Date.now(),
      label:     label || "tick",
      domNodes:  document.querySelectorAll("*").length,
      heapMb:    performance?.memory?.usedJSHeapSize
                   ? Math.round(performance.memory.usedJSHeapSize / 1048576)
                   : null,
      perfNowMs: Math.round(performance.now()),
      navLoadMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
    };
  } catch { return { ts: Date.now(), label: label || "tick" }; }
}

function _summarizePerf(samples) {
  const valid = samples.filter(s => s.heapMb !== null);
  if (!valid.length) return null;
  const avgHeap = Math.round(valid.reduce((a, s) => a + s.heapMb, 0) / valid.length);
  const maxHeap = Math.max(...valid.map(s => s.heapMb));
  const avgDom  = Math.round(samples.reduce((a, s) => a + (s.domNodes || 0), 0) / samples.length);

  return {
    avgHeapMb: avgHeap,
    maxHeapMb: maxHeap,
    avgDomNodes: avgDom,
    sampleCount: samples.length,
    label: maxHeap > 200 ? "HIGH" : maxHeap > 100 ? "MODERATE" : "HEALTHY",
    color: maxHeap > 200 ? "var(--op-red)" : maxHeap > 100 ? "var(--op-amber)" : "var(--op-green)",
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

export function usePublicApiHardening({ trustScore = 100 } = {}) {
  const [apiEvents,    setApiEvents]    = useState([]);
  const [perfSamples,  setPerfSamples]  = useState([]);
  const [initialized,  setInitialized]  = useState(false);

  useEffect(() => {
    const cached = _load(API_HARD_KEY, null);
    if (cached?.events) setApiEvents(cached.events);
    setPerfSamples(_load(PERF_OPT_KEY, []));

    // Initial perf sample on mount
    const sample = _samplePerfNow("mount");
    setPerfSamples(prev => {
      const saved = _load(PERF_OPT_KEY, []);
      const next  = [sample, ...saved].slice(0, PERF_MAX);
      _save(PERF_OPT_KEY, next);
      return next;
    });

    setInitialized(true);
  }, []);

  // Re-sample perf on visibility restore
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const sample = _samplePerfNow("visibility_restore");
      setPerfSamples(prev => {
        const next = [sample, ...prev].slice(0, PERF_MAX);
        _save(PERF_OPT_KEY, next);
        return next;
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  // Validate an API request
  const validateApiRequest = useCallback((endpoint, meta = {}) => {
    const result = _validateApiRequest(endpoint, meta, trustScore);
    if (!result.allowed) {
      const entry = { endpoint, violations: result.violations, ts: Date.now() };
      setApiEvents(prev => {
        const next = [entry, ...prev].slice(0, API_EVT_MAX);
        _save(API_HARD_KEY, { events: next, ts: Date.now() });
        return next;
      });
    }
    return result;
  }, [trustScore]);

  // API trust level derived from runtime trust score
  const apiTrust = useMemo(() => _resolveApiTrust(trustScore), [trustScore]);

  // Perf summary
  const perfSummary = useMemo(() => _summarizePerf(perfSamples), [perfSamples]);

  // Recent blocked API events
  const blockedEvents = useMemo(() => {
    const now = Date.now();
    return apiEvents.filter(e => now - (e.ts || 0) < HARD_TTL);
  }, [apiEvents]);

  return {
    initialized,
    apiTrust,
    endpointLimits: ENDPOINT_LIMITS,
    blockedEvents,
    perfSamples,
    perfSummary,
    // Actions
    validateApiRequest,
  };
}
