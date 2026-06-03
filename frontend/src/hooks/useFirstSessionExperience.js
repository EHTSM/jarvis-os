// Phase 931-933: First-session experience + productivity shortcuts + dashboard calmness.
// First-run clarity, workspace init, debugging discovery, deployment onboarding,
// quick debugging flows, rapid deployment actions, replay restoration shortcuts,
// operational readability, telemetry calmness, workflow prioritization.
//
// Consolidates three phases into one bounded surface.
// All state: localStorage-only. No external calls. No autonomous execution.
// Bounded: 8 shortcuts, 6 tips, 30-day session TTL.

import { useState, useEffect, useCallback, useMemo } from "react";

const FSE_KEY   = "jarvis_fse_state";
const FSE_TTL   = 30 * 24 * 60 * 60 * 1000;
const TIPS_MAX  = 6;
const SHORT_MAX = 8;

// ── First-session tips ────────────────────────────────────────────────────────
// Calm, progressive — each tip shown once then marked read.

const ALL_TIPS = [
  {
    id:       "trust_score",
    phase:    "first_run",
    title:    "Runtime trust score",
    body:     "The ◈ indicator at the top shows TRUSTED / DEGRADED / UNSTABLE. Green means your execution environment is healthy.",
    category: "visibility",
  },
  {
    id:       "workflow_bundles",
    phase:    "first_run",
    title:    "Workflow bundles",
    body:     "Pre-built bundles (Startup, Recovery, Deploy) let you run multi-step sequences with one click. Look for the BUNDLES bar.",
    category: "discoverability",
  },
  {
    id:       "replay_restore",
    phase:    "first_run",
    title:    "Reconnect-safe restoration",
    body:     "If you disconnect and reconnect, JARVIS restores your last session context. Sessions are valid for 6 hours.",
    category: "replay",
  },
  {
    id:       "debug_sequence",
    phase:    "debugging",
    title:    "Debug Sequence panel",
    body:     "The Debug Sequence shows dependency-aware steps: health check → diagnose → inspect logs → restart → verify. Follow them in order.",
    category: "debugging",
  },
  {
    id:       "approval_gates",
    phase:    "deployment",
    title:    "Approval gates",
    body:     "Commands flagged requiresApproval pause for your confirmation. Nothing deploys or restarts without your explicit approval.",
    category: "safety",
  },
  {
    id:       "command_palette",
    phase:    "first_run",
    title:    "Command palette (⌘K)",
    body:     "Press ⌘K to open the command palette. Type to search macros, history, or repo files. Fast access to everything.",
    category: "shortcut",
  },
];

// ── Productivity shortcuts ────────────────────────────────────────────────────
// Each shortcut: { id, label, description, action, cmd?, category, replaySafe }

const BUILTIN_SHORTCUTS = [
  {
    id:         "health_check",
    label:      "Health check",
    description: "Run pm2 status and check runtime health",
    cmd:        "pm2 status",
    category:   "debugging",
    replaySafe: true,
  },
  {
    id:         "inspect_logs",
    label:      "Inspect logs",
    description: "Show last 50 pm2 log lines",
    cmd:        "pm2 logs --lines 50",
    category:   "debugging",
    replaySafe: true,
  },
  {
    id:         "restart_services",
    label:      "Restart services",
    description: "Restart all pm2 processes (requires approval)",
    cmd:        "pm2 restart all",
    category:   "recovery",
    replaySafe: false,
    requiresApproval: true,
  },
  {
    id:         "disk_check",
    label:      "Disk check",
    description: "Check disk usage",
    cmd:        "df -h",
    category:   "diagnostics",
    replaySafe: true,
  },
  {
    id:         "restore_deps",
    label:      "Restore dependencies",
    description: "Run npm install to restore node_modules",
    cmd:        "npm install",
    category:   "recovery",
    replaySafe: true,
  },
  {
    id:         "git_status",
    label:      "Git status",
    description: "Show working tree status",
    cmd:        "git status",
    category:   "git",
    replaySafe: true,
  },
  {
    id:         "create_backup",
    label:      "Create backup",
    description: "Run backup script before deploying",
    cmd:        "npm run backup",
    category:   "deployment",
    replaySafe: false,
    requiresApproval: true,
  },
  {
    id:         "check_memory",
    label:      "Check memory",
    description: "Show pm2 process memory info",
    cmd:        "pm2 info",
    category:   "diagnostics",
    replaySafe: true,
  },
];

// ── Dashboard calmness: noise filter ─────────────────────────────────────────
// Decides which indicators should be suppressed to reduce operator fatigue.
// Returns a set of indicator IDs that are currently low-noise (suppress).

function _buildNoiseFilter({ trustScore = 100, frictionCount = 0, hasRollout = false, hasCrash = false }) {
  const suppress = new Set();

  // Suppress telemetry pill when everything is healthy
  if (trustScore >= 80 && frictionCount === 0 && !hasCrash)  suppress.add("telemetry_pill");
  // Suppress session insight when no issues
  if (trustScore >= 80 && frictionCount === 0)                suppress.add("session_insight");
  // Suppress env health when VALID
  suppress.add("env_health_valid");
  // Suppress rollout info when no active rollout
  if (!hasRollout) suppress.add("rollout_bar");

  return suppress;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadState() {
  const raw = _load(FSE_KEY, null);
  if (!raw || Date.now() - (raw.ts || 0) > FSE_TTL) return { readTips: [], usedShortcuts: [], ts: 0 };
  return raw;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useFirstSessionExperience({
  trustScore    = 100,
  frictionCount = 0,
  hasRollout    = false,
  hasCrash      = false,
} = {}) {
  const [readTips,       setReadTips]       = useState([]);
  const [usedShortcuts,  setUsedShortcuts]  = useState([]);
  const [initialized,    setInitialized]    = useState(false);

  useEffect(() => {
    const state = _loadState();
    setReadTips(state.readTips || []);
    setUsedShortcuts(state.usedShortcuts || []);
    setInitialized(true);
  }, []);

  const _persist = useCallback((readT, usedS) => {
    _save(FSE_KEY, { readTips: readT, usedShortcuts: usedS, ts: Date.now() });
  }, []);

  // Unread tips — show oldest first, cap at TIPS_MAX
  const pendingTips = useMemo(() =>
    ALL_TIPS.filter(t => !readTips.includes(t.id)).slice(0, TIPS_MAX),
    [readTips]
  );

  const nextTip = useMemo(() => pendingTips[0] || null, [pendingTips]);

  const markTipRead = useCallback((tipId) => {
    setReadTips(prev => {
      if (prev.includes(tipId)) return prev;
      const next = [...prev, tipId];
      _persist(next, usedShortcuts);
      return next;
    });
  }, [usedShortcuts, _persist]);

  // Shortcuts — filter by category, track usage
  const shortcuts = useMemo(() => BUILTIN_SHORTCUTS.slice(0, SHORT_MAX), []);

  const quickShortcuts = useMemo(() =>
    shortcuts.filter(s => s.replaySafe && s.category === "debugging").slice(0, 3),
    [shortcuts]
  );

  const recordShortcutUsed = useCallback((shortcutId) => {
    setUsedShortcuts(prev => {
      if (prev.includes(shortcutId)) return prev;
      const next = [...prev, shortcutId];
      _persist(readTips, next);
      return next;
    });
  }, [readTips, _persist]);

  // Dashboard noise filter
  const noiseFilter = useMemo(() =>
    _buildNoiseFilter({ trustScore, frictionCount, hasRollout, hasCrash }),
    [trustScore, frictionCount, hasRollout, hasCrash]
  );

  const shouldShow = useCallback((indicatorId) => !noiseFilter.has(indicatorId), [noiseFilter]);

  // First-session complete: all tips read
  const allTipsRead = useMemo(() =>
    ALL_TIPS.every(t => readTips.includes(t.id)),
    [readTips]
  );

  // UX maturity: tips read + shortcuts used
  const uxMaturityScore = useMemo(() => {
    const tipScore      = Math.round((readTips.length / ALL_TIPS.length) * 50);
    const shortcutScore = Math.round((usedShortcuts.length / Math.max(shortcuts.length, 1)) * 50);
    return Math.min(100, tipScore + shortcutScore);
  }, [readTips, usedShortcuts, shortcuts]);

  return {
    initialized,
    // Tips
    pendingTips,
    nextTip,
    allTipsRead,
    markTipRead,
    // Shortcuts (Phase 932)
    shortcuts,
    quickShortcuts,
    recordShortcutUsed,
    usedShortcutIds: usedShortcuts,
    // Dashboard calmness (Phase 933)
    noiseFilter,
    shouldShow,
    // Maturity
    uxMaturityScore,
  };
}
