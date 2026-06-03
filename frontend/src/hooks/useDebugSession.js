// Phase 782+785: Debug session continuity.
// Detects active debugging loops from execution history, persists session state
// across reconnects, and surfaces a consolidated debug summary for the operator.
// All local — no external calls. Bounded storage: 5 sessions, 6h TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const SESSION_KEY  = "jarvis_debug_sessions";
const HIST_KEY     = "jarvis_workflow_hist";
const SESSION_MAX  = 5;
const SESSION_TTL  = 6 * 60 * 60 * 1000;   // 6 hours
const LOOP_WINDOW  = 15 * 60 * 1000;        // 15 minutes
const LOOP_MIN_FAILURES = 2;                // min failures to flag a debug loop

// Failure similarity — same command prefix or same error class
function _similar(a, b) {
  if (!a || !b) return false;
  const aBase = (a.cmd || "").split(" ").slice(0, 3).join(" ").toLowerCase();
  const bBase = (b.cmd || "").split(" ").slice(0, 3).join(" ").toLowerCase();
  return aBase === bBase || (aBase.length > 4 && bBase.startsWith(aBase.slice(0, 4)));
}

// Classify the dominant error type in a set of failures
function _classifyFailures(failures) {
  const errors = failures.map(f => (f.summary || f.output || "").toLowerCase());
  if (errors.some(e => e.includes("timeout")))       return "timeout";
  if (errors.some(e => e.includes("not found")))     return "not_found";
  if (errors.some(e => e.includes("permission")))    return "permission";
  if (errors.some(e => e.includes("econnrefused")))  return "connection";
  if (errors.some(e => e.includes("pm2")))           return "pm2";
  if (errors.some(e => e.includes("npm")))           return "npm";
  if (errors.some(e => e.includes("git")))           return "git";
  return "unknown";
}

// Recovery suggestion based on debug loop classification
function _recoverySuggestion(errorClass, cmd) {
  const base = (cmd || "").toLowerCase();
  switch (errorClass) {
    case "timeout":
      return "The command keeps timing out — check if a background process is stuck: pm2 logs --lines 30";
    case "not_found":
      return "File or command not found repeatedly — verify the path exists: ls -la <path>";
    case "permission":
      return "Permission denied in a loop — check file ownership or try: sudo chown -R $(whoami) <path>";
    case "connection":
      return "Connection refused in a loop — check if the service is running: pm2 list";
    case "pm2":
      return "PM2 errors repeating — inspect logs and restart: pm2 logs jarvis-backend --lines 30 && pm2 restart all";
    case "npm":
      return "npm failing repeatedly — try clearing cache: rm -rf node_modules && npm install";
    case "git":
      return "Git errors looping — check repo state: git status && git log --oneline -5";
    default:
      return base.includes("test") ? "Tests keep failing — run with verbose output: npm test -- --verbose" :
             base.includes("build") ? "Build failing repeatedly — check for syntax errors: npm run lint" :
             "Review the error output above and check pm2 logs for the root cause.";
  }
}

// Load persisted debug sessions, pruning expired ones
function _loadSessions() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw);
    const cutoff = Date.now() - SESSION_TTL;
    return all.filter(s => s.startedAt > cutoff);
  } catch { return []; }
}

function _saveSessions(sessions) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions.slice(0, SESSION_MAX)));
  } catch {}
}

// Detect active debug loops from dispatch history (localStorage)
function _detectLoops() {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    const now = Date.now();
    const recentFails = hist.filter(h => !h.ok && (now - (h.ts || 0)) < LOOP_WINDOW);

    if (recentFails.length < LOOP_MIN_FAILURES) return null;

    // Group failures by command similarity
    const groups = [];
    for (const f of recentFails) {
      const existing = groups.find(g => _similar(g[0], f));
      if (existing) existing.push(f);
      else groups.push([f]);
    }

    // Find the largest group
    const largest = groups.sort((a, b) => b.length - a.length)[0];
    if (!largest || largest.length < LOOP_MIN_FAILURES) return null;

    const errorClass = _classifyFailures(largest);
    const firstTs = Math.min(...largest.map(f => f.ts || now));
    const durationMin = Math.round((now - firstTs) / 60000);

    return {
      cmd:        largest[0].cmd,
      count:      largest.length,
      errorClass,
      durationMin,
      firstTs,
      suggestion: _recoverySuggestion(errorClass, largest[0].cmd),
      entries:    largest.slice(0, 5),
    };
  } catch { return null; }
}

// Phase 801: Replay guide — surfaces the most actionable past debug pattern.
// Prevents stale replay: only considers entries within SESSION_TTL (6h).
// Returns null when no useful replay pattern is found.
function _buildReplayGuide(sessions) {
  if (!sessions.length) return null;
  // Find the most recent session that has a recorded errorClass
  const withContext = sessions.filter(s => s.errorClass && s.startedAt > Date.now() - SESSION_TTL);
  if (!withContext.length) return null;
  const latest = withContext[0];
  return {
    errorClass:  latest.errorClass,
    label:       latest.label,
    suggestion:  _recoverySuggestion(latest.errorClass, latest.cmd || ""),
    ageMin:      Math.round((Date.now() - latest.startedAt) / 60000),
    stale:       Date.now() - latest.startedAt > 60 * 60 * 1000, // > 1h = stale
  };
}

export function useDebugSession() {
  const [sessions,    setSessions]    = useState(() => _loadSessions());
  const [activeLoop,  setActiveLoop]  = useState(null);
  const [dismissed,   setDismissed]   = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("jarvis_debug_dismissed") || "[]")); }
    catch { return new Set(); }
  });

  // Detect debug loops on mount and on history changes (polled via effect)
  useEffect(() => {
    const check = () => {
      const loop = _detectLoops();
      setActiveLoop(loop);
    };
    check();
    const id = setInterval(check, 30_000); // re-check every 30s
    return () => clearInterval(id);
  }, []);

  // Save a named debug session (operator-initiated or auto-detected)
  const saveSession = useCallback((label, context = {}) => {
    setSessions(prev => {
      const session = {
        id:         `dbg-${Date.now()}`,
        label:      label || "Debug session",
        startedAt:  Date.now(),
        ...context,
      };
      const updated = [session, ...prev].slice(0, SESSION_MAX);
      _saveSessions(updated);
      return updated;
    });
  }, []);

  // Dismiss the current loop warning for this session
  const dismissLoop = useCallback(() => {
    if (!activeLoop) return;
    const key = `${activeLoop.cmd}:${activeLoop.firstTs}`;
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(key);
      try { localStorage.setItem("jarvis_debug_dismissed", JSON.stringify([...next].slice(0, 50))); } catch {}
      return next;
    });
  }, [activeLoop]);

  // Clear all debug sessions
  const clearSessions = useCallback(() => {
    setSessions([]);
    _saveSessions([]);
  }, []);

  // Whether the current loop is dismissed
  const loopDismissed = useMemo(() => {
    if (!activeLoop) return true;
    return dismissed.has(`${activeLoop.cmd}:${activeLoop.firstTs}`);
  }, [activeLoop, dismissed]);

  // Phase 801: replay guide — most relevant non-stale past debug pattern
  const replayGuide = useMemo(() => _buildReplayGuide(sessions), [sessions]);

  return {
    sessions,
    activeLoop: loopDismissed ? null : activeLoop,
    replayGuide,
    saveSession,
    dismissLoop,
    clearSessions,
  };
}
