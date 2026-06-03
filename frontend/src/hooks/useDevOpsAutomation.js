// Phase 1261-1271: Platform execution + DevOps automation.
//
// Consolidates eleven phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: all arrays capped, TTL-filtered, LRU-evicted cache.

import { useState, useEffect, useCallback, useMemo } from "react";

const PIPELINE_KEY   = "jarvis_cicd_pipelines";
const PROVISION_KEY  = "jarvis_infra_provisions";
const RELEASE_KEY    = "jarvis_release_approvals";
const ENV_SYNC_KEY   = "jarvis_env_sync";
const BUILD_KEY      = "jarvis_build_survivability";
const DEP_ANALYTICS_KEY = "jarvis_devops_analytics";
const ISO_KEY        = "jarvis_devops_isolation";

const PIPELINE_MAX   = 20;
const PROVISION_MAX  = 15;
const RELEASE_MAX    = 15;
const ENV_SYNC_MAX   = 20;
const BUILD_MAX      = 20;
const DEP_ANALYTICS_MAX = 20;
const ISO_MAX        = 15;

const PIPELINE_TTL   = 24 * 60 * 60 * 1000;
const PROVISION_TTL  = 24 * 60 * 60 * 1000;
const RELEASE_TTL    = 7  * 24 * 60 * 60 * 1000;
const ENV_SYNC_TTL   = 12 * 60 * 60 * 1000;
const BUILD_TTL      = 24 * 60 * 60 * 1000;
const DEP_ANALYTICS_TTL = 7 * 24 * 60 * 60 * 1000;

const VALID_PIPELINE_STAGES  = ["queued", "building", "testing", "deploying", "verifying", "complete", "failed", "rolled_back"];
const VALID_PROVISION_STAGES = ["requested", "provisioning", "validating", "ready", "failed"];
const VALID_RELEASE_STAGES   = ["draft", "review", "approved", "deploying", "complete", "reverted"];
const VALID_ENVS             = ["dev", "staging", "preview", "production"];
const VALID_BUILD_EVENTS     = ["started", "interrupted", "restored", "failed", "succeeded"];
const VALID_ANALYTICS_DIMS   = ["throughput", "rollback_rate", "replay_releases", "env_sync_quality", "smoothness"];

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

// ── Phase 1261: CI/CD orchestration foundation ────────────────────────────────

function _createPipeline(spec) {
  if (!spec?.name || !spec?.env) return { ok: false, reason: "invalid_spec" };
  if (!VALID_ENVS.includes(spec.env)) return { ok: false, reason: "invalid_env" };

  const list   = _load(PIPELINE_KEY, []);
  const active = list.filter(p => !["complete", "failed", "rolled_back"].includes(p.stage));
  if (active.length >= 5) return { ok: false, reason: "pipeline_limit" };

  const entry = {
    id:         `pipe_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name:       spec.name,
    env:        spec.env,
    stage:      "queued",
    snapshot:   null,
    approvedAt: null,
    ts:         Date.now(),
    updatedAt:  Date.now(),
  };
  const next = [entry, ...list]
    .filter(p => Date.now() - (p.ts || 0) < PIPELINE_TTL)
    .slice(0, PIPELINE_MAX);
  _save(PIPELINE_KEY, next);
  return { ok: true, entry };
}

function _advancePipeline(pipelineId, approved = false) {
  const list     = _load(PIPELINE_KEY, []);
  const idx      = list.findIndex(p => p.id === pipelineId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const pipe     = list[idx];
  const stageIdx = VALID_PIPELINE_STAGES.indexOf(pipe.stage);
  if (stageIdx < 0 || stageIdx >= VALID_PIPELINE_STAGES.indexOf("complete"))
    return { ok: false, reason: "cannot_advance" };

  const nextStage = VALID_PIPELINE_STAGES[stageIdx + 1];
  if (nextStage === "deploying" && !approved) return { ok: false, reason: "approval_required" };

  const snapshot = nextStage === "deploying" ? { capturedAt: Date.now() } : pipe.snapshot;
  const updated  = { ...pipe, stage: nextStage, snapshot, updatedAt: Date.now(),
    approvedAt: nextStage === "deploying" ? Date.now() : pipe.approvedAt };
  list[idx] = updated;
  _save(PIPELINE_KEY, list);
  return { ok: true, pipeline: updated };
}

function _rollbackPipeline(pipelineId) {
  const list = _load(PIPELINE_KEY, []);
  const idx  = list.findIndex(p => p.id === pipelineId);
  if (idx === -1) return { ok: false, reason: "not_found" };
  if (!list[idx].snapshot) return { ok: false, reason: "no_snapshot" };

  list[idx] = { ...list[idx], stage: "rolled_back", updatedAt: Date.now() };
  _save(PIPELINE_KEY, list);
  return { ok: true };
}

// ── Phase 1262: Deployment pipeline intelligence ──────────────────────────────

function _scorePipelineHealth(pipelines) {
  const cached = _cacheGet("pipeline_health");
  if (cached) return cached;

  if (!pipelines.length) return _cacheSet("pipeline_health", 100) || 100;
  const now      = Date.now();
  const recent   = pipelines.filter(p => now - (p.ts || 0) < 24 * 60 * 60 * 1000);
  const complete = recent.filter(p => p.stage === "complete").length;
  const failed   = recent.filter(p => ["failed", "rolled_back"].includes(p.stage)).length;
  const total    = recent.length;
  const score    = total === 0 ? 100 : Math.round(((complete) / total) * 100) - (failed * 5);
  const result   = Math.max(0, Math.min(100, score));
  _cacheSet("pipeline_health", result);
  return result;
}

// ── Phase 1263: Infra provisioning workflows ──────────────────────────────────

function _createProvision(spec) {
  if (!spec?.env || !VALID_ENVS.includes(spec.env))
    return { ok: false, reason: "invalid_env" };

  const list = _load(PROVISION_KEY, []);
  // Prevent duplicate provisioning for same env within 5min
  if (list.find(p => p.env === spec.env
      && !["ready", "failed"].includes(p.stage)
      && Date.now() - (p.ts || 0) < 5 * 60 * 1000))
    return { ok: false, reason: "duplicate_provision" };

  if (list.filter(p => !["ready", "failed"].includes(p.stage)).length >= 3)
    return { ok: false, reason: "provision_limit" };

  const entry = {
    id:        `prov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    env:       spec.env,
    stage:     "requested",
    ts:        Date.now(),
    updatedAt: Date.now(),
  };
  const next = [entry, ...list]
    .filter(p => Date.now() - (p.ts || 0) < PROVISION_TTL)
    .slice(0, PROVISION_MAX);
  _save(PROVISION_KEY, next);
  return { ok: true, entry };
}

function _advanceProvision(provisionId) {
  const list = _load(PROVISION_KEY, []);
  const idx  = list.findIndex(p => p.id === provisionId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const prov     = list[idx];
  const stageIdx = VALID_PROVISION_STAGES.indexOf(prov.stage);
  if (stageIdx >= VALID_PROVISION_STAGES.length - 1) return { ok: false, reason: "already_terminal" };

  list[idx] = { ...prov, stage: VALID_PROVISION_STAGES[stageIdx + 1], updatedAt: Date.now() };
  _save(PROVISION_KEY, list);
  return { ok: true, provision: list[idx] };
}

// ── Phase 1264: Release automation governance ─────────────────────────────────

function _createRelease(spec) {
  if (!spec?.name || !spec?.env) return { ok: false, reason: "invalid_spec" };
  if (!VALID_ENVS.includes(spec.env)) return { ok: false, reason: "invalid_env" };

  const list   = _load(RELEASE_KEY, []);
  const active = list.filter(r => !["complete", "reverted"].includes(r.stage));
  if (active.length >= 3) return { ok: false, reason: "release_limit" };

  const entry = {
    id:         `rel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name:       spec.name,
    env:        spec.env,
    stage:      "draft",
    snapshot:   null,
    approvedAt: null,
    ts:         Date.now(),
    updatedAt:  Date.now(),
  };
  const next = [entry, ...list]
    .filter(r => Date.now() - (r.ts || 0) < RELEASE_TTL)
    .slice(0, RELEASE_MAX);
  _save(RELEASE_KEY, next);
  return { ok: true, entry };
}

function _advanceRelease(releaseId, approved = false) {
  const list = _load(RELEASE_KEY, []);
  const idx  = list.findIndex(r => r.id === releaseId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const rel      = list[idx];
  const stageIdx = VALID_RELEASE_STAGES.indexOf(rel.stage);
  if (stageIdx >= VALID_RELEASE_STAGES.indexOf("complete"))
    return { ok: false, reason: "cannot_advance" };

  const nextStage = VALID_RELEASE_STAGES[stageIdx + 1];
  if (nextStage === "deploying" && !approved) return { ok: false, reason: "approval_required" };

  const snapshot = nextStage === "deploying" ? { capturedAt: Date.now() } : rel.snapshot;
  list[idx] = { ...rel, stage: nextStage, snapshot, updatedAt: Date.now(),
    approvedAt: nextStage === "deploying" ? Date.now() : rel.approvedAt };
  _save(RELEASE_KEY, list);
  return { ok: true, release: list[idx] };
}

// ── Phase 1265: Environment synchronization ───────────────────────────────────

function _recordEnvSync(event) {
  if (!event?.env || !VALID_ENVS.includes(event.env)) return;
  const VALID_SYNC_TYPES = ["config_synced", "state_restored", "diff_detected", "conflict_resolved", "sync_failed"];
  if (!VALID_SYNC_TYPES.includes(event.type)) return;

  const list = _load(ENV_SYNC_KEY, []);
  const next = [{ env: event.env, type: event.type, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < ENV_SYNC_TTL)
    .slice(0, ENV_SYNC_MAX);
  _save(ENV_SYNC_KEY, next);
}

function _scoreEnvSync(syncEvents) {
  const cached = _cacheGet("env_sync_score");
  if (cached) return cached;

  const recent   = syncEvents.filter(e => Date.now() - (e.ts || 0) < 60 * 60 * 1000);
  const failed   = recent.filter(e => e.type === "sync_failed").length;
  const resolved = recent.filter(e => e.type === "conflict_resolved").length;
  const score    = recent.length === 0 ? 100
    : Math.max(0, Math.min(100, 100 - failed * 15 + resolved * 5));
  _cacheSet("env_sync_score", score);
  return score;
}

// ── Phase 1266: Build survivability system ────────────────────────────────────

function _recordBuildEvent(event) {
  if (!event?.type || !VALID_BUILD_EVENTS.includes(event.type)) return;
  const list = _load(BUILD_KEY, []);
  // Dedup same type within 1 min
  if (list.find(e => e.type === event.type && Date.now() - (e.ts || 0) < 60 * 1000)) return;

  const next = [{ type: event.type, env: event.env || null, ts: Date.now() }, ...list]
    .filter(e => Date.now() - (e.ts || 0) < BUILD_TTL)
    .slice(0, BUILD_MAX);
  _save(BUILD_KEY, next);
}

function _scoreBuildSurvivability(buildEvents) {
  const cached = _cacheGet("build_surv");
  if (cached) return cached;

  const now    = Date.now();
  const recent = buildEvents.filter(e => now - (e.ts || 0) < 24 * 60 * 60 * 1000);
  if (!recent.length) { _cacheSet("build_surv", 100); return 100; }

  const succeeded   = recent.filter(e => e.type === "succeeded").length;
  const failed      = recent.filter(e => e.type === "failed").length;
  const interrupted = recent.filter(e => e.type === "interrupted").length;
  const restored    = recent.filter(e => e.type === "restored").length;

  const score = Math.max(0, Math.min(100, Math.round(
    100 - (failed * 15) - (interrupted * 5) + (restored * 5) + (succeeded * 10)
  )));
  _cacheSet("build_surv", score);
  return score;
}

// ── Phase 1267: Operational deployment analytics ──────────────────────────────

function _recordDevOpsAnalytic(sample) {
  if (!sample?.dim || !VALID_ANALYTICS_DIMS.includes(sample.dim)) return;
  if (sample.rawContent || sample.commandOutput || sample.userInput) return; // privacy

  const list = _load(DEP_ANALYTICS_KEY, []);
  const next = [{ dim: sample.dim, score: sample.score ?? 0, ts: Date.now() }, ...list]
    .filter(s => Date.now() - (s.ts || 0) < DEP_ANALYTICS_TTL)
    .slice(0, DEP_ANALYTICS_MAX);
  _save(DEP_ANALYTICS_KEY, next);
}

function _aggregateDevOpsAnalytics(samples) {
  const cached = _cacheGet("devops_agg");
  if (cached) return cached;

  const agg = {};
  VALID_ANALYTICS_DIMS.forEach(dim => {
    const s = samples.filter(x => x.dim === dim);
    agg[dim] = s.length ? Math.round(s.reduce((sum, x) => sum + (x.score || 0), 0) / s.length) : null;
  });
  const filled    = Object.values(agg).filter(v => v !== null);
  const composite = filled.length
    ? Math.round(filled.reduce((a, b) => a + b, 0) / filled.length)
    : 100;
  const result = { dims: agg, composite };
  _cacheSet("devops_agg", result);
  return result;
}

// ── Phase 1268: Multi-environment isolation hardening ─────────────────────────

const DEVOPS_PREFIXES = new Set([
  "jarvis_cicd_pipelines", "jarvis_infra_provisions", "jarvis_release_approvals",
  "jarvis_env_sync", "jarvis_build_survivability", "jarvis_devops_analytics",
  "jarvis_devops_isolation",
]);

function _scanDevOpsIsolation(pipelines) {
  const cached = _cacheGet("devops_iso");
  if (cached) return cached;

  const violations = [];

  // Check pipelines don't share snapshot state across envs
  const envSnapshots = {};
  pipelines.forEach(p => {
    if (!p.snapshot || !p.env) return;
    if (!envSnapshots[p.env]) { envSnapshots[p.env] = p.snapshot.capturedAt; return; }
    if (envSnapshots[p.env] === p.snapshot.capturedAt && violations.length < 5)
      violations.push({ type: "snapshot_crossover", env: p.env, ts: Date.now() });
  });

  // Check for unknown devops keys
  try {
    for (let i = 0; i < localStorage.length && violations.length < 5; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith("jarvis_")) continue;
      if (k.includes("deploy") && !DEVOPS_PREFIXES.has(k)
          && !k.includes("jarvis_prod_") && !k.includes("jarvis_cloud_")
          && !k.includes("jarvis_dist_"))
        violations.push({ type: "deploy_key_bleed", key: k, ts: Date.now() });
    }
  } catch {}

  const prev   = _load(ISO_KEY, []);
  const merged = [...violations, ...prev].slice(0, ISO_MAX);
  _save(ISO_KEY, merged);
  _cacheSet("devops_iso", { violations });
  return { violations };
}

// ── Phase 1269/1270/1271: Perf hardening + stress + calm bar ─────────────────

function _scoreDevOps({ pipelineHealth, buildSurvivability, envSyncScore, analyticsComposite }) {
  return Math.max(0, Math.min(100, Math.round(
    pipelineHealth      * 0.35 +
    buildSurvivability  * 0.30 +
    envSyncScore        * 0.20 +
    analyticsComposite  * 0.15
  )));
}

function _buildDevOpsBar({ devOpsScore, pipelineHealth, buildSurvivability, activePipelines, isoViolations }) {
  const hasIssue = devOpsScore < 80 || isoViolations > 0
    || buildSurvivability < 50 || activePipelines > 4;
  if (!hasIssue) return null;

  const topIssue = isoViolations > 0
    ? `${isoViolations} devops isolation issue${isoViolations > 1 ? "s" : ""}`
    : buildSurvivability < 50
      ? `Build survivability ${buildSurvivability}%`
      : pipelineHealth < 60
        ? `Pipeline health ${pipelineHealth}%`
        : activePipelines > 4
          ? `${activePipelines} active pipelines`
          : null;

  return {
    label: "DEVOPS",
    score: devOpsScore,
    color: devOpsScore >= 80 ? "var(--op-green)" : devOpsScore >= 60 ? "var(--op-amber)" : "var(--op-red)",
    issue: topIssue,
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useDevOpsAutomation() {
  const [pipelines,    setPipelines]    = useState([]);
  const [provisions,   setProvisions]   = useState([]);
  const [releases,     setReleases]     = useState([]);
  const [envSyncs,     setEnvSyncs]     = useState([]);
  const [buildEvents,  setBuildEvents]  = useState([]);
  const [analytics,    setAnalytics]    = useState([]);
  const [isoState,     setIsoState]     = useState({ violations: [] });
  const [initialized,  setInitialized]  = useState(false);

  const loadAll = useCallback(() => {
    const now = Date.now();
    const loadedPipes = _load(PIPELINE_KEY, []).filter(p => now - (p.ts || 0) < PIPELINE_TTL).slice(0, PIPELINE_MAX);
    setPipelines(loadedPipes);
    setProvisions(_load(PROVISION_KEY, []).filter(p => now - (p.ts || 0) < PROVISION_TTL).slice(0, PROVISION_MAX));
    setReleases(_load(RELEASE_KEY, []).filter(r => now - (r.ts || 0) < RELEASE_TTL).slice(0, RELEASE_MAX));
    setEnvSyncs(_load(ENV_SYNC_KEY, []).filter(e => now - (e.ts || 0) < ENV_SYNC_TTL).slice(0, ENV_SYNC_MAX));
    setBuildEvents(_load(BUILD_KEY, []).filter(e => now - (e.ts || 0) < BUILD_TTL).slice(0, BUILD_MAX));
    setAnalytics(_load(DEP_ANALYTICS_KEY, []).filter(s => now - (s.ts || 0) < DEP_ANALYTICS_TTL).slice(0, DEP_ANALYTICS_MAX));
    setIsoState(_scanDevOpsIsolation(loadedPipes));
  }, []);

  useEffect(() => {
    loadAll();
    setInitialized(true);
  }, [loadAll]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadAll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadAll]);

  const createPipeline = useCallback((spec) => {
    const r = _createPipeline(spec);
    if (r.ok) loadAll();
    return r;
  }, [loadAll]);

  const advancePipeline = useCallback((id, approved = false) => {
    const r = _advancePipeline(id, approved);
    if (r.ok) loadAll();
    return r;
  }, [loadAll]);

  const rollbackPipeline = useCallback((id) => {
    const r = _rollbackPipeline(id);
    if (r.ok) loadAll();
    return r;
  }, [loadAll]);

  const createProvision = useCallback((spec) => {
    const r = _createProvision(spec);
    if (r.ok) setProvisions(_load(PROVISION_KEY, []).filter(p => Date.now() - (p.ts || 0) < PROVISION_TTL).slice(0, PROVISION_MAX));
    return r;
  }, []);

  const advanceProvision = useCallback((id) => {
    const r = _advanceProvision(id);
    if (r.ok) setProvisions(_load(PROVISION_KEY, []).filter(p => Date.now() - (p.ts || 0) < PROVISION_TTL).slice(0, PROVISION_MAX));
    return r;
  }, []);

  const createRelease = useCallback((spec) => {
    const r = _createRelease(spec);
    if (r.ok) setReleases(_load(RELEASE_KEY, []).filter(x => Date.now() - (x.ts || 0) < RELEASE_TTL).slice(0, RELEASE_MAX));
    return r;
  }, []);

  const advanceRelease = useCallback((id, approved = false) => {
    const r = _advanceRelease(id, approved);
    if (r.ok) setReleases(_load(RELEASE_KEY, []).filter(x => Date.now() - (x.ts || 0) < RELEASE_TTL).slice(0, RELEASE_MAX));
    return r;
  }, []);

  const recordEnvSync     = useCallback((event)  => { _recordEnvSync(event); setEnvSyncs(_load(ENV_SYNC_KEY, []).filter(e => Date.now() - (e.ts || 0) < ENV_SYNC_TTL).slice(0, ENV_SYNC_MAX)); }, []);
  const recordBuildEvent  = useCallback((event)  => { _recordBuildEvent(event); setBuildEvents(_load(BUILD_KEY, []).filter(e => Date.now() - (e.ts || 0) < BUILD_TTL).slice(0, BUILD_MAX)); }, []);
  const recordAnalytic    = useCallback((sample) => { _recordDevOpsAnalytic(sample); setAnalytics(_load(DEP_ANALYTICS_KEY, []).filter(s => Date.now() - (s.ts || 0) < DEP_ANALYTICS_TTL).slice(0, DEP_ANALYTICS_MAX)); }, []);

  const pipelineHealth    = useMemo(() => _scorePipelineHealth(pipelines),       [pipelines]);
  const envSyncScore      = useMemo(() => _scoreEnvSync(envSyncs),               [envSyncs]);
  const buildSurvivability = useMemo(() => _scoreBuildSurvivability(buildEvents), [buildEvents]);
  const analyticsAgg      = useMemo(() => _aggregateDevOpsAnalytics(analytics),  [analytics]);

  const activePipelines = useMemo(
    () => pipelines.filter(p => !["complete", "failed", "rolled_back"].includes(p.stage)),
    [pipelines]
  );
  const activeReleases = useMemo(
    () => releases.filter(r => !["complete", "reverted"].includes(r.stage)),
    [releases]
  );
  const activeProvisions = useMemo(
    () => provisions.filter(p => !["ready", "failed"].includes(p.stage)),
    [provisions]
  );

  const devOpsScore = useMemo(
    () => _scoreDevOps({ pipelineHealth, buildSurvivability, envSyncScore, analyticsComposite: analyticsAgg.composite }),
    [pipelineHealth, buildSurvivability, envSyncScore, analyticsAgg.composite]
  );

  const _isoCount = isoState.violations.length;

  const devOpsBar = useMemo(
    () => _buildDevOpsBar({ devOpsScore, pipelineHealth, buildSurvivability, activePipelines: activePipelines.length, isoViolations: _isoCount }),
    [devOpsScore, pipelineHealth, buildSurvivability, activePipelines.length, _isoCount]
  );

  return {
    initialized,
    pipelines,
    activePipelines,
    provisions,
    activeProvisions,
    releases,
    activeReleases,
    envSyncs,
    buildEvents,
    analytics,
    analyticsAgg,
    isoState,
    pipelineHealth,
    envSyncScore,
    buildSurvivability,
    devOpsScore,
    devOpsBar,
    createPipeline,
    advancePipeline,
    rollbackPipeline,
    createProvision,
    advanceProvision,
    createRelease,
    advanceRelease,
    recordEnvSync,
    recordBuildEvent,
    recordAnalytic,
  };
}
