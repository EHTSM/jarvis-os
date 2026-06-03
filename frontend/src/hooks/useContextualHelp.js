// Phase 937-938: Contextual help + guidance + multi-project UX.
// Workflow walkthroughs, debugging explanations, deployment guidance,
// replay understanding, project switching clarity, replay separation,
// contextual workflow isolation.
//
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: 10 walkthroughs, 5 project contexts, 24h help TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const HELP_KEY   = "jarvis_contextual_help";
const PROJ_KEY   = "jarvis_help_projects";
const HELP_TTL   = 24 * 60 * 60 * 1000;
const PROJ_MAX   = 5;

// ── Contextual help articles ──────────────────────────────────────────────────
// Progressive disclosure: short summary + expandable detail.

const HELP_ARTICLES = {
  workflow_walkthrough: {
    id:       "workflow_walkthrough",
    title:    "How workflow bundles work",
    summary:  "Bundles are pre-built multi-step sequences. Click to start, then approve each step.",
    detail:   [
      "Each bundle has 3-8 steps executed in order.",
      "Steps marked requiresApproval pause for your confirmation.",
      "You can cancel any bundle mid-way — no partial changes are committed.",
      "Successful bundles are remembered and can be reused.",
    ],
    category: "workflows",
  },
  debugging_explanation: {
    id:       "debugging_explanation",
    title:    "Understanding the Debug Sequence",
    summary:  "The Debug Sequence is a dependency-aware guided flow that reduces dead-ends.",
    detail:   [
      "Steps are ordered: health check first, then diagnose, then inspect logs.",
      "Completed steps are not repeated — skip forward when you know the cause.",
      "The sequence adapts based on your recent failure patterns.",
      "Export a debug handoff to share context with teammates.",
    ],
    category: "debugging",
  },
  deployment_guidance: {
    id:       "deployment_guidance",
    title:    "Safe deployment checklist",
    summary:  "JARVIS blocks deploys when trust is below 55 or a crash was recorded in the last 30m.",
    detail:   [
      "Pre-deploy: run health check, create backup, verify no recent crashes.",
      "Deployment confidence score shows HIGH / MEDIUM / LOW based on recent history.",
      "After deploying: run pm2 status and a health-check curl.",
      "If deploy fails, rollback is available via the deploy bundle.",
    ],
    category: "deployment",
  },
  replay_understanding: {
    id:       "replay_understanding",
    title:    "How replay restoration works",
    summary:  "JARVIS stores a session snapshot for up to 6 hours, restored automatically on reconnect.",
    detail:   [
      "Snapshots include: trust score, predictions, and deploy confidence.",
      "Snapshots older than 6 hours are considered stale and not restored.",
      "You can force a fresh evaluation by clicking the ⟳ stale badge.",
      "Storage is local-only — no data leaves your browser.",
    ],
    category: "replay",
  },
  operational_recovery: {
    id:       "operational_recovery",
    title:    "Recovery loop prevention",
    summary:  "Repeating the same failing command is a dead-end. Change approach.",
    detail:   [
      "JARVIS detects when the same command fails 3+ times and surfaces a warning.",
      "Try: inspect logs first (pm2 logs --lines 100), then act on what you see.",
      "Use the Recovery bundle for guided step-by-step service restoration.",
      "After recovery, verify with pm2 status before continuing.",
    ],
    category: "recovery",
  },
};

// ── Multi-project context ─────────────────────────────────────────────────────
// Tracks which project is active and surfaces project-switching clarity.

function _loadProjectContexts() {
  try {
    const raw = JSON.parse(localStorage.getItem(PROJ_KEY) || "{}");
    const now = Date.now();
    // Purge contexts older than TTL
    Object.keys(raw).forEach(k => {
      if (now - (raw[k]?.ts || 0) > HELP_TTL) delete raw[k];
    });
    return raw;
  } catch { return {}; }
}

function _saveProjectContexts(data) {
  try { localStorage.setItem(PROJ_KEY, JSON.stringify(data)); } catch {}
}

function _getCurrentProject() {
  try {
    const profile = JSON.parse(localStorage.getItem("jarvis_biz_profile") || "null");
    return profile?.projectId || profile?.name?.slice(0, 20) || "default";
  } catch { return "default"; }
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadHelpState() {
  const raw = _load(HELP_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > HELP_TTL) return { readArticles: [], expandedId: null };
  return raw;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useContextualHelp() {
  const [readArticles,   setReadArticles]   = useState([]);
  const [expandedId,     setExpandedId]     = useState(null);
  const [projectContexts, setProjectContexts] = useState({});
  const [currentProject,  setCurrentProject]  = useState("default");
  const [initialized,    setInitialized]    = useState(false);

  useEffect(() => {
    const state  = _loadHelpState();
    const ctxs   = _loadProjectContexts();
    const proj   = _getCurrentProject();
    setReadArticles(state.readArticles || []);
    setExpandedId(state.expandedId || null);
    setProjectContexts(ctxs);
    setCurrentProject(proj);
    setInitialized(true);
  }, []);

  const _persistHelp = useCallback((readA, expId) => {
    _save(HELP_KEY, { readArticles: readA, expandedId: expId, ts: Date.now() });
  }, []);

  // Expand/collapse an article
  const toggleArticle = useCallback((articleId) => {
    setExpandedId(prev => {
      const next = prev === articleId ? null : articleId;
      setReadArticles(r => {
        const updated = r.includes(articleId) ? r : [...r, articleId];
        _save(HELP_KEY, { readArticles: updated, expandedId: next, ts: Date.now() });
        return updated;
      });
      return next;
    });
  }, []);

  // Get article by ID
  const getArticle = useCallback((id) => HELP_ARTICLES[id] || null, []);

  // Contextual article suggestion: based on operational state
  const suggestArticle = useCallback((context = {}) => {
    const { hasCrash, deployBlocked, replayStale, inRecoveryLoop } = context;
    if (inRecoveryLoop)  return HELP_ARTICLES.operational_recovery;
    if (hasCrash)        return HELP_ARTICLES.debugging_explanation;
    if (deployBlocked)   return HELP_ARTICLES.deployment_guidance;
    if (replayStale)     return HELP_ARTICLES.replay_understanding;
    return null;
  }, []);

  // Multi-project: record project context switch
  const recordProjectSwitch = useCallback((projectId, meta = {}) => {
    setProjectContexts(prev => {
      const ctxs = { ...prev };
      ctxs[projectId] = { ...meta, ts: Date.now() };
      // Enforce PROJ_MAX
      const keys = Object.keys(ctxs);
      if (keys.length > PROJ_MAX) {
        const oldest = keys.sort((a, b) => (ctxs[a].ts || 0) - (ctxs[b].ts || 0))[0];
        delete ctxs[oldest];
      }
      _saveProjectContexts(ctxs);
      return ctxs;
    });
    setCurrentProject(projectId);
  }, []);

  // Project isolation check: verifies no cross-project key bleeding
  const projectIsolation = useMemo(() => {
    const pids = Object.keys(projectContexts);
    return { isolated: new Set(pids).size === pids.length, projectCount: pids.length };
  }, [projectContexts]);

  // Unread articles
  const unreadCount = useMemo(() =>
    Object.keys(HELP_ARTICLES).filter(id => !readArticles.includes(id)).length,
    [readArticles]
  );

  return {
    initialized,
    articles:     Object.values(HELP_ARTICLES),
    expandedId,
    unreadCount,
    // Actions
    toggleArticle,
    getArticle,
    suggestArticle,
    // Multi-project
    currentProject,
    projectContexts,
    projectIsolation,
    recordProjectSwitch,
  };
}
