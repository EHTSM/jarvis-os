// Phase 321: Execution-awareness engine.
// Detects context shifts, identifies interrupted operator intent, infers active goals.
// All inference is local — reads history + execution graph only. No external calls.

const HIST_KEY    = "jarvis_workflow_hist";
const CONTEXT_KEY = "jarvis_execution_context";

// Phase 321: execution context schema
// { goal, lastShiftTs, activeSequence, interruptedAt, sessionCmds }

function _loadContext() {
  try { return JSON.parse(localStorage.getItem(CONTEXT_KEY) || "{}"); }
  catch { return {}; }
}

function _saveContext(ctx) {
  try { localStorage.setItem(CONTEXT_KEY, JSON.stringify({ ...ctx, savedAt: Date.now() })); } catch {}
}

// Phase 321: classify command into a high-level operational domain
const DOMAIN_PATTERNS = [
  { pattern: /npm run build|docker build/i,                 domain: "building"     },
  { pattern: /npm test|npm run test|jest/i,                 domain: "testing"      },
  { pattern: /git (pull|push|commit|merge|rebase)/i,        domain: "versioning"   },
  { pattern: /pm2 (restart|reload|start)/i,                 domain: "recovery"     },
  { pattern: /pm2 (list|logs|monit)|npm run check-health/i, domain: "observation"  },
  { pattern: /npm install|npm i\b/i,                        domain: "setup"        },
  { pattern: /rm -rf|drop (table|database)|kill -9/i,       domain: "destructive"  },
  { pattern: /kubectl|docker (run|up|compose)/i,            domain: "deployment"   },
  { pattern: /curl|wget/i,                                  domain: "probing"      },
];

export function classifyDomain(cmd) {
  if (!cmd) return "general";
  for (const { pattern, domain } of DOMAIN_PATTERNS) {
    if (pattern.test(cmd)) return domain;
  }
  return "general";
}

// Phase 321: detect context shift — returns shift details if domain changed from recent history
export function detectContextShift(recentCmds = []) {
  if (recentCmds.length < 2) return null;
  const domains = recentCmds.slice(0, 5).map(classifyDomain);
  const current = domains[0];
  const previous = domains.find(d => d !== current && d !== "general");
  if (!previous || current === "general") return null;
  return { from: previous, to: current, confidence: "medium" };
}

// Phase 321: infer the operator's active goal from recent command sequence
export function inferActiveGoal(recentCmds = []) {
  if (!recentCmds.length) return null;
  const domains = recentCmds.slice(0, 6).map(classifyDomain).filter(d => d !== "general");
  if (!domains.length) return null;

  const freq = {};
  domains.forEach(d => { freq[d] = (freq[d] || 0) + 1; });
  const dominant = Object.entries(freq).sort(([, a], [, b]) => b - a)[0];
  if (!dominant) return null;

  const GOAL_MAP = {
    building:     "Building and preparing a release",
    testing:      "Validating code correctness",
    versioning:   "Managing git history and remote sync",
    recovery:     "Restoring services to healthy state",
    observation:  "Monitoring system health",
    setup:        "Setting up the development environment",
    deployment:   "Deploying to a target environment",
    destructive:  "Cleaning up or removing resources",
    probing:      "Testing endpoints or connections",
  };

  return {
    goal: GOAL_MAP[dominant[0]] || "Running an operational workflow",
    domain: dominant[0],
    confidence: dominant[1] >= 3 ? "high" : dominant[1] >= 2 ? "medium" : "low",
  };
}

// Phase 321: detect interrupted intent — was there an uncommitted sequence in the last session?
export function detectInterruptedIntent() {
  try {
    const hist = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
    if (hist.length < 2) return null;

    const recent = hist.slice(0, 8);
    const lastFailed = recent.find(h => !h.ok);
    if (!lastFailed) return null;

    // Was it recent (within last 2 hours)?
    const ageMs = Date.now() - (lastFailed.ts || 0);
    if (ageMs > 2 * 60 * 60 * 1000) return null;

    // Were there successful commands after it? If so, intent was recovered
    const failIdx = recent.indexOf(lastFailed);
    const afterFail = recent.slice(0, failIdx);
    const recoveredAfter = afterFail.some(h => h.ok && classifyDomain(h.cmd) === classifyDomain(lastFailed.cmd));
    if (recoveredAfter) return null;

    return {
      cmd: lastFailed.cmd,
      domain: classifyDomain(lastFailed.cmd),
      ageMin: Math.round(ageMs / 60_000),
      error: lastFailed.summary || "unknown error",
    };
  } catch { return null; }
}

// Phase 324: browser continuity — detect stale automation state and multi-tab conflicts
const BROWSER_STATE_KEY = "jarvis_browser_state";

export function recordBrowserState(tabId, state) {
  try {
    const all = JSON.parse(localStorage.getItem(BROWSER_STATE_KEY) || "{}");
    all[tabId] = { ...state, savedAt: Date.now() };
    localStorage.setItem(BROWSER_STATE_KEY, JSON.stringify(all));
  } catch {}
}

export function detectStaleBrowserState() {
  try {
    const all = JSON.parse(localStorage.getItem(BROWSER_STATE_KEY) || "{}");
    const STALE_MS = 30 * 60 * 1000;
    const stale = Object.entries(all).filter(([, s]) => Date.now() - s.savedAt > STALE_MS);
    if (!stale.length) return null;
    stale.forEach(([id]) => delete all[id]);
    localStorage.setItem(BROWSER_STATE_KEY, JSON.stringify(all));
    return { count: stale.length, pruned: true };
  } catch { return null; }
}

// Phase 321: React hook
import { useState, useEffect, useCallback, useMemo } from "react";

export function useExecutionContext(recentCmds = []) {
  const activeGoal = useMemo(() => inferActiveGoal(recentCmds), [recentCmds.join("|")]);
  const contextShift = useMemo(() => detectContextShift(recentCmds), [recentCmds.join("|")]);

  const [interruptedIntent, setInterruptedIntent] = useState(null);

  useEffect(() => {
    setInterruptedIntent(detectInterruptedIntent());
  }, [recentCmds.length]);

  const classifyCmd = useCallback((cmd) => classifyDomain(cmd), []);

  return { activeGoal, contextShift, interruptedIntent, classifyCmd };
}
