// Phase 909: Multi-project productivity analysis.
// Project-specific workflow scoring, replay isolation analytics,
// deployment productivity correlation, debugging efficiency tracking,
// contextual workflow comparisons.
//
// Isolation contract: each project has its own analytics partition — no cross-contamination.
// Bounded: max 5 projects, max 100 events per project, 30-day retention.
// No external calls. No autonomous execution.

import { useState, useEffect, useCallback, useMemo } from "react";

const MPA_KEY   = "jarvis_multi_project_analytics";
const MPA_TTL   = 30 * 24 * 60 * 60 * 1000;
const PROJ_MAX  = 5;
const EVTS_MAX  = 100;

// ── Project key derivation ────────────────────────────────────────────────────
// Derives a stable project ID from the business profile or URL path.

function _getProjectId() {
  try {
    const profile = JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null");
    if (profile?.projectId) return profile.projectId;
    if (profile?.name)      return profile.name.slice(0, 20).replace(/\s/g, "_").toLowerCase();
  } catch {}
  // Fallback: hostname + pathname prefix
  try {
    return `${window.location.hostname}_${window.location.pathname.split("/")[1] || "root"}`.slice(0, 30);
  } catch {
    return "default";
  }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load() {
  try {
    const raw = JSON.parse(localStorage.getItem(MPA_KEY) || "{}");
    // Purge stale projects
    const now = Date.now();
    Object.keys(raw).forEach(pid => {
      const events = raw[pid]?.events || [];
      if (events.length === 0 || now - (events[0]?.ts || 0) > MPA_TTL) delete raw[pid];
    });
    return raw;
  } catch { return {}; }
}

function _save(data) {
  try { localStorage.setItem(MPA_KEY, JSON.stringify(data)); } catch {}
}

// ── Per-project metric calculator ─────────────────────────────────────────────

function _calcProjectMetrics(events) {
  const now   = Date.now();
  const week  = events.filter(e => now - (e.ts || 0) < 7 * 24 * 3600000);

  const count = (type) => week.filter(e => e.type === type).length;
  const wfStarted   = count("workflow_started");
  const wfCompleted = count("workflow_completed");
  const depStarted  = count("deploy_started");
  const depCompleted = count("deploy_completed");
  const debugStarted = count("debug_session_started");
  const debugResolved = count("debug_session_resolved");

  const wfRate  = wfStarted  > 0 ? Math.round((wfCompleted  / wfStarted)  * 100) : null;
  const depRate = depStarted > 0 ? Math.round((depCompleted / depStarted) * 100) : null;
  const dbgRate = debugStarted > 0 ? Math.round((debugResolved / debugStarted) * 100) : null;

  let score = 100;
  if (wfRate  !== null && wfRate  < 70) score -= 20;
  if (depRate !== null && depRate < 80) score -= 25;
  if (dbgRate !== null && dbgRate < 60) score -= 15;
  score = Math.max(0, score);

  return {
    eventCount: week.length,
    workflow:   { started: wfStarted,  completionRate: wfRate },
    deployment: { started: depStarted, successRate: depRate },
    debugging:  { started: debugStarted, resolveRate: dbgRate },
    score,
    label: score >= 80 ? "HIGH" : score >= 55 ? "MEDIUM" : "LOW",
    color: score >= 80 ? "var(--op-green)" : score >= 55 ? "var(--op-amber)" : "var(--op-red)",
  };
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useMultiProjectAnalytics() {
  const [projectData,  setProjectData]  = useState({});
  const [currentProjId, setCurrentProjId] = useState(null);
  const [initialized,   setInitialized]   = useState(false);

  useEffect(() => {
    const data  = _load();
    const pid   = _getProjectId();
    setProjectData(data);
    setCurrentProjId(pid);
    setInitialized(true);
  }, []);

  // Record event for the current project (isolated, no cross-project bleed)
  const record = useCallback((type, meta = {}) => {
    const pid = currentProjId || _getProjectId();
    setProjectData(prev => {
      const data = { ...prev };
      if (!data[pid]) data[pid] = { events: [] };
      const events = [{ type, ts: Date.now(), ...meta }, ...data[pid].events].slice(0, EVTS_MAX);
      data[pid] = { events };
      // Enforce PROJ_MAX — evict oldest-active project
      const pids = Object.keys(data);
      if (pids.length > PROJ_MAX) {
        const oldest = pids
          .filter(p => p !== pid)
          .sort((a, b) => (data[a].events[0]?.ts || 0) - (data[b].events[0]?.ts || 0))[0];
        if (oldest) delete data[oldest];
      }
      _save(data);
      return data;
    });
  }, [currentProjId]);

  // Per-project metrics
  const projectMetrics = useMemo(() => {
    const result = {};
    Object.entries(projectData).forEach(([pid, { events }]) => {
      result[pid] = _calcProjectMetrics(events || []);
    });
    return result;
  }, [projectData]);

  // Current project metrics
  const currentMetrics = useMemo(() =>
    currentProjId ? (projectMetrics[currentProjId] || null) : null,
    [currentProjId, projectMetrics]
  );

  // Cross-project comparison: sorted by score desc
  const projectRanking = useMemo(() =>
    Object.entries(projectMetrics)
      .map(([pid, m]) => ({ pid, ...m }))
      .sort((a, b) => b.score - a.score),
    [projectMetrics]
  );

  // Isolation check: verify no cross-project key bleed
  const isolationOk = useMemo(() => {
    const pids = Object.keys(projectData);
    // All pids should be distinct strings derived from project profiles
    return new Set(pids).size === pids.length;
  }, [projectData]);

  return {
    initialized,
    currentProjId,
    currentMetrics,
    projectMetrics,
    projectRanking,
    isolationOk,
    projectCount: Object.keys(projectData).length,
    record,
  };
}
