// Phase 1201-1210: Cloud + distributed operations.
//
// Consolidates ten phases. No external calls. No autonomous execution.
// All state: localStorage-only.
// Bounded: 10 nodes, 20 deployments, 30 replay entries, 25 queue entries.

import { useState, useEffect, useCallback, useMemo } from "react";

const NODES_KEY       = "jarvis_distributed_nodes";
const CLOUD_WS_KEY    = "jarvis_cloud_workspaces";
const REMOTE_EXEC_KEY = "jarvis_remote_exec";
const REPLAY_KEY      = "jarvis_distributed_replay";
const CLOUD_DEP_KEY   = "jarvis_cloud_deployments";
const REDUNDANCY_KEY  = "jarvis_redundancy_state";
const REGION_KEY      = "jarvis_region_isolation";
const DIST_QUEUE_KEY  = "jarvis_dist_queue";

const NODES_MAX       = 10;
const CLOUD_DEP_MAX   = 20;
const REPLAY_MAX      = 30;
const DIST_QUEUE_MAX  = 25;
const REMOTE_EXEC_MAX = 20;
const CLOUD_WS_MAX    = 15;
const REDUNDANCY_MAX  = 20;
const REGION_MAX      = 10;

const NODE_TTL        = 30 * 60 * 1000;
const REPLAY_TTL      = 60 * 60 * 1000;
const CLOUD_DEP_TTL   = 24 * 60 * 60 * 1000;

const VALID_NODE_STATES   = ["active", "degraded", "unreachable", "standby"];
const VALID_REGIONS       = ["us-east", "us-west", "eu-west", "ap-southeast", "ap-northeast"];
const VALID_EXEC_STAGES   = ["queued", "dispatched", "running", "completed", "failed", "rolled_back"];
const VALID_DEP_STAGES    = ["prepare", "validate", "distribute", "deploy", "verify", "complete"];
const VALID_QUEUE_LEVELS  = ["critical", "high", "normal", "low"];

// ── Module-level LRU cache (30s TTL, 40-entry cap) ───────────────────────────

const _cache = new Map();
const CACHE_TTL = 30 * 1000;
const CACHE_MAX = 40;

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

// ── Phase 1201: Distributed runtime foundation ────────────────────────────────

function _initNodes() {
  const cached = _cacheGet("nodes");
  if (cached) return cached;
  const now = Date.now();
  const raw = _load(NODES_KEY, []);
  const nodes = raw
    .filter(n => n?.id && VALID_NODE_STATES.includes(n.state) && now - (n.lastSeen || 0) < NODE_TTL)
    .slice(0, NODES_MAX);
  _cacheSet("nodes", nodes);
  return nodes;
}

function _scoreNodeHealth(nodes) {
  if (!nodes.length) return 100;
  const active = nodes.filter(n => n.state === "active").length;
  const degraded = nodes.filter(n => n.state === "degraded").length;
  const unreachable = nodes.filter(n => n.state === "unreachable").length;
  return Math.max(0, Math.round(
    (active / nodes.length) * 100
    - (degraded / nodes.length) * 20
    - (unreachable / nodes.length) * 40
  ));
}

// ── Phase 1202: Cloud workspace continuity ────────────────────────────────────

function _restoreCloudWorkspace(wsId) {
  if (!wsId || typeof wsId !== "string") return { ok: false, reason: "invalid_id" };
  const cached = _cacheGet(`cws_${wsId}`);
  if (cached) return cached;
  const workspaces = _load(CLOUD_WS_KEY, []);
  const ws = workspaces.find(w => w.id === wsId);
  if (!ws) return { ok: false, reason: "not_found" };
  if (ws.replayAge && ws.replayAge > 2 * 60 * 60 * 1000) return { ok: false, reason: "stale_replay" };
  const result = { ok: true, ws };
  _cacheSet(`cws_${wsId}`, result);
  return result;
}

// ── Phase 1203: Remote execution survivability ────────────────────────────────

function _dispatchRemoteExec(spec, nodes) {
  if (!spec?.type || !spec?.nodeId) return { ok: false, reason: "invalid_spec" };
  if (!VALID_EXEC_STAGES.includes(spec.stage || "queued"))
    return { ok: false, reason: "invalid_stage" };

  const targetNode = nodes.find(n => n.id === spec.nodeId);
  if (!targetNode) return { ok: false, reason: "node_not_found" };
  if (targetNode.state === "unreachable") return { ok: false, reason: "node_unreachable" };

  // Prevent unsafe remote escalation
  if (spec.autoEscalate || spec.bypassApproval) return { ok: false, reason: "unsafe_escalation" };

  const execList = _load(REMOTE_EXEC_KEY, []);
  const duplicate = execList.find(
    e => e.type === spec.type && e.nodeId === spec.nodeId
      && Date.now() - (e.ts || 0) < 5 * 60 * 1000
      && ["queued", "dispatched", "running"].includes(e.stage)
  );
  if (duplicate) return { ok: false, reason: "duplicate_exec" };

  const entry = {
    id:     `rex_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type:   spec.type,
    nodeId: spec.nodeId,
    stage:  "queued",
    ts:     Date.now(),
  };
  const next = [entry, ...execList].slice(0, REMOTE_EXEC_MAX);
  _save(REMOTE_EXEC_KEY, next);
  return { ok: true, entry };
}

// ── Phase 1204: Multi-node replay coordination ────────────────────────────────

function _recordDistributedReplay(replay) {
  if (!replay?.id || !replay?.nodeId) return;
  const now = Date.now();
  const list = _load(REPLAY_KEY, [])
    .filter(r => now - (r.ts || 0) < REPLAY_TTL);
  if (list.find(r => r.id === replay.id)) return; // dedup
  const next = [{ ...replay, ts: now }, ...list].slice(0, REPLAY_MAX);
  _save(REPLAY_KEY, next);
}

function _scoreReplaySurvivability(replays) {
  if (!replays.length) return 100;
  const now = Date.now();
  const recent = replays.filter(r => now - (r.ts || 0) < 30 * 60 * 1000);
  const succeeded = recent.filter(r => r.result === "success").length;
  const total = recent.length;
  return total === 0 ? 100 : Math.round((succeeded / total) * 100);
}

// ── Phase 1205: Cloud deployment orchestration ────────────────────────────────

function _createCloudDeployment(spec) {
  if (!spec?.name || !spec?.region) return { ok: false, reason: "invalid_spec" };
  if (!VALID_REGIONS.includes(spec.region)) return { ok: false, reason: "invalid_region" };

  const deps = _load(CLOUD_DEP_KEY, []);
  const active = deps.filter(d => ["prepare", "validate", "distribute", "deploy"].includes(d.stage));
  if (active.length >= 3) return { ok: false, reason: "too_many_active" };

  const entry = {
    id:        `cdep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name:      spec.name,
    region:    spec.region,
    stage:     "prepare",
    snapshot:  null,
    approvedAt: null,
    ts:        Date.now(),
    updatedAt: Date.now(),
  };
  const next = [entry, ...deps]
    .filter(d => Date.now() - (d.ts || 0) < CLOUD_DEP_TTL)
    .slice(0, CLOUD_DEP_MAX);
  _save(CLOUD_DEP_KEY, next);
  return { ok: true, entry };
}

function _advanceCloudDeployment(depId, approved = false) {
  const deps = _load(CLOUD_DEP_KEY, []);
  const idx = deps.findIndex(d => d.id === depId);
  if (idx === -1) return { ok: false, reason: "not_found" };

  const dep = deps[idx];
  const stageIdx = VALID_DEP_STAGES.indexOf(dep.stage);
  if (stageIdx === -1 || stageIdx >= VALID_DEP_STAGES.length - 1)
    return { ok: false, reason: "cannot_advance" };

  const nextStage = VALID_DEP_STAGES[stageIdx + 1];
  if (nextStage === "deploy" && !approved)
    return { ok: false, reason: "approval_required" };

  const snapshot = nextStage === "deploy" ? { capturedAt: Date.now(), stage: dep.stage } : dep.snapshot;
  const updated = { ...dep, stage: nextStage, snapshot, updatedAt: Date.now(),
    approvedAt: nextStage === "deploy" ? Date.now() : dep.approvedAt };
  deps[idx] = updated;
  _save(CLOUD_DEP_KEY, deps);
  return { ok: true, dep: updated };
}

// ── Phase 1206: Operational redundancy foundation ────────────────────────────

function _updateRedundancyState(event) {
  if (!event?.type) return;
  const VALID_TYPES = ["failover", "failback", "standby_promoted", "quorum_lost", "quorum_restored"];
  if (!VALID_TYPES.includes(event.type)) return;
  const list = _load(REDUNDANCY_KEY, []);
  const next = [{ ...event, ts: Date.now() }, ...list].slice(0, REDUNDANCY_MAX);
  _save(REDUNDANCY_KEY, next);
}

function _scoreRedundancy(nodes) {
  const active = nodes.filter(n => n.state === "active").length;
  const standby = nodes.filter(n => n.state === "standby").length;
  if (active === 0) return 0;
  if (active >= 2 && standby >= 1) return 100;
  if (active >= 2) return 80;
  if (standby >= 1) return 60;
  return 40;
}

// ── Phase 1207: Infrastructure-region resilience ──────────────────────────────

function _scanRegionIsolation(nodes) {
  const cached = _cacheGet("region_iso");
  if (cached) return cached;

  const violations = [];
  const regionMap = {};
  nodes.forEach(n => {
    if (!n.region) return;
    if (!VALID_REGIONS.includes(n.region)) {
      violations.push({ type: "invalid_region", nodeId: n.id, region: n.region, ts: Date.now() });
      return;
    }
    regionMap[n.region] = (regionMap[n.region] || []).concat(n.id);
  });

  const existing = _load(REGION_KEY, []).slice(0, REGION_MAX);
  const allViolations = [...violations.slice(0, 5), ...existing]
    .slice(0, REGION_MAX);
  _save(REGION_KEY, allViolations);
  const result = { violations: allViolations, regionMap };
  _cacheSet("region_iso", result);
  return result;
}

// ── Phase 1208: Distributed queue coordination ────────────────────────────────

function _enqueueDistributed(item) {
  if (!item?.type || !VALID_QUEUE_LEVELS.includes(item.priority || "normal"))
    return { ok: false, reason: "invalid_item" };

  const queue = _load(DIST_QUEUE_KEY, []);
  if (queue.length >= DIST_QUEUE_MAX) return { ok: false, reason: "queue_full" };

  const duplicate = queue.find(
    q => q.type === item.type && q.nodeId === item.nodeId
      && Date.now() - (q.ts || 0) < 60 * 1000
  );
  if (duplicate) return { ok: false, reason: "duplicate_queued" };

  const entry = {
    id:       `dq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type:     item.type,
    priority: item.priority || "normal",
    nodeId:   item.nodeId || null,
    region:   item.region || null,
    ts:       Date.now(),
  };
  const LEVEL_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };
  const next = [entry, ...queue]
    .sort((a, b) => LEVEL_ORDER[a.priority] - LEVEL_ORDER[b.priority])
    .slice(0, DIST_QUEUE_MAX);
  _save(DIST_QUEUE_KEY, next);
  return { ok: true, entry };
}

// ── Phase 1209: Distributed stress validation ─────────────────────────────────

function _validateDistributedState(nodes, deployments, queue, replays) {
  const findings = [];
  if (nodes.filter(n => n.state === "unreachable").length > Math.floor(nodes.length / 2))
    findings.push({ id: "quorum_risk", severity: "high", msg: "Majority of nodes unreachable" });
  if (deployments.filter(d => ["distribute", "deploy"].includes(d.stage)).length >= 3)
    findings.push({ id: "deploy_saturation", severity: "medium", msg: "3+ active cloud deployments" });
  if (queue.length >= DIST_QUEUE_MAX * 0.9)
    findings.push({ id: "queue_pressure", severity: "high", msg: "Distributed queue near capacity" });
  const now = Date.now();
  const staleReplays = replays.filter(r => r.result !== "success" && now - (r.ts || 0) > 30 * 60 * 1000);
  if (staleReplays.length > 3)
    findings.push({ id: "stale_replay", severity: "medium", msg: `${staleReplays.length} stale failed replays` });
  return findings;
}

// ── Phase 1210: Distributed operations UX + composite scoring ─────────────────

function _scoreDistributed({ nodeHealth, replaySurvivability, redundancy, queueDepth, stressFindings }) {
  const base = Math.round(
    nodeHealth          * 0.30 +
    replaySurvivability * 0.25 +
    redundancy          * 0.25 +
    Math.max(0, 100 - (queueDepth / DIST_QUEUE_MAX) * 100) * 0.20
  );
  const penalty = stressFindings.filter(f => f.severity === "high").length * 15
    + stressFindings.filter(f => f.severity === "medium").length * 5;
  return { score: Math.max(0, Math.min(100, base - penalty)), findings: stressFindings };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useDistributedOps({
  activeDeployments = 0,
  queueDepth        = 0,
} = {}) {
  const [nodes,        setNodes]        = useState([]);
  const [cloudDeps,    setCloudDeps]    = useState([]);
  const [remoteExecs,  setRemoteExecs]  = useState([]);
  const [replays,      setReplays]      = useState([]);
  const [queue,        setQueue]        = useState([]);
  const [redundancy,   setRedundancy]   = useState([]);
  const [regionIso,    setRegionIso]    = useState({ violations: [], regionMap: {} });
  const [initialized,  setInitialized]  = useState(false);

  useEffect(() => {
    const now = Date.now();
    setNodes(_initNodes());
    setCloudDeps(_load(CLOUD_DEP_KEY, []).filter(d => now - (d.ts || 0) < CLOUD_DEP_TTL).slice(0, CLOUD_DEP_MAX));
    setRemoteExecs(_load(REMOTE_EXEC_KEY, []).slice(0, REMOTE_EXEC_MAX));
    setReplays(_load(REPLAY_KEY, []).filter(r => now - (r.ts || 0) < REPLAY_TTL).slice(0, REPLAY_MAX));
    setQueue(_load(DIST_QUEUE_KEY, []).slice(0, DIST_QUEUE_MAX));
    setRedundancy(_load(REDUNDANCY_KEY, []).slice(0, REDUNDANCY_MAX));
    setInitialized(true);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      setNodes(_initNodes());
      setReplays(_load(REPLAY_KEY, []).filter(r => now - (r.ts || 0) < REPLAY_TTL).slice(0, REPLAY_MAX));
      setQueue(_load(DIST_QUEUE_KEY, []).slice(0, DIST_QUEUE_MAX));
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const dispatchRemote = useCallback((spec) => {
    const result = _dispatchRemoteExec(spec, nodes);
    if (result.ok) setRemoteExecs(_load(REMOTE_EXEC_KEY, []).slice(0, REMOTE_EXEC_MAX));
    return result;
  }, [nodes]);

  const recordReplay = useCallback((replay) => {
    _recordDistributedReplay(replay);
    const now = Date.now();
    setReplays(_load(REPLAY_KEY, []).filter(r => now - (r.ts || 0) < REPLAY_TTL).slice(0, REPLAY_MAX));
  }, []);

  const createDeployment = useCallback((spec) => {
    const result = _createCloudDeployment(spec);
    if (result.ok) {
      const now = Date.now();
      setCloudDeps(_load(CLOUD_DEP_KEY, []).filter(d => now - (d.ts || 0) < CLOUD_DEP_TTL).slice(0, CLOUD_DEP_MAX));
    }
    return result;
  }, []);

  const advanceDeployment = useCallback((depId, approved = false) => {
    const result = _advanceCloudDeployment(depId, approved);
    if (result.ok) {
      const now = Date.now();
      setCloudDeps(_load(CLOUD_DEP_KEY, []).filter(d => now - (d.ts || 0) < CLOUD_DEP_TTL).slice(0, CLOUD_DEP_MAX));
    }
    return result;
  }, []);

  const enqueue = useCallback((item) => {
    const result = _enqueueDistributed(item);
    if (result.ok) setQueue(_load(DIST_QUEUE_KEY, []).slice(0, DIST_QUEUE_MAX));
    return result;
  }, []);

  const recordRedundancyEvent = useCallback((event) => {
    _updateRedundancyState(event);
    setRedundancy(_load(REDUNDANCY_KEY, []).slice(0, REDUNDANCY_MAX));
  }, []);

  const restoreCloudWorkspace = useCallback((wsId) => _restoreCloudWorkspace(wsId), []);

  const nodeHealth = useMemo(() => _scoreNodeHealth(nodes), [nodes]);

  const replaySurvivability = useMemo(() => _scoreReplaySurvivability(replays), [replays]);

  const redundancyScore = useMemo(() => _scoreRedundancy(nodes), [nodes]);

  const regionIsoData = useMemo(() => {
    const result = _scanRegionIsolation(nodes);
    return result;
  }, [nodes]);

  useEffect(() => { setRegionIso(regionIsoData); }, [regionIsoData]);

  const stressFindings = useMemo(
    () => _validateDistributedState(nodes, cloudDeps, queue, replays),
    [nodes, cloudDeps, queue, replays]
  );

  const distScore = useMemo(
    () => _scoreDistributed({ nodeHealth, replaySurvivability, redundancy: redundancyScore, queueDepth: queue.length, stressFindings }),
    [nodeHealth, replaySurvivability, redundancyScore, queue.length, stressFindings]
  );

  const distributedBar = useMemo(() => {
    if (distScore.score >= 80 && distScore.findings.length === 0) return null;
    return {
      label:   "DISTRIBUTED",
      score:   distScore.score,
      color:   distScore.score >= 80 ? "var(--op-green)" : distScore.score >= 60 ? "var(--op-amber)" : "var(--op-red)",
      finding: distScore.findings[0]?.msg || null,
    };
  }, [distScore]);

  const activeCloudDeps = useMemo(
    () => cloudDeps.filter(d => !["complete", "rolled_back"].includes(d.stage)),
    [cloudDeps]
  );

  const activeRemoteExecs = useMemo(
    () => remoteExecs.filter(e => ["queued", "dispatched", "running"].includes(e.stage)),
    [remoteExecs]
  );

  return {
    initialized,
    nodes,
    cloudDeps,
    activeCloudDeps,
    remoteExecs,
    activeRemoteExecs,
    replays,
    queue,
    redundancy,
    regionIso,
    nodeHealth,
    replaySurvivability,
    redundancyScore,
    stressFindings,
    distScore,
    distributedBar,
    dispatchRemote,
    recordReplay,
    createDeployment,
    advanceDeployment,
    enqueue,
    recordRedundancyEvent,
    restoreCloudWorkspace,
  };
}
