// Phases 1606-1613 + 1616-1620: Public product trust + real-world launch maturity —
// product trust, user continuity, onboarding maturity, support/recovery,
// productivity flows, performance optimization, stress test, UX calmness,
// public release validation, platform validation, product maturity + excellence.
//
// Platform-agnostic (web + Electron). localStorage-only.
// No external calls. No autonomous execution.
// All arrays bounded. Privacy contract: no rawContent/commandOutput/userInput.

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────

const PLM_TRUST_KEY    = "jarvis_plm_trust";
const PLM_SESSION_KEY  = "jarvis_plm_sessions";
const PLM_ONBOARD_KEY  = "jarvis_plm_onboarding";
const PLM_SUPPORT_KEY  = "jarvis_plm_support";
const PLM_WORKFLOW_KEY = "jarvis_plm_workflows";
const PLM_RELEASE_KEY  = "jarvis_plm_releases";
const PLM_PERF_KEY     = "jarvis_plm_perf";
const PLM_ISO_KEY      = "jarvis_plm_live_iso";

const TTL_24H = 24 * 60 * 60 * 1000;
const TTL_7D  = 7  * 24 * 60 * 60 * 1000;

const MAX_TRUST     = 30;
const MAX_SESSIONS  = 20;
const MAX_ONBOARD   = 20;
const MAX_SUPPORT   = 20;
const MAX_WORKFLOWS = 20;
const MAX_RELEASES  = 10;
const MAX_PERF      = 30;

// Phase 1606: trust dimensions
const VALID_TRUST_DIMS = new Set([
  "onboarding_confidence", "workflow_trust", "deployment_transparency",
  "operational_readability", "reconnect_reliability", "replay_smoothness",
]);

// Phase 1607: session stages (forward-only)
const VALID_SESSION_STAGES = [
  "started", "active", "long_running", "recovering", "restored", "terminated",
];

// Phase 1608: onboarding stages (forward-only)
const VALID_ONBOARD_STAGES = [
  "not_started", "initiated", "guided", "workspace_ready",
  "first_workflow", "complete", "stalled",
];

// Phase 1609: support stages (forward-only, operator-gated at escalated)
const VALID_SUPPORT_STAGES = ["open", "triaging", "in_progress", "escalated", "resolved", "closed"];

// Phase 1610: workflow stages (forward-only)
const VALID_WORKFLOW_STAGES = [
  "queued", "running", "paused", "complete", "failed", "cancelled",
];

// Phase 1616: release validation dimensions
const VALID_RELEASE_DIMS = new Set([
  "onboarding_continuity", "runtime_continuity", "deployment_survivability",
  "update_stability", "support_coordination", "ecosystem_trust",
]);

// ── LRU cache (Phase 1611) ────────────────────────────────────────────────────

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

const PLM_PREFIX = "jarvis_plm_";
const PLM_OWNED = new Set([
  PLM_TRUST_KEY, PLM_SESSION_KEY, PLM_ONBOARD_KEY, PLM_SUPPORT_KEY,
  PLM_WORKFLOW_KEY, PLM_RELEASE_KEY, PLM_PERF_KEY, PLM_ISO_KEY,
]);

function _scanIso() {
  const unknown = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PLM_PREFIX) && !PLM_OWNED.has(k)) unknown.push(k);
    }
  } catch {}
  return unknown;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

function _trustScore(trust) {
  if (!trust.length) return 100;
  const vals = trust.map(t => t.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

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

function _supportScore(support) {
  if (!support.length) return 100;
  const unapproved = support.filter(s => s.stage === "escalated" && !s.operatorApproved).length;
  if (unapproved > 3) return 40;
  if (unapproved > 0) return 70;
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

function _releaseScore(releases) {
  if (!releases.length) return 100;
  const vals = releases.map(r => r.score ?? 100);
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// ── Composite bar ─────────────────────────────────────────────────────────────

function _computePLMBar({
  trustScore, sessionScore, onboardScore, supportScore,
  workflowScore, releaseScore, isoViolations,
}) {
  const score = Math.round(
    trustScore    * 0.25 +
    onboardScore  * 0.20 +
    sessionScore  * 0.15 +
    workflowScore * 0.15 +
    releaseScore  * 0.15 +
    supportScore  * 0.10
  ) - (isoViolations > 0 ? 15 : 0);

  const clamped = Math.max(0, Math.min(100, score));
  const hasCrit = isoViolations > 0 || trustScore < 50 || onboardScore < 40;
  const color = hasCrit ? "var(--op-red)" : clamped < 60 ? "var(--op-amber)" : "var(--op-green)";

  let issue = null;
  if (isoViolations > 0)    issue = `PLM isolation: ${isoViolations} unknown keys`;
  else if (trustScore < 50)  issue = `Public trust critical: ${trustScore}%`;
  else if (onboardScore < 40) issue = "Onboarding stall rate critical";
  else if (workflowScore < 60) issue = "Workflow failure rate elevated";
  else if (sessionScore < 60)  issue = "Session recovery elevated";
  else if (releaseScore < 60)  issue = "Release validation issues";

  return { score: clamped, hasCrit, color, issue };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePublicLaunchMaturity() {
  const [trust,     setTrust]     = useState(() => _load(PLM_TRUST_KEY,    []));
  const [sessions,  setSessions]  = useState(() => _load(PLM_SESSION_KEY,  []));
  const [onboard,   setOnboard]   = useState(() => _load(PLM_ONBOARD_KEY,  []));
  const [support,   setSupport]   = useState(() => _load(PLM_SUPPORT_KEY,  []));
  const [workflows, setWorkflows] = useState(() => _load(PLM_WORKFLOW_KEY, []));
  const [releases,  setReleases]  = useState(() => _load(PLM_RELEASE_KEY,  []));
  const [perf,      setPerf]      = useState(() => _load(PLM_PERF_KEY,     []));
  const [isoViolations, setIsoViolations] = useState([]);

  const _recentUpdates = useRef(new Map());
  function _burstGuard(id) {
    const now = Date.now();
    const recent = (_recentUpdates.current.get(id) || []).filter(t => now - t < 10_000);
    if (recent.length >= 3) return false;
    _recentUpdates.current.set(id, [...recent, now]);
    return true;
  }

  // ── Phase 1606: trust write ───────────────────────────────────────────────
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
      _save(PLM_TRUST_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1607: session write ─────────────────────────────────────────────
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
        _save(PLM_SESSION_KEY, next);
        return next;
      }
      const next = [{ sessionId, stage, platform, ts: now }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SESSIONS);
      _save(PLM_SESSION_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1608: onboarding write ─────────────────────────────────────────
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
        _save(PLM_ONBOARD_KEY, next);
        return next;
      }
      const next = [{ userId, stage, ts: now }, ...prev]
        .filter(o => now - (o.ts || 0) < TTL_7D)
        .slice(0, MAX_ONBOARD);
      _save(PLM_ONBOARD_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1609: support write (operator-gated escalation) ────────────────
  const recordSupport = useCallback((entry = {}) => {
    const { ticketId, stage, operatorApproved } = entry;
    if (!ticketId || !VALID_SUPPORT_STAGES.includes(stage)) return;
    if (stage === "escalated" && !operatorApproved) return;
    if (!_burstGuard(`support:${ticketId}`)) return;
    const now = Date.now();
    setSupport(prev => {
      const idx = prev.findIndex(s => s.ticketId === ticketId);
      if (idx !== -1) {
        const cur = prev[idx];
        const curIdx = VALID_SUPPORT_STAGES.indexOf(cur.stage);
        const newIdx = VALID_SUPPORT_STAGES.indexOf(stage);
        if (newIdx < curIdx) return prev;
        const updated = { ...cur, stage, updatedAt: now, ...(operatorApproved ? { operatorApproved: true } : {}) };
        const next = [...prev.slice(0, idx), updated, ...prev.slice(idx + 1)]
          .filter(s => now - (s.ts || 0) < TTL_7D)
          .slice(0, MAX_SUPPORT);
        _save(PLM_SUPPORT_KEY, next);
        return next;
      }
      const next = [{ ticketId, stage, ts: now, ...(operatorApproved ? { operatorApproved: true } : {}) }, ...prev]
        .filter(s => now - (s.ts || 0) < TTL_7D)
        .slice(0, MAX_SUPPORT);
      _save(PLM_SUPPORT_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1610: workflow write ────────────────────────────────────────────
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
        _save(PLM_WORKFLOW_KEY, next);
        return next;
      }
      const next = [{ workflowId, stage, ts: now }, ...prev]
        .filter(w => now - (w.ts || 0) < TTL_7D)
        .slice(0, MAX_WORKFLOWS);
      _save(PLM_WORKFLOW_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1616: release validation write ─────────────────────────────────
  const recordRelease = useCallback((entry = {}) => {
    const { dim, score } = entry;
    if (!VALID_RELEASE_DIMS.has(dim) || score === undefined) return;
    if (score < 0 || score > 100) return;
    const now = Date.now();
    setReleases(prev => {
      const last = prev.find(r => r.dim === dim);
      if (last && now - (last.ts || 0) < 5 * 60_000) return prev;
      const next = [{ dim, score, ts: now }, ...prev]
        .filter(r => now - (r.ts || 0) < TTL_7D)
        .slice(0, MAX_RELEASES);
      _save(PLM_RELEASE_KEY, next);
      return next;
    });
  }, []);

  // ── Phase 1611: perf write ────────────────────────────────────────────────
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
      _save(PLM_PERF_KEY, next);
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

  // ── Coarse dep-keys (Phase 1611) ─────────────────────────────────────────
  const trustCount    = Math.floor(trust.length     / 5);
  const sessionCount  = Math.floor(sessions.length  / 3);
  const onboardCount  = Math.floor(onboard.length   / 3);
  const supportCount  = Math.floor(support.length   / 3);
  const workflowCount = Math.floor(workflows.length / 3);
  const releaseCount  = releases.length;

  const trustScoreVal    = useMemo(() => _trustScore(trust),       [trustCount]);    // eslint-disable-line
  const sessionScoreVal  = useMemo(() => _sessionScore(sessions),  [sessionCount]);  // eslint-disable-line
  const onboardScoreVal  = useMemo(() => _onboardScore(onboard),   [onboardCount]);  // eslint-disable-line
  const supportScoreVal  = useMemo(() => _supportScore(support),   [supportCount]);  // eslint-disable-line
  const workflowScoreVal = useMemo(() => _workflowScore(workflows), [workflowCount]); // eslint-disable-line
  const releaseScoreVal  = useMemo(() => _releaseScore(releases),  [releaseCount]);  // eslint-disable-line

  const plmBar = useMemo(() => _cached("plm_bar", () =>
    _computePLMBar({
      trustScore: trustScoreVal, sessionScore: sessionScoreVal,
      onboardScore: onboardScoreVal, supportScore: supportScoreVal,
      workflowScore: workflowScoreVal, releaseScore: releaseScoreVal,
      isoViolations: isoViolations.length,
    })
  ), [trustScoreVal, sessionScoreVal, onboardScoreVal, supportScoreVal, workflowScoreVal, releaseScoreVal, isoViolations.length]);

  // Phase 1612: stress profile
  const stressProfile = useMemo(() => {
    const recovering     = sessions.filter(s => s.stage === "recovering").length;
    const stalledOnboard = onboard.filter(o => o.stage === "stalled").length;
    const failedWf       = workflows.filter(w => w.stage === "failed").length;
    const openSupport    = support.filter(s => !["resolved", "closed"].includes(s.stage)).length;
    return { recovering, stalledOnboard, failedWf, openSupport };
  }, [sessionCount, onboardCount, workflowCount, supportCount]); // eslint-disable-line

  // Phase 1613: product calmness
  const launchCalmness = useMemo(() => {
    const stalled    = onboard.filter(o => o.stage === "stalled").length;
    const failedWf   = workflows.filter(w => w.stage === "failed").length;
    const lowTrust   = trust.filter(t => (t.score ?? 100) < 60).length;
    const score = Math.max(0, 100 - stalled * 10 - failedWf * 8 - lowTrust * 12);
    return { score, label: score >= 80 ? "CALM" : score >= 60 ? "BUSY" : "OVERLOADED" };
  }, [onboardCount, workflowCount, trustCount]); // eslint-disable-line

  return {
    plmBar,
    plmScore: plmBar.score,
    trustScore:    trustScoreVal,
    sessionScore:  sessionScoreVal,
    onboardScore:  onboardScoreVal,
    supportScore:  supportScoreVal,
    workflowScore: workflowScoreVal,
    releaseScore:  releaseScoreVal,
    plmIsoViolations: isoViolations,
    stressProfile,
    launchCalmness,
    recordTrust,
    recordSession,
    recordOnboarding,
    recordSupport,
    recordWorkflow,
    recordRelease,
    recordPerf,
  };
}
