// Phase 893: Multi-version survivability.
// Replay compatibility validation, workflow migration safety,
// deployment continuity across versions, contextual memory preservation,
// reconnect-safe restoration.
//
// All state: localStorage-only. No external calls. No autonomous execution.

import { useState, useEffect, useCallback, useMemo } from "react";

const VERSION_KEY   = "jarvis_version_compat";
const REPLAY_KEY    = "jarvis_replay_compat";
const VERSION_TTL   = 24 * 60 * 60 * 1000;

// ── Version manifest ──────────────────────────────────────────────────────────
// Maps feature sets introduced per phase block. Used to validate replay
// compatibility — if a stored object references features from a newer block,
// it may not be safely playable on an older runtime.

const FEATURE_BLOCKS = [
  { block: "826-840", keys: ["jarvis_pw_memory", "jarvis_pw_exec", "jarvis_recovery_dedup"] },
  { block: "841-855", keys: ["jarvis_oi_memory", "jarvis_oi_session", "jarvis_oi_dismissed"] },
  { block: "856-870", keys: ["jarvis_wa_chains", "jarvis_wa_memory", "jarvis_wa_session", "jarvis_wa_dedup"] },
  { block: "871-885", keys: ["jarvis_cw_exports", "jarvis_cw_shared", "jarvis_cw_handoff", "jarvis_cw_imports"] },
  { block: "886-900", keys: [
      "jarvis_safe_defaults", "jarvis_defaults_override", "jarvis_onboarding",
      "jarvis_crash_log", "jarvis_diagnostics", "jarvis_migration_log",
      "jarvis_telemetry", "jarvis_support_exports", "jarvis_env_validation",
      "jarvis_version_compat", "jarvis_replay_compat",
    ]},
];

// ── Replay compatibility check ────────────────────────────────────────────────
// Validates that a snapshot is compatible with the current runtime.

function _checkReplayCompatibility(snapshot) {
  if (!snapshot) return { compatible: false, reason: "No snapshot" };

  const ageMs = Date.now() - (snapshot.ts || 0);
  const STALE_6H = 6 * 60 * 60 * 1000;

  if (ageMs > STALE_6H) {
    return {
      compatible: false,
      stale: true,
      reason: `Snapshot ${Math.round(ageMs / 3600000)}h old — exceeds 6h replay window`,
    };
  }

  // Check that snapshot's feature block is present in current runtime
  const snapBlock = snapshot.featureBlock;
  if (snapBlock) {
    const known = FEATURE_BLOCKS.some(b => b.block === snapBlock);
    if (!known) {
      return {
        compatible: false,
        reason: `Snapshot from unknown feature block "${snapBlock}" — migration required`,
      };
    }
  }

  return { compatible: true, stale: false, reason: null };
}

// ── Workflow migration safety ─────────────────────────────────────────────────
// Validates that an imported workflow is safe to execute on current runtime.

function _validateWorkflowMigration(workflow) {
  if (!workflow) return { safe: false, issues: ["No workflow provided"] };
  const issues = [];

  const version = parseInt(workflow.version || "0", 10);
  if (version < 1) issues.push("Workflow version < 1 — may be incompatible");
  if (version > 2) issues.push(`Workflow version ${version} is newer than current runtime`);

  const exportedAt = workflow.exportedAt || workflow.ts || 0;
  const ageH = Math.round((Date.now() - exportedAt) / 3600000);
  if (ageH > 24) issues.push(`Workflow exported ${ageH}h ago — verify steps are still valid`);

  const steps = workflow.steps || [];
  if (steps.length === 0)  issues.push("Workflow has no steps");
  if (steps.length > 10)   issues.push(`Workflow has ${steps.length} steps — exceeds safe limit of 10`);

  return { safe: issues.length === 0, issues };
}

// ── Deployment continuity ─────────────────────────────────────────────────────
// Checks that deployment can continue safely after a version transition.

function _checkDeploymentContinuity(updateState) {
  if (!updateState) return { continuous: true, warnings: [] };
  const warnings = [];

  if (updateState.inProgress) {
    warnings.push("Update in progress — deployment should wait until update completes");
  }
  if (updateState.failed) {
    warnings.push("Last update failed — verify integrity before deploying");
  }
  if (updateState.rolledBack) {
    warnings.push("System is on a rolled-back version — test thoroughly before deploying");
  }

  return { continuous: warnings.length === 0, warnings };
}

// ── Memory preservation check ─────────────────────────────────────────────────
// Verifies that contextual memory keys from all feature blocks are intact.

function _checkMemoryPreservation() {
  const MEMORY_KEYS = [
    "jarvis_workflow_hist", "jarvis_execution_memory", "jarvis_operator_workspace",
    "jarvis_pw_memory", "jarvis_oi_memory", "jarvis_wa_memory", "jarvis_cw_handoff",
  ];
  const results = {};
  let preserved = 0;
  MEMORY_KEYS.forEach(k => {
    try {
      const v = localStorage.getItem(k);
      if (!v) { results[k] = "absent"; return; }
      JSON.parse(v);
      results[k] = "ok";
      preserved++;
    } catch {
      results[k] = "corrupted";
    }
  });
  return {
    total:     MEMORY_KEYS.length,
    preserved,
    corrupted: Object.values(results).filter(v => v === "corrupted").length,
    results,
  };
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function _load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "null") ?? fallback; } catch { return fallback; }
}
function _save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useVersionSurvivability() {
  const [replayCompat,    setReplayCompat]    = useState(null);
  const [memoryPreservation, setMemoryPreservation] = useState(null);
  const [deployContiguity, setDeployContiguity] = useState(null);
  const [initialized,     setInitialized]     = useState(false);

  const evaluate = useCallback(() => {
    // Load health snapshot for replay check
    const snap = _load("jarvis_health_snapshot", null);
    const rc   = _checkReplayCompatibility(snap);
    setReplayCompat(rc);

    // Memory preservation
    const mp = _checkMemoryPreservation();
    setMemoryPreservation(mp);

    // Deployment continuity — read update state
    const us = _load("jarvis_update_state", null);
    setDeployContiguity(_checkDeploymentContinuity(us));

    _save(VERSION_KEY, { replayCompat: rc, memoryPreservation: mp, ts: Date.now() });
  }, []);

  useEffect(() => {
    // Try cache first
    const cached = _load(VERSION_KEY, null);
    if (cached && Date.now() - (cached.ts || 0) < VERSION_TTL) {
      if (cached.replayCompat)      setReplayCompat(cached.replayCompat);
      if (cached.memoryPreservation) setMemoryPreservation(cached.memoryPreservation);
    }
    evaluate();
    setInitialized(true);
  }, [evaluate]);

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") evaluate(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [evaluate]);

  // Validate an imported workflow before execution
  const validateWorkflow = useCallback((workflow) => {
    return _validateWorkflowMigration(workflow);
  }, []);

  // Survivability score: 0-100
  const survivabilityScore = useMemo(() => {
    let score = 100;
    if (!replayCompat?.compatible)                    score -= 20;
    if (memoryPreservation?.corrupted > 0)            score -= 15 * Math.min(memoryPreservation.corrupted, 2);
    if (!deployContiguity?.continuous)                score -= 15;
    const preserved = memoryPreservation?.preserved ?? 0;
    const total     = memoryPreservation?.total     ?? 1;
    if (preserved / total < 0.5)                      score -= 10;
    return Math.max(0, score);
  }, [replayCompat, memoryPreservation, deployContiguity]);

  const survivabilityLabel = useMemo(() => {
    if (survivabilityScore >= 85) return { label: "EXCELLENT", color: "var(--op-green)" };
    if (survivabilityScore >= 65) return { label: "GOOD",      color: "var(--op-green)" };
    if (survivabilityScore >= 40) return { label: "DEGRADED",  color: "var(--op-amber)" };
    return                               { label: "POOR",       color: "var(--op-red)"   };
  }, [survivabilityScore]);

  return {
    initialized,
    replayCompat,
    memoryPreservation,
    deployContiguity,
    survivabilityScore,
    survivabilityLabel,
    // Feature blocks manifest (for display)
    featureBlocks: FEATURE_BLOCKS,
    // Actions
    validateWorkflow,
    evaluate,
  };
}
