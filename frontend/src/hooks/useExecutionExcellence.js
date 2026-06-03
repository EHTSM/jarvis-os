// Phase 1306-1314: Platform polish + execution excellence.
//
// Consolidates nine phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const SMOOTHNESS_KEY  = "jarvis_exec_smoothness";
const MEMORY_KEY      = "jarvis_memory_efficiency";
const RENDER_KEY      = "jarvis_render_discipline";
const CONSISTENCY_KEY = "jarvis_exec_consistency";
const MATURITY_KEY    = "jarvis_platform_maturity";

const SMOOTHNESS_MAX  = 20;
const MEMORY_MAX      = 20;
const RENDER_MAX      = 20;
const CONSISTENCY_MAX = 20;
const MATURITY_MAX    = 20;

const SMOOTHNESS_TTL  = 24 * 60 * 60 * 1000;
const MEMORY_TTL      = 24 * 60 * 60 * 1000;
const RENDER_TTL      = 24 * 60 * 60 * 1000;
const CONSISTENCY_TTL = 24 * 60 * 60 * 1000;
const MATURITY_TTL    = 7  * 24 * 60 * 60 * 1000;

const VALID_SMOOTHNESS_DIMS  = ["workflow", "replay", "deployment", "runtime", "trust", "durability"];
const VALID_MEMORY_EVENTS    = ["cache_hit", "cache_eviction", "hydration_complete", "cleanup_executed", "stale_cleared"];
const VALID_RENDER_EVENTS    = ["rerender_avoided", "listener_cleaned", "dedup_applied", "batch_rendered"];
const VALID_CONSISTENCY_DIMS = ["replay_quality", "deploy_consistency", "responsiveness", "workflow_durability", "infra_stability"];

// ── Module-level LRU cache (30s TTL, 50-entry cap) ───────────────────────────

const _cache = new Map();
const CACHE_TTL = 30 * 1000;
const CACHE_MAX = 50;

function _cacheGet(key) {
  const e = _cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CACHE_TTL) { _cache.delete(key); return null; }
  return e.val;
}
function _cacheSet(key, val) {
  if (_cache.size >= CACHE_MAX) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(key, { val, ts: Date.now() });
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

// ── Phase 1306/1307: Runtime simplification + operator UX ────────────────────
// Pure derivations — no side effects. Applied by callers via smoothness scoring.

function _deriveUxCalmness({ activeBarCount, activeIncidents, critThreats, activeRecoveries }) {
  // Operator fatigue score: fewer bars + no crits = calmer UX
  const fatigue = Math.min(100,
    activeBarCount * 5 +
    critThreats    * 20 +
    activeIncidents * 3 +
    activeRecoveries * 8
  );
  return Math.max(0, 100 - fatigue);
}

// ── Phase 1308/1309: Performance + workflow smoothness ────────────────────────

function _recordSmoothnessSignal(signal) {
  if (!signal?.dim || !VALID_SMOOTHNESS_DIMS.includes(signal.dim)) return;
  if (signal.rawContent || signal.commandOutput) return; // privacy

  const now  = Date.now();
  const list = _load(SMOOTHNESS_KEY, []).filter(s => now - (s.ts || 0) < SMOOTHNESS_TTL);
  // Dedup same dim within 2min
  if (list.find(s => s.dim === signal.dim && now - (s.ts || 0) < 2 * 60 * 1000)) return;

  const next = [{ dim: signal.dim, score: signal.score ?? 100, ts: now }, ...list]
    .slice(0, SMOOTHNESS_MAX);
  _save(SMOOTHNESS_KEY, next);
}

function _scoreSmoothnessAgg(signals) {
  const cached = _cacheGet("smoothness_agg");
  if (cached) return cached;

  const now    = Date.now();
  const recent = signals.filter(s => now - (s.ts || 0) < 24 * 60 * 60 * 1000);
  const agg    = {};
  VALID_SMOOTHNESS_DIMS.forEach(dim => {
    const s = recent.filter(x => x.dim === dim);
    agg[dim] = s.length ? Math.round(s.reduce((sum, x) => sum + (x.score || 0), 0) / s.length) : null;
  });
  const filled    = Object.values(agg).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length) : 100;
  const result = { dims: agg, composite };
  _cacheSet("smoothness_agg", result);
  return result;
}

// ── Phase 1310: Memory efficiency system ──────────────────────────────────────

function _recordMemoryEvent(event) {
  if (!event?.type || !VALID_MEMORY_EVENTS.includes(event.type)) return;
  const now  = Date.now();
  const list = _load(MEMORY_KEY, []).filter(e => now - (e.ts || 0) < MEMORY_TTL);
  // Dedup same type within 30s
  if (list.find(e => e.type === event.type && now - (e.ts || 0) < 30 * 1000)) return;
  const next = [{ type: event.type, ts: now }, ...list].slice(0, MEMORY_MAX);
  _save(MEMORY_KEY, next);
}

function _scoreMemoryEfficiency(events) {
  const cached = _cacheGet("memory_eff");
  if (cached) return cached;

  const now    = Date.now();
  const recent = events.filter(e => now - (e.ts || 0) < 24 * 60 * 60 * 1000);
  if (!recent.length) { _cacheSet("memory_eff", 100); return 100; }

  const hits     = recent.filter(e => e.type === "cache_hit").length;
  const evictions = recent.filter(e => e.type === "cache_eviction").length;
  const cleanups = recent.filter(e => ["cleanup_executed", "stale_cleared"].includes(e.type)).length;
  const total    = recent.length;
  const score    = Math.min(100, Math.round(
    (hits / total) * 40 + (cleanups / total) * 30 + Math.max(0, 30 - (evictions / total) * 30)
  ));
  _cacheSet("memory_eff", score);
  return score;
}

// ── Phase 1311: Rendering discipline ──────────────────────────────────────────

function _recordRenderEvent(event) {
  if (!event?.type || !VALID_RENDER_EVENTS.includes(event.type)) return;
  const now  = Date.now();
  const list = _load(RENDER_KEY, []).filter(e => now - (e.ts || 0) < RENDER_TTL);
  // Dedup same type within 10s
  if (list.find(e => e.type === event.type && now - (e.ts || 0) < 10 * 1000)) return;
  const next = [{ type: event.type, ts: now }, ...list].slice(0, RENDER_MAX);
  _save(RENDER_KEY, next);
}

function _scoreRenderDiscipline(events) {
  const cached = _cacheGet("render_disc");
  if (cached) return cached;

  const now    = Date.now();
  const recent = events.filter(e => now - (e.ts || 0) < 24 * 60 * 60 * 1000);
  if (!recent.length) { _cacheSet("render_disc", 100); return 100; }

  const types  = new Set(recent.map(e => e.type));
  const score  = Math.round((types.size / VALID_RENDER_EVENTS.length) * 100);
  _cacheSet("render_disc", score);
  return score;
}

// ── Phase 1312: Execution consistency intelligence ────────────────────────────

function _recordConsistencySignal(signal) {
  if (!signal?.dim || !VALID_CONSISTENCY_DIMS.includes(signal.dim)) return;
  if (signal.rawContent || signal.commandOutput) return; // privacy

  const now  = Date.now();
  const list = _load(CONSISTENCY_KEY, []).filter(s => now - (s.ts || 0) < CONSISTENCY_TTL);
  // Dedup same dim within 5min
  if (list.find(s => s.dim === signal.dim && now - (s.ts || 0) < 5 * 60 * 1000)) return;
  const next = [{ dim: signal.dim, score: signal.score ?? 100, ts: now }, ...list]
    .slice(0, CONSISTENCY_MAX);
  _save(CONSISTENCY_KEY, next);
}

function _scoreConsistency(signals) {
  const cached = _cacheGet("consistency");
  if (cached) return cached;

  const now    = Date.now();
  const recent = signals.filter(s => now - (s.ts || 0) < 24 * 60 * 60 * 1000);
  const agg    = {};
  VALID_CONSISTENCY_DIMS.forEach(dim => {
    const s = recent.filter(x => x.dim === dim);
    agg[dim] = s.length ? Math.round(s.reduce((sum, x) => sum + (x.score || 0), 0) / s.length) : null;
  });
  const filled    = Object.values(agg).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length) : 100;
  const result = { dims: agg, composite };
  _cacheSet("consistency", result);
  return result;
}

// ── Phase 1313/1314: Stress + platform calmness ───────────────────────────────

function _computePlatformMaturity({
  smoothnessScore, memoryScore, renderScore, consistencyScore,
  uxCalmness, jarvisKeyCount, totalStorageBytes,
}) {
  const now = Date.now();
  // Storage health: penalize if approaching limits
  const storageHealth = totalStorageBytes < 800_000 ? 100
    : totalStorageBytes < 1_200_000 ? 80
    : totalStorageBytes < 1_600_000 ? 60 : 40;

  const keyHealth = jarvisKeyCount < 100 ? 100
    : jarvisKeyCount < 150 ? 85
    : jarvisKeyCount < 200 ? 70
    : jarvisKeyCount < 250 ? 55 : 40;

  const score = Math.max(0, Math.min(100, Math.round(
    smoothnessScore  * 0.25 +
    consistencyScore * 0.20 +
    uxCalmness       * 0.20 +
    memoryScore      * 0.15 +
    renderScore      * 0.10 +
    storageHealth    * 0.05 +
    keyHealth        * 0.05
  )));

  const label = score >= 85 ? "WORLD_CLASS" : score >= 70 ? "EXCELLENT" : score >= 55 ? "GOOD" : "DEVELOPING";
  const snap  = { score, label, storageHealth, keyHealth, ts: now };
  const prev  = _load(MATURITY_KEY, []).filter(s => now - (s.ts || 0) < MATURITY_TTL);
  _save(MATURITY_KEY, [snap, ...prev].slice(0, MATURITY_MAX));
  return snap;
}

// ── Composite excellence score + calm bar ─────────────────────────────────────

function _buildExcellenceBar({ maturityScore, maturityLabel, uxCalmness, memoryScore }) {
  // Only show when execution quality is genuinely degraded — highest calm bar threshold
  if (maturityScore >= 85 && uxCalmness >= 80 && memoryScore >= 80) return null;

  const topIssue = uxCalmness < 50
    ? "High operator fatigue detected"
    : memoryScore < 50
      ? "Memory efficiency degraded"
      : maturityScore < 55
        ? `Platform maturity: ${maturityLabel}`
        : null;

  return {
    label:  "EXECUTION",
    score:  maturityScore,
    color:  maturityScore >= 85 ? "var(--op-green)"
          : maturityScore >= 70 ? "var(--op-amber)" : "var(--op-red)",
    issue:  topIssue,
  };
}

// ── localStorage scan (bounded, cached) ──────────────────────────────────────

function _scanStorageMetrics() {
  const cached = _cacheGet("storage_metrics");
  if (cached) return cached;

  let jarvisKeyCount  = 0;
  let totalBytes      = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || "";
      totalBytes += k.length + v.length;
      if (k?.startsWith("jarvis_")) jarvisKeyCount++;
    }
  } catch {}

  const result = { jarvisKeyCount, totalBytes };
  _cacheSet("storage_metrics", result);
  return result;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useExecutionExcellence({
  activeBarCount    = 0,
  activeIncidents   = 0,
  critThreats       = 0,
  activeRecoveries  = 0,
} = {}) {
  const [smoothnessSigs,  setSmoothnesssSigs]  = useState([]);
  const [memoryEvents,    setMemoryEvents]    = useState([]);
  const [renderEvents,    setRenderEvents]    = useState([]);
  const [consistencySigs, setConsistencySigs] = useState([]);
  const [maturitySnap,    setMaturitySnap]    = useState(null);
  const [initialized,     setInitialized]     = useState(false);

  const evaluate = useCallback(() => {
    const now = Date.now();
    const loadedSmooth = _load(SMOOTHNESS_KEY, []).filter(s => now - (s.ts || 0) < SMOOTHNESS_TTL).slice(0, SMOOTHNESS_MAX);
    const loadedMem    = _load(MEMORY_KEY,     []).filter(e => now - (e.ts || 0) < MEMORY_TTL).slice(0,     MEMORY_MAX);
    const loadedRender = _load(RENDER_KEY,     []).filter(e => now - (e.ts || 0) < RENDER_TTL).slice(0,     RENDER_MAX);
    const loadedCons   = _load(CONSISTENCY_KEY,[]).filter(s => now - (s.ts || 0) < CONSISTENCY_TTL).slice(0,CONSISTENCY_MAX);

    setSmoothnesssSigs(loadedSmooth);
    setMemoryEvents(loadedMem);
    setRenderEvents(loadedRender);
    setConsistencySigs(loadedCons);

    const { jarvisKeyCount, totalBytes } = _scanStorageMetrics();
    const smoothAgg     = _scoreSmoothnessAgg(loadedSmooth);
    const memScore      = _scoreMemoryEfficiency(loadedMem);
    const renderScore   = _scoreRenderDiscipline(loadedRender);
    const consScore     = _scoreConsistency(loadedCons);
    const uxCalm        = _deriveUxCalmness({ activeBarCount, activeIncidents, critThreats, activeRecoveries });

    const snap = _computePlatformMaturity({
      smoothnessScore:  smoothAgg.composite,
      memoryScore:      memScore,
      renderScore,
      consistencyScore: consScore.composite,
      uxCalmness:       uxCalm,
      jarvisKeyCount,
      totalStorageBytes: totalBytes,
    });
    setMaturitySnap(snap);
  }, [activeBarCount, activeIncidents, critThreats, activeRecoveries]);

  useEffect(() => {
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  const recordSmoothnessSignal = useCallback((s) => {
    _recordSmoothnessSignal(s);
    const now = Date.now();
    setSmoothnesssSigs(_load(SMOOTHNESS_KEY, []).filter(x => now - (x.ts||0) < SMOOTHNESS_TTL).slice(0, SMOOTHNESS_MAX));
  }, []);

  const recordMemoryEvent = useCallback((e) => {
    _recordMemoryEvent(e);
    const now = Date.now();
    setMemoryEvents(_load(MEMORY_KEY, []).filter(x => now - (x.ts||0) < MEMORY_TTL).slice(0, MEMORY_MAX));
  }, []);

  const recordRenderEvent = useCallback((e) => {
    _recordRenderEvent(e);
    const now = Date.now();
    setRenderEvents(_load(RENDER_KEY, []).filter(x => now - (x.ts||0) < RENDER_TTL).slice(0, RENDER_MAX));
  }, []);

  const recordConsistencySignal = useCallback((s) => {
    _recordConsistencySignal(s);
    const now = Date.now();
    setConsistencySigs(_load(CONSISTENCY_KEY, []).filter(x => now - (x.ts||0) < CONSISTENCY_TTL).slice(0, CONSISTENCY_MAX));
  }, []);

  const smoothnessAgg   = useMemo(() => _scoreSmoothnessAgg(smoothnessSigs),  [smoothnessSigs]);
  const memoryScore     = useMemo(() => _scoreMemoryEfficiency(memoryEvents),  [memoryEvents]);
  const renderScore     = useMemo(() => _scoreRenderDiscipline(renderEvents),  [renderEvents]);
  const consistencyAgg  = useMemo(() => _scoreConsistency(consistencySigs),    [consistencySigs]);

  const uxCalmness = useMemo(
    () => _deriveUxCalmness({ activeBarCount, activeIncidents, critThreats, activeRecoveries }),
    [activeBarCount, activeIncidents, critThreats, activeRecoveries]
  );

  const excellenceBar = useMemo(
    () => _buildExcellenceBar({
      maturityScore:  maturitySnap?.score  ?? 100,
      maturityLabel:  maturitySnap?.label  ?? "WORLD_CLASS",
      uxCalmness,
      memoryScore,
    }),
    [maturitySnap?.score, maturitySnap?.label, uxCalmness, memoryScore]
  );

  return {
    initialized,
    smoothnessSigs,
    memoryEvents,
    renderEvents,
    consistencySigs,
    maturitySnap,
    smoothnessAgg,
    memoryScore,
    renderScore,
    consistencyAgg,
    uxCalmness,
    excellenceBar,
    recordSmoothnessSignal,
    recordMemoryEvent,
    recordRenderEvent,
    recordConsistencySignal,
    evaluate,
  };
}
