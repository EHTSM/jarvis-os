// Phase 269: Long-running workflow continuity — resumable execution trees, checkpoint replay.
// Checkpoints are written to localStorage so workflows survive page refresh and restart.
// No external calls. Checkpoint TTL: 24 hours.

const CHECKPOINT_KEY = "jarvis_workflow_checkpoints";
const CHECKPOINT_TTL = 24 * 60 * 60 * 1000;
const MAX_CHECKPOINTS = 10;

export function _loadCheckpoints() {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY);
    if (!raw) return [];
    const all = JSON.parse(raw);
    // Prune expired checkpoints
    const live = all.filter(c => Date.now() - c.savedAt < CHECKPOINT_TTL);
    if (live.length !== all.length) _saveCheckpoints(live);
    return live;
  } catch { return []; }
}

function _saveCheckpoints(checkpoints) {
  try { localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(checkpoints.slice(0, MAX_CHECKPOINTS))); } catch {}
}

// Phase 269 + 328: save a workflow checkpoint — versioned for forward compatibility
export function saveCheckpoint(workflowId, stepIndex, completedSteps, remainingSteps, meta = {}) {
  try {
    const checkpoints = _loadCheckpoints().filter(c => c.workflowId !== workflowId);
    checkpoints.unshift({
      v: 2,            // Phase 328: schema version — allows future migration
      workflowId,
      stepIndex,
      completedSteps,
      remainingSteps,
      savedAt: Date.now(),
      ...meta,
    });
    _saveCheckpoints(checkpoints);
  } catch {}
}

// Phase 269: load checkpoint for a workflow
export function loadCheckpoint(workflowId) {
  try {
    return _loadCheckpoints().find(c => c.workflowId === workflowId) || null;
  } catch { return null; }
}

// Phase 269: clear checkpoint after workflow completes or is cancelled
export function clearCheckpoint(workflowId) {
  try {
    const updated = _loadCheckpoints().filter(c => c.workflowId !== workflowId);
    _saveCheckpoints(updated);
  } catch {}
}

// Phase 336: purge all stale checkpoints — operator-callable self-healing for inconsistent state
// Removes checkpoints older than the 6h staleness threshold (not just the 24h TTL expiry)
export function purgeStaleCheckpoints() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  try {
    const live = _loadCheckpoints().filter(c => Date.now() - c.savedAt < SIX_HOURS);
    _saveCheckpoints(live);
    return live.length;
  } catch { return 0; }
}

// Phase 269 + 328: get all resumable checkpoints — includes staleness warning for old checkpoints
export function getResumableCheckpoints() {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  return _loadCheckpoints().map(c => {
    const ageMs = Date.now() - c.savedAt;
    const stale = ageMs > SIX_HOURS;
    return {
      workflowId: c.workflowId,
      stepIndex:  c.stepIndex,
      totalSteps: (c.completedSteps?.length || 0) + (c.remainingSteps?.length || 0),
      savedAt:    c.savedAt,
      stale,                  // Phase 328: warn operator if checkpoint is very old
      label:      c.label || `Workflow (${c.completedSteps?.length || 0} of ${(c.completedSteps?.length || 0) + (c.remainingSteps?.length || 0)} steps done)`,
    };
  });
}

// Phase 269: React hook
import { useState, useEffect, useCallback } from "react";

export function useWorkflowCheckpoint() {
  const [resumable, setResumable] = useState(() => getResumableCheckpoints());

  // Phase 336: self-healing — prune stale checkpoints on mount so orphaned state doesn't accumulate
  useEffect(() => {
    purgeStaleCheckpoints();
    setResumable(getResumableCheckpoints());
  }, []);

  const checkpoint = useCallback((workflowId, stepIndex, done, remaining, meta) => {
    saveCheckpoint(workflowId, stepIndex, done, remaining, meta);
    setResumable(getResumableCheckpoints());
  }, []);

  const resume = useCallback((workflowId) => {
    return loadCheckpoint(workflowId);
  }, []);

  const clear = useCallback((workflowId) => {
    clearCheckpoint(workflowId);
    setResumable(getResumableCheckpoints());
  }, []);

  const purgeStale = useCallback(() => {
    purgeStaleCheckpoints();
    setResumable(getResumableCheckpoints());
  }, []);

  return { resumable, checkpoint, resume, clear, purgeStale };
}
