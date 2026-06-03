// Phase 886: Public-safe defaults.
// Enforces bounded automation defaults, trust-aware workflow limits,
// protected deployment actions, and safe replay restoration for public-beta.
//
// All state: localStorage-only. No timers. No external calls.
// No autonomous execution. Operator approval required for all protected actions.

import { useState, useEffect, useCallback, useMemo } from "react";

const DEFAULTS_KEY   = "jarvis_safe_defaults";
const OVERRIDE_KEY   = "jarvis_defaults_override";
const DEFAULTS_TTL   = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Built-in safe defaults ────────────────────────────────────────────────────

const SAFE_DEFAULTS = {
  // Automation limits
  maxAutoSteps:          3,       // max chain steps without operator approval
  requireApprovalOnDeploy: true,  // always require approval before deploy
  requireApprovalOnRestart: true, // always require approval before service restart
  blockDestructiveCommands: true, // block rm -rf, disk wipe, fork bomb patterns
  maxRetryAttempts:      2,       // max auto-retry before halting and alerting

  // Replay / restoration
  replayRestoreEnabled:  true,    // restore last session on reconnect
  maxReplayAgeHours:     6,       // ignore replays older than 6h
  requireReplayConfirm:  false,   // auto-restore snapshots without modal (low risk)

  // Deployment protection
  deployRequiresBackup:  false,   // warn but don't block if no backup
  deployBlockOnHighFail: true,    // block deploy when recent fail rate > 50%
  deployBlockOnCrash:    true,    // block deploy when crash recorded in last 30m

  // Trust thresholds
  minTrustForDeploy:     55,      // DEGRADED or better
  minTrustForAutoChain:  70,      // TRUSTED or near-trusted for auto-chains
  minTrustForReplay:     40,      // any context above UNSTABLE floor

  // UX safety
  showDestructiveWarning: true,   // warn before any command matching destructive patterns
  showReplayBanner:       true,   // show reconnect-safe restore banner
  showApprovalGates:      true,   // show approval gates in workflow UI
};

// ── Destructive command patterns ─────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS = [
  /rm\s+-rf/i,
  /:\(\)\s*\{.*\}/,         // fork bomb
  /curl.*\|\s*(?:bash|sh)/i,
  /wget.*-O.*\|\s*(?:bash|sh)/i,
  /dd\s+if=/i,
  /mkfs\./i,
  />\s*\/dev\/sd/i,
  /DROP\s+TABLE/i,
  /TRUNCATE\s+TABLE/i,
  /DELETE\s+FROM\s+\w+\s*;?\s*$/i, // DELETE without WHERE
];

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}

function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function _loadOverrides() {
  try {
    const raw = _load(OVERRIDE_KEY, null);
    if (!raw || Date.now() - (raw.ts || 0) > DEFAULTS_TTL) return {};
    return raw.overrides || {};
  } catch { return {}; }
}

function _saveOverrides(overrides) {
  _save(OVERRIDE_KEY, { overrides, ts: Date.now() });
}

// ── Trust-aware limit resolver ────────────────────────────────────────────────
// Returns effective limits given current trust score.

function _resolveEffectiveLimits(baseDefaults, trustScore) {
  const limits = { ...baseDefaults };

  if (trustScore < 40) {
    // UNSTABLE: lock down almost everything
    limits.maxAutoSteps       = 1;
    limits.requireApprovalOnDeploy  = true;
    limits.requireApprovalOnRestart = true;
    limits.deployBlockOnHighFail    = true;
    limits.deployBlockOnCrash       = true;
    limits.maxRetryAttempts   = 0;
  } else if (trustScore < 70) {
    // DEGRADED: tighten automation limits
    limits.maxAutoSteps       = Math.min(baseDefaults.maxAutoSteps, 2);
    limits.maxRetryAttempts   = Math.min(baseDefaults.maxRetryAttempts, 1);
  }
  // TRUSTED (≥70): use base defaults as-is

  return limits;
}

// ── Deployment safety guard ───────────────────────────────────────────────────
// Returns { safe, blockers, warnings } for a deploy attempt.

function _deploymentSafetyGuard(defaults, trustScore, recentFailRate, hasCrash, hasBackup) {
  const blockers = [];
  const warnings = [];

  if (!defaults.requireApprovalOnDeploy) {
    warnings.push("Deploy approval gate is disabled — operator confirmation skipped");
  }
  if (defaults.minTrustForDeploy > trustScore) {
    blockers.push(`Trust score ${trustScore} below deploy threshold (${defaults.minTrustForDeploy})`);
  }
  if (defaults.deployBlockOnHighFail && recentFailRate > 50) {
    blockers.push(`${recentFailRate}% recent failure rate — stabilize before deploying`);
  }
  if (defaults.deployBlockOnCrash && hasCrash) {
    blockers.push("Crash recorded in last 30m — investigate before deploying");
  }
  if (defaults.deployRequiresBackup && !hasBackup) {
    blockers.push("No backup on record — create a backup before deploying");
  } else if (!hasBackup) {
    warnings.push("No backup on record — consider creating one first");
  }

  return { safe: blockers.length === 0, blockers, warnings };
}

// ── Command safety check ──────────────────────────────────────────────────────

function _isCommandDestructive(cmd) {
  if (!cmd) return false;
  return DESTRUCTIVE_PATTERNS.some(p => p.test(cmd));
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function usePublicSafeDefaults({ trustScore = 100, recentFailRate = 0, hasCrash = false, hasBackup = false } = {}) {
  const [overrides, setOverridesState] = useState({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    setOverridesState(_loadOverrides());
    setInitialized(true);
  }, []);

  // Merged defaults: SAFE_DEFAULTS + operator overrides
  const activeDefaults = useMemo(() => ({
    ...SAFE_DEFAULTS,
    ...overrides,
  }), [overrides]);

  // Effective limits based on trust score
  const effectiveLimits = useMemo(
    () => _resolveEffectiveLimits(activeDefaults, trustScore),
    [activeDefaults, trustScore]
  );

  // Deploy safety status
  const deployGuard = useMemo(
    () => _deploymentSafetyGuard(effectiveLimits, trustScore, recentFailRate, hasCrash, hasBackup),
    [effectiveLimits, trustScore, recentFailRate, hasCrash, hasBackup]
  );

  // Trust label for display
  const trustLabel = useMemo(() => {
    if (trustScore >= 80) return { label: "TRUSTED",  color: "var(--op-green)" };
    if (trustScore >= 55) return { label: "DEGRADED", color: "var(--op-amber)" };
    return                       { label: "UNSTABLE", color: "var(--op-red)"   };
  }, [trustScore]);

  // Override a single setting (operator-visible, persisted)
  const setOverride = useCallback((key, value) => {
    if (!(key in SAFE_DEFAULTS)) return; // only known keys
    setOverridesState(prev => {
      const next = { ...prev, [key]: value };
      _saveOverrides(next);
      return next;
    });
  }, []);

  // Reset all overrides to safe defaults
  const resetDefaults = useCallback(() => {
    setOverridesState({});
    try { localStorage.removeItem(OVERRIDE_KEY); } catch {}
  }, []);

  // Check a command against destructive patterns
  const checkCommand = useCallback((cmd) => {
    const destructive = _isCommandDestructive(cmd);
    return {
      destructive,
      warn: destructive && effectiveLimits.showDestructiveWarning,
      block: destructive && effectiveLimits.blockDestructiveCommands,
    };
  }, [effectiveLimits]);

  // Check whether a workflow chain step requires approval
  const requiresApprovalFor = useCallback((stepType) => {
    if (stepType === "deploy")  return effectiveLimits.requireApprovalOnDeploy;
    if (stepType === "restart") return effectiveLimits.requireApprovalOnRestart;
    return false;
  }, [effectiveLimits]);

  // Summary for operator display
  const safetyStatus = useMemo(() => {
    const restrictions = [];
    if (effectiveLimits.maxAutoSteps < SAFE_DEFAULTS.maxAutoSteps) {
      restrictions.push(`Auto-steps capped at ${effectiveLimits.maxAutoSteps} (trust-limited)`);
    }
    if (effectiveLimits.maxRetryAttempts < SAFE_DEFAULTS.maxRetryAttempts) {
      restrictions.push(`Retries capped at ${effectiveLimits.maxRetryAttempts} (trust-limited)`);
    }
    if (!deployGuard.safe) {
      restrictions.push(`Deploy blocked: ${deployGuard.blockers[0]}`);
    }
    return {
      trustScore,
      trustLabel,
      deployGuard,
      restrictions,
      overrideCount: Object.keys(overrides).length,
      allSafe: restrictions.length === 0 && deployGuard.safe,
    };
  }, [effectiveLimits, deployGuard, trustScore, trustLabel, overrides]);

  return {
    // Computed
    activeDefaults,
    effectiveLimits,
    deployGuard,
    safetyStatus,
    trustLabel,
    initialized,
    // Actions
    setOverride,
    resetDefaults,
    checkCommand,
    requiresApprovalFor,
    // Expose raw constants for consumers
    SAFE_DEFAULTS,
  };
}
